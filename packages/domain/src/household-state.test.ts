import { describe, expect, it } from 'vitest';
import { createHouseholdState } from './household-state.js';

describe('real household initialization', () => {
  it('starts empty and never invents demo helpers, devices, notes, or schedules', () => {
    const home = createHouseholdState({
      id: 'house-ava',
      version: 1,
      status: 'active',
      residentId: 'resident-ava',
      name: 'Ava Jones',
      firstName: 'Ava',
      timezone: 'Africa/Cairo',
      createdAt: '2026-09-05T12:00:00Z',
      consentedAt: '2026-09-05T12:00:00Z',
      consentVersion: 'pilot-v1',
    });
    expect(home.resident.firstName).toBe('Ava');
    for (const field of [
      'circle',
      'safetyWindows',
      'helpRequests',
      'incidents',
      'playbooks',
      'houseMemory',
      'devices',
    ] as const)
      expect(home[field]).toEqual([]);
    expect(JSON.stringify(home)).not.toMatch(/Sarah|Tom|Bennett|Alvarez|blue recycling/);
    expect(home.privacy).toMatchObject({ routineSharing: false, locationSharing: 'off' });
  });
});
