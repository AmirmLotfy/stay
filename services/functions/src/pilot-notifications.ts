import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  HouseholdMembershipSchema,
  NotificationContactSchema,
  type HouseholdMembership,
  type NotificationContact,
} from '@stay/contracts';
import { DynamoStayRepository } from './repository.js';
import { log } from './logging.js';
import { z } from 'zod';

const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1', maxAttempts: 3 }),
  { marshallOptions: { removeUndefinedValues: true } },
);
// Retrying SendEmail after an ambiguous network failure can send duplicates.
const sesClient = new SESv2Client({
  region: process.env.AWS_REGION ?? 'us-east-1',
  maxAttempts: 1,
});
const Envelope = z.object({
  'detail-type': z.enum([
    'HelpRequest.Opened',
    'Incident.ResponderAccepted',
    'Incident.Activated',
    'Incident.ResponderAsked',
    'HelpRequest.Accepted',
  ]),
  detail: z.object({
    id: z.string().min(1),
    householdId: z.string().min(1),
    aggregateId: z.string().min(1),
  }),
});
type DeliveryState = 'processing' | 'sent' | 'unknown' | 'suppressed' | 'retry';
export interface PilotDeliveryIO {
  admit(): Promise<() => Promise<void>>;
  contacts(householdId: string): Promise<NotificationContact[]>;
  membership(householdId: string, subject: string): Promise<HouseholdMembership | null>;
  authorize(householdId: string, membership: HouseholdMembership): Promise<void>;
  claim(
    householdId: string,
    id: string,
    subject: string,
  ): Promise<'claimed' | 'done' | 'busy' | 'unknown'>;
  finish(householdId: string, id: string, subject: string, state: DeliveryState): Promise<void>;
  send(householdId: string, id: string, contact: NotificationContact): Promise<void>;
}

export async function deliverPilotEvent(body: string, io: PilotDeliveryIO): Promise<void> {
  const event = Envelope.parse(JSON.parse(body));
  const { householdId, id } = event.detail;
  if (householdId.startsWith('demo-')) return;
  let failed = false;
  for (const contact of await io.contacts(householdId)) {
    if (
      !contact.enabled ||
      contact.suppression !== 'none' ||
      !contact.verifiedAt ||
      !contact.consentedAt
    )
      continue;
    const membership = await io.membership(householdId, contact.id);
    if (!membership?.active) continue;
    try {
      await io.authorize(householdId, membership);
    } catch (error) {
      if (error instanceof Error && error.message === 'MEMBERSHIP_REVOKED') continue;
      throw error;
    }
    const claim = await io.claim(householdId, id, contact.id);
    if (claim === 'done') continue;
    if (claim === 'busy' || claim === 'unknown') {
      failed = true;
      continue;
    }
    let dispatched = false;
    let release: (() => Promise<void>) | undefined;
    try {
      release = await io.admit();
      // Re-read preferences after claiming; revocation/opt-out wins before dispatch.
      const current = (await io.contacts(householdId)).find((item) => item.id === contact.id);
      if (
        !current ||
        !current.enabled ||
        current.suppression !== 'none' ||
        current.version !== contact.version
      ) {
        await io.finish(householdId, id, contact.id, 'suppressed');
        continue;
      }
      await io.authorize(householdId, membership);
      dispatched = true;
      await io.send(householdId, id, contact);
      await io.finish(householdId, id, contact.id, 'sent');
    } catch (error) {
      if (error instanceof Error && error.message === 'MEMBERSHIP_REVOKED') {
        await io.finish(householdId, id, contact.id, 'suppressed');
        continue;
      }
      if (
        !dispatched ||
        (error instanceof Error &&
          ['TooManyRequestsException', 'ThrottlingException', 'LimitExceededException'].includes(
            error.name,
          ))
      ) {
        await io.finish(householdId, id, contact.id, 'retry');
        failed = true;
        continue;
      }
      // Preserve uncertainty rather than automatically sending a second copy.
      await io.finish(householdId, id, contact.id, 'unknown');
      log('ERROR', 'notification delivery requires operator review', {
        householdId,
        deliveryId: id,
        subject: contact.id,
      });
      failed = true;
    } finally {
      await release?.();
    }
  }
  if (failed) throw new Error('PILOT_DELIVERY_REQUIRES_REVIEW');
}

