import {
  McpServer,
  ResourceTemplate,
  createMcpHandler,
  originValidationResponse,
  type AuthInfo,
  type McpRequestContext,
} from '@modelcontextprotocol/server';
import { SimulatedHomeContextProvider } from '@stay/adapters';
import type {
  ActorContext,
  CommandResult,
  HelpRequest,
  Incident,
  McpToolName,
  Playbook,
  SafetyWindow,
  SourceProvenance,
} from '@stay/contracts';
import { createDemoState, StayDomainError, StayEngine, type HomeState } from '@stay/domain';
import { DynamoStayRepository, type VersionedEntity } from '@stay/persistence';
import { z } from 'zod';

const householdEngines = new Map<string, StayEngine>();
const providers = new SimulatedHomeContextProvider();
const repository = process.env.TABLE_NAME ? new DynamoStayRepository(process.env.TABLE_NAME) : null;

function householdIdFor(context: McpRequestContext): string {
  return context.authInfo?.extra?.householdId?.toString() ?? 'demo-household-sarah';
}

function mergeById<T extends { id: string }>(stored: T[], fallback: T[]): T[] {
  return [...stored, ...fallback.filter((item) => !stored.some((saved) => saved.id === item.id))];
}

async function engineFor(context: McpRequestContext): Promise<StayEngine> {
  const householdId = householdIdFor(context);
  if (repository) {
    const residentId = context.authInfo?.extra?.residentId?.toString() ?? 'resident-sarah';
    const state = createDemoState();
    state.householdId = householdId;
    state.resident.id = residentId;
    state.access.id = `access-${residentId}`;
    state.privacy.id = `privacy-${residentId}`;
    const [task, access, privacy, windows, help, incidents, playbooks, memory] = await Promise.all([
      repository.get<HomeState['oneThing']>(householdId, 'task', state.oneThing.id),
      repository.get<HomeState['access']>(householdId, 'access', state.access.id),
      repository.get<HomeState['privacy']>(householdId, 'privacy', state.privacy.id),
      repository.list<SafetyWindow>(householdId, 'safety-window'),
      repository.list<HelpRequest>(householdId, 'help-request'),
      repository.list<Incident>(householdId, 'incident'),
      repository.list<Playbook>(householdId, 'playbook'),
      repository.list<HomeState['houseMemory'][number]>(householdId, 'house-memory'),
    ]);
    if (task) state.oneThing = task;
    if (access) state.access = access;
    if (privacy) state.privacy = privacy;
    state.safetyWindows = mergeById(windows, state.safetyWindows);
    state.helpRequests = mergeById(help, state.helpRequests);
    state.incidents = mergeById(incidents, state.incidents);
    state.playbooks = mergeById(playbooks, state.playbooks);
    state.houseMemory = mergeById(memory, state.houseMemory);
    return new StayEngine(state);
  }
  const existing = householdEngines.get(householdId);
  if (existing) return existing;
  if (householdEngines.size >= 100) {
    const oldest = householdEngines.keys().next().value as string | undefined;
    if (oldest) householdEngines.delete(oldest);
  }
  const engine = new StayEngine();
  householdEngines.set(householdId, engine);
  return engine;
}

async function executeCommand<T extends VersionedEntity>(
  context: McpRequestContext,
  input: {
    aggregateType: string;
    idempotencyKey: string;
    expectedVersion: number;
    create?: boolean;
  },
  operation: (engine: StayEngine) => CommandResult<T>,
): Promise<CommandResult<T>> {
  const householdId = householdIdFor(context);
  if (repository) {
    const prior = await repository.getIdempotency(householdId, input.idempotencyKey);
    if (prior) {
      const entity = await repository.get<T>(householdId, prior.aggregateType, prior.aggregateId);
      if (entity) {
        return {
          entity,
          version: entity.version,
          emittedEvents: [],
          confirmationRequired: null,
          provenance: liveProvenance(),
        };
      }
    }
  }
  const engine = await engineFor(context);
  const result = operation(engine);
  const event = result.emittedEvents[0];
  if (repository && event) {
    await repository.write({
      householdId,
      aggregateType: input.aggregateType,
      entity: result.entity,
      expectedVersion: input.create ? 0 : input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      idempotencyExpiresAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
      event,
    });
  }
  return result;
}

