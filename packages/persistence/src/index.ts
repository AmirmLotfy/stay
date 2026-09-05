import { createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createHouseholdState, type HomeState } from '@stay/domain';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  HouseholdProfileSchema,
  HouseholdMembershipSchema,
  type ActorContext,
  type CircleMember,
  type HouseholdProfile,
  type HouseholdMembership,
  type ConfirmationPurpose,
  type ConfirmationToken,
  type DomainEvent,
} from '@stay/contracts';

/** Binds a command key to its actor, permissions, route and complete validated payload. */
export function commandFingerprint(
  actor: ActorContext,
  operation: string,
  payload: unknown,
): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return value;
  };
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonical({
          subject: actor.subject,
          role: actor.role,
          permissions: [...actor.permissions].sort(),
          operation,
          payload,
        }),
      ),
    )
    .digest('hex');
}

export interface VersionedEntity {
  id: string;
  version: number;
}

export interface WriteEntityCommand<T extends VersionedEntity> {
  householdId: string;
  aggregateType: string;
  entity: T;
  expectedVersion: number;
  idempotencyKey: string;
  event: DomainEvent;
  idempotencyExpiresAt: number;
  entityExpiresAt?: number;
  confirmation?: StoredConfirmation;
  operation?: string;
  authorization?: {
    subject: string;
    membershipVersion: number;
    profileVersion: number;
    circleMember?: { id: string; version: number };
  };
  householdVersion?: number;
  related?: { aggregateType: string; entity: VersionedEntity; event: DomainEvent };
}

export interface IdempotencyRecord {
  aggregateType: string;
  aggregateId: string;
  version: number;
  actorSubject?: string;
  operation?: string;
}

export interface StoredConfirmation extends ConfirmationToken {
  tokenHash: string;
  expectedVersion: number;
}

export class DynamoStayRepository {
  readonly #client: DynamoDBDocumentClient;

