import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  AccessPreferencesSchema,
  ConfirmationPurposeSchema,
  RouteGroups,
  SafetyWindowTemplateSchema,
  MinimalIntentContextSchema,
  type ActorContext,
  type CommandResult,
  type ConfirmationToken,
  type HelpRequest,
  type Incident,
  type Playbook,
  type SafetyWindow,
  type SourceProvenance,
} from '@stay/contracts';
import { createDemoState, StayDomainError, StayEngine, type HomeState } from '@stay/domain';
import { AgentUnavailableError, interpretIntent } from '@stay/agent';
import { z } from 'zod';
import { log } from './logging.js';
import {
  DynamoStayRepository,
  type StoredConfirmation,
  type VersionedEntity,
} from './repository.js';
import { createSafetyWindowSchedules } from './safety-window-schedules.js';

const localEngine = new StayEngine();
const localConfirmations = new Map<string, StoredConfirmation>();
const CommandBodySchema = z.object({
  action: z.string(),
  entityId: z.string().optional(),
  expectedVersion: z.number().int().positive().optional(),
  memberId: z.string().optional(),
  title: z.string().optional(),
  detail: z.string().optional(),
  urgency: z.enum(['normal', 'time-sensitive', 'urgent']).optional(),
  template: SafetyWindowTemplateSchema.optional(),
  startsAt: z.iso.datetime().optional(),
  expectedBy: z.iso.datetime().optional(),
  graceMinutes: z.number().int().min(1).max(60).optional(),
  escalationMemberIds: z.array(z.string().min(1)).min(1).max(8).optional(),
  steps: z.array(z.string().min(1).max(160)).min(2).max(12).optional(),
  preferences: AccessPreferencesSchema.optional(),
  label: z.string().min(1).max(120).optional(),
  value: z.string().min(1).max(800).optional(),
  category: z.enum(['home', 'routine', 'maintenance', 'contact']).optional(),
  sensitivity: z.enum(['routine', 'sensitive', 'incident-only']).optional(),
  confirmationPurpose: ConfirmationPurposeSchema.optional(),
  confirmationToken: z.string().min(24).optional(),
  routineSharing: z.boolean().optional(),
  locationSharing: z.enum(['off', 'incident-only', 'always']).optional(),
  temporaryPrivateUntil: z.iso.datetime().nullable().optional(),
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
  const householdId = claims['custom:household_id']?.toString();
  const residentId = claims['custom:resident_id']?.toString();
  if (!demo && (!householdId || !residentId)) {
    throw new StayDomainError(
      'FORBIDDEN',
      'The authenticated identity is missing its household partition claims.',
    );
  }
  return {
    subject: claims.sub?.toString() ?? `demo:${demo}`,
    householdId: householdId ?? `demo-household-${demo as string}`,
    residentId: residentId ?? 'resident-sarah',
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
  state.access.id = `access-${actor.residentId}`;
  state.privacy.id = `privacy-${actor.residentId}`;
  if (group === 'access') {
    const entity = await store.get<HomeState['access']>(
      actor.householdId,
      'access',
      id ?? state.access.id,
    );
    if (entity) state.access = entity;
  } else if (group === 'privacy') {
    const entity = await store.get<HomeState['privacy']>(
      actor.householdId,
      'privacy',
      id ?? state.privacy.id,
    );
    if (entity) state.privacy = entity;
  } else if (!id) {
    return new StayEngine(state);
  } else if (group === 'safety-windows') {
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
  } else if (group === 'house-memory') {
    const entity = await store.get<HomeState['houseMemory'][number]>(
      actor.householdId,
      'house-memory',
      id,
    );
    if (entity) state.houseMemory = [entity];
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
      access: 'access',
      privacy: 'privacy',
      'house-memory': 'house-memory',
    }[group] ?? group.replace(/s$/, '')
  );
}

async function persistedView(
  store: DynamoStayRepository,
  householdId: string,
  group: string,
): Promise<VersionedEntity[] | null> {
  if (
    !['safety-windows', 'help-requests', 'incidents', 'playbooks', 'house-memory'].includes(group)
  )
    return null;
  const values = await store.list(householdId, aggregateType(group));
  return values.length ? values : null;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const correlationId = event.requestContext.requestId || crypto.randomUUID();
  try {
    const demoRoute = event.rawPath.startsWith('/v1/demo/');
    const path = event.rawPath.replace(/^\/v1\/(?:demo\/)?/, '');
    const [group, entityId] = path.split('/');
    if (group === 'intent') {
      if (event.requestContext.http.method !== 'POST') {
        return response(
          405,
          {
            code: 'METHOD_NOT_ALLOWED',
            message: 'Use POST for intent interpretation.',
            correlationId,
          },
          correlationId,
        );
      }
      actorFrom(event, correlationId, demoRoute);
      const store = repository();
      const demoSession = demoRoute ? event.headers['x-stay-demo-session'] : undefined;
      if (demoRoute && store && !(await store.demoSessionExists(demoSession as string))) {
        throw new StayDomainError('FORBIDDEN', 'The isolated demo session is invalid or expired.');
      }
      const intent = await interpretIntent(
        MinimalIntentContextSchema.parse(event.body ? JSON.parse(event.body) : {}),
      );
      return response(
        200,
        {
          intent,
          provenance: {
            mode: 'live',
            provider: 'Amazon Bedrock through Strands Agents SDK',
            observedAt: new Date().toISOString(),
          } satisfies SourceProvenance,
        },
        correlationId,
      );
    }
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
      state.access.id = `access-${actor.residentId}`;
      state.privacy.id = `privacy-${actor.residentId}`;
      const storedTask = store
        ? await store.get<HomeState['oneThing']>(actor.householdId, 'task', 'task-one-thing')
        : null;
      if (storedTask) state.oneThing = storedTask;
      const storedAccess = store
        ? await store.get<HomeState['access']>(actor.householdId, 'access', state.access.id)
        : null;
      if (storedAccess) state.access = storedAccess;
      const storedPrivacy = store
        ? await store.get<HomeState['privacy']>(actor.householdId, 'privacy', state.privacy.id)
        : null;
      if (storedPrivacy) state.privacy = storedPrivacy;
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
      const fallback = view[group];
      const data =
        stored && Array.isArray(fallback)
          ? [
              ...stored,
              ...fallback.filter(
                (candidate) =>
                  !stored.some((persisted) => persisted.id === (candidate as { id?: string }).id),
              ),
            ]
          : (stored ?? fallback);
      return response(
        200,
        {
          data,
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
    if (group === 'privacy' && body.action === 'request-confirmation') {
      if (!body.confirmationPurpose || !body.expectedVersion) {
        throw new StayDomainError(
          'BAD_REQUEST',
          'confirmationPurpose and expectedVersion are required.',
        );
      }
      const entityIdForConfirmation = id ?? `privacy-${actor.residentId}`;
      const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
      const confirmation: ConfirmationToken = {
        token,
        purpose: body.confirmationPurpose,
        subject: actor.subject,
        entityId: entityIdForConfirmation,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      };
      if (store) {
        await store.createConfirmation(actor.householdId, confirmation, body.expectedVersion);
      } else {
        localConfirmations.set(token, {
          ...confirmation,
          tokenHash: await sha256(token),
          expectedVersion: body.expectedVersion,
        });
      }
      return response(201, { confirmation }, correlationId);
    }
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
    const confirmation = body.confirmationToken
      ? store
        ? await store.getConfirmation(actor.householdId, body.confirmationToken)
        : (localConfirmations.get(body.confirmationToken) ?? null)
      : null;
    const validConfirmation =
      confirmation &&
      confirmation.expectedVersion === body.expectedVersion &&
      confirmation.subject === actor.subject
        ? confirmation
        : undefined;
    let result: CommandResult<VersionedEntity>;
    if (
      group === 'safety-windows' &&
      body.action === 'create' &&
      body.title &&
      body.template &&
      body.startsAt &&
      body.expectedBy &&
      body.graceMinutes &&
      body.escalationMemberIds
    ) {
      result = engine.createSafetyWindow(
        {
          title: body.title,
          template: body.template,
          startsAt: body.startsAt,
          expectedBy: body.expectedBy,
          graceMinutes: body.graceMinutes,
          escalationMemberIds: body.escalationMemberIds,
        },
        { actor, idempotencyKey },
      );
    } else if (group === 'safety-windows' && id && body.action === 'record-missed-check') {
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
    } else if (group === 'access' && body.action === 'update' && body.preferences) {
      result = engine.updateAccessPreferences(body.preferences, {
        actor,
        idempotencyKey,
        expectedVersion: body.expectedVersion ?? 0,
      });
    } else if (group === 'privacy' && body.action === 'update') {
      result = engine.updatePrivacy(
        {
          ...(typeof body.routineSharing === 'boolean'
            ? { routineSharing: body.routineSharing }
            : {}),
          ...(body.locationSharing ? { locationSharing: body.locationSharing } : {}),
          ...(body.temporaryPrivateUntil !== undefined
            ? { temporaryPrivateUntil: body.temporaryPrivateUntil }
            : {}),
        },
        {
          actor,
          idempotencyKey,
          expectedVersion: body.expectedVersion ?? 0,
        },
        validConfirmation,
      );
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
    } else if (group === 'playbooks' && body.action === 'create' && body.title && body.steps) {
      result = engine.createPlaybook(
        { title: body.title, steps: body.steps },
        { actor, idempotencyKey },
      );
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
    } else if (
      group === 'house-memory' &&
      body.action === 'add' &&
      body.label &&
      body.value &&
      body.category &&
      body.sensitivity
    ) {
      result = engine.addHouseMemory(
        {
          label: body.label,
          value: body.value,
          category: body.category,
          sensitivity: body.sensitivity,
        },
        { actor, idempotencyKey },
      );
    } else if (
      group === 'house-memory' &&
      id &&
      body.action === 'update' &&
      body.label &&
      body.value &&
      body.category &&
      body.sensitivity
    ) {
      result = engine.updateHouseMemory(
        id,
        {
          label: body.label,
          value: body.value,
          category: body.category,
          sensitivity: body.sensitivity,
        },
        {
          actor,
          idempotencyKey,
          expectedVersion: body.expectedVersion ?? 0,
        },
      );
    } else {
      throw new StayDomainError('BAD_REQUEST', 'That command is not available for this route.');
    }
    if (store && group === 'safety-windows' && body.action === 'create') {
      await createSafetyWindowSchedules(actor.householdId, result.entity as SafetyWindow);
    }
    if (store && result.emittedEvents[0]) {
      const expectedVersion =
        group === 'help-requests' ||
        (group === 'safety-windows' && body.action === 'create') ||
        (group === 'playbooks' && body.action === 'create') ||
        (group === 'house-memory' && body.action === 'add') ||
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
        ...(validConfirmation ? { confirmation: validConfirmation } : {}),
      });
    }
    if (!store && result.emittedEvents[0] && validConfirmation) {
      localConfirmations.set(validConfirmation.token, {
        ...validConfirmation,
        consumedAt: result.emittedEvents[0].occurredAt,
      });
    }
    log('INFO', 'command completed', { correlationId, group, action: body.action });
    return response(200, result, correlationId);
  } catch (error) {
    const domain = error instanceof StayDomainError ? error : null;
    const agentUnavailable = error instanceof AgentUnavailableError;
    const code =
      domain?.code ??
      (error instanceof z.ZodError
        ? 'BAD_REQUEST'
        : agentUnavailable
          ? 'PROVIDER_UNAVAILABLE'
          : 'INTERNAL_ERROR');
    const status =
      code === 'FORBIDDEN'
        ? 403
        : code === 'NOT_FOUND'
          ? 404
          : code === 'STALE_VERSION' || code === 'CONFLICT' || code === 'CONFIRMATION_REQUIRED'
            ? 409
            : code === 'PROVIDER_UNAVAILABLE'
              ? 503
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
            : agentUnavailable
              ? 'AI interpretation is unavailable. Deterministic controls remain available.'
              : 'The request could not be completed.'),
        correlationId,
      },
      correlationId,
    );
  }
}
