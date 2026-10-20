import { createHash } from 'node:crypto';
import { completeSimple } from '@mariozechner/pi-ai';
import { z } from 'zod';
import {
  OntologyCandidateSchema,
  OntologyGovernanceCommandSchema,
  type KnowledgeBaseRuntime,
  type ModelConfig,
  type OntologyCandidate,
  type OntologyGovernanceCommand,
  type OntologyGraph,
  type OntologyAnalysisBatchState,
  type OntologyExtractionFailureCategory,
} from '@workexpert/contracts';
import { listKnowledgeChunks } from './knowledge-runtime.js';
import { importOntologyCandidates, readOntologyExtractionCheckpoints, saveOntologyExtractionBatch } from './ontology-runtime.js';
import type { OntologyGovernanceIssue } from './ontology-runtime.js';
import { createChatCompletionsPayloadPatch, toPiModel } from './pi-model.js';

const PrimitiveSchema = z.union([z.string(), z.number(), z.boolean()]);
const EvidenceSchema = z.object({ chunkId: z.string().min(1), quote: z.string().min(1) });
const ExtractedNodeSchema = z.object({
  id: z.string().min(1).max(240),
  type: z.string().min(1).max(80),
  name: z.string().min(1).max(240),
  aliases: z.array(z.string().min(1).max(240)).max(32).default([]),
  properties: z.record(z.string(), PrimitiveSchema).default({}),
  confidence: z.number().min(0).max(1).default(0.7),
  evidence: EvidenceSchema,
});
const ExtractedEdgeSchema = z.object({
  subjectId: z.string().min(1).max(240),
  predicate: z.string().min(1).max(120),
  objectId: z.string().min(1).max(240),
  properties: z.record(z.string(), PrimitiveSchema).default({}),
  confidence: z.number().min(0).max(1).default(0.7),
  evidence: EvidenceSchema,
});
const ExtractionPayloadSchema = z.object({
  nodes: z.array(ExtractedNodeSchema).max(100),
  edges: z.array(ExtractedEdgeSchema).max(150),
});

export type ExtractionChunk = {
  id: string;
  documentId: string;
  documentTitle: string;
  source?: string;
  content: string;
};
export type OntologyExtractionBatchStatus = {
  slot: number;
  batchNumber: number;
  state: OntologyAnalysisBatchState;
  phase: string;
  chunkCount: number;
  documentTitles: string[];
  startedAt: number;
  completedAt?: number;
  candidates?: number;
  elapsedMs?: number;
  failure?: OntologyExtractionFailure;
};
export type { OntologyExtractionFailureCategory } from '@workexpert/contracts';
export type OntologyExtractionFailure = {
  category: OntologyExtractionFailureCategory;
  message: string;
  retryable: boolean;
  batchNumber?: number;
  chunkIds: string[];
  elapsedMs?: number;
  statusCode?: number;
  providerCode?: string;
  stopReason?: string;
};
type OntologyExtractionProgress = {
  candidateIds?: string[];
  skippedChunkIds?: string[];
  phase: string;
  currentBatch: number;
  totalBatches: number;
  discovered?: number;
  failedBatches?: number;
  activeBatches?: OntologyExtractionBatchStatus[];
  completedChunkIds?: string[];
  failedChunkIds?: string[];
  failures?: OntologyExtractionFailure[];
};

const EXTRACTION_BATCH_MAX_CHUNKS = 3;
const EXTRACTION_BATCH_MAX_CHARS = 6_000;
const EXTRACTION_BATCH_CONCURRENCY = 2;
const EXTRACTION_RETRY_MIN_CHARS = 480;
const EXTRACTION_MAX_FALLBACK_DEPTH = 1;
const EXTRACTION_RESPONSE_CACHE_LIMIT = 300;
const extractionResponseCache = new Map<string, string>();
const strictSchemaSupport = new Map<string, boolean>();

class OntologyModelOutputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OntologyModelOutputError';
  }
}

class OntologyProviderResponseError extends Error {
  readonly stopReason: string;
  constructor(message: string, stopReason: string) {
    super(message);
    this.name = 'OntologyProviderResponseError';
    this.stopReason = stopReason;
  }
}

class OntologyEvidenceVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OntologyEvidenceVerificationError';
  }
}

function stableId(prefix: string, ...parts: string[]) {
  return `${prefix}-${createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 20)}`;
}

function verifiedQuote(chunk: ExtractionChunk, quote: string) {
  const clean = quote.trim().slice(0, 4000);
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  if (!clean || !normalize(chunk.content).includes(normalize(clean))) {
    throw new OntologyEvidenceVerificationError(`模型为切片 ${chunk.id} 返回了无法在原文中核验的证据。`);
  }
  return clean;
}

function resolveEvidenceChunk(
  chunksById: Map<string, ExtractionChunk>,
  chunks: ExtractionChunk[],
  chunkId: string,
  quote: string,
  recoverMismatchedEvidence: boolean,
) {
  const exact = chunksById.get(chunkId);
  if (exact) return exact;
  if (recoverMismatchedEvidence) {
    const normalizedQuote = quote.replace(/\s+/g, ' ').trim();
    const matches = normalizedQuote
      ? chunks.filter((chunk) => chunk.content.replace(/\s+/g, ' ').includes(normalizedQuote))
      : [];
    // A wrong id is safe to repair only when the quoted evidence identifies one
    // authorized chunk unambiguously. The model-provided id is never trusted.
    if (matches.length === 1) return matches[0];
  }
  throw new OntologyEvidenceVerificationError(`模型引用了未授权的知识切片：${chunkId}`);
}

