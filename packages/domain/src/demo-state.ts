import type {
  AccessSettings,
  CircleMember,
  HelpRequest,
  HouseMemoryItem,
  Incident,
  Playbook,
  PrivacySettings,
  SafetyWindow,
  TimelineEvent,
} from '@stay/contracts';

export interface CalendarItem {
  id: string;
  title: string;
  when: string;
  kind: 'appointment' | 'delivery' | 'routine';
}

export interface HomeState {
  householdId: string;
  resident: {
    id: string;
    name: string;
    firstName: string;
    timezone: string;
    status: 'home' | 'away' | 'resting';
  };
  access: AccessSettings;
  oneThing: {
    id: string;
    title: string;
    detail: string;
    completed: boolean;
    state: 'not-started' | 'active' | 'paused' | 'completed' | 'cancelled';
    version: number;
  };
  calendar: CalendarItem[];
  circle: CircleMember[];
  safetyWindows: SafetyWindow[];
  helpRequests: HelpRequest[];
  incidents: Incident[];
  playbooks: Playbook[];
  houseMemory: HouseMemoryItem[];
  privacy: PrivacySettings;
  outbox: Array<{
    id: string;
    eventType: string;
    aggregateId: string;
    occurredAt: string;
    payload: Record<string, unknown>;
  }>;
}

function timeline(
  id: string,
  at: string,
  kind: string,
  title: string,
  detail: string,
  actorName = 'STAY',
): TimelineEvent {
  return { id, at, kind, title, detail, actorName };
}

