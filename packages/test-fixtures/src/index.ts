import type { ActorContext } from '@stay/contracts';
import { createDemoState } from '@stay/domain';

export const residentActorFixture: ActorContext = {
  subject: 'resident-sarah',
  householdId: 'demo-household-sarah',
  residentId: 'resident-sarah',
  role: 'resident',
  correlationId: 'fixture',
  permissions: [
    'home:read',
    'safety-window:manage',
    'help:request',
    'incident:coordinate',
    'incident:resolve',
    'playbook:execute',
  ],
};

export function isolatedDemoFixture() {
  return createDemoState(new Date('2026-09-02T10:20:00Z'));
}