const EntityActionSchema = z.object({
  action: z.string().min(1).max(80),
  entityId: z.string().max(120).optional(),
  expectedVersion: z.number().int().positive().optional(),
  memberId: z.string().max(120).optional(),
  value: z.string().max(500).optional(),
});

const HelpInputSchema = z.object({
  title: z.string().min(1).max(120),
  detail: z.string().min(1).max(500),
  urgency: z.enum(['normal', 'time-sensitive', 'urgent']).default('normal'),
  idempotencyKey: z.string().min(8).max(180),
});

function actor(ctx: McpRequestContext): ActorContext {
  const info = ctx.authInfo;
  const subject = info?.extra?.subject?.toString() ?? 'resident-sarah';
  return {
    subject,
    householdId: info?.extra?.householdId?.toString() ?? 'demo-household-sarah',
    residentId: info?.extra?.residentId?.toString() ?? 'resident-sarah',
    role: 'resident',
    correlationId: crypto.randomUUID(),
    permissions: [
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
    ],
  };
}

async function hashedResourceUri(
  kind: 'status' | 'incident' | 'setup' | 'playbook',
  scope: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`stay:${kind}:${scope}`),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `ui://stay/${kind}/${hash.slice(0, 24)}`;
}

async function toolResult(
  toolName: McpToolName,
  text: string,
  data: unknown,
  provenance: SourceProvenance,
  kind: 'status' | 'incident' | 'setup' | 'playbook' = 'status',
  scope = 'home',
) {
  const resourceUri = await hashedResourceUri(kind, scope);
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: { toolName, data, provenance, resourceUri },
    _meta: {
      'ui/resourceUri': resourceUri,
      'stay/provenance': provenance,
    },
  };
}

function liveProvenance(): SourceProvenance {
  return {
    mode: 'live',
    provider: 'STAY deterministic application service',
    observedAt: new Date().toISOString(),
  };
}

