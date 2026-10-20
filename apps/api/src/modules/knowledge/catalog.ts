import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hydrateKnowledgeRuntime } from './runtime-config.js';
import {
  KnowledgeBaseRuntimeSchema, KnowledgeBaseIdSchema, KnowledgeOwnershipSchema, KnowledgeConfigRowsSchema,
  type KnowledgeOwnership, type KnowledgeBaseRuntime,
} from '@workexpert/contracts';

type Principal = { orgId: string; userId: string; role?: string };
type Row = Record<string, unknown> & { id: string; ownership?: KnowledgeOwnership; retired?: boolean };
const secretKeys = ['apiKey', 'accessKeySecret', 'embeddingApiKey'] as const;
export class KnowledgeAccessError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string) {
    super(code); this.name = 'KnowledgeAccessError';
  }
}
const deny = (): never => { throw new KnowledgeAccessError(404, 'KNOWLEDGE_NOT_FOUND'); };
const invalid = (): never => { throw new KnowledgeAccessError(400, 'INVALID_KNOWLEDGE_CONFIG'); };
export const knowledgeDataRoot = () => process.env.WORKEXPERT_DATA_DIR || path.join(os.homedir(), '.workexpert');
const own = (row: Row, p: Principal) => !row.retired && row.ownership?.orgId === p.orgId && row.ownership.ownerUserId === p.userId;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

