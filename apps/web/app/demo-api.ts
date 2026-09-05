import type {
  AccessPreferences,
  CommandResult,
  ConfirmationPurpose,
  ConfirmationToken,
  HouseMemoryItem,
  InterpretedIntent,
  SafetyWindowTemplate,
} from '@stay/contracts';
import type { HomeState } from '@stay/domain';
import { getAuthenticatedSession, type StayRuntimeConfig } from './auth';
import type { AuthenticatedSessionRecord } from './auth';

export const demoSessionStorageKey = 'stay-demo-session-v2';

export interface DemoSessionRecord {
  id: string;
  mode: 'isolated-demo';
  createdAt: string;
  expiresAt: string;
  isolation: string;
}

export type StaySessionRecord = DemoSessionRecord | AuthenticatedSessionRecord;

export type DemoRouteGroup =
  | 'home'
  | 'access'
  | 'circle'
  | 'safety-windows'
  | 'help-requests'
  | 'incidents'
  | 'playbooks'
  | 'privacy'
  | 'house-memory';

interface DemoView<T> {
  data: T;
}

interface DemoCommand {
  group:
    | 'home'
    | 'tasks'
    | 'access'
    | 'circle'
    | 'safety-windows'
    | 'incidents'
    | 'help-requests'
    | 'playbooks'
    | 'privacy'
    | 'house-memory';
  action: string;
  idempotencyKey: string;
  entityId?: string;
  expectedVersion?: number;
  memberId?: string;
  name?: string;
  role?: 'coordinator' | 'nearby-helper' | 'backup' | 'aide';
  priority?: number;
  availability?: HomeState['circle'][number]['availability'];
  responseMinutes?: number;
  relationship?: string;
  title?: string;
  detail?: string;
  urgency?: 'normal' | 'time-sensitive' | 'urgent';
  kind?: Exclude<HomeState['incidents'][number]['kind'], 'missed-window'>;
  severity?: HomeState['incidents'][number]['severity'];
  template?: SafetyWindowTemplate;
  startsAt?: string;
  expectedBy?: string;
  graceMinutes?: number;
  escalationMemberIds?: string[];
  steps?: string[];
  preferences?: AccessPreferences;
  label?: string;
  value?: string;
  category?: HouseMemoryItem['category'];
  sensitivity?: HouseMemoryItem['sensitivity'];
  confirmationPurpose?: ConfirmationPurpose;
  confirmationToken?: string;
  routineSharing?: boolean;
  locationSharing?: HomeState['privacy']['locationSharing'];
  temporaryPrivateUntil?: string | null;
}

interface VersionedEntity {
  id: string;
  version: number;
}

function preferNewestEntities<T extends VersionedEntity>(remote: T[], current: T[]): T[] {
  const currentById = new Map(current.map((entity) => [entity.id, entity]));
  const merged = remote.map((entity) => {
    const local = currentById.get(entity.id);
    currentById.delete(entity.id);
    return local && local.version > entity.version ? local : entity;
  });
  return [...merged, ...currentById.values()];
}

function preferNewestEntity<T extends VersionedEntity>(remote: T, current: T): T {
  return current.version > remote.version ? current : remote;
}

function parseStoredSession(raw: string | null): DemoSessionRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DemoSessionRecord>;
    if (
      typeof value.id !== 'string' ||
      typeof value.expiresAt !== 'string' ||
      new Date(value.expiresAt).getTime() <= Date.now() + 60_000
    ) {
      return null;
    }
    return {
      id: value.id,
      mode: 'isolated-demo',
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
      expiresAt: value.expiresAt,
      isolation:
        typeof value.isolation === 'string'
          ? value.isolation
          : 'This session cannot read or write authenticated households.',
    };
  } catch {
    return null;
  }
}

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    { message?: string; correlationId?: string } | T | null;
  if (!response.ok) {
    const error = body as { message?: string; correlationId?: string } | null;
    const suffix = error?.correlationId ? ` (${error.correlationId})` : '';
    throw new Error(`${error?.message ?? 'The STAY demo service is unavailable.'}${suffix}`);
  }
  return body as T;
}