function parseModelJson(text: string) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const raw = (fenced || text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new OntologyModelOutputError('模型未返回完整的本体 JSON。');
  try {
    return ExtractionPayloadSchema.parse(JSON.parse(raw.slice(start, end + 1)));
  } catch (error) {
    throw new OntologyModelOutputError('模型返回的本体 JSON 不完整或格式不正确。', { cause: error });
  }
}

export function normalizeOntologyExtraction(
  text: string,
  chunks: ExtractionChunk[],
  options: { allowEmpty?: boolean; skipInvalidEvidence?: boolean; recoverMismatchedEvidence?: boolean } = {},
): OntologyCandidate[] {
  const payload = parseModelJson(text);
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const acceptedNodeIds = new Set<string>();
  const candidates: OntologyCandidate[] = [];
  for (const node of payload.nodes) {
    try {
      const chunk = resolveEvidenceChunk(chunksById, chunks, node.evidence.chunkId, node.evidence.quote, Boolean(options.recoverMismatchedEvidence));
      candidates.push(OntologyCandidateSchema.parse({
        id: stableId('candidate-node', node.id, chunk.id),
        kind: 'node',
        node: { id: node.id, type: node.type, name: node.name, aliases: node.aliases, properties: node.properties, source: chunk.source || chunk.documentTitle, status: 'draft' },
        confidence: node.confidence,
        status: 'pending',
        evidence: [{ documentId: chunk.documentId, chunkId: chunk.id, title: chunk.documentTitle, quote: verifiedQuote(chunk, node.evidence.quote), source: chunk.source }],
      }));
      acceptedNodeIds.add(node.id);
    } catch (error) {
      if (options.skipInvalidEvidence && error instanceof OntologyEvidenceVerificationError) continue;
      throw error;
    }
  }
  for (const edge of payload.edges) {
    if (!acceptedNodeIds.has(edge.subjectId) || !acceptedNodeIds.has(edge.objectId)) continue;
    try {
      const chunk = resolveEvidenceChunk(chunksById, chunks, edge.evidence.chunkId, edge.evidence.quote, Boolean(options.recoverMismatchedEvidence));
      candidates.push(OntologyCandidateSchema.parse({
        id: stableId('candidate-edge', edge.subjectId, edge.predicate, edge.objectId, chunk.id),
        kind: 'edge',
        edge: { id: stableId('edge', edge.subjectId, edge.predicate, edge.objectId), subjectId: edge.subjectId, predicate: edge.predicate, objectId: edge.objectId, properties: edge.properties, source: chunk.source || chunk.documentTitle, status: 'draft' },
        confidence: edge.confidence,
        status: 'pending',
        evidence: [{ documentId: chunk.documentId, chunkId: chunk.id, title: chunk.documentTitle, quote: verifiedQuote(chunk, edge.evidence.quote), source: chunk.source }],
      }));
    } catch (error) {
      if (options.skipInvalidEvidence && error instanceof OntologyEvidenceVerificationError) continue;
      throw error;
    }
  }
  if (!candidates.length && !options.allowEmpty) throw new Error('没有从所选文档中识别到可审核的实体或关系。');
  return candidates;
}

export function partitionOntologyExtractionChunks(
  chunks: ExtractionChunk[],
  options: { maxChunks?: number; maxChars?: number } = {},
) {
  const maxChunks = Math.max(1, options.maxChunks || EXTRACTION_BATCH_MAX_CHUNKS);
  const maxChars = Math.max(1, options.maxChars || EXTRACTION_BATCH_MAX_CHARS);
  const batches: ExtractionChunk[][] = [];
  let current: ExtractionChunk[] = [];
  let currentChars = 0;
  for (const chunk of chunks) {
    const chunkChars = chunk.content.length;
    if (current.length && (current.length >= maxChunks || currentChars + chunkChars > maxChars)) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(chunk);
    currentChars += chunkChars;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function prioritizeOntologyExtractionChunks(chunks: ExtractionChunk[], instructions = '') {
  const focusTerms = instructions.toLowerCase().split(/[\s,，。；;、:：()（）]+/).filter((term) => term.length >= 2).slice(0, 24);
  const businessTerms = ['流程', '规则', '角色', '职责', '产品', '服务', '客户', '条件', '审批', '系统', '指标', '异常', '处理', '依赖', '关系'];
  const scored = chunks.map((chunk, index) => {
    const text = `${chunk.documentTitle}\n${chunk.content}`.toLowerCase();
    const focusScore = focusTerms.reduce((score, term) => score + (text.includes(term) ? 8 : 0), 0);
    const businessScore = businessTerms.reduce((score, term) => score + (text.includes(term) ? 2 : 0), 0);
    const relationScore = Math.min(8, (chunk.content.match(/属于|负责|依赖|包含|用于|关联|支持|触发|产生|管理/g) || []).length * 2);
    const noisePenalty = /目录|table of contents|版权|免责声明/i.test(chunk.content.slice(0, 180)) ? 8 : 0;
    return { chunk, index, score: focusScore + businessScore + relationScore - noisePenalty };
  });
  return scored.sort((left, right) => right.score - left.score || left.index - right.index).map(({ chunk }) => chunk);
}

export function ontologyExtractionConcurrency(model: Pick<ModelConfig, 'provider'>) {
  // Qwen extraction starts conservatively. A single successful lane is faster
  // than saturating the provider and losing every long-running request.
  return model.provider === 'qwen' || model.provider === 'ollama' ? 1 : 4;
}

function extractionCacheKey(input: { model: ModelConfig; instructions?: string; batch: ExtractionChunk[] }) {
  return createHash('sha256').update(JSON.stringify({
    version: 3,
    provider: input.model.provider,
    baseUrl: input.model.baseUrl,
    model: input.model.chatModel,
    instructions: input.instructions?.trim() || '',
    chunks: input.batch.map((chunk) => [chunk.id, chunk.content]),
  })).digest('hex');
}

function cacheExtractionResponse(key: string, response: string) {
  extractionResponseCache.delete(key);
  extractionResponseCache.set(key, response);
  while (extractionResponseCache.size > EXTRACTION_RESPONSE_CACHE_LIMIT) {
    const oldest = extractionResponseCache.keys().next().value as string | undefined;
    if (!oldest) break;
    extractionResponseCache.delete(oldest);
  }
}

function splitExtractionChunkForRetry(chunk: ExtractionChunk): [ExtractionChunk, ExtractionChunk] | null {
  if (chunk.content.length <= EXTRACTION_RETRY_MIN_CHARS) return null;
  const midpoint = Math.floor(chunk.content.length / 2);
  const searchStart = Math.max(1, midpoint - 240);
  const searchEnd = Math.min(chunk.content.length - 1, midpoint + 240);
  const nearby = chunk.content.slice(searchStart, searchEnd);
  const boundaries = [...nearby.matchAll(/[\n。；;,，]\s*/g)];
  const best = boundaries.length
    ? boundaries.reduce((selected, item) => (
      Math.abs((searchStart + item.index! + item[0].length) - midpoint)
        < Math.abs(selected - midpoint)
        ? searchStart + item.index! + item[0].length
        : selected
    ), midpoint)
    : midpoint;
  const left = chunk.content.slice(0, best).trim();
  const right = chunk.content.slice(best).trim();
  if (!left || !right) return null;
  return [{ ...chunk, content: left }, { ...chunk, content: right }];
}

type AnalyzeExtractionBatch = (chunks: ExtractionChunk[], signal?: AbortSignal) => Promise<string>;

function errorChainText(error: unknown) {
  const messages: string[] = [];
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof Error) {
      messages.push(current.message, current.name);
      current = current.cause;
    } else {
      messages.push(String(current));
      break;
    }
  }
  return messages.join(' ');
}