function deliveryKey(householdId: string, id: string, subject: string) {
  return { PK: `HOUSEHOLD#${householdId}`, SK: `DELIVERY#${id}#${subject}` };
}

// All pilot households and worker instances share one regional sender permit.
// Unrelated SES senders can still throttle us; explicit SES rejection remains retryable.
export async function acquireEmailPermit(io: {
  now(): number;
  reserve(now: number, next: number): Promise<boolean>;
  release(next: number): Promise<void>;
  sleep(milliseconds: number): Promise<void>;
}): Promise<() => Promise<void>> {
  const deadline = io.now() + 25_000;
  while (io.now() < deadline) {
    const now = io.now();
    // Lease outlives the 60-second Lambda timeout; its owner fences release.
    // Hold it through authorization and send, then start the cooldown.
    if (await io.reserve(now, now + 65_000)) return () => io.release(io.now() + 1_100);
    await io.sleep(1_100);
  }
  throw new Error('Email admission timed out before dispatch.');
}

export function pilotDeliveryIO(): PilotDeliveryIO {
  const TableName = process.env.TABLE_NAME;
  const sender = process.env.SES_FROM_EMAIL;
  const configurationSet = process.env.SES_CONFIGURATION_SET;
  if (!TableName || !sender || !configurationSet) throw new Error('Pilot email is not configured.');
  const repository = new DynamoStayRepository(TableName);
  return {
    admit: () => {
      const owner = randomUUID();
      return acquireEmailPermit({
        now: Date.now,
        sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
        release: async (next) => {
          await db.send(
            new UpdateCommand({
              TableName,
              Key: { PK: 'CONTROL#PILOT', SK: 'SES#SEND-RATE' },
              UpdateExpression: 'SET nextAllowedAt = :next REMOVE leaseOwner',
              ConditionExpression: 'leaseOwner = :owner',
              ExpressionAttributeValues: { ':next': next, ':owner': owner },
            }),
          );
        },
        reserve: async (now, next) => {
          try {
            await db.send(
              new UpdateCommand({
                TableName,
                Key: { PK: 'CONTROL#PILOT', SK: 'SES#SEND-RATE' },
                UpdateExpression: 'SET nextAllowedAt = :next, leaseOwner = :owner',
                ConditionExpression: 'attribute_not_exists(nextAllowedAt) OR nextAllowedAt <= :now',
                ExpressionAttributeValues: { ':now': now, ':next': next, ':owner': owner },
              }),
            );
            return true;
          } catch (error) {
            if (error instanceof Error && error.name === 'ConditionalCheckFailedException')
              return false;
            throw error;
          }
        },
      });
    },
    contacts: async (householdId) =>
      (await repository.list(householdId, 'notification-contact')).map((value) =>
        NotificationContactSchema.parse(value),
      ),
    membership: async (householdId, subject) => {
      const result = HouseholdMembershipSchema.safeParse(
        await repository.get(householdId, 'membership', subject),
      );
      return result.success ? result.data : null;
    },
    authorize: async (householdId, membership) => {
      await repository.authorize({
        subject: membership.id,
        householdId,
        residentId: membership.residentId,
        role: membership.role,
        ...(membership.circleMemberId ? { circleMemberId: membership.circleMemberId } : {}),
      });
    },
    claim: async (householdId, id, subject) => {
      const Key = deliveryKey(householdId, id, subject);
      try {
        await db.send(
          new PutCommand({
            TableName,
            Item: {
              ...Key,
              state: 'processing',
              leaseUntil: Math.floor(Date.now() / 1000) + 120,
              createdAt: new Date().toISOString(),
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          }),
        );
        return 'claimed';
      } catch (error) {
        if (!(error instanceof Error) || error.name !== 'ConditionalCheckFailedException')
          throw error;
        const result = await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }));
        if (['sent', 'suppressed'].includes(String(result.Item?.state))) return 'done';
        if (result.Item?.state === 'retry') {
          try {
            await db.send(
              new UpdateCommand({
                TableName,
                Key,
                UpdateExpression: 'SET #state = :processing, leaseUntil = :lease',
                ConditionExpression: '#state = :retry',
                ExpressionAttributeNames: { '#state': 'state' },
                ExpressionAttributeValues: {
                  ':retry': 'retry',
                  ':processing': 'processing',
                  ':lease': Math.floor(Date.now() / 1000) + 120,
                },
              }),
            );
            return 'claimed';
          } catch (retryError) {
            if (
              !(retryError instanceof Error) ||
              retryError.name !== 'ConditionalCheckFailedException'
            )
              throw retryError;
            return 'busy';
          }
        }

        return result.Item?.state === 'processing' &&
          Number(result.Item.leaseUntil) > Date.now() / 1000
          ? 'busy'
          : 'unknown';
      }
    },
    finish: async (householdId, id, subject, state) => {
      await db.send(
        new UpdateCommand({
          TableName,
          Key: deliveryKey(householdId, id, subject),
          UpdateExpression: 'SET #state = :state, updatedAt = :now',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: { ':state': state, ':now': new Date().toISOString() },
        }),
      );
    },
    send: async (householdId, id, contact) => {
      await sesClient.send(
        new SendEmailCommand({
          FromEmailAddress: `STAY <${sender}>`,
          ConfigurationSetName: configurationSet,
          Destination: { ToAddresses: [contact.email] },
          Content: {
            Simple: {
              Subject: { Data: 'A STAY Circle update' },
              Body: {
                Text: {
                  Data: `There is an update in your STAY household. Sign in to view authorized details.\n\n${process.env.PILOT_URL ?? 'https://pilot.saystay.site'}\n\nManage email preferences after signing in. STAY does not contact emergency services.`,
                },
              },
            },
          },
          EmailTags: [
            { Name: 'household', Value: householdId },
            { Name: 'subject', Value: contact.id },
            { Name: 'delivery-id', Value: id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200) },
          ],
        }),
      );
    },
  };
}

