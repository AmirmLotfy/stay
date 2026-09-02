import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: class GetObjectCommand {
    public constructor(public readonly input: { Bucket: string; Key: string }) {}
  },
  S3Client: class S3Client {
    public readonly send = sdk.send;
  },
}));

import { cacheControlFor, contentTypeFor, handler, resolveWebsiteKey } from './static-site.js';

function event(path: string, method = 'GET'): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: 'demo',
      apiId: 'demo',
      domainName: 'localhost',
      domainPrefix: 'local',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'request-static-site',
      routeKey: '$default',
      stage: '$default',
      time: '',
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  };
}

function body(value: string): { transformToByteArray: () => Promise<Uint8Array> } {
  return { transformToByteArray: async () => Buffer.from(value) };
}

describe('static website handler', () => {
  beforeEach(() => {
    sdk.send.mockReset();
    process.env.WEBSITE_BUCKET = 'private-stay-site';
    process.env.WEBSOCKET_ORIGIN = 'wss://updates.example.test/prod';
  });

  it('resolves root and safe SPA paths while rejecting traversal and double encoding', () => {
    expect(resolveWebsiteKey('/')).toEqual({ key: 'index.html', spaFallback: false });
    expect(resolveWebsiteKey('/circle')).toEqual({ key: 'circle', spaFallback: true });
    expect(resolveWebsiteKey('/_next/static/app.js')).toEqual({
      key: '_next/static/app.js',
      spaFallback: false,
    });
    expect(resolveWebsiteKey('/../secret')).toBeNull();
    expect(resolveWebsiteKey('/%252e%252e/secret')).toBeNull();
    expect(resolveWebsiteKey('/%E0%A4%A')).toBeNull();
  });

  it('applies explicit MIME and cache policies', () => {
    expect(contentTypeFor('manifest.webmanifest')).toBe('application/manifest+json; charset=utf-8');
    expect(contentTypeFor('icons/icon-192.png')).toBe('image/png');
    expect(cacheControlFor('config.json')).toBe('no-store');
    expect(cacheControlFor('_next/static/chunks/app.js')).toBe(
      'public, max-age=31536000, immutable',
    );
  });

  it('serves the root document as base64 with security headers', async () => {
    sdk.send.mockResolvedValueOnce({ Body: body('<!doctype html>STAY') });
    const result = await handler(event('/'));

    expect(sdk.send.mock.calls[0]?.[0].input).toEqual({
      Bucket: 'private-stay-site',
      Key: 'index.html',
    });
    expect(result).toMatchObject({
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
    expect(Buffer.from(String(result.body), 'base64').toString()).toBe('<!doctype html>STAY');
    expect(result.headers?.['content-security-policy']).toContain(
      'wss://updates.example.test/prod',
    );
  });

  it('falls back to index.html only for extension-free application routes', async () => {
    sdk.send
      .mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'NoSuchKey' }))
      .mockResolvedValueOnce({ Body: body('application shell') });

    const result = await handler(event('/privacy'));

    expect(sdk.send.mock.calls.map((call) => call[0].input.Key)).toEqual(['privacy', 'index.html']);
    expect(result.statusCode).toBe(200);
  });

  it('returns a safe 404 for a missing asset and never reads an invalid path', async () => {
    sdk.send.mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'NotFound' }));
    expect(await handler(event('/missing.js'))).toMatchObject({ statusCode: 404 });

    sdk.send.mockClear();
    expect(await handler(event('/../secret'))).toMatchObject({ statusCode: 400 });
    expect(sdk.send).not.toHaveBeenCalled();
  });

  it('returns headers without a response body for HEAD requests', async () => {
    sdk.send.mockResolvedValueOnce({ Body: body('asset') });
    const result = await handler(event('/icon.svg', 'HEAD'));
    expect(result).toMatchObject({ statusCode: 200, body: '', isBase64Encoded: false });
  });

  it('fails closed when the bucket is missing or S3 is unavailable', async () => {
    delete process.env.WEBSITE_BUCKET;
    expect(await handler(event('/'))).toMatchObject({ statusCode: 503 });

    process.env.WEBSITE_BUCKET = 'private-stay-site';
    sdk.send.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'AccessDenied' }));
    expect(await handler(event('/icon.svg'))).toMatchObject({ statusCode: 503 });
  });
});