export async function createDemoSession(
  config: StayRuntimeConfig,
  forceNew = false,
): Promise<DemoSessionRecord> {
  const stored = parseStoredSession(localStorage.getItem(demoSessionStorageKey));
  if (stored && !forceNew) return stored;
  const response = await fetch(`${config.apiUrl}/v1/demo-sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    cache: 'no-store',
  });
  const session = await json<DemoSessionRecord>(response);
  localStorage.setItem(demoSessionStorageKey, JSON.stringify(session));
  return session;
}

async function getDemoView<T>(
  config: StayRuntimeConfig,
  session: StaySessionRecord,
  group: DemoRouteGroup,
): Promise<T> {
  const response = await fetch(
    `${config.apiUrl}/v1/${session.mode === 'isolated-demo' ? 'demo/' : ''}${group}`,
    {
      headers:
        session.mode === 'isolated-demo'
          ? { 'x-stay-demo-session': session.id }
          : { authorization: `Bearer ${session.accessToken}` },
      cache: 'no-store',
    },
  );
  return (await json<DemoView<T>>(response)).data;
}

export async function hydrateDemoState(
  config: StayRuntimeConfig,
  session: StaySessionRecord,
  fallback: HomeState,
): Promise<HomeState> {
  const [
    home,
    access,
    circle,
    safetyWindows,
    helpRequests,
    remoteIncidents,
    playbooks,
    privacy,
    memory,
  ] = await Promise.all([
    getDemoView<Pick<HomeState, 'householdId' | 'resident' | 'oneThing' | 'calendar' | 'devices'>>(
      config,
      session,
      'home',
    ),
    getDemoView<HomeState['access']>(config, session, 'access'),
    getDemoView<HomeState['circle']>(config, session, 'circle'),
    getDemoView<HomeState['safetyWindows']>(config, session, 'safety-windows'),
    getDemoView<HomeState['helpRequests']>(config, session, 'help-requests'),
    getDemoView<HomeState['incidents']>(config, session, 'incidents'),
    getDemoView<HomeState['playbooks']>(config, session, 'playbooks'),
    getDemoView<HomeState['privacy']>(config, session, 'privacy'),
    getDemoView<HomeState['houseMemory']>(config, session, 'house-memory'),
  ]);
  if (session.mode === 'authenticated')
    return {
      ...fallback,
      ...home,
      access,
      circle,
      safetyWindows,
      helpRequests,
      incidents: remoteIncidents,
      playbooks,
      privacy,
      houseMemory: memory,
      outbox: [],
    };
  const incidents = preferNewestEntities(remoteIncidents, fallback.incidents);
  const respondingMemberIds = new Set(
    incidents
      .filter((incident) => incident.state === 'responding' && incident.assignedMemberId)
      .map((incident) => incident.assignedMemberId as string),
  );
  return {
    ...fallback,
    ...home,
    householdId: `demo-household-${session.id}`,
    oneThing: preferNewestEntity(home.oneThing, fallback.oneThing),
    devices: preferNewestEntities(home.devices, fallback.devices),
    access: preferNewestEntity(access, fallback.access),
    circle: circle.map((member) =>
      respondingMemberIds.has(member.id)
        ? { ...member, availability: 'responding' as const }
        : member,
    ),
    safetyWindows: preferNewestEntities(safetyWindows, fallback.safetyWindows),
    helpRequests: preferNewestEntities(helpRequests, fallback.helpRequests),
    incidents,
    playbooks: preferNewestEntities(playbooks, fallback.playbooks),
    privacy: preferNewestEntity(privacy, fallback.privacy),
    houseMemory: preferNewestEntities(memory, fallback.houseMemory),
  };
}

export async function runDemoCommand<T>(
  config: StayRuntimeConfig,
  session: StaySessionRecord,
  command: DemoCommand,
): Promise<CommandResult<T>> {
  const response = await fetch(
    `${config.apiUrl}/v1/${session.mode === 'isolated-demo' ? 'demo/' : ''}${command.group}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': command.idempotencyKey,
        ...(session.mode === 'isolated-demo'
          ? { 'x-stay-demo-session': session.id }
          : { authorization: `Bearer ${session.accessToken}` }),
      },
      body: JSON.stringify({
        action: command.action,
        ...(command.entityId ? { entityId: command.entityId } : {}),
        ...(command.expectedVersion ? { expectedVersion: command.expectedVersion } : {}),
        ...(command.memberId ? { memberId: command.memberId } : {}),
        ...(command.name ? { name: command.name } : {}),
        ...(command.role ? { role: command.role } : {}),
        ...(command.priority ? { priority: command.priority } : {}),
        ...(command.availability ? { availability: command.availability } : {}),
        ...(command.responseMinutes !== undefined
          ? { responseMinutes: command.responseMinutes }
          : {}),
        ...(command.relationship ? { relationship: command.relationship } : {}),
        ...(command.title ? { title: command.title } : {}),
        ...(command.detail ? { detail: command.detail } : {}),
        ...(command.urgency ? { urgency: command.urgency } : {}),
        ...(command.kind ? { kind: command.kind } : {}),
        ...(command.severity ? { severity: command.severity } : {}),
        ...(command.template ? { template: command.template } : {}),
        ...(command.startsAt ? { startsAt: command.startsAt } : {}),
        ...(command.expectedBy ? { expectedBy: command.expectedBy } : {}),
        ...(command.graceMinutes ? { graceMinutes: command.graceMinutes } : {}),
        ...(command.escalationMemberIds
          ? { escalationMemberIds: command.escalationMemberIds }
          : {}),
        ...(command.steps ? { steps: command.steps } : {}),
        ...(command.preferences ? { preferences: command.preferences } : {}),
        ...(command.label ? { label: command.label } : {}),
        ...(command.value ? { value: command.value } : {}),
        ...(command.category ? { category: command.category } : {}),
        ...(command.sensitivity ? { sensitivity: command.sensitivity } : {}),
        ...(command.confirmationPurpose
          ? { confirmationPurpose: command.confirmationPurpose }
          : {}),
        ...(command.confirmationToken ? { confirmationToken: command.confirmationToken } : {}),
        ...(typeof command.routineSharing === 'boolean'
          ? { routineSharing: command.routineSharing }
          : {}),
        ...(command.locationSharing ? { locationSharing: command.locationSharing } : {}),
        ...(command.temporaryPrivateUntil !== undefined
          ? { temporaryPrivateUntil: command.temporaryPrivateUntil }
          : {}),
      }),
      cache: 'no-store',
    },
  );
  return json<CommandResult<T>>(response);
}

