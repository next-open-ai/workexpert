import { z } from 'zod';

export const RuntimeLogSettingsSchema = z.object({ enabled: z.boolean() }).strict();
export type RuntimeLogSettings = z.infer<typeof RuntimeLogSettingsSchema>;
