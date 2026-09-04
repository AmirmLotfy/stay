import type { PreTokenGenerationV2TriggerEvent } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { handler } from './pre-token-generation.js';

function event(attributes: Record<string, string>): PreTokenGenerationV2TriggerEvent {
  return {
    version: '2',
    triggerSource: 'TokenGeneration_HostedAuth',
    region: 'us-east-1',
    userPoolId: 'us-east-1_test',
    userName: 'resident@example.com',
    callerContext: { awsSdkVersion: 'test', clientId: 'client-test' },
    request: { userAttributes: attributes, groupConfiguration: {} },
    response: { claimsAndScopeOverrideDetails: {} },
  };
}

describe('Cognito pre-token generation', () => {
  it('copies immutable partition claims into the access token', async () => {
    const result = await handler(
      event({
        sub: 'subject-test',
        'custom:household_id': 'household-sarah',
        'custom:resident_id': 'resident-sarah',
        'custom:stay_role': 'resident',
        'custom:circle_member_id': 'member-tom',
      }),
    );

    expect(
      result.response.claimsAndScopeOverrideDetails.accessTokenGeneration?.claimsToAddOrOverride,
    ).toEqual({
      'custom:household_id': 'household-sarah',
      'custom:resident_id': 'resident-sarah',
      'custom:stay_role': 'resident',
      'custom:circle_member_id': 'member-tom',
    });
  });

  it('blocks token issuance when a partition claim is absent or malformed', async () => {
    await expect(
      handler(
        event({
          sub: 'subject-test',
          'custom:household_id': 'household-sarah',
          'custom:resident_id': '../shared',
          'custom:stay_role': 'resident',
        }),
      ),
    ).rejects.toThrow('custom:resident_id');
  });

  it('blocks token issuance for an unknown household role', async () => {
    await expect(
      handler(
        event({
          sub: 'subject-test',
          'custom:household_id': 'household-sarah',
          'custom:resident_id': 'resident-sarah',
          'custom:stay_role': 'administrator',
        }),
      ),
    ).rejects.toThrow();
  });
});
