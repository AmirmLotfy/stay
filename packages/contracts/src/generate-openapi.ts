import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDocument } from 'zod-openapi';
import { z } from 'zod';
import {
  AccessPreferencesSchema,
  AccessSettingsSchema,
  ApiErrorSchema,
  CircleMemberSchema,
  CommandResultSchema,
  ConfirmationTokenSchema,
  DemoSessionSchema,
  HelpRequestSchema,
  HomeDeviceSchema,
  HouseMemoryItemSchema,
  IncidentSchema,
  IntentSchema,
  MinimalIntentContextSchema,
  PlaybookSchema,
  PrivacySettingsSchema,
  SafetyWindowSchema,
  SafetyWindowTemplateSchema,
} from './openapi-schemas.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const output = resolve(currentDir, '../../../docs/openapi.json');

const IdempotencyHeader = z.string().min(8).meta({
  description: 'Unique command key retained for duplicate suppression.',
  example: '01J8STAY9F2R8M5H2J3X4N6P7Q',
});
const VersionedCommand = z.object({
  action: z.string(),
  entityId: z.string().optional(),
  expectedVersion: z.number().int().positive().optional(),
});
const AccessCommand = VersionedCommand.extend({
  action: z.literal('update'),
  preferences: AccessPreferencesSchema,
});
const HouseMemoryCommand = VersionedCommand.extend({
  action: z.enum(['add', 'update']),
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(800),
  category: z.enum(['home', 'routine', 'maintenance', 'contact']),
  sensitivity: z.enum(['routine', 'sensitive', 'incident-only']),
});
const PrivacyCommand = VersionedCommand.extend({
  action: z.enum(['update', 'request-confirmation']),
  confirmationPurpose: z
    .enum([
      'change-escalation-plan',
      'disclose-access-instructions',
      'share-location',
      'remove-primary-contact',
      'destructive-privacy-change',
    ])
    .optional(),
  confirmationToken: z.string().min(24).optional(),
  routineSharing: z.boolean().optional(),
  locationSharing: z.enum(['off', 'incident-only', 'always']).optional(),
  temporaryPrivateUntil: z.iso.datetime().nullable().optional(),
});
const SafetyWindowCommand = z.union([
  z.object({
    action: z.literal('create'),
    title: z.string().min(1).max(120),
    template: SafetyWindowTemplateSchema,
    startsAt: z.iso.datetime(),
    expectedBy: z.iso.datetime(),
    graceMinutes: z.number().int().min(1).max(60),
    escalationMemberIds: z.array(z.string().min(1)).min(1).max(8),
  }),
  z.object({
    action: z.enum(['check-in', 'close-early', 'cancel', 'record-missed-check']),
    entityId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
  }),
]);
const PlaybookCommand = z.union([
  z.object({
    action: z.literal('create'),
    title: z.string().min(1).max(120),
    steps: z.array(z.string().min(1).max(160)).min(2).max(12),
  }),
  z.object({
    action: z.enum(['next-step', 'start', 'pause', 'resume', 'cancel', 'reset']),
    entityId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
  }),
]);
const envelope = <T extends z.ZodType>(schema: T) =>
  z.object({
    data: schema,
    provenance: z.object({
      mode: z.enum(['live', 'simulated', 'unavailable']),
      provider: z.string(),
      observedAt: z.iso.datetime(),
      reason: z.string().optional(),
    }),
  });
const responses = (schema: z.ZodType) => ({
  '200': { description: 'Successful response', content: { 'application/json': { schema } } },
  '400': {
    description: 'Invalid or missing command metadata',
    content: { 'application/json': { schema: ApiErrorSchema } },
  },
  '401': {
    description: 'Authentication required',
    content: { 'application/json': { schema: ApiErrorSchema } },
  },
  '403': {
    description: 'Permission denied',
    content: { 'application/json': { schema: ApiErrorSchema } },
  },
  '409': {
    description: 'Optimistic concurrency or state conflict',
    content: { 'application/json': { schema: ApiErrorSchema } },
  },
});
const IntentResponseSchema = z.object({
  intent: IntentSchema,
  provenance: z.object({
    mode: z.enum(['live', 'simulated', 'unavailable']),
    provider: z.string(),
    observedAt: z.iso.datetime(),
    reason: z.string().optional(),
  }),
});

