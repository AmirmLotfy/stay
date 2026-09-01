export interface StayRuntimeConfig {
  apiUrl: string;
  websocketUrl: string;
  cognitoBaseUrl: string;
  publicClientId: string;
  redirectUri: string;
  logoutUri: string;
}

interface TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: 'Bearer';
}

const configKey = 'stay.runtime-config';
const tokensKey = 'stay.oauth-tokens';
const verifierKey = 'stay.pkce-verifier';
const stateKey = 'stay.oauth-state';

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
  const config = (await response.json()) as StayRuntimeConfig;
  sessionStorage.setItem(configKey, JSON.stringify(config));
  return config;
}

export async function beginSignIn(config: StayRuntimeConfig): Promise<void> {
  const verifier = randomValue(64);
  const state = randomValue();
  sessionStorage.setItem(verifierKey, verifier);
  sessionStorage.setItem(stateKey, state);
  const url = new URL('/oauth2/authorize', config.cognitoBaseUrl);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.publicClientId,
    redirect_uri: config.redirectUri,
    scope: 'openid email stay/app',
    code_challenge_method: 'S256',
    code_challenge: await challenge(verifier),
    state,
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
  if (!verifier || !expectedState || returnedState !== expectedState) {
    throw new Error('The sign-in response could not be verified. Please start again.');
  }
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
  sessionStorage.setItem(
    tokensKey,
    JSON.stringify({ ...tokens, expires_at: Date.now() + tokens.expires_in * 1000 }),
  );
  sessionStorage.removeItem(verifierKey);
  sessionStorage.removeItem(stateKey);
  window.history.replaceState({}, '', '/');
  return true;
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

export function hasAuthenticatedSession(): boolean {
  const raw = sessionStorage.getItem(tokensKey);
  if (!raw) return false;
  const tokens = JSON.parse(raw) as TokenResponse & { expires_at?: number };
  return Boolean(tokens.access_token && (tokens.expires_at ?? 0) > Date.now() + 30_000);
}
