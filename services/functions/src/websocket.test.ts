import type { APIGatewayProxyWebsocketEventV2, EventBridgeEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  managementSend: vi.fn(),
  tableSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-apigatewaymanagementapi', () => {
  class GoneException extends Error {}
  return {
    ApiGatewayManagementApiClient: class {
      public send = mocks.managementSend;
    },
    GoneException,
    PostToConnectionCommand: class {
      public constructor(public readonly input: unknown) {}
    },
  };
});
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mocks.tableSend }) },
  GetCommand: class {
    public constructor(public readonly input: unknown) {}
  },
  PutCommand: class {
    public constructor(public readonly input: unknown) {}
  },
  DeleteCommand: class {
    public constructor(public readonly input: unknown) {}
  },
  QueryCommand: class {
    public constructor(public readonly input: unknown) {}
  },
}));

import { GoneException } from '@aws-sdk/client-apigatewaymanagementapi';
import { broadcastHandler, connectionHandler } from './websocket.js';

function socketEvent(
  routeKey: '$connect' | '$disconnect',
  demoSession?: string,
): APIGatewayProxyWebsocketEventV2 {
  return {
    requestContext: { routeKey, connectionId: 'connection-one' },
    queryStringParameters: demoSession ? { demoSession } : undefined,
  } as unknown as APIGatewayProxyWebsocketEventV2;
}

function domainEvent(): EventBridgeEvent<
  string,
  { householdId: string; connectionIds?: string[] }
> {
  return {
    id: 'event-one',
    version: '0',
    account: '111111111111',
    time: '2026-09-03T12:00:00.000Z',
    region: 'us-east-1',
    resources: [],
    source: 'stay.domain',
    'detail-type': 'Incident.ResponderAccepted',
    detail: { householdId: 'household-demo', connectionIds: ['explicit-one'] },
  };
}

describe('WebSocket lifecycle and fan-out', () => {
  beforeEach(() => {
    process.env.TABLE_NAME = 'stay-test';
    process.env.WEBSOCKET_CALLBACK_URL = 'https://socket.example.com/prod';
    mocks.managementSend.mockReset();
    mocks.tableSend.mockReset();
  });

  it('rejects an unscoped connection without writing state', async () => {
    await expect(connectionHandler(socketEvent('$connect'))).resolves.toMatchObject({
      statusCode: 401,
    });
    expect(mocks.tableSend).not.toHaveBeenCalled();
  });

  it('accepts only a live isolated demo session and stores a TTL connection', async () => {
    mocks.tableSend
      .mockResolvedValueOnce({
        Item: { householdId: 'household-demo', expiresAt: Math.floor(Date.now() / 1000) + 60 },
      })
      .mockResolvedValueOnce({});

    await expect(
      connectionHandler(socketEvent('$connect', 'demo-1234567890abcdef1234')),
    ).resolves.toMatchObject({ statusCode: 200 });

    expect(mocks.tableSend).toHaveBeenCalledTimes(2);
    const write = mocks.tableSend.mock.calls[1]![0] as { input: Record<string, unknown> };
    expect(write.input).toMatchObject({
      TableName: 'stay-test',
      Item: {
        PK: 'CONNECTION#connection-one',
        SK: 'META',
        GSI1PK: 'HOUSEHOLD#household-demo#CONNECTIONS',
        connectionId: 'connection-one',
      },
    });
  });

  it('deduplicates explicit and stored recipients during broadcast', async () => {
    mocks.tableSend.mockResolvedValueOnce({
      Items: [{ connectionId: 'explicit-one' }, { connectionId: 'stored-two' }],
    });
    mocks.managementSend.mockResolvedValue({});

    await expect(broadcastHandler(domainEvent())).resolves.toBeUndefined();

    expect(mocks.managementSend).toHaveBeenCalledTimes(2);
    expect(
      mocks.managementSend.mock.calls.map(
        ([command]) => (command as { input: { ConnectionId: string } }).input.ConnectionId,
      ),
    ).toEqual(['explicit-one', 'stored-two']);
  });

  it('removes a stale connection after API Gateway reports it gone', async () => {
    mocks.tableSend.mockResolvedValueOnce({ Items: [{ connectionId: 'stored-gone' }] });
    mocks.managementSend.mockRejectedValueOnce(
      new GoneException({ message: 'Connection is gone.', $metadata: {} }),
    );
    const event = domainEvent();
    event.detail.connectionIds = [];

    await expect(broadcastHandler(event)).resolves.toBeUndefined();

    expect(mocks.tableSend).toHaveBeenCalledTimes(2);
    const cleanup = mocks.tableSend.mock.calls[1]![0] as { input: Record<string, unknown> };
    expect(cleanup.input).toMatchObject({
      Key: { PK: 'CONNECTION#stored-gone', SK: 'META' },
    });
  });
});
