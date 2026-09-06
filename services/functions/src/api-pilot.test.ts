import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createHouseholdState, permissionsForRole } from '@stay/domain';
import { commandFingerprint } from '@stay/persistence';
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  prior: vi.fn(),
  load: vi.fn(),
  write: vi.fn(),
}));
vi.mock('./repository.js', async () => ({
  ...(await vi.importActual('@stay/persistence')),
  DynamoStayRepository: class {
    authorize = mocks.authorize;
    get = mocks.get;
    list = mocks.list;
    getIdempotency = mocks.prior;
    loadHouseholdState = mocks.load;
    write = mocks.write;
  },
}));
import { handler } from './api.js';
const profile = {
  id: 'house-ava',
  version: 1,
  status: 'active' as const,
  residentId: 'resident-ava',
  name: 'Ava Jones',
  firstName: 'Ava',
  timezone: 'UTC',
  createdAt: '2026-09-05T12:00:00Z',
  consentedAt: '2026-09-05T12:00:00Z',
  consentVersion: 'pilot-v1',
};
function request(path: string, body?: unknown, household = profile.id) {
  return {
    version: '2.0',
    rawPath: `/v1/${path}`,
    headers: { 'idempotency-key': 'private-preference-key' },
    requestContext: {
      requestId: 'test',
      http: { method: body ? 'POST' : 'GET' },
      authorizer: {
        jwt: {
          claims: {
            sub: 'subject-ava',
            'custom:household_id': household,
            'custom:resident_id': profile.residentId,
            'custom:stay_role': 'resident',
          },
          scopes: ['stay/app'],
        },
      },
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  } as unknown as APIGatewayProxyEventV2;
}
async function call(path: string, body?: unknown, household?: string) {
  const result = (await handler(request(path, body, household))) as {
    statusCode: number;
    body: string;
  };
  return { status: result.statusCode, text: result.body, json: JSON.parse(result.body) };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('TABLE_NAME', 'pilot');
  vi.stubEnv('STAY_ENVIRONMENT', 'pilot');
  mocks.authorize.mockResolvedValue({ profile, membership: { id: 'subject-ava', version: 1 } });
  mocks.get.mockResolvedValue(null);
  mocks.list.mockResolvedValue([]);
  mocks.prior.mockResolvedValue(null);
  mocks.load.mockResolvedValue(createHouseholdState(profile));
  mocks.write.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
describe('authenticated pilot privacy boundary', () => {
  it('never bootstraps public demo sessions on the pilot', async () => {
    expect((await call('demo-sessions', {})).status).toBe(403);
  });
  it('rejects revoked or cross-household memberships before loading any data', async () => {
    mocks.authorize.mockRejectedValue(new Error('MEMBERSHIP_REVOKED'));
    expect((await call('home', undefined, 'house-other')).status).toBe(403);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('returns no fixture records in an empty household', async () => {
    const result = await call('home');
    expect(result.status).toBe(200);
    expect(result.text).not.toMatch(/Sarah|Tom|Bennett|Alvarez/);
    expect((await call('circle')).json.data).toEqual([]);
  });
  it('does not reintroduce incident-only notes when merging persisted House Memory', async () => {
    mocks.list.mockImplementation(async (_house, type) =>
      type === 'house-memory'
        ? [
            { id: 'routine', version: 1, sensitivity: 'routine', value: 'Recycling Tuesday' },
            { id: 'entry', version: 1, sensitivity: 'incident-only', value: 'private-entry-code' },
          ]
        : [],
    );
    const result = await call('house-memory');
    expect(result.status).toBe(200);
    expect(result.text).toContain('Recycling Tuesday');
    expect(result.text).not.toContain('private-entry-code');
  });
  it('prevents private-contact replay through a general REST route', async () => {
    mocks.prior.mockResolvedValue({
      aggregateType: 'notification-contact',
      aggregateId: 'subject-ava',
      actorSubject: 'subject-ava',
      operation: 'notification-preferences',
    });
    const result = await call('tasks', { action: 'complete', expectedVersion: 1 });
    expect(result.status).toBe(409);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('projects preferences without disclosing email on reads or writes', async () => {
    mocks.get.mockResolvedValue({
      id: 'subject-ava',
      version: 1,
      email: 'private@example.test',
      verifiedAt: profile.createdAt,
      consentedAt: profile.createdAt,
      consentVersion: 'pilot-v1',
      enabled: true,
      suppression: 'none',
    });
    const read = await call('notification-preferences');
    expect(read.status).toBe(200);
    expect(read.text).not.toContain('@');
    const write = await call('notification-preferences', {
      action: 'update',
      expectedVersion: 1,
      enabled: false,
    });
    expect(write.status).toBe(200);
    expect(write.text).not.toContain('@');
    expect(JSON.stringify(mocks.write.mock.calls[0]![0].event)).not.toContain('@');
  });
  it('binds retry keys to role, route, action, entity, and complete payload', () => {
    const actor = {
      subject: 'subject-ava',
      householdId: profile.id,
      residentId: profile.residentId,
      role: 'resident' as const,
      permissions: permissionsForRole('resident'),
      correlationId: 'test',
    };
    const hash = commandFingerprint(actor, 'tasks', {
      action: 'complete',
      entityId: 'task-one',
      expectedVersion: 1,
    });
    expect(hash).toBe(
      commandFingerprint(actor, 'tasks', {
        expectedVersion: 1,
        entityId: 'task-one',
        action: 'complete',
      }),
    );
    expect(hash).not.toBe(
      commandFingerprint(actor, 'tasks', {
        action: 'reset',
        entityId: 'task-one',
        expectedVersion: 1,
      }),
    );
    expect(hash).not.toBe(
      commandFingerprint(actor, 'tasks', {
        action: 'complete',
        entityId: 'task-two',
        expectedVersion: 1,
      }),
    );
    expect(hash).not.toBe(
      commandFingerprint(
        { ...actor, role: 'backup', permissions: permissionsForRole('backup') },
        'tasks',
        { action: 'complete', entityId: 'task-one', expectedVersion: 1 },
      ),
    );
  });
});
