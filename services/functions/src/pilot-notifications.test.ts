import { describe, expect, it, vi } from 'vitest';
import {
  acquireEmailPermit,
  deliverPilotEvent,
  type PilotDeliveryIO,
} from './pilot-notifications.js';

const contact = {
  id: 'subject-one',
  version: 1,
  email: 'one@example.test',
  verifiedAt: '2026-09-05T12:00:00Z',
  consentedAt: '2026-09-05T12:00:00Z',
  consentVersion: 'pilot-v1',
  enabled: true,
  suppression: 'none' as const,
};
function setup(): PilotDeliveryIO {
  return {
    admit: vi.fn().mockResolvedValue(async () => undefined),
    contacts: vi.fn().mockResolvedValue([contact]),
    membership: vi.fn().mockResolvedValue({
      id: contact.id,
      version: 1,
      active: true,
      residentId: 'resident-one',
      role: 'resident',
    }),
    authorize: vi.fn().mockResolvedValue(undefined),
    claim: vi.fn().mockResolvedValue('claimed'),
    finish: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  };
}
const body = (householdId = 'house-one') =>
  JSON.stringify({
    'detail-type': 'HelpRequest.Opened',
    detail: { id: 'event-one', householdId, aggregateId: 'help-one' },
  });
describe('pilot email boundary', () => {
  it('paces two simultaneous nine-person households through a shared one-per-second limit', async () => {
    vi.useFakeTimers();
    try {
      let nextAllowedAt = 0;
      const times: number[] = [];
      const io = setup();
      vi.mocked(io.contacts).mockResolvedValue(
        Array.from({ length: 9 }, (_, i) => ({ ...contact, id: `subject-${i}` })),
      );
      io.admit = () =>
        acquireEmailPermit({
          now: Date.now,
          reserve: async (now, next) => {
            if (now < nextAllowedAt) return false;
            nextAllowedAt = next;
            return true;
          },
          release: async (next) => {
            nextAllowedAt = next;
          },
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        });
      vi.mocked(io.send).mockImplementation(async () => {
        times.push(Date.now());
      });
      // Unequal reads after admission must not bunch actual sends together.
      let checks = 0;
      vi.mocked(io.authorize).mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, ++checks % 3 === 0 ? 1_200 : 10));
      });
      const deliveries = Promise.all([
        deliverPilotEvent(body('house-one'), io),
        deliverPilotEvent(body('house-two'), io),
      ]);
      await vi.runAllTimersAsync();
      await deliveries;
      expect(times).toHaveLength(18);
      expect(times.slice(1).every((time, index) => time - times[index]! >= 1_000)).toBe(true);
      expect(io.finish).toHaveBeenCalledTimes(18);
    } finally {
      vi.useRealTimers();
    }
  });
  it('retries a failed admission without sending or recording network uncertainty', async () => {
    const io = setup();
    vi.mocked(io.admit).mockRejectedValue(new Error('rate store unavailable'));
    await expect(deliverPilotEvent(body(), io)).rejects.toThrow('REQUIRES_REVIEW');
    expect(io.send).not.toHaveBeenCalled();
    expect(io.finish).toHaveBeenCalledWith('house-one', 'event-one', contact.id, 'retry');
  });
  it('never sends isolated demo events', async () => {
    const io = setup();
    await deliverPilotEvent(body('demo-household-demo-123'), io);
    expect(io.contacts).not.toHaveBeenCalled();
  });
  it('uses only contacts from the event household and records accepted delivery', async () => {
    const io = setup();
    await deliverPilotEvent(body(), io);
    expect(io.contacts).toHaveBeenCalledWith('house-one');
    expect(io.send).toHaveBeenCalledWith('house-one', 'event-one', contact);
    expect(io.finish).toHaveBeenCalledWith('house-one', 'event-one', contact.id, 'sent');
  });
  it.each([
    { enabled: false },
    { suppression: 'bounce' },
    { suppression: 'complaint' },
    { suppression: 'removed' },
  ])('suppresses excluded contacts %j', async (change) => {
    const io = setup();
    vi.mocked(io.contacts).mockResolvedValue([{ ...contact, ...change } as typeof contact]);
    await deliverPilotEvent(body(), io);
    expect(io.send).not.toHaveBeenCalled();
  });
  it('checks membership at delivery time', async () => {
    const io = setup();
    vi.mocked(io.authorize).mockRejectedValue(new Error('MEMBERSHIP_REVOKED'));
    await deliverPilotEvent(body(), io);
    expect(io.claim).not.toHaveBeenCalled();
  });
  it('does not repeat accepted sends', async () => {
    const io = setup();
    vi.mocked(io.claim).mockResolvedValue('done');
    await deliverPilotEvent(body(), io);
    expect(io.send).not.toHaveBeenCalled();
  });
  it('holds interrupted or ambiguous attempts for review', async () => {
    const io = setup();
    vi.mocked(io.claim).mockResolvedValue('unknown');
    await expect(deliverPilotEvent(body(), io)).rejects.toThrow('REQUIRES_REVIEW');
    expect(io.send).not.toHaveBeenCalled();
  });
  it('records network uncertainty without a second send', async () => {
    const io = setup();
    vi.mocked(io.send).mockRejectedValue(new Error('socket closed'));
    await expect(deliverPilotEvent(body(), io)).rejects.toThrow('REQUIRES_REVIEW');
    expect(io.send).toHaveBeenCalledTimes(1);
    expect(io.finish).toHaveBeenCalledWith('house-one', 'event-one', contact.id, 'unknown');
  });
  it('retries explicit SES throttling without classifying it as an accepted send', async () => {
    const io = setup();
    vi.mocked(io.send).mockRejectedValue(
      Object.assign(new Error('throttled'), { name: 'TooManyRequestsException' }),
    );
    await expect(deliverPilotEvent(body(), io)).rejects.toThrow('REQUIRES_REVIEW');
    expect(io.finish).toHaveBeenCalledWith('house-one', 'event-one', contact.id, 'retry');
  });
  it('suppresses membership revoked between claim and send', async () => {
    const io = setup();
    vi.mocked(io.authorize)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('MEMBERSHIP_REVOKED'));
    await deliverPilotEvent(body(), io);
    expect(io.send).not.toHaveBeenCalled();
    expect(io.finish).toHaveBeenCalledWith('house-one', 'event-one', contact.id, 'suppressed');
  });
  it('honors an opt-out racing with dispatch', async () => {
    const io = setup();
    vi.mocked(io.contacts)
      .mockResolvedValueOnce([contact])
      .mockResolvedValueOnce([{ ...contact, enabled: false, version: 2 }]);
    await deliverPilotEvent(body(), io);
    expect(io.send).not.toHaveBeenCalled();
    expect(io.finish).toHaveBeenCalledWith('house-one', 'event-one', contact.id, 'suppressed');
  });
});
