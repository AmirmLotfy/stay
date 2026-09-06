import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { RoleSchema } from '@stay/contracts';
import { fetchMcp } from './server.js';
import { DynamoStayRepository } from '@stay/persistence';

function metadata(event: APIGatewayProxyEventV2): APIGatewayProxyResultV2 | null {
  if (!event.rawPath.startsWith('/.well-known/')) return null;
  const resource = process.env.MCP_RESOURCE_URL ?? `https://${event.requestContext.domainName}/mcp`;
  const issuer = process.env.COGNITO_ISSUER_URL;
  if (!issuer) return { statusCode: 503, body: JSON.stringify({ error: 'oauth_not_configured' }) };
  if (event.rawPath.includes('oauth-protected-resource')) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resource,
        authorization_servers: [issuer],
        scopes_supported: ['stay/mcp'],
        bearer_methods_supported: ['header'],
        resource_name: 'STAY Alexa+ MCP server',
      }),
    };
  }
  const authorizationBaseUrl = process.env.COGNITO_AUTHORIZATION_BASE_URL;
  if (!authorizationBaseUrl)
    return { statusCode: 503, body: JSON.stringify({ error: 'oauth_not_configured' }) };
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      issuer,
      authorization_endpoint: `${authorizationBaseUrl}/oauth2/authorize`,
      token_endpoint: `${authorizationBaseUrl}/oauth2/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['openid', 'stay/mcp'],
    }),
  };
}

function auth(event: APIGatewayProxyEventV2): AuthInfo | null {
  const authorized = event.requestContext as typeof event.requestContext & {
    authorizer?: {
      jwt?: { claims?: Record<string, string | number | boolean | string[]>; scopes?: string[] };
    };
  };
  const claims = authorized.authorizer?.jwt?.claims;
  const scopes = authorized.authorizer?.jwt?.scopes ?? [];
  const header = event.headers.authorization;
  if (process.env.MCP_ALLOW_LOCAL_DEMO === '1') {
    return {
      token: header?.replace(/^Bearer\s+/i, '') ?? 'local-demo',
      clientId: 'local-demo',
      scopes: ['stay/mcp'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      extra: {
        subject: 'resident-sarah',
        householdId: 'demo-household-sarah',
        residentId: 'resident-sarah',
        role: 'resident',
      },
    };
  }
  const householdId = claims?.['custom:household_id']?.toString();
  const residentId = claims?.['custom:resident_id']?.toString();
  const role = RoleSchema.safeParse(claims?.['custom:stay_role']).data;
  const circleMemberId = claims?.['custom:circle_member_id']?.toString();
  if (
    !header ||
    !claims?.sub ||
    !householdId ||
    !residentId ||
    !role ||
    !scopes.includes('stay/mcp')
  )
    return null;
  return {
    token: header.replace(/^Bearer\s+/i, ''),
    clientId: claims.client_id?.toString() ?? 'unknown',
    scopes,
    expiresAt: Number(claims.exp),
    extra: {
      subject: claims.sub,
      householdId,
      residentId,
      role,
      ...(circleMemberId ? { circleMemberId } : {}),
    },
  };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const metadataResult = metadata(event);
  if (metadataResult) return metadataResult;
  const authInfo = auth(event);
  if (!authInfo) {
    return {
      statusCode: 401,
      headers: {
        'content-type': 'application/json',
        'www-authenticate': `Bearer resource_metadata="${process.env.MCP_RESOURCE_URL ?? '/.well-known/oauth-protected-resource/mcp'}"`,
      },
      body: JSON.stringify({ error: 'invalid_token' }),
    };
  }
  if (process.env.TABLE_NAME) {
    try {
      await new DynamoStayRepository(process.env.TABLE_NAME).authorize({
        subject: String(authInfo.extra?.subject),
        householdId: String(authInfo.extra?.householdId),
        residentId: String(authInfo.extra?.residentId),
        role: RoleSchema.parse(authInfo.extra?.role),
        ...(authInfo.extra?.circleMemberId
          ? { circleMemberId: String(authInfo.extra.circleMemberId) }
          : {}),
      });
    } catch {
      return {
        statusCode: 403,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'membership_inactive' }),
      };
    }
  }
  const url = new URL(
    event.rawPath + (event.rawQueryString ? `?${event.rawQueryString}` : ''),
    `https://${event.requestContext.domainName}`,
  );
  const method = event.requestContext.http.method;
  const request = new Request(url, {
    method,
    headers: event.headers as HeadersInit,
    ...(!['GET', 'HEAD'].includes(method) && event.body ? { body: event.body } : {}),
  });
  const result = await fetchMcp(request, authInfo);
  return {
    statusCode: result.status,
    headers: Object.fromEntries(result.headers.entries()),
    body: await result.text(),
    isBase64Encoded: false,
  };
}