const Feedback = z.object({
  eventType: z.enum(['Bounce', 'Complaint']),
  mail: z.object({
    destination: z.array(z.string()),
    tags: z.object({
      household: z.array(z.string()).length(1),
      subject: z.array(z.string()).length(1),
    }),
  }),
});
export async function applyPilotFeedback(body: string): Promise<void> {
  const event = Feedback.parse(JSON.parse(body));
  if (!process.env.TABLE_NAME) throw new Error('Missing table.');
  const householdId = event.mail.tags.household[0]!;
  const subject = event.mail.tags.subject[0]!;
  const suppression = event.eventType === 'Bounce' ? 'bounce' : 'complaint';
  try {
    await db.send(
      new UpdateCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `HOUSEHOLD#${householdId}`, SK: `NOTIFICATION-CONTACT#${subject}` },
        UpdateExpression:
          'SET entity.enabled = :disabled, entity.suppression = :suppression, entity.#version = entity.#version + :one, #version = #version + :one',
        ConditionExpression:
          'attribute_exists(PK) AND contains(:destinations, entity.email) AND entity.suppression <> :suppression',
        ExpressionAttributeNames: { '#version': 'version' },
        ExpressionAttributeValues: {
          ':disabled': false,
          ':suppression': suppression,
          ':one': 1,
          ':destinations': event.mail.destination,
        },
      }),
    );
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'ConditionalCheckFailedException') throw error;
    // Duplicate feedback, removed contact, or an old destination needs no update.
  }
}