function isTransientExtractionError(error: unknown) {
  return /terminated|aborted|aborterror|fetch failed|failed to fetch|econnreset|econnrefused|eai_again|enotfound|socket|broken pipe|remote end closed|temporarily unavailable|timed?\s*out|timeout|429|502|503|504|und_err/i.test(errorChainText(error));
}

function isExtractionTimeout(error: unknown) {
  return /timeout|timed out|aborted|aborterror|terminated/i.test(errorChainText(error));
}

function safeExtractionErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 320) || '未返回错误说明';
}

export function describeOntologyExtractionError(error: unknown, chunkIds: string[] = []): OntologyExtractionFailure {
  const chain = errorChainText(error);
  const message = safeExtractionErrorMessage(error);
  let current = error;
  let statusCode: number | undefined;
  let providerCode: string | undefined;
  let stopReason: string | undefined;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === 'object') {
      const row = current as Record<string, unknown>;
      const status = row.statusCode ?? row.status;
      if (statusCode === undefined && typeof status === 'number') statusCode = status;
      if (providerCode === undefined && (typeof row.code === 'string' || typeof row.code === 'number')) providerCode = String(row.code).slice(0, 80);
      if (stopReason === undefined && typeof row.stopReason === 'string') stopReason = row.stopReason.slice(0, 80);
      current = row.cause;
    } else break;
  }
  const details = { message, chunkIds, ...(statusCode === undefined ? {} : { statusCode }), ...(providerCode ? { providerCode } : {}), ...(stopReason ? { stopReason } : {}) };
  if (/user cancelled|用户取消/i.test(chain)) return { category: 'cancelled', retryable: true, ...details };
  if (/timed?\s*out|timeout|aborterror|terminated|request was aborted/i.test(chain)) return { category: 'provider_timeout', retryable: true, ...details };
  if (/json.schema|response.format|unsupported.*schema|invalid parameter/i.test(chain)) return { category: 'schema_unsupported', retryable: true, ...details };
  if (/length limit|长度上限|output.*truncat|finish.reason.*length/i.test(chain)) return { category: 'output_truncated', retryable: true, ...details };
  if (/本体 JSON|结构化结果|invalid json|JSON.*不完整|格式不正确/i.test(chain)) return { category: 'invalid_output', retryable: true, ...details };
  if (/未授权的知识切片|无法在原文中核验/i.test(chain)) return { category: 'evidence_invalid', retryable: false, ...details };
  if (statusCode !== undefined || /\b(?:400|401|403|404|408|409|422|429|500|502|503|504)\b|http|status code/i.test(chain)) return { category: 'provider_http', retryable: statusCode === 408 || statusCode === 429 || Boolean(statusCode && statusCode >= 500) || /408|429|5\d\d/.test(chain), ...details };
  if (/fetch failed|econn|socket|broken pipe|remote end closed|服务连接|模型未完成/i.test(chain)) return { category: 'provider_error', retryable: true, ...details };
  return { category: 'unknown', retryable: false, ...details };
}