/** API single writer. No ownership is inferred during reads or legacy import. */
export class KnowledgeCatalog {
  constructor(private readonly root = knowledgeDataRoot()) {}
  private file() { return path.join(this.root, 'knowledge-bases.json'); }
  private load(): Row[] {
    try {
      const input = fs.existsSync(this.file()) ? JSON.parse(fs.readFileSync(this.file(), 'utf8')) : undefined;
      if (input?.schemaVersion !== undefined && input.schemaVersion !== 2) throw new Error('schema');
      const rows: unknown = input === undefined ? [] : Array.isArray(input) ? input : input.meta;
      if (!Array.isArray(rows)) throw new Error('rows');
      const secrets = record(record(input?.secrets).bases);
      const result = rows.map((value): Row => {
        const row = record(value);
        if (typeof row.id !== 'string' || !row.id) throw new Error('id');
        const ownership = row.ownership === undefined ? undefined : KnowledgeOwnershipSchema.parse(row.ownership);
        return { ...row, ...record(secrets[row.id]), id: row.id, ...(ownership ? { ownership } : {}) };
      });
      // Desktop used domain KV; import a read-only snapshot only before catalog v2 exists.
      const domainPath = path.join(this.root, 'domain.json');
      if (input?.schemaVersion !== 2 && fs.existsSync(domainPath)) {
        const domain = JSON.parse(fs.readFileSync(domainPath, 'utf8'));
        const legacyValues = Object.entries(record(domain?.kv)).filter(([key]) => key === 'capabilities.knowledge'
          || /^user:[^:]+:capabilities\.knowledge$/.test(key)).map(([, value]) => value);
        for (const legacy of legacyValues) {
          const list = typeof legacy === 'string' ? JSON.parse(legacy) : legacy;
          if (!Array.isArray(list)) throw new Error('legacy');
          for (const value of list) {
            const row = record(value);
            if (typeof row.id !== 'string' || !row.id) throw new Error('legacy id');
            const existing = result.find((item) => item.id === row.id);
            if (existing) {
              // Conflicting sources must be reconciled deliberately, never silently repointed.
              for (const key of ['provider', 'dataDir', 'baseUrl', 'externalId']) {
                if (String(existing[key] || '') !== String(row[key] || '')) throw new Error('legacy conflict');
              }
            } else {
              const { ownership: _untrusted, retired: _retired, ...config } = row;
              result.push({ ...config, id: row.id });
            }
          }
        }
      }
      if (new Set(result.map((row) => row.id)).size !== result.length) throw new Error('duplicate');
      return result;
    } catch { throw new KnowledgeAccessError(503, 'KNOWLEDGE_CATALOG_UNAVAILABLE'); }
  }
  private write(rows: Row[]): void {
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const target = this.file();
    if (fs.existsSync(target) && !fs.existsSync(`${target}.pre-ownership.bak`)) {
      fs.copyFileSync(target, `${target}.pre-ownership.bak`, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(`${target}.pre-ownership.bak`, 0o600);
    }
    const meta = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !secretKeys.includes(key as typeof secretKeys[number]))));
    const secrets = { bases: Object.fromEntries(rows.map((row) => [row.id,
      Object.fromEntries(secretKeys.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]))])) };
    const temporary = `${target}.${randomUUID()}.tmp`;
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {
      try { fs.writeFileSync(fd, JSON.stringify({ schemaVersion: 2, meta, secrets }, null, 2)); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      fs.renameSync(temporary, target);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  list(principal: Principal): Row[] { return this.load().filter((row) => own(row, principal)); }
  unassigned(principal: Principal) {
    if (principal.role !== 'admin') throw new KnowledgeAccessError(403, 'ADMIN_REQUIRED');
    return this.load().filter((row) => !row.ownership && !row.retired)
      .map((row) => ({ id: row.id, name: String(row.name || row.id), provider: String(row.provider || '') }));
  }
  resolve(principal: Principal, id: unknown): KnowledgeBaseRuntime {
    if (typeof id !== 'string') return deny();
    const row = this.load().find((item) => item.id === id);
    if (!row || !own(row, principal) || row.enabled === false) return deny();
    let hydrated: Record<string, unknown>;
    try { hydrated = hydrateKnowledgeRuntime(this.root, principal.userId, row); }
    catch { throw new KnowledgeAccessError(503, 'KNOWLEDGE_CONFIG_INVALID'); }
    const parsed = KnowledgeBaseRuntimeSchema.safeParse(this.runtimeInput({ ...hydrated,
      wikiAccess: { orgId: principal.orgId, userId: principal.userId, sourceRoot: path.join(this.root, 'knowledge-sources') },
    }));
    if (!parsed.success) throw new KnowledgeAccessError(503, 'KNOWLEDGE_CONFIG_INVALID');
    return parsed.data;
  }
  private runtimeInput(row: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(row).filter(([key, value]) => !(['baseUrl', 'embeddingBaseUrl'].includes(key) && !value)));
  }
  save(principal: Principal, input: unknown): Row[] {
    const parsed = KnowledgeConfigRowsSchema.safeParse(input);
    if (!parsed.success) return invalid();
    const current = this.load();
    const ids = new Set<string>();
    const next = parsed.data.map((raw): Row => {
      const idResult = KnowledgeBaseIdSchema.safeParse(raw.id);
      if (!idResult.success || ids.has(idResult.data) || raw.retired !== undefined
        || ['orgId', 'ownerUserId', 'userId', 'wikiAccess'].some((key) => key in raw)) return invalid();
      const id = idResult.data; ids.add(id);
      const previous = current.find((row) => row.id === id);
      if (previous && !own(previous, principal)) return deny();
      if (raw.ownership !== undefined) {
        const ownership = KnowledgeOwnershipSchema.safeParse(raw.ownership);
        if (!previous || !ownership.success || JSON.stringify(ownership.data) !== JSON.stringify(previous.ownership)) return invalid();
      }
      const validation = KnowledgeBaseRuntimeSchema.safeParse(this.runtimeInput(raw));
      if (!validation.success) return invalid();
      const row: Row = { ...validation.data, id,
        documentCount: Number(raw.documentCount) || 0, updatedAt: Date.now(),
        ownership: previous?.ownership ?? { schemaVersion: 1, orgId: principal.orgId, ownerUserId: principal.userId,
          assignedBy: principal.userId, assignedAt: new Date().toISOString() } };
      if (previous) {
        for (const key of ['provider', 'dataDir', 'baseUrl', 'externalId', 'workspaceId']) {
          if (String(raw[key] || '') !== String(previous[key] || '')) throw new KnowledgeAccessError(409, 'KNOWLEDGE_LOCATION_IMMUTABLE');
        }
      } else if (row.provider === 'lancedb') {
        if (raw.dataDir) return invalid();
        row.dataDir = path.join(this.root, 'knowledge-bases', id);
        if (fs.existsSync(String(row.dataDir))) throw new KnowledgeAccessError(409, 'KNOWLEDGE_LOCATION_OCCUPIED');
      }
      return row;
    });
    const retained = current.filter((row) => !ids.has(row.id)).map((row) => own(row, principal) ? { ...row, retired: true } : row);
    this.write([...retained, ...next]);
    return next;
  }
  assign(principal: Principal, id: string, target: { id: string; orgId: string; disabled?: boolean }): KnowledgeOwnership {
    if (principal.role !== 'admin') throw new KnowledgeAccessError(403, 'ADMIN_REQUIRED');
    if (target.disabled || target.orgId !== principal.orgId || target.id === 'internal-desktop') return deny();
    const rows = this.load(), row = rows.find((item) => item.id === id && !item.retired);
    if (!row) return deny();
    if (row.ownership) {
      if (row.ownership.orgId === principal.orgId && row.ownership.ownerUserId === target.id) return row.ownership;
      throw new KnowledgeAccessError(409, 'KNOWLEDGE_ALREADY_ASSIGNED');
    }
    row.ownership = { schemaVersion: 1, orgId: target.orgId, ownerUserId: target.id,
      assignedBy: principal.userId, assignedAt: new Date().toISOString() };
    this.write(rows);
    return row.ownership;
  }
}
