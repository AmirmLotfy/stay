import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { handler } from './handler.js';

function event(
  claims: Record<string, string>,
  rawPath = '/mcp',
  method = 'POST',
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${method} ${rawPath}`,
    rawPath,
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
        method,
        path: rawPath,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'request-test',
      routeKey: `${method} ${rawPath}`,
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

  it('advertises the Cognito issuer and Managed Login OAuth endpoints separately', async () => {
    const priorIssuer = process.env.COGNITO_ISSUER_URL;
    const priorAuthorizationBaseUrl = process.env.COGNITO_AUTHORIZATION_BASE_URL;
    process.env.COGNITO_ISSUER_URL =
      'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example';
    process.env.COGNITO_AUTHORIZATION_BASE_URL =
      'https://stay-demo.auth.us-east-1.amazoncognito.com';
    try {
      const result = (await handler(
        event({}, '/.well-known/oauth-authorization-server', 'GET'),
      )) as { statusCode: number; body?: string };
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body ?? '{}')).toMatchObject({
        issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example',
        authorization_endpoint:
          'https://stay-demo.auth.us-east-1.amazoncognito.com/oauth2/authorize',
        token_endpoint: 'https://stay-demo.auth.us-east-1.amazoncognito.com/oauth2/token',
      });
    } finally {
      if (priorIssuer === undefined) delete process.env.COGNITO_ISSUER_URL;
      else process.env.COGNITO_ISSUER_URL = priorIssuer;
      if (priorAuthorizationBaseUrl === undefined)
        delete process.env.COGNITO_AUTHORIZATION_BASE_URL;
      else process.env.COGNITO_AUTHORIZATION_BASE_URL = priorAuthorizationBaseUrl;
    }
  });
});
