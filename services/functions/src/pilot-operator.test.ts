import { describe, expect, it, vi } from 'vitest';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { PilotInputSchema, validateOperation, runPilotOperator } from './pilot-operator.js';

describe('pilot operator guardrails', () => {
  it('rejects the judge stack and synthetic namespaces', () => {
    expect(() =>
      PilotInputSchema.parse({ stack: 'StayDemoStack', householdId: 'house-one' }),
    ).toThrow();
    expect(() =>
      PilotInputSchema.parse({ stack: 'StayPilotStack', householdId: 'demo-household-one' }),
    ).toThrow();
  });
  it('requires a subject for revocation and a private output for export', () => {
    const input = PilotInputSchema.parse({ stack: 'StayPilotStack', householdId: 'house-one' });
    expect(() => validateOperation('revoke', input)).toThrow('subject');
    expect(() => validateOperation('export', input)).toThrow('output');
    expect(() => validateOperation('provision', input)).toThrow('profile');
  });
});

describe('pilot operator provider boundary', () => {
  const profile = {
    id: 'house-ava',
    version: 1,
    status: 'active',
    residentId: 'resident-ava',
    name: 'Ava Jones',
    firstName: 'Ava',
    timezone: 'UTC',
    createdAt: '2026-09-05T12:00:00Z',
    consentedAt: '2026-09-05T12:00:00Z',
    consentVersion: 'pilot-v1',
  };
  const input = () =>
    PilotInputSchema.parse({
      stack: 'StayPilotStack',
      householdId: profile.id,
      profile,
      people: [
        {
          email: 'ava@example.test',
          name: 'Ava',
          role: 'resident',
          consentedAt: profile.consentedAt,
          consentVersion: 'pilot-v1',
        },
      ],
    });
  it('validates dry runs without contacting AWS', () => {
    const aws = vi.fn();
    runPilotOperator('provision', input(), false, aws);
    expect(aws).not.toHaveBeenCalled();
  });
  it('refuses a stack whose authoritative outputs are not pilot scoped', () => {
    const aws = vi
      .fn()
      .mockReturnValueOnce({ Arn: 'arn:aws:iam::111111111111:role/operator' })
      .mockReturnValueOnce({
        Stacks: [
          {
            StackStatus: 'CREATE_COMPLETE',
            Outputs: [{ OutputKey: 'Stage', OutputValue: 'demo' }],
          },
        ],
      });
    expect(() => runPilotOperator('provision', input(), true, aws)).toThrow('Pilot identity');
    expect(aws).toHaveBeenCalledTimes(2);
  });
  it('refuses root before querying or mutating any stack', () => {
    const aws = vi.fn().mockReturnValue({ Arn: 'arn:aws:iam::111111111111:root' });
    expect(() => runPilotOperator('provision', input(), true, aws)).toThrow('not root');
    expect(aws).toHaveBeenCalledTimes(1);
  });
  it('provisions the email-only pool with suppressed invitations and private contact records', () => {
    const aws = vi.fn(
      (service: string, operation: string, request: Record<string, unknown> = {}) => {
        if (service === 'sts') return { Arn: 'arn:aws:iam::111111111111:role/operator' };
        if (service === 'cloudformation')
          return {
            Stacks: [
              {
                StackStatus: 'CREATE_COMPLETE',
                Outputs: [
                  { OutputKey: 'Stage', OutputValue: 'pilot' },
                  { OutputKey: 'ProductTableName', OutputValue: 'pilot-table' },
                  { OutputKey: 'UserPoolId', OutputValue: 'pilot-pool' },
                ],
              },
            ],
          };
        if (operation === 'get-item') {
          const key = unmarshall(request.Key as Parameters<typeof unmarshall>[0]);
          return key.PK === 'CONTROL#PILOT' ? { Item: marshall({ paused: false }) } : {};
        }
        if (service === 'sesv2') return { VerifiedForSendingStatus: true };
        if (operation === 'admin-create-user') {
          expect(request).toMatchObject({
            Username: 'ava@example.test',
            MessageAction: 'SUPPRESS',
          });
          return { User: { Attributes: [{ Name: 'sub', Value: 'subject-ava' }] } };
        }
        if (operation === 'transact-write-items') {
          const items = request.TransactItems as Array<{
            Put?: { Item: Parameters<typeof unmarshall>[0] };
          }>;
          const rows = items.flatMap((item) => (item.Put ? [unmarshall(item.Put.Item)] : []));
          const contact = rows.find((row) => row.SK === 'NOTIFICATION-CONTACT#subject-ava');
          expect(contact?.entity).toMatchObject({ email: 'ava@example.test', enabled: true });
          expect(JSON.stringify(rows.filter((row) => row !== contact))).not.toContain(
            'ava@example.test',
          );
          return {};
        }
        if (operation === 'update-item') return {};
        throw new Error(`Unexpected provider action: ${operation}`);
      },
    );
    runPilotOperator('provision', input(), true, aws);
    expect(aws.mock.calls.some(([, operation]) => operation === 'transact-write-items')).toBe(true);
  });
  it('does not report offboarding complete if a new incident commits during closure', () => {
    const calls: Array<{ operation: string; values: Record<string, unknown> }> = [];
    let incidentReads = 0;
    const aws = vi.fn(
      (service: string, operation: string, request: Record<string, unknown> = {}) => {
        if (service === 'sts') return { Arn: 'arn:aws:iam::111111111111:role/operator' };
        if (service === 'cloudformation')
          return {
            Stacks: [
              {
                StackStatus: 'CREATE_COMPLETE',
                Outputs: [
                  { OutputKey: 'Stage', OutputValue: 'pilot' },
                  { OutputKey: 'ProductTableName', OutputValue: 'pilot-table' },
                  { OutputKey: 'UserPoolId', OutputValue: 'pilot-pool' },
                ],
              },
            ],
          };
        const values = request.ExpressionAttributeValues
          ? unmarshall(request.ExpressionAttributeValues as Parameters<typeof unmarshall>[0])
          : {};
        calls.push({ operation, values });
        if (operation === 'query') {
          if (values[':prefix'] === 'MEMBERSHIP#')
            return {
              Items: [
                marshall({
                  PK: 'HOUSEHOLD#house-ava',
                  SK: 'MEMBERSHIP#subject-one',
                  entity: { id: 'subject-one', version: 1, active: true },
                }),
              ],
            };
          if (++incidentReads === 1) return { Items: [] };
          return { Items: [marshall({ entity: { id: 'incident-racing', state: 'active' } })] };
        }
        if (operation === 'get-item')
          return {
            Item: marshall({
              PK: 'HOUSEHOLD#house-ava',
              SK: 'PROFILE#house-ava',
              version: 1,
              entity: profile,
            }),
          };
        if (operation === 'update-item') {
          expect(request.ConditionExpression).toBe('#version = :expected');
          expect(values[':closed']).toBe('closed');
          return {};
        }
        throw new Error(`Unexpected provider action: ${operation}`);
      },
    );
    expect(() => runPilotOperator('offboard', input(), true, aws)).toThrow(
      'incident arrived during closure',
    );
    expect(incidentReads).toBe(2);
    expect(calls.filter((call) => call.operation === 'update-item')).toHaveLength(1);
  });
  it('rejects duplicate email identities and future consent before any provider action', () => {
    const value = input();
    value.people!.push({
      ...value.people![0]!,
      role: 'coordinator',
      memberId: 'member-other',
    });
    expect(() => validateOperation('provision', value)).toThrow('unique');
    const future = input();
    future.people![0]!.consentedAt = '2099-01-01T00:00:00Z';
    expect(() => validateOperation('provision', future)).toThrow('consent');
  });
});
