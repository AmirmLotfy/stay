import { createHash, createHmac, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { URL, URLSearchParams } from 'node:url';
import { chromium } from '@playwright/test';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const fetch = globalThis.fetch;
const WebSocket = globalThis.WebSocket;
const setTimeout = globalThis.setTimeout;
const clearTimeout = globalThis.clearTimeout;

const required = [
  'STAY_COGNITO_BASE_URL',
  'STAY_COGNITO_ISSUER_URL',
  'STAY_CLIENT_ID',
  'STAY_REDIRECT_URI',
  'STAY_API_URL',
  'STAY_WEBSOCKET_URL',
  'STAY_TEST_CREDENTIALS_FILE',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}

const config = {
  cognitoBaseUrl: process.env.STAY_COGNITO_BASE_URL,
  issuerUrl: process.env.STAY_COGNITO_ISSUER_URL,
  clientId: process.env.STAY_CLIENT_ID,
  redirectUri: process.env.STAY_REDIRECT_URI,
  apiUrl: process.env.STAY_API_URL.replace(/\/$/, ''),
  websocketUrl: process.env.STAY_WEBSOCKET_URL,
};
const credentials = JSON.parse(readFileSync(process.env.STAY_TEST_CREDENTIALS_FILE, 'utf8'));
const users = ['a', 'b'].map((slot) => ({ slot, ...credentials.users?.[slot] }));
for (const user of users) {
  for (const field of ['email', 'password', 'totpSecret', 'householdId']) {
    if (!user[field]) throw new Error(`Test identity ${user.slot} is missing ${field}.`);
  }
}

function currentTotp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of secret.replace(/\s+/g, '').toUpperCase()) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error('A test TOTP secret is not valid base32.');
    bits += value.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g)?.map((byte) => Number.parseInt(byte, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest.at(-1) & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function authenticate(browser, user) {
  const verifier = randomBytes(48).toString('base64url');
  const state = randomBytes(24).toString('base64url');
  const nonce = randomBytes(24).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorizeUrl = new URL('/oauth2/authorize', config.cognitoBaseUrl);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    state,
    nonce,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid email stay/app stay/mcp',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(authorizeUrl.toString(), { waitUntil: 'domcontentloaded' });
    await page
      .locator('input[name="username"], input#signInFormUsername, input[type="email"]')
      .first()
      .fill(user.email);
    await page
      .locator('input[name="password"], input#signInFormPassword, input[type="password"]')
      .first()
      .fill(user.password);
    await page.locator('button[type="submit"], input[type="submit"]').first().click({
      noWaitAfter: true,
    });
    let submittedMfa = false;
    let callbackUrl;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (page.url().startsWith(config.redirectUri)) {
        callbackUrl = page.url();
        break;
      }
      if (!submittedMfa && page.url().includes('/mfa/totp')) {
        await page.locator('input:not([type="hidden"])').last().fill(currentTotp(user.totpSecret));
        await page.locator('button[type="submit"], input[type="submit"]').first().click({
          noWaitAfter: true,
        });
        submittedMfa = true;
      }
      await page.waitForTimeout(500);
    }
    if (!callbackUrl) throw new Error(`Identity ${user.slot} did not complete OAuth.`);
    const callback = new URL(callbackUrl);
    if (callback.searchParams.get('state') !== state) throw new Error('OAuth state mismatch.');
    const tokenResponse = await fetch(new URL('/oauth2/token', config.cognitoBaseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        code: callback.searchParams.get('code'),
        redirect_uri: config.redirectUri,
        code_verifier: verifier,
      }),
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token || !tokens.id_token)
      throw new Error(`Identity ${user.slot} token exchange failed.`);
    const keys = createRemoteJWKSet(new URL(`${config.issuerUrl}/.well-known/jwks.json`));
    const { payload: idClaims } = await jwtVerify(tokens.id_token, keys, {
      algorithms: ['RS256'],
      issuer: config.issuerUrl,
      audience: config.clientId,
    });
    const { payload: accessClaims } = await jwtVerify(tokens.access_token, keys, {
      algorithms: ['RS256'],
      issuer: config.issuerUrl,
    });
    if (
      idClaims.nonce !== nonce ||
      accessClaims.token_use !== 'access' ||
      accessClaims.client_id !== config.clientId ||
      accessClaims['custom:household_id'] !== user.householdId
    )
      throw new Error(`Identity ${user.slot} token scope is invalid.`);
    return { ...user, accessToken: tokens.access_token };
  } finally {
    await context.close();
  }
}

