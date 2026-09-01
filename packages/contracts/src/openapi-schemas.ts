import { z } from 'zod';
import {
  AccessPreferencesSchema as AccessPreferences,
  ApiErrorSchema as ApiError,
  CircleMemberSchema as CircleMember,
  DemoSessionSchema as DemoSession,
  DomainEventSchema,
  HelpRequestSchema as HelpRequest,
  HouseMemoryItemSchema as HouseMemoryItem,
  IncidentSchema as Incident,
  PlaybookSchema as Playbook,
  SafetyWindowSchema as SafetyWindow,
  SourceProvenanceSchema,
} from './index.js';

export const AccessPreferencesSchema = AccessPreferences.meta({ id: 'AccessPreferences' });
export const ApiErrorSchema = ApiError.meta({ id: 'ApiError' });
export const CircleMemberSchema = CircleMember.meta({ id: 'CircleMember' });
export const DemoSessionSchema = DemoSession.meta({ id: 'DemoSession' });
export const HelpRequestSchema = HelpRequest.meta({ id: 'HelpRequest' });
export const HouseMemoryItemSchema = HouseMemoryItem.meta({ id: 'HouseMemoryItem' });
export const IncidentSchema = Incident.meta({ id: 'Incident' });
export const PlaybookSchema = Playbook.meta({ id: 'Playbook' });
export const SafetyWindowSchema = SafetyWindow.meta({ id: 'SafetyWindow' });
export const CommandResultSchema = z
  .object({
    entity: z.unknown(),
    version: z.number().int().positive(),
    emittedEvents: z.array(DomainEventSchema),
    confirmationRequired: z.string().nullable(),
    provenance: SourceProvenanceSchema,
  })
  .meta({ id: 'CommandResult' });
