import { z } from 'zod';
import {
  AccessPreferencesSchema as AccessPreferences,
  AccessSettingsSchema as AccessSettings,
  ApiErrorSchema as ApiError,
  CircleMemberSchema as CircleMember,
  ConfirmationTokenSchema as ConfirmationToken,
  DemoSessionSchema as DemoSession,
  DomainEventSchema,
  HelpRequestSchema as HelpRequest,
  HouseMemoryItemSchema as HouseMemoryItem,
  IncidentSchema as Incident,
  PlaybookSchema as Playbook,
  PrivacySettingsSchema as PrivacySettings,
  SafetyWindowSchema as SafetyWindow,
  SafetyWindowTemplateSchema as SafetyWindowTemplate,
  SourceProvenanceSchema,
} from './index.js';

export const AccessPreferencesSchema = AccessPreferences.meta({ id: 'AccessPreferences' });
export const AccessSettingsSchema = AccessSettings.meta({ id: 'AccessSettings' });
export const ApiErrorSchema = ApiError.meta({ id: 'ApiError' });
export const CircleMemberSchema = CircleMember.meta({ id: 'CircleMember' });
export const ConfirmationTokenSchema = ConfirmationToken.meta({ id: 'ConfirmationToken' });
export const DemoSessionSchema = DemoSession.meta({ id: 'DemoSession' });
export const HelpRequestSchema = HelpRequest.meta({ id: 'HelpRequest' });
export const HouseMemoryItemSchema = HouseMemoryItem.meta({ id: 'HouseMemoryItem' });
export const IncidentSchema = Incident.meta({ id: 'Incident' });
export const PlaybookSchema = Playbook.meta({ id: 'Playbook' });
export const PrivacySettingsSchema = PrivacySettings.meta({ id: 'PrivacySettings' });
export const SafetyWindowSchema = SafetyWindow.meta({ id: 'SafetyWindow' });
export const SafetyWindowTemplateSchema = SafetyWindowTemplate.meta({
  id: 'SafetyWindowTemplate',
});
export const CommandResultSchema = z
  .object({
    entity: z.unknown(),
    version: z.number().int().positive(),
    emittedEvents: z.array(DomainEventSchema),
    confirmationRequired: z.string().nullable(),
    provenance: SourceProvenanceSchema,
  })
  .meta({ id: 'CommandResult' });
