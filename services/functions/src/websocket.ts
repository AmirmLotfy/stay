import {
  ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  APIGatewayProxyResultV2,
  APIGatewayProxyWebsocketEventV2,
  EventBridgeEvent,
} from 'aws-lambda';
import { log } from './logging.js';

const table = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    maxAttempts: 3,
    retryMode: 'adaptive',
  }),
  { marshallOptions: { removeUndefinedValues: true } },
);

type StayEventDetail = {
  householdId?: string;
  connectionIds?: string[];
  [key: string]: unknown;
};

function tableName(): string {
  if (!process.env.TABLE_NAME) throw new Error('TABLE_NAME is not configured.');
  return process.env.TABLE_NAME;
}

export async function connectionHandler(
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> {
  const route = event.requestContext.routeKey;
  const connectionId = event.requestContext.connectionId;
  if (route === '$connect') {
    const demoSession = (
      event as APIGatewayProxyWebsocketEventV2 & {
        queryStringParameters?: Record<string, string | undefined> | null;
      }
    ).queryStringParameters?.demoSession;
    if (!demoSession || !/^demo-[a-f0-9-]{20,}$/i.test(demoSession)) {
      return { statusCode: 401, body: 'A valid isolated demo session is required.' };
    }
    const householdId = `demo-household-${demoSession}`;
    await table.send(
      new PutCommand({
        TableName: tableName(),
        Item: {
          PK: `CONNECTION#${connectionId}`,
          SK: 'META',
          GSI1PK: `HOUSEHOLD#${householdId}#CONNECTIONS`,
          GSI1SK: `CONNECTION#${connectionId}`,
          householdId,
          connectionId,
          expiresAt: Math.floor(Date.now() / 1000) + 14_400,
        },
      }),
    );
  } else if (route === '$disconnect') {
    await table.send(
      new DeleteCommand({
        TableName: tableName(),
        Key: { PK: `CONNECTION#${connectionId}`, SK: 'META' },
      }),
    );
  }
  log('INFO', 'websocket lifecycle', {
    route,
    connectionId,
    ttlSeconds: route === '$connect' ? 14_400 : undefined,
  });
  return {
    statusCode: 200,
    body: JSON.stringify({ reconciliation: '/v1/incidents?sinceVersion=0' }),
  };
}

export async function broadcastHandler(
  event: EventBridgeEvent<string, StayEventDetail>,
): Promise<void> {
  if (!process.env.WEBSOCKET_CALLBACK_URL)
    throw new Error('WEBSOCKET_CALLBACK_URL is not configured.');
  const client = new ApiGatewayManagementApiClient({
    endpoint: process.env.WEBSOCKET_CALLBACK_URL,
    maxAttempts: 3,
    retryMode: 'adaptive',
  });
  const householdId = event.detail.householdId;
  if (!householdId) {
    log('WARN', 'websocket event omitted household scope', { eventId: event.id });
    return;
  }
  const stored = await table.send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :household',
      ExpressionAttributeValues: { ':household': `HOUSEHOLD#${householdId}#CONNECTIONS` },
      ProjectionExpression: 'connectionId',
    }),
  );
  const connectionIds = [
    ...new Set([
      ...(event.detail.connectionIds ?? []),
      ...(stored.Items ?? []).flatMap((item) =>
        typeof item.connectionId === 'string' ? [item.connectionId] : [],
      ),
    ]),
  ];
  const data = new TextEncoder().encode(
    JSON.stringify({ event: event['detail-type'], detail: event.detail, reconcile: true }),
  );
  for (const connectionId of connectionIds) {
    try {
      await client.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }));
    } catch (error) {
      if (error instanceof GoneException) {
        await table.send(
          new DeleteCommand({
            TableName: tableName(),
            Key: { PK: `CONNECTION#${connectionId}`, SK: 'META' },
          }),
        );
      }
      log('WARN', 'websocket delivery failed', {
        connectionId,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
}

export async function handler(
  event: APIGatewayProxyWebsocketEventV2 | EventBridgeEvent<string, StayEventDetail>,
): Promise<APIGatewayProxyResultV2 | void> {
  return 'requestContext' in event ? connectionHandler(event) : broadcastHandler(event);
}