  public constructor(
    private readonly tableName: string,
    client = new DynamoDBClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
      maxAttempts: 3,
      retryMode: 'adaptive',
    }),
  ) {
    this.#client = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  public async get<T extends VersionedEntity>(
    householdId: string,
    aggregateType: string,
    id: string,
  ): Promise<T | null> {
    const result = await this.#client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `HOUSEHOLD#${householdId}`, SK: `${aggregateType.toUpperCase()}#${id}` },
        ConsistentRead: true,
      }),
    );
    return (result.Item?.entity as T | undefined) ?? null;
  }

  public async list<T extends VersionedEntity>(
    householdId: string,
    aggregateType: string,
  ): Promise<T[]> {
    const entities: T[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const result = await this.#client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :household AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: {
            ':household': `HOUSEHOLD#${householdId}`,
            ':prefix': `${aggregateType.toUpperCase()}#`,
          },
          ConsistentRead: true,
          ExclusiveStartKey: cursor,
        }),
      );
      entities.push(
        ...(result.Items ?? []).flatMap((item) => (item.entity ? [item.entity as T] : [])),
      );
      cursor = result.LastEvaluatedKey;
    } while (cursor);
    return entities;
  }

  public async authorize(
    actor: Pick<ActorContext, 'subject' | 'householdId' | 'residentId' | 'role' | 'circleMemberId'>,
  ): Promise<{
    profile: HouseholdProfile;
    membership: HouseholdMembership;
    circleMember?: { id: string; version: number };
  }> {
    const [rawProfile, rawMembership] = await Promise.all([
      this.get(actor.householdId, 'profile', actor.householdId),
      this.get(actor.householdId, 'membership', actor.subject),
    ]);
    const profile = HouseholdProfileSchema.safeParse(rawProfile);
    const membership = HouseholdMembershipSchema.safeParse(rawMembership);
    if (
      !profile.success ||
      !membership.success ||
      profile.data.id !== actor.householdId ||
      membership.data.id !== actor.subject ||
      profile.data.status !== 'active' ||
      !membership.data.active ||
      profile.data.residentId !== actor.residentId ||
      membership.data.residentId !== actor.residentId ||
      membership.data.role !== actor.role ||
      membership.data.circleMemberId !== actor.circleMemberId
    )
      throw new Error('MEMBERSHIP_REVOKED');
    let circleMember: { id: string; version: number } | undefined;
    if (actor.role !== 'resident') {
      if (!actor.circleMemberId) throw new Error('MEMBERSHIP_REVOKED');
      const member = await this.get<CircleMember>(
        actor.householdId,
        'circle-member',
        actor.circleMemberId,
      );
      if (!member?.active || member.role !== actor.role) throw new Error('MEMBERSHIP_REVOKED');
      circleMember = { id: member.id, version: member.version };
    }
    return {
      profile: profile.data,
      membership: membership.data,
      ...(circleMember ? { circleMember } : {}),
    };
  }

  public async getIdempotency(
    householdId: string,
    idempotencyKey: string,
  ): Promise<IdempotencyRecord | null> {
    const result = await this.#client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `HOUSEHOLD#${householdId}`,
          SK: `IDEMPOTENCY#${idempotencyKey}`,
        },
        ConsistentRead: true,
      }),
    );
    if (!result.Item) return null;
    return {
      aggregateType: String(result.Item.aggregateType),
      aggregateId: String(result.Item.aggregateId),
      version: Number(result.Item.version),
      ...(result.Item.actorSubject ? { actorSubject: String(result.Item.actorSubject) } : {}),
      ...(result.Item.operation ? { operation: String(result.Item.operation) } : {}),
    };
  }

  public async loadHouseholdState(householdId: string): Promise<HomeState> {
    const profile = HouseholdProfileSchema.parse(
      await this.get(householdId, 'profile', householdId),
    );
    if (profile.status !== 'active') throw new Error('MEMBERSHIP_REVOKED');
    const state = createHouseholdState(profile);
    const [task, access, privacy, circle, devices, windows, help, incidents, playbooks, memory] =
      await Promise.all([
        this.get<HomeState['oneThing']>(householdId, 'task', state.oneThing.id),
        this.get<HomeState['access']>(householdId, 'access', state.access.id),
        this.get<HomeState['privacy']>(householdId, 'privacy', state.privacy.id),
        this.list<HomeState['circle'][number]>(householdId, 'circle-member'),
        this.list<HomeState['devices'][number]>(householdId, 'device'),
        this.list<HomeState['safetyWindows'][number]>(householdId, 'safety-window'),
        this.list<HomeState['helpRequests'][number]>(householdId, 'help-request'),
        this.list<HomeState['incidents'][number]>(householdId, 'incident'),
        this.list<HomeState['playbooks'][number]>(householdId, 'playbook'),
        this.list<HomeState['houseMemory'][number]>(householdId, 'house-memory'),
      ]);
    return {
      ...state,
      oneThing: task ?? state.oneThing,
      access: access ?? state.access,
      privacy: privacy ?? state.privacy,
      circle: circle.filter((member) => member.active),
      devices,
      safetyWindows: windows,
      helpRequests: help,
      incidents,
      playbooks,
      houseMemory: memory,
    };
  }

  public async createDemoSession(input: {
    id: string;
    browserKeyHash: string;
    householdId: string;
    createdAt: string;
    expiresAt: string;
    expiresAtEpoch: number;
  }): Promise<void> {
    await this.#client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `DEMO#${input.id}`,
          SK: 'SESSION',
          ...input,
          mode: 'isolated-demo',
          expiresAt: input.expiresAtEpoch,
          expiresAtIso: input.expiresAt,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  public async createConfirmation(
    householdId: string,
    confirmation: ConfirmationToken,
    expectedVersion: number,
  ): Promise<void> {
    const tokenHash = await this.#sha256(confirmation.token);
    await this.#client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `HOUSEHOLD#${householdId}`,
          SK: `CONFIRMATION#${tokenHash}`,
          tokenHash,
          purpose: confirmation.purpose,
          subject: confirmation.subject,
          entityId: confirmation.entityId,
          expectedVersion,
          expiresAt: Math.floor(new Date(confirmation.expiresAt).getTime() / 1000),
          expiresAtIso: confirmation.expiresAt,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  public async getConfirmation(
    householdId: string,
    rawToken: string,
  ): Promise<StoredConfirmation | null> {
    const tokenHash = await this.#sha256(rawToken);
    const result = await this.#client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `HOUSEHOLD#${householdId}`, SK: `CONFIRMATION#${tokenHash}` },
        ConsistentRead: true,
      }),
    );
    if (
      !result.Item ||
      result.Item.consumedAt ||
      Number(result.Item.expiresAt) <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return {
      token: rawToken,
      tokenHash,
      purpose: result.Item.purpose as ConfirmationPurpose,
      subject: String(result.Item.subject),
      entityId: String(result.Item.entityId),
      expectedVersion: Number(result.Item.expectedVersion),
      expiresAt: String(result.Item.expiresAtIso),
    };
  }

  public async demoSessionExists(id: string): Promise<boolean> {
    const result = await this.#client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `DEMO#${id}`, SK: 'SESSION' },
        ConsistentRead: true,
      }),
    );
    return Boolean(result.Item && Number(result.Item.expiresAt) > Math.floor(Date.now() / 1000));
  }

  public async write<T extends VersionedEntity>(command: WriteEntityCommand<T>): Promise<void> {
    if (!command.idempotencyKey.trim()) throw new Error('IDEMPOTENCY_REQUIRED');
    if (command.entity.version !== command.expectedVersion + 1) {
      throw new Error('The new entity version must increment expectedVersion by exactly one.');
    }
    const partition = `HOUSEHOLD#${command.householdId}`;
    const aggregateKey = {
      PK: partition,
      SK: `${command.aggregateType.toUpperCase()}#${command.entity.id}`,
    };
    const input: TransactWriteCommandInput = {
      TransactItems: [
        ...(command.householdVersion
          ? [
              {
                ConditionCheck: {
                  TableName: this.tableName,
                  Key: { PK: partition, SK: `PROFILE#${command.householdId}` },
                  ConditionExpression: '#version = :version AND entity.#status = :active',
                  ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
                  ExpressionAttributeValues: {
                    ':version': command.householdVersion,
                    ':active': 'active',
                  },
                },
              },
            ]
          : []),
        ...(command.authorization?.circleMember &&
        !(
          command.aggregateType === 'circle-member' &&
          command.entity.id === command.authorization.circleMember.id
        )
          ? [
              {
                ConditionCheck: {
                  TableName: this.tableName,
                  Key: {
                    PK: partition,
                    SK: `CIRCLE-MEMBER#${command.authorization.circleMember.id}`,
                  },
                  ConditionExpression: '#version = :version AND entity.active = :active',
                  ExpressionAttributeNames: { '#version': 'version' },
                  ExpressionAttributeValues: {
                    ':version': command.authorization.circleMember.version,
                    ':active': true,
                  },
                },
              },
            ]
          : []),
        ...(command.authorization
          ? [
              {
                ConditionCheck: {
                  TableName: this.tableName,
                  Key: { PK: partition, SK: `MEMBERSHIP#${command.authorization.subject}` },
                  ConditionExpression: '#version = :version AND entity.active = :active',
                  ExpressionAttributeNames: { '#version': 'version' },
                  ExpressionAttributeValues: {
                    ':version': command.authorization.membershipVersion,
                    ':active': true,
                  },
                },
              },
              ...(command.aggregateType === 'profile'
                ? []
                : [
                    {
                      ConditionCheck: {
                        TableName: this.tableName,
                        Key: { PK: partition, SK: `PROFILE#${command.householdId}` },
                        ConditionExpression: '#version = :version AND entity.#status = :active',
                        ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
                        ExpressionAttributeValues: {
                          ':version': command.authorization.profileVersion,
                          ':active': 'active',
                        },
                      },
                    },
                  ]),
            ]
          : []),
        {
          Put: {
            TableName: this.tableName,
            Item: {
              ...aggregateKey,
              entity: command.entity,
              version: command.entity.version,
              expiresAt: command.entityExpiresAt,
            },
            ConditionExpression:
              command.authorization && command.expectedVersion > 0
                ? '#version = :expected'
                : 'attribute_not_exists(#version) OR #version = :expected',
            ExpressionAttributeNames: { '#version': 'version' },
            ExpressionAttributeValues: { ':expected': command.expectedVersion },
          },
        },
        {
          Put: {
            TableName: this.tableName,
            Item: {
              PK: partition,
              SK: `OUTBOX#${command.event.occurredAt}#${command.event.id}`,
              event: command.event,
              published: false,
              expiresAt: command.entityExpiresAt,
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: this.tableName,
            Item: {
              PK: partition,
              SK: `IDEMPOTENCY#${command.idempotencyKey}`,
              actorSubject: command.event.actorSubject,
              operation: command.operation,
              aggregateId: command.entity.id,
              aggregateType: command.aggregateType,
              version: command.entity.version,
              expiresAt: command.idempotencyExpiresAt,
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        ...(command.confirmation
          ? [
              {
                Update: {
                  TableName: this.tableName,
                  Key: {
                    PK: partition,
                    SK: `CONFIRMATION#${command.confirmation.tokenHash}`,
                  },
                  UpdateExpression: 'SET consumedAt = :consumedAt',
                  ConditionExpression:
                    'attribute_not_exists(consumedAt) AND purpose = :purpose AND subject = :subject AND entityId = :entityId AND expectedVersion = :expectedVersion AND expiresAt > :nowEpoch',
                  ExpressionAttributeValues: {
                    ':consumedAt': command.event.occurredAt,
                    ':nowEpoch': Math.floor(Date.now() / 1000),
                    ':purpose': command.confirmation.purpose,
                    ':subject': command.confirmation.subject,
                    ':entityId': command.confirmation.entityId,
                    ':expectedVersion': command.expectedVersion,
                  },
                },
              },
            ]
          : []),
        ...(command.related
          ? [
              {
                Put: {
                  TableName: this.tableName,
                  Item: {
                    PK: partition,
                    SK: `${command.related.aggregateType.toUpperCase()}#${command.related.entity.id}`,
                    entity: command.related.entity,
                    version: command.related.entity.version,
                  },
                  ConditionExpression: 'attribute_not_exists(PK)',
                },
              },
              {
                Put: {
                  TableName: this.tableName,
                  Item: {
                    PK: partition,
                    SK: `OUTBOX#${command.related.event.occurredAt}#${command.related.event.id}`,
                    event: command.related.event,
                    published: false,
                  },
                  ConditionExpression: 'attribute_not_exists(PK)',
                },
              },
            ]
          : []),
      ],
    };
    await this.#client.send(new TransactWriteCommand(input));
  }

  async #sha256(value: string): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
}
