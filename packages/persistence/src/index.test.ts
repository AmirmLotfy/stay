import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mocks.send }) },
  GetCommand: class {
    public constructor(public readonly input: unknown) {}
  },
  PutCommand: class {
    public constructor(public readonly input: unknown) {}
  },
  QueryCommand: class {
    public constructor(public readonly input: unknown) {}
  },
  TransactWriteCommand: class {
    public constructor(public readonly input: unknown) {}
  },
}));

import { DynamoStayRepository } from './index.js';

const occurredAt = '2026-09-03T12:00:00.000Z';
const entity = { id: 'incident-one', version: 2, state: 'active' };
const event = {
  id: 'event-one',
  type: 'Incident.Activated',
  aggregateType: 'incident',
  aggregateId: entity.id,
  householdId: 'household-demo',
  actorSubject: 'resident-one',
  occurredAt,
  data: {},
};

describe('DynamoStayRepository', () => {
  beforeEach(() => mocks.send.mockReset());

  it('reads consistent household-scoped aggregates and idempotency records', async () => {
    mocks.send
      .mockResolvedValueOnce({ Item: { entity } })
      .mockResolvedValueOnce({ Items: [{ entity }, { metadata: true }] })
      .mockResolvedValueOnce({
        Item: { aggregateType: 'incident', aggregateId: 'incident-one', version: 2 },
      });
    const repository = new DynamoStayRepository('stay-test');

    await expect(repository.get('household-demo', 'incident', 'incident-one')).resolves.toEqual(
      entity,
    );
    await expect(repository.list('household-demo', 'incident')).resolves.toEqual([entity]);
    await expect(repository.getIdempotency('household-demo', 'request-one')).resolves.toEqual({
      aggregateType: 'incident',
      aggregateId: 'incident-one',
      version: 2,
    });

    const first = mocks.send.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(first.input).toMatchObject({
      Key: { PK: 'HOUSEHOLD#household-demo', SK: 'INCIDENT#incident-one' },
      ConsistentRead: true,
    });
  });

  it('stores only a hash for a short-lived confirmation and rejects consumed records', async () => {
    const repository = new DynamoStayRepository('stay-test');
    const confirmation = {
      token: 'opaque-secret-token',
      purpose: 'destructive-privacy-change' as const,
      subject: 'resident-one',
      entityId: 'privacy-one',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    mocks.send.mockResolvedValueOnce({});

    await repository.createConfirmation('household-demo', confirmation, 3);

    const write = mocks.send.mock.calls[0]![0] as { input: { Item: Record<string, unknown> } };
    expect(write.input.Item.SK).toMatch(/^CONFIRMATION#[a-f0-9]{64}$/);
    expect(JSON.stringify(write.input.Item)).not.toContain(confirmation.token);

    mocks.send.mockResolvedValueOnce({
      Item: {
        ...write.input.Item,
        expiresAt: Math.floor(Date.now() / 1000) + 60,
        expiresAtIso: confirmation.expiresAt,
      },
    });
    await expect(
      repository.getConfirmation('household-demo', confirmation.token),
    ).resolves.toMatchObject({
      token: confirmation.token,
      purpose: confirmation.purpose,
      expectedVersion: 3,
    });

    mocks.send.mockResolvedValueOnce({ Item: { ...write.input.Item, consumedAt: occurredAt } });
    await expect(
      repository.getConfirmation('household-demo', confirmation.token),
    ).resolves.toBeNull();
  });

  it('atomically writes the aggregate, outbox event, idempotency record, and confirmation use', async () => {
    mocks.send.mockResolvedValue({});
    const repository = new DynamoStayRepository('stay-test');

    await repository.write({
      householdId: 'household-demo',
      aggregateType: 'incident',
      entity,
      expectedVersion: 1,
      idempotencyKey: 'request-one',
      event,
      idempotencyExpiresAt: 1_800_000_000,
      confirmation: {
        token: 'raw-token-never-stored-here',
        tokenHash: 'hashed-token',
        purpose: 'disclose-access-instructions',
        subject: 'resident-one',
        entityId: entity.id,
        expectedVersion: 1,
        expiresAt: '2026-09-03T12:05:00.000Z',
      },
    });

    const command = mocks.send.mock.calls[0]![0] as {
      input: { TransactItems: Array<Record<string, unknown>> };
    };
    expect(command.input.TransactItems).toHaveLength(4);
    expect(JSON.stringify(command.input)).toContain('OUTBOX#2026-09-03T12:00:00.000Z#event-one');
    expect(JSON.stringify(command.input)).toContain('IDEMPOTENCY#request-one');
    expect(JSON.stringify(command.input)).toContain('CONFIRMATION#hashed-token');
    expect(JSON.stringify(command.input)).not.toContain('raw-token-never-stored-here');
  });

  it('rejects missing idempotency and non-incrementing versions before DynamoDB', async () => {
    const repository = new DynamoStayRepository('stay-test');
    const base = {
      householdId: 'household-demo',
      aggregateType: 'incident',
      entity,
      expectedVersion: 1,
      idempotencyKey: 'request-one',
      event,
      idempotencyExpiresAt: 1_800_000_000,
    };

    await expect(repository.write({ ...base, idempotencyKey: ' ' })).rejects.toThrow(
      'IDEMPOTENCY_REQUIRED',
    );
    await expect(repository.write({ ...base, expectedVersion: 0 })).rejects.toThrow(
      'increment expectedVersion by exactly one',
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
