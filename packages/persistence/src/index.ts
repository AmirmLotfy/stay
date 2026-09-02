import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { ConfirmationPurpose, ConfirmationToken, DomainEvent } from '@stay/contracts';

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
}

export interface IdempotencyRecord {
  aggregateType: string;
  aggregateId: string;
  version: number;
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
    const result = await this.#client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :household AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':household': `HOUSEHOLD#${householdId}`,
          ':prefix': `${aggregateType.toUpperCase()}#`,
        },
        ConsistentRead: true,
      }),
    );
    return (result.Items ?? []).flatMap((item) => (item.entity ? [item.entity as T] : []));
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
        {
          Put: {
            TableName: this.tableName,
            Item: {
              ...aggregateKey,
              entity: command.entity,
              version: command.entity.version,
              expiresAt: command.entityExpiresAt,
            },
            ConditionExpression: 'attribute_not_exists(#version) OR #version = :expected',
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
                    'attribute_not_exists(consumedAt) AND purpose = :purpose AND subject = :subject AND entityId = :entityId AND expectedVersion = :expectedVersion',
                  ExpressionAttributeValues: {
                    ':consumedAt': command.event.occurredAt,
                    ':purpose': command.confirmation.purpose,
                    ':subject': command.confirmation.subject,
                    ':entityId': command.confirmation.entityId,
                    ':expectedVersion': command.expectedVersion,
                  },
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