async function waitForExtractionRetry(ms: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

class OntologyUserInterruption extends Error {
  constructor(readonly category: 'user_skipped' | 'user_stopped') {
    super(category === 'user_skipped' ? '已由用户跳过，可稍后继续处理。' : '用户已停止分析，未完成切片可稍后继续。');
  }
}

/** API owns this ephemeral handle; only completed artifacts are durable. */
export class OntologyExtractionControl {
  private active = new Map<number, AbortController>();
  stopped = false;
  register(batchNumber: number, controller: AbortController) {
    this.active.set(batchNumber, controller);
    if (this.stopped) controller.abort(new OntologyUserInterruption('user_stopped'));
    return () => this.active.delete(batchNumber);
  }
  skip(batchNumber: number) {
    const controller = this.active.get(batchNumber);
    if (!controller || controller.signal.aborted || this.stopped) return false;
    controller.abort(new OntologyUserInterruption('user_skipped'));
    return true;
  }
  stop() {
    this.stopped = true;
    for (const controller of this.active.values()) controller.abort(new OntologyUserInterruption('user_stopped'));
  }
}

function abortableExtraction<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    operation.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

export async function extractOntologyCandidateBatches(
  chunks: ExtractionChunk[],
  analyze: AnalyzeExtractionBatch,
  options: { concurrency?: number; maxChunks?: number; maxChars?: number; signal?: AbortSignal; control?: OntologyExtractionControl; continueOnError?: boolean; maxFallbackDepth?: number; maxConsecutiveSameFailures?: number; onBatchComplete?: (candidates: OntologyCandidate[], chunks: ExtractionChunk[]) => Promise<void> | void; onBatchFailed?: (chunks: ExtractionChunk[], error: unknown, failure: OntologyExtractionFailure) => Promise<void> | void; onProgress?: (event: OntologyExtractionProgress) => void } = {},
): Promise<OntologyCandidate[]> {
  const maxFallbackDepth = Math.max(0, options.maxFallbackDepth ?? EXTRACTION_MAX_FALLBACK_DEPTH);
  const analyzeWithFallback = async (batch: ExtractionChunk[], signal: AbortSignal, depth = 0): Promise<OntologyCandidate[]> => {
    signal.throwIfAborted();
    try {
      const response = await abortableExtraction(analyze(batch, signal), signal);
      signal.throwIfAborted();
      return normalizeOntologyExtraction(response, batch, { allowEmpty: true, skipInvalidEvidence: true, recoverMismatchedEvidence: true });
    } catch (error) {
      signal.throwIfAborted();
      if (isTransientExtractionError(error)) {
        if (options.signal?.aborted) throw error;
        if (depth < maxFallbackDepth) {
          await waitForExtractionRetry(400);
          if (isExtractionTimeout(error) && batch.length > 1) {
            const recovered: OntologyCandidate[] = [];
            for (const chunk of batch) recovered.push(...await analyzeWithFallback([chunk], signal, depth + 1));
            return recovered;
          }
          return analyzeWithFallback(batch, signal, depth + 1);
        }
        throw new Error(maxFallbackDepth > 0
          ? 'AI 服务连接暂时中断，系统已自动重试但仍未恢复。请稍后直接重试，无需修改文档。'
          : 'AI 服务连接暂时中断。系统已暂停后续批次以避免长时间空等，请稍后继续未完成内容。', { cause: error });
      }
      if (!(error instanceof OntologyModelOutputError)) throw error;
      if (depth >= maxFallbackDepth) {
        throw new Error(`模型对切片 ${batch[0]!.id} 返回的结构化结果不完整，请稍后仅重试该批次。`, { cause: error });
      }
      if (batch.length === 1) {
        const split = splitExtractionChunkForRetry(batch[0]!);
        if (split) {
          return [
            ...await analyzeWithFallback([split[0]], signal, depth + 1),
            ...await analyzeWithFallback([split[1]], signal, depth + 1),
          ];
        }
        throw new Error(`模型对切片 ${batch[0]!.id} 返回的结构化结果不完整，请重试或减少分析范围。`, { cause: error });
      }
      const middle = Math.ceil(batch.length / 2);
      return [
        ...await analyzeWithFallback(batch.slice(0, middle), signal, depth + 1),
        ...await analyzeWithFallback(batch.slice(middle), signal, depth + 1),
      ];
    }
  };

  const batches = partitionOntologyExtractionChunks(chunks, options);
  options.onProgress?.({ phase: '整理分析批次', currentBatch: 0, totalBatches: batches.length });
  const concurrency = Math.min(batches.length, Math.max(1, Math.floor(options.concurrency || EXTRACTION_BATCH_CONCURRENCY)));
  const batchCandidates: OntologyCandidate[][] = new Array(batches.length);
  const failedBatches = new Set<number>();
  const failures: OntologyExtractionFailure[] = [];
  const batchSlots: OntologyExtractionBatchStatus[] = [];
  let nextBatchIndex = 0;
  let lastFailureCategory: OntologyExtractionFailureCategory | undefined;
  let consecutiveSameFailures = 0;
  let circuitOpen = false;
  const isProviderWideFailure = (category: OntologyExtractionFailureCategory) =>
    category === 'provider_timeout' || category === 'provider_http' || category === 'provider_error' || category === 'schema_unsupported';
  const reportProgress = () => options.onProgress?.({ phase: 'AI 识别', currentBatch: batchCandidates.filter(Boolean).length, totalBatches: batches.length, discovered: batchCandidates.filter(Boolean).flat().length, failedBatches: failedBatches.size, activeBatches: batchSlots.filter(Boolean).map((item) => ({ ...item })), failures: failures.map((item) => ({ ...item, chunkIds: [...item.chunkIds] })) });
  const workers = Array.from({ length: concurrency }, async (_, workerIndex) => {
    while (nextBatchIndex < batches.length) {
      const batchIndex = nextBatchIndex++;
      const batch = batches[batchIndex]!;
      if (circuitOpen || options.control?.stopped) {
        const stopped = options.control?.stopped;
        const failure: OntologyExtractionFailure = { category: stopped ? 'user_stopped' : 'deferred_after_repeated_failure', message: stopped ? '用户已停止分析，本批次尚未提交，可稍后继续。' : '前序批次连续发生相同故障，本批次未提交模型，等待稍后继续。', retryable: true, batchNumber: batchIndex + 1, chunkIds: batch.map((chunk) => chunk.id), elapsedMs: 0 };
        failures.push(failure);
        failedBatches.add(batchIndex);
        batchCandidates[batchIndex] = [];
        await options.onBatchFailed?.(batch, new Error(failure.message), failure);
        reportProgress();
        continue;
      }
      options.signal?.throwIfAborted();
      const batchController = new AbortController();
      const signal = options.signal ? AbortSignal.any([options.signal, batchController.signal]) : batchController.signal;
      const release = options.control?.register(batchIndex + 1, batchController);
      batchSlots[workerIndex] = { slot: workerIndex + 1, batchNumber: batchIndex + 1, state: 'running', phase: '模型正在识别实体与关系', chunkCount: batch.length, documentTitles: [...new Set(batch.map((chunk) => chunk.documentTitle))].slice(0, 3), startedAt: Date.now() };
      reportProgress();
      try {
        batchCandidates[batchIndex] = await analyzeWithFallback(batch, signal);
        signal.throwIfAborted();
        release?.();
        await options.onBatchComplete?.(batchCandidates[batchIndex]!, batch);
        const completedAt = Date.now();
        batchSlots[workerIndex] = { ...batchSlots[workerIndex]!, state: 'completed', phase: '证据已核验并保存', completedAt, elapsedMs: completedAt - batchSlots[workerIndex]!.startedAt, candidates: batchCandidates[batchIndex]!.length };
        lastFailureCategory = undefined;
        consecutiveSameFailures = 0;
      } catch (error) {
        if (!options.continueOnError || options.signal?.aborted) throw error;
        failedBatches.add(batchIndex);
        batchCandidates[batchIndex] = [];
        const completedAt = Date.now();
        const interruption = error instanceof OntologyUserInterruption ? error : undefined;
        const failure: OntologyExtractionFailure = { ...(interruption ? { category: interruption.category, message: interruption.message, retryable: true, chunkIds: batch.map(chunk => chunk.id) } : describeOntologyExtractionError(error, batch.map((chunk) => chunk.id))), batchNumber: batchIndex + 1, elapsedMs: completedAt - batchSlots[workerIndex]!.startedAt };
        failures.push(failure);
        await options.onBatchFailed?.(batch, error, failure);
        batchSlots[workerIndex] = { ...batchSlots[workerIndex]!, state: interruption ? 'skipped' : 'failed', phase: interruption ? (interruption.category === 'user_skipped' ? '已跳过，继续下一批' : '已停止，结果已保留') : '等待继续处理', completedAt, elapsedMs: failure.elapsedMs, candidates: 0, failure };
        if (isProviderWideFailure(failure.category)) {
          consecutiveSameFailures = lastFailureCategory === failure.category ? consecutiveSameFailures + 1 : 1;
          lastFailureCategory = failure.category;
          if (failure.retryable && consecutiveSameFailures >= Math.max(1, options.maxConsecutiveSameFailures || 2)) circuitOpen = true;
        } else {
          lastFailureCategory = undefined;
          consecutiveSameFailures = 0;
        }
      } finally { release?.(); }
      reportProgress();
    }
  });
  await Promise.all(workers);

  const candidates: OntologyCandidate[] = [];
  const seen = new Set<string>();
  for (const batch of batchCandidates) {
    for (const candidate of batch) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      candidates.push(candidate);
    }
  }
  if (!candidates.length && failedBatches.size && !options.continueOnError) throw new Error('AI 服务未能完成任何分析批次，请稍后重试。');
  if (!candidates.length && !failedBatches.size && !options.continueOnError) throw new Error('没有从所选文档中识别到可审核的实体或关系。');
  return candidates;
}

