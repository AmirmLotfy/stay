import type { DomainEvent, SafetyWindow, HouseholdProfile } from '@stay/contracts';
import { transitionSafetyWindow, StayEngine, permissionsForRole } from '@stay/domain';
import { z } from 'zod';
import { log } from './logging.js';
import { DynamoStayRepository } from './repository.js';

const ScheduledTransitionSchema = z.object({
  householdId: z.string(),
  windowId: z.string(),
  transition: z.enum(['open', 'first-check', 'second-check']),
  expectedVersion: z.number().int().positive(),
  scheduledAt: z.iso.datetime(),
});

type ScheduledInvocation = z.infer<typeof ScheduledTransitionSchema> & {
  id?: string;
  detail?: unknown;
};

export async function handler(event: ScheduledInvocation): Promise<void> {
  const transition = ScheduledTransitionSchema.parse(event.detail ?? event);
  const invocationId =
    event.id ??
    `${transition.windowId}:${transition.transition}:${transition.expectedVersion}:${transition.scheduledAt}`;
  if (!process.env.TABLE_NAME) throw new Error('TABLE_NAME is not configured.');
  const repository = new DynamoStayRepository(process.env.TABLE_NAME);
  let profile: HouseholdProfile | null = null;
  if (process.env.STAY_ENVIRONMENT === 'pilot') {
    profile = await repository.get<HouseholdProfile>(
      transition.householdId,
      'profile',
      transition.householdId,
    );
    if (profile?.status !== 'active') {
      log('INFO', 'inactive household schedule suppressed', {
        householdId: transition.householdId,
      });
      return;
    }
  }
  const window = await repository.get<SafetyWindow>(
    transition.householdId,
    'safety-window',
    transition.windowId,
  );
  if (!window && profile) throw new Error('WINDOW_NOT_COMMITTED_RETRY');
  if (!window || (!profile && window.version !== transition.expectedVersion)) {
    log('INFO', 'stale or duplicate schedule became a no-op', {
      windowId: transition.windowId,
      expectedVersion: transition.expectedVersion,
      actualVersion: window?.version,
    });
    return;
  }

  const next = structuredClone(window);
  if (profile) {
    // A later one-time invocation can catch up missing predecessors. The persisted
    // deadline and terminal state, not delivery order, determine whether to advance.
    const deadline =
      transition.transition === 'open'
        ? window.startsAt
        : transition.transition === 'first-check'
          ? window.expectedBy
          : new Date(Date.parse(window.expectedBy) + window.graceMinutes * 60_000).toISOString();
    if (Date.parse(deadline) !== Date.parse(transition.scheduledAt)) return;
    if (Date.now() < Date.parse(deadline)) throw new Error('SCHEDULE_NOT_DUE_RETRY');
    if (['checked-in', 'cancelled', 'resolved', 'escalating'].includes(window.state)) return;
    if (next.state === 'scheduled') next.state = transitionSafetyWindow(next.state, 'OPEN');
    if (transition.transition !== 'open' && next.state === 'open') {
      next.state = transitionSafetyWindow(next.state, 'MISS_CHECK');
      next.checkAttempts = 1;
    }
    if (transition.transition === 'second-check') {
      if (next.state === 'first-check-missed')
        next.state = transitionSafetyWindow(next.state, 'BEGIN_GRACE');
      if (next.state === 'grace') {
        next.state = transitionSafetyWindow(next.state, 'MISS_CHECK');
        next.checkAttempts = 2;
      }
    }
    if (next.state === window.state) return;
  } else if (transition.transition === 'open') {
    next.state = transitionSafetyWindow(next.state, 'OPEN');
  } else if (transition.transition === 'first-check') {
    next.state = transitionSafetyWindow(next.state, 'MISS_CHECK');
    next.checkAttempts = 1;
  } else {
    if (next.state === 'first-check-missed')
      next.state = transitionSafetyWindow(next.state, 'BEGIN_GRACE');
    next.state = transitionSafetyWindow(next.state, 'MISS_CHECK');
    next.checkAttempts = 2;
  }
  next.version += 1;
  const occurredAt = new Date().toISOString();
  next.timeline.push({
    id: `scheduled-${transition.transition}-${invocationId}`,
    at: occurredAt,
    kind: `scheduled-${transition.transition}`,
    title:
      transition.transition === 'open'
        ? 'Safety Window opened'
        : transition.transition === 'first-check'
          ? 'First check missed'
          : 'Second check missed',
    detail:
      transition.transition === 'second-check'
        ? 'The resident’s configured Circle coordination is ready to begin.'
        : 'The deterministic Safety Window schedule advanced.',
    actorName: 'STAY Scheduler',
  });
  const domainEvent: DomainEvent = {
    id: `${next.id}:scheduled:${transition.transition}:${invocationId}`,
    type:
      transition.transition === 'open'
        ? 'SafetyWindow.Opened'
        : transition.transition === 'first-check'
          ? 'SafetyWindow.FirstCheckMissed'
          : 'SafetyWindow.EscalationStarted',
    aggregateType: 'safety-window',
    aggregateId: next.id,
    householdId: transition.householdId,
    occurredAt,
    actorSubject: 'service:eventbridge-scheduler',
    data: { state: next.state, checkAttempts: next.checkAttempts, version: next.version },
  };
  let related;
  if (profile && transition.transition === 'second-check') {
    const state = await repository.loadHouseholdState(transition.householdId);
    state.safetyWindows = state.safetyWindows.map((item) => (item.id === next.id ? next : item));
    const result = new StayEngine(state).activateMissedWindowIncident(next.id, {
      actor: {
        subject: 'service:eventbridge-scheduler',
        householdId: profile.id,
        residentId: profile.residentId,
        role: 'resident',
        permissions: permissionsForRole('resident'),
        correlationId: invocationId,
      },
      idempotencyKey: `activate:${invocationId}`,
      expectedVersion: next.version,
    });
    if (result.emittedEvents[0])
      related = {
        aggregateType: 'incident',
        entity: result.entity,
        event: result.emittedEvents[0],
      };
  }
  try {
    await repository.write({
      ...(profile ? { householdVersion: profile.version } : {}),
      ...(related ? { related } : {}),
      householdId: transition.householdId,
      aggregateType: 'safety-window',
      entity: next,
      expectedVersion: window.version,
      idempotencyKey: `schedule:${invocationId}`,
      idempotencyExpiresAt: Math.floor(Date.now() / 1000) + 86_400,
      event: domainEvent,
    });
  } catch (error) {
    if (!profile && error instanceof Error && error.name === 'TransactionCanceledException') {
      log('INFO', 'concurrent scheduled transition became a no-op', {
        windowId: transition.windowId,
        invocationId,
      });
      return;
    }
    throw error;
  }
  log('INFO', 'scheduled transition applied', {
    windowId: transition.windowId,
    transition: transition.transition,
    version: next.version,
  });
}
