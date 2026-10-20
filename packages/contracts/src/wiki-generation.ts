import { z } from 'zod';
import { ModelConfigSchema } from './index.js';
import { KnowledgeEvidenceBatchSchema } from './knowledge-evidence.js';
import { WikiContentSchema, WikiScopeSchema } from './knowledge-wiki.js';

const id = z.string().min(1).max(512);
export const WikiGenerationFailureCodeSchema = z.enum(['MODEL_TIMEOUT', 'MODEL_UNAVAILABLE', 'MODEL_OUTPUT_TRUNCATED',
  'INVALID_MODEL_OUTPUT', 'INVALID_MODEL_REFERENCE', 'INVALID_MODEL_LINK', 'INCOMPLETE_COVERAGE', 'INVALID_EVIDENCE', 'SOURCE_CHANGED']);
const failureBrand = Symbol.for('workexpert.wiki-generation-failure');
export class WikiGenerationFailure extends Error {
  readonly [failureBrand] = true;
  constructor(public readonly code: z.infer<typeof WikiGenerationFailureCodeSchema>) { super(code); }
}
/** API bundling can create another copy of this class; do not rely on constructor identity. */
export function wikiGenerationFailureCode(error: unknown): z.infer<typeof WikiGenerationFailureCodeSchema> | undefined {
  if (!(error instanceof Error) || !(failureBrand in error) || error[failureBrand] !== true || !('code' in error)) return;
  const parsed = WikiGenerationFailureCodeSchema.safeParse(error.code);
  return parsed.success ? parsed.data : undefined;
}
export const WikiGenerationRequestSchema = z.object({
  documentIds: z.array(id).min(1).max(5).refine((ids) => new Set(ids).size === ids.length),
  model: z.lazy(() => ModelConfigSchema), idempotencyKey: z.string().min(1).max(128),
}).strict();
export type WikiGenerationRequest = z.infer<typeof WikiGenerationRequestSchema>;
export const WikiGenerationInputSchema = z.object({
  batches: z.array(KnowledgeEvidenceBatchSchema).min(1).max(5),
}).strict().superRefine(({ batches }, ctx) => {
  const chunks = batches.flatMap((batch) => batch.chunks);
  if (chunks.length > 400 || chunks.reduce((n, chunk) => n + chunk.content.length, 0) > 192000
    || JSON.stringify(batches).length > 512000
    || new Set(chunks.map((chunk) => chunk.evidence.chunkId)).size !== chunks.length
    || new Set(batches.map((b) => b.documentId)).size !== batches.length
    || new Set(batches.map((b) => b.knowledgeBaseId)).size !== 1
    || batches.some((b) => b.provider !== 'lancedb')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid or oversized Wiki source snapshot' });
  }
});
export type WikiGenerationInput = z.infer<typeof WikiGenerationInputSchema>;
export const WikiModelOutputSchema = z.object({
  pages: z.array(z.object({
    key: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/), title: z.string().trim().min(1).max(200),
    aliases: z.array(z.string().trim().min(1).max(200)).max(20), summary: z.string().max(2000),
    sections: z.array(z.object({
      heading: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(16000),
      chunkIds: z.array(id).min(1).max(100), relatedKeys: z.array(z.string().min(1).max(40)).max(7),
    }).strict()).min(1).max(30),
  }).strict()).min(1).max(8),
}).strict();
export const WikiGeneratedPageSchema = z.object({
  pageId: id, slug: z.string().min(1).max(200), content: WikiContentSchema,
}).strict();
export type WikiGeneratedPage = z.infer<typeof WikiGeneratedPageSchema>;
export const WikiGenerationJobSchema = z.object({
  schemaVersion: z.literal(1), jobId: id, scope: WikiScopeSchema,
  idempotencyKey: z.string().min(1).max(128), requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['queued', 'running', 'completed', 'partial', 'failed', 'cancelled', 'interrupted']),
  sources: z.array(z.object({ documentId: id, documentVersionId: id, processingRevisionId: id }).strict()).min(1).max(5),
  totalChunks: z.number().int().min(1).max(400), processedChunks: z.number().int().min(0).max(400),
  pageIds: z.array(id).max(64), errorCode: z.string().max(80).nullable(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export type WikiGenerationJob = z.infer<typeof WikiGenerationJobSchema>;
export const WikiJobParamsSchema = z.object({ knowledgeBaseId: id, jobId: id.optional() }).strict();
export const WikiEmptyBodySchema = z.object({}).strict();
