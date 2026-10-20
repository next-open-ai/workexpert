<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  skipOntologyAnalysisBatch,
  stopOntologyAnalysis,
  commitOntologyCandidates,
  deleteOntologyCandidates,
  getOntologyAnalysisStatus,
  importOntologyCandidates,
  listKnowledgeDocuments,
  listOntologyVersions,
  mergeOntologyCandidates,
  previewOntologyChanges,
  publishOntologyDraft,
  repairOntologyDraft,
  queryOntology,
  readOntologyWorkflow,
  reviewOntologyCandidates,
  saveOntologyDraft,
  searchKnowledgeWithOntology,
  stageOntologyCandidates,
  startOntologyAnalysis,
  upsertOntologyCandidate,
  type KnowledgeBasePayload,
  type KnowledgeDocumentRow,
  type OntologyAnalysisJob,
  type OntologyHybridSearchPayload,
  type OntologyPreviewPayload,
  type OntologyQueryPlanPayload,
  type OntologyVersionPayload,
  type OntologyWorkflowPayload,
} from "../../services/api";
import { useNotify } from "../../app/notify";
import OntologyGraphView from "./OntologyGraphView.vue";
import OntologyGovernancePanel from "./OntologyGovernancePanel.vue";
import OntologyModelPanel from "./OntologyModelPanel.vue";

