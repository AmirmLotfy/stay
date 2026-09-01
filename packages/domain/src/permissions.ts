import type { ActorContext, Permission } from '@stay/contracts';
import { StayDomainError } from './errors.js';

export function requirePermission(actor: ActorContext, permission: Permission): void {
  if (!actor.permissions.includes(permission)) {
    throw new StayDomainError('FORBIDDEN', 'You do not have permission to perform this action.');
  }
}

export function canRevealIncidentAccess(
  actor: ActorContext,
  incidentActive: boolean,
  actorAssigned: boolean,
): boolean {
  return (
    incidentActive &&
    actorAssigned &&
    actor.permissions.includes('incident:coordinate') &&
    actor.role !== 'resident'
  );
}
