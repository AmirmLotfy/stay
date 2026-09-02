import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
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

const EventBridgeEnvelopeSchema = z.object({
  id: z.string().min(1),
  time: z.iso.datetime(),
  'detail-type': z.string().min(1).max(255),
  detail: z.object({
    id: z.string().min(1),
    aggregateType: z.string().min(1).max(255),
  }),
});

const cloudwatch = new CloudWatchClient({
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

function tableName(): string {
  if (!process.env.TABLE_NAME) throw new Error('TABLE_NAME is not configured.');
  return process.env.TABLE_NAME;
}

export async function handler(
  event: SQSEvent,
): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> {
  const failures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    const envelope = (() => {
      try {
        return EventBridgeEnvelopeSchema.parse(JSON.parse(record.body));
      } catch (error) {
        log('ERROR', 'metric event was invalid', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : 'unknown',
        });
        failures.push({ itemIdentifier: record.messageId });
        return null;
      }
    })();
    if (!envelope) continue;

    const markerKey = {
      PK: `DELIVERY#${envelope.id}`,
      SK: `METRIC#${envelope['detail-type']}`,
    };
    try {
      try {
        await table.send(
          new PutCommand({
            TableName: tableName(),
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
          log('INFO', 'duplicate metric suppressed', {
            eventId: envelope.id,
            eventType: envelope['detail-type'],
          });
          continue;
        }
        throw error;
      }

      await cloudwatch.send(
        new PutMetricDataCommand({
          Namespace: 'STAY/Demo',
          MetricData: [
            {
              MetricName: 'DomainEventCount',
              Dimensions: [
                { Name: 'EventType', Value: envelope['detail-type'] },
                { Name: 'AggregateType', Value: envelope.detail.aggregateType },
              ],
              Timestamp: new Date(envelope.time),
              Unit: 'Count',
              Value: 1,
            },
          ],
        }),
      );
      await table.send(
        new UpdateCommand({
          TableName: tableName(),
          Key: markerKey,
          UpdateExpression: 'SET #state = :sent, sentAt = :sentAt',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: { ':sent': 'sent', ':sentAt': new Date().toISOString() },
        }),
      );
      log('INFO', 'domain metric emitted', {
        eventId: envelope.id,
        eventType: envelope['detail-type'],
        aggregateType: envelope.detail.aggregateType,
      });
    } catch (error) {
      await table
        .send(
          new DeleteCommand({
            TableName: tableName(),
            Key: markerKey,
          }),
        )
        .catch(() => undefined);
      failures.push({ itemIdentifier: record.messageId });
      log('ERROR', 'metric delivery failed', {
        messageId: record.messageId,
        eventType: envelope['detail-type'],
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
  return { batchItemFailures: failures };
}
