import { CreateScheduleCommand, UpdateScheduleCommand } from '@aws-sdk/client-scheduler';
import type { SafetyWindow } from '@stay/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSafetyWindowSchedules,
  safetyWindowScheduleInputs,
} from './safety-window-schedules.js';

const window: SafetyWindow = {
  id: 'window-test',
  residentId: 'resident-sarah',
  residentName: 'Sarah',
  title: 'Arrived home',
  template: 'arrived-home',
  state: 'scheduled',
  startsAt: '2026-09-03T15:00:00.000Z',
  expectedBy: '2026-09-03T15:30:00.000Z',
  graceMinutes: 10,
  checkAttempts: 0,
  escalationMemberIds: ['member-maya', 'member-tom'],
  version: 1,
  timeline: [],
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Safety Window schedules', () => {
  it('builds three deterministic one-time transitions with strict versions', () => {
    const inputs = safetyWindowScheduleInputs('household-sarah', window, {
      groupName: 'stay-demo-safety-windows',
      targetArn: 'arn:aws:lambda:us-east-1:111111111111:function:stay-scheduler',
      roleArn: 'arn:aws:iam::111111111111:role/stay-scheduler-role',
    });

    expect(inputs).toHaveLength(3);
    expect(inputs.map((input) => input.ScheduleExpression)).toEqual([
      'at(2026-09-03T15:00:00)',
      'at(2026-09-03T15:30:00)',
      'at(2026-09-03T15:40:00)',
    ]);
    expect(inputs.map((input) => JSON.parse(input.Target?.Input ?? '{}').expectedVersion)).toEqual([
      1, 2, 3,
    ]);
    expect(inputs.every((input) => input.ActionAfterCompletion === 'DELETE')).toBe(true);
  });

  it('updates an existing named schedule on an idempotent conflict', async () => {
    vi.stubEnv('SAFETY_WINDOW_SCHEDULE_GROUP', 'stay-demo-safety-windows');
    vi.stubEnv(
      'SAFETY_WINDOW_SCHEDULER_TARGET_ARN',
      'arn:aws:lambda:us-east-1:111111111111:function:stay-scheduler',
    );
    vi.stubEnv(
      'SAFETY_WINDOW_SCHEDULER_ROLE_ARN',
      'arn:aws:iam::111111111111:role/stay-scheduler-role',
    );
    let calls = 0;
    const commands: Array<CreateScheduleCommand | UpdateScheduleCommand> = [];
    const sender = {
      send: vi.fn(async (command: CreateScheduleCommand | UpdateScheduleCommand) => {
        commands.push(command);
        calls += 1;
        if (calls === 1) {
          const conflict = new Error('already exists');
          conflict.name = 'ConflictException';
          throw conflict;
        }
        return {};
      }),
    };

    await createSafetyWindowSchedules('household-sarah', window, sender);

    expect(commands[0]).toBeInstanceOf(CreateScheduleCommand);
    expect(commands[1]).toBeInstanceOf(UpdateScheduleCommand);
    expect(commands.filter((command) => command instanceof CreateScheduleCommand)).toHaveLength(3);
  });
});
