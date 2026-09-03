import type { DynamoDBStreamEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eventSend: vi.fn(),
  unmarshall: vi.fn(),
}));

vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: class {
    public send = mocks.eventSend;
  },
  PutEventsCommand: class {
    public constructor(public readonly input: unknown) {}
  },
}));
vi.mock('@aws-sdk/util-dynamodb', () => ({ unmarshall: mocks.unmarshall }));

import { handler } from './event-publisher.js';

function streamEvent(count: number): DynamoDBStreamEvent {
  return {
    Records: Array.from({ length: count }, (_, index) => ({
      eventID: `stream-${index}`,
      eventName: 'INSERT',
      dynamodb: { NewImage: { PK: { S: 'HOUSEHOLD#demo' } } },
    })),
  } as unknown as DynamoDBStreamEvent;
}

describe('domain outbox publisher', () => {
  beforeEach(() => {
    process.env.EVENT_BUS_NAME = 'stay-events';
    mocks.eventSend.mockReset();
    mocks.unmarshall.mockReset();
    mocks.unmarshall.mockImplementation(() => ({
      SK: 'OUTBOX#2026-09-03T12:00:00.000Z#event',
      event: {
        id: 'event',
        type: 'Incident.Activated',
        occurredAt: '2026-09-03T12:00:00.000Z',
        householdId: 'household-demo',
      },
    }));
  });

  it('ignores non-outbox records without contacting EventBridge', async () => {
    mocks.unmarshall.mockReturnValue({ SK: 'INCIDENT#one', entity: {} });

    await expect(handler(streamEvent(1))).resolves.toBeUndefined();
    expect(mocks.eventSend).not.toHaveBeenCalled();
  });

  it('publishes stream outbox events in EventBridge batches of at most ten', async () => {
    mocks.eventSend.mockResolvedValue({ FailedEntryCount: 0 });

    await expect(handler(streamEvent(23))).resolves.toBeUndefined();

    expect(mocks.eventSend).toHaveBeenCalledTimes(3);
    expect(
      mocks.eventSend.mock.calls.map(
        ([command]) => (command as { input: { Entries: unknown[] } }).input.Entries.length,
      ),
    ).toEqual([10, 10, 3]);
    const first = mocks.eventSend.mock.calls[0]![0] as {
      input: { Entries: Array<Record<string, unknown>> };
    };
    expect(first.input.Entries[0]).toMatchObject({
      EventBusName: 'stay-events',
      Source: 'stay.domain',
      DetailType: 'Incident.Activated',
      Time: new Date('2026-09-03T12:00:00.000Z'),
    });
    expect(first.input.Entries).toHaveLength(10);
  });

  it('fails the invocation when EventBridge reports a partial batch failure', async () => {
    mocks.eventSend.mockResolvedValue({ FailedEntryCount: 1 });

    await expect(handler(streamEvent(1))).rejects.toThrow('Failed to publish 1 outbox events.');
  });
});
