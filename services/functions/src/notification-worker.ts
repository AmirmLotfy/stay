import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { SQSEvent } from 'aws-lambda';
import { z } from 'zod';
import { log } from './logging.js';

const DeliverySchema = z.object({
  id: z.string(),
  recipientEmail: z.email(),
  recipientName: z.string(),
  residentFirstName: z.string(),
  message: z.enum(['help-requested', 'response-accepted', 'incident-update']),
  incidentId: z.string().optional(),
});
const EventBridgeEnvelopeSchema = z.object({
  id: z.string(),
  'detail-type': z.enum(['HelpRequest.Opened', 'Incident.ResponderAccepted', 'Incident.Activated']),
  detail: z.object({
    id: z.string(),
    householdId: z.string(),
    aggregateId: z.string(),
    data: z.record(z.string(), z.unknown()).default({}),
  }),
});
const client = new SESv2Client({
  region: process.env.AWS_REGION ?? 'us-east-1',
  maxAttempts: 3,
  retryMode: 'adaptive',
});
const table = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    maxAttempts: 3,
    retryMode: 'adaptive',
  }),
  { marshallOptions: { removeUndefinedValues: true } },
);

const copy = {
  'help-requested': (name: string) =>
    `${name} asked their Circle for help. Sign in to STAY to view and respond.`,
  'response-accepted': (name: string) =>
    `A Circle member accepted ${name}’s request. Sign in to STAY for the current update.`,
  'incident-update': (name: string) =>
    `${name}’s Circle plan has an update. Sign in to STAY to view authorized details.`,
};

function parseDelivery(body: string) {
  const input: unknown = JSON.parse(body);
  const direct = DeliverySchema.safeParse(input);
  if (direct.success) return direct.data;
  const envelope = EventBridgeEnvelopeSchema.parse(input);
  const message = {
    'HelpRequest.Opened': 'help-requested',
    'Incident.ResponderAccepted': 'response-accepted',
    'Incident.Activated': 'incident-update',
  }[envelope['detail-type']] as keyof typeof copy;
  if (!process.env.SES_RECIPIENT_EMAIL) throw new Error('SES_RECIPIENT_EMAIL is not configured.');
  return DeliverySchema.parse({
    id: envelope.detail.id,
    recipientEmail: process.env.SES_RECIPIENT_EMAIL,
    recipientName: 'STAY demo Circle',
    residentFirstName:
      typeof envelope.detail.data.residentFirstName === 'string'
        ? envelope.detail.data.residentFirstName
        : 'Sarah',
    message,
    incidentId: envelope['detail-type'].startsWith('Incident.')
      ? envelope.detail.aggregateId
      : undefined,
  });
}

export async function handler(
  event: SQSEvent,
): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> {
  const failures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      const delivery = parseDelivery(record.body);
      if (!process.env.SES_FROM_EMAIL) throw new Error('SES_FROM_EMAIL is not configured.');
      if (!process.env.TABLE_NAME) throw new Error('TABLE_NAME is not configured.');
      const markerKey = {
        PK: `DELIVERY#${delivery.id}`,
        SK: `SES#${delivery.recipientEmail.toLowerCase()}`,
      };
      try {
        await table.send(
          new PutCommand({
            TableName: process.env.TABLE_NAME,
            Item: {
              ...markerKey,
              state: 'processing',
              expiresAt: Math.floor(Date.now() / 1000) + 7 * 86_400,
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          }),
        );
      } catch (error) {
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
          log('INFO', 'duplicate notification suppressed', { deliveryId: delivery.id });
          continue;
        }
        throw error;
      }
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: `STAY <${process.env.SES_FROM_EMAIL}>`,
          Destination: { ToAddresses: [delivery.recipientEmail] },
          Content: {
            Simple: {
              Subject: { Data: 'A STAY Circle update' },
              Body: {
                Text: {
                  Data: `${copy[delivery.message](delivery.residentFirstName)}\n\nSTAY never includes addresses, access instructions, keys, or location in email.`,
                },
              },
            },
          },
          EmailTags: [{ Name: 'delivery-id', Value: delivery.id.replace(/[^a-zA-Z0-9_-]/g, '_') }],
        }),
      );
      await table.send(
        new UpdateCommand({
          TableName: process.env.TABLE_NAME,
          Key: markerKey,
          UpdateExpression: 'SET #state = :sent, sentAt = :sentAt',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: { ':sent': 'sent', ':sentAt': new Date().toISOString() },
        }),
      );
      log('INFO', 'minimal notification sent', {
        deliveryId: delivery.id,
        message: delivery.message,
      });
    } catch (error) {
      const parsed = (() => {
        try {
          return parseDelivery(record.body);
        } catch {
          return null;
        }
      })();
      if (parsed && process.env.TABLE_NAME) {
        await table
          .send(
            new DeleteCommand({
              TableName: process.env.TABLE_NAME,
              Key: {
                PK: `DELIVERY#${parsed.id}`,
                SK: `SES#${parsed.recipientEmail.toLowerCase()}`,
              },
            }),
          )
          .catch(() => undefined);
      }
      failures.push({ itemIdentifier: record.messageId });
      log('ERROR', 'notification delivery failed', {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
  return { batchItemFailures: failures };
}
