import type { Incident, SafetyWindow } from '@stay/contracts';
import { StayDomainError } from './errors.js';

export type SafetyWindowTransition =
  | 'OPEN'
  | 'CHECK_IN'
  | 'CLOSE_EARLY'
  | 'MISS_CHECK'
  | 'BEGIN_GRACE'
  | 'BEGIN_ESCALATION'
  | 'CANCEL'
  | 'RESOLVE';

const safetyWindowTransitions: Record<
  SafetyWindow['state'],
  Partial<Record<SafetyWindowTransition, SafetyWindow['state']>>
> = {
  scheduled: { OPEN: 'open', CANCEL: 'cancelled' },
  open: {
    CHECK_IN: 'checked-in',
    CLOSE_EARLY: 'checked-in',
    MISS_CHECK: 'first-check-missed',
    CANCEL: 'cancelled',
  },
  'checked-in': {},
  'first-check-missed': { BEGIN_GRACE: 'grace', CHECK_IN: 'checked-in', CANCEL: 'cancelled' },
  grace: {
    CHECK_IN: 'checked-in',
    MISS_CHECK: 'escalating',
    BEGIN_ESCALATION: 'escalating',
    CANCEL: 'cancelled',
  },
  escalating: { RESOLVE: 'resolved' },
  cancelled: {},
  resolved: {},
};

export function transitionSafetyWindow(
  state: SafetyWindow['state'],
  transition: SafetyWindowTransition,
): SafetyWindow['state'] {
  const next = safetyWindowTransitions[state][transition];
  if (!next)
    throw new StayDomainError(
      'CONFLICT',
      `${transition} is not legal from Safety Window state ${state}.`,
    );
  return next;
}

export type IncidentTransition =
  | 'BEGIN_VERIFICATION'
  | 'ACTIVATE'
  | 'BEGIN_COORDINATION'
  | 'ASSIGN_RESPONDER'
  | 'ESCALATE'
  | 'RESOLVE';

const incidentTransitions: Record<
  Incident['state'],
  Partial<Record<IncidentTransition, Incident['state']>>
> = {
  detected: { BEGIN_VERIFICATION: 'verifying', ACTIVATE: 'active' },
  verifying: { ACTIVATE: 'active', RESOLVE: 'resolved' },
  active: { BEGIN_COORDINATION: 'coordinating', ESCALATE: 'escalated' },
  coordinating: { ASSIGN_RESPONDER: 'responding', ESCALATE: 'escalated' },
  responding: { ESCALATE: 'escalated', RESOLVE: 'resolved' },
  escalated: { ASSIGN_RESPONDER: 'responding', RESOLVE: 'resolved' },
  resolved: {},
};

export function transitionIncident(
  state: Incident['state'],
  transition: IncidentTransition,
): Incident['state'] {
  const next = incidentTransitions[state][transition];
  if (!next)
    throw new StayDomainError(
      'CONFLICT',
      `${transition} is not legal from incident state ${state}.`,
    );
  return next;
}