export function createDemoState(now = new Date('2026-09-02T10:20:00.000Z')): HomeState {
  const iso = now.toISOString();
  return {
    householdId: 'demo-household-sarah',
    resident: {
      id: 'resident-sarah',
      name: 'Sarah Bennett',
      firstName: 'Sarah',
      timezone: 'America/New_York',
      status: 'home',
    },
    access: {
      id: 'access-resident-sarah',
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
      title: 'Put the blue recycling bin out',
      detail: 'Collection is tomorrow morning. The bin is beside the back door.',
      completed: false,
      state: 'active',
      version: 1,
    },
    calendar: [
      { id: 'cal-1', title: 'Lunch with Maya', when: '12:30 PM', kind: 'appointment' },
      { id: 'cal-2', title: 'Pharmacy delivery', when: '2–4 PM', kind: 'delivery' },
    ],
    circle: [
      {
        id: 'member-maya',
        name: 'Maya Bennett',
        initials: 'MB',
        role: 'coordinator',
        priority: 1,
        availability: 'available',
        responseMinutes: 4,
        permissions: [
          'home:read',
          'circle:read',
          'circle:manage',
          'safety-window:read',
          'safety-window:manage',
          'help:respond',
          'incident:read',
          'incident:coordinate',
          'incident:resolve',
        ],
        relationship: 'Daughter · primary coordinator',
      },
      {
        id: 'member-tom',
        name: 'Tom Alvarez',
        initials: 'TA',
        role: 'nearby-helper',
        priority: 2,
        availability: 'available',
        responseMinutes: 7,
        permissions: [
          'home:read',
          'circle:read',
          'safety-window:read',
          'help:respond',
          'incident:read',
          'incident:coordinate',
        ],
        relationship: 'Neighbor · 0.3 mi away',
      },
      {
        id: 'member-lena',
        name: 'Lena Ortiz',
        initials: 'LO',
        role: 'aide',
        priority: 3,
        availability: 'busy',
        responseMinutes: 25,
        permissions: ['home:read', 'circle:read', 'safety-window:read', 'help:respond'],
        relationship: 'Home aide · weekdays',
      },
      {
        id: 'member-james',
        name: 'James Bennett',
        initials: 'JB',
        role: 'backup',
        priority: 4,
        availability: 'unavailable',
        responseMinutes: 40,
        permissions: ['circle:read', 'safety-window:read', 'help:respond', 'incident:read'],
        relationship: 'Son · backup contact',
      },
    ],
    safetyWindows: [
      {
        id: 'window-morning',
        residentId: 'resident-sarah',
        residentName: 'Sarah',
        title: 'Morning check-in',
        template: 'morning-check-in',
        state: 'open',
        startsAt: '2026-09-02T10:00:00.000Z',
        expectedBy: '2026-09-02T10:30:00.000Z',
        graceMinutes: 10,
        checkAttempts: 0,
        escalationMemberIds: ['member-maya', 'member-tom', 'member-james'],
        version: 1,
        timeline: [
          timeline(
            'timeline-window-open',
            iso,
            'window-opened',
            'Safety Window opened',
            'Sarah has until 6:30 AM to check in.',
          ),
        ],
      },
    ],
    helpRequests: [
      {
        id: 'help-groceries',
        residentId: 'resident-sarah',
        title: 'Bring in a grocery delivery',
        detail: 'Delivery is expected by the side entrance between 5 and 6 PM.',
        urgency: 'normal',
        state: 'open',
        offeredTo: ['member-tom'],
        createdAt: iso,
        version: 1,
        timeline: [
          timeline(
            'timeline-help-open',
            iso,
            'help-opened',
            'Request posted',
            'Tom can respond from the Help Board.',
            'Sarah',
          ),
        ],
      },
    ],
    incidents: [],
    playbooks: [
      ['playbook-power', 'Power Outage', 'power-outage'],
      ['playbook-water', 'Water Leak', 'water-leak'],
      ['playbook-heat', 'Extreme Heat', 'extreme-heat'],
      ['playbook-weather', 'Severe Weather', 'severe-weather'],
    ].map(([id, title, kind]) => ({
      id: id!,
      title: title!,
      kind: kind as Playbook['kind'],
      state: 'ready',
      steps: playbookSteps(kind as Playbook['kind']),
      provenance: {
        mode: 'simulated',
        provider: `${title} demo adapter`,
        observedAt: iso,
        reason: 'No live device, weather, utility, or maintenance provider is connected.',
      },
      version: 1,
    })),
    houseMemory: [
      {
        id: 'memory-water',
        label: 'Main water shutoff',
        value: 'Utility closet, low red handle behind the shelf',
        category: 'home',
        sensitivity: 'sensitive',
        updatedAt: iso,
        version: 1,
      },
      {
        id: 'memory-bin',
        label: 'Recycling collection',
        value: 'Thursday mornings; use the blue bin',
        category: 'routine',
        sensitivity: 'routine',
        updatedAt: iso,
        version: 1,
      },
      {
        id: 'memory-key',
        label: 'Emergency access note',
        value: 'Available only to the assigned responder during an active incident',
        category: 'home',
        sensitivity: 'incident-only',
        updatedAt: iso,
        version: 1,
      },
    ],
    privacy: {
      id: 'privacy-resident-sarah',
      version: 1,
      routineSharing: true,
      locationSharing: 'incident-only',
      auditRetention: true,
    },
    outbox: [],
  };
}

function playbookSteps(kind: Playbook['kind']): Playbook['steps'] {
  const steps: Record<Playbook['kind'], string[]> = {
    'power-outage': [
      'Turn on path lighting',
      'Check the utility status',
      'Offer Circle support',
      'Preserve phone battery',
    ],
    'water-leak': [
      'Move away from standing water',
      'Locate the shutoff note',
      'Ask a Circle member to help',
      'Record affected rooms',
    ],
    'extreme-heat': [
      'Move to the coolest room',
      'Check water nearby',
      'Close sunny-room shades',
      'Arrange a Circle check-in',
    ],
    'severe-weather': [
      'Move away from windows',
      'Keep shoes and phone nearby',
      'Review the safest room',
      'Notify the Circle',
    ],
    custom: ['Review the plan', 'Choose a helper', 'Record progress'],
  };
  return steps[kind].map((label, index) => ({
    id: `${kind}-${index + 1}`,
    label,
    completed: false,
  }));
}
