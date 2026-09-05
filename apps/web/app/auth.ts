import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface StayRuntimeConfig {
  environment?: 'demo' | 'pilot';
  apiUrl: string;
  fallbackUrl?: string;
  websocketUrl: string;
  cognitoBaseUrl: string;
  cognitoIssuerUrl?: string;
  publicClientId: string;
  redirectUri: string;
  logoutUri: string;
}

export function resolveRuntimeConfig(
  config: StayRuntimeConfig,
  currentOrigin: string,
): StayRuntimeConfig {
  if (!config.fallbackUrl) return config;
  let fallbackOrigin: string;
  try {
    fallbackOrigin = new URL(config.fallbackUrl).origin;
  } catch {
    return config;
  }
  if (currentOrigin !== fallbackOrigin) return config;
  return {
    ...config,
    apiUrl: fallbackOrigin,
    redirectUri: `${fallbackOrigin}/auth/callback`,
    logoutUri: `${fallbackOrigin}/`,
  };
}

interface TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: 'Bearer';
}

export interface AuthenticatedSessionRecord {
  mode: 'authenticated';
  accessToken: string;
  expiresAt: number;
}

const configKey = 'stay.runtime-config';
const tokensKey = 'stay.oauth-tokens';
const verifierKey = 'stay.pkce-verifier';
const stateKey = 'stay.oauth-state';
const nonceKey = 'stay.oauth-nonce';
const issuerKeys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function randomValue(length = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(length)));
}

async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export async function loadRuntimeConfig(): Promise<StayRuntimeConfig | null> {
  const cached = sessionStorage.getItem(configKey);
  if (cached) return JSON.parse(cached) as StayRuntimeConfig;
  const response = await fetch('/config.json', { cache: 'no-store' });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
    return null;
  const config = resolveRuntimeConfig(
    (await response.json()) as StayRuntimeConfig,
    window.location.origin,
  );
  sessionStorage.setItem(configKey, JSON.stringify(config));
  return config;
}

export async function beginSignIn(config: StayRuntimeConfig): Promise<void> {
  const verifier = randomValue(64);
  const state = randomValue();
  const nonce = randomValue();
  sessionStorage.setItem(verifierKey, verifier);
  sessionStorage.setItem(stateKey, state);
  sessionStorage.setItem(nonceKey, nonce);
  const url = new URL('/oauth2/authorize', config.cognitoBaseUrl);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.publicClientId,
    redirect_uri: config.redirectUri,
    scope: 'openid email stay/app',
    code_challenge_method: 'S256',
    code_challenge: await challenge(verifier),
    state,
    nonce,
  }).toString();
  window.location.assign(url);
}

export async function completeSignIn(config: StayRuntimeConfig): Promise<boolean> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  if (!code) return Boolean(sessionStorage.getItem(tokensKey));
  const verifier = sessionStorage.getItem(verifierKey);
  const expectedState = sessionStorage.getItem(stateKey);
  const expectedNonce = sessionStorage.getItem(nonceKey);
  if (!verifier || !expectedState || !expectedNonce || returnedState !== expectedState) {
    throw new Error('The sign-in response could not be verified. Please start again.');
  }
  sessionStorage.removeItem(verifierKey);
  sessionStorage.removeItem(stateKey);
  sessionStorage.removeItem(nonceKey);
  const response = await fetch(new URL('/oauth2/token', config.cognitoBaseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.publicClientId,
      redirect_uri: config.redirectUri,
      code,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) throw new Error('Cognito did not complete sign-in.');
  const tokens = (await response.json()) as TokenResponse;
  if (!config.cognitoIssuerUrl)
    throw new Error('The identity response could not be verified. Please sign in again.');
  await validateIdToken(tokens.id_token, {
    nonce: expectedNonce,
    clientId: config.publicClientId,
    issuer: config.cognitoIssuerUrl,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  sessionStorage.setItem(
    tokensKey,
    JSON.stringify({ ...tokens, expires_at: Date.now() + tokens.expires_in * 1000 }),
  );
  window.history.replaceState({}, '', '/');
  return true;
}

interface ExpectedIdentity {
  nonce: string;
  clientId: string;
  issuer: string;
  nowSeconds: number;
}

export function validateIdTokenClaims(claims: JWTPayload, expected: ExpectedIdentity): void {
  if (
    claims.nonce !== expected.nonce ||
    claims.aud !== expected.clientId ||
    claims.iss !== expected.issuer ||
    claims.token_use !== 'id' ||
    typeof claims.exp !== 'number' ||
    claims.exp <= expected.nowSeconds
  )
    throw new Error('Unexpected token claims.');
}

export async function validateIdToken(token: string, expected: ExpectedIdentity): Promise<void> {
  try {
    const issuerUrl = new URL(expected.issuer);
    if (issuerUrl.protocol !== 'https:') throw new Error('Unexpected issuer protocol.');
    let keys = issuerKeys.get(expected.issuer);
    if (!keys) {
      keys = createRemoteJWKSet(
        new URL(`${expected.issuer.replace(/\/$/, '')}/.well-known/jwks.json`),
      );
      issuerKeys.set(expected.issuer, keys);
    }
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ['RS256'],
      issuer: expected.issuer,
      audience: expected.clientId,
      currentDate: new Date(expected.nowSeconds * 1000),
    });
    validateIdTokenClaims(payload, expected);
  } catch {
    throw new Error('The identity response could not be verified. Please sign in again.');
  }
}

