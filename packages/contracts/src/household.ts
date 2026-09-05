import { z } from 'zod';

export const ScopedIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,119}$/);
export const HouseholdProfileSchema = z.object({
  id: ScopedIdSchema,
  version: z.number().int().positive(),
  status: z.enum(['active', 'suspended', 'closed']),
  residentId: ScopedIdSchema,
  name: z.string().trim().min(1).max(120),
  firstName: z.string().trim().min(1).max(80),
  timezone: z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'A supported IANA time zone is required.'),
  consentVersion: z.string().min(1).max(80),
  consentedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type HouseholdProfile = z.infer<typeof HouseholdProfileSchema>;

export const HouseholdMembershipSchema = z.object({
  id: ScopedIdSchema,
  version: z.number().int().positive(),
  residentId: ScopedIdSchema,
  role: z.enum(['resident', 'coordinator', 'nearby-helper', 'backup', 'aide']),
  circleMemberId: ScopedIdSchema.optional(),
  active: z.boolean(),
});
export type HouseholdMembership = z.infer<typeof HouseholdMembershipSchema>;

// Private aggregate: never include this object in Circle, MCP, or event responses.
export const NotificationContactSchema = z.object({
  id: ScopedIdSchema,
  version: z.number().int().positive(),
  email: z.email(),
  verifiedAt: z.iso.datetime(),
  consentedAt: z.iso.datetime(),
  consentVersion: z.string().min(1).max(80),
  enabled: z.boolean(),
  suppression: z.enum(['none', 'bounce', 'complaint', 'removed']),
});
export type NotificationContact = z.infer<typeof NotificationContactSchema>;
export const NotificationPreferenceSchema = z.object({
  id: ScopedIdSchema,
  version: z.number().int().positive(),
  enabled: z.boolean(),
  suppression: z.enum(['none', 'bounce', 'complaint', 'removed']),
});
export type NotificationPreference = z.infer<typeof NotificationPreferenceSchema>;
export const ProfileUpdateSchema = z.object({
  action: z.literal('update'),
  expectedVersion: z.number().int().positive(),
  name: HouseholdProfileSchema.shape.name,
  firstName: HouseholdProfileSchema.shape.firstName,
  timezone: HouseholdProfileSchema.shape.timezone,
});
export const NotificationPreferenceUpdateSchema = z.object({
  action: z.literal('update'),
  expectedVersion: z.number().int().positive(),
  enabled: z.boolean(),
});
