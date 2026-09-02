import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { handler } from './api.js';

function event(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers,
    requestContext: {
      accountId: 'demo',
      apiId: 'demo',
      domainName: 'localhost',
      domainPrefix: 'local',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: crypto.randomUUID(),
      routeKey: '$default',
      stage: '$default',
      time: '',
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

describe('REST API contract', () => {
  it('fails closed when an authenticated token omits partition claims', async () => {
    const request = event('/v1/home');
    const context = request.requestContext as typeof request.requestContext & {
      authorizer?: { jwt: { claims: Record<string, string>; scopes: string[] } };
    };
    context.authorizer = {
      jwt: { claims: { sub: 'resident-authenticated' }, scopes: ['stay/app'] },
    };
    const result = (await handler(request)) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body)).toMatchObject({
      code: 'FORBIDDEN',
      message: 'The authenticated identity is missing its household partition claims.',
    });
  });

  it('creates an isolated TTL-scoped demo session without auth', async () => {
    const result = (await handler(event('/v1/demo-sessions', 'POST'))) as {
      statusCode: number;
      body: string;
    };
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body)).toMatchObject({ mode: 'isolated-demo' });
  });

  it('reports the optional AI feature gate without falling back silently', async () => {
    const priorModel = process.env.BEDROCK_MODEL_ID;
    delete process.env.BEDROCK_MODEL_ID;
    try {
      const result = (await handler(
        event(
          '/v1/demo/intent',
          'POST',
          {
            utterance: 'What is happening today?',
            currentSurface: 'home',
            visibleEntityIds: ['task-one-thing'],
            locale: 'en-US',
          },
          { 'x-stay-demo-session': 'test-intent' },
        ),
      )) as { statusCode: number; body: string };

      expect(result.statusCode).toBe(503);
      expect(JSON.parse(result.body)).toMatchObject({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'AI interpretation is unavailable. Deterministic controls remain available.',
      });
    } finally {
      if (priorModel === undefined) delete process.env.BEDROCK_MODEL_ID;
      else process.env.BEDROCK_MODEL_ID = priorModel;
    }
  });

  it('returns the emergency boundary without Bedrock', async () => {
    const priorModel = process.env.BEDROCK_MODEL_ID;
    delete process.env.BEDROCK_MODEL_ID;
    try {
      const result = (await handler(
        event(
          '/v1/demo/intent',
          'POST',
          {
            utterance: 'This is an emergency, get help',
            currentSurface: 'home',
            visibleEntityIds: ['task-one-thing'],
            locale: 'en-US',
          },
          { 'x-stay-demo-session': 'test-emergency-intent' },
        ),
      )) as { statusCode: number; body: string };

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toMatchObject({
        intent: {
          toolName: 'request_help',
          action: 'explain-emergency-boundary',
          explicitEmergencyLanguage: true,
        },
        provenance: { provider: 'STAY deterministic emergency-language guard' },
      });
    } finally {
      if (priorModel === undefined) delete process.env.BEDROCK_MODEL_ID;
      else process.env.BEDROCK_MODEL_ID = priorModel;
    }
  });

  it('requires an idempotency key for writes', async () => {
    const result = (await handler(
      event(
        '/v1/demo/help-requests',
        'POST',
        { action: 'create' },
        { 'x-stay-demo-session': 'test' },
      ),
    )) as { statusCode: number; body: string };
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).code).toBe('IDEMPOTENCY_REQUIRED');
  });

  it('executes resident check-in and ordinary help acceptance through versioned routes', async () => {
    const task = (await handler(
      event(
        '/v1/demo/tasks',
        'POST',
        { action: 'complete', entityId: 'task-one-thing', expectedVersion: 1 },
        { 'x-stay-demo-session': 'test-task', 'idempotency-key': 'api-complete-task' },
      ),
    )) as { statusCode: number; body: string };
    expect(task.statusCode).toBe(200);
    expect(JSON.parse(task.body).entity.state).toBe('completed');

    const checkIn = (await handler(
      event(
        '/v1/demo/safety-windows',
        'POST',
        { action: 'check-in', entityId: 'window-morning', expectedVersion: 1 },
        {
          'x-stay-demo-session': 'test-check-in',
          'idempotency-key': 'api-check-in-window',
        },
      ),
    )) as { statusCode: number; body: string };
    expect(checkIn.statusCode).toBe(200);
    expect(JSON.parse(checkIn.body).entity.state).toBe('checked-in');

    const accept = (await handler(
      event(
        '/v1/demo/help-requests',
        'POST',
        {
          action: 'accept',
          entityId: 'help-groceries',
          memberId: 'member-tom',
          expectedVersion: 1,
        },
        {
          'x-stay-demo-session': 'test-help',
          'idempotency-key': 'api-accept-help',
        },
      ),
    )) as { statusCode: number; body: string };
    expect(accept.statusCode).toBe(200);
    expect(JSON.parse(accept.body).entity).toMatchObject({
      state: 'assigned',
      assignedTo: 'member-tom',
    });
  });

  it('creates a versioned Safety Window through the resident command route', async () => {
    const startsAt = new Date(Date.now() + 60 * 60 * 1000);
    const expectedBy = new Date(startsAt.getTime() + 30 * 60 * 1000);
    const result = (await handler(
      event(
        '/v1/demo/safety-windows',
        'POST',
        {
          action: 'create',
          title: 'Arrived home',
          template: 'arrived-home',
          startsAt: startsAt.toISOString(),
          expectedBy: expectedBy.toISOString(),
          graceMinutes: 10,
          escalationMemberIds: ['member-maya', 'member-tom', 'member-james'],
        },
        {
          'x-stay-demo-session': 'test-create-window',
          'idempotency-key': 'api-create-arrived-home-window',
        },
      ),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).entity).toMatchObject({
      id: 'window-api-create-arrived-home-window',
      state: 'scheduled',
      version: 1,
    });
  });

  it('updates access settings and creates a bounded House Memory aggregate', async () => {
    const access = (await handler(
      event(
        '/v1/demo/access',
        'POST',
        {
          action: 'update',
          entityId: 'access-resident-sarah',
          expectedVersion: 1,
          preferences: {
            interactionMode: 'touch-first',
            reducedLoad: true,
            highLegibility: true,
            captions: true,
            extraResponseTime: true,
            repeatInformation: false,
            highContrast: true,
            reducedMotion: true,
            textScale: 'large',
          },
        },
        { 'x-stay-demo-session': 'test-access', 'idempotency-key': 'api-update-access' },
      ),
    )) as { statusCode: number; body: string };
    expect(access.statusCode).toBe(200);
    expect(JSON.parse(access.body).entity).toMatchObject({
      interactionMode: 'touch-first',
      reducedLoad: true,
      version: 2,
    });

    const memory = (await handler(
      event(
        '/v1/demo/house-memory',
        'POST',
        {
          action: 'add',
          label: 'Porch bulb',
          value: 'Warm LED, E26 base',
          category: 'maintenance',
          sensitivity: 'routine',
        },
        { 'x-stay-demo-session': 'test-memory', 'idempotency-key': 'api-add-memory' },
      ),
    )) as { statusCode: number; body: string };
    expect(memory.statusCode).toBe(200);
    expect(JSON.parse(memory.body).entity).toMatchObject({
      label: 'Porch bulb',
      sensitivity: 'routine',
      version: 1,
    });
  });

  it('creates a resident-authored custom playbook', async () => {
    const result = (await handler(
      event(
        '/v1/demo/playbooks',
        'POST',
        {
          action: 'create',
          title: 'Elevator outage',
          steps: ['Stay inside the apartment', 'Ask Maya to check the building notice'],
        },
        {
          'x-stay-demo-session': 'test-custom-playbook',
          'idempotency-key': 'api-custom-elevator-plan',
        },
      ),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).entity).toMatchObject({
      id: 'playbook-api-custom-elevator-plan',
      kind: 'custom',
      state: 'ready',
      version: 1,
    });
  });

  it('uses a short-lived scoped token before ending private time', async () => {
    const headers = {
      'x-stay-demo-session': 'test-privacy',
      'idempotency-key': 'api-start-private-time',
    };
    const started = (await handler(
      event(
        '/v1/demo/privacy',
        'POST',
        {
          action: 'update',
          entityId: 'privacy-resident-sarah',
          expectedVersion: 1,
          temporaryPrivateUntil: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        },
        headers,
      ),
    )) as { statusCode: number; body: string };
    expect(started.statusCode).toBe(200);
    expect(JSON.parse(started.body).entity.version).toBe(2);

    const prepared = (await handler(
      event(
        '/v1/demo/privacy',
        'POST',
        {
          action: 'request-confirmation',
          entityId: 'privacy-resident-sarah',
          expectedVersion: 2,
          confirmationPurpose: 'destructive-privacy-change',
        },
        {
          'x-stay-demo-session': 'test-privacy',
          'idempotency-key': 'api-prepare-private-time-end',
        },
      ),
    )) as { statusCode: number; body: string };
    expect(prepared.statusCode).toBe(201);
    const token = JSON.parse(prepared.body).confirmation.token as string;
    expect(token.length).toBeGreaterThanOrEqual(24);

    const ended = (await handler(
      event(
        '/v1/demo/privacy',
        'POST',
        {
          action: 'update',
          entityId: 'privacy-resident-sarah',
          expectedVersion: 2,
          temporaryPrivateUntil: null,
          confirmationToken: token,
        },
        {
          'x-stay-demo-session': 'test-privacy',
          'idempotency-key': 'api-confirm-private-time-end',
        },
      ),
    )) as { statusCode: number; body: string };
    expect(ended.statusCode).toBe(200);
    expect(JSON.parse(ended.body).entity).toMatchObject({ version: 3 });
    expect(JSON.parse(ended.body).entity.temporaryPrivateUntil).toBeUndefined();
  });
});