export async function signOut(config: StayRuntimeConfig): Promise<void> {
  const raw = sessionStorage.getItem(tokensKey);
  if (raw) {
    const tokens = JSON.parse(raw) as TokenResponse;
    if (tokens.refresh_token) {
      await fetch(new URL('/oauth2/revoke', config.cognitoBaseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: tokens.refresh_token,
          client_id: config.publicClientId,
        }),
      }).catch(() => undefined);
    }
  }
  sessionStorage.removeItem(tokensKey);
  const url = new URL('/logout', config.cognitoBaseUrl);
  url.search = new URLSearchParams({
    client_id: config.publicClientId,
    logout_uri: config.logoutUri,
  }).toString();
  window.location.assign(url);
}

export function hasAuthenticationIntent(): boolean {
  return Boolean(
    sessionStorage.getItem(tokensKey) || new URL(window.location.href).searchParams.get('code'),
  );
}

export function hasAuthenticatedSession(): boolean {
  const raw = sessionStorage.getItem(tokensKey);
  if (!raw) return false;
  const tokens = JSON.parse(raw) as TokenResponse & { expires_at?: number };
  return Boolean(tokens.access_token && (tokens.expires_at ?? 0) > Date.now() + 30_000);
}

export async function getAuthenticatedSession(
  config: StayRuntimeConfig,
): Promise<AuthenticatedSessionRecord | null> {
  const raw = sessionStorage.getItem(tokensKey);
  if (!raw) return null;
  let tokens: TokenResponse & { expires_at?: number };
  try {
    tokens = JSON.parse(raw) as TokenResponse & { expires_at?: number };
  } catch {
    sessionStorage.removeItem(tokensKey);
    return null;
  }
  const expiresAt = tokens.expires_at ?? 0;
  if (tokens.access_token && expiresAt > Date.now() + 60_000) {
    return { mode: 'authenticated', accessToken: tokens.access_token, expiresAt };
  }
  if (!tokens.refresh_token) {
    sessionStorage.removeItem(tokensKey);
    return null;
  }
  const response = await fetch(new URL('/oauth2/token', config.cognitoBaseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.publicClientId,
      refresh_token: tokens.refresh_token,
    }),
  });
  if (!response.ok) {
    sessionStorage.removeItem(tokensKey);
    return null;
  }
  const refreshed = (await response.json()) as TokenResponse;
  const next = {
    ...tokens,
    ...refreshed,
    refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
    expires_at: Date.now() + refreshed.expires_in * 1000,
  };
  sessionStorage.setItem(tokensKey, JSON.stringify(next));
  return {
    mode: 'authenticated',
    accessToken: next.access_token,
    expiresAt: next.expires_at,
  };
}
