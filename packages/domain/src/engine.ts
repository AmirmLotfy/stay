import type {
  ActorContext,
  CommandResult,
  DomainEvent,
  HelpRequest,
  Incident,
  Playbook,
  SafetyWindow,
  SourceProvenance,
  TimelineEvent,
} from '@stay/contracts';
import { createDemoState, type HomeState } from './demo-state.js';
import { StayDomainError } from './errors.js';
import { requirePermission } from './permissions.js';

const domainProvenance: SourceProvenance = {
  mode: 'live',
  provider: 'STAY deterministic domain engine',
  observedAt: '2026-09-02T06:20:00.000Z',
};

export interface CommandMeta {
  actor: ActorContext;
  idempotencyKey: string;
  expectedVersion: number;
  now?: Date;
}

export class StayEngine {
  readonly #processed = new Map<string, CommandResult<unknown>>();
  #state: HomeState;

  public constructor(initialState: HomeState = createDemoState()) {
    this.#state = structuredClone(initialState);
  }

  public snapshot(): HomeState {
    return structuredClone(this.#state);
  }

  public reset(): HomeState {
    this.#state = createDemoState();
    this.#processed.clear();
    return this.snapshot();
  }

  public markSafetyWindowMissed(windowId: string, meta: CommandMeta): CommandResult<SafetyWindow> {
    requirePermission(meta.actor, 'safety-window:manage');
    return this.#idempotent<SafetyWindow>(meta.idempotencyKey, () => {
      const window = this.#window(windowId);
      this.#version(window.version, meta.expectedVersion);
      if (!['open', 'first-check-missed', 'grace'].includes(window.state)) {
        throw new StayDomainError(
          'CONFLICT',
          'This Safety Window cannot be marked missed from its current state.',
        );
      }
      const now = this.#now(meta);
      window.checkAttempts = Math.min(2, window.checkAttempts + 1);
      window.state = window.checkAttempts === 1 ? 'first-check-missed' : 'escalating';
      window.version += 1;
      const attempt = window.checkAttempts === 1 ? 'First check missed' : 'Second check missed';
      window.timeline.push(
        this.#timeline(
          now,
          'check-missed',
          attempt,
          window.checkAttempts === 1
            ? 'STAY will try once more after the grace period.'
            : 'Sarah’s escalation plan is now active.',
        ),
      );
      const event = this.#event(
        window.checkAttempts === 1
          ? 'SafetyWindow.FirstCheckMissed'
          : 'SafetyWindow.EscalationStarted',
        'safety-window',
        window.id,
        now,
        meta.actor,
        {
          state: window.state,
          checkAttempts: window.checkAttempts,
          expectedVersion: window.version,
        },
      );
      this.#outbox(event);
      return this.#result(window, [event]);
    });
  }

  public checkInSafetyWindow(
    windowId: string,
    meta: CommandMeta,
    closeEarly = false,
  ): CommandResult<SafetyWindow> {
    requirePermission(meta.actor, 'safety-window:manage');
    return this.#idempotent<SafetyWindow>(meta.idempotencyKey, () => {
      const window = this.#window(windowId);
      this.#version(window.version, meta.expectedVersion);
      if (!['open', 'first-check-missed', 'grace'].includes(window.state)) {
        throw new StayDomainError(
          'CONFLICT',
          'This Safety Window is no longer available for check-in.',
        );
      }
      const now = this.#now(meta);
      window.state = 'checked-in';
      window.version += 1;
      window.timeline.push(
        this.#timeline(
          now,
          closeEarly ? 'window-closed-early' : 'resident-checked-in',
          closeEarly ? 'Window closed early' : 'Sarah checked in',
          closeEarly
            ? 'Sarah chose to close this window before the expected time.'
            : 'Sarah confirmed that no Circle coordination is needed.',
          'Sarah',
        ),
      );
      const event = this.#event(
        closeEarly ? 'SafetyWindow.ClosedEarly' : 'SafetyWindow.CheckedIn',
        'safety-window',
        window.id,
        now,
        meta.actor,
        { state: window.state },
      );
      this.#outbox(event);
      return this.#result(window, [event]);
    });
  }

  public cancelSafetyWindow(windowId: string, meta: CommandMeta): CommandResult<SafetyWindow> {
    requirePermission(meta.actor, 'safety-window:manage');
    return this.#idempotent<SafetyWindow>(meta.idempotencyKey, () => {
      const window = this.#window(windowId);
      this.#version(window.version, meta.expectedVersion);
      if (!['scheduled', 'open', 'first-check-missed', 'grace'].includes(window.state)) {
        throw new StayDomainError('CONFLICT', 'This Safety Window cannot be cancelled now.');
      }
      const now = this.#now(meta);
      window.state = 'cancelled';
      window.version += 1;
      window.timeline.push(
        this.#timeline(
          now,
          'window-cancelled',
          'Safety Window cancelled',
          'Sarah cancelled this window. No Circle coordination will begin.',
          'Sarah',
        ),
      );
      const event = this.#event(
        'SafetyWindow.Cancelled',
        'safety-window',
        window.id,
        now,
        meta.actor,
        { state: window.state },
      );
      this.#outbox(event);
      return this.#result(window, [event]);
    });
  }

  public activateMissedWindowIncident(
    windowId: string,
    meta: CommandMeta,
  ): CommandResult<Incident> {
    requirePermission(meta.actor, 'incident:coordinate');
    return this.#idempotent<Incident>(meta.idempotencyKey, () => {
      const window = this.#window(windowId);
      this.#version(window.version, meta.expectedVersion);
      if (window.state !== 'escalating') {
        throw new StayDomainError(
          'CONFLICT',
          'The Safety Window must complete both check attempts first.',
        );
      }
      const existing = this.#state.incidents.find(
        (incident) => incident.kind === 'missed-window' && incident.state !== 'resolved',
      );
      if (existing) return this.#result(existing, []);
      const now = this.#now(meta);
      const incident: Incident = {
        id: `incident-${window.id}`,
        residentId: window.residentId,
        kind: 'missed-window',
        title: 'Sarah missed her morning check-in',
        state: 'coordinating',
        severity: 'attention',
        accessInstructionsAvailable: true,
        createdAt: now,
        version: 1,
        timeline: [
          this.#timeline(
            now,
            'incident-activated',
            'Circle coordination started',
            'Sarah’s plan asked Maya to coordinate. No emergency service was contacted.',
          ),
        ],
      };
      this.#state.incidents.unshift(incident);
      window.version += 1;
      const event = this.#event('Incident.Activated', 'incident', incident.id, now, meta.actor, {
        sourceWindowId: window.id,
        severity: incident.severity,
      });
      this.#outbox(event);
      return this.#result(incident, [event]);
    });
  }

  public offerIncidentToMember(
    incidentId: string,
    memberId: string,
    meta: CommandMeta,
  ): CommandResult<Incident> {
    requirePermission(meta.actor, 'incident:coordinate');
    return this.#idempotent<Incident>(meta.idempotencyKey, () => {
      const incident = this.#incident(incidentId);
      this.#version(incident.version, meta.expectedVersion);
      if (!['active', 'coordinating'].includes(incident.state)) {
        throw new StayDomainError('CONFLICT', 'This incident is not accepting responder offers.');
      }
      const member = this.#state.circle.find((candidate) => candidate.id === memberId);
      if (!member) throw new StayDomainError('NOT_FOUND', 'Circle member was not found.');
      if (member.availability === 'unavailable') {
        throw new StayDomainError('CONFLICT', 'That Circle member is unavailable.');
      }
      const now = this.#now(meta);
      incident.version += 1;
      incident.timeline.push(
        this.#timeline(
          now,
          'responder-asked',
          `${meta.actor.subject === 'resident-sarah' ? 'Sarah' : 'Maya'} asked ${member.name.split(' ')[0]}`,
          `${member.name} received a minimal incident request.`,
          meta.actor.subject === 'resident-sarah' ? 'Sarah' : 'Maya',
        ),
      );
      const event = this.#event(
        'Incident.ResponderAsked',
        'incident',
        incident.id,
        now,
        meta.actor,
        {
          memberId,
        },
      );
      this.#outbox(event);
      return this.#result(incident, [event]);
    });
  }

  public acceptIncident(
    incidentId: string,
    memberId: string,
    meta: CommandMeta,
  ): CommandResult<Incident> {
    requirePermission(meta.actor, 'incident:coordinate');
    return this.#idempotent<Incident>(meta.idempotencyKey, () => {
      const incident = this.#incident(incidentId);
      this.#version(incident.version, meta.expectedVersion);
      if (incident.assignedMemberId && incident.assignedMemberId !== memberId) {
        throw new StayDomainError('CONFLICT', 'Another responder already owns this incident.');
      }
      if (!['active', 'coordinating'].includes(incident.state)) {
        throw new StayDomainError('CONFLICT', 'This incident cannot be accepted now.');
      }
      const member = this.#state.circle.find((candidate) => candidate.id === memberId);
      if (!member) throw new StayDomainError('NOT_FOUND', 'Circle member was not found.');
      const now = this.#now(meta);
      incident.assignedMemberId = memberId;
      incident.state = 'responding';
      incident.version += 1;
      member.availability = 'responding';
      incident.timeline.push(
        this.#timeline(
          now,
          'responder-accepted',
          `${member.name.split(' ')[0]} is on the way`,
          `${member.name} accepted and now owns this response.`,
          member.name,
        ),
      );
      const event = this.#event(
        'Incident.ResponderAccepted',
        'incident',
        incident.id,
        now,
        meta.actor,
        {
          memberId,
          message: `${member.name.split(' ')[0]} is on the way.`,
        },
      );
      this.#outbox(event);
      return this.#result(incident, [event]);
    });
  }

  public resolveIncident(incidentId: string, meta: CommandMeta): CommandResult<Incident> {
    requirePermission(meta.actor, 'incident:resolve');
    return this.#idempotent<Incident>(meta.idempotencyKey, () => {
      const incident = this.#incident(incidentId);
      this.#version(incident.version, meta.expectedVersion);
      if (!['responding', 'escalated'].includes(incident.state)) {
        throw new StayDomainError('CONFLICT', 'A response must be underway before resolution.');
      }
      const now = this.#now(meta);
      incident.state = 'resolved';
      incident.resolvedAt = now;
      incident.version += 1;
      incident.timeline.push(
        this.#timeline(
          now,
          'incident-resolved',
          'Sarah is okay',
          'Maya confirmed the response was complete.',
          'Maya Bennett',
        ),
      );
      const member = this.#state.circle.find(
        (candidate) => candidate.id === incident.assignedMemberId,
      );
      if (member) member.availability = 'available';
      const window = this.#state.safetyWindows.find(
        (candidate) => `incident-${candidate.id}` === incident.id,
      );
      if (window) {
        window.state = 'resolved';
        window.version += 1;
      }
      const event = this.#event('Incident.Resolved', 'incident', incident.id, now, meta.actor, {});
      this.#outbox(event);
      return this.#result(incident, [event]);
    });
  }

  public escalateIncident(incidentId: string, meta: CommandMeta): CommandResult<Incident> {
    requirePermission(meta.actor, 'incident:coordinate');
    return this.#idempotent<Incident>(meta.idempotencyKey, () => {
      const incident = this.#incident(incidentId);
      this.#version(incident.version, meta.expectedVersion);
      if (!['active', 'coordinating', 'responding'].includes(incident.state)) {
        throw new StayDomainError('CONFLICT', 'This incident cannot be escalated now.');
      }
      const now = this.#now(meta);
      incident.state = 'escalated';
      incident.version += 1;
      incident.timeline.push(
        this.#timeline(
          now,
          'circle-escalated',
          'Circle plan moved to the next contact',
          'The next preconfigured Circle contact was notified. No emergency service was contacted.',
          'STAY',
        ),
      );
      const event = this.#event('Incident.Escalated', 'incident', incident.id, now, meta.actor, {
        state: incident.state,
      });
      this.#outbox(event);
      return this.#result(incident, [event]);
    });
  }

  public manageTaskSession(
    action: 'start' | 'pause' | 'resume' | 'complete' | 'cancel' | 'reset',
    meta: CommandMeta,
  ): CommandResult<HomeState['oneThing']> {
    requirePermission(meta.actor, 'tasks:write');
    return this.#idempotent<HomeState['oneThing']>(meta.idempotencyKey, () => {
      const task = this.#state.oneThing;
      this.#version(task.version, meta.expectedVersion);
      const nextState = {
        start: task.state === 'not-started' ? 'active' : null,
        pause: task.state === 'active' ? 'paused' : null,
        resume: task.state === 'paused' ? 'active' : null,
        complete: ['active', 'paused'].includes(task.state) ? 'completed' : null,
        cancel: ['not-started', 'active', 'paused'].includes(task.state) ? 'cancelled' : null,
        reset: ['completed', 'cancelled'].includes(task.state) ? 'not-started' : null,
      }[action] as HomeState['oneThing']['state'] | null;
      if (!nextState) {
        throw new StayDomainError('CONFLICT', `${action} is not available for this task now.`);
      }
      const now = this.#now(meta);
      task.state = nextState;
      task.completed = nextState === 'completed';
      task.version += 1;
      const event = this.#event(
        `TaskSession.${action[0]!.toUpperCase()}${action.slice(1)}`,
        'task',
        task.id,
        now,
        meta.actor,
        { state: task.state },
      );
      this.#outbox(event);
      return this.#result(task, [event]);
    });
  }

  public requestHelp(
    request: Pick<HelpRequest, 'title' | 'detail' | 'urgency'>,
    meta: Omit<CommandMeta, 'expectedVersion'>,
  ): CommandResult<HelpRequest> {
    requirePermission(meta.actor, 'help:request');
    return this.#idempotent<HelpRequest>(meta.idempotencyKey, () => {
      const now = this.#now(meta);
      const help: HelpRequest = {
        id: `help-${this.#state.helpRequests.length + 1}`,
        residentId: meta.actor.residentId,
        title: request.title,
        detail: request.detail,
        urgency: request.urgency,
        state: 'open',
        offeredTo: this.#state.circle
          .filter((member) => member.availability === 'available')
          .sort((a, b) => a.priority - b.priority)
          .slice(0, 2)
          .map((member) => member.id),
        createdAt: now,
        version: 1,
        timeline: [
          this.#timeline(now, 'help-opened', 'Help request posted', request.detail, 'Sarah'),
        ],
      };
      this.#state.helpRequests.unshift(help);
      const event = this.#event('HelpRequest.Opened', 'help-request', help.id, now, meta.actor, {
        urgency: help.urgency,
        offeredTo: help.offeredTo,
      });
      this.#outbox(event);
      return this.#result(help, [event]);
    });
  }

  public acceptHelpRequest(
    helpRequestId: string,
    memberId: string,
    meta: CommandMeta,
  ): CommandResult<HelpRequest> {
    requirePermission(meta.actor, 'help:respond');
    return this.#idempotent<HelpRequest>(meta.idempotencyKey, () => {
      const request = this.#helpRequest(helpRequestId);
      this.#version(request.version, meta.expectedVersion);
      if (!['open', 'offered'].includes(request.state)) {
        throw new StayDomainError('CONFLICT', 'This help request is not accepting responses.');
      }
      const member = this.#state.circle.find((candidate) => candidate.id === memberId);
      if (!member) throw new StayDomainError('NOT_FOUND', 'Circle member was not found.');
      if (member.availability === 'unavailable') {
        throw new StayDomainError('CONFLICT', 'That Circle member is unavailable.');
      }
      const now = this.#now(meta);
      request.state = 'assigned';
      request.assignedTo = member.id;
      request.version += 1;
      request.timeline.push(
        this.#timeline(
          now,
          'help-accepted',
          `${member.name.split(' ')[0]} accepted`,
          `${member.name} now owns this help request.`,
          member.name,
        ),
      );
      const event = this.#event(
        'HelpRequest.Accepted',
        'help-request',
        request.id,
        now,
        meta.actor,
        { memberId },
      );
      this.#outbox(event);
      return this.#result(request, [event]);
    });
  }

  public declineHelpRequest(
    helpRequestId: string,
    memberId: string,
    meta: CommandMeta,
  ): CommandResult<HelpRequest> {
    requirePermission(meta.actor, 'help:respond');
    return this.#idempotent<HelpRequest>(meta.idempotencyKey, () => {
      const request = this.#helpRequest(helpRequestId);
      this.#version(request.version, meta.expectedVersion);
      if (!['open', 'offered'].includes(request.state)) {
        throw new StayDomainError('CONFLICT', 'This help request is not accepting responses.');
      }
      if (!request.offeredTo.includes(memberId)) {
        throw new StayDomainError('FORBIDDEN', 'This request was not offered to that member.');
      }
      const member = this.#state.circle.find((candidate) => candidate.id === memberId);
      if (!member) throw new StayDomainError('NOT_FOUND', 'Circle member was not found.');
      const now = this.#now(meta);
      request.offeredTo = request.offeredTo.filter((candidate) => candidate !== memberId);
      request.state = request.offeredTo.length ? 'offered' : 'declined';
      request.version += 1;
      request.timeline.push(
        this.#timeline(
          now,
          'help-declined',
          `${member.name.split(' ')[0]} declined`,
          request.offeredTo.length
            ? 'The request remains available to another selected Circle member.'
            : 'No selected Circle member has accepted yet.',
          member.name,
        ),
      );
      const event = this.#event(
        'HelpRequest.Declined',
        'help-request',
        request.id,
        now,
        meta.actor,
        { memberId, state: request.state },
      );
      this.#outbox(event);
      return this.#result(request, [event]);
    });
  }

  public completeHelpRequest(helpRequestId: string, meta: CommandMeta): CommandResult<HelpRequest> {
    requirePermission(meta.actor, 'help:respond');
    return this.#idempotent<HelpRequest>(meta.idempotencyKey, () => {
      const request = this.#helpRequest(helpRequestId);
      this.#version(request.version, meta.expectedVersion);
      if (request.state !== 'assigned') {
        throw new StayDomainError('CONFLICT', 'A help request must be assigned before completion.');
      }
      const now = this.#now(meta);
      request.state = 'completed';
      request.version += 1;
      request.timeline.push(
        this.#timeline(
          now,
          'help-completed',
          'Help request completed',
          'Sarah’s Circle marked the ordinary help request complete.',
          'Sarah',
        ),
      );
      const event = this.#event(
        'HelpRequest.Completed',
        'help-request',
        request.id,
        now,
        meta.actor,
        {},
      );
      this.#outbox(event);
      return this.#result(request, [event]);
    });
  }

  public executePlaybook(playbookId: string, meta: CommandMeta): CommandResult<Playbook> {
    requirePermission(meta.actor, 'playbook:execute');
    return this.#idempotent<Playbook>(meta.idempotencyKey, () => {
      const playbook = this.#state.playbooks.find((candidate) => candidate.id === playbookId);
      if (!playbook) throw new StayDomainError('NOT_FOUND', 'Playbook was not found.');
      this.#version(playbook.version, meta.expectedVersion);
      if (playbook.state === 'completed') {
        throw new StayDomainError('CONFLICT', 'This playbook run is already complete.');
      }
      const next = playbook.steps.find((step) => !step.completed);
      if (next) next.completed = true;
      playbook.state = playbook.steps.every((step) => step.completed) ? 'completed' : 'running';
      playbook.version += 1;
      const now = this.#now(meta);
      playbook.provenance = { ...playbook.provenance, observedAt: now };
      const event = this.#event('Playbook.Progressed', 'playbook', playbook.id, now, meta.actor, {
        stepId: next?.id,
        state: playbook.state,
      });
      this.#outbox(event);
      return {
        ...this.#result(playbook, [event]),
        provenance: playbook.provenance,
      };
    });
  }

  #window(id: string): SafetyWindow {
    const entity = this.#state.safetyWindows.find((window) => window.id === id);
    if (!entity) throw new StayDomainError('NOT_FOUND', 'Safety Window was not found.');
    return entity;
  }

  #incident(id: string): Incident {
    const entity = this.#state.incidents.find((incident) => incident.id === id);
    if (!entity) throw new StayDomainError('NOT_FOUND', 'Incident was not found.');
    return entity;
  }

  #helpRequest(id: string): HelpRequest {
    const entity = this.#state.helpRequests.find((request) => request.id === id);
    if (!entity) throw new StayDomainError('NOT_FOUND', 'Help request was not found.');
    return entity;
  }

  #version(actual: number, expected: number): void {
    if (actual !== expected) {
      throw new StayDomainError(
        'STALE_VERSION',
        `Expected version ${expected}; current version is ${actual}.`,
      );
    }
  }

  #idempotent<T>(key: string, operation: () => CommandResult<T>): CommandResult<T> {
    if (!key.trim())
      throw new StayDomainError('IDEMPOTENCY_REQUIRED', 'Idempotency-Key is required.');
    const existing = this.#processed.get(key);
    if (existing) return structuredClone(existing) as CommandResult<T>;
    const result = operation();
    this.#processed.set(key, structuredClone(result) as CommandResult<unknown>);
    return structuredClone(result);
  }

  #result<T>(entity: T, events: DomainEvent[]): CommandResult<T> {
    const version = (entity as { version?: number }).version ?? 1;
    return {
      entity: structuredClone(entity),
      version,
      emittedEvents: events,
      confirmationRequired: null,
      provenance: {
        ...domainProvenance,
        observedAt: events[0]?.occurredAt ?? domainProvenance.observedAt,
      },
    };
  }

  #now(meta: { now?: Date }): string {
    return (meta.now ?? new Date()).toISOString();
  }

  #timeline(
    at: string,
    kind: string,
    title: string,
    detail: string,
    actorName = 'STAY',
  ): TimelineEvent {
    return { id: `${kind}-${at}`, at, kind, title, detail, actorName };
  }

  #event(
    type: string,
    aggregateType: string,
    aggregateId: string,
    occurredAt: string,
    actor: ActorContext,
    data: Record<string, unknown>,
  ): DomainEvent {
    return {
      id: `${aggregateId}:${type}:${occurredAt}`,
      type,
      aggregateType,
      aggregateId,
      householdId: actor.householdId,
      occurredAt,
      actorSubject: actor.subject,
      data,
    };
  }

  #outbox(event: DomainEvent): void {
    this.#state.outbox.push({
      id: event.id,
      eventType: event.type,
      aggregateId: event.aggregateId,
      occurredAt: event.occurredAt,
      payload: event.data,
    });
  }
}