export async function extractOntologyCandidates(input: {
  kb: KnowledgeBaseRuntime;
  documentIds: string[];
  chunkIds?: string[];
  instructions?: string;
  model: ModelConfig;
  intensity?: 'quick' | 'standard' | 'deep';
  signal?: AbortSignal;
  control?: OntologyExtractionControl;
  onProgress?: (event: OntologyExtractionProgress) => void;
  onDiagnostic?: (failure: OntologyExtractionFailure) => void;
}) {
  input.onProgress?.({ phase: '读取文档', currentBatch: 0, totalBatches: 0 });
  const selected = new Set(input.documentIds), selectedChunks = input.chunkIds?.length ? new Set(input.chunkIds) : undefined;
  const chunks: ExtractionChunk[] = [];
  for (const documentId of selected) {
    const listed = await listKnowledgeChunks({ kb: input.kb, documentId, offset: 0, limit: 50 });
    for (const chunk of listed.chunks) {
      if (chunks.length >= 60) break;
      if (!selectedChunks || selectedChunks.has(chunk.id)) chunks.push({ id: chunk.id, documentId: chunk.documentId, documentTitle: chunk.documentTitle, source: chunk.source, content: chunk.content.slice(0, 2200) });
    }
    if (chunks.length >= 60) break;
  }
  if (!chunks.length) throw new Error('所选文档没有可用于分析的知识切片。');

  const checkpointKey = (chunk: ExtractionChunk) => createHash('sha256').update(JSON.stringify({ version: 1, chunk, provider: input.model.provider, baseUrl: input.model.baseUrl, model: input.model.chatModel, instructions: input.instructions?.trim() || '', intensity: input.intensity || 'standard' })).digest('hex');
  const saved = await readOntologyExtractionCheckpoints(input.kb, chunks.map(checkpointKey));
  const reusedChunks = chunks.filter((chunk) => saved.checkpoints[checkpointKey(chunk)] !== undefined);
  const reusedIds = new Set(reusedChunks.flatMap((chunk) => saved.checkpoints[checkpointKey(chunk)]));
  const reusedCandidates = saved.workflow.candidates.filter((candidate) => reusedIds.has(candidate.id));
  const prioritizedChunks = prioritizeOntologyExtractionChunks(chunks.filter((chunk) => saved.checkpoints[checkpointKey(chunk)] === undefined), input.instructions);
  const qwenCompatible = input.model.provider === 'qwen';
  const profile = qwenCompatible
    ? { maxChunks: 1, maxChars: 2200, maxTokens: input.intensity === 'deep' ? 3200 : 2600, timeoutMs: 120_000 }
    : input.intensity === 'quick'
      ? { maxChunks: 2, maxChars: 4000, maxTokens: 1000, timeoutMs: 90_000 }
      : input.intensity === 'deep'
        ? { maxChunks: 2, maxChars: 4500, maxTokens: 2200, timeoutMs: 90_000 }
        : { maxChunks: 2, maxChars: 4500, maxTokens: 1400, timeoutMs: 90_000 };
  const concurrency = ontologyExtractionConcurrency(input.model);
  const failedChunkIds = new Set<string>();
  const skippedChunkIds = new Set<string>();
  const completedChunkIds = new Set<string>(reusedChunks.map((chunk) => chunk.id));
  let failedBatchCount = 0;
  let lastProgress = { currentBatch: 0, totalBatches: 0, discovered: 0, failedBatches: 0, activeBatches: [] as OntologyExtractionBatchStatus[] };
  let savedWorkflow: Awaited<ReturnType<typeof importOntologyCandidates>> | undefined;
  let saveQueue = Promise.resolve();
  const persistedCandidateIds = new Set<string>(reusedCandidates.map((candidate) => candidate.id));
  const failures: OntologyExtractionFailure[] = [];
  const flushCandidates = async (items: OntologyCandidate[], batch: ExtractionChunk[]) => {
    saveQueue = saveQueue.then(async () => {
      savedWorkflow = await saveOntologyExtractionBatch(input.kb, items, batch.map((chunk) => ({ key: checkpointKey(chunk), candidateIds: items.filter((candidate) => candidate.evidence.some((evidence) => evidence.chunkId === chunk.id)).map((candidate) => candidate.id) })));
      for (const item of items) persistedCandidateIds.add(item.id);
    });
    await saveQueue;
  };
  const extractionJsonSchema = {
    name: 'ontology_candidates', strict: true, schema: {
      type: 'object', additionalProperties: false, required: ['nodes', 'edges'], properties: {
        nodes: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['id', 'type', 'name', 'aliases', 'confidence', 'evidence'], properties: { id: { type: 'string', maxLength: 80 }, type: { type: 'string', maxLength: 80 }, name: { type: 'string', maxLength: 120 }, aliases: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 120 } }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidence: { type: 'object', additionalProperties: false, required: ['chunkId', 'quote'], properties: { chunkId: { type: 'string', maxLength: 240 }, quote: { type: 'string', maxLength: 240 } } } } } },
        edges: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['subjectId', 'predicate', 'objectId', 'confidence', 'evidence'], properties: { subjectId: { type: 'string', maxLength: 80 }, predicate: { type: 'string', maxLength: 80 }, objectId: { type: 'string', maxLength: 80 }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidence: { type: 'object', additionalProperties: false, required: ['chunkId', 'quote'], properties: { chunkId: { type: 'string', maxLength: 240 }, quote: { type: 'string', maxLength: 240 } } } } } },
      },
    },
  };
  const newCandidates = await extractOntologyCandidateBatches(prioritizedChunks, async (batch, signal) => {
    const cacheKey = extractionCacheKey({ model: input.model, instructions: input.instructions, batch });
    const cached = extractionResponseCache.get(cacheKey);
    if (cached) {
      extractionResponseCache.delete(cacheKey);
      extractionResponseCache.set(cacheKey, cached);
      return cached;
    }
    const corpus = batch.map((chunk) => `<chunk id="${chunk.id}" document="${chunk.documentId}" title="${chunk.documentTitle}">\n${chunk.content}\n</chunk>`).join('\n\n');
    const prompt = {
      systemPrompt: [
        '你是企业知识本体分析器。只依据提供的知识切片识别业务实体、概念及明确关系，不补充外部事实。',
        '必须返回一个 JSON 对象，结构为 {"nodes":[],"edges":[]}，不要输出解释。没有候选时返回空数组。',
        '每个 node 只包含 id,type,name,aliases,confidence,evidence:{chunkId,quote}。',
        '每个 edge 只包含 subjectId,predicate,objectId,confidence,evidence:{chunkId,quote}；两端必须引用 nodes 中的 id。',
        'id 使用简短稳定的英文或拼音标识。quote 必须是对应切片中的原文证据。合并同义实体，避免重复和过度抽取。',
        'evidence.chunkId 必须逐字复制当前输入中 <chunk id="..."> 的 id；不得填写 document、title、实体 id 或其他批次的 id。',
        '每次最多返回 8 个节点和 12 条关系，证据 quote 只保留能核验结论的最短原文。逐个检查每个 chunk，只保留对业务检索有明确价值的候选。',
      ].join('\n'),
      messages: [{ role: 'user' as const, timestamp: Date.now(), content: [{ type: 'text' as const, text: `${input.instructions?.trim() ? `分析重点：${input.instructions.trim()}\n\n` : ''}请从以下文档切片生成待人工审核的本体候选：\n\n${corpus}` }] }],
    };
    const requestCompletion = (useStrictSchema: boolean) => completeSimple(toPiModel(input.model), prompt, {
      apiKey: input.model.apiKey || (input.model.provider === 'ollama' ? 'ollama' : undefined),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(profile.timeoutMs)]) : AbortSignal.timeout(profile.timeoutMs),
      maxTokens: profile.maxTokens,
      onPayload: (payload) => {
        createChatCompletionsPayloadPatch(input.model)(payload);
        if (input.model.provider === 'qwen' && payload && typeof payload === 'object') {
          const body = payload as Record<string, unknown>;
          body.enable_thinking = false;
          body.response_format = useStrictSchema ? { type: 'json_schema', json_schema: extractionJsonSchema } : { type: 'json_object' };
          body.temperature = 0.1;
        }
      },
    });
    const capabilityKey = `${input.model.provider}:${input.model.baseUrl || ''}:${input.model.chatModel}`;
    const useStrictSchema = !qwenCompatible && strictSchemaSupport.get(capabilityKey) !== false;
    let response;
    try {
      response = await requestCompletion(useStrictSchema);
    } catch (error) {
      if (!useStrictSchema || input.model.provider !== 'qwen' || !/json.schema|response.format|unsupported|invalid parameter|400/i.test(errorChainText(error))) throw error;
      strictSchemaSupport.set(capabilityKey, false);
      response = await requestCompletion(false);
    }
    if (useStrictSchema && input.model.provider === 'qwen' && response.stopReason === 'error' && /json.schema|response.format|unsupported|invalid parameter/i.test(response.errorMessage || '')) {
      strictSchemaSupport.set(capabilityKey, false);
      response = await requestCompletion(false);
    }
    signal?.throwIfAborted();
    if (response.stopReason === 'length') throw new OntologyModelOutputError('模型输出达到长度上限（output truncated）。');
    if (response.stopReason === 'error' || response.stopReason === 'aborted') throw new OntologyProviderResponseError(response.errorMessage || '本体分析模型未完成请求。', response.stopReason);
    const text = response.content.filter((part): part is { type: 'text'; text: string } => part.type === 'text').map((part) => part.text).join('\n').trim();
    parseModelJson(text);
    cacheExtractionResponse(cacheKey, text);
    return text;
  }, { concurrency, maxChunks: profile.maxChunks, maxChars: profile.maxChars, signal: input.signal, control: input.control, continueOnError: true, maxFallbackDepth: 1, maxConsecutiveSameFailures: 2, onBatchComplete: async (items, completedBatch) => {
    await flushCandidates(items, completedBatch);
    for (const chunk of completedBatch) completedChunkIds.add(chunk.id);
  }, onBatchFailed: (failed, _error, failure) => { failedBatchCount += 1; failures.push(failure); input.onDiagnostic?.(failure); for (const chunk of failed) { failedChunkIds.add(chunk.id); if (failure.category === 'user_skipped' || failure.category === 'user_stopped') skippedChunkIds.add(chunk.id); } }, onProgress: (event) => {
    lastProgress = { ...lastProgress, ...event };
    input.onProgress?.({ ...event, discovered: persistedCandidateIds.size, candidateIds: [...persistedCandidateIds], skippedChunkIds: [...skippedChunkIds], completedChunkIds: [...completedChunkIds], failedChunkIds: [...failedChunkIds] });
  } });
  const candidates = [...reusedCandidates, ...newCandidates];
  input.onProgress?.({ phase: '证据核验与候选归并', candidateIds: [...persistedCandidateIds], currentBatch: lastProgress.currentBatch, totalBatches: lastProgress.totalBatches, discovered: candidates.length, failedBatches: failedBatchCount, activeBatches: lastProgress.activeBatches, completedChunkIds: [...completedChunkIds], failedChunkIds: [...failedChunkIds] });
  await saveQueue;
  const workflow = savedWorkflow || saved.workflow;
  return { workflow, generated: candidates.length, candidateIds: candidates.map((item) => item.id), nodes: candidates.filter((item) => item.kind === 'node').length, edges: candidates.filter((item) => item.kind === 'edge').length, analyzedChunks: chunks.length - failedChunkIds.size, failedBatches: failedBatchCount, failedChunkIds: [...failedChunkIds], skippedChunkIds: [...skippedChunkIds], failures };
}

