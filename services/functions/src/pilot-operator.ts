import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { HouseholdProfileSchema, ScopedIdSchema, type HouseholdMembership } from '@stay/contracts';
import { createHouseholdState, permissionsForRole } from '@stay/domain';
import { z } from 'zod';

export const PilotInputSchema = z.object({
  stack: z.literal('StayPilotStack'),
  householdId: ScopedIdSchema.refine((id) => !id.startsWith('demo-')),
  profile: HouseholdProfileSchema.optional(),
  people: z
    .array(
      z.object({
        email: z.email(),
        name: z.string().min(1).max(120),
        role: z.enum(['resident', 'coordinator', 'nearby-helper', 'backup', 'aide']),
        memberId: ScopedIdSchema.optional(),
        consentedAt: z.iso.datetime(),
        consentVersion: z.string().min(1),
        priority: z.number().int().min(1).max(20).default(1),
      }),
    )
    .min(1)
    .max(9)
    .optional(),
  subject: ScopedIdSchema.optional(),
  output: z.string().optional(),
  confirmHouseholdId: ScopedIdSchema.optional(),
  handedOffIncidentIds: z.array(ScopedIdSchema).max(100).optional(),
});
type PilotInput = z.infer<typeof PilotInputSchema>;
type Item = Record<string, unknown>;

