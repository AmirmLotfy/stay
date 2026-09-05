import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHouseholdState } from '@stay/domain';
import type { AuthInfo } from '@modelcontextprotocol/server';
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  load: vi.fn(),
  prior: vi.fn(),
  get: vi.fn(),
}));
vi.mock('@stay/persistence', async () => ({
  ...(await vi.importActual('@stay/persistence')),
  DynamoStayRepository: class {
    authorize = mocks.authorize;
    loadHouseholdState = mocks.load;
    getIdempotency = mocks.prior;
    get = mocks.get;
  },
}));
vi.stubEnv('TABLE_NAME', 'pilot');
const { fetchMcp } = await import('./server.js');
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
const auth: AuthInfo = {
  token: 'test',
  clientId: 'test',
  scopes: ['stay/mcp'],
  expiresAt: Date.now() / 1000 + 60,
  extra: {
    subject: 'subject-ava',
    householdId: profile.id,
    residentId: profile.residentId,
    role: 'resident',
  },
};
async function call(name: string, args: unknown, identity = auth) {
  const result = await fetchMcp(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    }),
    identity,
  );
  const text = await result.text();
  const raw =
    text.startsWith('event:') || text.startsWith('data:')
      ? text
          .split('\n')
          .find((line) => line.startsWith('data: '))!
          .slice(6)
      : text;
  return JSON.parse(raw);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authorize.mockResolvedValue({ profile, membership: { version: 1 } });
  mocks.load.mockResolvedValue(createHouseholdState(profile));
  mocks.prior.mockResolvedValue(null);
});
describe('pilot MCP authorization', () => {
  it('rejects a private preference key before reading its contact aggregate', async () => {
    mocks.prior.mockResolvedValue({
      aggregateType: 'notification-contact',
      aggregateId: 'subject-ava',
      actorSubject: 'subject-ava',
      operation: 'notification-preferences',
    });
    const result = await call('manage_task_session', {
      action: 'complete',
      expectedVersion: 1,
      idempotencyKey: 'private-preference-key',
    });
    expect(result.result.isError).toBe(true);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('does not load fixture or household data after membership revocation', async () => {
    mocks.authorize.mockRejectedValue(new Error('MEMBERSHIP_REVOKED'));
    const result = await call('get_home_overview', {});
    expect(result.result.isError).toBe(true);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it('keeps an empty authenticated overview free of demo records and weather', async () => {
    const result = await call('get_home_overview', {});
    expect(result.result.isError).not.toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/Sarah|Tom|Bennett|Alvarez/);
    expect(result.result.structuredContent.data.weather).toBeNull();
  });
  it('denies routine House Memory to roles without memory access', async () => {
    const result = await call(
      'manage_house_memory',
      { action: 'list' },
      { ...auth, extra: { ...auth.extra, role: 'backup', circleMemberId: 'member-backup' } },
    );
    expect(result.result.isError).toBe(true);
  });
});
