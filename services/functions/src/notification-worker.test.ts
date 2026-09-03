import type { SQSEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sesSend: vi.fn(),
  tableSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: class {
    public send = mocks.sesSend;
  },
  SendEmailCommand: class {
    public constructor(public readonly input: unknown) {}
  },
}));
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));
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

import { handler } from './notification-worker.js';

function sqsEvent(messageId = 'message-one'): SQSEvent {
  return {
    Records: [
      {
        messageId,
        receiptHandle: 'receipt',
        body: JSON.stringify({
          id: 'bridge-event-one',
          'detail-type': 'Incident.Activated',
          detail: {
            id: 'domain-event-one',
            householdId: 'household-demo',
            aggregateId: 'incident-one',
            data: { residentFirstName: 'Sarah', accessInstructions: 'never include this' },
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
        eventSourceARN: 'arn:aws:sqs:us-east-1:111111111111:notifications',
        awsRegion: 'us-east-1',
      },
    ],
  };
}

describe('notification worker', () => {
  beforeEach(() => {
    process.env.TABLE_NAME = 'stay-test';
    process.env.SES_FROM_EMAIL = 'updates@saystay.site';
    process.env.SES_RECIPIENT_EMAIL = 'verified@example.com';
    mocks.sesSend.mockReset();
    mocks.tableSend.mockReset();
  });

  it('sends minimal authenticated-domain copy and records the delivery', async () => {
    mocks.tableSend.mockResolvedValue({});
    mocks.sesSend.mockResolvedValue({ MessageId: 'ses-message' });

    await expect(handler(sqsEvent())).resolves.toEqual({ batchItemFailures: [] });

    expect(mocks.sesSend).toHaveBeenCalledOnce();
    const command = mocks.sesSend.mock.calls[0]![0] as { input: Record<string, unknown> };
    const serialized = JSON.stringify(command.input);
    expect(command.input).toMatchObject({
      FromEmailAddress: 'STAY <updates@saystay.site>',
      Destination: { ToAddresses: ['verified@example.com'] },
    });
    expect(serialized).toContain('Sign in to STAY to view authorized details.');
    expect(serialized).not.toContain('never include this');
    expect(serialized).not.toContain('accessInstructions');
    expect(mocks.tableSend).toHaveBeenCalledTimes(2);
  });

  it('suppresses a duplicate delivery before contacting SES', async () => {
    const duplicate = new Error('duplicate');
    duplicate.name = 'ConditionalCheckFailedException';
    mocks.tableSend.mockRejectedValueOnce(duplicate);

    await expect(handler(sqsEvent('duplicate'))).resolves.toEqual({ batchItemFailures: [] });
    expect(mocks.sesSend).not.toHaveBeenCalled();
    expect(mocks.tableSend).toHaveBeenCalledOnce();
  });

  it('releases the delivery marker and returns a partial failure when SES rejects email', async () => {
    mocks.tableSend.mockResolvedValue({});
    mocks.sesSend.mockRejectedValueOnce(new Error('SES sandbox rejection'));

    await expect(handler(sqsEvent('retry-email'))).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: 'retry-email' }],
    });
    expect(mocks.tableSend).toHaveBeenCalledTimes(2);
    const cleanup = mocks.tableSend.mock.calls[1]![0] as { input: Record<string, unknown> };
    expect(cleanup.input).toMatchObject({
      TableName: 'stay-test',
      Key: { PK: 'DELIVERY#domain-event-one', SK: 'SES#verified@example.com' },
    });
  });
});
