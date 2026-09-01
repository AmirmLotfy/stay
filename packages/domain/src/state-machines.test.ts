import { describe, expect, it } from 'vitest';
import { NotificationLedger, formatResidentTime, sharingAllowed } from './privacy.js';
import { transitionIncident, transitionSafetyWindow } from './state-machines.js';

describe('lifecycle state machines', () => {
  it('covers the normal Safety Window path and rejects illegal rewinds', () => {
    expect(transitionSafetyWindow('scheduled', 'OPEN')).toBe('open');
    expect(transitionSafetyWindow('open', 'MISS_CHECK')).toBe('first-check-missed');
    expect(transitionSafetyWindow('first-check-missed', 'BEGIN_GRACE')).toBe('grace');
    expect(transitionSafetyWindow('grace', 'BEGIN_ESCALATION')).toBe('escalating');
    expect(transitionSafetyWindow('escalating', 'RESOLVE')).toBe('resolved');
    expect(() => transitionSafetyWindow('resolved', 'OPEN')).toThrow(/not legal/);
  });

  it('requires coordination before responder assignment', () => {
    expect(transitionIncident('detected', 'BEGIN_VERIFICATION')).toBe('verifying');
    expect(transitionIncident('verifying', 'ACTIVATE')).toBe('active');
    expect(transitionIncident('active', 'BEGIN_COORDINATION')).toBe('coordinating');
    expect(transitionIncident('coordinating', 'ASSIGN_RESPONDER')).toBe('responding');
    expect(() => transitionIncident('active', 'RESOLVE')).toThrow(/not legal/);
  });
});

describe('privacy, timezones, and deduplication', () => {
  it('suppresses routine sharing but never resident-requested or authorized safety coordination', () => {
    const privacy = { routineSharing: true, temporaryPrivateUntil: '2026-09-02T12:00:00Z' };
    const now = new Date('2026-09-02T10:00:00Z');
    expect(sharingAllowed(privacy, 'routine-status', now)).toBe(false);
    expect(sharingAllowed(privacy, 'resident-requested-help', now)).toBe(true);
    expect(sharingAllowed(privacy, 'active-authorized-incident', now)).toBe(true);
    expect(sharingAllowed(privacy, 'security-audit', now)).toBe(true);
  });

  it('renders both sides of US daylight-saving transitions from UTC truth', () => {
    expect(formatResidentTime('2026-03-08T06:30:00Z', 'America/New_York')).toContain('01:30');
    expect(formatResidentTime('2026-03-08T07:30:00Z', 'America/New_York')).toContain('03:30');
    expect(formatResidentTime('2026-11-01T05:30:00Z', 'America/New_York')).toContain('01:30');
    expect(formatResidentTime('2026-11-01T06:30:00Z', 'America/New_York')).toContain('01:30');
  });

  it('delivers a notification only once for the same event and channel', () => {
    const ledger = new NotificationLedger();
    let deliveries = 0;
    expect(ledger.deliverOnce('event-1:email:tom', () => deliveries++)).toBe(true);
    expect(ledger.deliverOnce('event-1:email:tom', () => deliveries++)).toBe(false);
    expect(deliveries).toBe(1);
  });
});