function registerTools(server: McpServer, context: McpRequestContext): void {
  server.registerTool(
    'get_home_overview',
    {
      title: 'Get home overview',
      description:
        'Read Sarah’s calm home summary, next task, calendar, and active coordination state.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const engine = await engineFor(context);
      const state = engine.snapshot();
      const weather = await providers.getWeather();
      return toolResult(
        'get_home_overview',
        `${state.resident.firstName}’s home is settled. One thing: ${state.oneThing.title}.`,
        {
          residentStatus: state.resident.status,
          oneThing: state.oneThing,
          calendar: state.calendar,
          activeIncidentCount: state.incidents.filter((item) => item.state !== 'resolved').length,
          weather,
        },
        liveProvenance(),
      );
    },
  );

  server.registerTool(
    'manage_task_session',
    {
      title: 'Manage one task session',
      description: 'Start, pause, resume, or complete a focused One Thing session.',
      inputSchema: EntityActionSchema.extend({ idempotencyKey: z.string().min(8).max(180) }),
      annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ action, expectedVersion = 1, idempotencyKey }) => {
      const taskAction = z
        .enum(['start', 'pause', 'resume', 'complete', 'cancel', 'reset'])
        .parse(action);
      const result = await executeCommand(
        context,
        { aggregateType: 'task', idempotencyKey, expectedVersion },
        (engine) =>
          engine.manageTaskSession(taskAction, {
            actor: actor(context),
            idempotencyKey,
            expectedVersion,
          }),
      );
      return toolResult(
        'manage_task_session',
        `One Thing task is ${result.entity.state}.`,
        result,
        result.provenance,
      );
    },
  );

  server.registerTool(
    'manage_safety_window',
    {
      title: 'Manage a Safety Window',
      description:
        'Read or apply a deterministic Safety Window transition. The model cannot choose escalation order.',
      inputSchema: EntityActionSchema.extend({ idempotencyKey: z.string().min(8).max(180) }),
      annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ action, entityId = 'window-morning', expectedVersion = 1, idempotencyKey }) => {
      if (action === 'read') {
        const engine = await engineFor(context);
        const window = engine.snapshot().safetyWindows.find((item) => item.id === entityId);
        return toolResult(
          'manage_safety_window',
          window ? `${window.title} is ${window.state}.` : 'Safety Window not found.',
          window ?? null,
          liveProvenance(),
        );
      }
      const result = await executeCommand(
        context,
        { aggregateType: 'safety-window', idempotencyKey, expectedVersion },
        (engine) =>
          action === 'record-missed-check'
            ? engine.markSafetyWindowMissed(entityId, {
                actor: actor(context),
                idempotencyKey,
                expectedVersion,
              })
            : ['check-in', 'close-early'].includes(action)
              ? engine.checkInSafetyWindow(
                  entityId,
                  { actor: actor(context), idempotencyKey, expectedVersion },
                  action === 'close-early',
                )
              : action === 'cancel'
                ? engine.cancelSafetyWindow(entityId, {
                    actor: actor(context),
                    idempotencyKey,
                    expectedVersion,
                  })
                : (() => {
                    throw new StayDomainError('BAD_REQUEST', 'Unsupported Safety Window action.');
                  })(),
      );
      return toolResult(
        'manage_safety_window',
        `${result.entity.title}: ${result.entity.state.replaceAll('-', ' ')}.`,
        result,
        result.provenance,
      );
    },
  );

  server.registerTool(
    'request_help',
    {
      title: 'Request Circle help',
      description: 'Post an ordinary or urgent help request to the resident’s configured Circle.',
      inputSchema: HelpInputSchema,
      annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ title, detail, urgency, idempotencyKey }) => {
      const result = await executeCommand(
        context,
        { aggregateType: 'help-request', idempotencyKey, expectedVersion: 0, create: true },
        (engine) =>
          engine.requestHelp({ title, detail, urgency }, { actor: actor(context), idempotencyKey }),
      );
      return toolResult(
        'request_help',
        `Help request posted: ${title}.`,
        result,
        result.provenance,
      );
    },
  );

  server.registerTool(
    'get_circle_availability',
    {
      title: 'Get Circle availability',
      description:
        'Read role-scoped availability and response estimates for the resident’s Circle.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const engine = await engineFor(context);
      const circle = engine
        .snapshot()
        .circle.map(({ id, name, role, availability, responseMinutes }) => ({
          id,
          name,
          role,
          availability,
          responseMinutes,
        }));
      return toolResult(
        'get_circle_availability',
        `${circle.filter((item) => item.availability === 'available').length} Circle members are available.`,
        circle,
        liveProvenance(),
      );
    },
  );

  server.registerTool(
    'manage_incident',
    {
      title: 'Coordinate an incident',
      description:
        'Activate, assign, accept, or resolve a resident-authorized Circle incident using deterministic policy.',
      inputSchema: EntityActionSchema.extend({ idempotencyKey: z.string().min(8).max(180) }),
      annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ action, entityId, memberId, expectedVersion = 1, idempotencyKey }) => {
      if (!entityId) throw new StayDomainError('BAD_REQUEST', 'entityId is required.');
      const result = await executeCommand(
        context,
        {
          aggregateType: 'incident',
          idempotencyKey,
          expectedVersion,
          create: action === 'activate-from-window',
        },
        (engine) => {
          if (action === 'activate-from-window')
            return engine.activateMissedWindowIncident(entityId, {
              actor: actor(context),
              idempotencyKey,
              expectedVersion,
            });
          if (action === 'ask-responder' && memberId)
            return engine.offerIncidentToMember(entityId, memberId, {
              actor: actor(context),
              idempotencyKey,
              expectedVersion,
            });
          if (action === 'accept' && memberId)
            return engine.acceptIncident(entityId, memberId, {
              actor: actor(context),
              idempotencyKey,
              expectedVersion,
            });
          if (action === 'resolve')
            return engine.resolveIncident(entityId, {
              actor: actor(context),
              idempotencyKey,
              expectedVersion,
            });
          if (action === 'escalate')
            return engine.escalateIncident(entityId, {
              actor: actor(context),
              idempotencyKey,
              expectedVersion,
            });
          throw new StayDomainError('BAD_REQUEST', 'Unsupported incident action.');
        },
      );
      const last = result.entity.timeline.at(-1)?.title ?? result.entity.state;
      return toolResult(
        'manage_incident',
        last.endsWith('.') ? last : `${last}.`,
        result,
        result.provenance,
        'incident',
        entityId,
      );
    },
  );

  server.registerTool(
    'manage_house_memory',
    {
      title: 'Manage House Memory',
      description:
        'Read or save routine house details. Sensitive and incident-only entries are filtered from model context and cannot be written through this tool.',
      inputSchema: EntityActionSchema.extend({
        idempotencyKey: z.string().min(8).max(180).optional(),
        label: z.string().min(1).max(120).optional(),
        value: z.string().min(1).max(800).optional(),
        category: z.enum(['home', 'routine', 'maintenance', 'contact']).optional(),
        sensitivity: z.literal('routine').optional(),
      }),
      annotations: { idempotentHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({
      action,
      entityId,
      expectedVersion = 1,
      idempotencyKey,
      label,
      value,
      category,
      sensitivity,
    }) => {
      const engine = await engineFor(context);
      const visible = engine
        .snapshot()
        .houseMemory.filter((item) => item.sensitivity === 'routine');
      if (action === 'list') {
        return toolResult(
          'manage_house_memory',
          `${visible.length} routine house details are available.`,
          { items: visible, confirmationRequired: null },
          liveProvenance(),
          'setup',
        );
      }
      if (!idempotencyKey || !label || !value || !category || sensitivity !== 'routine') {
        throw new StayDomainError(
          'BAD_REQUEST',
          'Routine label, value, category, sensitivity, and idempotencyKey are required.',
        );
      }
      const input = { label, value, category, sensitivity };
      const result = await executeCommand(
        context,
        {
          aggregateType: 'house-memory',
          idempotencyKey,
          expectedVersion,
          create: action === 'add',
        },
        (current) =>
          action === 'add'
            ? current.addHouseMemory(input, { actor: actor(context), idempotencyKey })
            : action === 'update' && entityId
              ? current.updateHouseMemory(entityId, input, {
                  actor: actor(context),
                  idempotencyKey,
                  expectedVersion,
                })
              : (() => {
                  throw new StayDomainError('BAD_REQUEST', 'Unsupported House Memory action.');
                })(),
      );
      return toolResult(
        'manage_house_memory',
        `${result.entity.label} was saved as a routine house detail.`,
        result,
        result.provenance,
        'setup',
      );
    },
  );

  server.registerTool(
    'execute_playbook',
    {
      title: 'Execute a house playbook',
      description:
        'Advance one deterministic step in a power, water, heat, weather, or custom plan.',
      inputSchema: EntityActionSchema.extend({ idempotencyKey: z.string().min(8).max(180) }),
      annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ entityId, expectedVersion = 1, idempotencyKey }) => {
      if (!entityId) throw new StayDomainError('BAD_REQUEST', 'entityId is required.');
      const result = await executeCommand(
        context,
        { aggregateType: 'playbook', idempotencyKey, expectedVersion },
        (engine) =>
          engine.executePlaybook(entityId, {
            actor: actor(context),
            idempotencyKey,
            expectedVersion,
          }),
      );
      return toolResult(
        'execute_playbook',
        `${result.entity.title}: ${result.entity.state}. Provider observations are ${result.provenance.mode}.`,
        result,
        result.provenance,
        'playbook',
        entityId,
      );
    },
  );

  server.registerTool(
    'manage_privacy',
    {
      title: 'Manage privacy',
      description:
        'Read privacy state or request a confirmed change. Active authorized help and audit records cannot be suppressed.',
      inputSchema: EntityActionSchema.extend({
        idempotencyKey: z.string().min(8).max(180).optional(),
        temporaryPrivateUntil: z.iso.datetime().optional(),
      }),
      annotations: { idempotentHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ action, expectedVersion = 1, idempotencyKey, temporaryPrivateUntil }) => {
      const engine = await engineFor(context);
      const privacy = engine.snapshot().privacy;
      if (action === 'private-for-two-hours') {
        if (!idempotencyKey || !temporaryPrivateUntil) {
          throw new StayDomainError(
            'BAD_REQUEST',
            'idempotencyKey and temporaryPrivateUntil are required.',
          );
        }
        const result = await executeCommand(
          context,
          { aggregateType: 'privacy', idempotencyKey, expectedVersion },
          (current) =>
            current.updatePrivacy(
              { temporaryPrivateUntil },
              { actor: actor(context), idempotencyKey, expectedVersion },
            ),
        );
        return toolResult(
          'manage_privacy',
          'Routine sharing is temporarily paused. Requested help, active authorized incidents, and audit records still work.',
          result,
          result.provenance,
          'setup',
        );
      }
      const destructive = [
        'end-private-time',
        'resume-routine-sharing',
        'disable-audit',
        'hide-active-incident',
        'share-location-always',
      ].includes(action);
      return toolResult(
        'manage_privacy',
        destructive
          ? 'That privacy change requires explicit confirmation and policy evaluation.'
          : `Privacy mode: ${privacy.temporaryPrivateUntil ? 'temporary private time' : 'everyday sharing'}.`,
        { privacy, confirmationRequired: destructive ? 'destructive-privacy-change' : null },
        liveProvenance(),
        'setup',
      );
    },
  );

  server.registerTool(
    'perform_home_action',
    {
      title: 'Perform a home action',
      description: 'Run a clearly labeled simulated home-device action for the public demo.',
      inputSchema: EntityActionSchema,
      annotations: { idempotentHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ action, entityId }) => {
      const observation = await providers.getDeviceStatus();
      return toolResult(
        'perform_home_action',
        `${action.replaceAll('-', ' ')} is simulated; no physical device was changed.`,
        { action, entityId, devices: observation.value },
        observation.provenance,
      );
    },
  );
}

