import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  RouteGroups,
  type ActorContext,
  type CommandResult,
  type HelpRequest,
  type Incident,
  type Playbook,
  type SafetyWindow,
  type SourceProvenance,
} from '@stay/contracts';
import { createDemoState, StayDomainError, StayEngine, type HomeState } from '@stay/domain';
import { z } from 'zod';
import { log } from './logging.js';
import { DynamoStayRepository, type VersionedEntity } from './repository.js';

const localEngine = new StayEngine();
const CommandBodySchema = z.object({
  action: z.string(),
  entityId: z.string().optional(),
  expectedVersion: z.number().int().positive().optional(),
  memberId: z.string().optional(),
  title: z.string().optional(),
  detail: z.string().optional(),
  urgency: z.enum(['normal', 'time-sensitive', 'urgent']).optional(),
});

function response(
  statusCode: number,
  body: unknown,
  correlationId: string,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-correlation-id': correlationId,
    },
    body: JSON.stringify(body),
  };
}

function repository(): DynamoStayRepository | null {
  return process.env.TABLE_NAME ? new DynamoStayRepository(process.env.TABLE_NAME) : null;
}

function actorFrom(
  event: APIGatewayProxyEventV2,
  correlationId: string,
  allowDemo: boolean,
): ActorContext {
  const authorized = event.requestContext as typeof event.requestContext & {
    authorizer?: {
      jwt?: { claims?: Record<string, string | number | boolean | string[]>; scopes?: string[] };
    };
  };
  const claims = authorized.authorizer?.jwt?.claims ?? {};
  const scopes = authorized.authorizer?.jwt?.scopes ?? [];
  const demo = allowDemo ? event.headers['x-stay-demo-session'] : undefined;
  if (!claims.sub && !demo)
    throw new StayDomainError(
      'FORBIDDEN',
      'Authentication or an isolated demo session is required.',
    );
  return {
    subject: claims.sub?.toString() ?? `demo:${demo}`,
    householdId: claims['custom:household_id']?.toString() ?? `demo-household-${demo as string}`,
    residentId: claims['custom:resident_id']?.toString() ?? 'resident-sarah',
    role: 'resident',
    correlationId,
    permissions: (demo || scopes.includes('stay/app')
      ? [
          'home:read',
          'tasks:write',
          'circle:read',
          'safety-window:read',
          'safety-window:manage',
          'help:request',
          'help:respond',
          'incident:read',
          'incident:coordinate',
          'incident:resolve',
          'access:manage',
          'privacy:manage',
          'memory:read',
          'memory:manage',
          'playbook:execute',
        ]
      : []) as ActorContext['permissions'],
  };
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function commandEngine(
  store: DynamoStayRepository,
  actor: ActorContext,
  group: string,
  action: string,
  id?: string,
): Promise<StayEngine> {
  const state = createDemoState();
  state.householdId = actor.householdId;
  state.resident.id = actor.residentId;
  if (!id) return new StayEngine(state);
  if (group === 'safety-windows') {
    const entity = await store.get<SafetyWindow>(actor.householdId, 'safety-window', id);
    if (entity) state.safetyWindows = [entity];
  } else if (group === 'tasks') {
    const entity = await store.get<HomeState['oneThing']>(
      actor.householdId,
      'task',
      id ?? 'task-one-thing',
    );
    if (entity) state.oneThing = entity;
  } else if (group === 'incidents' && action === 'activate-from-window') {
    const source = await store.get<SafetyWindow>(actor.householdId, 'safety-window', id);
    if (source) state.safetyWindows = [source];
    const existing = await store.get<Incident>(actor.householdId, 'incident', `incident-${id}`);
    if (existing) state.incidents = [existing];
  } else if (group === 'incidents') {
    const entity = await store.get<Incident>(actor.householdId, 'incident', id);
    if (entity) state.incidents = [entity];
  } else if (group === 'help-requests') {
    const entity = await store.get<HelpRequest>(actor.householdId, 'help-request', id);
    if (entity) state.helpRequests = [entity];
  } else if (group === 'playbooks') {
    const entity = await store.get<Playbook>(actor.householdId, 'playbook', id);
    if (entity) state.playbooks = [entity];
  }
  return new StayEngine(state);
}

function aggregateType(group: string): string {
  return (
    {
      'safety-windows': 'safety-window',
      incidents: 'incident',
      'help-requests': 'help-request',
      playbooks: 'playbook',
    }[group] ?? group.replace(/s$/, '')
  );
}

async function persistedView(
  store: DynamoStayRepository,
  householdId: string,
  group: string,
): Promise<VersionedEntity[] | null> {
  if (!['safety-windows', 'help-requests', 'incidents', 'playbooks'].includes(group)) return null;
  const values = await store.list(householdId, aggregateType(group));
  return values.length ? values : null;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const correlationId = event.requestContext.requestId || crypto.randomUUID();
  try {
    const demoRoute = event.rawPath.startsWith('/v1/demo/');
    const path = event.rawPath.replace(/^\/v1\/(?:demo\/)?/, '');
    const [group, entityId] = path.split('/');
    if (!group || !RouteGroups.includes(group as (typeof RouteGroups)[number])) {
      return response(
        404,
        { code: 'NOT_FOUND', message: 'Route not found.', correlationId },
        correlationId,
      );
    }

    if (group === 'demo-sessions' && event.requestContext.http.method === 'POST') {
      const now = Date.now();
      const id = `demo-${crypto.randomUUID()}`;
      const expiresAt = new Date(now + 4 * 60 * 60 * 1000).toISOString();
      const store = repository();
      if (store) {
        await store.createDemoSession({
          id,
          browserKeyHash: await sha256(
            `${event.headers['user-agent'] ?? 'unknown'}:${id}:${crypto.randomUUID()}`,
          ),
          householdId: `demo-household-${id}`,
          createdAt: new Date(now).toISOString(),
          expiresAt,
          expiresAtEpoch: Math.floor((now + 4 * 60 * 60 * 1000) / 1000),
        });
      }
      return response(
        201,
        {
          id,
          mode: 'isolated-demo',
          createdAt: new Date(now).toISOString(),
          expiresAt,
          isolation: 'This session cannot read or write authenticated households.',
        },
        correlationId,
      );
    }

    const actor = actorFrom(event, correlationId, demoRoute);
    const store = repository();
    const demoSession = demoRoute ? event.headers['x-stay-demo-session'] : undefined;
    if (demoRoute && store && !(await store.demoSessionExists(demoSession as string))) {
      throw new StayDomainError('FORBIDDEN', 'The isolated demo session is invalid or expired.');
    }
    if (event.requestContext.http.method === 'GET') {
      const state = localEngine.snapshot();
      state.householdId = actor.householdId;
      state.resident.id = actor.residentId;
      const storedTask = store
        ? await store.get<HomeState['oneThing']>(actor.householdId, 'task', 'task-one-thing')
        : null;
      if (storedTask) state.oneThing = storedTask;
      const view: Record<string, unknown> = {
        home: { resident: state.resident, oneThing: state.oneThing, calendar: state.calendar },
        tasks: { oneThing: state.oneThing },
        access: state.access,
        circle: state.circle,
        'safety-windows': state.safetyWindows,
        'help-requests': state.helpRequests,
        incidents: state.incidents,
        playbooks: state.playbooks,
        privacy: state.privacy,
        'house-memory': state.houseMemory.filter((item) => item.sensitivity !== 'incident-only'),
        metrics: {
          activeIncidents: state.incidents.filter((item) => item.state !== 'resolved').length,
        },
      };
      const stored = store ? await persistedView(store, actor.householdId, group) : null;
      return response(
        200,
        {
          data: stored ?? view[group],
          provenance: { mode: 'live', provider: 'STAY API', observedAt: new Date().toISOString() },
        },
        correlationId,
      );
    }

    const idempotencyKey = event.headers['idempotency-key'];
    if (!idempotencyKey)
      throw new StayDomainError('IDEMPOTENCY_REQUIRED', 'Idempotency-Key is required for writes.');
    const body = CommandBodySchema.parse(event.body ? JSON.parse(event.body) : {});
    const id = body.entityId ?? entityId;
    if (store) {
      const prior = await store.getIdempotency(actor.householdId, idempotencyKey);
      if (prior) {
        const entity = await store.get<VersionedEntity>(
          actor.householdId,
          prior.aggregateType,
          prior.aggregateId,
        );
        if (entity) {
          return response(
            200,
            {
              entity,
              version: entity.version,
              emittedEvents: [],
              confirmationRequired: null,
              provenance: {
                mode: 'live',
                provider: 'STAY DynamoDB idempotency record',
                observedAt: new Date().toISOString(),
              } satisfies SourceProvenance,
            },
            correlationId,
          );
        }
      }
    }
    const engine = store ? await commandEngine(store, actor, group, body.action, id) : localEngine;
    let result: CommandResult<VersionedEntity>;
    if (group === 'safety-windows' && id && body.action === 'record-missed-check') {
      result = engine.markSafetyWindowMissed(id, {
        actor,
        idempotencyKey,
        expectedVersion: body.expectedVersion ?? 0,
      });
    } else if (group === 'tasks' && body.action) {
      const taskAction = z
        .enum(['start', 'pause', 'resume', 'complete', 'cancel', 'reset'])
        .parse(body.action);
      result = engine.manageTaskSession(taskAction, {
        actor,
        idempotencyKey,
        expectedVersion: body.expectedVersion ?? 0,
      });
    } else if (
      group === 'safety-windows' &&
      id &&
      ['check-in', 'close-early'].includes(body.action)
    ) {
      result = engine.checkInSafetyWindow(
        id,
        {
          actor,
          idempotencyKey,
          expectedVersion: body.expectedVersion ?? 0,
        },
        body.action === 'close-early',
      );
    } else if (group === 'safety-windows' && id && body.action === 'cancel') {
      result = engine.cancelSafetyWindow(id, {
        actor,
        idempotencyKey,
        expectedVersion: body.expectedVersion ?? 0,
      });
    } else if (group === 'incidents' && id && body.action === 'activate-from-window') {
      result = engine.activateMissedWindowIncident(id, {
        actor,
        idempotencyKey,
        expectedVersion: body.expectedVersion ?? 0,
      });
    } else if (group === 'incidents' && id && body.action === 'ask-responder' && body.memberId) {
      result = engine.offerIncidentToMember(id, body.memberId, {
        actor,
        idempotencyKey,
        expectedVersion: body.expectedVersion ?? 0,
      });
    } else if (group === 'incidents' && id && body.action === 'accept' && body.memberId) {
      result = engine.acceptIncident(id, body.memberId, {
        actor,
        idempotencyKey,
        expectedVersion: body.expectedVersion ?? 0,
      });
    } else if (group === 'incidents' && id && body.action === 'resolve') {
      result = engine.resolveIncident(id, {
        actor,
        idempotencyKey,
        expectedVersion: body.expectedVersion ?? 0,
      });
    } else if (group === 'incidents' && id && body.action === 'escalate') {
      result = engine.escalateIncident(id, {
        actor,
        idempotencyKey,
        expectedVersion: body.expectedVersion ?? 0,
      });
    } else if (group === 'playbooks' && id && body.action === 'next-step') {
      result = engine.executePlaybook(id, {
        actor,
        idempotencyKey,
        expectedVersion: body.expectedVersion ?? 0,
      });
    } else if (group === 'help-requests' && body.action === 'create') {
      result = engine.requestHelp(
        {
          title: body.title ?? 'Help requested',
          detail: body.detail ?? '',
          urgency: body.urgency ?? 'normal',
        },
        { actor, idempotencyKey },
      );
    } else if (group === 'help-requests' && id && body.action === 'accept' && body.memberId) {
      result = engine.acceptHelpRequest(id, body.memberId, {
        actor,
        idempotencyKey,
        expectedVersion: body.expectedVersion ?? 0,
      });
    } else if (group === 'help-requests' && id && body.action === 'decline' && body.memberId) {
      result = engine.declineHelpRequest(id, body.memberId, {
        actor,
        idempotencyKey,
        expectedVersion: body.expectedVersion ?? 0,
      });
    } else if (group === 'help-requests' && id && body.action === 'complete') {
      result = engine.completeHelpRequest(id, {
        actor,
        idempotencyKey,
        expectedVersion: body.expectedVersion ?? 0,
      });
    } else {
      throw new StayDomainError('BAD_REQUEST', 'That command is not available for this route.');
    }
    if (store && result.emittedEvents[0]) {
      const expectedVersion =
        group === 'help-requests' ||
        (group === 'incidents' && body.action === 'activate-from-window')
          ? 0
          : (body.expectedVersion ?? 0);
      const demoExpiry = actor.subject.startsWith('demo:')
        ? Math.floor(Date.now() / 1000) + 4 * 60 * 60
        : undefined;
      await store.write({
        householdId: actor.householdId,
        aggregateType: aggregateType(group),
        entity: result.entity,
        expectedVersion,
        idempotencyKey,
        idempotencyExpiresAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
        ...(demoExpiry ? { entityExpiresAt: demoExpiry } : {}),
        event: result.emittedEvents[0],
      });
    }
    log('INFO', 'command completed', { correlationId, group, action: body.action });
    return response(200, result, correlationId);
  } catch (error) {
    const domain = error instanceof StayDomainError ? error : null;
    const code = domain?.code ?? (error instanceof z.ZodError ? 'BAD_REQUEST' : 'INTERNAL_ERROR');
    const status =
      code === 'FORBIDDEN'
        ? 403
        : code === 'NOT_FOUND'
          ? 404
          : code === 'STALE_VERSION' || code === 'CONFLICT'
            ? 409
            : code === 'INTERNAL_ERROR'
              ? 500
              : 400;
    log(status >= 500 ? 'ERROR' : 'WARN', 'request failed', {
      correlationId,
      code,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return response(
      status,
      {
        code,
        message:
          domain?.message ??
          (error instanceof z.ZodError
            ? 'The request body is invalid.'
            : 'The request could not be completed.'),
        correlationId,
      },
      correlationId,
    );
  }
}
