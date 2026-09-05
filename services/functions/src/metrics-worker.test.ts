import type { SQSEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cloudwatchSend: vi.fn(),
  tableSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: class {
    public send = mocks.cloudwatchSend;
  },
  PutMetricDataCommand: class {
    public constructor(public readonly input: unknown) {}
  },
}));
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mocks.tableSend }) },
  PutCommand: class {
    public constructor(public readonly input: unknown) {}
  },
  UpdateCommand: class {
    public constructor(public readonly input: unknown) {}
  },
  DeleteCommand: class {
    public constructor(public readonly input: unknown) {}
  },
}));

import { handler } from './metrics-worker.js';

function sqsEvent(messageId = 'message-one'): SQSEvent {
  return {
    Records: [
      {
        messageId,
        receiptHandle: 'receipt',
        body: JSON.stringify({
          id: 'event-one',
          time: '2026-09-02T03:20:00.000Z',
          'detail-type': 'Incident.ResponderAccepted',
          detail: {
            id: 'domain-event-one',
            householdId: 'household-demo',
            aggregateId: 'incident-window-morning',
            aggregateType: 'incident',
          },
        }),
        attributes: {
          ApproximateReceiveCount: '1',
          SentTimestamp: '0',
          SenderId: 'events.amazonaws.com',
          ApproximateFirstReceiveTimestamp: '0',
        },
        messageAttributes: {},
        md5OfBody: 'hash',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:111111111111:metrics',
        awsRegion: 'us-east-1',
      },
    ],
  };
}

describe('metrics worker', () => {
  beforeEach(() => {
    process.env.TABLE_NAME = 'stay-test';
    delete process.env.STAY_ENVIRONMENT;
    mocks.cloudwatchSend.mockReset();
    mocks.tableSend.mockReset();
  });

  it('isolates pilot metrics from judge metrics', async () => {
    process.env.STAY_ENVIRONMENT = 'pilot';
    mocks.tableSend.mockResolvedValue({});
    mocks.cloudwatchSend.mockResolvedValue({});
    await handler(sqsEvent());
    expect(mocks.cloudwatchSend.mock.calls[0]![0].input.Namespace).toBe('STAY/Pilot');
    expect(mocks.cloudwatchSend.mock.calls[0]![0].input.MetricData[0].Dimensions).toEqual([
      { Name: 'Stage', Value: 'pilot' },
    ]);
  });

  it('emits only bounded event metadata and records delivery', async () => {
    mocks.tableSend.mockResolvedValue({});
    mocks.cloudwatchSend.mockResolvedValue({});

    await expect(handler(sqsEvent())).resolves.toEqual({ batchItemFailures: [] });

    expect(mocks.cloudwatchSend).toHaveBeenCalledOnce();
    const command = mocks.cloudwatchSend.mock.calls[0]![0] as {
      input: {
        Namespace: string;
        MetricData: Array<{
          Dimensions: Array<{ Name: string; Value: string }>;
          MetricName: string;
        }>;
      };
    };
    expect(command.input).toMatchObject({
      Namespace: 'STAY/Demo',
      MetricData: [
        {
          MetricName: 'DomainEventCount',
          Dimensions: [
            { Name: 'EventType', Value: 'Incident.ResponderAccepted' },
            { Name: 'AggregateType', Value: 'incident' },
          ],
        },
      ],
    });
    expect(JSON.stringify(command.input)).not.toContain('household-demo');
    expect(mocks.tableSend).toHaveBeenCalledTimes(2);
  });

  it('suppresses a duplicate without emitting the metric again', async () => {
    const duplicate = new Error('duplicate');
    duplicate.name = 'ConditionalCheckFailedException';
    mocks.tableSend.mockRejectedValueOnce(duplicate);

    await expect(handler(sqsEvent('duplicate-message'))).resolves.toEqual({
      batchItemFailures: [],
    });
    expect(mocks.cloudwatchSend).not.toHaveBeenCalled();
    expect(mocks.tableSend).toHaveBeenCalledOnce();
  });

  it('releases the delivery marker and reports a retryable failure', async () => {
    mocks.tableSend.mockResolvedValue({});
    mocks.cloudwatchSend.mockRejectedValueOnce(new Error('CloudWatch unavailable'));

    await expect(handler(sqsEvent('retry-message'))).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: 'retry-message' }],
    });
    expect(mocks.tableSend).toHaveBeenCalledTimes(2);
  });
});
