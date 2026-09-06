import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createHouseholdState } from '@stay/domain';
import type { SafetyWindow } from '@stay/contracts';
const mocks = vi.hoisted(() => ({ get: vi.fn(), write: vi.fn(), load: vi.fn() }));
vi.mock('./repository.js', () => ({
  DynamoStayRepository: class {
    get = mocks.get;
    write = mocks.write;
    loadHouseholdState = mocks.load;
  },
}));
import { handler } from './scheduler.js';
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
let window: SafetyWindow;
const invoke = (transition: 'open' | 'first-check' | 'second-check' = 'second-check') =>
  handler({
    householdId: profile.id,
    windowId: 'window-one',
    transition,
    expectedVersion: transition === 'open' ? 1 : transition === 'first-check' ? 2 : 3,
    scheduledAt:
      transition === 'open'
        ? '2026-09-05T12:00:00Z'
        : transition === 'first-check'
          ? '2026-09-05T12:10:00Z'
          : '2026-09-05T12:15:00Z',
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('TABLE_NAME', 'pilot');
  vi.stubEnv('STAY_ENVIRONMENT', 'pilot');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-05T12:20:00Z'));
  window = {
    id: 'window-one',
    version: 1,
    residentId: profile.residentId,
    residentName: 'Ava',
    title: 'Afternoon check-in',
    template: 'arrived-home',
    state: 'scheduled',
    startsAt: '2026-09-05T12:00:00Z',
    expectedBy: '2026-09-05T12:10:00Z',
    graceMinutes: 5,
    checkAttempts: 0,
    escalationMemberIds: [],
    timeline: [],
  };
  mocks.get.mockImplementation(async (_house, type) =>
    type === 'profile' ? profile : structuredClone(window),
  );
  mocks.load.mockImplementation(async () => ({
    ...createHouseholdState(profile),
    safetyWindows: [structuredClone(window)],
  }));
  mocks.write.mockImplementation(async (command) => {
    window = command.entity;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe('pilot schedule delivery order', () => {
  it('catches up a second check delivered before open and atomically creates the incident', async () => {
    await invoke();
    expect(window).toMatchObject({ version: 2, state: 'escalating', checkAttempts: 2 });
    expect(mocks.write.mock.calls[0]![0]).toMatchObject({
      expectedVersion: 1,
      householdVersion: 1,
      related: {
        aggregateType: 'incident',
        entity: { id: 'incident-window-one', version: 1 },
        event: { type: 'Incident.Activated' },
      },
    });
    await invoke('open');
    await invoke('first-check');
    await invoke();
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it.each(['checked-in', 'cancelled', 'resolved'] as const)(
    'does not override %s after a delayed delivery',
    async (state) => {
      window.state = state;
      window.version = 2;
      await invoke();
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );
  it('retries a missing commit and transaction conflicts rather than losing the check', async () => {
    mocks.get.mockImplementation(async (_house, type) => (type === 'profile' ? profile : null));
    await expect(invoke()).rejects.toThrow('WINDOW_NOT_COMMITTED_RETRY');
    mocks.get.mockImplementation(async (_house, type) => (type === 'profile' ? profile : window));
    mocks.write.mockRejectedValue(
      Object.assign(new Error('race'), { name: 'TransactionCanceledException' }),
    );
    await expect(invoke()).rejects.toThrow('race');
  });
  it('suppresses closed households and does not run before the persisted deadline', async () => {
    vi.setSystemTime(new Date('2026-09-05T12:01:00Z'));
    await expect(invoke()).rejects.toThrow('SCHEDULE_NOT_DUE_RETRY');
    mocks.get.mockResolvedValue({ ...profile, status: 'closed' });
    await invoke();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
