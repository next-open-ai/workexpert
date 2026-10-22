# Wiki 契约规格

WK-M19 → WK-T19 → WK-M19-T：[已有主题合并预览](incremental-merge.md)。保守章节追加、双方版本校验、仅保存更新草稿；实际状态见 status。

2026-10-21 WK-R18 → WK-T18 → WK-R18-T：[显式断点续跑](resumable-generation.md)替代下文“候选仅内存/不能续跑”的历史限制。旧任务仍只能重新生成，新任务按私有检查点恢复；不自动调用模型，实际验证见 status。

WK-D17 → WK-T17 → WK-D17-T：[生成阶段与显式重新生成](generation-diagnostics.md)。阶段由服务端持久化；重新生成需二次确认，不是断点续算。状态见 status。

## WK-T11：简明交互（0.12，2026-10-18）

仅改变renderer展示及测试/手册，不改变API、排序、开关默认值、存储或权限。列表与详情“知识库设置”复用原编辑表单；原只读高级设置改名“技术信息”。开关只说明已开启，不推断已有本体/已发布Wiki；实际本体命中只依据结果retrievalRoutes，不能单凭strategy声称命中。默认隐藏排序分/召回路径，原始数值在原生details内保留，不表示准确率。查询空闲/加载/无命中/失败分开，输入变更或切库清除旧状态，沿用请求序号防竞态；保存配置使当前结果失效。无迁移，回滚UI不改数据。

## WK-T10：可选融合召回（0.11，2026-10-18）

Wiki 通道使用原始查询的前256字符，单次最多召回20页；不对本体扩展查询重复调用。原文通道保持自身查询限制。

WK-14：本地知识库wikiRetrievalEnabled布尔值，缺省false，与ontologyEnabled独立。保存/客户端只设置开关；wikiAccess为服务端根据已验证主体和服务端根目录重新构造的运行期字段，不接受用户配置授权。HTTP搜索及数字员工kb_search复用相同检索实现。

原文候选保持现有双路RRF/本体增强，再与最多20条Wiki标题/别名/全文候选做外层等权RRF(k=60)。每次检索Wiki只查询一次原问题；无Wiki命中不改原文分数；同分原文先，同类ID稳定排序。派生页与原文块以不同身份保留，不冒充独立证据。Wiki结果带wiki字段（pageId、revisionId、有限原文引用及截断标记），不带原文evidence/context。每次返回前检查当前发布指针、freshness和来源授权，草稿/过期/归档/删除不可召回。最多8条引用供追溯，完整引用在Wiki页面查看。

开关关闭不访问Wiki存储，不影响独立浏览/搜索；缺失Wiki表或从未生成返回空候选；启用却缺可信上下文、损坏/不可读明确失败，不声称完整融合成功。原文通道错误仍按原行为处理，不以Wiki掩盖故障。关闭后现有界面候选仅在重新检索后更新。无schema迁移，新增字段向后兼容；回滚关开关/撤销代码即可。

任务WK-T10涉及contracts、catalog可信配置、agent-core、renderer设置/结果、手册与回归。WK-R04验收开关及关闭零Wiki访问、Wiki别名命中而原文无匹配、页面/原文身份区分、草稿隔离、来源删除/版本变化、幂等排名、按库/用户隔离、kb_search与HTTP一致；WK-U07验收设置保存/重载、检索来源标签与打开页面。状态见status，不新增权限界面。

0.10 WK-T06d：复用 list/read/publish，无新 HTTP、权限、schema 或模型调用。客户端批量只是顺序提交独立发布请求，服务端仍唯一维护发布真相；每页核对选择时 generation/draftRevisionId，使用原 contentHash/幂等键。分页游标循环或失败整体中止收集；发布部分成功不回滚。不承诺目录跨页快照，确认后新增页留待下次操作；不后台重试。回滚仅移除批量入口，保留既有发布数据。

0.9 WK-T06c 的“打开 Wiki”与页面章节树复用现有 list/read/sources/related 契约，无新增 HTTP 或持久化字段；具体交互、按需加载和回滚见 [ui](ui.md)。

## WK-T04c：生成反馈优化（0.8）

关联 WK-03/08/09/12；测试 WK-G01c/G02c/A07/U04。仅优化现有生成链路，不增加权限、模型调用、表或配置。模型回复允许纯 JSON 或一个完整的 json/无语言代码围栏；不从混杂说明中猜取 JSON，不修补截断输出、不跳过引用或覆盖校验。

