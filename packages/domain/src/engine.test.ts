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
    'playbook:execute',
  ],
};

describe('StayEngine protected demonstration', () => {
  it('coordinates the complete missed-window responder flow without a model', () => {
    const engine = new StayEngine();
    const first = engine.markSafetyWindowMissed('window-morning', {
      actor,
      idempotencyKey: 'miss-1',
      expectedVersion: 1,
      now: new Date('2026-09-02T06:31:00Z'),
    });
    expect(first.entity.state).toBe('first-check-missed');

    const second = engine.markSafetyWindowMissed('window-morning', {
      actor,
      idempotencyKey: 'miss-2',
      expectedVersion: 2,
      now: new Date('2026-09-02T06:41:00Z'),
    });
    expect(second.entity.state).toBe('escalating');

    const activated = engine.activateMissedWindowIncident('window-morning', {
      actor,
      idempotencyKey: 'activate-1',
      expectedVersion: 3,
      now: new Date('2026-09-02T06:41:01Z'),
    });
    const asked = engine.offerIncidentToMember(activated.entity.id, 'member-tom', {
      actor,
      idempotencyKey: 'ask-tom-1',
      expectedVersion: 1,
      now: new Date('2026-09-02T06:42:00Z'),
    });
    const accepted = engine.acceptIncident(asked.entity.id, 'member-tom', {
      actor,
      idempotencyKey: 'accept-tom-1',
      expectedVersion: 2,
      now: new Date('2026-09-02T06:43:00Z'),
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
      now: new Date('2026-09-02T06:31:00Z'),
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
      now: new Date('2026-09-02T06:25:00Z'),
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
});