export async function suggestOntologyGovernanceRepairs(input: { graph: OntologyGraph; issues: OntologyGovernanceIssue[]; model: ModelConfig }) {
  const allowedNodeIds = new Set(input.issues.flatMap((issue) => issue.nodeIds));
  const allowedEdgeIds = new Set(input.issues.flatMap((issue) => issue.edgeIds));
  const scopedEdges = input.graph.edges.filter((edge) => allowedEdgeIds.has(edge.id) || allowedNodeIds.has(edge.subjectId) || allowedNodeIds.has(edge.objectId));
  for (const edge of scopedEdges) { allowedNodeIds.add(edge.subjectId); allowedNodeIds.add(edge.objectId); }
  const scopedGraph = { version: input.graph.version, nodes: input.graph.nodes.filter((node) => allowedNodeIds.has(node.id)), edges: scopedEdges };
  const response = await completeSimple(toPiModel(input.model), {
    systemPrompt: [
      '你是企业本体治理助手。只能针对给定问题提出草稿修复命令，不能编造实体、关系或证据。',
      '返回 JSON：{"suggestions":[{"issueId":"...","confidence":0.9,"reason":"...","commands":[...]}]}。不要输出解释或 Markdown。',
      '允许的命令仅包括 merge_nodes、rename_node、change_node_type、delete_node、delete_edge、reverse_edge。',
      '合并实体需谨慎；证据或语义不足时不要建议合并。删除孤立实体默认低置信度。',
    ].join('\n'),
    messages: [{ role: 'user', timestamp: Date.now(), content: [{ type: 'text', text: JSON.stringify({ nodes: scopedGraph.nodes, edges: scopedGraph.edges, issues: input.issues }) }] }],
  }, { apiKey: input.model.apiKey || (input.model.provider === 'ollama' ? 'ollama' : undefined), signal: AbortSignal.timeout(120_000), maxTokens: 6000, onPayload: createChatCompletionsPayloadPatch(input.model) });
  if (response.stopReason === 'error' || response.stopReason === 'aborted') throw new Error(response.errorMessage || 'AI 治理建议生成失败。');
  const text = response.content.filter((part): part is { type: 'text'; text: string } => part.type === 'text').map((part) => part.text).join('\n');
  const raw = (/```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1] || text).trim(), start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回完整的治理建议 JSON。');
  const parsed = z.object({ suggestions: z.array(z.object({ issueId: z.string(), confidence: z.number().min(0).max(1).catch(0.5), reason: z.string().max(2000).catch('模型未提供说明'), commands: z.array(z.record(z.string(), z.unknown())).max(20).catch([]) })).max(100) }).parse(JSON.parse(raw.slice(start, end + 1)));
  const issueIds = new Set(input.issues.map((issue) => issue.id));
  const issueById = new Map(input.issues.map((issue) => [issue.id, issue]));
  const commandIsScoped = (command: OntologyGovernanceCommand) => {
    if (command.type === 'merge_nodes') return command.nodeIds.every((id) => allowedNodeIds.has(id)) && allowedNodeIds.has(command.canonicalId);
    if (command.type === 'rename_node' || command.type === 'change_node_type' || command.type === 'delete_node' || command.type === 'mark_term') return allowedNodeIds.has(command.nodeId) && (!('migrateToNodeId' in command) || !command.migrateToNodeId || allowedNodeIds.has(command.migrateToNodeId));
    if (command.type === 'add_edge') return allowedNodeIds.has(command.subjectId) && allowedNodeIds.has(command.objectId);
    return allowedEdgeIds.has(command.edgeId);
  };
  return parsed.suggestions.map((suggestion) => ({ ...suggestion, commands: normalizeAiGovernanceCommands(suggestion.commands, issueById.get(suggestion.issueId), input.graph) })).filter((suggestion) => issueIds.has(suggestion.issueId) && suggestion.commands.length && suggestion.commands.every(commandIsScoped)) as Array<{ issueId: string; confidence: number; reason: string; commands: OntologyGovernanceCommand[] }>;
}

export function normalizeAiGovernanceCommands(rawCommands: Array<Record<string, unknown>>, issue: OntologyGovernanceIssue | undefined, graph: OntologyGraph): OntologyGovernanceCommand[] {
  if (!issue) return [];
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node])), normalized: OntologyGovernanceCommand[] = [];
  for (const raw of rawCommands) {
    const type = String(raw.type || '');
    let candidate: unknown = raw;
    if (type === 'merge_nodes') {
      const requested = Array.isArray(raw.nodeIds) ? raw.nodeIds.map(String).filter((id) => issue.nodeIds.includes(id)) : [];
      const nodeIds = requested.length >= 2 ? requested : issue.nodeIds;
      const canonicalId = typeof raw.canonicalId === 'string' && nodeIds.includes(raw.canonicalId) ? raw.canonicalId : nodeIds[0];
      const canonicalName = typeof raw.canonicalName === 'string' && raw.canonicalName.trim() ? raw.canonicalName.trim() : (canonicalId ? nodeById.get(canonicalId)?.name : undefined);
      candidate = { type, nodeIds, canonicalId, canonicalName };
    } else if (type === 'delete_edge' || type === 'reverse_edge') {
      const edgeId = typeof raw.edgeId === 'string' ? raw.edgeId : issue.edgeIds[0]; candidate = { type, edgeId };
    } else if (type === 'delete_node') {
      const nodeId = typeof raw.nodeId === 'string' ? raw.nodeId : issue.nodeIds[0]; candidate = { type, nodeId, ...(typeof raw.migrateToNodeId === 'string' ? { migrateToNodeId: raw.migrateToNodeId } : {}) };
    } else if (type === 'rename_node') {
      const nodeId = typeof raw.nodeId === 'string' ? raw.nodeId : issue.nodeIds[0]; candidate = { type, nodeId, name: raw.name, keepOldAsAlias: raw.keepOldAsAlias !== false };
    } else if (type === 'change_node_type') {
      const nodeId = typeof raw.nodeId === 'string' ? raw.nodeId : issue.nodeIds[0]; candidate = { type, nodeId, nodeType: raw.nodeType };
    }
    const parsed = OntologyGovernanceCommandSchema.safeParse(candidate); if (parsed.success) normalized.push(parsed.data);
  }
  return normalized;
}
