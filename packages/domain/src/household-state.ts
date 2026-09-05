import type { HouseholdProfile } from '@stay/contracts';
import type { HomeState } from './demo-state.js';

/** Empty real home. Deliberately independent of the synthetic household factory. */
export function createHouseholdState(profile: HouseholdProfile): HomeState {
  return {
    householdId: profile.id,
    resident: {
      id: profile.residentId,
      name: profile.name,
      firstName: profile.firstName,
      timezone: profile.timezone,
      status: 'home',
    },
    access: {
      id: `access-${profile.residentId}`,
      version: 1,
      interactionMode: 'balanced',
      reducedLoad: false,
      highLegibility: true,
      captions: true,
      extraResponseTime: true,
      repeatInformation: false,
      highContrast: false,
      reducedMotion: false,
      textScale: 'default',
    },
    oneThing: {
      id: 'task-one-thing',
      title: 'Your home is ready to set up',
      detail: 'Your operator can help you add a task and invite your trusted Circle.',
      completed: false,
      state: 'not-started',
      version: 1,
    },
    calendar: [],
    circle: [],
    safetyWindows: [],
    helpRequests: [],
    incidents: [],
    playbooks: [],
    houseMemory: [],
    devices: [],
    outbox: [],
    privacy: {
      id: `privacy-${profile.residentId}`,
      version: 1,
      routineSharing: false,
      locationSharing: 'off',
      auditRetention: true,
    },
  };
}
