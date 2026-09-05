import { z } from 'zod';
export * from './household.js';

export const RoleSchema = z.enum(['resident', 'coordinator', 'nearby-helper', 'backup', 'aide']);
export type Role = z.infer<typeof RoleSchema>;

export const PermissionSchema = z.enum([
  'home:read',
  'home:act',
  'tasks:write',
  'circle:read',
  'circle:manage',
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
]);
export type Permission = z.infer<typeof PermissionSchema>;

export const ActorContextSchema = z.object({
  subject: z.string().min(1),
  householdId: z.string().min(1),
  residentId: z.string().min(1),
  circleMemberId: z.string().min(1).optional(),
  role: RoleSchema,
  permissions: z.array(PermissionSchema),
  correlationId: z.string().min(1),
});
export type ActorContext = z.infer<typeof ActorContextSchema>;

export const SourceProvenanceSchema = z.object({
  mode: z.enum(['live', 'simulated', 'unavailable']),
  provider: z.string().min(1),
  observedAt: z.iso.datetime(),
  reason: z.string().optional(),
});
export type SourceProvenance = z.infer<typeof SourceProvenanceSchema>;

export const DomainEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  householdId: z.string().min(1),
  occurredAt: z.iso.datetime(),
  actorSubject: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});
export type DomainEvent = z.infer<typeof DomainEventSchema>;

export const ConfirmationPurposeSchema = z.enum([
  'change-escalation-plan',
  'disclose-access-instructions',
  'share-location',
  'remove-primary-contact',
  'destructive-privacy-change',
]);

export const ConfirmationTokenSchema = z.object({
  token: z.string().min(24),
  purpose: ConfirmationPurposeSchema,
  subject: z.string().min(1),
  entityId: z.string().min(1),
  expiresAt: z.iso.datetime(),
  consumedAt: z.iso.datetime().optional(),
});
export type ConfirmationToken = z.infer<typeof ConfirmationTokenSchema>;

export const ApiErrorSchema = z.object({
  code: z.enum([
    'BAD_REQUEST',
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'NOT_FOUND',
    'CONFLICT',
    'STALE_VERSION',
    'IDEMPOTENCY_REQUIRED',
    'CONFIRMATION_REQUIRED',
    'PROVIDER_UNAVAILABLE',
    'INTERNAL_ERROR',
  ]),
  message: z.string(),
  fieldDetails: z.record(z.string(), z.array(z.string())).optional(),
  correlationId: z.string().min(1),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export interface CommandResult<T> {
  entity: T;
  version: number;
  emittedEvents: DomainEvent[];
  confirmationRequired: ConfirmationPurpose | null;
  provenance: SourceProvenance;
}

export type ConfirmationPurpose = z.infer<typeof ConfirmationPurposeSchema>;

export const TaskSessionStateSchema = z.enum([
  'not-started',
  'active',
  'paused',
  'completed',
  'cancelled',
]);
export const HelpRequestStateSchema = z.enum([
  'open',
  'offered',
  'assigned',
  'declined',
  'completed',
  'cancelled',
]);
export const SafetyWindowStateSchema = z.enum([
  'scheduled',
  'open',
  'checked-in',
  'first-check-missed',
  'grace',
  'escalating',
  'cancelled',
  'resolved',
]);
export const IncidentStateSchema = z.enum([
  'detected',
  'verifying',
  'active',
  'coordinating',
  'responding',
  'escalated',
  'resolved',
]);
export const PlaybookRunStateSchema = z.enum([
  'ready',
  'running',
  'paused',
  'completed',
  'cancelled',
]);
export const NotificationDeliveryStateSchema = z.enum(['queued', 'sent', 'failed', 'suppressed']);
export const PrivacyOverrideStateSchema = z.enum(['active', 'expired', 'cancelled']);

export const TimelineEventSchema = z.object({
  id: z.string(),
  at: z.iso.datetime(),
  kind: z.string(),
  title: z.string(),
  detail: z.string(),
  actorName: z.string(),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const CircleMemberSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  active: z.boolean(),
  name: z.string(),
  initials: z.string(),
  role: RoleSchema,
  priority: z.number().int().positive(),
  availability: z.enum(['available', 'busy', 'unavailable', 'responding']),
  responseMinutes: z.number().int().nonnegative(),
  permissions: z.array(PermissionSchema),
  relationship: z.string(),
});
export type CircleMember = z.infer<typeof CircleMemberSchema>;

export const AccessPreferencesSchema = z.object({
  interactionMode: z.enum(['voice-first', 'touch-first', 'balanced']),
  reducedLoad: z.boolean(),
  highLegibility: z.boolean(),
  captions: z.boolean(),
  extraResponseTime: z.boolean(),
  repeatInformation: z.boolean(),
  highContrast: z.boolean(),
  reducedMotion: z.boolean(),
  textScale: z.enum(['default', 'large', 'extra-large']),
});
export type AccessPreferences = z.infer<typeof AccessPreferencesSchema>;

export const AccessSettingsSchema = AccessPreferencesSchema.extend({
  id: z.string().min(1),
  version: z.number().int().positive(),
});
export type AccessSettings = z.infer<typeof AccessSettingsSchema>;

export const PrivacySettingsSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  routineSharing: z.boolean(),
  locationSharing: z.enum(['off', 'incident-only', 'always']),
  temporaryPrivateUntil: z.iso.datetime().optional(),
  auditRetention: z.literal(true),
});
export type PrivacySettings = z.infer<typeof PrivacySettingsSchema>;

