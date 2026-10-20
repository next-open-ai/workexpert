import { z } from 'zod';

export const KnowledgeBaseIdSchema = z.string().min(1).max(240).regex(/^[a-zA-Z0-9_-]+$/);
export const KnowledgeOwnershipSchema = z.object({
  schemaVersion: z.literal(1), orgId: z.string().min(1).max(512), ownerUserId: z.string().min(1).max(512),
  assignedBy: z.string().min(1).max(512), assignedAt: z.string().datetime(),
}).strict();
export type KnowledgeOwnership = z.infer<typeof KnowledgeOwnershipSchema>;
export const KnowledgeAssignSchema = z.object({ ownerUserId: z.string().min(1).max(512) }).strict();
export const KnowledgeAssignParamsSchema = z.object({ knowledgeBaseId: KnowledgeBaseIdSchema }).strict();
export const KnowledgeConfigRowsSchema = z.array(z.record(z.unknown())).max(1000);