contracts 定义 WikiGenerationFailure 与错误码白名单：MODEL_TIMEOUT、MODEL_UNAVAILABLE、MODEL_OUTPUT_TRUNCATED、INVALID_MODEL_OUTPUT、INVALID_MODEL_REFERENCE、INVALID_MODEL_LINK、INCOMPLETE_COVERAGE、INVALID_EVIDENCE、SOURCE_CHANGED。agent-core 抛出类型化错误，orchestrator 只持久化白名单码；未知异常仍为 GENERATION_FAILED，用户取消优先 CANCELLED。既有 errorCode 字符串字段兼容，不保存供应商错误正文、密钥、模型原文或 Zod 详情。模型输出长度截断不能当作完整 JSON 使用。

界面在 failed/partial 任务下显示固定中文原因和下一步建议，未知旧码使用通用提示，不直接回显错误码或外部消息。处理建议只引导检查配置、缩小资料、换模型或重新入库，再由用户显式发起；刷新/重放旧任务不触发新调用。沿用已保存草稿保留规则。回滚可撤去新提示/解码兼容，已保存数据无需迁移。

验证：严格围栏解码、混杂/损坏/超长拒绝；错误分类及取消优先、无敏感正文持久化；API 失败原因可读取；本地 HTTP 模型桩经真实 Pi 产生截断结果，浏览器展示原因且无草稿/自动重试，随后显式新生成可成功。

0.7 [有界分批](batching.md) 替代单批输入限制；0.5 小批量生成、0.6 编辑与版本对照的其他实际边界见 [closure](closure.md)，优先于下文尚未实现的大批量任务目标。T06b 复用现有 HTTP/Zod，不改变保存/发布契约或 SQLite schema。

状态：实施中；规格版本：0.2；更新日期：2026-10-16。关联：[架构](architecture.md)、[测试](test-spec.md)。页面、修订、草稿保存、发布、搜索结果、相关页面及作用域 Zod 已在 contracts/knowledge-wiki.ts 导出；HTTP 与任务 DTO 尚未接线。

## WK-T02 仓储契约细化

- 本地证据的真实 provider 为 `lancedb`，不是新造的 `local`；`sourceKind=local-evidence` 仅说明来源类型。
- WikiRevision 将可编辑字段组合在 `content: WikiContent` 中，contentHash 对排序键后的完整 content 做 SHA-256（含证据与链接），供审阅发布 CAS；不会只比较正文而忽略证据变动。
- 首期 excerptHash 校验完整原文块内容，具体原文范围仍由 KnowledgeEvidence.sourceLocation 定位；不伪称逐句语义支持验证。每节至少一个来源，章节区间覆盖正文，允许节间空白、拒绝重叠/重复/UTF-16 字符截断。
- `KnowledgeEvidenceStore.openWiki(scope, authorizeSource)` 显式初始化，授权检查器必须同步返回严格 true，异常默认拒绝。宿主负责认证和对原文归档的实时授权；检查器只做权限/引用元数据检查，原文件字节预检在写事务外进行。
- 仓储提供 saveDraft/publish/read/archive/list/search/related/rebuildSearch，返回不可变修订和 freshness；list 使用内部 afterPageId 稳定游标，HTTP 绑定 scope/query 的游标、历史列表与恢复动作归 WK-T05，尚未实现。
- 仓储 idempotencyKey 作用域为主体+知识库+动作；同摘要返回原结果，不重复审计。保存/发布重放仍先核验来源；幂等结果只保存页面元信息，不缓存可绕过授权的正文。

## 数据契约

### WK-T09a：知识库归属（0.4）

后续采用 ADR-0008，具体配置/指派 API、旧桌面兼容与执行边界契约见 [ownership](ownership.md)。以下 WK-T05a 为原个人 Wiki 阶段说明；当前增加知识库 owner 校验，库内个人 namespace/来源上传者限制尚待 WK-T09b 兼容后移除，不把仅增加守卫当作已完成库内继承。

### WK-T05a：个人 Wiki HTTP 接线（0.3）

依据 ADR-0007，管理主体是 Wiki 页面 owner（认证 userId），不是尚未定义的知识库 owner；管理员无跨用户特权。服务端从 knowledge-bases.json 的 meta/旧数组读取本地已启用配置，只接受知识库 ID；WikiScope 永远由认证身份构造。GET 不创建数据库、不升级 v4，未启用库返回空列表/搜索或页面 404。每次请求核对本人归档引用，丢失来源时正文、目录、搜索及互链均不返回内容。

本步接线 GET pages、page、search、related 和 PUT draft、POST publish/archive。列表暂为 limit（1～50）+afterPageId 的稳定键集分页，返回 nextAfterPageId；搜索暂为有界 TopK（不接受 cursor），不假装已完成签名游标。revisionId 可读授权历史，但历史列表/恢复接口仍待后续。未知参数拒绝，body 最大 1 MiB。编辑只更新现有页面，authorType 由服务端固定 human；初始页面留给生成任务创建。

