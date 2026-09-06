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
import { authenticatedConnectionScope, broadcastHandler, connectionHandler } from './websocket.js';

function socketEvent(
  routeKey: '$connect' | '$disconnect' | '$default',
  demoSession?: string,
  mode?: 'authenticated',
): APIGatewayProxyWebsocketEventV2 {
  return {
    requestContext: { routeKey, connectionId: 'connection-one' },
    queryStringParameters: demoSession ? { demoSession } : mode ? { mode } : undefined,
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
    detail: {
      householdId: 'demo-household-demo-1234567890abcdef1234',
      connectionIds: ['explicit-one'],
    },
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

  it('creates a short-lived pending record for an authenticated browser handshake', async () => {
    mocks.tableSend.mockResolvedValueOnce({});
    await expect(
      connectionHandler(socketEvent('$connect', undefined, 'authenticated')),
    ).resolves.toMatchObject({ statusCode: 200 });
    const write = mocks.tableSend.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(write.input).toMatchObject({
      Item: {
        PK: 'CONNECTION#connection-one',
        state: 'pending-authentication',
      },
    });
  });

  it('requires signed household, resident, role, and app-scope claims', () => {
    expect(
      authenticatedConnectionScope({
        sub: 'subject-sarah',
        scope: 'openid stay/app',
        'custom:household_id': 'household-sarah',
        'custom:resident_id': 'resident-sarah',
        'custom:stay_role': 'resident',
      }),
    ).toEqual({
      subject: 'subject-sarah',
      householdId: 'household-sarah',
      residentId: 'resident-sarah',
      role: 'resident',
    });
    expect(
      authenticatedConnectionScope({
        sub: 'subject-sarah',
        scope: 'openid stay/app',
        'custom:household_id': 'household-sarah',
        'custom:resident_id': 'resident-sarah',
        'custom:stay_role': 'administrator',
      }),
    ).toBeNull();
  });

  it('deduplicates explicit and stored recipients during broadcast', async () => {
    mocks.tableSend.mockResolvedValueOnce({
      Items: [{ connectionId: 'explicit-one' }, { connectionId: 'stored-two' }],
    });
    mocks.tableSend.mockResolvedValue({
      Item: {
        householdId: 'demo-household-demo-1234567890abcdef1234',
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      },
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
    mocks.tableSend.mockResolvedValue({
      Item: {
        householdId: 'demo-household-demo-1234567890abcdef1234',
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      },
    });
    mocks.managementSend.mockRejectedValueOnce(
      new GoneException({ message: 'Connection is gone.', $metadata: {} }),
    );
    const event = domainEvent();
    event.detail.connectionIds = [];

    await expect(broadcastHandler(event)).resolves.toBeUndefined();

    expect(mocks.tableSend).toHaveBeenCalledTimes(4);
    const cleanup = mocks.tableSend.mock.calls[3]![0] as { input: Record<string, unknown> };
    expect(cleanup.input).toMatchObject({
      Key: { PK: 'CONNECTION#stored-gone', SK: 'META' },
    });
  });

  it('removes a revoked authenticated connection before sending an event', async () => {
    mocks.tableSend
      .mockResolvedValueOnce({ Items: [{ connectionId: 'revoked-one' }] })
      .mockResolvedValueOnce({
        Item: {
          householdId: 'demo-household-demo-1234567890abcdef1234',
          subject: 'subject-revoked',
          residentId: 'resident-revoked',
          role: 'resident',
          state: 'authenticated',
          expiresAt: Math.floor(Date.now() / 1000) + 60,
        },
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const event = domainEvent();
    event.detail.connectionIds = [];

    await expect(broadcastHandler(event)).resolves.toBeUndefined();

    expect(mocks.managementSend).not.toHaveBeenCalled();
    const cleanup = mocks.tableSend.mock.calls[4]![0] as { input: Record<string, unknown> };
    expect(cleanup.input).toMatchObject({
      Key: { PK: 'CONNECTION#revoked-one', SK: 'META' },
    });
  });

  it('does not deliver an event to a connection from another household', async () => {
    mocks.tableSend.mockResolvedValueOnce({ Items: [] }).mockResolvedValueOnce({
      Item: {
        householdId: 'house-other',
        subject: 'subject-other',
        residentId: 'resident-other',
        role: 'resident',
        state: 'authenticated',
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      },
    });
    const event = domainEvent();
    event.detail.connectionIds = ['other-household-connection'];

    await expect(broadcastHandler(event)).resolves.toBeUndefined();

    expect(mocks.managementSend).not.toHaveBeenCalled();
    expect(mocks.tableSend).toHaveBeenCalledTimes(2);
  });
});
