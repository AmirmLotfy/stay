import { describe, expect, it } from 'vitest';
import { resolveRuntimeConfig, type StayRuntimeConfig } from './auth';

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
