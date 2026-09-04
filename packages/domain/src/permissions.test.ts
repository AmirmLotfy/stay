import type { ActorContext, Role } from '@stay/contracts';
import { describe, expect, it } from 'vitest';
import { canRevealIncidentAccess, permissionsForRole, requirePermission } from './permissions.js';

function actor(role: Role): ActorContext {
  return {
    subject: `subject-${role}`,
    householdId: 'household-sarah',
    residentId: 'resident-sarah',
    role,
    permissions: permissionsForRole(role),
    correlationId: `correlation-${role}`,
  };
}

describe('role-scoped permissions', () => {
  it('keeps resident privacy and access settings resident-controlled', () => {
    expect(() => requirePermission(actor('resident'), 'privacy:manage')).not.toThrow();
    expect(() => requirePermission(actor('coordinator'), 'privacy:manage')).toThrow(
      'You do not have permission',
    );
    expect(() => requirePermission(actor('aide'), 'access:manage')).toThrow(
      'You do not have permission',
    );
  });

  it('allows only an assigned non-resident coordinator to reveal incident access', () => {
    expect(canRevealIncidentAccess(actor('coordinator'), true, true)).toBe(true);
    expect(canRevealIncidentAccess(actor('coordinator'), true, false)).toBe(false);
    expect(canRevealIncidentAccess(actor('resident'), true, true)).toBe(false);
    expect(canRevealIncidentAccess(actor('nearby-helper'), false, true)).toBe(false);
  });

  it('does not grant Circle policy management to nearby helpers or backups', () => {
    expect(permissionsForRole('nearby-helper')).not.toContain('circle:manage');
    expect(permissionsForRole('backup')).not.toContain('circle:manage');
  });
});
