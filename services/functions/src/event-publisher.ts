import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { DynamoDBStreamEvent } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { log } from './logging.js';

const client = new EventBridgeClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  maxAttempts: 3,
  retryMode: 'adaptive',
});

export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  const entries = event.Records.flatMap((record) => {
    if (record.eventName !== 'INSERT' || !record.dynamodb?.NewImage) return [];
    const item = unmarshall(record.dynamodb.NewImage as Parameters<typeof unmarshall>[0]);
    if (typeof item.SK !== 'string' || !item.SK.startsWith('OUTBOX#') || !item.event) return [];
    return [
      {
        EventBusName: process.env.EVENT_BUS_NAME,
        Source: 'stay.domain',
        DetailType: String(item.event.type ?? 'DomainEvent'),
        Detail: JSON.stringify({ ...item.event, streamEventId: record.eventID }),
        Time: new Date(String(item.event.occurredAt)),
      },
    ];
  });
  if (!entries.length) return;
  for (let offset = 0; offset < entries.length; offset += 10) {
    const batch = entries.slice(offset, offset + 10);
    const result = await client.send(new PutEventsCommand({ Entries: batch }));
    if (result.FailedEntryCount) {
      throw new Error(`Failed to publish ${result.FailedEntryCount} outbox events.`);
    }
  }
  log('INFO', 'outbox events published', { count: entries.length });
}
