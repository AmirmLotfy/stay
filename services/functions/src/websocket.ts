import {
  ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { RoleSchema, type Role } from '@stay/contracts';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
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

interface AuthenticatedConnectionScope {
  subject: string;
  householdId: string;
  residentId: string;
  role: Role;
}

export function authenticatedConnectionScope(
  payload: Record<string, unknown>,
): AuthenticatedConnectionScope | null {
  const subject = typeof payload.sub === 'string' ? payload.sub : undefined;
  const householdId =
    typeof payload['custom:household_id'] === 'string' ? payload['custom:household_id'] : undefined;
  const residentId =
    typeof payload['custom:resident_id'] === 'string' ? payload['custom:resident_id'] : undefined;
  const role = RoleSchema.safeParse(payload['custom:stay_role']).data;
  const scopes = typeof payload.scope === 'string' ? payload.scope.split(/\s+/) : [];
  if (!subject || !householdId || !residentId || !role || !scopes.includes('stay/app')) return null;
  return { subject, householdId, residentId, role };
}

async function verifyAccessToken(token: string): Promise<AuthenticatedConnectionScope | null> {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_PUBLIC_CLIENT_ID;
  if (!userPoolId || !clientId)
    throw new Error('Cognito WebSocket verification is not configured.');
  const verifier = CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: 'access' });
  const payload = await verifier.verify(token);
  return authenticatedConnectionScope(payload);
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
    const authenticated =
      (
        event as APIGatewayProxyWebsocketEventV2 & {
          queryStringParameters?: Record<string, string | undefined> | null;
        }
      ).queryStringParameters?.mode === 'authenticated';
    if (authenticated) {
      await table.send(
        new PutCommand({
          TableName: tableName(),
          Item: {
            PK: `CONNECTION#${connectionId}`,
            SK: 'META',
            state: 'pending-authentication',
            connectionId,
            expiresAt: Math.floor(Date.now() / 1000) + 60,
          },
        }),
      );
      return { statusCode: 200, body: 'Authenticate after connecting.' };
    }
    if (!demoSession || !/^demo-[a-f0-9-]{20,}$/i.test(demoSession)) {
      return {
        statusCode: 401,
        body: 'A valid isolated demo session or authentication is required.',
      };
    }
    const session = await table.send(
      new GetCommand({
        TableName: tableName(),
        Key: { PK: `DEMO#${demoSession}`, SK: 'SESSION' },
        ConsistentRead: true,
      }),
    );
    if (!session.Item || Number(session.Item.expiresAt) <= Math.floor(Date.now() / 1000)) {
      return { statusCode: 401, body: 'The isolated demo session is invalid or expired.' };
    }
    const householdId = String(session.Item.householdId);
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
  } else {
    const body = (() => {
      try {
        return JSON.parse(event.body ?? '{}') as { action?: string; accessToken?: string };
      } catch {
        return {};
      }
    })();
    if (body.action !== 'authenticate' || !body.accessToken) {
      return { statusCode: 400, body: 'Authenticate this connection first.' };
    }
    const scope = await verifyAccessToken(body.accessToken).catch(() => null);
    if (!scope) return { statusCode: 401, body: 'The access token is invalid.' };
    await table.send(
      new PutCommand({
        TableName: tableName(),
        Item: {
          PK: `CONNECTION#${connectionId}`,
          SK: 'META',
          GSI1PK: `HOUSEHOLD#${scope.householdId}#CONNECTIONS`,
          GSI1SK: `CONNECTION#${connectionId}`,
          ...scope,
          state: 'authenticated',
          connectionId,
          expiresAt: Math.floor(Date.now() / 1000) + 3_600,
        },
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
    body: JSON.stringify({ authenticated: route === '$default', reconciliation: '/v1/incidents' }),
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
