import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import {
  resolveRuntimeConfig,
  validateIdToken,
  validateIdTokenClaims,
  type StayRuntimeConfig,
} from './auth';

const config: StayRuntimeConfig = {
  apiUrl: 'https://saystay.site',
  fallbackUrl: 'https://abc123.execute-api.us-east-1.amazonaws.com',
  websocketUrl: 'wss://socket.execute-api.us-east-1.amazonaws.com/prod',
  cognitoBaseUrl: 'https://stay.auth.us-east-1.amazoncognito.com',
  publicClientId: 'public-client',
  redirectUri: 'https://saystay.site/auth/callback',
  logoutUri: 'https://saystay.site/',
};

describe('resolveRuntimeConfig', () => {
  it('keeps the canonical configuration on saystay.site', () => {
    expect(resolveRuntimeConfig(config, 'https://saystay.site')).toEqual(config);
  });

  it('uses same-origin API and auth callbacks on the exact fallback host', () => {
    expect(
      resolveRuntimeConfig(config, 'https://abc123.execute-api.us-east-1.amazonaws.com'),
    ).toEqual({
      ...config,
      apiUrl: 'https://abc123.execute-api.us-east-1.amazonaws.com',
      redirectUri: 'https://abc123.execute-api.us-east-1.amazonaws.com/auth/callback',
      logoutUri: 'https://abc123.execute-api.us-east-1.amazonaws.com/',
    });
  });

  it('does not trust an unrelated or malformed fallback origin', () => {
    expect(resolveRuntimeConfig(config, 'https://example.test')).toEqual(config);
    expect(
      resolveRuntimeConfig({ ...config, fallbackUrl: 'not a URL' }, 'https://example.test'),
    ).toEqual({
      ...config,
      fallbackUrl: 'not a URL',
    });
  });
});

describe('validateIdTokenClaims', () => {
  const expected = {
    nonce: 'expected-nonce',
    clientId: 'public-client',
    issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool',
    nowSeconds: 1_800_000_000,
  };
  const claims = {
    nonce: expected.nonce,
    aud: expected.clientId,
    iss: expected.issuer,
    token_use: 'id',
    exp: expected.nowSeconds + 300,
  };

  it('accepts the nonce-bound Cognito ID token claims', () => {
    expect(() => validateIdTokenClaims(claims, expected)).not.toThrow();
  });

  it.each([
    ['nonce', 'other'],
    ['aud', 'other-client'],
    ['iss', 'https://example.test'],
    ['token_use', 'access'],
    ['exp', expected.nowSeconds],
  ])('rejects an unexpected %s claim', (name, value) => {
    expect(() => validateIdTokenClaims({ ...claims, [name]: value }, expected)).toThrow(
      'Unexpected token claims',
    );
  });

  it('verifies a Cognito-style RS256 signature against the issuer key set', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const publicJwk = {
      ...(await exportJWK(publicKey)),
      alg: 'RS256',
      kid: 'test-key',
      use: 'sig',
    };
    const fetchKeys = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ keys: [publicJwk] }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchKeys);
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .sign(privateKey);

    await expect(validateIdToken(token, expected)).resolves.toBeUndefined();
    expect(fetchKeys).toHaveBeenCalledOnce();
    const [header, payload, signature = ''] = token.split('.');
    const tampered = `${header}.${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
    await expect(validateIdToken(tampered, expected)).rejects.toThrow('identity response');
    vi.unstubAllGlobals();
  });
});
