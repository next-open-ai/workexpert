<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { MAX_LOCAL_KNOWLEDGE_FILE_BYTES, MAX_BAILIAN_KNOWLEDGE_FILE_BYTES, MAX_KNOWLEDGE_TEXT_CHARS } from '@workexpert/contracts';
import { useI18n } from '../../app/i18n';
import {
  knowledgeProviderIds,
  knowledgeProviderMeta,
  useKnowledgeConfig,
  type KnowledgeBase,
  type KnowledgeProviderId,
} from '../../app/kb-config';
import { resolveActiveEmbeddingConfig, resolveEmbeddingConfigById, toModelPayload, useModelConfig } from '../../app/model-config';
import { useNotify } from '../../app/notify';
import OntologyWorkbench from './OntologyWorkbench.vue';
import WikiWorkbench from './WikiWorkbench.vue';
const RetrievalEvaluationPanel = defineAsyncComponent(() => import('./RetrievalEvaluationPanel.vue'));
const evaluationOpen = ref(false);
import {
  deleteKnowledgeChunk,
  deleteKnowledgeDocument,
  ingestKnowledgeDocument,
  listKnowledgeChunks,
  listKnowledgeDocuments,
  createBailianKnowledge,
  listBailianIndices,
  listBailianPipelines,
  getKnowledgeJobStatus,
  searchKnowledge,
  searchKnowledgeWithOntology,
  type KnowledgeChunkRow,
  type KnowledgeDocumentRow,
  type KnowledgeBasePayload,
} from '../../services/api';

defineProps<{ isAdmin?: boolean }>();

const emit = defineEmits<{ openSettings: [] }>();
const { t } = useI18n();
const notify = useNotify();
const { bases, load, upsert, remove, setEnabled, setDocumentCount, setIndexState, isReady, enabledProviders, isProviderEnabled, providerDefaults, resolveCredentials } = useKnowledgeConfig();
const { activeConfig, configured, settings: modelSettings, load: loadModels } = useModelConfig();

type DetailTab = 'documents' | 'chunks' | 'search' | 'ontology' | 'wiki' | 'settings';
type ProviderFilter = 'all' | KnowledgeProviderId;

const providerFilter = ref<ProviderFilter>('all');
const selectedId = ref<string | null>(null);
const detailTab = ref<DetailTab>('documents');
async function openWiki(id: string) {
  selectedId.value = id;
  // Let the existing selection watcher initialize the library before choosing its Wiki tab.
  await nextTick();
  if (selectedId.value === id) detailTab.value = 'wiki';
}
const formOpen = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);
const loadingDocs = ref(false);
const loadingChunks = ref(false);
const ingestOpen = ref(false);
const ingestBusy = ref(false);
const ingestMode = ref<'file' | 'text'>('file');
const ingestStage = ref<'idle' | 'reading' | 'ready' | 'processing' | 'success' | 'error'>('idle');
const ingestError = ref('');
const ingestResult = ref('');
const ingestFileSize = ref(0);
const ingestDragActive = ref(false);
const ingestFileInput = ref<HTMLInputElement | null>(null);
const ingestTitle = ref('');
const ingestContent = ref('');
const ingestSource = ref('');
const chunkQuery = ref('');
const chunkDocumentId = ref('');
const searchQuery = ref('');
const searching = ref(false);
const searchError = ref('');
const searchValidation = ref('');
const searchStrategy = ref<'vector-only' | 'hybrid' | 'ontology-enhanced' | null>(null);
const documents = ref<KnowledgeDocumentRow[]>([]);
const chunks = ref<KnowledgeChunkRow[]>([]);
const chunkTotal = ref(0);
const docStats = ref({ documentCount: 0, chunkCount: 0, backend: '' });
const searchHits = ref<Array<{ id: string; title: string; content: string; score: number; source?: string; wiki?: import('@workexpert/contracts').WikiRecall; retrieval?: import('@workexpert/contracts').KnowledgeRetrieval; context?: import('@workexpert/contracts').KnowledgeParentContext; retrievalRoutes?: Array<'raw-vector' | 'ontology-vector' | 'ontology-evidence'> }>>([]);
const selectedChunk = ref<KnowledgeChunkRow | null>(null);
const wikiPageId = ref<string>();
watch(selectedId, () => { wikiPageId.value = undefined; });
watch(selectedId, () => { evaluationOpen.value = false; });
function openWikiResult(pageId: string) { wikiPageId.value = pageId; detailTab.value = 'wiki'; }
let searchRequestId = 0;

function invalidateSearch() {
  searchRequestId += 1;
  searching.value = false;
  searchHits.value = [];
  searchStrategy.value = null;
  searchError.value = '';
  searchValidation.value = '';
}

// Synchronous invalidation also covers A → list → A before an old response arrives.
watch([selectedId, searchQuery], invalidateSearch, { flush: 'sync' });
onBeforeUnmount(invalidateSearch);

const searchSummary = computed(() => {
  const hits = searchHits.value;
  const degraded = hits.some(hit => hit.retrieval?.degraded);
  const channels = new Set(hits.flatMap(hit => hit.retrieval?.channels ?? []));
  const sources = channels.has('keyword') && channels.has('vector') ? '关键词与语义'
    : channels.has('keyword') ? '关键词' : channels.has('vector') ? '语义' : '';
  const wikiMatched = hits.some(hit => hit.wiki);
  const ontologyMatched = hits.some(hit => hit.retrievalRoutes?.some(route => route !== 'raw-vector'));
  return {
    title: degraded ? '本次使用降级检索' : !hits.length ? '未找到匹配结果'
      : wikiMatched ? '本次结果包含 Wiki 融合召回'
      : ontologyMatched ? '本次结果包含本体增强匹配'
      : sources ? `本次匹配来自${sources}检索` : '本次检索已完成',
    description: (degraded ? '语义检索未完整参与，已返回可用的匹配结果。'
      : !hits.length ? '可调整关键词后再次检索。'
      : wikiMatched ? ''
      : ontologyMatched ? '命中了本体扩展或图谱证据，可展开检索详情查看。'
      : sources ? '显示实际命中的来源，不代表其他检索通道未运行。'
      : '以下为当前知识库返回的匹配结果。')
      + (wikiMatched ? 'Wiki 是带原文引用的整理内容，不作为与原文相互独立的证据；可打开页面核对来源。' : ''),
  };
});

const draft = ref({
  name: '',
  provider: 'lancedb' as KnowledgeProviderId,
  enabled: true,
  ontologyEnabled: true,
  wikiRetrievalEnabled: false,
  wikiRelatedExpansionEnabled: false,
  description: '',
  baseUrl: '',
  apiKey: '',
  externalId: '',
  categoryId: '',
  workspaceId: '',
  accessKeyId: '',
  accessKeySecret: '',
  embeddingMode: 'system' as 'system' | 'model',
  embeddingModelConfigId: '',
});
const bailianPipelines = ref<Array<{ id: string; name: string; workspaceId: string; docNum: number; categoryId?: string }>>([]);
const loadingPipelines = ref(false);
const creatingBailian = ref(false);

/** Local always; cloud providers appear once enabled in Settings. */
const visibleProviderFilters = computed(() => {
  return knowledgeProviderIds.filter((id) => isProviderEnabled(id));
});

const creatableProviders = computed(() => enabledProviders.value.map((item) => item.id));

const filteredBases = computed(() => {
  const rows = [...bases.value]
    .filter((item) => isProviderEnabled(item.provider))
    .sort((a, b) => {
      if (a.provider === 'lancedb' && b.provider !== 'lancedb') return -1;
      if (a.provider !== 'lancedb' && b.provider === 'lancedb') return 1;
      return b.updatedAt - a.updatedAt;
    });
  if (providerFilter.value === 'all') return rows;
  return rows.filter((item) => item.provider === providerFilter.value);
});

const selected = computed(() => bases.value.find((item) => item.id === selectedId.value) ?? null);
const isLocal = computed(() => selected.value?.provider === 'lancedb');
const systemEmbedding = computed(() => resolveActiveEmbeddingConfig(modelSettings.value));
const embeddingModels = computed(() => modelSettings.value.models
  .filter((item) => item.capability === 'embedding')
  .map((item) => {
    const resolved = resolveEmbeddingConfigById(item.id, modelSettings.value);
    return resolved ? { ...resolved, label: item.label || resolved.modelId } : null;
  })
  .filter((item): item is NonNullable<typeof item> => Boolean(item)));
/** Providers that support document/chunk CRUD + upload through the unified knowledge API. */
const supportsManage = computed(() => selected.value?.provider === 'lancedb' || selected.value?.provider === 'bailian');
const detailTabs = computed((): DetailTab[] => (
  supportsManage.value
    ? ['documents', ...(selected.value?.provider === 'lancedb' ? ['wiki' as const] : []), 'ontology', 'search', 'chunks', 'settings']
    : ['search', 'settings']
));
const primaryDetailTabs = computed(() => detailTabs.value.filter((tab) => ['documents', 'wiki', 'ontology'].includes(tab)));
const advancedDetailTabs = computed(() => detailTabs.value.filter((tab) => ['chunks', 'settings'].includes(tab)));
const ingestFileBase64 = ref('');
const ingestFileName = ref('');
const lastJobId = ref('');
const lastJobStatus = ref('');
const ingestCanSubmit = computed(() => Boolean(
  ingestTitle.value.trim()
  && (ingestContent.value.trim() || ingestFileBase64.value.trim())
  && !ingestBusy.value
  && ingestStage.value !== 'success',
));
const ingestProgress = computed(() => ({
  idle: 0,
  reading: 18,
  ready: 34,
  processing: 76,
  success: 100,
  error: ingestFileName.value || ingestContent.value.trim() ? 34 : 0,
}[ingestStage.value]));