async function api(user, path, init = {}) {
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${user.accessToken}`, ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}.`);
  return body;
}

async function connect(user) {
  const url = new URL(config.websocketUrl);
  url.searchParams.set('mode', 'authenticated');
  const socket = new WebSocket(url);
  const events = [];
  await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (socket.readyState === WebSocket.OPEN) resolve();
      else reject(new Error('WebSocket authentication timed out.'));
    }, 2_000);
    socket.addEventListener('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error('WebSocket connection failed.'));
    });
    socket.addEventListener('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error('WebSocket closed during authentication.'));
    });
    socket.addEventListener('open', () =>
      socket.send(JSON.stringify({ action: 'authenticate', accessToken: user.accessToken })),
    );
    socket.addEventListener('message', (message) => {
      const value = JSON.parse(String(message.data));
      if (!settled && value.authenticated === true) {
        settled = true;
        clearTimeout(timeout);
        resolve();
      } else events.push(value);
    });
  });
  return { socket, events };
}

const browser = await chromium.launch({ headless: true });
let connections = [];
try {
  const authenticated = [];
  for (const user of users) authenticated.push(await authenticate(browser, user));
  if (authenticated[0].householdId === authenticated[1].householdId)
    throw new Error('The test identities do not represent different households.');

  const before = [];
  for (const user of authenticated) {
    const [session, home, help] = await Promise.all([
      api(user, '/v1/session'),
      api(user, '/v1/home'),
      api(user, '/v1/help-requests'),
    ]);
    if (home.data?.householdId !== user.householdId)
      throw new Error(`Identity ${user.slot} loaded the wrong household.`);
    const serialized = JSON.stringify({ session, home, help });
    if (
      /Sarah|Tom|Bennett|Alvarez/.test(serialized) ||
      serialized.includes(
        authenticated.find((candidate) => candidate.slot !== user.slot).householdId,
      )
    )
      throw new Error(`Identity ${user.slot} received fixture or cross-household data.`);
    before.push({ user, helpCount: help.data?.length ?? 0 });
  }

  connections = await Promise.all(authenticated.map(connect));
  const marker = `pilot-isolation-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const created = await api(authenticated[0], '/v1/help-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': marker },
    body: JSON.stringify({
      action: 'create',
      title: 'Pilot isolation check',
      detail: 'Synthetic test. No action is required.',
      urgency: 'normal',
    }),
  });
  const createdId = created.entity?.id;
  if (!createdId) throw new Error('The pilot write did not return an entity.');

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && connections[0].events.length === 0)
    await new Promise((resolve) => setTimeout(resolve, 250));
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  if (connections[0].events.length === 0)
    throw new Error('Household A received no WebSocket hint.');
  if (connections[1].events.length !== 0)
    throw new Error('Household B received household A’s event.');

  const afterA = await api(authenticated[0], '/v1/help-requests');
  const afterB = await api(authenticated[1], '/v1/help-requests');
  if (!afterA.data?.some((item) => item.id === createdId))
    throw new Error('Household A cannot read its new request.');
  if (afterB.data?.some((item) => item.id === createdId))
    throw new Error('Household B can read household A’s request.');
  if ((afterB.data?.length ?? 0) !== before[1].helpCount)
    throw new Error('Household B changed during household A’s write.');

  process.stdout.write(
    `${JSON.stringify({
      oauthAndMfa: 'PASS',
      households: 2,
      distinctTokenScopes: 'PASS',
      restIsolation: 'PASS',
      websocketIsolation: 'PASS',
      fixtureIsolation: 'PASS',
      householdAEvent: 'RECEIVED',
      householdBEvent: 'SUPPRESSED',
      notificationCandidateCreated: true,
    })}\n`,
  );
} finally {
  for (const connection of connections) connection.socket.close();
  await browser.close();
}
