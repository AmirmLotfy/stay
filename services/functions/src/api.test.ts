import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { handler, persistedExpectedVersion } from './api.js';

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

function authorize(
  request: APIGatewayProxyEventV2,
  role: 'resident' | 'coordinator' | 'nearby-helper' | 'backup' | 'aide',
  circleMemberId?: string,
): APIGatewayProxyEventV2 {
  const context = request.requestContext as typeof request.requestContext & {
    authorizer?: { jwt: { claims: Record<string, string>; scopes: string[] } };
  };
  context.authorizer = {
    jwt: {
      claims: {
        sub: `subject-${role}`,
        'custom:household_id': 'household-sarah',
        'custom:resident_id': 'resident-sarah',
        'custom:stay_role': role,
        ...(circleMemberId ? { 'custom:circle_member_id': circleMemberId } : {}),
      },
      scopes: ['stay/app'],
    },
  };
  return request;
}

describe('REST API contract', () => {
  it('preserves optimistic versions for help-request transitions', () => {
    expect(persistedExpectedVersion('help-requests', 'create', undefined)).toBe(0);
    expect(persistedExpectedVersion('help-requests', 'accept', 1)).toBe(1);
    expect(persistedExpectedVersion('help-requests', 'complete', 2)).toBe(2);
  });

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
      message: 'The authenticated identity is missing its household, resident, or role claims.',
    });
  });

  it('serves authenticated household reads with an explicit role claim', async () => {
    const result = (await handler(authorize(event('/v1/home'), 'resident'))) as {
      statusCode: number;
      body: string;
    };
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).data.resident.id).toBe('resident-sarah');
  });

  it('enforces role permissions after Cognito authorization', async () => {
    const result = (await handler(
      authorize(
        event(
          '/v1/privacy',
          'POST',
          { action: 'update', expectedVersion: 1, routineSharing: false },
          { 'idempotency-key': 'coordinator-privacy-denied' },
        ),
        'coordinator',
      ),
    )) as { statusCode: number; body: string };
    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
  });

  it('enforces role permissions on authenticated reads', async () => {
    const result = (await handler(authorize(event('/v1/privacy'), 'coordinator'))) as {
      statusCode: number;
      body: string;
    };
    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).code).toBe('FORBIDDEN');
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

  it('performs a versioned simulated Path Lighting action', async () => {
    const result = (await handler(
      event(
        '/v1/demo/home',
        'POST',
        { action: 'turn-on', entityId: 'device-path-lighting', expectedVersion: 1 },
        {
          'x-stay-demo-session': 'test-path-lighting',
          'idempotency-key': 'api-path-lighting-on',
        },
      ),
    )) as { statusCode: number; body: string };
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({
      entity: { id: 'device-path-lighting', state: 'on', version: 2 },
      provenance: { mode: 'simulated', provider: 'STAY scripted smart-home adapter' },
    });
  });

  it('creates, updates, and removes a versioned Circle member', async () => {
    const headers = { 'x-stay-demo-session': 'circle-api', 'idempotency-key': 'circle-api-add' };
    const created = (await handler(
      event(
        '/v1/demo/circle',
        'POST',
        {
          action: 'add',
          name: 'Nora Fields',
          role: 'backup',
          priority: 5,
          availability: 'available',
          responseMinutes: 20,
          relationship: 'Friend · backup contact',
        },
        headers,
      ),
    )) as { statusCode: number; body: string };
    expect(created.statusCode).toBe(200);
    const member = JSON.parse(created.body).entity;
    expect(member).toMatchObject({ active: true, role: 'backup', version: 1 });

    const updated = (await handler(
      event(
        '/v1/demo/circle',
        'POST',
        {
          action: 'update',
          entityId: member.id,
          expectedVersion: 1,
          name: member.name,
          role: member.role,
          priority: member.priority,
          availability: 'busy',
          responseMinutes: member.responseMinutes,
          relationship: member.relationship,
        },
        { ...headers, 'idempotency-key': 'circle-api-update' },
      ),
    )) as { statusCode: number; body: string };
    expect(updated.statusCode).toBe(200);
    expect(JSON.parse(updated.body).entity).toMatchObject({ availability: 'busy', version: 2 });

    const removed = (await handler(
      event(
        '/v1/demo/circle',
        'POST',
        { action: 'remove', entityId: member.id, expectedVersion: 2 },
        { ...headers, 'idempotency-key': 'circle-api-remove' },
      ),
    )) as { statusCode: number; body: string };
    expect(removed.statusCode).toBe(200);
    expect(JSON.parse(removed.body).entity.active).toBe(false);
  });

  it('exposes the full deterministic incident lifecycle through versioned routes', async () => {
    const baseHeaders = {
      'x-stay-demo-session': 'incident-api',
      'idempotency-key': 'incident-api-detect',
    };
    const detected = (await handler(
      event(
        '/v1/demo/incidents',
        'POST',
        {
          action: 'detect',
          kind: 'water-leak',
          title: 'Water near the kitchen sink',
          severity: 'attention',
        },
        baseHeaders,
      ),
    )) as { statusCode: number; body: string };
    expect(detected.statusCode).toBe(200);
    let incident = JSON.parse(detected.body).entity;

    for (const action of ['begin-verification', 'activate', 'begin-coordination'] as const) {
      const result = (await handler(
        event(
          '/v1/demo/incidents',
          'POST',
          { action, entityId: incident.id, expectedVersion: incident.version },
          { ...baseHeaders, 'idempotency-key': `incident-api-${action}` },
        ),
      )) as { statusCode: number; body: string };
      expect(result.statusCode).toBe(200);
      incident = JSON.parse(result.body).entity;
    }
    expect(incident).toMatchObject({ state: 'coordinating', version: 4 });
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

  it('discloses incident-only access notes only to the assigned authenticated responder after confirmation', async () => {
    const residentHeaders = { 'idempotency-key': 'access-disclosure-detect' };
    const detectedResponse = (await handler(
      authorize(
        event(
          '/v1/incidents',
          'POST',
          {
            action: 'detect',
            kind: 'water-leak',
            title: 'Access disclosure test',
            severity: 'attention',
          },
          residentHeaders,
        ),
        'resident',
      ),
    )) as { statusCode: number; body: string };
    let incident = JSON.parse(detectedResponse.body).entity;
    for (const action of ['begin-verification', 'activate', 'begin-coordination'] as const) {
      const transitioned = (await handler(
        authorize(
          event(
            '/v1/incidents',
            'POST',
            { action, entityId: incident.id, expectedVersion: incident.version },
            { 'idempotency-key': `access-disclosure-${action}` },
          ),
          'resident',
        ),
      )) as { statusCode: number; body: string };
      incident = JSON.parse(transitioned.body).entity;
    }
    for (const [action, key] of [
      ['ask-responder', 'access-disclosure-ask'],
      ['accept', 'access-disclosure-accept'],
    ] as const) {
      const transitioned = (await handler(
        authorize(
          event(
            '/v1/incidents',
            'POST',
            {
              action,
              entityId: incident.id,
              memberId: 'member-tom',
              expectedVersion: incident.version,
            },
            { 'idempotency-key': key },
          ),
          'resident',
        ),
      )) as { statusCode: number; body: string };
      incident = JSON.parse(transitioned.body).entity;
    }

    const prepared = (await handler(
      authorize(
        event(
          '/v1/incidents',
          'POST',
          {
            action: 'request-confirmation',
            entityId: incident.id,
            expectedVersion: incident.version,
            confirmationPurpose: 'disclose-access-instructions',
          },
          { 'idempotency-key': 'access-disclosure-prepare' },
        ),
        'nearby-helper',
        'member-tom',
      ),
    )) as { statusCode: number; body: string };
    const confirmationToken = JSON.parse(prepared.body).confirmation.token;
    const disclosed = (await handler(
      authorize(
        event(
          '/v1/incidents',
          'POST',
          {
            action: 'disclose-access-instructions',
            entityId: incident.id,
            expectedVersion: incident.version,
            confirmationToken,
          },
          { 'idempotency-key': 'access-disclosure-open' },
        ),
        'nearby-helper',
        'member-tom',
      ),
    )) as { statusCode: number; body: string };
    expect(disclosed.statusCode).toBe(200);
    expect(JSON.parse(disclosed.body)).toMatchObject({
      entity: { state: 'responding', version: incident.version + 1 },
      incidentAccess: [{ label: 'Emergency access note' }],
    });
  });
});
