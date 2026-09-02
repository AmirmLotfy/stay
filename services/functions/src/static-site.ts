import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { log } from './logging.js';

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? 'us-east-1',
  maxAttempts: 3,
  retryMode: 'adaptive',
});

const contentTypes: Readonly<Record<string, string>> = {
  css: 'text/css; charset=utf-8',
  html: 'text/html; charset=utf-8',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

export interface WebsiteKey {
  readonly key: string;
  readonly spaFallback: boolean;
}

export function resolveWebsiteKey(rawPath: string): WebsiteKey | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }

  if (decoded.includes('\\') || decoded.includes('\0') || /%[0-9a-f]{2}/i.test(decoded)) {
    return null;
  }

  const segments = decoded.replace(/^\/+/, '').split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) return null;

  const key = segments.join('/') || 'index.html';
  const lastSegment = segments.at(-1) ?? '';
  return { key, spaFallback: key !== 'index.html' && !lastSegment.includes('.') };
}

export function contentTypeFor(key: string): string {
  const extension = key.split('.').at(-1)?.toLowerCase() ?? '';
  return contentTypes[extension] ?? 'application/octet-stream';
}

export function cacheControlFor(key: string): string {
  if (key === 'index.html' || key === 'config.json') return 'no-store';
  if (key.startsWith('_next/static/')) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
}

function bucketName(): string {
  const value = process.env.WEBSITE_BUCKET;
  if (!value) throw new Error('WEBSITE_BUCKET is not configured.');
  return value;
}

function securityHeaders(contentType: string, cacheControl: string): Record<string, string> {
  const websocketOrigin = process.env.WEBSOCKET_ORIGIN;
  const connectSources = ["'self'", ...(websocketOrigin ? [websocketOrigin] : [])].join(' ');
  return {
    'content-type': contentType,
    'cache-control': cacheControl,
    'content-security-policy': [
      "default-src 'self'",
      "base-uri 'self'",
      `connect-src ${connectSources}`,
      "font-src 'self' data:",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "object-src 'none'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "worker-src 'self' blob:",
    ].join('; '),
    'permissions-policy': 'camera=(), geolocation=(), microphone=(self)',
    'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  };
}

function isMissingObject(error: unknown): boolean {
  return error instanceof Error && ['NoSuchKey', 'NotFound', 'NoSuchBucket'].includes(error.name);
}

async function readObject(key: string): Promise<Uint8Array> {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucketName(), Key: key }));
  if (!result.Body) throw new Error(`Website object ${key} had no body.`);
  return result.Body.transformToByteArray();
}

function response(
  statusCode: number,
  body: string,
  headers: Record<string, string>,
  isBase64Encoded = false,
): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers, body, isBase64Encoded };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const resolved = resolveWebsiteKey(event.rawPath);
  if (!resolved) {
    return response(400, 'Invalid path.', securityHeaders('text/plain; charset=utf-8', 'no-store'));
  }

  let key = resolved.key;
  let bytes: Uint8Array;
  try {
    bytes = await readObject(key);
  } catch (error) {
    if (resolved.spaFallback && isMissingObject(error)) {
      key = 'index.html';
      try {
        bytes = await readObject(key);
      } catch (fallbackError) {
        log('ERROR', 'static website fallback failed', {
          path: event.rawPath,
          error: fallbackError instanceof Error ? fallbackError.name : 'unknown',
        });
        return response(
          503,
          'The STAY demo is temporarily unavailable.',
          securityHeaders('text/plain; charset=utf-8', 'no-store'),
        );
      }
    } else if (isMissingObject(error)) {
      return response(404, 'Not found.', securityHeaders('text/plain; charset=utf-8', 'no-store'));
    } else {
      log('ERROR', 'static website read failed', {
        path: event.rawPath,
        error: error instanceof Error ? error.name : 'unknown',
      });
      return response(
        503,
        'The STAY demo is temporarily unavailable.',
        securityHeaders('text/plain; charset=utf-8', 'no-store'),
      );
    }
  }

  const headers = securityHeaders(contentTypeFor(key), cacheControlFor(key));
  if (event.requestContext.http.method === 'HEAD') return response(200, '', headers);
  return response(200, Buffer.from(bytes).toString('base64'), headers, true);
}