onMounted(async () => {
  try { await Promise.all([load(), loadModels()]); }
  catch (cause) { notify.error(cause, 'notify.loadFailed'); }
});

watch(selectedId, async (id) => {
  if (!id) return;
  const item = bases.value.find((row) => row.id === id);
  detailTab.value = (item?.provider === 'lancedb' || item?.provider === 'bailian') ? 'documents' : 'search';
  chunkQuery.value = '';
  chunkDocumentId.value = '';
  searchQuery.value = '';
  searchHits.value = [];
  searchStrategy.value = null;
  selectedChunk.value = null;
  lastJobId.value = '';
  lastJobStatus.value = '';
  await refreshDetail();
});

watch(detailTab, async (tab) => {
  if (!selected.value) return;
  if (tab === 'documents') await loadDocuments();
  if (tab === 'chunks') await loadChunks();
});

function meta(provider: KnowledgeProviderId) {
  return knowledgeProviderMeta[provider];
}

function toPayload(item: KnowledgeBase): KnowledgeBasePayload {
  const creds = resolveCredentials(item);
  const resolvedEmbedding = resolvedEmbeddingFor(item);
  return {
    id: item.id,
    name: item.name,
    provider: item.provider,
    enabled: item.enabled,
    ontologyEnabled: item.ontologyEnabled,
    wikiRetrievalEnabled: item.wikiRetrievalEnabled,
    wikiRelatedExpansionEnabled: item.wikiRelatedExpansionEnabled,
    description: item.description || undefined,
    dataDir: item.dataDir || undefined,
    baseUrl: creds.baseUrl,
    apiKey: creds.apiKey,
    externalId: item.externalId || undefined,
    categoryId: item.categoryId || undefined,
    workspaceId: creds.workspaceId,
    accessKeyId: creds.accessKeyId,
    accessKeySecret: creds.accessKeySecret,
    embeddingBaseUrl: resolvedEmbedding?.baseUrl || item.embeddingBaseUrl || undefined,
    embeddingApiKey: resolvedEmbedding?.apiKey || item.embeddingApiKey || undefined,
    embeddingModel: resolvedEmbedding?.modelId || item.embeddingModel || undefined,
    embeddingMode: item.embeddingMode,
    embeddingModelConfigId: item.embeddingModelConfigId || undefined,
    embeddingMeta: resolvedEmbedding?.meta || item.embeddingMeta,
    indexState: item.indexState,
  };
}

function indexStatusLabel(item: KnowledgeBase) {
  switch (item.indexState?.status) {
    case 'stale': return '待重建';
    case 'rebuilding': return '重建中';
    case 'ready': return '已就绪';
    default: return '未报告';
  }
}

function formatTime(value: number) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function resetDraft() {
  draft.value = {
    name: '',
    provider: 'lancedb',
    enabled: true,
    ontologyEnabled: true,
    wikiRetrievalEnabled: false,
    wikiRelatedExpansionEnabled: false,
    description: '',
    baseUrl: '',
    apiKey: '',
    externalId: '',
    categoryId: '',
    workspaceId: '',
    accessKeyId: '',
    accessKeySecret: '',
    embeddingMode: 'system',
    embeddingModelConfigId: '',
  };
  bailianPipelines.value = [];
  editingId.value = null;
}

function openCreate() {
  resetDraft();
  const preferred = providerFilter.value !== 'all' && isProviderEnabled(providerFilter.value)
    ? providerFilter.value
    : (creatableProviders.value[0] || 'lancedb');
  draft.value.provider = preferred;
  applyProviderDefaults(preferred);
  formOpen.value = true;
}

function applyProviderDefaults(provider: KnowledgeProviderId) {
  if (editingId.value) return;
  const defaults = providerDefaults(provider);
  draft.value.baseUrl = defaults.baseUrl;
  // Leave per-base secrets empty so shared Settings credentials are used.
  draft.value.apiKey = '';
  draft.value.workspaceId = '';
  draft.value.accessKeyId = '';
  draft.value.accessKeySecret = '';
}

function onDraftProviderChange() {
  applyProviderDefaults(draft.value.provider);
}

function openEdit(item: KnowledgeBase) {
  editingId.value = item.id;
  draft.value = {
    name: item.name,
    provider: item.provider,
    enabled: item.enabled,
    ontologyEnabled: item.ontologyEnabled !== false,
    wikiRetrievalEnabled: item.wikiRetrievalEnabled === true,
    wikiRelatedExpansionEnabled: item.wikiRelatedExpansionEnabled === true,
    description: item.description || '',
    baseUrl: item.baseUrl || '',
    apiKey: item.apiKey || '',
    externalId: item.externalId || '',
    categoryId: item.categoryId || '',
    workspaceId: item.workspaceId || '',
    accessKeyId: item.accessKeyId || '',
    accessKeySecret: item.accessKeySecret || '',
    embeddingMode: item.embeddingMode || 'system',
    embeddingModelConfigId: item.embeddingModelConfigId || '',
  };
  bailianPipelines.value = [];
  formOpen.value = true;
}

function closeForm() {
  formOpen.value = false;
  resetDraft();
}

async function save() {
  saving.value = true;
  try {
    const existing = editingId.value
      ? bases.value.find((item) => item.id === editingId.value)
      : undefined;
    const usesEmbedding = draft.value.provider === 'lancedb' || draft.value.provider === 'qdrant' || draft.value.provider === 'pinecone';
    const selectedEmbedding = usesEmbedding
      ? (draft.value.embeddingMode === 'model'
          ? resolveEmbeddingConfigById(draft.value.embeddingModelConfigId, modelSettings.value)
          : systemEmbedding.value)
      : null;
    if (usesEmbedding && !selectedEmbedding) throw new Error(draft.value.embeddingMode === 'model' ? '请选择一个可用的 Embedding 模型。' : '系统默认 Embedding 尚未配置，请先在设置中配置。');
    const saved = await upsert({
      id: editingId.value || undefined,
      name: draft.value.name,
      provider: draft.value.provider,
      enabled: draft.value.enabled,
      ontologyEnabled: draft.value.ontologyEnabled,
      wikiRetrievalEnabled: draft.value.provider === 'lancedb' && draft.value.wikiRetrievalEnabled,
      wikiRelatedExpansionEnabled: draft.value.provider === 'lancedb' && draft.value.wikiRelatedExpansionEnabled,
      description: draft.value.description,
      baseUrl: draft.value.baseUrl,
      apiKey: draft.value.apiKey,
      externalId: draft.value.externalId,
      categoryId: draft.value.categoryId,
      workspaceId: draft.value.workspaceId,
      accessKeyId: draft.value.accessKeyId,
      accessKeySecret: draft.value.accessKeySecret,
      embeddingMode: usesEmbedding ? draft.value.embeddingMode : undefined,
      embeddingModelConfigId: usesEmbedding && draft.value.embeddingMode === 'model' ? draft.value.embeddingModelConfigId : undefined,
      embeddingBaseUrl: selectedEmbedding?.baseUrl || '',
      embeddingApiKey: selectedEmbedding?.apiKey || '',
      embeddingModel: selectedEmbedding?.modelId || '',
      embeddingMeta: selectedEmbedding?.meta,
      documentCount: editingId.value
        ? bases.value.find((item) => item.id === editingId.value)?.documentCount
        : 0,
    });
    selectedId.value = saved.id;
    invalidateSearch();
    notify.success(editingId.value ? 'notify.kbUpdated' : 'notify.kbCreated');
    closeForm();
  } catch (cause) {
    notify.error(cause, 'notify.saveFailed');
  } finally {
    saving.value = false;
  }
}

async function onToggle(item: KnowledgeBase, event: Event) {
  try {
    await setEnabled(item.id, (event.target as HTMLInputElement).checked);
  } catch (cause) {
    notify.error(cause, 'notify.saveFailed');
  }
}

async function onDeleteBase(item: KnowledgeBase) {
  if (!window.confirm(t('knowledge.deleteConfirm', { name: item.name }) + (item.provider === 'lancedb' ? '\n\n' + t('knowledge.sourceRetentionNotice') : ''))) return;
  try {
    await remove(item.id);
    if (selectedId.value === item.id) selectedId.value = null;
    notify.success('notify.kbDeleted');
  } catch (cause) {
    notify.error(cause, 'notify.saveFailed');
  }
}

async function refreshDetail() {
  if (!selected.value) return;
  if (supportsManage.value) {
    await Promise.all([loadDocuments(), detailTab.value === 'chunks' ? loadChunks() : Promise.resolve()]);
  } else {
    documents.value = [];
    chunks.value = [];
    docStats.value = { documentCount: 0, chunkCount: 0, backend: selected.value.provider };
  }
}

async function loadDocuments() {
  if (!selected.value || !supportsManage.value) return;
  loadingDocs.value = true;
  try {
    const result = await listKnowledgeDocuments({ knowledgeBase: toPayload(selected.value) });
    documents.value = result.documents;
    docStats.value = {
      documentCount: result.documentCount,
      chunkCount: result.chunkCount,
      backend: result.backend,
    };
    await setDocumentCount(selected.value.id, result.documentCount || result.chunkCount);
  } catch (cause) {
    notify.error(cause, 'notify.saveFailed');
  } finally {
    loadingDocs.value = false;
  }
}

