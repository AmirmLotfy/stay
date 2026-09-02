import {
  CreateScheduleCommand,
  SchedulerClient,
  UpdateScheduleCommand,
  type CreateScheduleCommandInput,
  type SchedulerClientConfig,
} from '@aws-sdk/client-scheduler';
import type { SafetyWindow } from '@stay/contracts';
import { createHash } from 'node:crypto';
import { StayDomainError } from '@stay/domain';
import { log } from './logging.js';

type ScheduledTransition = 'open' | 'first-check' | 'second-check';

export interface SafetyWindowScheduleTarget {
  householdId: string;
  windowId: string;
  transition: ScheduledTransition;
  expectedVersion: number;
  scheduledAt: string;
}

interface ScheduleSender {
  send(command: CreateScheduleCommand | UpdateScheduleCommand): Promise<unknown>;
}

const clientConfig: SchedulerClientConfig = {
  region: process.env.AWS_REGION ?? 'us-east-1',
  maxAttempts: 4,
  retryMode: 'adaptive',
};
const schedulerClient = new SchedulerClient(clientConfig);

function requiredEnvironment(): { groupName: string; targetArn: string; roleArn: string } {
  const groupName = process.env.SAFETY_WINDOW_SCHEDULE_GROUP;
  const targetArn = process.env.SAFETY_WINDOW_SCHEDULER_TARGET_ARN;
  const roleArn = process.env.SAFETY_WINDOW_SCHEDULER_ROLE_ARN;
  if (!groupName || !targetArn || !roleArn) {
    throw new StayDomainError(
      'PROVIDER_UNAVAILABLE',
      'Safety Window scheduling is temporarily unavailable.',
    );
  }
  return { groupName, targetArn, roleArn };
}

function token(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function scheduleName(windowId: string, transition: ScheduledTransition): string {
  return `stay-${token(windowId).slice(0, 40)}-${transition}`;
}

function atExpression(instant: string): string {
  const value = new Date(instant);
  if (Number.isNaN(value.getTime())) {
    throw new StayDomainError('BAD_REQUEST', 'Safety Window timing is invalid.');
  }
  return `at(${value.toISOString().slice(0, 19)})`;
}

export function safetyWindowScheduleInputs(
  householdId: string,
  window: SafetyWindow,
  environment = requiredEnvironment(),
): CreateScheduleCommandInput[] {
  const secondCheckAt = new Date(
    new Date(window.expectedBy).getTime() + window.graceMinutes * 60_000,
  ).toISOString();
  const transitions: Array<{
    transition: ScheduledTransition;
    scheduledAt: string;
    expectedVersion: number;
  }> = [
    { transition: 'open', scheduledAt: window.startsAt, expectedVersion: window.version },
    {
      transition: 'first-check',
      scheduledAt: window.expectedBy,
      expectedVersion: window.version + 1,
    },
    {
      transition: 'second-check',
      scheduledAt: secondCheckAt,
      expectedVersion: window.version + 2,
    },
  ];

  return transitions.map(({ transition, scheduledAt, expectedVersion }) => {
    const payload: SafetyWindowScheduleTarget = {
      householdId,
      windowId: window.id,
      transition,
      expectedVersion,
      scheduledAt,
    };
    const name = scheduleName(window.id, transition);
    return {
      Name: name,
      GroupName: environment.groupName,
      ClientToken: token(`${householdId}:${name}:${scheduledAt}:${expectedVersion}`),
      ActionAfterCompletion: 'DELETE',
      Description: `STAY ${transition} transition for a resident-defined Safety Window`,
      FlexibleTimeWindow: { Mode: 'OFF' },
      ScheduleExpression: atExpression(scheduledAt),
      State: 'ENABLED',
      Target: {
        Arn: environment.targetArn,
        RoleArn: environment.roleArn,
        Input: JSON.stringify(payload),
        RetryPolicy: { MaximumEventAgeInSeconds: 3_600, MaximumRetryAttempts: 3 },
      },
    } satisfies CreateScheduleCommandInput;
  });
}

function isConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'ConflictException' ||
      (error as Error & { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ===
        409)
  );
}

export async function createSafetyWindowSchedules(
  householdId: string,
  window: SafetyWindow,
  sender: ScheduleSender = schedulerClient,
): Promise<void> {
  const inputs = safetyWindowScheduleInputs(householdId, window);
  try {
    for (const input of inputs) {
      try {
        await sender.send(new CreateScheduleCommand(input));
      } catch (error) {
        if (!isConflict(error)) throw error;
        const updateInput = { ...input };
        delete updateInput.ClientToken;
        await sender.send(new UpdateScheduleCommand(updateInput));
      }
    }
  } catch (error) {
    log('ERROR', 'Safety Window schedules were not prepared', {
      householdId,
      windowId: window.id,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    if (error instanceof StayDomainError) throw error;
    throw new StayDomainError(
      'PROVIDER_UNAVAILABLE',
      'Safety Window scheduling is temporarily unavailable. No window was created.',
    );
  }
}
