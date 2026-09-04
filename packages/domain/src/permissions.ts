import type { ActorContext, Permission, Role } from '@stay/contracts';
import { StayDomainError } from './errors.js';

const rolePermissions: Record<Role, readonly Permission[]> = {
  resident: [
    'home:read',
    'home:act',
    'tasks:write',
    'circle:read',
    'circle:manage',
    'safety-window:read',
    'safety-window:manage',
    'help:request',
    'help:respond',
    'incident:read',
    'incident:coordinate',
    'incident:resolve',
    'access:manage',
    'privacy:manage',
    'memory:read',
    'memory:manage',
    'playbook:execute',
  ],
  coordinator: [
    'home:read',
    'home:act',
    'tasks:write',
    'circle:read',
    'circle:manage',
    'safety-window:read',
    'safety-window:manage',
    'help:request',
    'help:respond',
    'incident:read',
    'incident:coordinate',
    'incident:resolve',
    'memory:read',
    'playbook:execute',
  ],
  'nearby-helper': [
    'home:read',
    'home:act',
    'circle:read',
    'safety-window:read',
    'help:respond',
    'incident:read',
    'incident:coordinate',
    'playbook:execute',
  ],
  backup: ['home:read', 'circle:read', 'safety-window:read', 'help:respond', 'incident:read'],
  aide: [
    'home:read',
    'home:act',
    'tasks:write',
    'circle:read',
    'safety-window:read',
    'help:respond',
    'incident:read',
    'playbook:execute',
  ],
};

export function permissionsForRole(role: Role): Permission[] {
  return [...rolePermissions[role]];
}

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