WK-A02 验收：真实 Fastify 与临时 SQLite/文件归档，认证主体注入仅作测试；验证跨主体/管理员隔离、v4 GET 不迁移、未知参数/路径注入、搜索/互链、发布幂等、冲突、来源变化及删除后的全路径不可见。不代替完整真实登录或模型生成验收。

所有 DTO 使用 schemaVersion=1、服务端生成的不透明 ID、UTC 时间。org/user 由认证上下文注入，不接受请求体覆盖。Markdown 长度按 UTF-8 字节限制；证据位置保持现有 UTF-16 半开区间语义，不宣称 PDF 页码。

| 类型 | 必填及重要字段 |
| --- | --- |
| WikiPage | pageId、knowledgeBaseId、slug、generation、publishedRevisionId/null、draftRevisionId/null、archivedAt/null |
| WikiRevision | revisionId、pageId、title、aliases[]、summary、bodyMarkdown、sections[]、evidenceRefs[]、links[]、contentHash、authorType(human/model)、createdBy/At |
| WikiSection | sectionId、headingPath[]、start、end；必须位于对应修订正文内 |
| WikiEvidenceRef | refId、sectionId、sourceKind=local-evidence、evidence（versioned KnowledgeEvidence）、excerptHash；版本/批次/块及主体必须验证，不接受 legacy-unverified |
| WikiLink | targetPageId、sourceSectionId、label；服务端校验同库与目标可见性 |
| WikiSearchHit | pageId、revisionId、title、snippet、matchKinds[]、rank、freshness；不伪造 chunkId 或向量分数 |
| WikiRelatedPage | pageId、revisionId、title、seedPageId、direction(in/out)；不是 direct hit |
| WikiJob | jobId、state、phase、selectedDocuments、totalChunks、processedChunks、failedChunks、skippedChunks、pageDraftIds[]、budget、usage、error/null |
| WikiMutation | baseGeneration、idempotencyKey；发布另含 draftRevisionId 与已审阅 contentHash |

title 1～200 字符，aliases 最多 50 个且单项 200 字符，query 最多 256 字符，页面正文最大 256 KiB，单次生成最多 100 文档/10,000 块，超限明确拒绝并提示分批。请求正文上限与 Fastify 一致配置，不能先无限读入再校验。分页 limit 默认 20、最大 50，排序稳定，cursor 绑定 scope 与查询摘要，失效返回 CURSOR_INVALID。

## 拟议 HTTP 接口

统一前缀 `/api/knowledge/:knowledgeBaseId/wiki`，实施时由既有路由注册约定确定前缀挂载，不改变原文接口。所有错误为 `{error:{code,message,retryable,requestId}}`。

| 方法/相对路径 | 输入 | 输出与语义 |
| --- | --- | --- |
| GET /pages | category?、cursor?、limit? | 已发布可访问页目录；草稿管理用显式 view=drafts 且检查写权限 |
| GET /pages/:pageId | revisionId? | 当前页或授权历史，含 freshness/issues；不可用证据不返回隐藏正文 |
| GET /search | query、limit?、cursor? | hits[]、nextCursor；空 query 返回空 hits，目录由 /pages 获取 |
| GET /pages/:pageId/related | direction=out/in/both、limit? | related[]，最大 10，不传 depth>1 |
| GET /pages/:pageId/revisions | cursor?、limit? | 授权修订元信息；历史正文仍单独授权 |
| POST /generation-jobs | documentIds[]、modelRef、budget、idempotencyKey | 202 + job；先预检，不自动发布 |
| GET /generation-jobs/:jobId | 无 | 阶段、覆盖率、预算、草稿及失败项，不返回密钥/全文 prompt |
| POST /generation-jobs/:jobId/cancel | idempotencyKey | 请求取消；完成前仍可能在途，不伪报已取消 |
| POST /generation-jobs/:jobId/resume | idempotencyKey | 明确恢复中断任务；输入变化则 409，需新任务 |
| PUT /pages/:pageId/draft | WikiMutation + 可编辑正文/标题/引用/链接 | 新不可变草稿修订；CAS 冲突不覆盖 |
| POST /pages/:pageId/publish | WikiMutation + draftRevisionId/contentHash | 事务发布；证据过期或草稿问题返回 409/422 |
| POST /pages/:pageId/archive | WikiMutation | 撤出目录/FTS，保留修订；不删除原文件 |
| POST /pages/:pageId/restore | WikiMutation + historicalRevisionId | 复制历史形成新草稿，重新校验证据，绝不直接回拨指针 |