export async function requestDemoConfirmation(
  config: StayRuntimeConfig,
  session: StaySessionRecord,
  input: {
    group?: 'privacy' | 'circle' | 'incidents';
    entityId: string;
    expectedVersion: number;
    purpose: ConfirmationPurpose;
    idempotencyKey: string;
  },
): Promise<ConfirmationToken> {
  const response = await fetch(
    `${config.apiUrl}/v1/${session.mode === 'isolated-demo' ? 'demo/' : ''}${input.group ?? 'privacy'}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': input.idempotencyKey,
        ...(session.mode === 'isolated-demo'
          ? { 'x-stay-demo-session': session.id }
          : { authorization: `Bearer ${session.accessToken}` }),
      },
      body: JSON.stringify({
        action: 'request-confirmation',
        entityId: input.entityId,
        expectedVersion: input.expectedVersion,
        confirmationPurpose: input.purpose,
      }),
      cache: 'no-store',
    },
  );
  return (await json<{ confirmation: ConfirmationToken }>(response)).confirmation;
}

export async function interpretDemoIntent(
  config: StayRuntimeConfig,
  session: StaySessionRecord,
  input: {
    utterance: string;
    currentSurface:
      | 'home'
      | 'tasks'
      | 'access'
      | 'windows'
      | 'circle'
      | 'incidents'
      | 'playbooks'
      | 'privacy'
      | 'memory';
    visibleEntityIds: string[];
    locale: string;
  },
): Promise<InterpretedIntent> {
  const response = await fetch(
    `${config.apiUrl}/v1/${session.mode === 'isolated-demo' ? 'demo/' : ''}intent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(session.mode === 'isolated-demo'
          ? { 'x-stay-demo-session': session.id }
          : { authorization: `Bearer ${session.accessToken}` }),
      },
      body: JSON.stringify(input),
      cache: 'no-store',
    },
  );
  return (await json<{ intent: InterpretedIntent }>(response)).intent;
}

export function connectDemoUpdates(
  config: StayRuntimeConfig,
  session: StaySessionRecord,
  onReconcile: () => void,
): () => void {
  let stopped = false;
  let attempt = 0;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let renewal: ReturnType<typeof setTimeout> | null = null;
  const connect = () => {
    const url = new URL(config.websocketUrl);
    if (session.mode === 'isolated-demo') url.searchParams.set('demoSession', session.id);
    else url.searchParams.set('mode', 'authenticated');
    socket = new WebSocket(url);
    socket.addEventListener('open', () => {
      attempt = 0;
      if (session.mode === 'authenticated') {
        const currentSocket = socket;
        void getAuthenticatedSession(config)
          .then((fresh) => {
            if (stopped || currentSocket !== socket || currentSocket?.readyState !== WebSocket.OPEN)
              return;
            if (!fresh) {
              stopped = true;
              currentSocket.close();
              onReconcile();
              return;
            }
            currentSocket.send(
              JSON.stringify({ action: 'authenticate', accessToken: fresh.accessToken }),
            );
            renewal = setTimeout(
              () => currentSocket.close(1000, 'Renew household access'),
              Math.max(1_000, fresh.expiresAt - Date.now() - 30_000),
            );
            onReconcile();
          })
          .catch(() => {
            currentSocket?.close();
            onReconcile();
          });
      } else onReconcile();
    });
    socket.addEventListener('message', onReconcile);
    socket.addEventListener('close', () => {
      if (renewal) clearTimeout(renewal);
      if (stopped) return;
      onReconcile();
      attempt += 1;
      retry = setTimeout(connect, Math.min(10_000, 500 * 2 ** attempt));
    });
  };
  connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    if (renewal) clearTimeout(renewal);
    socket?.close(1000, 'STAY surface closed');
  };
}
