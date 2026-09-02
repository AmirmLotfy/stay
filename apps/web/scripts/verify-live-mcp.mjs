import { createHash, randomBytes } from 'node:crypto';
import process from 'node:process';
import { URL, URLSearchParams } from 'node:url';
import { chromium } from '@playwright/test';

const fetch = globalThis.fetch;

const required = [
  'STAY_COGNITO_BASE_URL',
  'STAY_CLIENT_ID',
  'STAY_REDIRECT_URI',
  'STAY_USERNAME',
  'STAY_PASSWORD',
  'STAY_MCP_URL',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}

const cognitoBaseUrl = process.env.STAY_COGNITO_BASE_URL;
const clientId = process.env.STAY_CLIENT_ID;
const redirectUri = process.env.STAY_REDIRECT_URI;
const username = process.env.STAY_USERNAME;
const password = process.env.STAY_PASSWORD;
const mcpUrl = process.env.STAY_MCP_URL;
const browserPath = process.env.STAY_BROWSER_PATH;

const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const authorizeUrl = new URL('/oauth2/authorize', cognitoBaseUrl);
authorizeUrl.search = new URLSearchParams({
  response_type: 'code',
  client_id: clientId,
  redirect_uri: redirectUri,
  scope: 'openid email stay/mcp',
  code_challenge: challenge,
  code_challenge_method: 'S256',
}).toString();

const browser = await chromium.launch({
  headless: true,
  ...(browserPath ? { executablePath: browserPath } : {}),
});
try {
  const page = await browser.newPage();
  await page.goto(authorizeUrl.toString(), { waitUntil: 'domcontentloaded' });
  const usernameInput = page
    .locator('input[name="username"], input#signInFormUsername, input[type="email"]')
    .first();
  const passwordInput = page
    .locator('input[name="password"], input#signInFormPassword, input[type="password"]')
    .first();
  await usernameInput.fill(username);
  await passwordInput.fill(password);
  await page.locator('button[type="submit"], input[type="submit"]').first().click({
    noWaitAfter: true,
  });
  let callbackUrl;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (page.url().startsWith(redirectUri)) {
      callbackUrl = page.url();
      break;
    }
    await page.waitForTimeout(500);
  }
  const code = callbackUrl ? new URL(callbackUrl).searchParams.get('code') : null;
  if (!code) throw new Error('Cognito did not return an authorization code.');
  const tokenResponse = await fetch(new URL('/oauth2/token', cognitoBaseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok || typeof tokens.access_token !== 'string') {
    throw new Error(`Cognito token exchange failed with status ${tokenResponse.status}.`);
  }

  const mcpResponse = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${tokens.access_token}`,
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25',
      origin: new URL(redirectUri).origin,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'stay-live-verifier', version: '1.0.0' },
      },
    }),
  });
  const responseText = await mcpResponse.text();
  const jsonText = mcpResponse.headers.get('content-type')?.includes('text/event-stream')
    ? responseText
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice(6)
    : responseText;
  const payload = JSON.parse(jsonText ?? '{}');
  if (!mcpResponse.ok || payload.error) {
    throw new Error(`MCP initialization failed with status ${mcpResponse.status}.`);
  }
  if (
    payload.result?.protocolVersion !== '2025-11-25' ||
    payload.result?.serverInfo?.name !== 'STAY'
  ) {
    throw new Error('MCP initialization returned an unexpected server contract.');
  }
  process.stdout.write(
    `${JSON.stringify({
      oauthCodePkce: 'PASS',
      mcpStatus: mcpResponse.status,
      protocolVersion: payload.result.protocolVersion,
      serverName: payload.result.serverInfo.name,
    })}\n`,
  );
} finally {
  await browser.close();
}
