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
});
