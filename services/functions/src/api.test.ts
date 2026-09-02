import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { handler } from './api.js';

function event(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers,
    requestContext: {
      accountId: 'demo',
      apiId: 'demo',
      domainName: 'localhost',
      domainPrefix: 'local',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: crypto.randomUUID(),
      routeKey: '$default',
      stage: '$default',
      time: '',
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

describe('REST API contract', () => {
  it('creates an isolated TTL-scoped demo session without auth', async () => {
    const result = (await handler(event('/v1/demo-sessions', 'POST'))) as {
      statusCode: number;
      body: string;
    };
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body)).toMatchObject({ mode: 'isolated-demo' });
  });

  it('requires an idempotency key for writes', async () => {
    const result = (await handler(
      event(
        '/v1/demo/help-requests',
        'POST',
        { action: 'create' },
        { 'x-stay-demo-session': 'test' },
      ),
    )) as { statusCode: number; body: string };
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).code).toBe('IDEMPOTENCY_REQUIRED');
  });

  it('executes resident check-in and ordinary help acceptance through versioned routes', async () => {
    const task = (await handler(
      event(
        '/v1/demo/tasks',
        'POST',
        { action: 'complete', entityId: 'task-one-thing', expectedVersion: 1 },
        { 'x-stay-demo-session': 'test-task', 'idempotency-key': 'api-complete-task' },
      ),
    )) as { statusCode: number; body: string };
    expect(task.statusCode).toBe(200);
    expect(JSON.parse(task.body).entity.state).toBe('completed');

    const checkIn = (await handler(
      event(
        '/v1/demo/safety-windows',
        'POST',
        { action: 'check-in', entityId: 'window-morning', expectedVersion: 1 },
        {
          'x-stay-demo-session': 'test-check-in',
          'idempotency-key': 'api-check-in-window',
        },
      ),
    )) as { statusCode: number; body: string };
    expect(checkIn.statusCode).toBe(200);
    expect(JSON.parse(checkIn.body).entity.state).toBe('checked-in');

    const accept = (await handler(
      event(
        '/v1/demo/help-requests',
        'POST',
        {
          action: 'accept',
          entityId: 'help-groceries',
          memberId: 'member-tom',
          expectedVersion: 1,
        },
        {
          'x-stay-demo-session': 'test-help',
          'idempotency-key': 'api-accept-help',
        },
      ),
    )) as { statusCode: number; body: string };
    expect(accept.statusCode).toBe(200);
    expect(JSON.parse(accept.body).entity).toMatchObject({
      state: 'assigned',
      assignedTo: 'member-tom',
    });
  });
});
