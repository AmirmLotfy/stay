import {
  HouseholdProfileSchema,
  NotificationContactSchema,
  NotificationPreferenceSchema,
  NotificationPreferenceUpdateSchema,
  ProfileUpdateSchema,
  type ActorContext,
} from '@stay/contracts';
import { StayDomainError } from '@stay/domain';
import { commandFingerprint, type DynamoStayRepository } from './repository.js';

export async function householdApi(
  store: DynamoStayRepository,
  actor: ActorContext,
  group: 'profile' | 'notification-preferences',
  method: string,
  rawBody: string | undefined,
  idempotencyKey: string | undefined,
): Promise<unknown> {
  const authorized = await store.authorize(actor);
  const isProfile = group === 'profile';
  const id = isProfile ? actor.householdId : actor.subject;
  const type = isProfile ? 'profile' : 'notification-contact';
  const current = isProfile
    ? authorized.profile
    : NotificationContactSchema.parse(await store.get(actor.householdId, type, id));
  const publicValue = (value: unknown) =>
    isProfile ? HouseholdProfileSchema.parse(value) : NotificationPreferenceSchema.parse(value);
  if (method === 'GET')
    return {
      data: publicValue(current),
      provenance: { mode: 'live', provider: 'STAY API', observedAt: new Date().toISOString() },
    };
  if (method !== 'POST') throw new StayDomainError('BAD_REQUEST', 'Use GET or POST.');
  if (!idempotencyKey || idempotencyKey.length < 8)
    throw new StayDomainError('IDEMPOTENCY_REQUIRED', 'An idempotency key is required.');
  if (isProfile && actor.role !== 'resident')
    throw new StayDomainError('FORBIDDEN', 'Only the resident can update their profile.');
  const body = JSON.parse(rawBody ?? '{}');
  const command = isProfile
    ? ProfileUpdateSchema.parse(body)
    : NotificationPreferenceUpdateSchema.parse(body);
  const operationKey = commandFingerprint(actor, group, command);
  const prior = await store.getIdempotency(actor.householdId, idempotencyKey);
  if (prior) {
    if (
      prior.aggregateType !== type ||
      prior.aggregateId !== id ||
      prior.actorSubject !== actor.subject ||
      prior.operation !== operationKey
    )
      throw new StayDomainError('CONFLICT', 'That command key belongs to another operation.');
    return {
      entity: publicValue(current),
      version: current.version,
      emittedEvents: [],
      confirmationRequired: null,
      provenance: { mode: 'live', provider: 'STAY API', observedAt: new Date().toISOString() },
    };
  }
  if (command.expectedVersion !== current.version)
    throw new StayDomainError('STALE_VERSION', 'Reload before updating this setting.');
  if (
    !isProfile &&
    'enabled' in command &&
    command.enabled &&
    'suppression' in current &&
    current.suppression !== 'none'
  )
    throw new StayDomainError('FORBIDDEN', 'Ask your operator to review this suppressed address.');
  const changes = Object.fromEntries(
    Object.entries(command).filter(([key]) => !['action', 'expectedVersion'].includes(key)),
  );
  const next = { ...current, ...changes, version: current.version + 1 };
  const occurredAt = new Date().toISOString();
  await store.write({
    householdId: actor.householdId,
    aggregateType: type,
    entity: next,
    expectedVersion: current.version,
    operation: operationKey,
    idempotencyKey,
    idempotencyExpiresAt: Math.floor(Date.now() / 1000) + 86_400,
    authorization: {
      subject: actor.subject,
      membershipVersion: authorized.membership.version,
      profileVersion: authorized.profile.version,
      ...(authorized.circleMember ? { circleMember: authorized.circleMember } : {}),
    },
    event: {
      id: crypto.randomUUID(),
      type: isProfile ? 'Household.ProfileUpdated' : 'Notification.PreferenceUpdated',
      aggregateType: type,
      aggregateId: id,
      householdId: actor.householdId,
      actorSubject: actor.subject,
      occurredAt,
      data: { version: next.version },
    },
  });
  return {
    entity: publicValue(next),
    version: next.version,
    emittedEvents: [],
    confirmationRequired: null,
    provenance: { mode: 'live', provider: 'STAY API', observedAt: occurredAt },
  };
}
