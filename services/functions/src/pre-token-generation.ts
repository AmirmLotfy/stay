import type { PreTokenGenerationV2TriggerEvent } from 'aws-lambda';

const scopedId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,119}$/;

function requiredScopedAttribute(
  attributes: Record<string, string | undefined>,
  name: 'custom:household_id' | 'custom:resident_id',
): string {
  const value = attributes[name];
  if (!value || !scopedId.test(value)) {
    throw new Error(`The immutable ${name} attribute is missing or invalid.`);
  }
  return value;
}

export async function handler(
  event: PreTokenGenerationV2TriggerEvent,
): Promise<PreTokenGenerationV2TriggerEvent> {
  const householdId = requiredScopedAttribute(event.request.userAttributes, 'custom:household_id');
  const residentId = requiredScopedAttribute(event.request.userAttributes, 'custom:resident_id');
  const current = event.response.claimsAndScopeOverrideDetails ?? {};
  const access = current.accessTokenGeneration ?? {};

  event.response.claimsAndScopeOverrideDetails = {
    ...current,
    accessTokenGeneration: {
      ...access,
      claimsToAddOrOverride: {
        ...access.claimsToAddOrOverride,
        'custom:household_id': householdId,
        'custom:resident_id': residentId,
      },
    },
  };
  return event;
}