function registerWidgetResource(server: McpServer): void {
  server.registerResource(
    'STAY Alexa widget',
    new ResourceTemplate('ui://stay/{kind}/{hash}', { list: undefined }),
    {
      title: 'STAY adaptive status widget',
      description: 'Compact and fullscreen status, incident, setup, and playbook surfaces.',
      mimeType: 'text/html;profile=mcp-app',
    },
    async (uri, variables) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/html;profile=mcp-app',
          text: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{color-scheme:light dark;font-family:Arial,sans-serif;background:#f3f0e8;color:#1e2321}body{margin:0;padding:24px}.card{min-height:180px;padding:26px;border-radius:22px 7px 22px 7px;background:#245248;color:#fffefa}.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#b7d3c8}h1{font-size:clamp(28px,7vw,54px);line-height:1;margin:18px 0 10px}p{font-size:18px;opacity:.8}.tag{display:inline-block;margin-top:20px;padding:7px 10px;border:1px solid #b7d3c8;border-radius:999px;font-size:13px}@media(prefers-reduced-motion:reduce){*{animation:none!important}}</style><body><main class="card"><span class="eyebrow">STAY · ${String(variables.kind).replaceAll('-', ' ')}</span><h1 id="title">Help that keeps you in control.</h1><p id="detail">Open STAY to see the current, authorized update.</p><span class="tag">Private by design</span></main><script>window.addEventListener('message',e=>{const d=e.data?.structuredContent?.data;if(!d)return;const entity=d.entity??d;const title=entity?.timeline?.at?.(-1)?.title??entity?.title;if(title)document.getElementById('title').textContent=title;document.getElementById('detail').textContent=e.data?.content?.[0]?.text??'Current STAY update.'})</script></body></html>`,
        },
      ],
    }),
  );
}

export const mcpHandler = createMcpHandler(
  (context) => {
    const server = new McpServer({ name: 'STAY', version: '0.1.0' });
    registerWidgetResource(server);
    registerTools(server, context);
    return server;
  },
  {
    legacy: 'stateless',
    responseMode: 'auto',
    onerror: (error) =>
      console.error(
        JSON.stringify({ level: 'ERROR', service: 'stay-mcp', message: error.message }),
      ),
  },
);

export async function fetchMcp(request: Request, authInfo?: AuthInfo): Promise<Response> {
  const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => new URL(item).hostname);
  const originRejection = originValidationResponse(request, allowedOrigins);
  if (originRejection) return originRejection;
  return mcpHandler.fetch(request, authInfo ? { authInfo } : {});
}