async function loadChunks() {
  if (!selected.value || !supportsManage.value) return;
  loadingChunks.value = true;
  try {
    const result = await listKnowledgeChunks({
      knowledgeBase: toPayload(selected.value),
      documentId: chunkDocumentId.value || undefined,
      query: chunkQuery.value.trim() || undefined,
      offset: 0,
      limit: 60,
    });
    chunks.value = result.chunks;
    chunkTotal.value = result.total;
  } catch (cause) {
    notify.error(cause, 'notify.saveFailed');
  } finally {
    loadingChunks.value = false;
  }
}

function openIngest() {
  if (!selected.value || !supportsManage.value) return;
  ingestTitle.value = '';
  ingestContent.value = '';
  ingestSource.value = '';
  ingestFileBase64.value = '';
  ingestFileName.value = '';
  ingestFileSize.value = 0;
  ingestMode.value = 'file';
  ingestStage.value = 'idle';
  ingestError.value = '';
  ingestResult.value = '';
  ingestDragActive.value = false;
  ingestOpen.value = true;
}

function closeIngest() {
  if (ingestBusy.value) return;
  ingestOpen.value = false;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function resetIngestFile() {
  ingestFileBase64.value = '';
  ingestFileName.value = '';
  ingestFileSize.value = 0;
  ingestSource.value = '';
  if (ingestMode.value === 'file') ingestContent.value = '';
  ingestStage.value = 'idle';
  ingestError.value = '';
  if (ingestFileInput.value) ingestFileInput.value.value = '';
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

async function prepareIngestFile(file?: File) {
  if (!file) return;
  ingestMode.value = 'file';
  resetIngestFile();
  ingestStage.value = 'reading';
  ingestError.value = '';
  ingestResult.value = '';
  const maxBytes = selected.value?.provider === 'bailian' ? MAX_BAILIAN_KNOWLEDGE_FILE_BYTES : MAX_LOCAL_KNOWLEDGE_FILE_BYTES;
  if (file.size > maxBytes) {
    ingestStage.value = 'error';
    ingestError.value = t('knowledge.fileTooLarge');
    return;
  }
  try {
    ingestTitle.value = file.name.replace(/\.[^.]+$/, '');
    ingestSource.value = file.name;
    ingestFileName.value = file.name;
    ingestFileSize.value = file.size;
    if (!/\.(txt|md|markdown|csv|json)$/i.test(file.name)) {
      if (selected.value?.provider !== 'bailian' && !/\.(pdf|docx)$/i.test(file.name)) {
        throw new Error('本地知识库支持 TXT、Markdown、CSV、JSON、PDF 和 DOCX。');
      }
      ingestFileBase64.value = await fileToBase64(file);
      ingestContent.value = '';
    } else {
      const textContent = await file.text();
      if (textContent.length > MAX_KNOWLEDGE_TEXT_CHARS) throw new Error(t('knowledge.textTooLarge'));
      ingestContent.value = textContent;
      ingestFileBase64.value = selected.value?.provider === 'bailian' ? await fileToBase64(file) : '';
    }
    ingestStage.value = 'ready';
  } catch (cause) {
    ingestStage.value = 'error';
    ingestError.value = cause instanceof Error ? cause.message : String(cause);
  }
}

async function onPickFile(event: Event) {
  const input = event.target as HTMLInputElement;
  await prepareIngestFile(input.files?.[0]);
  input.value = '';
}

async function onDropFile(event: DragEvent) {
  ingestDragActive.value = false;
  await prepareIngestFile(event.dataTransfer?.files?.[0]);
}

function setIngestMode(mode: 'file' | 'text') {
  if (ingestBusy.value || ingestMode.value === mode) return;
  ingestMode.value = mode;
  ingestError.value = '';
  ingestResult.value = '';
  if (mode === 'text') resetIngestFile();
  else {
    ingestContent.value = '';
    ingestStage.value = 'idle';
  }
}

async function runIngest() {
  if (!selected.value) return;
  const isBailian = selected.value.provider === 'bailian';
  if (!isBailian && !resolvedEmbeddingFor(selected.value) && !selected.value.embeddingModel?.trim()) {
    ingestStage.value = 'error';
    ingestError.value = t('knowledge.embeddingRequired');
    return;
  }
  if (isBailian && !selected.value.categoryId?.trim()) {
    ingestStage.value = 'error';
    ingestError.value = t('knowledge.bailianNeedCategory');
    return;
  }
  if (!ingestContent.value.trim() && !ingestFileBase64.value.trim()) {
    ingestStage.value = 'error';
    ingestError.value = t('knowledge.contentRequired');
    return;
  }
  if (ingestContent.value.length > MAX_KNOWLEDGE_TEXT_CHARS) {
    ingestStage.value = 'error';
    ingestError.value = t('knowledge.textTooLarge');
    return;
  }
  ingestBusy.value = true;
  ingestStage.value = 'processing';
  ingestError.value = '';
  ingestResult.value = '';
  try {
    const result = await ingestKnowledgeDocument({
      knowledgeBase: toPayload(selected.value),
      title: ingestTitle.value.trim() || 'document',
      content: ingestContent.value.trim() ? ingestContent.value : undefined,
      fileBase64: ingestFileBase64.value.trim() || undefined,
      fileName: ingestFileName.value.trim() || undefined,
      source: ingestSource.value.trim() || undefined,
      model: configured.value ? toModelPayload(activeConfig.value) : undefined,
    });
    if (result.jobId) {
      lastJobId.value = result.jobId;
      lastJobStatus.value = result.status || 'PENDING';
      await pollBailianJob(result.jobId);
    }
    if (result.indexState) {
      await setIndexState(selected.value.id, result.indexState);
    }
    await setDocumentCount(selected.value.id, (selected.value.documentCount || 0) + Math.max(1, result.chunks || 0));
    notify.success(result.jobId ? 'notify.kbIngestQueued' : 'notify.kbIngested');
    ingestStage.value = 'success';
    ingestResult.value = result.jobId
      ? `文件已上传，云端任务 ${result.jobId} 正在处理。`
      : t('knowledge.ingestSearchReady', { count: result.chunks || 0 });
    if (result.sourceSnapshot) ingestResult.value += ` ${t('knowledge.sourceArchived')}`;
    detailTab.value = 'documents';
    await refreshDetail();
  } catch (cause) {
    ingestStage.value = 'error';
    ingestError.value = cause instanceof Error ? cause.message : String(cause);
    notify.error(cause, 'notify.saveFailed');
  } finally {
    ingestBusy.value = false;
  }
}

async function pollBailianJob(jobId: string) {
  if (!selected.value || selected.value.provider !== 'bailian') return;
  const terminal = new Set(['COMPLETED', 'FAILED', 'FINISH', 'SUCCESS']);
  for (let i = 0; i < 12; i += 1) {
    try {
      const status = await getKnowledgeJobStatus({
        knowledgeBase: toPayload(selected.value),
        jobId,
      });
      lastJobStatus.value = status.status || lastJobStatus.value;
      if (terminal.has(String(status.status || '').toUpperCase())) break;
      // Job may disappear quickly after success.
      if (/not exist|IndexJobNotExist/i.test(String(status.message || ''))) {
        lastJobStatus.value = 'COMPLETED';
        break;
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (/not exist|IndexJobNotExist/i.test(message)) {
        lastJobStatus.value = 'COMPLETED';
        break;
      }
      lastJobStatus.value = message.slice(0, 80);
      break;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2500));
  }
}

async function removeDocument(doc: KnowledgeDocumentRow) {
  if (!selected.value) return;
  if (!window.confirm(t('knowledge.deleteDocConfirm', { name: doc.title }) + (selected.value?.provider === 'lancedb' ? '\n\n' + t('knowledge.sourceRetentionNotice') : ''))) return;
  try {
    const result = await deleteKnowledgeDocument({
      knowledgeBase: toPayload(selected.value),
      documentId: doc.id,
    });
    await setDocumentCount(selected.value.id, result.remainingChunks);
    notify.success('notify.kbDocDeleted');
    await refreshDetail();
  } catch (cause) {
    notify.error(cause, 'notify.saveFailed');
  }
}

async function removeChunk(chunk: KnowledgeChunkRow) {
  if (!selected.value) return;
  if (!window.confirm(t('knowledge.deleteChunkConfirm'))) return;
  try {
    const result = await deleteKnowledgeChunk({
      knowledgeBase: toPayload(selected.value),
      chunkId: chunk.id,
    });
    await setDocumentCount(selected.value.id, result.remainingChunks);
    if (selectedChunk.value?.id === chunk.id) selectedChunk.value = null;
    notify.success('notify.kbChunkDeleted');
    await loadChunks();
    await loadDocuments();
  } catch (cause) {
    notify.error(cause, 'notify.saveFailed');
  }
}

function filterChunksByDoc(docId: string) {
  chunkDocumentId.value = docId;
  detailTab.value = 'chunks';
  void loadChunks();
}
async function openOntologyEvidence(evidence: { documentId?: string; chunkId?: string }) {
  chunkDocumentId.value = evidence.documentId || '';
  chunkQuery.value = '';
  detailTab.value = 'chunks';
  await loadChunks();
  selectedChunk.value = evidence.chunkId ? chunks.value.find((item) => item.id === evidence.chunkId) || null : chunks.value[0] || null;
  if (evidence.chunkId && !selectedChunk.value) notify.pushRaw('warning', '未找到原文切片', '文档可能已经重新索引或删除。');
}

async function fetchBailianPipelines() {
  const defaults = providerDefaults('bailian');
  const workspaceId = draft.value.workspaceId.trim() || defaults.workspaceId;
  const accessKeyId = draft.value.accessKeyId.trim() || defaults.accessKeyId;
  const accessKeySecret = draft.value.accessKeySecret.trim() || defaults.accessKeySecret;
  loadingPipelines.value = true;
  try {
    if (accessKeyId && accessKeySecret && workspaceId) {
      const result = await listBailianIndices({
        accessKeyId,
        accessKeySecret,
        workspaceId,
      });
      bailianPipelines.value = result.indices.map((item) => ({
        id: item.id,
        name: item.name,
        workspaceId,
        docNum: item.documentCount,
        categoryId: item.categoryId || undefined,
      }));
    } else {
      const apiKey = draft.value.apiKey.trim() || defaults.apiKey;
      if (!apiKey) {
        notify.error(new Error(t('knowledge.bailianNeedApiKey')), 'notify.saveFailed');
        return;
      }
      const result = await listBailianPipelines({
        apiKey,
        baseUrl: draft.value.baseUrl || defaults.baseUrl || undefined,
        workspaceId: workspaceId || undefined,
      });
      bailianPipelines.value = result.pipelines;
    }
    if (!bailianPipelines.value.length) notify.error(new Error(t('knowledge.bailianEmptyList')), 'notify.saveFailed');
  } catch (cause) {
    notify.error(cause, 'notify.saveFailed');
  } finally {
    loadingPipelines.value = false;
  }
}

function applyBailianPipeline(item: { id: string; name: string; workspaceId: string; categoryId?: string }) {
  draft.value.externalId = item.id;
  if (item.categoryId) draft.value.categoryId = item.categoryId;
  if (!draft.value.name.trim()) draft.value.name = item.name;
}

async function createBailianRemote() {
  if (!draft.value.name.trim()) {
    notify.error(new Error(t('knowledge.bailianNeedName')), 'notify.saveFailed');
    return;
  }
  const defaults = providerDefaults('bailian');
  const workspaceId = draft.value.workspaceId.trim() || defaults.workspaceId;
  const accessKeyId = draft.value.accessKeyId.trim() || defaults.accessKeyId;
  const accessKeySecret = draft.value.accessKeySecret.trim() || defaults.accessKeySecret;
  if (!workspaceId) {
    notify.error(new Error(t('knowledge.bailianNeedWorkspace')), 'notify.saveFailed');
    return;
  }
  if (!accessKeyId || !accessKeySecret) {
    notify.error(new Error(t('knowledge.bailianNeedAccessKey')), 'notify.saveFailed');
    return;
  }
  creatingBailian.value = true;
  try {
    const created = await createBailianKnowledge({
      accessKeyId,
      accessKeySecret,
      workspaceId,
      name: draft.value.name.trim().slice(0, 20),
      description: draft.value.description.trim() || undefined,
    });
    draft.value.externalId = created.indexId;
    draft.value.categoryId = created.categoryId;
    notify.success('notify.kbCreated');
  } catch (cause) {
    notify.error(cause, 'notify.saveFailed');
  } finally {
    creatingBailian.value = false;
  }
}

async function runSearch() {
  if (!selected.value || searching.value) return;
  if (searchQuery.value.trim().length < 2) {
    searchValidation.value = '请输入至少 2 个字符的问题或关键词。';
    return;
  }
  searchValidation.value = '';
  searchError.value = '';
  const base = selected.value;
  const query = searchQuery.value.trim();
  const requestId = ++searchRequestId;
  const isCurrent = () => requestId === searchRequestId && selectedId.value === base.id;
  searching.value = true;
  searchStrategy.value = null;
  searchHits.value = [];
  try {
    const input = {
      knowledgeBase: toPayload(base),
      query,
      topK: 6,
      model: configured.value ? toModelPayload(activeConfig.value) : undefined,
    };
    const result = base.ontologyEnabled !== false
      ? await searchKnowledgeWithOntology(input)
      : await searchKnowledge(input);
    if (!isCurrent()) return;
    searchHits.value = result.results;
    searchStrategy.value = 'strategy' in result && result.strategy === 'ontology-enhanced'
      ? 'ontology-enhanced'
      : base.provider === 'lancedb' ? 'hybrid' : 'vector-only';
  } catch (cause) {
    if (isCurrent()) {
      searchError.value = '检索暂未完成，请检查知识库设置或稍后重试。';
      notify.error(cause, 'knowledge.searchFailed');
    }
  } finally {
    if (isCurrent()) searching.value = false;
  }
}

function detailTabLabel(tab: DetailTab) {
  if (tab === 'wiki') return 'Wiki';
  if (tab === 'settings') return '技术信息';
  return t(`knowledge.tab.${tab}`);
}

function detailTabDescription(tab: DetailTab) {
  if (tab === 'wiki') return '整理主题、核对来源与阅读互链';
  if (tab === 'documents') return '管理原始资料与可检索内容';
  if (tab === 'ontology') return '建模实体、关系与业务逻辑';
  if (tab === 'search') return '验证真实问题的召回质量';
  return '';
}

function detailTabMark(tab: DetailTab) {
  if (tab === 'wiki') return 'W';
  if (tab === 'documents') return '文';
  if (tab === 'ontology') return '本';
  if (tab === 'search') return '验';
  return '';
}

function retrievalRouteLabel(route: 'raw-vector' | 'ontology-vector' | 'ontology-evidence') {
  if (route === 'ontology-evidence') return '本体证据';
  if (route === 'ontology-vector') return '本体扩展查询';
  return '原始查询';
}

function summaryLine(item: KnowledgeBase) {
  if (item.provider === 'lancedb') return t('knowledge.localSummary', { count: item.documentCount || 0 });
  return [item.baseUrl, item.externalId].filter(Boolean).join(' · ') || item.provider;
}

function embeddingSourceSummary(item: KnowledgeBase) {
  const resolved = item.embeddingMode === 'model' && item.embeddingModelConfigId
    ? resolveEmbeddingConfigById(item.embeddingModelConfigId, modelSettings.value)
    : item.embeddingMode === 'system'
      ? systemEmbedding.value
      : null;
  if (resolved) return `${resolved.providerLabel} · ${resolved.modelId}${item.embeddingMode === 'system' ? '（系统默认）' : '（知识库指定）'}`;
  if (item.embeddingModel?.trim()) {
    if (item.embeddingBaseUrl?.trim()) return `${item.embeddingModel} · ${item.embeddingBaseUrl}`;
    return item.embeddingModel;
  }
  if (systemEmbedding.value?.modelId) {
    return `${systemEmbedding.value.modelId}（系统默认）`;
  }
  return '未配置';
}

function resolvedEmbeddingFor(item: KnowledgeBase) {
  if (item.embeddingMode === 'model' && item.embeddingModelConfigId) return resolveEmbeddingConfigById(item.embeddingModelConfigId, modelSettings.value);
  if (item.embeddingMode === 'system') return systemEmbedding.value;
  return null;
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col overflow-hidden">
    <header class="shrink-0 border-b border-[var(--border)] px-6 py-5 lg:px-8">
      <p class="text-[11px] font-extrabold tracking-[.13em] text-[var(--accent)]">WorkExpert / KNOWLEDGE</p>
      <div class="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-3xl font-bold tracking-[-.04em] lg:text-4xl">{{ t('knowledge.title') }}</h1>
          <p class="mt-1 max-w-2xl text-sm text-[var(--muted)]">{{ t('knowledge.subtitle') }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-if="selected"
            type="button"
            class="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold"
            @click="selectedId = null"
          >
            {{ t('knowledge.backToList') }}
          </button>
          <button v-if="!selected" type="button" class="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white" @click="openCreate">
            {{ t('knowledge.add') }}
          </button>
        </div>
      </div>

      <div v-if="!selected" class="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          :class="['rounded-full px-3 py-1.5 text-xs font-semibold transition', providerFilter === 'all' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface-muted)] text-[var(--muted)] hover:text-[var(--text)]']"
          @click="providerFilter = 'all'"
        >
          {{ t('knowledge.filterAll') }}
        </button>
        <button
          v-for="id in visibleProviderFilters"
          :key="id"
          type="button"
          :class="['rounded-full px-3 py-1.5 text-xs font-semibold transition', providerFilter === id ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface-muted)] text-[var(--muted)] hover:text-[var(--text)]']"
          @click="providerFilter = id"
        >
          {{ meta(id).label }}
        </button>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-auto px-6 py-5 lg:px-8">
      <div v-if="!selected" class="mx-auto max-w-[1200px]">
        <p v-if="!filteredBases.length" class="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center text-sm text-[var(--muted)]">
          {{ t('knowledge.empty') }}
        </p>
        <div v-else class="grid gap-4 md:grid-cols-2">
          <article
            v-for="item in filteredBases"
            :key="item.id"
            class="group flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-[var(--accent)]/35"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="truncate text-base font-bold">{{ item.name }}</h2>
                  <span :class="['rounded-full px-2 py-0.5 text-[10px] font-bold', isReady(item) ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'bg-[var(--surface-muted)] text-[var(--muted)]']">
                    {{ isReady(item) ? '配置就绪' : '待配置' }}
                  </span>
                </div>
                <p class="mt-1 text-xs text-[var(--muted)]">{{ meta(item.provider).label }}</p>
              </div>
              <label class="shrink-0 text-[11px] text-[var(--muted)]">
                <input type="checkbox" class="align-middle" :checked="item.enabled" @change="onToggle(item, $event)" />
                {{ t('knowledge.enabled') }}
              </label>
            </div>
            <p class="mt-3 line-clamp-2 text-sm text-[var(--muted)]">{{ item.description || summaryLine(item) }}</p>
            <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-[var(--border)] py-4 text-xs sm:grid-cols-4">
              <div><dt class="text-[var(--muted)]">知识内容</dt><dd class="mt-1 font-semibold">{{ item.documentCount || 0 }} 篇文档</dd></div>
              <div><dt class="text-[var(--muted)]">本体增强</dt><dd class="mt-1 font-semibold">{{ item.ontologyEnabled === false ? '已关闭' : '已开启' }}</dd></div>
              <div v-if="item.provider === 'lancedb'"><dt class="text-[var(--muted)]">Wiki 融合</dt><dd class="mt-1 font-semibold">{{ item.wikiRetrievalEnabled ? '已开启' : '已关闭' }}</dd></div>
              <div v-else><dt class="text-[var(--muted)]">检索来源</dt><dd class="mt-1 font-semibold">外部知识库</dd></div>
              <div><dt class="text-[var(--muted)]">索引状态</dt><dd class="mt-1 font-semibold">{{ indexStatusLabel(item) }}</dd></div>
            </dl>
            <p v-if="item.provider === 'lancedb' || item.provider === 'qdrant' || item.provider === 'pinecone'" class="mt-3 truncate text-[11px] text-[var(--muted)]">向量模型：{{ embeddingSourceSummary(item) }}</p>
            <div class="mt-5 flex flex-wrap gap-2">
              <button type="button" class="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white" @click="selectedId = item.id">管理知识</button>
              <button v-if="item.provider === 'lancedb'" type="button" class="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold" @click="openWiki(item.id)">打开 Wiki</button>
              <button type="button" class="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold" @click="openEdit(item)">知识库设置</button>
              <button type="button" class="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--muted)]" @click="onDeleteBase(item)">{{ t('knowledge.delete') }}</button>
            </div>
          </article>
        </div>
      </div>

      <div v-else-if="selected" class="mx-auto grid max-w-[1200px] gap-5">
        <article class="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <div class="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h2 class="truncate text-lg font-bold tracking-[-.02em]">{{ selected.name }}</h2>
                <span class="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-bold uppercase tracking-[.1em] text-[var(--muted)]">{{ meta(selected.provider).label }}</span>
                <span class="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-semibold">{{ selected.indexState?.status ? `索引${indexStatusLabel(selected)}` : isReady(selected) ? '配置就绪 · 索引状态未报告' : '待配置' }}</span>
              </div>
              <div class="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
                <span v-if="supportsManage">{{ docStats.documentCount }} 篇文档 · {{ docStats.chunkCount }} 个分片</span>
                <span v-if="selected.provider === 'lancedb' || selected.provider === 'qdrant' || selected.provider === 'pinecone'" class="max-w-[440px] truncate">向量模型：{{ embeddingSourceSummary(selected) }}</span>
                <span v-if="lastJobId">{{ t('knowledge.jobStatus', { id: lastJobId, status: lastJobStatus || '未提供' }) }}</span>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <button v-if="supportsManage" type="button" class="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white" @click="openIngest">{{ t('knowledge.upload') }}</button>
              <button type="button" class="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold" @click="openEdit(selected)">知识库设置</button>
            </div>
          </div>
          <nav class="border-t border-[var(--border)] bg-[var(--surface-muted)]/35 p-2.5" aria-label="知识库工作区">
            <div v-if="primaryDetailTabs.length" class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            <button
              v-for="tab in primaryDetailTabs"
              :key="tab"
              type="button"
              :aria-current="detailTab === tab ? 'page' : undefined"
              :class="['group flex min-h-16 items-center gap-3 rounded-xl border px-4 py-3 text-left transition', detailTab === tab ? 'border-[var(--accent)] bg-[var(--surface)] shadow-sm ring-1 ring-[var(--accent)]/15' : 'border-transparent text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--surface)]']"
              @click="detailTab = tab"
            >
              <span :class="['grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-bold', detailTab === tab ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface-muted)] text-[var(--muted)] group-hover:text-[var(--text)]']">{{ detailTabMark(tab) }}</span>
              <span class="min-w-0"><strong :class="['block text-sm', detailTab === tab ? 'text-[var(--text)]' : '']">{{ detailTabLabel(tab) }}</strong><span class="mt-0.5 block truncate text-[11px] font-normal text-[var(--muted)]">{{ detailTabDescription(tab) }}</span></span>
            </button>
            </div>
            <div v-if="advancedDetailTabs.length" class="mt-2 flex flex-wrap items-center justify-end gap-1.5 px-1">
              <span class="mr-1 text-[10px] font-semibold text-[var(--muted)]">高级工具</span>
              <button v-for="tab in advancedDetailTabs" :key="tab" type="button" :class="['rounded-md px-2.5 py-1.5 text-[11px] font-medium', detailTab === tab ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--muted)] hover:bg-[var(--surface-muted)]']" @click="detailTab = tab">{{ detailTabLabel(tab) }}</button>
            </div>
          </nav>
          <form
            v-if="detailTabs.includes('search')"
            class="flex flex-wrap items-center gap-3 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3"
            @submit.prevent="detailTab = 'search'; runSearch()"
          >
            <div class="min-w-[150px]">
              <strong class="block text-xs">召回验证</strong>
              <span class="mt-0.5 block text-[10px] text-[var(--muted)]">用真实问题检查知识是否可被找到</span>
            </div>
            <label for="knowledge-quick-recall" class="sr-only">输入召回测试问题</label>
            <input
              id="knowledge-quick-recall"
              v-model="searchQuery"
              class="min-w-[240px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              placeholder="例如：退款未到账应该由谁处理？"
            />
            <button type="submit" class="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white active:scale-[0.98]" :disabled="searching">
              {{ searching ? '正在验证' : '开始验证' }}
            </button>
            <button type="button" class="rounded-lg px-2 py-2 text-xs text-[var(--muted)] underline" @click="detailTab = 'search'">查看测试与报告</button>
          </form>
        </article>

        <article v-if="detailTab === 'documents' && supportsManage" class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div class="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 class="text-base font-bold">{{ t('knowledge.docsTitle') }}</h3>
              <p class="mt-1 text-xs text-[var(--muted)]">{{ t('knowledge.docsHelp') }}</p>
            </div>
            <button type="button" class="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold" :disabled="loadingDocs" @click="loadDocuments">{{ loadingDocs ? t('knowledge.loading') : t('knowledge.refresh') }}</button>
          </div>
          <p v-if="!documents.length && !loadingDocs" class="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--muted)]">{{ t('knowledge.docsEmpty') }}</p>
          <ul v-else class="divide-y divide-[var(--border)]">
            <li v-for="doc in documents" :key="doc.id" class="flex flex-wrap items-start justify-between gap-3 py-4">
              <div class="min-w-0 flex-1">
                <p class="font-semibold">{{ doc.title }}</p>
                <p class="mt-1 text-xs text-[var(--muted)]">{{ t('knowledge.docMeta', { chunks: doc.chunkCount, time: formatTime(doc.createdAt) }) }}<span v-if="doc.source"> · {{ doc.source }}</span></p>
                <p class="mt-2 line-clamp-2 text-sm text-[var(--muted)]">{{ doc.preview }}</p>
              </div>
              <div class="flex gap-2">
                <button type="button" class="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold" @click="filterChunksByDoc(doc.id)">{{ t('knowledge.viewChunks') }}</button>
                <button type="button" class="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--muted)]" @click="removeDocument(doc)">{{ t('knowledge.removeDoc') }}</button>
              </div>
            </li>
          </ul>
        </article>

        <article v-if="detailTab === 'chunks' && supportsManage" class="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div class="mb-4 flex flex-wrap items-end gap-3">
              <label class="grid min-w-[180px] flex-1 gap-1 text-xs font-semibold text-[var(--muted)]">
                {{ t('knowledge.chunkQuery') }}
                <input v-model="chunkQuery" class="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm font-normal text-[var(--text)]" :placeholder="t('knowledge.chunkQueryHint')" @keydown.enter.prevent="loadChunks" />
              </label>
              <label class="grid gap-1 text-xs font-semibold text-[var(--muted)]">
                {{ t('knowledge.chunkDocFilter') }}
                <select v-model="chunkDocumentId" class="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm font-normal">
                  <option value="">{{ t('knowledge.allDocs') }}</option>
                  <option v-for="doc in documents" :key="doc.id" :value="doc.id">{{ doc.title }}</option>
                </select>
              </label>
              <button type="button" class="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white" :disabled="loadingChunks" @click="loadChunks">{{ t('knowledge.searchChunks') }}</button>
            </div>
            <p class="mb-3 text-xs text-[var(--muted)]">{{ t('knowledge.chunkTotal', { n: chunkTotal }) }}</p>
            <ul class="max-h-[520px] space-y-2 overflow-auto">
              <li
                v-for="chunk in chunks"
                :key="chunk.id"
                :class="['cursor-pointer rounded-xl border px-3 py-3 transition', selectedChunk?.id === chunk.id ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] hover:border-[var(--accent)]/40']"
                @click="selectedChunk = chunk"
              >
                <p class="text-sm font-semibold">{{ chunk.title }}</p>
                <p class="mt-1 line-clamp-2 text-xs text-[var(--muted)]">{{ chunk.content }}</p>
              </li>
            </ul>
          </div>
          <div class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <template v-if="selectedChunk">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="text-base font-bold">{{ selectedChunk.title }}</h3>
                  <p class="mt-1 text-xs text-[var(--muted)]">{{ selectedChunk.documentTitle }} · {{ formatTime(selectedChunk.createdAt) }}</p>
                </div>
                <button type="button" class="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--muted)]" @click="removeChunk(selectedChunk)">{{ t('knowledge.removeChunk') }}</button>
              </div>
              <pre class="mt-4 max-h-[560px] overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--surface-muted)] p-4 text-sm leading-relaxed">{{ selectedChunk.content }}</pre>
              <p v-if="selectedChunk.evidence?.verification === 'versioned' && selectedChunk.evidence.sourceLocation" class="mt-2 text-xs text-[var(--muted)]">{{ t('knowledge.parsedLocation', { start: selectedChunk.evidence.sourceLocation.start, end: selectedChunk.evidence.sourceLocation.end }) }}</p>
            </template>
            <p v-else class="py-16 text-center text-sm text-[var(--muted)]">{{ t('knowledge.pickChunk') }}</p>
          </div>
        </article>

        <article v-if="detailTab === 'search'" class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <details class="mb-4 text-xs" @toggle="evaluationOpen ||= ($event.target as HTMLDetailsElement).open">
            <summary class="cursor-pointer py-2 font-semibold">离线评测报告</summary>
            <RetrievalEvaluationPanel v-if="evaluationOpen" :key="selected.id" :knowledge-base-id="selected.id" :query="searchQuery" :hits="searchHits" :ready="!!searchStrategy && !searching && !searchError" />
          </details>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div><h3 class="text-base font-bold">{{ t('knowledge.searchTitle') }}</h3><p class="mt-1 text-xs text-[var(--muted)]">{{ t('knowledge.searchHelp') }}</p></div>
            <details class="max-w-full text-xs text-[var(--muted)]">
              <summary class="cursor-pointer rounded px-2 py-1 font-semibold focus-visible:outline-2 focus-visible:outline-[var(--accent)]">检索设置</summary>
              <div class="mt-2 space-y-1 rounded-lg bg-[var(--surface-muted)] p-3">
                <p>{{ isLocal ? '关键词 + 语义' : '外部知识库检索' }}</p>
                <p>本体增强：{{ selected.ontologyEnabled === false ? '已关闭' : '已开启' }}</p>
                <p v-if="isLocal">Wiki 融合：{{ selected.wikiRetrievalEnabled ? '已开启' : '已关闭' }}</p>
                <p>开启不代表本次命中，需有可用的已发布内容。</p>
              </div>
            </details>
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            <label for="knowledge-search-query" class="sr-only">检索问题或关键词</label>
            <input id="knowledge-search-query" v-model="searchQuery" name="knowledge-query" aria-describedby="knowledge-search-feedback" :aria-invalid="Boolean(searchValidation)" class="min-w-0 w-full flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-[var(--accent)]" :placeholder="t('knowledge.searchPlaceholder')" @keydown.enter.prevent="runSearch" />
            <button type="button" class="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-xs font-semibold text-white" :disabled="searching" @click="runSearch">{{ searching ? t('knowledge.searching') : t('knowledge.runSearch') }}</button>
          </div>
          <div id="knowledge-search-feedback" role="status" aria-live="polite" aria-atomic="true" class="mt-4 text-sm">
            <p v-if="searchValidation" class="text-amber-700">{{ searchValidation }}</p>
            <p v-else-if="searching" class="text-[var(--muted)]">正在检索，请稍候…</p>
            <p v-else-if="searchError" class="text-rose-600">{{ searchError }}</p>
            <div v-else-if="searchStrategy" class="rounded-xl bg-[var(--surface-muted)]/45 px-4 py-3">
              <strong>{{ searchSummary.title }}</strong>
              <p class="mt-1 text-xs text-[var(--muted)]">{{ searchSummary.description }}</p>
            </div>
            <p v-else class="text-[var(--muted)]">输入实际问题或关键词，检查能否找到需要的内容。</p>
          </div>
          <ul class="mt-5 space-y-3">
            <li v-for="hit in searchHits" :key="`${hit.wiki ? 'wiki' : 'chunk'}:${hit.id}`" class="rounded-xl border border-[var(--border)] px-4 py-3">
              <div class="flex items-center justify-between gap-3">
                <p class="min-w-0 break-words font-semibold">{{ hit.title }}</p>
                <span class="shrink-0 rounded bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--muted)]">{{ hit.wiki ? 'Wiki 整理' : '原文片段' }}</span>
              </div>
              <p class="mt-2 break-words text-sm leading-relaxed text-[var(--muted)]">{{ hit.content }}</p>
              <div v-if="hit.wiki" class="mt-2 text-xs"><button type="button" class="rounded text-[var(--accent)] underline focus-visible:outline-2 focus-visible:outline-[var(--accent)]" @click="openWikiResult(hit.wiki.pageId)">查看 Wiki 与来源</button></div>
              <details class="mt-3 text-xs text-[var(--muted)]">
                <summary class="cursor-pointer rounded font-semibold focus-visible:outline-2 focus-visible:outline-[var(--accent)]">检索详情</summary>
                <div class="mt-2 space-y-1 rounded-lg bg-[var(--surface-muted)] p-3">
                  <p>排序分 {{ hit.score.toFixed(3) }} · 仅用于排序，不代表准确率</p>
                  <p v-if="hit.wiki?.expansion">召回方式：Wiki 一跳关联扩展（经问题关键词相关性筛选）</p>
                  <p v-if="hit.wiki">来源：已发布 Wiki 页面</p>
                  <p v-else-if="hit.retrieval?.channels.length">命中方式：{{ hit.retrieval.channels.map(channel => channel === 'keyword' ? '关键词' : '语义').join('、') }}</p>
                  <p v-if="hit.retrievalRoutes?.length">增强路径：{{ hit.retrievalRoutes.map(retrievalRouteLabel).join('、') }}</p>
                </div>
              </details>
              <details v-if="hit.context" class="mt-3 text-sm text-[var(--muted)]">
                <summary class="cursor-pointer text-xs font-semibold">{{ t('knowledge.viewContext') }}</summary>
                <pre class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--surface-muted)] p-3 text-sm leading-relaxed">{{ hit.context.content }}</pre>
              </details>
            </li>
          </ul>
        </article>

        <OntologyWorkbench v-if="detailTab === 'ontology' && selected" :key="selected.id" :knowledge-base="toPayload(selected)" :model="configured ? toModelPayload(activeConfig) : undefined" :is-admin="isAdmin" @open-evidence="openOntologyEvidence" />
        <WikiWorkbench v-if="detailTab === 'wiki' && selected" :key="selected.id" :knowledge-base="toPayload(selected)" :initial-page-id="wikiPageId" :model="configured ? toModelPayload(activeConfig) : undefined" />

        <article v-if="detailTab === 'settings'" class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h3 class="text-base font-bold">技术信息</h3>
          <p class="mt-1 text-xs text-[var(--muted)]">用于排查连接与索引问题；修改模型或检索增强，请使用上方“知识库设置”。</p>
          <dl class="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div class="rounded-xl bg-[var(--surface-muted)] px-4 py-3">
              <dt class="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">Provider</dt>
              <dd class="mt-1 font-semibold">{{ meta(selected.provider).label }}</dd>
            </div>
            <div class="rounded-xl bg-[var(--surface-muted)] px-4 py-3">
              <dt class="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">ID</dt>
              <dd class="mt-1 break-all font-mono text-xs">{{ selected.id }}</dd>
            </div>
            <div v-if="selected.baseUrl" class="rounded-xl bg-[var(--surface-muted)] px-4 py-3 sm:col-span-2">
              <dt class="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">URL</dt>
              <dd class="mt-1 break-all">{{ selected.baseUrl }}</dd>
            </div>
            <div v-if="selected.externalId" class="rounded-xl bg-[var(--surface-muted)] px-4 py-3 sm:col-span-2">
              <dt class="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">External ID</dt>
              <dd class="mt-1 break-all font-mono text-xs">{{ selected.externalId }}</dd>
            </div>
            <div v-if="selected.categoryId" class="rounded-xl bg-[var(--surface-muted)] px-4 py-3 sm:col-span-2">
              <dt class="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">Category ID</dt>
              <dd class="mt-1 break-all font-mono text-xs">{{ selected.categoryId }}</dd>
            </div>
            <div v-if="selected.indexState?.status" class="rounded-xl bg-[var(--surface-muted)] px-4 py-3 sm:col-span-2">
              <dt class="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">Index State</dt>
              <dd class="mt-1">{{ indexStatusLabel(selected) }}</dd>
              <dd v-if="selected.indexState.signature" class="mt-1 break-all font-mono text-xs text-[var(--muted)]">{{ selected.indexState.signature }}</dd>
              <dd v-if="selected.indexState.lastBuildModel" class="mt-1 text-xs text-[var(--muted)]">last model: {{ selected.indexState.lastBuildModel }}</dd>
              <dd v-if="selected.indexState.lastBuildError" class="mt-1 text-xs text-rose-600">{{ selected.indexState.lastBuildError }}</dd>
            </div>
            <div v-if="selected.provider === 'lancedb' || selected.provider === 'qdrant' || selected.provider === 'pinecone'" class="rounded-xl bg-[var(--surface-muted)] px-4 py-3 sm:col-span-2">
              <dt class="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">Embedding</dt>
              <dd class="mt-1">{{ embeddingSourceSummary(selected) }}</dd>
              <dd v-if="resolvedEmbeddingFor(selected)?.meta?.dimension || selected.embeddingMeta?.dimension" class="mt-1 text-xs text-[var(--muted)]">dimension: {{ resolvedEmbeddingFor(selected)?.meta?.dimension || selected.embeddingMeta?.dimension }}</dd>
              <dd class="mt-1 text-xs text-[var(--muted)]">模式：{{ selected.embeddingMode === 'model' ? '知识库指定模型' : selected.embeddingMode === 'system' ? '继承系统默认模型' : '旧版固定配置' }}</dd>
            </div>
          </dl>
          <p v-if="!supportsManage" class="mt-4 rounded-xl border border-dashed border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">{{ t('knowledge.cloudManageHint') }}</p>
          <p v-else-if="selected.provider === 'bailian' && !selected.categoryId" class="mt-4 rounded-xl border border-dashed border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">{{ t('knowledge.bailianNeedCategory') }}</p>
          <p v-if="isLocal && !configured" class="mt-4 text-sm text-[var(--muted)]">
            {{ t('knowledge.embeddingRequired') }}
            <button type="button" class="ml-2 font-semibold text-[var(--accent)]" @click="emit('openSettings')">{{ t('common.openSettings') }}</button>
          </p>
        </article>
      </div>
    </div>

    <div v-if="formOpen" class="fixed inset-0 z-40 grid place-items-center bg-slate-950/40 p-4" role="presentation">
      <form class="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="knowledge-form-title" @submit.prevent="save">
        <h3 id="knowledge-form-title" class="text-lg font-bold">{{ editingId ? '知识库设置' : t('knowledge.add') }}</h3>
        <p class="mt-1 text-xs text-[var(--muted)]">{{ t('knowledge.formHelp') }}</p>
        <div class="mt-4 grid gap-3">
          <label class="grid gap-1 text-xs font-semibold text-[var(--muted)]">{{ t('knowledge.name') }}<input v-model="draft.name" required class="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm font-normal text-[var(--text)]" /></label>
          <label class="grid gap-1 text-xs font-semibold text-[var(--muted)]">{{ t('knowledge.provider') }}
            <select v-model="draft.provider" class="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm font-normal" :disabled="Boolean(editingId)" @change="onDraftProviderChange">
              <option v-for="id in creatableProviders" :key="id" :value="id">{{ meta(id).label }}</option>
            </select>
          </label>
          <label class="grid gap-1 text-xs font-semibold text-[var(--muted)]">{{ t('knowledge.description') }}<textarea v-model="draft.description" rows="2" class="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm font-normal text-[var(--text)]" /></label>
          <template v-if="draft.provider !== 'lancedb'">
            <label v-if="meta(draft.provider).needsBaseUrl" class="grid gap-1 text-xs font-semibold text-[var(--muted)]">{{ t('knowledge.baseUrl') }}<input v-model="draft.baseUrl" class="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm font-normal" /></label>
            <label v-if="draft.provider !== 'bailian'" class="grid gap-1 text-xs font-semibold text-[var(--muted)]">{{ t('knowledge.apiKey') }}<input v-model="draft.apiKey" type="password" class="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm font-normal" /></label>
            <template v-if="draft.provider === 'bailian'">
              <p class="text-[11px] font-normal leading-relaxed text-[var(--muted)]">{{ t('knowledge.bailianHelp') }}</p>
              <p class="rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-[11px] font-normal text-[var(--muted)]">
                {{ t('knowledge.bailianSharedFromSettings') }}
                <button type="button" class="ml-1 font-semibold text-[var(--accent)]" @click="emit('openSettings')">{{ t('common.openSettings') }}</button>
              </p>
              <div class="flex flex-wrap items-center gap-2">
                <button type="button" class="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white" :disabled="creatingBailian || Boolean(editingId)" @click="createBailianRemote">
                  {{ creatingBailian ? t('knowledge.bailianCreating') : t('knowledge.bailianCreate') }}
                </button>
                <span class="text-[11px] font-normal text-[var(--muted)]">{{ t('knowledge.bailianCreateHelp') }}</span>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <button type="button" class="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold" :disabled="loadingPipelines" @click="fetchBailianPipelines">{{ loadingPipelines ? t('knowledge.loading') : t('knowledge.bailianFetch') }}</button>
                <span class="text-[11px] font-normal text-[var(--muted)]">{{ t('knowledge.bailianFetchHelp') }}</span>
              </div>
              <div v-if="bailianPipelines.length" class="flex flex-wrap gap-2">
                <button
                  v-for="item in bailianPipelines"
                  :key="item.id"
                  type="button"
                  class="rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-semibold"
                  :class="draft.externalId === item.id ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]' : 'border-[var(--border)] bg-[var(--surface-muted)]'"
                  @click="applyBailianPipeline(item)"
                >
                  <span class="block">{{ item.name }}</span>
                  <span class="mt-0.5 block font-mono text-[10px] opacity-70">{{ item.id }} · docs {{ item.docNum }}</span>
                </button>
              </div>
              <label class="grid gap-1 text-xs font-semibold text-[var(--muted)]">{{ t('knowledge.externalId') }}<input v-model="draft.externalId" class="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm font-normal" :placeholder="t('knowledge.bailianIndexHint')" /></label>
              <label class="grid gap-1 text-xs font-semibold text-[var(--muted)]">{{ t('knowledge.categoryId') }}<input v-model="draft.categoryId" class="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm font-normal" :placeholder="t('knowledge.categoryIdHint')" /></label>
            </template>
            <label v-else class="grid gap-1 text-xs font-semibold text-[var(--muted)]">{{ t('knowledge.externalId') }}<input v-model="draft.externalId" class="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-sm font-normal" :placeholder="t('knowledge.externalIdHint')" /></label>
          </template>
          <div v-if="draft.provider === 'lancedb' || draft.provider === 'qdrant' || draft.provider === 'pinecone'" class="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/45 p-3">
            <div>
              <p class="text-xs font-semibold text-[var(--text)]">向量模型</p>
              <p class="mt-1 text-[11px] font-normal leading-relaxed text-[var(--muted)]">选择系统默认模型，或为当前知识库指定一个已经在“设置 → 模型”中配置好的 Embedding 模型。</p>
            </div>
            <label class="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs">
              <input v-model="draft.embeddingMode" class="mt-0.5" type="radio" value="system" />
              <span><strong class="block text-[var(--text)]">继承系统默认模型</strong><span class="mt-0.5 block font-normal text-[var(--muted)]">{{ systemEmbedding ? `${systemEmbedding.providerLabel} · ${systemEmbedding.modelId}${systemEmbedding.meta?.dimension ? ` · ${systemEmbedding.meta.dimension}d` : ''}` : '尚未配置系统默认 Embedding' }}</span></span>
            </label>
            <label class="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs">
              <input v-model="draft.embeddingMode" class="mt-0.5" type="radio" value="model" />
              <span class="min-w-0 flex-1"><strong class="block text-[var(--text)]">为此知识库指定模型</strong><select v-model="draft.embeddingModelConfigId" class="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm font-normal" :disabled="draft.embeddingMode !== 'model'" required><option value="" disabled>请选择已配置的 Embedding 模型</option><option v-for="item in embeddingModels" :key="item.configuredModelId" :value="item.configuredModelId">{{ item.providerLabel }} · {{ item.label }}{{ item.meta?.dimension ? ` · ${item.meta.dimension}d` : '' }}</option></select></span>
            </label>
            <p v-if="!embeddingModels.length" class="rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-[11px] font-normal text-[var(--muted)]">当前没有可用的 Embedding 模型。<button type="button" class="ml-1 font-semibold text-[var(--accent)]" @click="emit('openSettings')">前往设置</button></p>
          </div>
          <div class="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/45 p-3">
            <p class="text-xs font-semibold">使用与检索增强</p>
            <label class="flex items-center gap-2 text-xs font-semibold"><input v-model="draft.enabled" type="checkbox" />{{ t('knowledge.enabled') }}</label>
            <label v-if="draft.provider === 'lancedb'" class="flex items-start gap-2 text-xs font-semibold">
              <input v-model="draft.wikiRetrievalEnabled" class="mt-0.5" type="checkbox" aria-label="启用 Wiki 融合检索" />
              <span><strong class="block">启用 Wiki 融合检索</strong><span class="mt-0.5 block font-normal text-[var(--muted)]">默认关闭。将已发布且来源有效的 Wiki 页面加入检索与员工问答；关闭不影响 Wiki 浏览和独立搜索。</span></span>
            </label>
            <label v-if="draft.provider === 'lancedb'" class="flex items-start gap-2 text-xs font-semibold">
              <input v-model="draft.wikiRelatedExpansionEnabled" :disabled="!draft.wikiRetrievalEnabled" class="mt-0.5" type="checkbox" aria-label="关联页面扩展" />
              <span><strong class="block">关联页面扩展</strong><span class="mt-0.5 block font-normal text-[var(--muted)]">默认关闭，需先启用 Wiki 融合检索。沿命中页面的链接补充少量与问题相关的已发布页面，最多扩展一跳。</span></span>
            </label>
            <label class="flex items-start gap-2 text-xs font-semibold">
              <input v-model="draft.ontologyEnabled" class="mt-0.5" type="checkbox" />
              <span><strong class="block text-[var(--text)]">启用本体增强检索</strong><span class="mt-0.5 block font-normal text-[var(--muted)]">默认开启。Agent 会自动使用已发布本体扩展与重排结果；不可用时自动退回普通检索。</span></span>
            </label>
          </div>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold" @click="closeForm">{{ t('common.close') }}</button>
          <button type="submit" class="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white" :disabled="saving">{{ saving ? t('knowledge.saving') : t('knowledge.save') }}</button>
        </div>
      </form>
    </div>

    <div v-if="ingestOpen" class="fixed inset-0 z-40 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-[2px]" @click.self="closeIngest">
      <form class="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl" @submit.prevent="runIngest">
        <header class="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
          <div class="flex min-w-0 items-start gap-3">
            <span class="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent)]/10 text-xl text-[var(--accent)]">↥</span>
            <div class="min-w-0">
              <h3 class="text-lg font-bold text-[var(--text)]">{{ t('knowledge.upload') }}</h3>
              <p class="mt-1 text-xs leading-relaxed text-[var(--muted)]">{{ t('knowledge.uploadHelp') }}</p>
              <div class="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
                <span class="rounded-full bg-[var(--surface-muted)] px-2.5 py-1">{{ selected?.name }}</span>
                <span v-if="selected && resolvedEmbeddingFor(selected)" class="rounded-full bg-[var(--surface-muted)] px-2.5 py-1">{{ resolvedEmbeddingFor(selected)?.providerLabel }} · {{ resolvedEmbeddingFor(selected)?.modelId }}</span>
              </div>
            </div>
          </div>
          <button type="button" class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-lg text-[var(--muted)] hover:bg-[var(--surface-muted)] disabled:opacity-40" :disabled="ingestBusy" aria-label="关闭" @click="closeIngest">×</button>
        </header>

        <div class="px-6 py-5">
          <div class="mb-5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
            <div class="h-1.5 rounded-full bg-[var(--accent)] transition-all duration-500" :class="ingestStage === 'processing' ? 'animate-pulse' : ''" :style="{ width: `${ingestProgress}%` }" />
          </div>

          <div class="grid grid-cols-3 gap-2 text-center text-[11px]">
            <div :class="ingestProgress >= 18 ? 'text-[var(--accent)]' : 'text-[var(--muted)]'"><span class="mx-auto mb-1 grid h-6 w-6 place-items-center rounded-full border border-current font-bold">1</span>{{ t('knowledge.ingestStepFile') }}</div>
            <div :class="ingestProgress >= 76 ? 'text-[var(--accent)]' : 'text-[var(--muted)]'"><span class="mx-auto mb-1 grid h-6 w-6 place-items-center rounded-full border border-current font-bold">2</span>{{ t('knowledge.ingestStepProcess') }}</div>
            <div :class="ingestProgress === 100 ? 'text-emerald-600' : 'text-[var(--muted)]'"><span class="mx-auto mb-1 grid h-6 w-6 place-items-center rounded-full border border-current font-bold">3</span>{{ t('knowledge.ingestStepDone') }}</div>
          </div>

          <div v-if="ingestStage !== 'success'" class="mt-5">
            <div class="inline-flex rounded-xl bg-[var(--surface-muted)] p-1 text-xs font-semibold">
              <button type="button" class="rounded-lg px-3 py-2 transition" :class="ingestMode === 'file' ? 'bg-[var(--surface)] text-[var(--accent)] shadow-sm' : 'text-[var(--muted)]'" :disabled="ingestBusy" @click="setIngestMode('file')">{{ t('knowledge.ingestModeFile') }}</button>
              <button type="button" class="rounded-lg px-3 py-2 transition" :class="ingestMode === 'text' ? 'bg-[var(--surface)] text-[var(--accent)] shadow-sm' : 'text-[var(--muted)]'" :disabled="ingestBusy" @click="setIngestMode('text')">{{ t('knowledge.ingestModeText') }}</button>
            </div>

            <div class="mt-4 grid gap-4">
              <label class="grid gap-1.5 text-xs font-semibold text-[var(--muted)]">
                {{ t('knowledge.docTitle') }}
                <input v-model="ingestTitle" class="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3.5 py-3 text-sm font-normal text-[var(--text)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10" :disabled="ingestBusy" />
              </label>

              <div v-if="ingestMode === 'file'" class="grid gap-3">
                <input ref="ingestFileInput" type="file" :accept="selected?.provider === 'lancedb' ? '.txt,.md,.markdown,.csv,.json,.pdf,.docx' : undefined" class="hidden" @change="onPickFile" />
                <button
                  v-if="!ingestFileName"
                  type="button"
                  class="group grid min-h-40 place-items-center rounded-2xl border-2 border-dashed px-5 py-7 text-center transition"
                  :class="ingestDragActive ? 'border-[var(--accent)] bg-[var(--accent)]/5' : 'border-[var(--border)] bg-[var(--surface-muted)]/35 hover:border-[var(--accent)] hover:bg-[var(--accent)]/5'"
                  :disabled="ingestBusy"
                  @click="ingestFileInput?.click()"
                  @dragenter.prevent="ingestDragActive = true"
                  @dragover.prevent="ingestDragActive = true"
                  @dragleave.prevent="ingestDragActive = false"
                  @drop.prevent="onDropFile"
                >
                  <span>
                    <span class="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[var(--accent)]/10 text-2xl text-[var(--accent)] transition group-hover:scale-105">＋</span>
                    <strong class="mt-3 block text-sm text-[var(--text)]">{{ t('knowledge.ingestDropTitle') }}</strong>
                    <span class="mt-1.5 block text-xs leading-relaxed text-[var(--muted)]">{{ selected?.provider === 'lancedb' ? t('knowledge.ingestLocalFormats') : t('knowledge.bailianContentHint') }}</span>
                  </span>
                </button>

                <div v-else class="flex items-center gap-3 rounded-2xl border p-4" :class="ingestStage === 'error' ? 'border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/20' : 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20'">
                  <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-lg font-bold" :class="ingestStage === 'error' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'">{{ ingestStage === 'error' ? '!' : '✓' }}</span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-semibold text-[var(--text)]">{{ ingestFileName }}</p>
                    <p class="mt-1 text-xs text-[var(--muted)]">{{ formatFileSize(ingestFileSize) }} · {{ ingestStage === 'reading' ? t('knowledge.ingestReading') : ingestStage === 'error' ? t('knowledge.ingestFailedTitle') : t('knowledge.ingestReady') }}</p>
                  </div>
                  <button type="button" class="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold" :disabled="ingestBusy" @click="resetIngestFile">{{ t('knowledge.ingestReplace') }}</button>
                </div>
              </div>

              <label v-else class="grid gap-1.5 text-xs font-semibold text-[var(--muted)]">
                {{ t('knowledge.docContent') }}
                <textarea v-model="ingestContent" rows="10" class="resize-y rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3.5 py-3 text-sm font-normal leading-relaxed text-[var(--text)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10" :disabled="ingestBusy" :placeholder="t('knowledge.ingestTextPlaceholder')" />
                <span class="text-right font-normal">{{ ingestContent.length.toLocaleString() }} {{ t('knowledge.ingestChars') }}</span>
              </label>
            </div>
          </div>

          <div v-if="ingestStage === 'processing'" class="mt-5 flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 p-4 text-blue-800 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-200" aria-live="polite">
            <span class="mt-0.5 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent" />
            <div><p class="text-sm font-semibold">{{ t('knowledge.ingestProcessingTitle') }}</p><p class="mt-1 text-xs leading-relaxed opacity-80">{{ t('knowledge.ingestProcessingHelp') }}</p></div>
          </div>
          <div v-else-if="ingestStage === 'success'" class="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200" aria-live="polite">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-100 text-lg font-bold dark:bg-emerald-900/50">✓</span>
            <div><p class="text-sm font-semibold">{{ t('knowledge.ingestSuccessTitle') }}</p><p class="mt-1 text-xs leading-relaxed opacity-85">{{ ingestResult }}</p></div>
          </div>
          <div v-else-if="ingestError" class="mt-5 rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-rose-800 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-200" role="alert">
            <p class="text-sm font-semibold">{{ t('knowledge.ingestFailedTitle') }}</p>
            <p class="mt-1 break-words text-xs leading-relaxed">{{ ingestError }}</p>
          </div>
        </div>

        <footer class="flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface-muted)]/30 px-6 py-4">
          <p class="hidden text-[11px] text-[var(--muted)] sm:block">{{ t('knowledge.ingestPrivacy') }}</p>
          <div class="ml-auto flex gap-2">
            <button v-if="ingestStage !== 'success'" type="button" class="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs font-semibold disabled:opacity-40" :disabled="ingestBusy" @click="closeIngest">{{ t('common.close') }}</button>
            <button v-if="ingestStage !== 'success'" type="submit" class="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-45" :disabled="!ingestCanSubmit">{{ ingestBusy ? t('knowledge.indexing') : t('knowledge.index') }}</button>
            <button v-else type="button" class="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white" @click="closeIngest">{{ t('knowledge.ingestFinish') }}</button>
          </div>
        </footer>
      </form>
    </div>
  </section>
</template>
