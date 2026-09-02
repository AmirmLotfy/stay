import type { ActorContext } from '@stay/contracts';
import { describe, expect, it } from 'vitest';
import { StayEngine } from './engine.js';
import { StayDomainError } from './errors.js';

const actor: ActorContext = {
  subject: 'resident-sarah',
  householdId: 'demo-household-sarah',
  residentId: 'resident-sarah',
  role: 'resident',
  correlationId: 'test-correlation',
  permissions: [
    'home:read',
    'tasks:write',
    'safety-window:manage',
    'incident:coordinate',
    'incident:resolve',
    'help:request',
    'help:respond',
    'access:manage',
    'privacy:manage',
    'memory:manage',
    'playbook:execute',
  ],
};

describe('StayEngine protected demonstration', () => {
  it('creates a future Safety Window with the resident preconfigured Circle order', () => {
    const created = new StayEngine().createSafetyWindow(
      {
        title: 'Arrived home',
        template: 'arrived-home',
        startsAt: '2026-09-03T15:00:00.000Z',
        expectedBy: '2026-09-03T15:30:00.000Z',
        graceMinutes: 10,
        escalationMemberIds: ['member-maya', 'member-tom', 'member-james'],
      },
      {
        actor,
        idempotencyKey: 'create-arrived-home-window',
        now: new Date('2026-09-02T10:00:00.000Z'),
      },
    );

    expect(created.entity).toMatchObject({
      id: 'window-create-arrived-home-window',
      state: 'scheduled',
      version: 1,
      escalationMemberIds: ['member-maya', 'member-tom', 'member-james'],
    });
    expect(created.emittedEvents[0]?.type).toBe('SafetyWindow.Created');
  });

  it('rejects Safety Windows that start in the past', () => {
    expect(() =>
      new StayEngine().createSafetyWindow(
        {
          title: 'Past window',
          template: 'custom',
          startsAt: '2026-09-01T15:00:00.000Z',
          expectedBy: '2026-09-01T15:30:00.000Z',
          graceMinutes: 10,
          escalationMemberIds: ['member-maya'],
        },
        {
          actor,
          idempotencyKey: 'create-past-window',
          now: new Date('2026-09-02T10:00:00.000Z'),
        },
      ),
    ).toThrow(/start in the future/);
  });

  it('coordinates the complete missed-window responder flow without a model', () => {
    const engine = new StayEngine();
    const first = engine.markSafetyWindowMissed('window-morning', {
      actor,
      idempotencyKey: 'miss-1',
      expectedVersion: 1,
      now: new Date('2026-09-02T10:31:00Z'),
    });
    expect(first.entity.state).toBe('first-check-missed');

    const second = engine.markSafetyWindowMissed('window-morning', {
      actor,
      idempotencyKey: 'miss-2',
      expectedVersion: 2,
      now: new Date('2026-09-02T10:41:00Z'),
    });
    expect(second.entity.state).toBe('escalating');

    const activated = engine.activateMissedWindowIncident('window-morning', {
      actor,
      idempotencyKey: 'activate-1',
      expectedVersion: 3,
      now: new Date('2026-09-02T10:41:01Z'),
    });
    const asked = engine.offerIncidentToMember(activated.entity.id, 'member-tom', {
      actor,
      idempotencyKey: 'ask-tom-1',
      expectedVersion: 1,
      now: new Date('2026-09-02T10:42:00Z'),
    });
    const accepted = engine.acceptIncident(asked.entity.id, 'member-tom', {
      actor,
      idempotencyKey: 'accept-tom-1',
      expectedVersion: 2,
      now: new Date('2026-09-02T10:43:00Z'),
    });
    expect(accepted.entity.state).toBe('responding');
    expect(accepted.entity.timeline.at(-1)?.title).toBe('Tom is on the way');
  });

  it('deduplicates repeat commands', () => {
    const engine = new StayEngine();
    const command = {
      actor,
      idempotencyKey: 'same-command',
      expectedVersion: 1,
      now: new Date('2026-09-02T10:31:00Z'),
    };
    const first = engine.markSafetyWindowMissed('window-morning', command);
    const replay = engine.markSafetyWindowMissed('window-morning', command);
    expect(replay).toEqual(first);
    expect(engine.snapshot().safetyWindows[0]?.version).toBe(2);
  });

  it('rejects stale writes', () => {
    const engine = new StayEngine();
    expect(() =>
      engine.markSafetyWindowMissed('window-morning', {
        actor,
        idempotencyKey: 'stale-command',
        expectedVersion: 99,
      }),
    ).toThrowError(StayDomainError);
  });

  it('prevents two responders from owning the same incident', () => {
    const engine = new StayEngine();
    engine.markSafetyWindowMissed('window-morning', {
      actor,
      idempotencyKey: 'm1',
      expectedVersion: 1,
    });
    engine.markSafetyWindowMissed('window-morning', {
      actor,
      idempotencyKey: 'm2',
      expectedVersion: 2,
    });
    const incident = engine.activateMissedWindowIncident('window-morning', {
      actor,
      idempotencyKey: 'a1',
      expectedVersion: 3,
    }).entity;
    const accepted = engine.acceptIncident(incident.id, 'member-tom', {
      actor,
      idempotencyKey: 'tom',
      expectedVersion: 1,
    });
    expect(() =>
      engine.acceptIncident(incident.id, 'member-maya', {
        actor,
        idempotencyKey: 'maya',
        expectedVersion: accepted.version,
      }),
    ).toThrowError(/already owns/);
  });

  it('keeps deterministic workflows available when AI is absent', () => {
    const engine = new StayEngine();
    const result = engine.requestHelp(
      {
        title: 'Reach a shelf',
        detail: 'Please help with the top pantry shelf.',
        urgency: 'normal',
      },
      { actor, idempotencyKey: 'help-no-ai' },
    );
    expect(result.entity.offeredTo).toContain('member-maya');
    expect(result.provenance.provider).toContain('deterministic');
  });

  it('supports resident check-in and early closure without escalation', () => {
    const checkedIn = new StayEngine().checkInSafetyWindow('window-morning', {
      actor,
      idempotencyKey: 'check-in',
      expectedVersion: 1,
      now: new Date('2026-09-02T10:25:00Z'),
    });
    expect(checkedIn.entity.state).toBe('checked-in');
    expect(checkedIn.emittedEvents[0]?.type).toBe('SafetyWindow.CheckedIn');

    const closed = new StayEngine().checkInSafetyWindow(
      'window-morning',
      {
        actor,
        idempotencyKey: 'close-early',
        expectedVersion: 1,
      },
      true,
    );
    expect(closed.entity.timeline.at(-1)?.title).toBe('Window closed early');
  });

  it('runs the One Thing task session as a versioned deterministic workflow', () => {
    const engine = new StayEngine();
    const completed = engine.manageTaskSession('complete', {
      actor,
      idempotencyKey: 'complete-one-thing',
      expectedVersion: 1,
    });
    expect(completed.entity).toMatchObject({ state: 'completed', completed: true, version: 2 });
    const reset = engine.manageTaskSession('reset', {
      actor,
      idempotencyKey: 'reset-one-thing',
      expectedVersion: 2,
    });
    expect(reset.entity).toMatchObject({ state: 'not-started', completed: false, version: 3 });
  });

  it('supports cancellation only before escalation', () => {
    const engine = new StayEngine();
    expect(
      engine.cancelSafetyWindow('window-morning', {
        actor,
        idempotencyKey: 'cancel-window',
        expectedVersion: 1,
      }).entity.state,
    ).toBe('cancelled');
    expect(() =>
      engine.checkInSafetyWindow('window-morning', {
        actor,
        idempotencyKey: 'late-check-in',
        expectedVersion: 2,
      }),
    ).toThrowError(/no longer available/);
  });

  it('assigns, completes, and declines ordinary help requests deterministically', () => {
    const engine = new StayEngine();
    const accepted = engine.acceptHelpRequest('help-groceries', 'member-tom', {
      actor,
      idempotencyKey: 'accept-help',
      expectedVersion: 1,
    });
    expect(accepted.entity.assignedTo).toBe('member-tom');
    expect(
      engine.completeHelpRequest('help-groceries', {
        actor,
        idempotencyKey: 'complete-help',
        expectedVersion: 2,
      }).entity.state,
    ).toBe('completed');

    const declined = new StayEngine().declineHelpRequest('help-groceries', 'member-tom', {
      actor,
      idempotencyKey: 'decline-help',
      expectedVersion: 1,
    });
    expect(declined.entity.state).toBe('declined');
  });

  it('escalates only through the preconfigured Circle plan', () => {
    const engine = new StayEngine();
    engine.markSafetyWindowMissed('window-morning', {
      actor,
      idempotencyKey: 'escalate-miss-1',
      expectedVersion: 1,
    });
    engine.markSafetyWindowMissed('window-morning', {
      actor,
      idempotencyKey: 'escalate-miss-2',
      expectedVersion: 2,
    });
    const incident = engine.activateMissedWindowIncident('window-morning', {
      actor,
      idempotencyKey: 'escalate-activate',
      expectedVersion: 3,
    }).entity;
    const escalated = engine.escalateIncident(incident.id, {
      actor,
      idempotencyKey: 'escalate-circle',
      expectedVersion: 1,
    });
    expect(escalated.entity.state).toBe('escalated');
    expect(escalated.entity.timeline.at(-1)?.detail).toContain('No emergency service');
  });

  it('persists access preferences as a versioned aggregate', () => {
    const engine = new StayEngine();
    const current = engine.snapshot().access;
    const result = engine.updateAccessPreferences(
      { ...current, textScale: 'extra-large', reducedLoad: true },
      {
        actor,
        idempotencyKey: 'access-update',
        expectedVersion: current.version,
      },
    );
    expect(result.entity).toMatchObject({
      id: 'access-resident-sarah',
      textScale: 'extra-large',
      reducedLoad: true,
      version: 2,
    });
    expect(result.emittedEvents[0]?.data).toEqual({ changed: ['reducedLoad', 'textScale'] });
  });

  it('adds and updates House Memory without placing the detail value in events', () => {
    const engine = new StayEngine();
    const added = engine.addHouseMemory(
      {
        label: 'Porch bulb',
        value: 'Warm LED, E26 base',
        category: 'maintenance',
        sensitivity: 'routine',
      },
      { actor, idempotencyKey: 'memory-porch-bulb' },
    );
    expect(added.entity).toMatchObject({ version: 1, label: 'Porch bulb' });
    expect(JSON.stringify(added.emittedEvents)).not.toContain('Warm LED');

    const updated = engine.updateHouseMemory(
      added.entity.id,
      { ...added.entity, value: 'Warm LED, E26 base, 800 lumens' },
      {
        actor,
        idempotencyKey: 'memory-porch-bulb-update',
        expectedVersion: added.entity.version,
      },
    );
    expect(updated.entity).toMatchObject({ version: 2, value: expect.stringContaining('800') });
  });

  it('requires a scoped confirmation before ending active private time', () => {
    const engine = new StayEngine();
    const started = engine.updatePrivacy(
      { temporaryPrivateUntil: '2026-09-02T10:00:00.000Z' },
      {
        actor,
        idempotencyKey: 'privacy-start',
        expectedVersion: 1,
        now: new Date('2026-09-02T08:00:00.000Z'),
      },
    );
    expect(started.entity.version).toBe(2);
    expect(() =>
      engine.updatePrivacy(
        { temporaryPrivateUntil: null },
        {
          actor,
          idempotencyKey: 'privacy-end-missing-confirmation',
          expectedVersion: 2,
          now: new Date('2026-09-02T08:05:00.000Z'),
        },
      ),
    ).toThrowError(/current explicit confirmation/);

    const ended = engine.updatePrivacy(
      { temporaryPrivateUntil: null },
      {
        actor,
        idempotencyKey: 'privacy-end-confirmed',
        expectedVersion: 2,
        now: new Date('2026-09-02T08:05:00.000Z'),
      },
      {
        token: 'confirmation-token-long-enough',
        purpose: 'destructive-privacy-change',
        subject: actor.subject,
        entityId: started.entity.id,
        expiresAt: '2026-09-02T08:10:00.000Z',
      },
    );
    expect(ended.entity.temporaryPrivateUntil).toBeUndefined();
    expect(ended.entity.version).toBe(3);
  });
});