首次页面由生成候选创建，首期不提供无来源空白页面创建；人工可编辑生成草稿但不能绕过来源检查。原文定位复用现有受保护证据/原文接口，不返回本地磁盘路径。

## 幂等、错误与权限

同作用域、动作和 idempotencyKey 对应同一请求摘要；重复请求返回已记录结果，不重复生成/发布。不同摘要复用 key 返回 IDEMPOTENCY_CONFLICT。页面更新检查 generation，生成提交还检查捕获的来源头；调用方重试不能规避 CAS。

| HTTP | code | 处理 |
| --- | --- | --- |
| 400 | INVALID_INPUT / CURSOR_INVALID | 修正输入，不重试模型 |
| 401 | UNAUTHENTICATED | 登录 |
| 404 | NOT_FOUND | 统一不存在/越权，不暴露标题/存在性 |
| 409 | REVISION_CONFLICT / SOURCE_CHANGED / IDEMPOTENCY_CONFLICT | 保留草稿，刷新或新建任务，禁止自动覆盖 |
| 413 | LIMIT_EXCEEDED | 缩小文档范围/正文 |
| 422 | INVALID_EVIDENCE / DRAFT_ISSUES / MODEL_NOT_CONFIGURED | 明确问题，不发布 |
| 429 | CAPACITY_EXCEEDED / BUDGET_EXCEEDED | 排队或用户调整预算，不无限重试 |
| 503 | INDEX_UNAVAILABLE / STORAGE_UNAVAILABLE / MODEL_UNAVAILABLE | 限定重试；索引故障不得伪装“无结果” |

目标为知识库 owner 管理权（ADR-0008），库内内容继承，继续验证证据版本、删除与同库归属；过渡期仍保留原个人存储限制，详见 ownership。不存在“管理员即可读取任意原文”的隐式后门；错误不回显敏感原文。
# WK-T14：短引用与独立阅读（2026-10-19）

WK-R14：模型传输使用批次内 source_1 等短编号，响应通过精确映射还原真实 chunkId 后继续原有证据/覆盖/链接校验；未知编号拒绝，不模糊匹配、不自动付费重试。页面关联仍限本次其他页面 key，允许空数组。

WK-R15：独立阅读页面为当前用户授权读取的已发布页面只读快照；仅取 freshness=current，最多200页/总正文4百万字符，超限明确报错不静默截断。分页重复游标失败。首页、正文、链接使用本地锚点，不包含凭证、脚本或外部资源；目标不在快照内标注不可用。应用内使用 sandbox iframe，外部浏览器使用临时HTML文件（桌面）或新浏览器标签（Web）。临时快照不是实时授权入口，原文更新不自动同步；退出应用清理本次临时文件，用户自行保存的副本由用户管理。未发布草稿不导出。无数据库迁移，回滚代码即可。

WK-R14-T：短编号映射、未知/冒充真实编号拒绝和原证据不变；WK-R15-T：HTML转义/本地互链/容量边界、浏览器阅读入口和既有Wiki回归。桌面OS浏览器启动需另行实测；不以mock代替实机声明。
# WK-T16：可关闭的一跳关联扩展（2026-10-19）

wikiRelatedExpansionEnabled 为可选 boolean，缺省/旧配置 false；仅本地库且 wikiRetrievalEnabled=true 时生效。UI 位于 Wiki 融合配置下，主开关关闭时禁用关联开关但保留其保存值。API/员工使用服务端保存配置。仅统一召回扩展，不改变独立 Wiki 搜索或浏览。

直接命中前3页为种子，每页最多检查5个出链，最多新增3页，仅一跳。关联候选必须已发布、来源current；与原问题的规范化英文词/中文双字词至少25%重合才保留，不作语义相关性保证。去重后按重合度排序，最相关的1页放在首个直接命中之后，其余最多2页放在前3个直接命中之后（避免小topK时扩展永远无法进入结果），受原limit及外层RRF/topK约束；无直接命中不扩展。每页240字符摘要及最多8条来源沿用现有预算；不调用模型、无额外向量索引。返回WikiRecall.expansion={seedPageId,depth:1}便于溯源。最后有效性检查保持。

WK-X01验证默认关闭/主开关关闭、配置保存及服务端权威；WK-X02验证一跳、去重、相关性、3页预算、草稿/失效排除、限额与来源映射；WK-X03以真实SQLite/归档验证直接Top20外关联页进入最终Top5，关闭后排除，来源更新后失效。无DB迁移，关闭即恢复原行为，回滚保留页面。参数为保守起点，未证明业务准确率提升。
