import { z } from 'zod';

export const AsrResourceSchema = z.enum(['volc.seedasr.sauc.duration', 'volc.seedasr.sauc.concurrent', 'volc.bigasr.sauc.duration', 'volc.bigasr.sauc.concurrent']);
export const AsrSessionSchema = z.object({ session_id: z.string().uuid() }).strict();
export const AsrAudioSchema = AsrSessionSchema.extend({ audio: z.string().min(4).max(44_000).regex(/^[A-Za-z0-9+/]+={0,2}$/) });
export const AsrEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('connected') }),
  z.object({ type: z.literal('transcript'), text: z.string().max(32_000), isFinal: z.boolean() }),
  z.object({ type: z.literal('completed'), text: z.string().max(32_000) }),
  z.object({ type: z.literal('error'), message: z.string().max(500) }),
  z.object({ type: z.literal('closed') }),
]);
export type AsrEvent = z.infer<typeof AsrEventSchema>;
export const AsrPublicSettingsSchema = z.object({
  enabled: z.boolean().default(true), resourceId: AsrResourceSchema.default('volc.seedasr.sauc.duration'),
  enablePunc: z.boolean().default(true), enableItn: z.boolean().default(true),
  configured: z.boolean(), apiKeyMasked: z.string(), keySource: z.enum(['environment', 'settings']),
});
export type AsrPublicSettings = z.infer<typeof AsrPublicSettingsSchema>;
