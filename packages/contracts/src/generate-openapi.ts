import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDocument } from 'zod-openapi';
import { z } from 'zod';
import {
  AccessPreferencesSchema,
  ApiErrorSchema,
  CircleMemberSchema,
  CommandResultSchema,
  DemoSessionSchema,
  HelpRequestSchema,
  HouseMemoryItemSchema,
  IncidentSchema,
  PlaybookSchema,
  SafetyWindowSchema,
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
          envelope(z.object({ oneThing: z.unknown(), calendar: z.array(z.unknown()) })),
        ),
      },
    },
    '/v1/tasks': {
      get: { summary: 'Get One Thing task session', responses: responses(envelope(z.unknown())) },
      post: command('Manage task session'),
    },
    '/v1/access': {
      get: {
        summary: 'Get access preferences',
        responses: responses(envelope(AccessPreferencesSchema)),
      },
      post: command('Update access preferences'),
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
      post: command('Create or transition a Safety Window'),
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
      post: command('Advance a playbook run'),
    },
    '/v1/privacy': {
      get: { summary: 'Get privacy controls', responses: responses(envelope(z.unknown())) },
      post: command('Request a privacy change'),
    },
    '/v1/house-memory': {
      get: {
        summary: 'Get authorized House Memory',
        responses: responses(envelope(z.array(HouseMemoryItemSchema))),
      },
      post: command('Manage House Memory'),
    },
    '/v1/metrics': {
      get: {
        summary: 'Get privacy-preserving product metrics',
        responses: responses(envelope(z.record(z.string(), z.number()))),
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
            scopes: { 'stay/mcp': 'Use STAY goal-level tools' },
          },
        },
      },
    },
  },
});

function command(summary: string) {
  return {
    summary,
    requestParams: { header: z.object({ 'Idempotency-Key': IdempotencyHeader }) },
    requestBody: { required: true, content: { 'application/json': { schema: VersionedCommand } } },
    responses: responses(CommandResultSchema),
  };
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(`Generated ${output}`);