function aws(service: string, operation: string, input: Item = {}): Item {
  // JSON travels through stdin, not shell interpolation or the process argument list.
  const value = execFileSync(
    'aws',
    [
      service,
      operation,
      '--region',
      'us-east-1',
      '--no-cli-pager',
      '--output',
      'json',
      '--cli-input-json',
      'file:///dev/stdin',
    ],
    { input: JSON.stringify(input), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  return value.trim() ? (JSON.parse(value) as Item) : {};
}

function putItem(householdId: string, type: string, entity: { id: string; version: number }): Item {
  return {
    PK: `HOUSEHOLD#${householdId}`,
    SK: `${type.toUpperCase()}#${entity.id}`,
    entity,
    version: entity.version,
  };
}

export function validateOperation(operation: string, input: PilotInput): void {
  if (
    ![
      'provision',
      'invite',
      'revoke',
      'export',
      'offboard',
      'pause',
      'resume',
      'deliveries',
      'send-invitations',
      'purge',
    ].includes(operation)
  )
    throw new Error('Unsupported pilot operation.');
  if (
    input.profile &&
    (input.profile.version !== 1 || Date.parse(input.profile.consentedAt) > Date.now())
  )
    throw new Error('Initial profile needs version 1 and recorded consent.');
  if (input.people?.some((p) => Date.parse(p.consentedAt) > Date.now()))
    throw new Error('Record consent before provisioning.');
  if (operation === 'provision') {
    if (
      !input.profile ||
      input.profile.id !== input.householdId ||
      input.profile.status !== 'active' ||
      !input.people ||
      input.people.filter((p) => p.role === 'resident').length !== 1
    )
      throw new Error('Provision requires an active matching profile and exactly one resident.');
  }
  if (operation === 'invite' && (!input.people || input.people.some((p) => p.role === 'resident')))
    throw new Error('Invite requires Circle members.');
  if (
    input.people &&
    (new Set(input.people.map((p) => p.email.toLowerCase())).size !== input.people.length ||
      new Set(input.people.filter((p) => p.memberId).map((p) => p.memberId)).size !==
        input.people.filter((p) => p.memberId).length)
  )
    throw new Error('Identity and Circle member IDs must be unique.');
  if (input.people?.some((p) => p.role !== 'resident' && !p.memberId))
    throw new Error('Circle identity requires memberId.');
  if (operation === 'purge' && (input.confirmHouseholdId !== input.householdId || !input.output))
    throw new Error(
      'Purge requires an exact household confirmation and a private deletion-receipt path.',
    );
  if (operation === 'send-invitations' && !input.people)
    throw new Error('List exact recipients before sending invitations.');
  if (operation === 'revoke' && !input.subject) throw new Error('Revoke requires a subject.');
  if (operation === 'export' && !input.output)
    throw new Error('Export requires a private output path.');
}

export function runPilotOperator(
  operation: string,
  input: PilotInput,
  apply: boolean,
  executeAws: (service: string, operation: string, input?: Item) => Item = aws,
): void {
  const aws = executeAws;
  validateOperation(operation, input);
  if (!apply) {
    process.stdout.write(
      JSON.stringify({
        mode: 'dry-run',
        operation,
        stack: input.stack,
        people: input.people?.length ?? 0,
        sendsInvitations: operation === 'send-invitations',
      }) + '\n',
    );
    return;
  }
  const identity = aws('sts', 'get-caller-identity');
  if (String(identity.Arn).endsWith(':root'))
    throw new Error('Use a least-privilege operator role, not root.');
  const stacks = aws('cloudformation', 'describe-stacks', { StackName: input.stack })
    .Stacks as Array<{
    StackStatus: string;
    Outputs: Array<{ OutputKey: string; OutputValue: string }>;
  }>;
  const stack = stacks[0];
  if (!stack || !['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus))
    throw new Error('Pilot stack must be stable.');
  const outputs = Object.fromEntries(
    stack.Outputs.map((item) => [item.OutputKey, item.OutputValue]),
  );
  if (outputs.Stage !== 'pilot' || !outputs.ProductTableName || !outputs.UserPoolId)
    throw new Error('Pilot identity could not be verified.');
  const TableName = outputs.ProductTableName;
  const UserPoolId = outputs.UserPoolId;
  const get = (SK: string, PK = `HOUSEHOLD#${input.householdId}`) => {
    const result = aws('dynamodb', 'get-item', {
      TableName,
      Key: marshall({ PK, SK }),
      ConsistentRead: true,
    });
    return result.Item ? unmarshall(result.Item as Parameters<typeof unmarshall>[0]) : null;
  };
  const query = (prefix = '') => {
    const rows: Item[] = [];
    let cursor: unknown;
    do {
      const page = aws('dynamodb', 'query', {
        TableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: marshall({
          ':pk': `HOUSEHOLD#${input.householdId}`,
          ':prefix': prefix,
        }),
        ConsistentRead: true,
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      });
      rows.push(
        ...((page.Items ?? []) as Parameters<typeof unmarshall>[0][]).map((item) =>
          unmarshall(item),
        ),
      );
      cursor = page.LastEvaluatedKey;
    } while (cursor);
    return rows;
  };
  if (operation === 'pause' || operation === 'resume') {
    aws('dynamodb', 'update-item', {
      TableName,
      Key: marshall({ PK: 'CONTROL#PILOT', SK: 'ENROLLMENT' }),
      UpdateExpression: 'SET paused = :paused',
      ExpressionAttributeValues: marshall({ ':paused': operation === 'pause' }),
    });
  } else if (operation === 'export') {
    writeFileSync(
      input.output!,
      JSON.stringify(
        { exportedAt: new Date().toISOString(), householdId: input.householdId, records: query() },
        null,
        2,
      ) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
  } else if (operation === 'deliveries') {
    const rows = query('DELIVERY#');
    process.stdout.write(
      JSON.stringify(
        rows.map(({ SK, state, createdAt, updatedAt }) => ({ SK, state, createdAt, updatedAt })),
      ) + '\n',
    );
  } else if (operation === 'send-invitations') {
    for (const person of input.people!) {
      const user = aws('cognito-idp', 'admin-get-user', { UserPoolId, Username: person.email });
      const attributes = Object.fromEntries(
        (user.UserAttributes as Array<{ Name: string; Value: string }>).map((a) => [
          a.Name,
          a.Value,
        ]),
      );
      const member = get(`MEMBERSHIP#${attributes.sub}`)?.entity as HouseholdMembership | undefined;
      if (
        !member?.active ||
        attributes['custom:household_id'] !== input.householdId ||
        attributes.email !== person.email ||
        attributes['custom:stay_role'] !== person.role
      )
        throw new Error('Invitation identity mismatch.');
      aws('cognito-idp', 'admin-create-user', {
        UserPoolId,
        Username: person.email,
        MessageAction: 'RESEND',
        DesiredDeliveryMediums: ['EMAIL'],
      });
    }
  } else if (operation === 'purge') {
    const profile = get(`PROFILE#${input.householdId}`)?.entity as { status?: string } | undefined;
    if (profile?.status !== 'closed')
      throw new Error('Offboard and verify access is disabled before purging.');
    const records = query();
    const receipt = {
      householdId: input.householdId,
      requestedAt: new Date().toISOString(),
      records: records.length,
      status: 'purge-started',
      restoreRule: 'Reapply this deletion ledger before reconnecting any restored table.',
    };
    if (existsSync(input.output!)) {
      const prior = JSON.parse(readFileSync(input.output!, 'utf8')) as {
        householdId?: string;
        status?: string;
      };
      if (
        prior.householdId !== input.householdId ||
        !['purge-started', 'purge-complete'].includes(prior.status ?? '')
      )
        throw new Error('Deletion receipt does not match this household.');
    } else
      writeFileSync(input.output!, JSON.stringify(receipt, null, 2) + '\n', {
        mode: 0o600,
        flag: 'wx',
      });
    // Keep a closed, nonpersonal tombstone so interrupted purges are resumable
    // and old tokens and late schedules remain denied after deletion.
    for (const record of records.filter((row) => row.SK !== `PROFILE#${input.householdId}`)) {
      if (String(record.SK).startsWith('MEMBERSHIP#')) {
        try {
          aws('cognito-idp', 'admin-delete-user', {
            UserPoolId,
            Username: (record.entity as HouseholdMembership).id,
          });
        } catch (error) {
          const stderr = (error as { stderr?: Buffer | string }).stderr?.toString() ?? '';
          if (!stderr.includes('UserNotFoundException')) throw error;
        }
      }
      aws('dynamodb', 'delete-item', {
        TableName,
        Key: marshall({ PK: record.PK, SK: record.SK }),
      });
    }
    aws('dynamodb', 'put-item', {
      TableName,
      Item: marshall(
        putItem(input.householdId, 'profile', {
          id: input.householdId,
          version: 1,
          status: 'closed',
        } as { id: string; version: number }),
      ),
    });
    writeFileSync(
      input.output!,
      JSON.stringify(
        { ...receipt, status: 'purge-complete', completedAt: new Date().toISOString() },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    );
    process.stdout.write(
      'Active household records removed. Retain the private deletion receipt and reapply it during every restore. Backups age out separately.\n',
    );
  } else if (operation === 'offboard' || operation === 'revoke') {
    const records =
      operation === 'revoke'
        ? ([get(`MEMBERSHIP#${input.subject}`)].filter(Boolean) as Item[])
        : query('MEMBERSHIP#');
    if (!records.length) throw new Error('No matching membership; nothing changed.');
    if (operation === 'offboard') {
      const unresolved = () =>
        query('INCIDENT#').filter(
          (record) =>
            (record.entity as { id: string; state: string }).state !== 'resolved' &&
            !input.handedOffIncidentIds?.includes((record.entity as { id: string }).id),
        );
      if (unresolved().length)
        throw new Error(
          'Resolve active incident ownership or record exact external handoff IDs before offboarding.',
        );
      const profile = get(`PROFILE#${input.householdId}`);
      if (!profile) throw new Error('Profile missing.');
      aws('dynamodb', 'update-item', {
        TableName,
        Key: marshall({ PK: profile.PK, SK: profile.SK }),
        UpdateExpression:
          'SET entity.#status = :closed, entity.#version = entity.#version + :one, #version = #version + :one',
        ConditionExpression: '#version = :expected',
        ExpressionAttributeNames: { '#status': 'status', '#version': 'version' },
        ExpressionAttributeValues: marshall({
          ':closed': 'closed',
          ':one': 1,
          ':expected': profile.version,
        }),
      });
      // Closing the versioned profile prevents new authorized/scheduler commits.
      // A concurrent incident that committed first must still receive an explicit handoff.
      if (unresolved().length)
        throw new Error(
          'Household access is closed, but an incident arrived during closure. Arrange external handoff, then rerun with exact handedOffIncidentIds; offboarding is not complete.',
        );
    }
    for (const record of records) {
      const member = record.entity as HouseholdMembership;
      aws('dynamodb', 'update-item', {
        TableName,
        Key: marshall({ PK: record.PK, SK: record.SK }),
        UpdateExpression:
          'SET entity.active = :active, entity.#version = entity.#version + :one, #version = #version + :one',
        ExpressionAttributeNames: { '#version': 'version' },
        ExpressionAttributeValues: marshall({ ':active': false, ':one': 1 }),
      });
      for (const key of [
        `NOTIFICATION-CONTACT#${member.id}`,
        ...(member.circleMemberId ? [`CIRCLE-MEMBER#${member.circleMemberId}`] : []),
      ]) {
        if (!get(key)) continue;
        const contact = key.startsWith('NOTIFICATION-CONTACT#');
        aws('dynamodb', 'update-item', {
          TableName,
          Key: marshall({ PK: record.PK, SK: key }),
          UpdateExpression: `SET entity.${contact ? 'enabled' : 'active'} = :disabled, entity.#version = entity.#version + :one, #version = #version + :one${contact ? ', entity.suppression = :removed' : ''}`,
          ExpressionAttributeNames: { '#version': 'version' },
          ExpressionAttributeValues: marshall({
            ':disabled': false,
            ':one': 1,
            ...(contact ? { ':removed': 'removed' } : {}),
          }),
        });
      }
      aws('cognito-idp', 'admin-disable-user', { UserPoolId, Username: member.id });
      aws('cognito-idp', 'admin-user-global-sign-out', { UserPoolId, Username: member.id });
    }
  } else {
    const control = get('ENROLLMENT', 'CONTROL#PILOT');
    if (control?.paused !== false)
      throw new Error('Enrollment is paused. Resume explicitly after readiness review.');
    const existingProfile = get(`PROFILE#${input.householdId}`);
    if (operation === 'provision' && existingProfile)
      throw new Error('Household exists; use invite or inspect the prior provisioning result.');
    const profile =
      operation === 'provision'
        ? input.profile!
        : HouseholdProfileSchema.parse(existingProfile?.entity);
    if (profile.status !== 'active') throw new Error('Household is inactive.');
    for (const person of input.people!) {
      const verification = aws('sesv2', 'get-email-identity', { EmailIdentity: person.email });
      if (verification.VerifiedForSendingStatus !== true)
        throw new Error('Every pilot email must be individually verified in SES.');
    }
    if (operation === 'provision') {
      aws('dynamodb', 'update-item', {
        TableName,
        Key: marshall({ PK: 'CONTROL#PILOT', SK: 'ENROLLMENT' }),
        UpdateExpression: 'ADD households :household',
        ConditionExpression:
          'paused = :false AND (attribute_not_exists(households) OR size(households) < :max) AND (attribute_not_exists(households) OR NOT contains(households,:id))',
        ExpressionAttributeValues: marshall({
          ':household': new Set([input.householdId]),
          ':false': false,
          ':max': 5,
          ':id': input.householdId,
        }),
      });
    }
    const rows: Item[] = [];
    if (operation === 'provision') {
      const state = createHouseholdState(profile);
      rows.push(
        putItem(input.householdId, 'profile', profile),
        putItem(input.householdId, 'access', state.access),
        putItem(input.householdId, 'privacy', state.privacy),
        putItem(input.householdId, 'task', state.oneThing),
      );
    }
    for (const person of input.people!) {
      const attributes = {
        email: person.email,
        email_verified: 'true',
        'custom:household_id': input.householdId,
        'custom:resident_id': profile.residentId,
        'custom:stay_role': person.role,
        ...(person.memberId ? { 'custom:circle_member_id': person.memberId } : {}),
      };
      const result = aws('cognito-idp', 'admin-create-user', {
        UserPoolId,
        Username: person.email,
        MessageAction: 'SUPPRESS',
        UserAttributes: Object.entries(attributes).map(([Name, Value]) => ({ Name, Value })),
      });
      const user = result.User as { Attributes: Array<{ Name: string; Value: string }> };
      const subject = user.Attributes.find((a) => a.Name === 'sub')?.Value;
      if (!subject)
        throw new Error('Cognito subject missing. Inspect provisioning before retrying.');
      rows.push(
        putItem(input.householdId, 'membership', {
          id: subject,
          version: 1,
          residentId: profile.residentId,
          role: person.role,
          active: true,
          ...(person.memberId ? { circleMemberId: person.memberId } : {}),
        } as HouseholdMembership),
      );
      rows.push(
        putItem(input.householdId, 'notification-contact', {
          id: subject,
          version: 1,
          email: person.email,
          verifiedAt: new Date().toISOString(),
          consentedAt: person.consentedAt,
          consentVersion: person.consentVersion,
          enabled: true,
          suppression: 'none',
        } as { id: string; version: number }),
      );
      if (person.memberId)
        rows.push(
          putItem(input.householdId, 'circle-member', {
            id: person.memberId,
            version: 1,
            active: true,
            name: person.name,
            initials: person.name
              .split(' ')
              .map((n) => n[0])
              .join('')
              .slice(0, 2),
            role: person.role,
            priority: person.priority,
            availability: 'available',
            responseMinutes: 0,
            permissions: permissionsForRole(person.role),
            relationship: 'Invited Circle member',
          } as { id: string; version: number }),
        );
    }
    aws('dynamodb', 'transact-write-items', {
      TransactItems: [
        {
          ConditionCheck: {
            TableName,
            Key: marshall({ PK: 'CONTROL#PILOT', SK: 'ENROLLMENT' }),
            ConditionExpression: 'paused = :false',
            ExpressionAttributeValues: marshall({ ':false': false }),
          },
        },
        ...(operation === 'invite'
          ? [
              {
                ConditionCheck: {
                  TableName,
                  Key: marshall({
                    PK: `HOUSEHOLD#${input.householdId}`,
                    SK: `PROFILE#${input.householdId}`,
                  }),
                  ConditionExpression: '#version = :expected AND entity.#status = :active',
                  ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
                  ExpressionAttributeValues: marshall({
                    ':expected': profile.version,
                    ':active': 'active',
                  }),
                },
              },
            ]
          : []),
        ...rows.map((row) => ({
          Put: {
            TableName,
            Item: marshall(row, { removeUndefinedValues: true }),
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        })),
      ],
    });
    process.stdout.write(
      'Provisioned with invitations suppressed. Operator must initiate the reviewed Cognito invitation delivery after checking membership records.\n',
    );
  }
  process.stdout.write(
    JSON.stringify({ operation, stack: input.stack, status: 'completed' }) + '\n',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const operation = process.argv[2] ?? '';
    const flag = process.argv.indexOf('--input');
    if (flag < 0 || !process.argv[flag + 1])
      throw new Error(
        'Provide --input with a private JSON file. Without --apply this command only validates.',
      );
    runPilotOperator(
      operation,
      PilotInputSchema.parse(JSON.parse(readFileSync(process.argv[flag + 1]!, 'utf8'))),
      process.argv.includes('--apply'),
    );
  } catch (error) {
    process.stderr.write(
      error instanceof Error && !('stderr' in error)
        ? error.message + '\n'
        : 'AWS operation failed. Inspect the exact household before retrying; private request output was suppressed.\n',
    );
    process.exitCode = 1;
  }
}