type ModelPayload = {
  provider: string;
  baseUrl?: string;
  chatModel: string;
  embeddingModel?: string;
  apiKey: string;
};
type Candidate = OntologyWorkflowPayload["candidates"][number];
const props = defineProps<{
  knowledgeBase: KnowledgeBasePayload;
  model?: ModelPayload;
  isAdmin?: boolean;
}>();
const emit = defineEmits<{
  openEvidence: [evidence: { documentId?: string; chunkId?: string; source?: string }];
}>();
const notify = useNotify();
const state = ref<OntologyWorkflowPayload | null>(null);
const documents = ref<KnowledgeDocumentRow[]>([]);
const selectedDocumentIds = ref<string[]>([]);
const instructions = ref("");
const instructionsCustomized = ref(false);
const draftText = ref("");
const candidateText = ref("[]");
const busy = ref(false);
const analysisBusy = ref(false);
type BuildStep = 1 | 2 | 3 | 4;
const step = ref<BuildStep>(1);
const buildProgress = ref<BuildStep>(1);
const reviewManagerOpen = ref(false);
const publicationOpen = ref(false);
const qualitySkipped = ref(false);
const skippedSteps = ref(new Set<number>());
const intensity = ref<"quick" | "standard" | "deep">("standard");
const analysisJob = ref<OntologyAnalysisJob | null>(null);
const analysisJobId = ref("");
const stoppingForReview = ref(false);
const stoppingProgress = ref(0);
const skippingBatches = ref(new Set<number>());
const analysisControlError = ref('');
let analysisTimer: ReturnType<typeof setInterval> | undefined;
const candidateFilter = ref("pending");
const candidateScopeIds = ref<Set<string> | null>(null);
const reviewDialog = ref<HTMLDialogElement | null>(null);
const reviewSaving = ref(false);
const modalBulkDecision = ref<'accepted' | 'rejected' | null>(null);
const reviewSaveError = ref('');
const reviewChunkId = ref('');
const modalCandidate = ref<OntologyWorkflowPayload['candidates'][number] | null>(null);
async function saveModalCandidate() {
  if (!modalCandidate.value) return;
  reviewSaving.value = true;
  try {
    state.value = (await upsertOntologyCandidate(props.knowledgeBase, modalCandidate.value)).workflow;
    modalCandidate.value = null;
    reviewSaveError.value = '';
  } catch (error) { reviewSaveError.value = error instanceof Error ? error.message : String(error); }
  finally { reviewSaving.value = false; }
}
const selectedCandidate = ref<Candidate | null>(null);
const graphEditCandidateId = ref("");
const candidatePropertiesText = ref("{}");
const bulkDecision = ref<"accepted" | "rejected" | null>(null);
const preview = ref<OntologyPreviewPayload | null>(null);
const versions = ref<OntologyVersionPayload[]>([]);
const publishNote = ref("");
const publicationBusy = ref(false);
const publicationError = ref('');
const analysisError = ref("");
const analysisResult = ref("");
const advancedOpen = ref(false);
const workspaceMode = ref<"graph" | "model" | "quality" | "workflow">("graph");
const graphSource = ref<"published" | "draft">("published");
const verificationQuery = ref("");
const verificationBusy = ref(false);
const verificationError = ref("");
const verificationPlan = ref<OntologyQueryPlanPayload | null>(null);
const verificationResult = ref<OntologyHybridSearchPayload | null>(null);
const scopedCandidates = computed(() => {
  const candidates = state.value?.candidates || [];
  return candidateScopeIds.value
    ? candidates.filter((item) => candidateScopeIds.value!.has(item.id))
    : candidates;
});
const pending = computed(() => scopedCandidates.value.filter((item) => item.status === "pending"));
const reviewChunks = computed(() => [...new Set(scopedCandidates.value.flatMap(item => item.evidence.map(evidence => evidence.chunkId).filter((id): id is string => Boolean(id))))]);
const modalReviewCandidates = computed(() => scopedCandidates.value.filter(item => !reviewChunkId.value || item.evidence.some(evidence => evidence.chunkId === reviewChunkId.value)));
const modalEditableCandidates = computed(() => modalReviewCandidates.value.filter(item => item.status !== 'staged' && item.status !== 'committed'));
const modalAcceptIds = computed(() => modalEditableCandidates.value.filter(item => item.status !== 'accepted').map(item => item.id));
const modalRejectIds = computed(() => modalEditableCandidates.value.filter(item => item.status !== 'rejected').map(item => item.id));
const accepted = computed(
  () =>
    scopedCandidates.value.filter(
      (item) => item.status === "accepted" || item.status === "staged",
    ),
);
const deferred = computed(
  () => scopedCandidates.value.filter((item) => item.status === "deferred"),
);
const rejected = computed(
  () => scopedCandidates.value.filter((item) => item.status === "rejected"),
);
const historicalCandidateCount = computed(() => Math.max(0, (state.value?.candidates.length || 0) - scopedCandidates.value.length));
const publishedGraphCounts = computed(() => ({ nodes: state.value?.published?.nodes.length || 0, edges: state.value?.published?.edges.length || 0 }));
const draftGraphCounts = computed(() => ({ nodes: (preview.value?.graph || state.value?.draft)?.nodes.length || 0, edges: (preview.value?.graph || state.value?.draft)?.edges.length || 0 }));
const selectableDocuments = computed(() => documents.value.slice(0, 20));
const selectedDocuments = computed(() =>
  documents.value.filter((item) => selectedDocumentIds.value.includes(item.id)),
);
const documentOverview = computed(() =>
  selectedDocuments.value.map((item) => ({
    id: item.id,
    title: item.title,
    detail:
      item.preview?.trim() ||
      `已索引 ${item.chunkCount} 个知识片段，暂无可展示的内容预览。`,
  })),
);
const suggestedInstructions = computed(() => {
  const titles = selectedDocuments.value
    .slice(0, 5)
    .map((item) => `《${item.title}》`)
    .join("、");
  if (!titles) return "";
  return `请基于 ${titles}${selectedDocuments.value.length > 5 ? ` 等 ${selectedDocuments.value.length} 篇文档` : ""}，优先识别文档中明确出现的业务对象、角色、产品、流程、规则与指标，并提取它们之间有原文证据支持的关系。合并同义名称，保留常用别名；忽略目录、页眉页脚和缺少业务检索价值的泛化词。`;
});
const duplicateGroups = computed(() => {
  const groups = new Map<string, Candidate[]>();
  for (const c of state.value?.candidates || []) {
    if (c.kind !== "node") continue;
    const key = String(c.node?.name || "")
      .replace(/\s+/g, "")
      .toLowerCase();
    if (!key) continue;
    const list = groups.get(key) || [];
    list.push(c);
    groups.set(key, list);
  }
  return [...groups.values()].filter((g) => g.length > 1);
});
const allDocumentsSelected = computed(
  () =>
    selectableDocuments.value.length > 0 &&
    selectedDocumentIds.value.length === selectableDocuments.value.length,
);
watch(
  selectedDocumentIds,
  () => {
    if (!instructionsCustomized.value)
      instructions.value = suggestedInstructions.value;
  },
  { deep: true },
);
const analysisPercent = computed(() => {
  if (!analysisJob.value) return 0;
  if (stoppingForReview.value && analysisBusy.value) return stoppingProgress.value;
  if (analysisJob.value.status === "completed") return 100;
  if (analysisJob.value.status === "partial" && analysisJob.value.result) {
    const total = analysisJob.value.result.analyzedChunks + analysisJob.value.result.failedChunkIds.length;
    return total ? Math.round(100 * analysisJob.value.result.analyzedChunks / total) : 0;
  }
  const phase = analysisPhases.indexOf(analysisJob.value.phase);
  if (phase < 0) return 5;
  if (phase === 0) return 12;
  if (phase === 1) return 22;
  if (phase === 2)
    return Math.min(
      78,
      28 +
        Math.round(
          50 *
            (analysisJob.value.currentBatch /
              Math.max(1, analysisJob.value.totalBatches)),
        ),
    );
  if (phase === 3) return 88;
  return 96;
});
const analysisStatusLabel = computed(() =>
  analysisJob.value?.stopRequested
    ? analysisBusy.value ? '正在停止并保存' : '已停止，结果已保存'
    : analysisJob.value?.status === "completed"
    ? "识别完成"
    : analysisJob.value?.status === "partial"
      ? "部分完成"
    : analysisJob.value?.status === "failed"
      ? "识别失败"
      : analysisJob.value?.status === "cancelled"
        ? "已取消"
        : analysisJob.value?.status === "running"
          ? "正在识别"
          : "准备中",
);
const primaryAnalysisFailure = computed(() =>
  analysisJob.value?.failures?.find((failure) => failure.category !== "deferred_after_repeated_failure") ||
  analysisJob.value?.result?.failures?.find((failure) => failure.category !== "deferred_after_repeated_failure"),
);
const analysisFailureSummary = computed(() => {
  const failure = primaryAnalysisFailure.value;
  if (!failure) return "部分切片未完成，系统已保留检查点。";
  const labels: Record<string, string> = {
    provider_timeout: "模型服务在限定时间内未返回完整结果",
    provider_http: "模型服务返回了请求错误",
    schema_unsupported: "当前模型不兼容严格结构化输出",
    output_truncated: "模型输出达到长度上限，结果被截断",
    invalid_output: "模型返回的结构化内容不完整",
    evidence_invalid: "模型证据未能通过原文核验",
    provider_error: "模型服务连接中断",
    user_skipped: "已按你的选择跳过部分切片，可稍后继续",
    user_stopped: "已按你的选择停止分析，已有结果已保存",
    unknown: "模型请求发生未分类异常",
  };
  return labels[failure.category] || failure.message;
});
const friendlyAnalysisError = computed(() => {
  const message = analysisError.value;
  if (/terminated|连接暂时中断|fetch failed|failed to fetch|econnreset|socket|timed?\s*out|timeout/i.test(message)) {
    return {
      title: "AI 服务连接暂时中断",
      detail: "分析过程中模型服务提前断开了连接。这通常是临时网络波动，不是文档内容或模型规则有问题。",
      suggestion: "系统已经尝试自动恢复；仍未成功时，稍后点击“直接重试”即可，无需修改文档。",
    };
  }
  if (/未授权的知识切片|无法在原文中核验/.test(message)) {
    return {
      title: "部分内容未能通过原文核验",
      detail: "AI 返回的个别证据与本次文档不一致。系统已停止采用这些内容，以免把不可靠的信息写入知识库。",
      suggestion: "无需修改文档或专业设置，可以直接重新识别；系统会重新校验证据。",
    };
  }
  if (/JSON|结构化结果|长度上限/.test(message)) {
    return {
      title: "AI 返回的内容不完整",
      detail: "本次模型输出没有完整结束，已识别的文档和索引不会丢失。",
      suggestion: "请直接重试；若仍未完成，系统建议减少一次选择的文档数量。",
    };
  }
  return {
    title: "本次识别未完成",
    detail: message || "识别任务没有正常完成。",
    suggestion: "文档和索引不会丢失，可以直接重试或返回调整分析范围。",
  };
});
const nodeOptions = computed(() => {
  const rows = [
    ...(state.value?.draft.nodes || []),
    ...(state.value?.candidates
      .filter((item) => item.kind === "node")
      .map((item) => item.node) || []),
  ] as Array<Record<string, unknown>>;
  return [
    ...new Map(
      rows.filter(Boolean).map((node) => [String(node.id), node]),
    ).values(),
  ];
});
const bulkLowConfidence = computed(
  () => pending.value.filter((item) => item.confidence < 0.7).length,
);
function annotateChanges(graph: { version: number; nodes: unknown[]; edges: unknown[] } | undefined) {
  if (!graph || graphSource.value !== "draft") return graph;
  const published = state.value?.published;
  const oldNodes = new Map(((published?.nodes || []) as Array<Record<string, unknown>>).map((item) => [String(item.id), item]));
  const oldEdges = new Map(((published?.edges || []) as Array<Record<string, unknown>>).map((item) => [String(item.id), item]));
  const comparable = (item: Record<string, unknown>) => { const { status: _status, properties, ...rest } = item; const { _change, ...cleanProperties } = (properties || {}) as Record<string, unknown>; return { ...rest, properties: cleanProperties }; };
  const mark = (item: Record<string, unknown>, old?: Record<string, unknown>) => ({ ...item, properties: { ...((item.properties || {}) as object), _change: !old ? "added" : JSON.stringify(comparable(item)) !== JSON.stringify(comparable(old)) ? "modified" : "" } });
  const currentNodes = graph.nodes as Array<Record<string, unknown>>, currentEdges = graph.edges as Array<Record<string, unknown>>;
  const currentNodeIds = new Set(currentNodes.map((item) => String(item.id))), currentEdgeIds = new Set(currentEdges.map((item) => String(item.id)));
  const deletedNodes = [...oldNodes.values()].filter((item) => !currentNodeIds.has(String(item.id))).map((item) => ({ ...item, properties: { ...((item.properties || {}) as object), _change: "deleted" } }));
  const deletedEdges = [...oldEdges.values()].filter((item) => !currentEdgeIds.has(String(item.id))).map((item) => ({ ...item, properties: { ...((item.properties || {}) as object), _change: "deleted" } }));
  return { ...graph, nodes: [...currentNodes.map((item) => mark(item, oldNodes.get(String(item.id)))), ...deletedNodes], edges: [...currentEdges.map((item) => mark(item, oldEdges.get(String(item.id)))), ...deletedEdges] };
}
const activeGraph = computed(() => annotateChanges(graphSource.value === "draft" ? preview.value?.graph || state.value?.draft : state.value?.published));
const hasGraphContent = computed(() => Boolean(state.value?.published?.nodes.length || state.value?.draft.nodes.length));
const hasDraftContent = computed(() => Boolean(state.value?.draft.nodes.length || state.value?.draft.edges.length));
const unstagedTaskCandidates = computed(() => {
  const ids = new Set(analysisJob.value?.candidateIds || analysisJob.value?.result?.candidateIds || []);
  return (state.value?.candidates || []).filter(item => ids.has(item.id) && (item.status === 'pending' || item.status === 'accepted'));
});
const canSkipQuality = computed(() => Boolean(preview.value && preview.value.validation.blockers.length === 0 && preview.value.validation.warnings.length === 0));
const candidateGraph = computed(() => {
  const baseNodes = (state.value?.draft.nodes || []) as Array<Record<string, unknown>>;
  const baseEdges = (state.value?.draft.edges || []) as Array<Record<string, unknown>>;
  const candidates = scopedCandidates.value.filter((item) => item.status !== "rejected" && item.status !== "deferred");
  const evidenceProperties = (item: Candidate) => ({ documentId: item.evidence[0]?.documentId, chunkId: item.evidence[0]?.chunkId, _confidence: item.confidence, _change: "added" });
  const nodes: Array<Record<string, unknown>> = [...baseNodes, ...candidates.filter((item) => item.kind === "node" && item.node).map((item) => ({ ...(item.node as Record<string, unknown>), source: item.evidence[0]?.source, properties: { ...((item.node?.properties || {}) as object), ...evidenceProperties(item) } }) as Record<string, unknown>)];
  const uniqueNodes = [...new Map(nodes.map((node) => [String(node.id), node])).values()];
  const nodeIds = new Set(uniqueNodes.map((node) => String(node.id)));
  const edges: Array<Record<string, unknown>> = [...baseEdges, ...candidates.filter((item) => item.kind === "edge" && item.edge).map((item) => ({ ...(item.edge as Record<string, unknown>), source: item.evidence[0]?.source, properties: { ...((item.edge?.properties || {}) as object), ...evidenceProperties(item) } }) as Record<string, unknown>)].filter((edge) => nodeIds.has(String(edge.subjectId)) && nodeIds.has(String(edge.objectId)));
  return { version: state.value?.draft.version || 0, nodes: uniqueNodes, edges: [...new Map(edges.map((edge) => [String(edge.id), edge])).values()] };
});
function canOpenStep(target: number) {
  if (target === 1) return true;
  if (target === 2) return Boolean(analysisJob.value || state.value?.candidates.length || reviewManagerOpen.value);
  if (target === 3) return hasDraftContent.value || Boolean(analysisJob.value?.stopRequested);
  return target === 4 && Boolean(state.value?.published);
}
async function openStep(target: BuildStep) {
  if (!canOpenStep(target)) return;
  if (target === 2 && !analysisJob.value) reviewManagerOpen.value = true;
  try {
    if (target === 3) {
      await refreshPreview();
      await loadVersions();
    }
    step.value = target;
  } catch (error) { notify.error(error, 'notify.saveFailed'); }
}
function progressState(target: number) {
  const current = analysisBusy.value ? 2 : buildProgress.value;
  if (skippedSteps.value.has(target)) return "skipped";
  if (target < current) return "completed";
  if (target === current) return "current";
  return "upcoming";
}
function progressShape(target: number) {
  return {
    clipPath: target === 1
      ? "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%)"
      : target === 4
        ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 12px 50%)"
        : "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%)",
  };
}
function startAiBuild() {
  workspaceMode.value = "workflow";
  if (analysisJob.value) {
    step.value = 2;
    reviewManagerOpen.value = false;
    return;
  }
  skippedSteps.value = new Set();
  candidateScopeIds.value = null;
  buildProgress.value = 1;
  step.value = 1;
}
function openRunningAnalysis() {
  if (!analysisJob.value) return;
  workspaceMode.value = "workflow";
  step.value = 2;
  reviewManagerOpen.value = false;
}
async function startManualBuild() {
  workspaceMode.value = "workflow";
  candidateScopeIds.value = null;
  skippedSteps.value = new Set([1]);
  buildProgress.value = 2;
  step.value = 2;
  reviewManagerOpen.value = true;
  await addEntity();
}
async function skipQualityCheck() {
  await refreshPreview();
  if (!canSkipQuality.value) return;
  qualitySkipped.value = true;
  publicationOpen.value = true;
  buildProgress.value = 3;
  step.value = 3;
  await loadVersions();
}
async function editGraphItem(item: { kind: "node" | "edge"; value: Record<string, unknown> }) {
  graphSource.value = "draft";
  const existing = state.value?.candidates.find((candidate) =>
    item.kind === "node"
      ? candidate.kind === "node" && candidate.node?.id === item.value.id
      : candidate.kind === "edge" && candidate.edge?.id === item.value.id,
  );
  if (existing) {
    graphEditCandidateId.value = existing.id;
    openCandidate(existing);
    return;
  }
  const now = Date.now();
  const properties: Record<string, unknown> = { ...((item.value.properties || {}) as Record<string, unknown>), _origin: "图谱编辑", _editedAt: new Date(now).toISOString() };
  delete properties._change;
  delete properties._confidence;
  const common = { evidence: [{ documentId: "manual", quote: "从关系图发起编辑", source: "图谱维护" }], confidence: 1, status: "pending" };
  const candidate = item.kind === "node"
    ? { ...common, id: `candidate-edit-node-${String(item.value.id)}-${now}`, kind: "node", node: { ...item.value, properties, status: "draft" } }
    : { ...common, id: `candidate-edit-edge-${String(item.value.id)}-${now}`, kind: "edge", edge: { ...item.value, properties, status: "draft" } };
  state.value = (await upsertOntologyCandidate(props.knowledgeBase, candidate)).workflow;
  const saved = state.value.candidates.find((row) => row.id === candidate.id);
  if (saved) {
    graphEditCandidateId.value = saved.id;
    openCandidate(saved);
  }
}
function openCandidate(item: Candidate) {
  selectedCandidate.value = structuredClone(item);
  candidatePropertiesText.value = JSON.stringify(
    (item.node || item.edge)?.properties || {},
    null,
    2,
  );
}
function setCandidateAliases(value: string) {
  if (selectedCandidate.value?.node)
    selectedCandidate.value.node.aliases = [
      ...new Set(
        value
          .split(/[，,\n]/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
}

async function load() {
  busy.value = true;
  verificationQuery.value = "";
  verificationError.value = "";
  verificationPlan.value = null;
  verificationResult.value = null;
  try {
    const [workflow, docs] = await Promise.all([
      readOntologyWorkflow(props.knowledgeBase),
      listKnowledgeDocuments({ knowledgeBase: props.knowledgeBase }),
    ]);
    state.value = workflow.workflow;
    if (!state.value.published && state.value.draft.nodes.length) graphSource.value = "draft";
    buildProgress.value = state.value.published
      ? 4
      : state.value.draft.nodes.length
        ? 3
        : state.value.candidates.length
          ? 2
          : analysisJob.value
            ? 2
            : 1;
    if (!state.value.published && !state.value.draft.nodes.length && !state.value.candidates.length) {
      workspaceMode.value = "workflow";
      step.value = 1;
    }
    draftText.value = JSON.stringify(state.value.draft, null, 2);
    documents.value = docs.documents;
    selectedDocumentIds.value = docs.documents
      .slice(0, 20)
      .map((item) => item.id);
    if (!instructionsCustomized.value)
      instructions.value = suggestedInstructions.value;
  } catch (error) {
    notify.error(error, "notify.saveFailed");
  } finally {
    busy.value = false;
  }
}
const analysisPhases = [
  "读取文档",
  "整理分析批次",
  "AI 识别",
  "证据核验与候选归并",
  "候选归并完成",
];
function phaseState(label: string) {
  if (!analysisJob.value) return "等待中";
  if (analysisJob.value.status === "partial") {
    if (label === "AI 识别") return `${Math.max(0, analysisJob.value.totalBatches - (analysisJob.value.failedBatches || 0))} / ${analysisJob.value.totalBatches} 批完成`;
    if (label === "候选归并") return "已保存";
    return "已完成";
  }
  const mapped: Record<string, string> = {
    证据核验: "证据核验与候选归并",
    候选归并: "候选归并完成",
  };
  const target = mapped[label] || label,
    current = analysisPhases.indexOf(analysisJob.value.phase),
    wanted = analysisPhases.indexOf(target);
  if (analysisJob.value.status === "completed") return "已完成";
  if (current > wanted || (label === "证据核验" && current >= 3))
    return "已完成";
  if (current === wanted || (label === "候选归并" && current === 3))
    return label === "AI 识别"
      ? `${analysisJob.value.currentBatch} / ${analysisJob.value.totalBatches} 批`
      : "进行中";
  return "等待中";
}
async function repairDraft() {
  const result = await repairOntologyDraft(props.knowledgeBase);
  state.value = result.workflow;
  await refreshPreview();
  notify.pushRaw(
    "success",
    "阻断关系已处理",
    result.removedEdgeIds.length
      ? `已移除 ${result.removedEdgeIds.length} 条端点缺失关系，相关候选已转为暂缓。`
      : "未发现需要自动处理的关系。",
  );
}
async function pollAnalysis() {
  if (!analysisJobId.value) return;
  try {
    const response = await getOntologyAnalysisStatus(analysisJobId.value);
    analysisJob.value = response.job;
    analysisBusy.value = response.job.status === "running";
    if ((response.job.status === "completed" || response.job.status === "partial") && response.job.result) {
      state.value = (await readOntologyWorkflow(props.knowledgeBase)).workflow;
      analysisResult.value = `已分析 ${response.job.result.analyzedChunks} 个切片，识别 ${response.job.result.nodes} 个实体和 ${response.job.result.edges} 条关系。`;
      await refreshPreview();
      if (stoppingForReview.value || response.job.stopRequested) {
        stoppingForReview.value = false;
        workspaceMode.value = 'workflow';
        step.value = 3;
        buildProgress.value = 3;
        publicationOpen.value = false;
        reviewManagerOpen.value = false;
      }
      if (analysisTimer) clearInterval(analysisTimer);
    } else if (
      response.job.status === "failed" ||
      response.job.status === "cancelled"
    ) {
      analysisError.value = response.job.error || "任务已取消";
      if (analysisTimer) clearInterval(analysisTimer);
    }
  } catch (error) {
    analysisError.value =
      error instanceof Error ? error.message : String(error);
    if (analysisTimer) clearInterval(analysisTimer);
  }
}
async function analyzeDocuments() {
  if (!props.model) {
    analysisError.value = "请先在设置中配置并启用一个应用对话模型。";
    return;
  }
  if (!selectedDocumentIds.value.length) {
    analysisError.value = "请至少选择一篇文档。";
    return;
  }
  analysisBusy.value = true;
  analysisError.value = "";
  analysisResult.value = "";
  reviewManagerOpen.value = false;
  publicationOpen.value = false;
  buildProgress.value = 2;
  skippedSteps.value = new Set();
  step.value = 2;
  try {
    const result = await startOntologyAnalysis({
      knowledgeBase: props.knowledgeBase,
      documentIds: selectedDocumentIds.value,
      instructions: instructions.value.trim() || undefined,
      model: props.model,
      intensity: intensity.value,
    });
    analysisJobId.value = result.jobId;
    localStorage.setItem(
      `ontology-job:${props.knowledgeBase.id}`,
      result.jobId,
    );
    await pollAnalysis();
    analysisTimer = setInterval(pollAnalysis, 1200);
  } catch (error) {
    analysisBusy.value = false;
    analysisError.value =
      error instanceof Error ? error.message : String(error);
  }
}
async function retryRemainingAnalysis() {
  if (!analysisJob.value?.result?.failedChunkIds.length || !props.model) return;
  analysisBusy.value = true;
  analysisError.value = "";
  try {
    const result = await startOntologyAnalysis({
      knowledgeBase: props.knowledgeBase,
      documentIds: selectedDocumentIds.value,
      chunkIds: analysisJob.value.result.failedChunkIds,
      instructions: instructions.value.trim() || undefined,
      model: props.model,
      intensity: intensity.value,
    });
    analysisJobId.value = result.jobId;
    localStorage.setItem(`ontology-job:${props.knowledgeBase.id}`, result.jobId);
    await pollAnalysis();
    analysisTimer = setInterval(pollAnalysis, 1200);
  } catch (error) {
    analysisBusy.value = false;
    analysisError.value = error instanceof Error ? error.message : String(error);
  }
}
async function skipAnalysisBatch(batchNumber: number) {
  if (!analysisJobId.value || skippingBatches.value.has(batchNumber) || analysisJob.value?.stopRequested) return;
  skippingBatches.value = new Set([...skippingBatches.value, batchNumber]);
  analysisControlError.value = '';
  try {
    await skipOntologyAnalysisBatch(analysisJobId.value, batchNumber);
    await pollAnalysis();
  } catch (error) {
    analysisControlError.value = error instanceof Error ? error.message : String(error);
    await pollAnalysis();
  } finally { skippingBatches.value = new Set([...skippingBatches.value].filter(id => id !== batchNumber)); }
}
async function stopAnalysisAndCheck() {
  if (!analysisJobId.value || stoppingForReview.value) return;
  stoppingProgress.value = analysisPercent.value;
  stoppingForReview.value = true;
  analysisControlError.value = '';
  try {
    analysisJob.value = (await stopOntologyAnalysis(analysisJobId.value)).job;
    await pollAnalysis();
    if (analysisBusy.value) {
      if (analysisTimer) clearInterval(analysisTimer);
      analysisTimer = setInterval(pollAnalysis, 1200);
    }
  } catch (error) {
    stoppingForReview.value = false;
    analysisControlError.value = error instanceof Error ? error.message : String(error);
  }
}
async function reviewAvailableCandidates() {
  const response = await readOntologyWorkflow(props.knowledgeBase);
  state.value = response.workflow;
  const ids = analysisJob.value?.candidateIds || analysisJob.value?.result?.candidateIds || [];
  candidateScopeIds.value = new Set(ids);
  reviewSaveError.value = '';
  modalCandidate.value = null;
  reviewChunkId.value = '';
  reviewDialog.value?.showModal();
}
async function saveReviewedToDraft() {
  if (reviewSaving.value) return;
  reviewSaving.value = true;
  reviewSaveError.value = '';
  try {
    const ids = modalReviewCandidates.value.filter((item) => item.status === 'accepted').map((item) => item.id);
    state.value = (await stageOntologyCandidates(props.knowledgeBase, ids)).workflow;
    await refreshPreview();
    if (!analysisBusy.value) buildProgress.value = 3;
    reviewDialog.value?.close();
    notify.pushRaw('success', '已加入草稿，尚未发布', '分析不受影响。可以继续审核，也可以前往 AI 优化检查后单独发布。');
  } catch (error) {
    reviewSaveError.value = error instanceof Error ? error.message : String(error);
  } finally { reviewSaving.value = false; }
}
async function reviewAllInModal(decision: 'accepted' | 'rejected') {
  if (reviewSaving.value || modalCandidate.value) return;
  const ids = [...(decision === 'accepted' ? modalAcceptIds.value : modalRejectIds.value)];
  if (!ids.length) return;
  reviewSaving.value = true;
  modalBulkDecision.value = decision;
  reviewSaveError.value = '';
  try {
    // The review API accepts at most 1000 IDs per request.
    for (let offset = 0; offset < ids.length; offset += 1000) {
      state.value = (await reviewOntologyCandidates(props.knowledgeBase, ids.slice(offset, offset + 1000), decision)).workflow;
    }
  } catch (error) {
    reviewSaveError.value = error instanceof Error ? error.message : String(error);
  } finally {
    reviewSaving.value = false;
    modalBulkDecision.value = null;
  }
}
async function showAllCandidates() {
  try {
    state.value = (await readOntologyWorkflow(props.knowledgeBase)).workflow;
    candidateScopeIds.value = null;
    reviewManagerOpen.value = true;
  } catch (error) { notify.error(error, 'notify.saveFailed'); }
}
async function refreshPreview() {
  preview.value = await previewOntologyChanges(props.knowledgeBase);
}
async function openGraph(source: "published" | "draft" = graphSource.value) {
  graphSource.value = source;
  workspaceMode.value = "graph";
  if (source === "draft")
    try {
      await refreshPreview();
    } catch (error) {
      notify.error(error, "notify.saveFailed");
    }
}
async function openGraphGovernance() {
  workspaceMode.value = "quality";
}
function openManualEntity() {
  workspaceMode.value = "workflow";
  buildProgress.value = 2;
  candidateScopeIds.value = null;
  step.value = 2;
  reviewManagerOpen.value = true;
  void addEntity();
}
function openManualRelation() {
  workspaceMode.value = "workflow";
  buildProgress.value = 2;
  candidateScopeIds.value = null;
  step.value = 2;
  reviewManagerOpen.value = true;
  void addRelation();
}
async function proceedToReview() {
  try {
    const ids = scopedCandidates.value.filter(item => item.status === 'accepted').map(item => item.id);
    state.value = (await stageOntologyCandidates(props.knowledgeBase, ids)).workflow;
    await refreshPreview();
    buildProgress.value = 3;
    publicationOpen.value = false;
    step.value = 3;
  } catch (error) { notify.error(error, 'notify.saveFailed'); }
}
async function loadVersions() {
  versions.value = (await listOntologyVersions(props.knowledgeBase)).versions;
}
async function publishVersion() {
  if (publicationBusy.value) return;
  if (!props.isAdmin) {
    notify.pushRaw(
      "warning",
      "等待管理员发布",
      "草稿与治理结果已保留，请联系管理员审批发布。",
    );
    return;
  }
  publicationBusy.value = true;
  publicationError.value = '';
  try {
    await refreshPreview();
    if (!preview.value || preview.value.validation.blockers.length) {
      publicationOpen.value = false;
      return;
    }
    state.value = (await publishOntologyDraft(props.knowledgeBase, publishNote.value)).workflow;
    buildProgress.value = 4;
    step.value = 4;
    verificationPlan.value = null;
    verificationResult.value = null;
    verificationError.value = '';
    await refreshPreview();
    await loadVersions();
    notify.pushRaw('success', '本体版本已发布', `当前版本 v${state.value.published?.version}，现在可以输入问题验证召回效果。`);
  } catch (error) {
    publicationError.value = error instanceof Error ? error.message : String(error);
  } finally { publicationBusy.value = false; }
}
async function removeCandidate(id: string) {
  state.value = (
    await deleteOntologyCandidates(props.knowledgeBase, [id])
  ).workflow;
  selectedCandidate.value = null;
}
async function deferCandidate(id: string) {
  state.value = (
    await reviewOntologyCandidates(props.knowledgeBase, [id], "deferred")
  ).workflow;
}
async function addEntity() {
  const now = Date.now(),
    id = `manual-${now}`;
  const candidate = {
    id: `candidate-${id}`,
    kind: "node",
    node: {
      id,
      type: "Concept",
      name: "新实体",
      aliases: [],
      properties: {
        _origin: "人工新增",
        _editedBy: "管理员",
        _editedAt: new Date(now).toISOString(),
      },
      status: "draft",
    },
    evidence: [{ documentId: "manual", quote: "人工新增", source: "人工维护" }],
    confidence: 1,
    status: "pending",
  };
  state.value = (
    await upsertOntologyCandidate(props.knowledgeBase, candidate)
  ).workflow;
  selectedCandidate.value =
    state.value.candidates.find((i) => i.id === candidate.id) || null;
}
async function addRelation() {
  const now = Date.now(),
    nodes = nodeOptions.value;
  if (nodes.length < 2) {
    notify.pushRaw("error", "无法新增关系", "请先新增至少两个实体。");
    return;
  }
  const subject = String(nodes[0]?.id),
    object = String(nodes[1]?.id);
  const id = `manual-edge-${now}`;
  const candidate = {
    id: `candidate-${id}`,
    kind: "edge",
    edge: {
      id,
      subjectId: subject,
      predicate: "关联",
      objectId: object,
      properties: {
        _origin: "人工新增",
        _editedBy: "管理员",
        _editedAt: new Date(now).toISOString(),
      },
      status: "draft",
    },
    evidence: [{ documentId: "manual", quote: "人工新增", source: "人工维护" }],
    confidence: 1,
    status: "pending",
  };
  state.value = (
    await upsertOntologyCandidate(props.knowledgeBase, candidate)
  ).workflow;
  selectedCandidate.value =
    state.value.candidates.find((i) => i.id === candidate.id) || null;
}
async function saveCandidate() {
  if (!selectedCandidate.value) return;
  try {
    const properties = JSON.parse(candidatePropertiesText.value || "{}");
    if (
      !properties ||
      typeof properties !== "object" ||
      Array.isArray(properties)
    )
      throw new Error("属性必须是 JSON 对象。");
    if (
      selectedCandidate.value.kind === "node" &&
      !String(selectedCandidate.value.node?.name || "").trim()
    )
      throw new Error("实体名称不能为空。");
    if (
      selectedCandidate.value.kind === "edge" &&
      (!String(selectedCandidate.value.edge?.predicate || "").trim() ||
        !selectedCandidate.value.edge?.subjectId ||
        !selectedCandidate.value.edge?.objectId)
    )
      throw new Error("请完整填写关系名称和两端实体。");
    const body =
      selectedCandidate.value.kind === "node"
        ? selectedCandidate.value.node
        : selectedCandidate.value.edge;
    if (body) body.properties = properties;
    const savedId = selectedCandidate.value.id;
    state.value = (
      await upsertOntologyCandidate(
        props.knowledgeBase,
        selectedCandidate.value,
      )
    ).workflow;
    if (graphEditCandidateId.value === savedId) {
      state.value = (await reviewOntologyCandidates(props.knowledgeBase, [savedId], "accepted", "从关系图直接编辑")).workflow;
      state.value = (await stageOntologyCandidates(props.knowledgeBase)).workflow;
      graphEditCandidateId.value = "";
      await refreshPreview();
      workspaceMode.value = "graph";
      graphSource.value = "draft";
      notify.pushRaw("success", "图谱修改已保存", "修改已进入草稿图，发布前仍会自动执行质量检查。");
    }
    selectedCandidate.value = null;
  } catch (error) {
    notify.error(error, "notify.saveFailed");
  }
}
async function mergeDuplicate(ids: string[]) {
  const source =
    state.value?.candidates.filter(
      (c) => ids.includes(c.id) && c.kind === "node",
    ) || [];
  if (source.length < 2) return;
  const first = structuredClone(source[0]);
  first.node!.aliases = [
    ...new Set(
      source
        .flatMap((c) => [
          String(c.node?.name || ""),
          ...((c.node?.aliases as string[]) || []),
        ])
        .filter(Boolean),
    ),
  ];
  state.value = (
    await mergeOntologyCandidates(props.knowledgeBase, ids, first)
  ).workflow;
}

function toggleAllDocuments() {
  selectedDocumentIds.value = allDocumentsSelected.value
    ? []
    : selectableDocuments.value.map((item) => item.id);
}
function applySuggestedInstructions() {
  instructions.value = suggestedInstructions.value;
  instructionsCustomized.value = false;
}
async function saveDraft() {
  try {
    state.value = (
      await saveOntologyDraft(props.knowledgeBase, JSON.parse(draftText.value))
    ).workflow;
    notify.pushRaw("success", "草稿已保存", "发布后才会成为正式本体。");
  } catch (error) {
    notify.error(error, "notify.saveFailed");
  }
}
async function publishDraft() {
  try {
    state.value = (await publishOntologyDraft(props.knowledgeBase)).workflow;
    draftText.value = JSON.stringify(state.value.draft, null, 2);
    notify.pushRaw(
      "success",
      "本体已发布",
      `当前版本 v${state.value.published?.version || 1}`,
    );
  } catch (error) {
    notify.error(error, "notify.saveFailed");
  }
}
async function importCandidates() {
  try {
    state.value = (
      await importOntologyCandidates(
        props.knowledgeBase,
        JSON.parse(candidateText.value),
      )
    ).workflow;
    candidateText.value = "[]";
  } catch (error) {
    notify.error(error, "notify.saveFailed");
  }
}
async function review(
  id: string,
  decision: "accepted" | "rejected" | "deferred",
) {
  if (reviewSaving.value) return;
  reviewSaving.value = true;
  try {
    state.value = (
      await reviewOntologyCandidates(props.knowledgeBase, [id], decision)
    ).workflow;
  } catch (error) {
    notify.error(error, "notify.saveFailed");
  } finally { reviewSaving.value = false; }
}
async function reviewAll(decision: "accepted" | "rejected") {
  if (!pending.value.length) return;
  try {
    state.value = (
      await reviewOntologyCandidates(
        props.knowledgeBase,
        pending.value.map((item) => item.id),
        decision,
      )
    ).workflow;
  } catch (error) {
    notify.error(error, "notify.saveFailed");
  }
}
async function confirmBulkReview() {
  const decision = bulkDecision.value;
  if (!decision) return;
  bulkDecision.value = null;
  await reviewAll(decision);
}
async function commit() {
  try {
    const result = await commitOntologyCandidates(props.knowledgeBase);
    state.value = result.workflow;
    draftText.value = JSON.stringify(state.value.draft, null, 2);
    verificationPlan.value = null;
    verificationResult.value = null;
    verificationError.value = "";
    notify.pushRaw(
      "success",
      "正式图谱已更新",
      `已提交 ${result.workflow.committed || accepted.value.length} 条事实。请重新验证召回结果。`,
    );
  } catch (error) {
    notify.error(error, "notify.saveFailed");
  }
}
async function verifyRetrieval() {
  const query = verificationQuery.value.trim();
  if (query.length < 2) {
    verificationError.value = "请输入至少 2 个字符的验证问题。";
    return;
  }
  verificationBusy.value = true;
  verificationError.value = "";
  verificationPlan.value = null;
  verificationResult.value = null;
  try {
    verificationPlan.value = (
      await queryOntology(props.knowledgeBase, query, 2)
    ).plan;
    verificationResult.value = await searchKnowledgeWithOntology({
      knowledgeBase: props.knowledgeBase,
      query,
      topK: 6,
      model: props.model,
    });
  } catch (error) {
    verificationError.value =
      error instanceof Error ? error.message : String(error);
  } finally {
    verificationBusy.value = false;
  }
}
function nodeName(id: string) {
  const plan = verificationPlan.value;
  return (
    [...(plan?.matchedNodes || []), ...(plan?.relatedNodes || [])].find(
      (node) => node.id === id,
    )?.name || id
  );
}
function pathLabel(path: OntologyQueryPlanPayload["paths"][number]) {
  return path.nodeIds.map(nodeName).join(" → ");
}
function retrievalRouteLabel(
  route: "raw-vector" | "ontology-vector" | "ontology-evidence",
) {
  return route === "ontology-evidence"
    ? "图谱证据"
    : route === "ontology-vector"
      ? "本体扩展"
      : "原始查询";
}
function candidateTitle(item: Candidate) {
  return item.kind === "node"
    ? String(item.node?.name || item.node?.id || "未命名实体")
    : String(item.edge?.predicate || "未命名关系");
}
function candidateMeta(item: Candidate) {
  return item.kind === "node"
    ? `实体 · ${String(item.node?.type || "概念")}`
    : `${String(item.edge?.subjectId || "?")} → ${String(item.edge?.objectId || "?")}`;
}
watch(() => props.knowledgeBase.id, load);
onMounted(async () => {
  await load();
  const saved = localStorage.getItem(`ontology-job:${props.knowledgeBase.id}`);
  if (saved) {
    analysisJobId.value = saved;
    step.value = 2;
    await pollAnalysis();
    const ids = new Set(analysisJob.value?.candidateIds || analysisJob.value?.result?.candidateIds || []);
    const taskCandidates = (state.value?.candidates || []).filter(item => ids.has(item.id));
    const unfinished = analysisJob.value?.status !== 'completed' || taskCandidates.some(item => ['pending', 'accepted', 'deferred'].includes(item.status));
    buildProgress.value = unfinished ? 2
      : preview.value && Object.values(preview.value.summary).some(count => count > 0) ? 3
        : state.value?.published && taskCandidates.length && taskCandidates.every(item => item.status === 'committed') ? 4 : 2;
    if (analysisJob.value?.stopRequested) {
      if (analysisBusy.value) stoppingForReview.value = true;
      else { step.value = 3; buildProgress.value = 3; publicationOpen.value = false; }
    }
    if (analysisJob.value?.status === "running")
      analysisTimer = setInterval(pollAnalysis, 1200);
  }
});
onUnmounted(() => {
  if (analysisTimer) clearInterval(analysisTimer);
});
</script>

<template>
  <div class="ontology-workbench grid gap-4">
    <section class="ontology-workspace-header">
      <div class="ontology-workspace-heading">
        <div>
          <h3>业务本体工作台</h3>
          <p>构建业务知识，维护实体关系，验证召回效果。</p>
        </div>
        <button class="ontology-rules-button" :class="{ 'is-active': workspaceMode === 'model' }" :aria-pressed="workspaceMode === 'model'" @click="workspaceMode = 'model'">业务知识规则 <span aria-hidden="true">↗</span></button>
      </div>
      <nav class="ontology-mode-navigation" aria-label="业务本体主导航">
        <button class="ontology-mode-button" :class="{ 'is-active': workspaceMode === 'graph' }" :aria-pressed="workspaceMode === 'graph'" :title="`已发布：${publishedGraphCounts.nodes} 个实体、${publishedGraphCounts.edges} 条关系；草稿：${draftGraphCounts.nodes} 个实体、${draftGraphCounts.edges} 条关系`" @click="openGraph()">
          <span class="ontology-mode-icon" aria-hidden="true">◎</span>
          <span class="ontology-mode-copy"><strong>本体图谱</strong><span>实体：已发布 {{ publishedGraphCounts.nodes }} · 草稿 {{ draftGraphCounts.nodes }}</span></span>
          <span class="ontology-mode-arrow" aria-hidden="true">→</span>
        </button>
        <button class="ontology-mode-button" :class="{ 'is-active': workspaceMode === 'workflow' }" :aria-pressed="workspaceMode === 'workflow'" @click="startAiBuild">
          <span class="ontology-mode-icon ontology-mode-icon-ai" aria-hidden="true">AI</span>
          <span class="ontology-mode-copy"><strong>AI 辅助构建</strong><span>{{ analysisBusy ? '任务进行中 · 查看分析与审核' : '从文档识别实体、关系与证据' }}</span></span>
          <span class="ontology-mode-arrow" aria-hidden="true">→</span>
        </button>
        <button class="ontology-mode-button" :class="{ 'is-active': workspaceMode === 'quality' }" :aria-pressed="workspaceMode === 'quality'" @click="openGraphGovernance">
          <span class="ontology-mode-icon" aria-hidden="true">↗</span>
          <span class="ontology-mode-copy"><strong>AI 优化</strong><span>检查图谱问题，完善业务知识</span></span>
          <span class="ontology-mode-arrow" aria-hidden="true">→</span>
        </button>
      </nav>
    </section>

    <section v-if="!hasGraphContent && workspaceMode === 'workflow' && step === 1" class="grid gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 md:grid-cols-[1fr_auto] md:items-center">
      <div>
        <h3 class="font-semibold">从知识库开始创建本体图谱</h3>
        <p class="mt-1 max-w-2xl text-xs leading-5 text-[var(--muted)]">AI 会读取已选文档，自动识别实体、关系和原文证据。你只需要确认结果，不需要先学习本体建模。</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold" @click="startManualBuild">手动创建</button>
        <button class="rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white active:scale-[0.98]" @click="startAiBuild">AI 创建</button>
      </div>
    </section>

    <OntologyModelPanel v-if="workspaceMode === 'model'" :knowledge-base="knowledgeBase" />
    <OntologyGovernancePanel v-if="workspaceMode === 'quality'" :knowledge-base="knowledgeBase" :model="model" @updated="state=$event;draftText=JSON.stringify($event.draft,null,2);refreshPreview()" @back="workspaceMode='graph'" @proceed="workspaceMode='workflow';step=3;publicationOpen=true;buildProgress=3;refreshPreview();loadVersions()" @open-evidence="emit('openEvidence',$event)" />

    <section v-if="workspaceMode === 'graph'" class="grid gap-3">
      <div
        class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-3"
      >
        <div class="grid w-full grid-cols-2 gap-2 text-xs sm:w-auto sm:min-w-80">
          <button
            class="rounded-xl border px-4 py-3 text-left transition active:scale-[0.99]"
            :class="
              graphSource === 'published'
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] shadow-sm'
                : 'border-[var(--border)] bg-[var(--surface-muted)]/45 text-[var(--muted)] hover:bg-[var(--surface-muted)]'
            "
            :aria-pressed="graphSource === 'published'"
            @click="openGraph('published')"
          >
            <span class="block font-semibold">已发布图谱</span>
            <span class="mt-1 block text-[10px] opacity-80">{{ publishedGraphCounts.nodes }} 个实体 · {{ publishedGraphCounts.edges }} 条关系</span>
          </button>
          <button
            class="rounded-xl border px-4 py-3 text-left transition active:scale-[0.99]"
            :class="
              graphSource === 'draft'
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] shadow-sm'
                : 'border-[var(--border)] bg-[var(--surface-muted)]/45 text-[var(--muted)] hover:bg-[var(--surface-muted)]'
            "
            :aria-pressed="graphSource === 'draft'"
            @click="openGraph('draft')"
          >
            <span class="block font-semibold">当前草稿</span>
            <span class="mt-1 block text-[10px] opacity-80">{{ draftGraphCounts.nodes }} 个实体 · {{ draftGraphCounts.edges }} 条关系</span>
          </button>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            class="rounded-lg border border-[var(--border)] px-3 py-2 text-xs"
            @click="openManualEntity"
          >
            ＋ 新增实体</button
          ><button
            class="rounded-lg border border-[var(--border)] px-3 py-2 text-xs"
            @click="openManualRelation"
          >
            ＋ 新增关系</button
          ><button
            class="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white"
            @click="openGraphGovernance"
          >
            AI 优化
          </button>
        </div>
      </div>
      <OntologyGraphView
        :graph="activeGraph"
        :title="
          graphSource === 'published' ? '已发布本体图谱' : '草稿本体图谱'
        "
        editable
        @edit="editGraphItem"
        @open-evidence="emit('openEvidence', $event)"
      />
    </section>

    <nav
      v-show="workspaceMode === 'workflow'"
      class="ontology-build-navigation"
      aria-label="本体构建步骤"
    >
      <div class="ontology-build-caption"><strong>构建流程</strong><span>可返回查看，进度自动保存</span></div>
      <ol class="flex min-w-0 overflow-x-auto">
        <li
          v-for="item in [
            { n: 1, t: '选择资料' },
            { n: 2, t: '分析与审核' },
            { n: 3, t: '检查与发布' },
            { n: 4, t: '召回验证' },
          ]"
          :key="item.n"
          class="min-w-40 flex-1"
          :class="item.n > 1 ? '-ml-2' : ''"
        >
          <button
            class="ontology-build-step w-full disabled:cursor-not-allowed"
            :disabled="!canOpenStep(item.n)"
            :title="canOpenStep(item.n) ? undefined : '请先完成前一步'"
            :aria-current="progressState(item.n) === 'current' ? 'step' : undefined"
            :style="progressShape(item.n)"
            :class="
              progressState(item.n) === 'current'
                ? 'is-current'
                : progressState(item.n) === 'completed'
                  ? 'is-completed'
                  : progressState(item.n) === 'skipped'
                    ? 'is-skipped'
                  : 'is-upcoming'
            "
            @click="openStep(item.n as BuildStep)"
          >
            <span class="ontology-step-number" aria-hidden="true">{{ progressState(item.n) === 'completed' ? '✓' : item.n }}</span>{{ item.t }}<span v-if="progressState(item.n) === 'skipped'" class="ml-1 text-[10px]">已跳过</span>
          </button>
        </li>
      </ol>
    </nav>
    <section
      v-if="workspaceMode === 'workflow' && step === 1"
      class="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
    >
      <div
        class="border-b border-[var(--border)] bg-gradient-to-r from-[var(--accent)]/10 via-[var(--surface)] to-[var(--surface)] px-5 py-5"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex items-start gap-3">
            <span
              class="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--accent)] font-bold text-white"
              >AI</span
            >
            <div>
              <h3 class="font-semibold">从文档智能构建本体</h3>
              <p
                class="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--muted)]"
              >
                应用模型从知识库文档中识别实体、关系和原文证据。分析结果只进入待审核区，不会自动修改正式图谱。
              </p>
            </div>
          </div>
          <span
            class="rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-xs"
            >正式版本 v{{ state?.published?.version || 0 }}</span
          >
        </div>
      </div>
      <div class="grid gap-5 p-5 lg:grid-cols-[1.35fr_1fr]">
        <div>
          <div class="mb-2 flex justify-between">
            <label class="text-xs font-semibold">选择分析文档</label
            ><button
              type="button"
              class="text-xs font-semibold text-[var(--accent)]"
              @click="toggleAllDocuments"
            >
              {{ allDocumentsSelected ? "取消全选" : "全选" }}
            </button>
          </div>
          <div
            v-if="busy"
            class="rounded-xl border border-dashed border-[var(--border)] py-8 text-center text-xs text-[var(--muted)]"
          >
            正在读取知识库文档…
          </div>
          <div
            v-else-if="!documents.length"
            class="rounded-xl border border-dashed border-[var(--border)] py-8 text-center text-xs text-[var(--muted)]"
          >
            知识库中还没有文档，请先上传并写入索引。
          </div>
          <div
            v-else
            class="max-h-52 space-y-2 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/35 p-2"
          >
            <label
              v-for="document in documents"
              :key="document.id"
              class="flex cursor-pointer gap-3 rounded-lg bg-[var(--surface)] px-3 py-2.5"
              ><input
                v-model="selectedDocumentIds"
                :value="document.id"
                type="checkbox"
                class="mt-1"
                :disabled="
                  selectedDocumentIds.length >= 20 &&
                  !selectedDocumentIds.includes(document.id)
                "
              /><span class="min-w-0 flex-1"
                ><strong class="block truncate text-xs">{{
                  document.title
                }}</strong
                ><span class="mt-1 block text-[11px] text-[var(--muted)]"
                  >{{ document.chunkCount }} 个切片 ·
                  {{
                    document.source?.split(".").pop()?.toUpperCase() || "文本"
                  }}
                  · {{ new Date(document.createdAt).toLocaleDateString() }} ·
                  已索引<span v-if="document.source">
                    · {{ document.source }}</span
                  ></span
                ></span
              ></label
            >
          </div>
          <p class="mt-2 text-[11px] text-[var(--muted)]">
            已选择 {{ selectedDocumentIds.length }} /
            {{ documents.length }} 篇；单次最多分析 20 篇、60 个切片。
          </p>
        </div>
        <div class="flex flex-col">
          <div class="flex items-center justify-between gap-3">
            <label class="text-xs font-semibold"
              >提取建议
              <span class="font-normal text-[var(--muted)]">可修改</span></label
            ><button
              type="button"
              class="text-[11px] font-semibold text-[var(--accent)]"
              :disabled="!suggestedInstructions"
              @click="applySuggestedInstructions"
            >
              恢复自动建议
            </button>
          </div>
          <textarea
            v-model="instructions"
            rows="5"
            class="mt-2 min-h-32 flex-1 resize-y rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-3 text-sm"
            placeholder="选择文档后将自动生成提取建议。"
            @input="instructionsCustomized = true"
          />
          <p class="mt-2 text-[11px] leading-5 text-[var(--muted)]">
            建议根据当前所选文档生成。你可以补充行业术语、重点实体类型或不需要提取的内容。
          </p>
          <div class="mt-3 grid grid-cols-2 gap-2">
            <label class="text-xs font-semibold"
              >分析强度<select
                v-model="intensity"
                class="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
              >
                <option value="quick">快速</option>
                <option value="standard">标准（推荐）</option>
                <option value="deep">深入</option>
              </select></label
            >
            <div class="rounded-lg bg-[var(--surface-muted)] p-2 text-xs">
              <strong>抽取模型</strong>
              <p class="mt-1 truncate text-[var(--muted)]">
                {{ model?.provider }} · {{ model?.chatModel }}
              </p>
              <p class="mt-1 text-[var(--muted)]">
                预计约
                {{
                  Math.max(
                    1,
                    Math.ceil(
                      (selectedDocumentIds.length * 3) /
                        (intensity === "deep" ? 3 : 4),
                    ),
                  )
                }}
                批
              </p>
            </div>
          </div>
          <button
            type="button"
            class="mt-3 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-45"
            :disabled="
              analysisBusy ||
              !documents.length ||
              !selectedDocumentIds.length ||
              !model
            "
            @click="analyzeDocuments"
          >
            {{
              analysisBusy ? "正在读取文档并分析…" : "确认建议并开始 AI 构建"
            }}
          </button>
          <button type="button" class="mt-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-xs font-semibold text-[var(--muted)]" @click="startManualBuild">跳过 AI，直接手动创建</button>
          <p v-if="!model" class="mt-2 text-xs text-amber-700">
            尚未配置可用的应用对话模型。
          </p>
        </div>
      </div>
      <div
        v-if="documentOverview.length"
        class="mx-5 mb-5 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/35 p-4"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 class="text-sm font-semibold">所选文档内容说明</h4>
            <p class="mt-1 text-[11px] text-[var(--muted)]">
              开始构建前，先确认系统读取到的文档范围和内容是否正确。
            </p>
          </div>
          <span class="text-xs font-semibold text-[var(--accent)]"
            >{{ documentOverview.length }} 篇</span
          >
        </div>
        <div class="mt-3 grid gap-2 md:grid-cols-2">
          <article
            v-for="item in documentOverview"
            :key="item.id"
            class="rounded-lg bg-[var(--surface)] px-3 py-3"
          >
            <strong class="block truncate text-xs">{{ item.title }}</strong>
            <p
              class="mt-1 line-clamp-3 text-[11px] leading-5 text-[var(--muted)]"
            >
              {{ item.detail }}
            </p>
          </article>
        </div>
      </div>
      <button
        v-if="analysisBusy"
        type="button"
        aria-label="查看 AI 本体识别实时进度"
        class="group mx-5 mb-5 flex w-[calc(100%_-_2.5rem)] items-center gap-3 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 via-indigo-50 to-blue-50 p-4 text-left text-blue-800 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        @click="openRunningAnalysis"
      >
        <span
          class="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold">正在生成本体候选</p>
          <p class="mt-1 text-xs">
            任务仍在后台运行，点击返回实时批次分析界面。
          </p>
        </div>
        <span
          class="shrink-0 rounded-lg border border-blue-200 bg-white/80 px-3 py-2 text-xs font-semibold text-blue-700 transition group-hover:border-blue-300 group-hover:bg-white"
        >
          查看实时进度 →
        </span>
      </button>
      <div
        v-else-if="analysisResult"
        class="mx-5 mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
      >
        ✓ {{ analysisResult }}
      </div>
      <div
        v-else-if="analysisError"
        class="mx-5 mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
      >
        {{ analysisError }}
      </div>
    </section>

    <section
      v-if="workspaceMode === 'workflow' && step === 2 && !reviewManagerOpen"
      class="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
    >
      <div
        class="ontology-analysis-heading"
      >
        <div class="flex min-w-0 items-start gap-3">
          <span
            :class="[
              'grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base font-semibold',
              analysisJob?.status === 'completed'
                ? 'bg-emerald-100 text-emerald-700'
                : analysisJob?.status === 'partial'
                  ? 'bg-amber-100 text-amber-700'
                : 'bg-[var(--accent-soft)] text-[var(--accent)]',
            ]"
            >{{ analysisJob?.status === "completed" ? "✓" : analysisJob?.status === "partial" ? "!" : "AI" }}</span
          >
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="font-semibold">AI 本体识别</h3>
            </div>
            <p class="mt-1 text-xs text-[var(--muted)]">
              后台任务可持续运行，离开当前页面不会中断分析。
            </p>
          </div>
        </div>
        <span
          :class="[
            'shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold',
            analysisJob?.status === 'completed'
              ? 'bg-emerald-100 text-emerald-700'
              : analysisJob?.status === 'partial'
                ? 'bg-amber-100 text-amber-800'
              : analysisJob?.status === 'failed'
                ? 'bg-rose-100 text-rose-700'
                : 'bg-blue-100 text-blue-700',
          ]"
          >{{ analysisStatusLabel }}</span
        >
        <div v-if="analysisJob" class="ontology-analysis-metrics">
          <span class="ontology-analysis-metric">已完成 <strong>{{ analysisJob.completedChunkIds?.length || 0 }}</strong> 切片</span>
          <span class="ontology-analysis-metric is-emphasized">候选 <strong>{{ analysisJob.discovered || analysisJob.result?.generated || 0 }}</strong></span>
          <span class="ontology-analysis-metric">模型 <strong>{{ model?.chatModel || '应用模型' }}</strong></span>
          <span class="ontology-analysis-metric">耗时 <strong>{{ Math.round(((analysisJob.completedAt || Date.now()) - analysisJob.startedAt) / 1000) }}</strong> 秒</span>
          <span v-if="analysisJob.failedBatches" class="ontology-analysis-metric is-warning">待继续 <strong>{{ analysisJob.failedBatches }}</strong> 批</span>
        </div>
      </div>
      <div class="p-6">
        <div
          v-if="analysisJob?.status === 'failed' && analysisError"
          class="mb-5 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800"
        >
          <div class="min-w-0">
            <strong class="text-sm">{{ friendlyAnalysisError.title }}</strong>
            <p class="mt-1 break-words text-xs leading-5">
              {{ friendlyAnalysisError.detail }}
            </p>
            <p class="mt-2 text-[11px]">
              {{ friendlyAnalysisError.suggestion }}
            </p>
          </div>
          <div class="flex shrink-0 gap-2">
            <button type="button" class="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold" @click="step = 1">调整范围</button>
            <button type="button" class="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white" @click="analyzeDocuments">直接重试</button>
          </div>
        </div>
        <div class="flex items-end justify-between gap-3">
          <div>
            <p class="text-xs text-[var(--muted)]">总体进度</p>
            <strong class="mt-1 block text-2xl">{{ analysisPercent }}%</strong>
          </div>
          <p class="text-right text-xs text-[var(--muted)]">
            {{
              analysisJob?.status === "completed"
                ? "所有批次和证据已经处理完成"
                : analysisJob?.status === "partial"
                  ? "已完成结果已保存，可继续剩余内容或先审核"
                : `当前：${analysisJob?.phase || "准备任务"}`
            }}
          </p>
        </div>
        <div class="analysis-progress-track relative mt-3 h-3 overflow-hidden rounded-full bg-slate-100" :class="{ 'is-running': analysisBusy }">
          <div
            class="analysis-progress-fill h-full rounded-full transition-all duration-500"
            :style="{ width: `${analysisPercent}%` }"
          />
        </div>
        <div v-if="analysisJob?.activeBatches?.length" class="mt-4 grid gap-2 md:grid-cols-2">
          <article
            v-for="batch in analysisJob.activeBatches"
            :key="batch.slot"
            :class="[
              'batch-lane overflow-hidden rounded-xl border bg-[var(--surface)]',
              batch.state === 'running' ? 'border-blue-200 shadow-[0_8px_24px_rgba(37,99,235,.08)]' : batch.state === 'completed' ? 'border-emerald-200' : 'border-amber-200',
            ]"
          >
            <div class="flex items-start justify-between gap-3 px-3.5 py-3">
              <div class="flex min-w-0 items-start gap-2.5">
                <span :class="['grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[10px] font-bold', batch.state === 'running' ? 'bg-blue-600 text-white' : batch.state === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800']">{{ batch.slot }}</span>
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <strong class="text-xs">处理通道 {{ batch.slot }}</strong>
                    <span class="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--muted)]">第 {{ batch.batchNumber }} 批</span>
                    <span class="text-[9px] text-[var(--muted)]">{{ batch.chunkCount }} 个切片</span>
                  </div>
                  <p class="mt-1 truncate text-[10px] text-[var(--muted)]">{{ batch.documentTitles.join('、') }}</p>
                </div>
              </div>
              <span :class="['shrink-0 text-[10px] font-semibold', batch.state === 'running' ? 'text-blue-700' : batch.state === 'completed' ? 'text-emerald-700' : 'text-amber-800']">{{ batch.phase }}</span>
            </div>
            <div class="mx-3.5 mb-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div :class="['batch-lane-fill h-full rounded-full', `is-${batch.state}`]" />
            </div>
            <div class="flex items-center justify-between border-t border-[var(--border)]/70 px-3.5 py-2 text-[9px] text-[var(--muted)]">
              <span>{{ batch.state === 'running' ? '正在抽取实体、关系与原文证据' : batch.state === 'completed' ? `已保存 ${batch.candidates || 0} 个候选` : (batch.failure?.message || '可稍后单独继续，不影响其他结果') }}</span>
              <span>{{ Math.max(0, Math.round(((batch.completedAt || Date.now()) - batch.startedAt) / 1000)) }} 秒</span>
            </div>
            <div v-if="batch.state === 'running'" class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-3.5 py-2.5">
              <span class="text-[10px] text-[var(--muted)]">跳过后继续下一批，此内容可稍后补充</span>
              <button type="button" class="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-800 disabled:opacity-40" :disabled="skippingBatches.has(batch.batchNumber) || stoppingForReview || analysisJob?.stopRequested" @click="skipAnalysisBatch(batch.batchNumber)">{{ skippingBatches.has(batch.batchNumber) ? '正在中止…' : batch.chunkCount === 1 ? '跳过此切片' : `跳过本批 ${batch.chunkCount} 个切片` }}</button>
            </div>
          </article>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
          <div
            v-for="(label, index) in [
              '读取文档',
              '整理分析批次',
              'AI 识别',
              '证据核验',
              '候选归并',
            ]"
            :key="label"
            :class="[
              'relative rounded-lg border px-2.5 py-2',
              phaseState(label) === '已完成'
                ? 'border-emerald-200 bg-emerald-50'
                : phaseState(label) === '等待中'
                  ? 'border-[var(--border)] bg-[var(--surface-muted)]/40'
                  : 'border-blue-300 bg-blue-50',
            ]"
          >
            <div class="flex items-center gap-1.5">
              <span
                :class="[
                  'grid h-4 w-4 place-items-center rounded-full text-[8px] font-bold',
                  phaseState(label) === '已完成'
                    ? 'bg-emerald-600 text-white'
                    : phaseState(label) === '等待中'
                      ? 'bg-slate-200 text-slate-500'
                      : 'bg-blue-600 text-white',
                ]"
                >{{ phaseState(label) === "已完成" ? "✓" : index + 1 }}</span
              ><strong class="truncate text-[10px]">{{ label }}</strong>
            </div>
            <p class="mt-1 pl-5 text-[9px] text-[var(--muted)]">
              {{ phaseState(label) }}
            </p>
          </div>
        </div>
        <div
          v-if="analysisJob?.status === 'partial'"
          class="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4"
        >
          <div class="max-w-2xl">
            <strong class="text-sm text-amber-900">{{ analysisJob.stopRequested ? '分析已停止，已有结果已保存' : (analysisJob.result?.analyzedChunks || 0) > 0 ? "部分内容已完成" : "本次尚无完成的切片" }}</strong>
            <p class="mt-1 text-xs leading-5 text-amber-800">
              共 {{ (analysisJob.result?.analyzedChunks || 0) + (analysisJob.result?.failedChunkIds.length || 0) }} 个切片；已完成 {{ analysisJob.result?.analyzedChunks || 0 }} 个，另有 {{ analysisJob.result?.failedChunkIds.length || 0 }} 个尚未分析。原因：{{ analysisFailureSummary }}。文档、索引和批次检查点均已保存，继续处理时只会提交未完成切片。
            </p>
          </div>
          <div class="flex shrink-0 flex-wrap gap-2">
            <button
              v-if="(analysisJob.result?.generated || 0) > 0"
              type="button"
              class="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 active:scale-[0.98]"
              @click="reviewAvailableCandidates"
            >
              先审核本次新增的 {{ analysisJob.result?.generated || 0 }} 条
            </button>
            <button
              type="button"
              class="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white active:scale-[0.98]"
              @click="retryRemainingAnalysis"
            >
              继续未完成的 {{ analysisJob.result?.failedChunkIds.length || 0 }} 个切片
            </button>
          </div>
        </div>
        <div
          v-if="analysisJob?.status === 'completed'"
          class="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4"
        >
          <div>
            <strong class="text-sm text-emerald-800"
              >识别与证据核验已完成</strong
            >
            <p class="mt-1 text-xs text-emerald-700">
              {{
                analysisResult ||
                `共生成 ${analysisJob.result?.generated || 0} 条候选，下一步请进行人工审核。`
              }}
            </p>
          </div>
          <button
            class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
            @click="reviewAvailableCandidates"
          >
            审核本次新增的 {{ analysisJob.result?.generated || 0 }} 条
          </button>
        </div>
        <div
          v-if="analysisJob?.status !== 'completed' && analysisJob?.status !== 'partial'"
          class="mt-5 flex flex-wrap justify-end gap-2"
        >
          <button
            v-if="analysisBusy && (analysisJob?.discovered || 0) > 0"
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.98]"
            @click="reviewAvailableCandidates"
          >
            先审核已生成候选
          </button>
          <button v-if="analysisBusy" class="rounded-lg border px-4 py-2 text-sm" @click="step = 1">
            后台运行</button
          ><button
            v-if="analysisBusy"
            class="rounded-lg border border-rose-300 px-4 py-2 text-sm text-rose-600"
            :disabled="stoppingForReview || analysisJob?.stopRequested"
            @click="stopAnalysisAndCheck"
          >
            {{ stoppingForReview || analysisJob?.stopRequested ? '正在停止并保存结果…' : '停止分析，检查已有结果' }}
          </button>
        </div>
        <p v-if="analysisBusy" class="mt-3 text-right text-xs text-[var(--muted)]">停止后保留已完成结果；已跳过和未处理的切片可以稍后继续。</p>
        <p v-if="analysisControlError" role="alert" class="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{{ analysisControlError }}</p>
      </div>
    </section>

    <dialog ref="reviewDialog" class="ontology-review-dialog" aria-label="审核已生成候选" @cancel="reviewSaveError = ''">
      <div class="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] p-4">
        <div><h3 class="font-semibold">审核已生成候选</h3><p class="mt-1 text-xs text-[var(--muted)]">{{ analysisBusy ? '后台继续分析，关闭弹窗即可返回实时进度。' : '分析结果已保存，关闭弹窗返回任务详情。' }} 接受后加入草稿，不会自动发布。</p></div>
        <button class="rounded-lg border px-4 py-2 text-sm" @click="reviewDialog?.close()">{{ step === 3 ? '返回检查' : '返回分析' }}</button>
      </div>
      <div class="p-4 text-sm">本次打开固定审核 {{ scopedCandidates.length }} 条候选；{{ analysisBusy ? '新生成的候选下次打开时显示。' : '接受并加入草稿后，即可检查和发布。' }}</div>
      <label class="mx-4 mb-4 block text-xs">审核范围
        <select v-model="reviewChunkId" :disabled="reviewSaving" class="ml-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 disabled:opacity-40" @change="modalCandidate = null">
          <option value="">本次已生成的全部候选</option>
          <option v-for="(id, index) in reviewChunks" :key="id" :value="id">已完成片段 {{ index + 1 }} · {{ scopedCandidates.filter(item => item.evidence.some(evidence => evidence.chunkId === id)).length }} 条候选</option>
        </select>
      </label>
      <OntologyGraphView v-if="candidateGraph.nodes.length" :graph="candidateGraph" title="候选与草稿上下文" compact @open-evidence="emit('openEvidence', $event)" />
      <div class="grid gap-3 p-4 md:grid-cols-2">
        <article v-for="item in modalReviewCandidates" :key="item.id" class="rounded-xl border border-[var(--border)] p-4">
          <h4 class="font-semibold">{{ candidateTitle(item) }}</h4>
          <button v-if="item.status === 'pending' || item.status === 'accepted' || item.status === 'deferred'" :disabled="reviewSaving" class="mt-2 rounded-lg border px-3 py-1 text-xs disabled:opacity-40" @click="modalCandidate = JSON.parse(JSON.stringify(item))">编辑内容</button>
          <p class="mt-1 text-xs text-[var(--muted)]">{{ candidateMeta(item) }}</p>
          <blockquote class="my-3 border-l-2 border-[var(--accent)] pl-3 text-xs">{{ item.evidence[0]?.quote }}</blockquote>
          <div v-if="item.status === 'pending' || item.status === 'deferred'" class="flex justify-end gap-2">
            <button :disabled="reviewSaving" class="rounded-lg border px-3 py-2 text-xs disabled:opacity-40" @click="review(item.id, 'rejected')">不采用</button>
            <button :disabled="reviewSaving" class="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs text-white disabled:opacity-40" @click="review(item.id, 'accepted')">接受</button>
          </div>
          <p v-else class="text-xs text-[var(--muted)]">{{ item.status === 'accepted' ? '已接受，待加入草稿' : item.status === 'staged' ? '已加入草稿' : item.status === 'rejected' ? '已拒绝' : '已处理' }}</p>
        </article>
        <p v-if="!scopedCandidates.length" class="text-sm text-[var(--muted)]">暂无可审核候选。旧任务如未记录候选归属，请在候选管理中明确选择，系统不会自动混入历史结果。</p>
      </div>
      <div class="sticky bottom-0 border-t border-[var(--border)] bg-[var(--surface)] p-4">
        <div v-if="modalCandidate" class="mb-4 rounded-xl border border-[var(--border)] p-3">
          <label v-if="modalCandidate.node" class="block text-xs">实体名称<input v-model="modalCandidate.node.name" class="mt-1 w-full rounded-lg border bg-[var(--surface)] p-2" /></label>
          <template v-if="modalCandidate.edge">
            <label class="block text-xs">起点实体<select v-model="modalCandidate.edge.subjectId" class="m-1 rounded-lg border bg-[var(--surface)] p-2"><option v-for="node in candidateGraph.nodes" :key="String(node.id)" :value="String(node.id)">{{ node.name }}</option></select></label>
            <label class="block text-xs">关系名称<input v-model="modalCandidate.edge.predicate" class="m-1 rounded-lg border bg-[var(--surface)] p-2" /></label>
            <label class="block text-xs">终点实体<select v-model="modalCandidate.edge.objectId" class="m-1 rounded-lg border bg-[var(--surface)] p-2"><option v-for="node in candidateGraph.nodes" :key="String(node.id)" :value="String(node.id)">{{ node.name }}</option></select></label>
          </template>
          <div class="mt-2 flex justify-end gap-2"><button class="rounded-lg border px-3 py-2 text-xs" @click="modalCandidate = null">取消编辑</button><button :disabled="reviewSaving" class="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs text-white" @click="saveModalCandidate">保存修改</button></div>
        </div>
        <p v-if="reviewSaveError" role="alert" class="mb-3 text-sm text-rose-600">{{ reviewSaveError }}</p>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="text-xs text-[var(--muted)]" aria-live="polite">
            <p>待审核 {{ modalReviewCandidates.filter(item => item.status === 'pending').length }} · 已接受 {{ modalReviewCandidates.filter(item => item.status === 'accepted').length }} · 已拒绝 {{ modalReviewCandidates.filter(item => item.status === 'rejected').length }}</p>
            <p class="mt-1 text-[11px]">{{ modalCandidate ? '请先保存或取消当前编辑，再批量操作。' : '仅操作当前范围内尚未入草稿的候选。' }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" :disabled="reviewSaving || !!modalCandidate || !modalAcceptIds.length" class="rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2.5 text-xs font-semibold text-[var(--accent)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40" @click="reviewAllInModal('accepted')">{{ modalBulkDecision === 'accepted' ? '正在全部接受…' : `全部接受（${modalAcceptIds.length}）` }}</button>
            <button type="button" :disabled="reviewSaving || !!modalCandidate || !modalRejectIds.length" class="rounded-lg border border-rose-200 px-3 py-2.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40" @click="reviewAllInModal('rejected')">{{ modalBulkDecision === 'rejected' ? '正在全部拒绝…' : `全部拒绝（${modalRejectIds.length}）` }}</button>
            <button :disabled="reviewSaving || !!modalCandidate || !modalReviewCandidates.some(item => item.status === 'accepted')" class="rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-40" @click="saveReviewedToDraft">{{ reviewSaving && !modalBulkDecision ? '正在保存…' : step === 3 ? '加入草稿并返回检查' : '加入草稿并返回分析' }}</button>
          </div>
        </div>
      </div>
    </dialog>

    <div v-if="workspaceMode === 'workflow' && step === 2" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div class="text-xs text-[var(--muted)]">{{ analysisBusy ? '后台继续分析；已审核结果可先加入草稿，后续结果另行处理。' : '候选经审核加入草稿后，即可检查并发布。' }}</div>
      <div class="flex flex-wrap gap-2">
        <button v-if="analysisJob" class="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold" @click="reviewManagerOpen ? reviewManagerOpen=false : showAllCandidates()">{{ reviewManagerOpen ? '返回实时分析' : '管理全部候选' }}</button>
        <button :disabled="!canOpenStep(3)" class="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40" @click="openStep(3)">检查并发布草稿</button>
      </div>
    </div>

    <section
      v-if="workspaceMode === 'workflow' && step === 2 && reviewManagerOpen"
      class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"
    >
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="font-semibold">候选审核</h3>
          <p class="mt-1 text-xs text-[var(--muted)]">
            核对识别结果和原文证据，接受后加入草稿，再单独检查和发布。
          </p>
        </div>
        <div class="flex gap-2 text-xs">
          <span class="rounded-full bg-amber-100 px-2.5 py-1 text-amber-700"
            >待审核 {{ pending.length }}</span
          ><span
            class="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700"
            >已接受 {{ accepted.length }}</span
          ><span class="rounded-full bg-slate-100 px-2.5 py-1"
            >已拒绝 {{ rejected.length }}</span
          >
        </div>
      </div>
      <div
        v-if="candidateScopeIds"
        class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-900"
      >
        <div>
          <strong class="text-sm">当前仅审核本次新增的 {{ scopedCandidates.length }} 条候选</strong>
          <p class="mt-1 text-xs text-blue-700">
            其余 {{ historicalCandidateCount }} 条历史候选未包含在本次批量操作中；仍有 {{ analysisJob?.result?.failedChunkIds.length || 0 }} 个切片尚未完成，稍后可以继续分析。
          </p>
        </div>
        <button class="rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-semibold text-blue-800" @click="showAllCandidates">
          查看全部历史候选
        </button>
      </div>
      <div v-if="candidateGraph.nodes.length" class="mb-4">
        <OntologyGraphView :graph="candidateGraph" title="AI 识别候选关系图" compact editable @edit="editGraphItem" @open-evidence="emit('openEvidence', $event)" />
        <p class="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">图中显示现有草稿与{{ candidateScopeIds ? '本次新增候选' : '全部候选' }}。点击节点或连线即可查看和编辑，下方只需确认是否采用。</p>
      </div>
      <div
        v-if="pending.length"
        class="mb-4 flex flex-wrap items-center justify-end gap-2"
      >
        <span class="mr-auto text-[11px] text-[var(--muted)]"
          >批量操作会影响当前 {{ pending.length }} 条待审核候选</span
        ><button
          class="rounded-lg border border-rose-200 px-3 py-2 text-xs text-rose-600"
          @click="bulkDecision = 'rejected'"
        >
          批量拒绝</button
        ><button
          class="rounded-lg border border-emerald-300 px-3 py-2 text-xs text-emerald-700"
          @click="bulkDecision = 'accepted'"
        >
          批量接受
        </button>
      </div>
      <div v-if="busy" class="py-10 text-center text-sm text-[var(--muted)]">
        正在读取本体状态…
      </div>
      <div
        v-else-if="!pending.length"
        class="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-muted)]/35 py-12 text-center"
      >
        <p class="text-sm font-semibold">暂无待审核候选</p>
        <p class="mt-1 text-xs text-[var(--muted)]">
          从上方选择文档并开始 AI 识别。
        </p>
      </div>
      <div v-else class="grid gap-3 md:grid-cols-2">
        <article
          v-for="item in pending"
          :key="item.id"
          class="rounded-xl border border-[var(--border)] p-4"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <span
                class="rounded-md bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] text-[var(--accent)]"
                >{{ item.kind === "node" ? "实体" : "关系" }}</span
              ><strong class="mt-1 block text-sm">{{
                candidateTitle(item)
              }}</strong>
              <p class="mt-1 text-xs text-[var(--muted)]">
                {{ candidateMeta(item) }}
              </p>
            </div>
            <span
              :class="[
                'shrink-0 rounded-full px-2 py-1 text-[11px]',
                item.confidence < 0.7
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-[var(--surface-muted)]',
              ]"
              >{{ Math.round(item.confidence * 100) }}%</span
            >
          </div>
          <blockquote
            class="mt-3 rounded-lg border-l-2 border-[var(--accent)] bg-[var(--surface-muted)]/55 px-3 py-2 text-xs text-[var(--muted)]"
          >
            <span class="line-clamp-4">{{ item.evidence[0]?.quote }}</span>
            <footer class="mt-2 truncate text-[10px] opacity-70">
              {{ item.evidence[0]?.source || item.evidence[0]?.documentId }} ·
              {{ item.evidence[0]?.chunkId }}
            </footer>
          </blockquote>
          <div class="mt-3 flex justify-end gap-2">
            <button
              class="rounded-lg border px-3 py-1.5 text-xs"
              @click="openCandidate(item)"
            >
              编辑</button
            ><button
              class="rounded-lg border px-3 py-1.5 text-xs"
              @click="deferCandidate(item.id)"
            >
              暂缓</button
            ><button
              class="rounded-lg border border-rose-300 px-3 py-1.5 text-xs text-rose-600"
              @click="review(item.id, 'rejected')"
            >
              拒绝</button
            ><button
              class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white"
              @click="review(item.id, 'accepted')"
            >
              接受
            </button>
          </div>
        </article>
      </div>
      <div class="mt-4 flex flex-wrap items-center justify-between gap-2">
        <button class="rounded-lg border px-3 py-2 text-xs" @click="addEntity">
          ＋ 新增实体</button
        ><button
          class="rounded-lg border px-3 py-2 text-xs"
          @click="addRelation"
        >
          ＋ 新增关系</button
        ><span v-if="duplicateGroups.length" class="text-xs text-amber-700"
          >发现 {{ duplicateGroups.length }} 组疑似重复</span
        ><button
          class="rounded-xl bg-[var(--accent)] px-5 py-3 text-sm text-white"
          @click="proceedToReview"
        >
          保存已接受项，检查草稿
        </button>
      </div>
    </section>

    <div v-if="workspaceMode === 'workflow' && step === 3" class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div><h3 class="text-sm font-semibold">检查与发布</h3><p class="mt-1 text-xs text-[var(--muted)]">{{ analysisBusy ? '分析仍在后台运行，本次仅发布当前草稿，后续候选留待下次处理。' : '先处理草稿中的问题，确认发布后再验证召回效果。' }}</p></div>
        <div class="flex gap-2 text-xs font-semibold">
          <button class="rounded-lg border px-3 py-2" :class="!publicationOpen ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]' : 'border-[var(--border)]'" @click="publicationOpen=false;qualitySkipped=false">质量检查</button>
          <button class="rounded-lg border px-3 py-2 disabled:opacity-40" :class="publicationOpen ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]' : 'border-[var(--border)]'" :disabled="!hasDraftContent || !preview || preview.validation.blockers.length > 0" @click="publicationOpen=true;loadVersions()">发布确认</button>
        </div>
      </div>
    </div>

    <div v-if="workspaceMode === 'workflow' && step === 3 && hasDraftContent && unstagedTaskCandidates.length" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900">
      <div><strong class="text-sm">本次还有 {{ unstagedTaskCandidates.length }} 条候选尚未加入草稿</strong><p class="mt-1 text-xs">可以先审核并加入草稿；若直接发布，当前版本只包含已入草稿的内容。</p></div>
      <button class="rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-semibold" @click="reviewAvailableCandidates">审核已有候选</button>
    </div>

    <section v-if="workspaceMode === 'workflow' && step === 3 && !hasDraftContent" class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 class="font-semibold">{{ (state?.candidates.length || 0) > 0 ? '先把审核结果加入草稿' : '暂时没有可检查的草稿' }}</h3>
      <p class="mt-2 text-sm leading-6 text-[var(--muted)]">{{ (state?.candidates.length || 0) > 0 ? '分析已停止，已生成候选和完成记录均已保存。请先审核并将接受的内容加入草稿，再检查与发布。' : '已完成内容和未处理范围均已保留。你可以返回继续分析、调整资料，或手动创建实体关系。' }}</p>
      <div class="mt-4 flex flex-wrap gap-2"><button v-if="(analysisJob?.candidateIds?.length || analysisJob?.result?.candidateIds?.length || 0) > 0" class="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" @click="reviewAvailableCandidates">审核已生成候选</button><button class="rounded-lg border border-[var(--border)] px-4 py-2 text-sm" @click="step=2;showAllCandidates()">管理候选 / 手动补充</button><button class="rounded-lg border border-[var(--border)] px-4 py-2 text-sm" @click="step=2;reviewManagerOpen=false">返回分析</button></div>
    </section>

    <template v-if="workspaceMode === 'workflow' && step === 3 && !publicationOpen && hasDraftContent">
      <div v-if="preview?.validation.blockers.length" class="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
        <strong class="text-sm">当前草稿有 {{ preview.validation.blockers.length }} 个阻断问题</strong>
        <ul class="mt-2 list-inside list-disc space-y-1 text-xs"><li v-for="message in preview.validation.blockers" :key="message">{{ message }}</li></ul>
        <div class="mt-3 flex flex-wrap items-center justify-between gap-2"><p class="text-xs">图谱结构问题可在下方处理；涉及属性、实体类型和关系规则的问题，可查看业务知识规则。</p><button class="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold" @click="workspaceMode='model'">查看业务知识规则</button></div>
      </div>
      <div v-if="canSkipQuality" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800">
        <div><strong class="text-sm">当前草稿检查通过</strong><p class="mt-1 text-xs">可以继续查看检查详情，也可以直接确认发布。</p></div>
        <button class="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white" @click="skipQualityCheck">跳过详细检查，确认发布</button>
      </div>
      <OntologyGovernancePanel
        :knowledge-base="knowledgeBase"
        :model="model"
        @updated="state = $event;draftText = JSON.stringify($event.draft,null,2);refreshPreview()"
        @back="step = 2;reviewManagerOpen = !analysisJob"
        @open-evidence="emit('openEvidence', $event)"
        @proceed="publicationOpen = true;buildProgress = 3;refreshPreview();loadVersions()"
      />
    </template>

    <section
      v-if="workspaceMode === 'workflow' && step === 3 && publicationOpen && hasDraftContent"
      class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="font-semibold">确认发布当前草稿</h3>
          <p class="mt-1 text-xs text-[var(--muted)]">
            发布会影响数字员工的默认知识检索，仅管理员可以执行；发布人由当前登录身份自动记录。
          </p>
        </div>
        <span
          :class="[
            'rounded-full px-3 py-1.5 text-xs font-semibold',
            isAdmin
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-amber-100 text-amber-700',
          ]"
          >{{ isAdmin ? "管理员审批" : "等待管理员" }}</span
        >
      </div>
      <div v-if="preview" class="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/45 p-4">
        <div class="flex flex-wrap items-center justify-between gap-2"><strong class="text-sm">本次发布变更</strong><span :class="['rounded-full px-2.5 py-1 text-[11px] font-semibold', preview.validation.blockers.length ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700']">{{ preview.validation.blockers.length ? `${preview.validation.blockers.length} 个阻断问题` : '校验通过' }}</span></div>
        <div class="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6"><div class="rounded-lg bg-emerald-50 p-2 text-emerald-700"><strong class="block text-lg">{{ preview.summary.addedNodes }}</strong>新增实体</div><div class="rounded-lg bg-blue-50 p-2 text-blue-700"><strong class="block text-lg">{{ preview.summary.modifiedNodes }}</strong>修改实体</div><div class="rounded-lg bg-rose-50 p-2 text-rose-700"><strong class="block text-lg">{{ preview.summary.deletedNodes }}</strong>删除实体</div><div class="rounded-lg bg-emerald-50 p-2 text-emerald-700"><strong class="block text-lg">{{ preview.summary.addedEdges }}</strong>新增关系</div><div class="rounded-lg bg-blue-50 p-2 text-blue-700"><strong class="block text-lg">{{ preview.summary.modifiedEdges }}</strong>修改关系</div><div class="rounded-lg bg-rose-50 p-2 text-rose-700"><strong class="block text-lg">{{ preview.summary.deletedEdges }}</strong>删除关系</div></div>
        <div v-if="preview.validation.blockers.length" class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700"><span>当前草稿仍有阻断问题，请返回质量检查处理。</span><button class="rounded-lg border border-rose-300 bg-white px-3 py-1.5 font-semibold" @click="publicationOpen=false">返回质量检查</button></div>
      </div>
      <p v-if="qualitySkipped" class="mt-3 text-xs text-[var(--muted)]">已跳过检查详情；发布时仍会自动校验当前草稿。</p>
      <label class="mt-4 block text-xs font-semibold"
        >版本说明<textarea
          v-model="publishNote"
          class="mt-1 h-24 w-full rounded-xl border p-3 font-normal"
          placeholder="说明本次本体变更、影响范围和验证结果"
        />
      </label>
      <div class="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900">
        <strong class="text-sm">本次仅发布当前草稿：{{ state?.draft.nodes.length || 0 }} 个实体、{{ state?.draft.edges.length || 0 }} 条关系</strong>
        <p class="mt-1 text-xs leading-5">已接受但未加入草稿的候选不包含在本次版本中。{{ analysisBusy ? '分析仍在后台进行，后续候选需要另行审核、入草稿并发布。' : analysisJob ? `最近任务已完成 ${analysisJob.completedChunkIds?.length || analysisJob.result?.analyzedChunks || 0} 个切片，${analysisJob.failedChunkIds?.length || analysisJob.result?.failedChunkIds.length || 0} 个待继续；未完成内容可稍后补充。` : '发布后，数字员工将使用这一正式版本进行本体增强召回。' }}</p>
      </div>
      <p v-if="publicationError" role="alert" class="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{{ publicationError }}</p>
      <div class="mt-4 flex items-center justify-between gap-3">
        <p class="text-xs text-[var(--muted)]">
          {{
            isAdmin
              ? "发布后会生成一条只读历史记录。"
              : "你仍可整理草稿和完成治理，管理员登录后即可审批发布。"
          }}
        </p>
        <button
          class="rounded-xl bg-[var(--accent)] px-5 py-3 text-sm text-white disabled:cursor-not-allowed disabled:opacity-45"
          :disabled="!isAdmin || !preview || preview.validation.blockers.length > 0 || publicationBusy"
          @click="publishVersion"
        >
          {{ publicationBusy ? '正在校验并发布…' : '校验并发布版本' }}
        </button>
      </div>
      <div class="mt-6 border-t pt-4">
        <div><h4 class="text-sm font-semibold">历史版本</h4><p class="mt-1 text-[11px] text-[var(--muted)]">暂时仅用于查看发布记录，不提供回滚操作。</p></div>
        <div class="mt-2 space-y-2">
          <div
            v-for="version in versions"
            :key="version.version"
            class="flex items-center justify-between rounded-xl bg-[var(--surface-muted)] p-3 text-xs"
          >
            <div>
              <strong>v{{ version.version }}</strong
              ><span class="ml-2 text-[var(--muted)]"
                >{{ version.note || "无版本说明" }} ·
                {{ version.publisher || "历史发布人" }} ·
                {{ new Date(version.publishedAt).toLocaleString() }}</span
              >
            </div>
            <span class="shrink-0 text-[11px] text-[var(--muted)]">只读记录</span>
          </div>
        </div>
      </div>
    </section>

    <div
      v-if="selectedCandidate"
      class="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
    >
      <div
        class="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-[var(--surface)] p-5 shadow-2xl"
      >
        <div class="flex items-start justify-between">
          <div>
            <h3 class="font-semibold">
              编辑{{ selectedCandidate.kind === "node" ? "实体" : "关系" }}候选
            </h3>
            <p class="mt-1 text-xs text-[var(--muted)]">
              修改结构化信息，原始证据保持只读并随候选保存。
            </p>
          </div>
          <button
            class="text-sm text-[var(--muted)]"
            @click="selectedCandidate = null"
          >
            关闭
          </button>
        </div>
        <div
          v-if="selectedCandidate.kind === 'node'"
          class="mt-4 grid gap-3 sm:grid-cols-2"
        >
          <label class="text-xs font-semibold"
            >实体名称<input
              v-model="selectedCandidate.node!.name"
              class="mt-1 w-full rounded-lg border p-2 font-normal" /></label
          ><label class="text-xs font-semibold"
            >实体类型<input
              v-model="selectedCandidate.node!.type"
              class="mt-1 w-full rounded-lg border p-2 font-normal"
              placeholder="如：产品、组织、流程" /></label
          ><label class="text-xs font-semibold sm:col-span-2"
            >别名（逗号或换行分隔）<textarea
              class="mt-1 h-20 w-full rounded-lg border p-2 font-normal"
              :value="selectedCandidate.node!.aliases?.join('，')"
              @input="
                setCandidateAliases(
                  ($event.target as HTMLTextAreaElement).value,
                )
              "
            />
          </label>
        </div>
        <div v-else class="mt-4 grid gap-3 sm:grid-cols-2">
          <label class="text-xs font-semibold sm:col-span-2"
            >关系名称<input
              v-model="selectedCandidate.edge!.predicate"
              class="mt-1 w-full rounded-lg border p-2 font-normal" /></label
          ><label class="text-xs font-semibold"
            >主体实体<select
              v-model="selectedCandidate.edge!.subjectId"
              class="mt-1 w-full rounded-lg border p-2 font-normal"
            >
              <option
                v-for="node in nodeOptions"
                :key="String(node.id)"
                :value="String(node.id)"
              >
                {{ node.name }} · {{ node.type }}
              </option>
            </select></label
          ><label class="text-xs font-semibold"
            >客体实体<select
              v-model="selectedCandidate.edge!.objectId"
              class="mt-1 w-full rounded-lg border p-2 font-normal"
            >
              <option
                v-for="node in nodeOptions"
                :key="String(node.id)"
                :value="String(node.id)"
              >
                {{ node.name }} · {{ node.type }}
              </option>
            </select></label
          >
        </div>
        <details class="mt-3 rounded-xl border border-[var(--border)] p-3">
          <summary class="cursor-pointer text-xs font-semibold">高级属性（一般无需修改）</summary>
          <label class="mt-3 block text-xs font-semibold">扩展属性<textarea v-model="candidatePropertiesText" class="mt-1 h-28 w-full rounded-lg border p-2 font-mono text-[11px] font-normal" /></label>
        </details>
        <div
          class="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/50 p-3"
        >
          <strong class="text-xs">原始证据</strong>
          <blockquote class="mt-2 text-xs leading-5 text-[var(--muted)]">
            {{ selectedCandidate.evidence[0]?.quote }}
          </blockquote>
          <p class="mt-2 text-[10px] text-[var(--muted)]">
            {{
              selectedCandidate.evidence[0]?.source ||
              selectedCandidate.evidence[0]?.documentId
            }}
            · {{ selectedCandidate.evidence[0]?.chunkId || "文档级证据" }}
          </p>
        </div>
        <label class="mt-3 block text-xs font-semibold"
          >审核备注<textarea
            v-model="selectedCandidate.reviewNote"
            class="mt-1 h-16 w-full rounded-lg border p-2 font-normal"
          />
        </label>
        <div class="mt-4 flex justify-between">
          <button
            class="text-sm text-rose-600"
            @click="removeCandidate(selectedCandidate.id)"
          >
            删除候选
          </button>
          <div class="flex gap-2">
            <button
              class="rounded-lg border px-3 py-2 text-sm"
              @click="selectedCandidate = null"
            >
              取消</button
            ><button
              class="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-white"
              @click="saveCandidate"
            >
              保存修改
            </button>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="bulkDecision"
      class="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
    >
      <div
        class="w-full max-w-md rounded-2xl bg-[var(--surface)] p-5 shadow-2xl"
      >
        <div
          :class="[
            'grid h-10 w-10 place-items-center rounded-xl text-lg',
            bulkDecision === 'accepted'
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-rose-100 text-rose-700',
          ]"
        >
          {{ bulkDecision === "accepted" ? "✓" : "×" }}
        </div>
        <h3 class="mt-3 font-semibold">
          确认{{ bulkDecision === "accepted" ? "批量接受" : "批量拒绝" }}
          {{ pending.length }} 条候选？
        </h3>
        <p class="mt-2 text-xs leading-5 text-[var(--muted)]">
          {{
            bulkDecision === "accepted"
              ? "接受后候选会进入图谱审核，但发布前仍会执行阻断校验。"
              : "拒绝后候选不会进入本次草稿，可在状态记录中保留审核结果。"
          }}
        </p>
        <p
          v-if="bulkDecision === 'accepted' && bulkLowConfidence"
          class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"
        >
          其中 {{ bulkLowConfidence }} 条置信度低于 70%，建议先逐条核对证据。
        </p>
        <div class="mt-5 flex justify-end gap-2">
          <button
            class="rounded-lg border px-4 py-2 text-sm"
            @click="bulkDecision = null"
          >
            取消</button
          ><button
            :class="[
              'rounded-lg px-4 py-2 text-sm font-semibold text-white',
              bulkDecision === 'accepted' ? 'bg-emerald-600' : 'bg-rose-600',
            ]"
            @click="confirmBulkReview"
          >
            确认执行
          </button>
        </div>
      </div>
    </div>

    <section
      v-if="workspaceMode === 'workflow' && step === 4 && state?.published"
      class="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
    >
      <div
        class="border-b border-[var(--border)] bg-gradient-to-r from-emerald-500/10 via-[var(--surface)] to-[var(--surface)] px-5 py-5"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="flex items-center gap-2">
              <span
                class="grid h-8 w-8 place-items-center rounded-xl bg-emerald-600 text-sm font-bold text-white"
                >⌕</span
              >
              <h3 class="font-semibold">召回验证</h3>
            </div>
            <p
              class="mt-2 max-w-3xl text-xs leading-relaxed text-[var(--muted)]"
            >
              输入真实业务问题，查看命中的实体、关联路径和原文证据，检验已发布本体的召回效果。
            </p>
          </div>
          <span
            :class="[
              'rounded-full px-3 py-1.5 text-xs font-semibold',
              state?.published
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700',
            ]"
            >{{
              state?.published
                ? `正式版本 v${state.published.version}`
                : "尚未发布本体"
            }}</span
          >
        </div>
      </div>
      <div class="p-5">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800"><span>当前验证正式版本 v{{ state.published.version }}；后续新增草稿不会影响此版本。</span><button class="rounded-lg border border-emerald-300 bg-white px-3 py-2 font-semibold" @click="publicationOpen=true;openStep(3)">查看发布记录</button></div>
        <form
          class="flex flex-col gap-3 sm:flex-row"
          @submit.prevent="verifyRetrieval"
        >
          <label class="min-w-0 flex-1"
            ><span class="sr-only">验证问题</span
            ><input
              v-model="verificationQuery"
              class="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10"
              placeholder="例如：A 公司负责哪个项目？退款没有到账应该走什么流程？" /></label
          ><button
            type="submit"
            class="rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-45"
            :disabled="verificationBusy || verificationQuery.trim().length < 2"
          >
            {{ verificationBusy ? "正在规划并召回…" : "开始验证" }}
          </button>
        </form>
        <div
          v-if="verificationBusy"
          class="mt-4 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-800"
        >
          <span
            class="h-5 w-5 animate-spin rounded-full border-2 border-current border-r-transparent"
          />
          <div>
            <p class="text-sm font-semibold">正在执行双路召回</p>
            <p class="mt-1 text-xs">
              先解析实体和一跳关系，同时保留原始向量检索作为召回保底。
            </p>
          </div>
        </div>
        <div
          v-else-if="verificationError"
          class="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          <strong>验证未完成</strong>
          <p class="mt-1 break-words text-xs leading-relaxed">
            {{ verificationError }}
          </p>
          <p v-if="verificationPlan" class="mt-2 text-xs">
            本体查询规划已成功，失败发生在知识片段召回阶段。
          </p>
        </div>
        <div
          v-if="verificationPlan && !verificationBusy"
          class="mt-5 grid gap-4"
        >
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="rounded-xl bg-[var(--surface-muted)] px-4 py-3">
              <p class="text-[11px] font-semibold text-[var(--muted)]">
                检索策略
              </p>
              <p
                :class="[
                  'mt-1 text-sm font-bold',
                  verificationResult?.strategy === 'ontology-enhanced'
                    ? 'text-emerald-700'
                    : 'text-slate-700',
                ]"
              >
                {{
                  !verificationResult
                    ? "仅完成本体规划"
                    : verificationResult.strategy === "ontology-enhanced"
                      ? "本体增强召回"
                      : "普通向量召回"
                }}
              </p>
            </div>
            <div class="rounded-xl bg-[var(--surface-muted)] px-4 py-3">
              <p class="text-[11px] font-semibold text-[var(--muted)]">
                实体与关系
              </p>
              <p class="mt-1 text-sm font-bold">
                {{ verificationPlan.matchedNodes.length }} 个命中 ·
                {{ verificationPlan.relatedNodes.length }} 个关联 ·
                {{ verificationPlan.edges.length }} 条关系
              </p>
            </div>
            <div class="rounded-xl bg-[var(--surface-muted)] px-4 py-3">
              <p class="text-[11px] font-semibold text-[var(--muted)]">
                召回结果
              </p>
              <p class="mt-1 text-sm font-bold">
                {{
                  verificationResult
                    ? `${verificationResult.results.length} 个知识片段`
                    : "尚未完成"
                }}
              </p>
            </div>
          </div>
          <div
            v-if="!verificationPlan.matchedNodes.length"
            class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
          >
            <strong>本次未命中正式本体</strong>
            <p class="mt-1 text-xs">
              系统已自动退化为原始向量检索。请检查实体是否已审核提交、别名是否覆盖当前问法。
            </p>
          </div>
          <div v-else class="grid gap-4 lg:grid-cols-2">
            <div class="rounded-xl border border-[var(--border)] p-4">
              <h4 class="text-sm font-semibold">命中与扩展</h4>
              <div class="mt-3 flex flex-wrap gap-2">
                <span
                  v-for="node in verificationPlan.matchedNodes"
                  :key="node.id"
                  class="rounded-lg bg-emerald-100 px-2.5 py-1.5 text-xs text-emerald-800"
                  ><strong>{{ node.name }}</strong
                  ><span class="ml-1 opacity-70"
                    >{{ Math.round(node.score * 100) }}%</span
                  ></span
                ><span
                  v-for="node in verificationPlan.relatedNodes"
                  :key="node.id"
                  class="rounded-lg bg-blue-100 px-2.5 py-1.5 text-xs text-blue-800"
                  >关联：{{ node.name }}</span
                >
              </div>
              <div v-if="verificationPlan.expandedTerms.length" class="mt-4">
                <p class="text-[11px] font-semibold text-[var(--muted)]">
                  查询扩展词
                </p>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  <code
                    v-for="term in verificationPlan.expandedTerms"
                    :key="term"
                    class="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-[11px]"
                    >{{ term }}</code
                  >
                </div>
              </div>
              <div
                v-if="verificationPlan.paths.length"
                class="mt-4 border-t border-[var(--border)] pt-3"
              >
                <p class="text-[11px] font-semibold text-[var(--muted)]">
                  逻辑查询路径（最多两跳）
                </p>
                <div class="mt-2 space-y-1.5">
                  <div
                    v-for="(path, index) in verificationPlan.paths"
                    :key="`${path.edgeIds.join('-')}-${index}`"
                    class="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800"
                  >
                    <span
                      class="mr-2 rounded bg-white/80 px-1.5 py-0.5 text-[10px]"
                      >{{ path.depth }} 跳</span
                    >{{ pathLabel(path) }}
                  </div>
                </div>
              </div>
            </div>
            <div class="rounded-xl border border-[var(--border)] p-4">
              <h4 class="text-sm font-semibold">关系与过滤信号</h4>
              <ul v-if="verificationPlan.edges.length" class="mt-3 space-y-2">
                <li
                  v-for="edge in verificationPlan.edges"
                  :key="edge.id"
                  class="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs"
                >
                  <strong>{{ nodeName(edge.subjectId) }}</strong
                  ><span class="mx-2 text-[var(--accent)]">{{
                    edge.predicate
                  }}</span
                  ><strong>{{ nodeName(edge.objectId) }}</strong>
                </li>
              </ul>
              <p v-else class="mt-3 text-xs text-[var(--muted)]">
                没有匹配到一至二跳关系。
              </p>
              <div
                v-if="verificationPlan.evidenceRefs.length"
                class="mt-3 border-t border-[var(--border)] pt-3 text-xs"
              >
                <p class="text-[11px] font-semibold text-[var(--muted)]">
                  图谱证据定位
                </p>
                <p class="mt-1">
                  {{ verificationPlan.evidenceRefs.length }}
                  条实体/关系证据将参与定向召回
                </p>
              </div>
              <dl
                v-if="Object.keys(verificationPlan.filters).length"
                class="mt-3 grid gap-1.5 border-t border-[var(--border)] pt-3 text-xs"
              >
                <div
                  v-for="(value, key) in verificationPlan.filters"
                  :key="key"
                  class="flex justify-between gap-3"
                >
                  <dt class="text-[var(--muted)]">{{ key }}</dt>
                  <dd class="break-all text-right font-medium">{{ value }}</dd>
                </div>
              </dl>
            </div>
          </div>
          <div
            v-if="verificationResult"
            class="rounded-xl border border-[var(--border)]"
          >
            <div
              class="flex items-center justify-between border-b border-[var(--border)] px-4 py-3"
            >
              <h4 class="text-sm font-semibold">最终召回片段</h4>
              <span class="text-[11px] text-[var(--muted)]"
                >已融合原始向量、本体扩展与图谱证据</span
              >
            </div>
            <div
              v-if="verificationResult.results.length"
              class="divide-y divide-[var(--border)]"
            >
              <article
                v-for="hit in verificationResult.results"
                :key="hit.id"
                class="px-4 py-3"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <strong class="block truncate text-sm">{{
                      hit.title
                    }}</strong>
                    <p
                      v-if="hit.source"
                      class="mt-0.5 truncate text-[10px] text-[var(--muted)]"
                    >
                      {{ hit.source }}
                    </p>
                    <div
                      v-if="hit.retrievalRoutes?.length"
                      class="mt-1.5 flex flex-wrap gap-1"
                    >
                      <span
                        v-for="route in hit.retrievalRoutes"
                        :key="route"
                        :class="[
                          'rounded px-1.5 py-0.5 text-[10px] font-medium',
                          route === 'ontology-evidence'
                            ? 'bg-emerald-100 text-emerald-700'
                            : route === 'ontology-vector'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-slate-100 text-slate-600',
                        ]"
                        >{{ retrievalRouteLabel(route) }}</span
                      >
                    </div>
                  </div>
                  <span
                    class="shrink-0 rounded-full bg-[var(--accent)]/10 px-2 py-1 text-[11px] font-semibold text-[var(--accent)]"
                    >{{ hit.retrieval ? `排序分 ${hit.score.toFixed(3)}` : `${(hit.score * 100).toFixed(1)}%` }}</span
                  >
                </div>
                <p
                  class="mt-2 line-clamp-4 text-xs leading-relaxed text-[var(--muted)]"
                >
                  {{ hit.content }}
                </p>
                <details v-if="hit.context" class="mt-2 text-xs text-[var(--muted)]">
                  <summary class="cursor-pointer font-semibold">查看上下文</summary>
                  <pre class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--surface-muted)] p-3 leading-relaxed">{{ hit.context.content }}</pre>
                </details>
              </article>
            </div>
            <div
              v-else
              class="px-4 py-10 text-center text-sm text-[var(--muted)]"
            >
              没有召回知识片段。请确认文档已经完成向量索引。
            </div>
          </div>
        </div>
      </div>
    </section>

    <section
      v-if="workspaceMode === 'workflow' && step === 2 && reviewManagerOpen"
      class="rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
    >
      <button
        type="button"
        class="flex w-full items-center justify-between px-5 py-4 text-left"
        @click="advancedOpen = !advancedOpen"
      >
        <span
          ><strong class="text-sm">高级本体编排</strong
          ><span class="ml-2 text-xs font-normal text-[var(--muted)]"
            >候选整理阶段的结构化 JSON 导入与草稿维护</span
          ></span
        ><span>{{ advancedOpen ? "收起" : "展开" }}</span>
      </button>
      <div
        v-if="advancedOpen"
        class="grid gap-4 border-t border-[var(--border)] p-5 xl:grid-cols-2"
      >
        <div>
          <h3 class="mb-2 font-semibold">本体草稿 JSON</h3>
          <textarea
            v-model="draftText"
            class="h-72 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 font-mono text-xs"
          />
          <div class="mt-3 flex justify-end gap-2">
            <button
              class="rounded-lg border px-3 py-2 text-sm"
              @click="saveDraft"
            >
              保存草稿
            </button>
          </div>
        </div>
        <div>
          <h3 class="mb-2 font-semibold">候选 JSON 导入</h3>
          <textarea
            v-model="candidateText"
            class="h-72 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 font-mono text-xs"
          />
          <div class="mt-3 flex justify-end">
            <button
              class="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-white"
              @click="importCandidates"
            >
              导入候选
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ontology-workbench { min-width: 0; grid-template-columns: minmax(0, 1fr); }
.ontology-workbench > * { min-width: 0; }
.ontology-workspace-header {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
}
.ontology-workspace-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px 12px;
}
.ontology-workspace-heading h3 { font-size: 15px; font-weight: 700; letter-spacing: -.02em; }
.ontology-workspace-heading > div { min-width: 0; }
.ontology-workspace-heading p { margin-top: 4px; font-size: 12px; line-height: 1.6; color: var(--muted); }
.ontology-rules-button {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  transition: background 160ms, border-color 160ms, color 160ms;
}
.ontology-rules-button:hover, .ontology-rules-button.is-active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.ontology-mode-navigation { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; padding: 0 20px 16px; }
.ontology-mode-button {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  min-height: 74px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  text-align: left;
  color: var(--text);
  transition: background 180ms, border-color 180ms, box-shadow 180ms, transform 180ms;
}
.ontology-mode-button:hover { border-color: var(--accent); background: var(--accent-soft); transform: translateY(-1px); box-shadow: 0 3px 10px color-mix(in srgb, var(--accent) 10%, transparent); }
.ontology-mode-button:active { transform: translateY(0); }
.ontology-mode-button.is-active { border-color: var(--accent); background: var(--accent); color: var(--surface); box-shadow: 0 3px 10px color-mix(in srgb, var(--accent) 20%, transparent); }
.ontology-mode-button:focus-visible, .ontology-rules-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.ontology-mode-icon { display: grid; width: 36px; height: 36px; flex-shrink: 0; place-items: center; border-radius: 10px; background: var(--accent-soft); color: var(--accent); font-size: 21px; font-weight: 600; }
.ontology-mode-icon-ai { font-size: 13px; letter-spacing: -.03em; }
.ontology-mode-button.is-active .ontology-mode-icon { background: color-mix(in srgb, var(--surface) 16%, transparent); color: inherit; }
.ontology-mode-copy { display: block; min-width: 0; flex: 1; }
.ontology-mode-copy strong { display: block; font-size: 14px; font-weight: 700; }
.ontology-mode-copy > span { display: block; margin-top: 4px; font-size: 11px; line-height: 1.5; color: var(--muted); }
.ontology-mode-button.is-active .ontology-mode-copy > span { color: inherit; opacity: .85; }
.ontology-mode-arrow { flex-shrink: 0; color: var(--muted); opacity: .6; transition: transform 180ms, opacity 180ms; }
.ontology-mode-button.is-active .ontology-mode-arrow { color: inherit; opacity: 1; }
.ontology-mode-button:hover .ontology-mode-arrow { transform: translateX(2px); opacity: 1; }
.ontology-build-navigation { padding: 14px 16px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); }
.ontology-build-caption { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; font-size: 11px; color: var(--muted); }
.ontology-build-caption strong { font-size: 12px; color: var(--text); }
.ontology-build-step { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 8px 20px; font-size: 12px; font-weight: 600; transition: filter 160ms; }
.ontology-build-step.is-current { background: var(--accent); color: var(--surface); }
.ontology-build-step.is-completed { background: color-mix(in srgb, var(--accent) 11%, var(--surface)); color: var(--accent); }
.ontology-build-step.is-upcoming, .ontology-build-step.is-skipped { background: var(--surface-muted); color: var(--muted); }
.ontology-build-step:hover:not(:disabled) { filter: brightness(.96); }
.ontology-step-number { display: inline-grid; width: 21px; height: 21px; flex-shrink: 0; place-items: center; border: 1px solid currentColor; border-radius: 50%; font-size: 10px; }
.ontology-build-step.is-current .ontology-step-number { border-color: transparent; background: color-mix(in srgb, var(--surface) 18%, transparent); }
.ontology-analysis-heading { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 20px 24px 16px; border-bottom: 1px solid var(--border); background: var(--surface); }
.ontology-analysis-heading > div:first-child { flex: 1; min-width: 180px; }
.ontology-analysis-metrics { display: flex; flex-basis: 100%; flex-wrap: wrap; gap: 7px; padding-left: 52px; }
.ontology-analysis-metric { display: inline-flex; align-items: center; gap: 5px; padding: 5px 9px; border-radius: 7px; background: var(--surface-muted); font-size: 11px; line-height: 1.5; color: var(--muted); }
.ontology-analysis-metric strong { font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text); }
.ontology-analysis-metric.is-emphasized { background: var(--accent-soft); color: var(--accent); }
.ontology-analysis-metric.is-emphasized strong { color: inherit; }
.ontology-analysis-metric.is-warning { background: #fffbeb; color: #92400e; }
.ontology-analysis-metric.is-warning strong { color: inherit; }
@media (max-width: 760px) {
  .ontology-mode-navigation { gap: 8px; padding: 0 14px 14px; }
  .ontology-mode-button { gap: 8px; padding: 12px; }
  .ontology-mode-icon { width: 30px; height: 30px; }
  .ontology-mode-arrow { display: none; }
  .ontology-mode-copy strong { font-size: 13px; }
}
@media (max-width: 600px) {
  .ontology-workspace-heading { align-items: flex-start; padding: 14px; gap: 10px; }
  .ontology-workspace-heading p { max-width: 28ch; font-size: 11px; }
  .ontology-rules-button { padding: 7px 9px; font-size: 11px; }
  .ontology-mode-navigation { grid-template-columns: minmax(0, 1fr); }
  .ontology-mode-button { min-height: 62px; }
  .ontology-mode-arrow { display: block; }
  .ontology-mode-copy strong { font-size: 14px; }
  .ontology-analysis-heading { padding: 16px; }
  .ontology-analysis-metrics { padding-left: 0; }
  .ontology-build-caption > span { font-size: 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .ontology-mode-button, .ontology-mode-arrow, .ontology-rules-button { transition: none; }
  .ontology-mode-button:hover, .ontology-mode-button:active, .ontology-mode-button:hover .ontology-mode-arrow { transform: none; }
}
.analysis-progress-fill {
  position: relative;
  background: linear-gradient(90deg, #4f46e5 0%, #2563eb 42%, #06b6d4 72%, #22c55e 100%);
  background-size: 180% 100%;
}
.analysis-progress-fill::after {
  position: absolute;
  inset: 0;
  content: "";
  background: linear-gradient(110deg, transparent 20%, rgb(255 255 255 / 55%) 42%, transparent 64%);
  transform: translateX(-100%);
}
.analysis-progress-track.is-running .analysis-progress-fill {
  animation: ontology-flow 2.4s linear infinite;
}
.analysis-progress-track.is-running .analysis-progress-fill::after {
  animation: ontology-shine 1.6s ease-in-out infinite;
}
.batch-lane-fill.is-running {
  width: 42%;
  background: linear-gradient(90deg, #2563eb, #22d3ee, #6366f1);
  box-shadow: 0 0 12px rgb(37 99 235 / 32%);
  animation: batch-lane-scan 1.8s cubic-bezier(.4, 0, .2, 1) infinite alternate;
}
.batch-lane-fill.is-completed {
  width: 100%;
  background: linear-gradient(90deg, #10b981, #22c55e);
}
.batch-lane-fill.is-failed {
  width: 100%;
  background: repeating-linear-gradient(135deg, #f59e0b 0 7px, #fcd34d 7px 14px);
}
.batch-lane-fill.is-skipped { width: 100%; background: #cbd5e1; }
@keyframes ontology-flow {
  to { background-position: -180% 0; }
}
@keyframes ontology-shine {
  60%, 100% { transform: translateX(130%); }
}
@keyframes batch-lane-scan {
  from { transform: translateX(-8%); }
  to { transform: translateX(138%); }
}
@media (prefers-reduced-motion: reduce) {
  .analysis-progress-track.is-running .analysis-progress-fill,
  .analysis-progress-track.is-running .analysis-progress-fill::after,
  .batch-lane-fill.is-running { animation: none; }
}
</style>

<style scoped>
.ontology-review-dialog { width: min(1120px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); margin: auto; padding: 0; border: 1px solid var(--border); border-radius: 20px; background: var(--surface); color: var(--text); overflow: auto; box-shadow: 0 24px 80px #0f172a33; }
.ontology-review-dialog::backdrop { background: #0f172a66; backdrop-filter: blur(3px); }
</style>