export const SafetyWindowTemplateSchema = z.enum([
  'morning-check-in',
  'arrived-home',
  'medication-routine',
  'meal-check',
  'custom',
]);
export type SafetyWindowTemplate = z.infer<typeof SafetyWindowTemplateSchema>;

export const SafetyWindowSchema = z.object({
  id: z.string(),
  residentId: z.string(),
  residentName: z.string(),
  title: z.string(),
  template: SafetyWindowTemplateSchema,
  state: SafetyWindowStateSchema,
  startsAt: z.iso.datetime(),
  expectedBy: z.iso.datetime(),
  graceMinutes: z.number().int().nonnegative(),
  checkAttempts: z.number().int().min(0).max(2),
  escalationMemberIds: z.array(z.string()),
  version: z.number().int().positive(),
  timeline: z.array(TimelineEventSchema),
});
export type SafetyWindow = z.infer<typeof SafetyWindowSchema>;

export const HelpRequestSchema = z.object({
  id: z.string(),
  residentId: z.string(),
  title: z.string(),
  detail: z.string(),
  urgency: z.enum(['normal', 'time-sensitive', 'urgent']),
  state: HelpRequestStateSchema,
  offeredTo: z.array(z.string()),
  assignedTo: z.string().optional(),
  createdAt: z.iso.datetime(),
  version: z.number().int().positive(),
  timeline: z.array(TimelineEventSchema),
});
export type HelpRequest = z.infer<typeof HelpRequestSchema>;

export const IncidentSchema = z.object({
  id: z.string(),
  residentId: z.string(),
  kind: z.enum([
    'missed-window',
    'power-outage',
    'water-leak',
    'extreme-heat',
    'severe-weather',
    'custom',
  ]),
  title: z.string(),
  state: IncidentStateSchema,
  severity: z.enum(['watch', 'attention', 'urgent']),
  assignedMemberId: z.string().optional(),
  accessInstructionsAvailable: z.boolean(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().optional(),
  version: z.number().int().positive(),
  timeline: z.array(TimelineEventSchema),
});
export type Incident = z.infer<typeof IncidentSchema>;

export const HouseMemoryItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
  category: z.enum(['home', 'routine', 'maintenance', 'contact']),
  sensitivity: z.enum(['routine', 'sensitive', 'incident-only']),
  updatedAt: z.iso.datetime(),
  version: z.number().int().positive(),
});
export type HouseMemoryItem = z.infer<typeof HouseMemoryItemSchema>;

export const HomeDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['path-light', 'entry-sensor', 'utility-sensor']),
  state: z.enum(['on', 'off', 'ready', 'closed', 'normal', 'unavailable']),
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
  provenance: SourceProvenanceSchema,
});
export type HomeDevice = z.infer<typeof HomeDeviceSchema>;

export const PlaybookSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(['power-outage', 'water-leak', 'extreme-heat', 'severe-weather', 'custom']),
  state: PlaybookRunStateSchema,
  steps: z.array(z.object({ id: z.string(), label: z.string(), completed: z.boolean() })),
  provenance: SourceProvenanceSchema,
  version: z.number().int().positive(),
});
export type Playbook = z.infer<typeof PlaybookSchema>;

export const DemoSessionSchema = z.object({
  id: z.string(),
  browserKeyHash: z.string(),
  householdId: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  mode: z.literal('isolated-demo'),
});
export type DemoSession = z.infer<typeof DemoSessionSchema>;

export const McpToolNameSchema = z.enum([
  'get_home_overview',
  'manage_task_session',
  'manage_safety_window',
  'request_help',
  'get_circle_availability',
  'manage_incident',
  'manage_house_memory',
  'execute_playbook',
  'manage_privacy',
  'perform_home_action',
]);
export type McpToolName = z.infer<typeof McpToolNameSchema>;

export const IntentSchema = z.object({
  toolName: McpToolNameSchema,
  action: z.string().max(80),
  entityId: z.string().max(120).optional(),
  explanation: z.string().max(240),
  explicitEmergencyLanguage: z.boolean(),
});
export type InterpretedIntent = z.infer<typeof IntentSchema>;

export const MinimalIntentContextSchema = z.object({
  utterance: z.string().min(1).max(600),
  currentSurface: z.enum([
    'home',
    'tasks',
    'access',
    'windows',
    'circle',
    'incidents',
    'playbooks',
    'privacy',
    'memory',
  ]),
  visibleEntityIds: z.array(z.string().max(120)).max(20),
  locale: z.string().max(20),
});
export type MinimalIntentContext = z.infer<typeof MinimalIntentContextSchema>;

export const RouteGroups = [
  'home',
  'tasks',
  'access',
  'circle',
  'safety-windows',
  'help-requests',
  'incidents',
  'playbooks',
  'privacy',
  'house-memory',
  'metrics',
  'demo-sessions',
] as const;