const document = createDocument({
  openapi: '3.1.0',
  info: {
    title: 'STAY API',
    version: '0.1.0',
    description:
      'Versioned contracts for independent living, Safety Windows, Circle coordination, and the public isolated demo.',
    license: { name: 'Apache-2.0', identifier: 'Apache-2.0' },
  },
  servers: [
    {
      url: 'https://api.example.invalid',
      description: 'Replaced with the StayDemoStack output at deployment',
    },
  ],
  security: [{ cognito: [] }],
  paths: {
    '/v1/home': {
      get: {
        summary: 'Get calm home overview',
        responses: responses(
          envelope(
            z.object({
              resident: z.unknown(),
              oneThing: z.unknown(),
              calendar: z.array(z.unknown()),
              devices: z.array(HomeDeviceSchema),
            }),
          ),
        ),
      },
      post: command('Perform a versioned simulated home-device action'),
    },
    '/v1/tasks': {
      get: { summary: 'Get One Thing task session', responses: responses(envelope(z.unknown())) },
      post: command('Manage task session'),
    },
    '/v1/access': {
      get: {
        summary: 'Get access preferences',
        responses: responses(envelope(AccessSettingsSchema)),
      },
      post: command('Update access preferences', AccessCommand),
    },
    '/v1/circle': {
      get: {
        summary: 'Get scoped Circle availability',
        responses: responses(envelope(z.array(CircleMemberSchema))),
      },
      post: command('Manage Circle membership or availability'),
    },
    '/v1/safety-windows': {
      get: {
        summary: 'List Safety Windows',
        responses: responses(envelope(z.array(SafetyWindowSchema))),
      },
      post: command('Create or transition a Safety Window', SafetyWindowCommand),
    },
    '/v1/help-requests': {
      get: {
        summary: 'List help requests',
        responses: responses(envelope(z.array(HelpRequestSchema))),
      },
      post: command('Create or respond to a help request'),
    },
    '/v1/incidents': {
      get: {
        summary: 'List independent incident aggregates',
        responses: responses(envelope(z.array(IncidentSchema))),
      },
      post: command('Coordinate an incident'),
    },
    '/v1/playbooks': {
      get: {
        summary: 'List house playbooks',
        responses: responses(envelope(z.array(PlaybookSchema))),
      },
      post: command('Create or advance a playbook run', PlaybookCommand),
    },
    '/v1/privacy': {
      get: {
        summary: 'Get privacy controls',
        responses: responses(envelope(PrivacySettingsSchema)),
      },
      post: privacyCommand(),
    },
    '/v1/house-memory': {
      get: {
        summary: 'Get authorized House Memory',
        responses: responses(envelope(z.array(HouseMemoryItemSchema))),
      },
      post: command('Manage House Memory', HouseMemoryCommand),
    },
    '/v1/metrics': {
      get: {
        summary: 'Get privacy-preserving product metrics',
        responses: responses(envelope(z.record(z.string(), z.number()))),
      },
    },
    '/v1/intent': {
      post: intentInterpretation('Interpret a redacted resident utterance without executing it'),
    },
    '/v1/demo/intent': {
      post: {
        ...intentInterpretation('Interpret a synthetic demo utterance without executing it'),
        security: [],
        requestParams: {
          header: z.object({ 'X-STAY-Demo-Session': z.string().min(20) }),
        },
      },
    },
    '/v1/demo-sessions': {
      post: {
        summary: 'Create a per-browser isolated demo session',
        security: [],
        responses: {
          '201': {
            description: 'TTL-scoped session',
            content: { 'application/json': { schema: DemoSessionSchema } },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      cognito: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://example.invalid/oauth2/authorize',
            tokenUrl: 'https://example.invalid/oauth2/token',
            scopes: {
              'stay/app': 'Use the STAY resident and Circle application',
              'stay/mcp': 'Use STAY goal-level tools',
            },
          },
        },
      },
    },
  },
});

function command(summary: string, schema: z.ZodType = VersionedCommand) {
  return {
    summary,
    requestParams: { header: z.object({ 'Idempotency-Key': IdempotencyHeader }) },
    requestBody: { required: true, content: { 'application/json': { schema } } },
    responses: responses(CommandResultSchema),
  };
}

function intentInterpretation(summary: string) {
  return {
    summary,
    requestBody: {
      required: true,
      content: { 'application/json': { schema: MinimalIntentContextSchema } },
    },
    responses: {
      ...responses(IntentResponseSchema),
      '503': {
        description: 'The optional Bedrock interpreter is unavailable',
        content: { 'application/json': { schema: ApiErrorSchema } },
      },
    },
  };
}

function privacyCommand() {
  return {
    ...command('Update privacy or request a scoped confirmation', PrivacyCommand),
    responses: {
      ...responses(CommandResultSchema),
      '201': {
        description: 'Short-lived scoped confirmation prepared',
        content: {
          'application/json': {
            schema: z.object({ confirmation: ConfirmationTokenSchema }),
          },
        },
      },
    },
  };
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(`Generated ${output}`);
