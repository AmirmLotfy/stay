import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { handler } from './handler.js';

function event(claims: Record<string, string>): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /mcp',
    rawPath: '/mcp',
    rawQueryString: '',
    headers: {
      authorization: 'Bearer signed-test-token',
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
    },
    requestContext: {
      accountId: 'test',
      apiId: 'test',
      authorizer: { jwt: { claims, scopes: ['stay/mcp'] } },
      domainName: 'localhost',
      domainPrefix: 'localhost',
      http: {
        method: 'POST',
        path: '/mcp',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'request-test',
      routeKey: 'POST /mcp',
      stage: '$default',
      time: '',
      timeEpoch: Date.now(),
    },
    body: '{}',
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

describe('MCP Lambda authorization', () => {
  it('rejects a scoped bearer token without signed household claims', async () => {
    const result = (await handler(event({ sub: 'resident-authenticated', exp: '4102444800' }))) as {
      statusCode: number;
      body?: string;
    };

    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body ?? '{}')).toEqual({ error: 'invalid_token' });
  });
});
