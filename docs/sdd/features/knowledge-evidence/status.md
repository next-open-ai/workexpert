# 当前状态

## KE-T04g：重复计算消除（2026-10-18）

- 已实现：Embedding单次调用内去重后还原原顺序及独立向量数组；召回证据按最多256个ID批量查询、组内每个批次只解析一次。无跨请求缓存、不改分块/排名/权限，不增加并发。storage增加getEvidenceMany，原getEvidence兼容，最终可见性和摘要校验保留。
- `pnpm --filter @workexpert/storage test` 33/33、`pnpm --filter @workexpert/agent-core test` 184/184、`pnpm --filter @workexpert/api test` 27/27、API build、`pnpm knowledge:acceptance` 5/5通过。新增KE-P01/P02覆盖去重、顺序、返回数组隔离、失败/维度、批量读取等价/分页边界/无跨调用缓存；旧版本、删除竞争、父块与混合检索继续通过。模拟关键词10题仍全部第一名，不能解释为真实语义召回质量提高。
- `node scripts/knowledge-performance-benchmark.mjs`通过，规格/原始数据见[KE-P03](../../../benchmarks/suites/knowledge/README.md)。400块批次40个命中的证据读取中位137.29→4.64ms；75%重复输入的Embedding桩请求13→4（旧值按原算法计算）。不将阶段微基准外推到整次检索或所有资料。
- 按db技能使用隔离临时库，未打开用户数据库、迁移真实数据或调用真实模型。无新依赖、schema、HTTP及界面改动，原手册操作不变；回滚本次代码即可，不需要重建索引。尚未执行真实模型/大库端到端/安装态/浏览器，本次未改变UI；没有并发策略变更，未重跑调度专项。ANN、并行Embedding、跨请求缓存、Rerank与召回质量调参不在本轮范围。
- 收尾：API typecheck、`pnpm docs:build`、`git diff --check`通过，新增基准脚本另检whitespace；保留SQLite experimental与文档bundle大小提示。性能数据不计模型网络延迟，未修改或重启用户正在运行的实例。

规格版本：0.1；更新日期：2026-10-16；状态：实施中。

## Wiki 设计移交（2026-10-16）

KE-07 / KE-T05 的后续详细规格由 [知识 Wiki](../knowledge-wiki/README.md) 承接，任务状态以其 status 为准。设计已获用户授权并开始 WK-T02 底座实施；本体为可选增强，不是 Wiki 前置依赖。以下历史阶段中的“本体 Wiki”保留为当时记录，不代表当前依赖要求。原文仓储新增 v5 兼容及 Wiki 来源失效钩子，普通库仍新建 v4；用户手册更新列为完整 Wiki 实现后的发布门禁。

## KE-T04f：PDF/DOCX 与 API 进程重启（2026-10-16）

- 已在既有 `ui:knowledge:lifecycle` 增加 KE-E05/E06，新增程序生成的简单英文文本 PDF、中文段落 DOCX fixture；全部经浏览器二进制上传和真实 API 解析，不模拟知识接口。延续 `51fa72c` 工作区，Node v22.22.1；本轮只修改测试与规格，未改生产逻辑/数据库，保留已有变更。
- PDF/DOCX 可通过特定关键词召回目标文档正文，证据版本对应归档快照且内容摘要正确；origin 为 upload，原文件名、长度、SHA-256 与下载原始字节均一致。损坏 DOCX 在向量调用前报错，原文件保留，但不会成为可检索文档。
- harness 正常停止本次 API 子进程，等待退出后以同一数据目录/端口启动新进程，并验证 PID 改变。重启后两篇二进制文档及保留文本仍能召回；已删除文档与失败尝试不出现在列表/全文结果，成功/失败归档均可读取。停止超时仅对本次子进程升级终止，正常重启验收要求未触发强制终止，不操作其他应用进程。
- 首轮验收错误地要求删除后的中文查询结果为空；由于 OR 词法召回可合法命中剩余 DOCX 中的“凭证”，改为按不可见文档 ID 校验结果及父上下文不回流；损坏文件的唯一编号仍严格要求零结果。此调整对应既有检索契约，没有修改排名/召回实现。
- `pnpm ui:knowledge:lifecycle`：通过，含 contracts/storage/agent-core/API/renderer 构建以及 KE-E01～06 和核心浏览器冒烟。`pnpm --filter @workexpert/agent-core test`：173/173 通过（包含原有 PDF/DOCX 解析单测）。
- 最终顺序复跑 `node scripts/core-ui-browser-regression.mjs --knowledge-search` 和 `--knowledge-lifecycle`：均通过；`pnpm docs:build`、`git diff --check` 通过。既有 bundle/混合导入和 SQLite experimental 提示仍在。本轮仅测试改动，未重复运行 API 全量或编排并发专项。
- agent-browser CLI 不可用，继续采用仓库现有 Playwright fallback。没有调用真实模型、读取个人材料或迁移用户数据；本次临时数据结束后清理。无新增配置/迁移，回滚仅撤销测试 fixture、harness 重启支持和本步文档，不回滚旧证据兼容代码。
- 边界：简单文本 PDF、单段 DOCX 只证明基础解析路径；中文 PDF 字体、复杂表格/布局、扫描件/OCR、加密文件、进程崩溃恢复、Electron 安装态、跨平台和真实业务质量仍未验证。后续业务评测需要用户提供脱敏文档/预期问题，并指定允许使用的真实模型；不能以更多模拟用例替代业务验收。

## KE-T04e：真实本地链路浏览器验收（2026-10-16）

- 状态：Web 构建 + API + 真实存储的受控端到端验收通过。新增 `scripts/lib/knowledge-lifecycle-ui-regression.mjs` 和 `pnpm ui:knowledge:lifecycle`，复用现有浏览器 harness；未修改生产逻辑、公共契约或数据库结构。延续 `51fa72c` 未提交工作区，Node v22.22.1，保留此前所有变更。
- 通过真实设置接口建立本次临时知识库，浏览器上传含 CRLF 的 UTF-8 Markdown 和粘贴文本；API 归档、结构分块、SQLite 发布/FTS、LanceDB、检索接口均走真实实现。仅 localhost Embedding 服务是固定向量桩，不使用实际凭证，也不拦截知识接口。两种 UI 回归标志互斥，防止把 mock 查询误混入真实链路。
- KE-E01：处理中不显示成功；完成后有多个可检索子块；通过受保护原文接口核对源文本完全一致；真实检索有关键词/向量通道，证据哈希和规范化文本切片一致；父上下文默认收起、展开正文匹配接口；片段定位明确非页码。浏览器刷新后仍可检索。
- KE-E02/E03：模拟模型故障后关键词独立召回并显示降级；故障导入保留原文快照和表单正文，不出现在文档列表，也不发布 FTS；恢复服务后原表单重试成功，文档总数为两篇（失败尝试不作为可检索文档）。重试仍分配新 documentId，未新增请求幂等。
- KE-E04：浏览器确认删除显示归档原文保留说明；再次检索不含已删除文档及其父上下文，另一篇文档仍能关键词命中；已删除文档的归档原文仍可授权下载。
- `pnpm ui:knowledge:lifecycle`：最终通过，包含 contracts/storage/agent-core 构建、API CJS 构建、renderer 类型检查/构建及浏览器完整旅程。首次运行因页面另有聊天文件输入、测试选择器过宽而失败；限定到知识导入表单后通过，没有修改产品行为或放宽业务断言。
- `node scripts/core-ui-browser-regression.mjs --knowledge-search`：通过，既有搜索交互回归不受影响。`pnpm --filter @workexpert/api test`：6/6 通过；`pnpm knowledge:acceptance`：5/5 通过，固定题集仍 10/10 第一名。
- agent-browser CLI 仍不可用，按技能 fallback 使用仓库现有 Playwright。测试临时组织、数据和模拟服务在 finally 清理；没有读取、迁移或删除用户知识库。既有 bundle 大小/混合导入及 SQLite experimental 提示保留。
- 边界：本次上传 Markdown 由浏览器读为文本再提交，源快照按现有文本路径保存，不代表二进制文件解析或原文件名保真。未覆盖 PDF/DOCX/OCR、真实模型语义质量、API 进程重启、Electron 安装态、Windows/Linux、大库性能或业务相关性；测试预置知识库配置，不声称验收模型设置/建库 UI。上述项目仍需后续单独验收。
- 本步无新增迁移，回滚仅移除新测试模块/命令及 harness 分支，不能回滚此前证据库兼容代码。下一步应使用脱敏业务文档与实际模型做效果验收，并补安装态验证，再按结果决定 Rerank 或本体 Wiki。

## KE-T04d：搜索交互一致性（2026-10-16）

- 已实现请求序号 + 查询/知识库快照校验。编辑查询、切库（含返回列表再进入同库）、卸载立即使旧请求失效；旧成功、错误和 finally 不再写入页面或弹通知。同一查询处理中重复 Enter 不发送请求，修改查询后可提交新搜索。仅取消 UI 接收，不取消后端计算。
- 本地知识库列表/搜索能力标签改为“关键词 + 语义”，本体启用时显示增强能力；本次结果提示按实际命中通道区分，不由单路命中推断另一通道未运行。空结果不声称融合成功，降级单独提示；当前搜索错误标题为“检索失败”。未增加设置或按钮，不改模型、排名、权限和数据库。
- 新增 `pnpm ui:knowledge:regression`，复用既有临时组织浏览器 harness，API mock 控制延迟，验证 KE-U01/U02。首次运行因错误通知带友好说明前缀、测试错误使用 exact 文本定位而超时；改为包含匹配（同时强化旧错误不可见断言）后通过，未改变通知的既有错误分类机制。
- `pnpm knowledge:acceptance`：5/5 通过，10 道模拟关键词题仍全部第一名。`pnpm concurrency:regression`：通过（DSH、AgentScope 单用户及全局限制）。没有修改后端生产代码，本轮未重复执行 agent-core 全量套件。
- 最终 `pnpm ui:knowledge:regression`：通过（含前端类型检查/生产构建、核心导航与搜索专项）；`pnpm docs:build`、`git diff --check` 通过。仍有既有 bundle 大小、混合导入和 SQLite experimental 提示。
- 按 agent-browser 技能先检查 CLI，本机仍无可执行命令，改用仓库现有 Playwright 自动回归，未安装额外工具。测试全部使用临时组织/模拟结果，未触碰真实用户知识库；浏览器 API mock 不证明实际导入、索引与完整 UI 链路，真实材料、完整导入→删除旅程及 Electron 安装态仍待验收。
- 无契约或数据迁移，回滚仅撤销本阶段 UI/回归变更，保持此前证据库 v4 兼容代码不变。后续先完成真实或隔离样本文档的完整 UI 旅程，再决定 Rerank/Wiki，不以此回归替代相关性评测。

## KE-T04c：检索验收基线（2026-10-16）

- 状态：自动回归基线已验证；真实业务/完整桌面旅程仍待验收。仅增加测试、根运行命令和验收说明，没有修改生产算法、UI 或数据库结构。工作区基于 `51fa72c`，保留此前未提交变更，Node v22.22.1。
- 新增 `pnpm knowledge:acceptance`，覆盖 KE-A01/A02 与已有 KE-K03/KE-C03/KE-V03/V04，共 5/5 测试通过。8 篇原创模拟文档、10 道关键词题，目标文档全部排名第一，文档级 Hit@3=1、MRR@3=1；每题校验真实关键词通道、版本证据/切片/摘要，额外覆盖空查询、无命中、同义表达词法边界、删除后不可召回。不是实际业务或语义模型质量结论，也不是性能 Benchmark。
- `pnpm --filter @workexpert/agent-core test`：173/173 通过。首次编译发现测试误用 hit.documentId，改为既有公共 evidence.documentId 后通过，没有修改生产契约或放宽断言。
- `pnpm --filter @workexpert/renderer build`：通过，含类型检查；既有动态/静态 import 与大 bundle 警告仍在。`pnpm ui:core:regression`：通过，覆盖临时组织初始化、登录、导航（含知识库）、设置和空态。agent-browser 技能 CLI 在本机不可用，使用仓库现有 Playwright 回归替代，未安装新工具。
- 所有新增数据为临时模拟材料，未读取或迁移用户知识库，未调用真实模型。没有数据库配置变化，回滚仅撤销本步测试/运行入口。真实业务材料尚未提供，未执行真实模型相关性评测、完整导入→检索→上下文→删除 UI 旅程、Electron 安装态和跨平台验收。
- 验收说明与题集口径见 [acceptance.md](acceptance.md)。本阶段不引入 Rerank、Wiki 或 WeKnora Provider。

### 当时发现的问题（现由 KE-T04d 收尾，见上）

1. `KnowledgePage.runSearch` 在 await 后直接写入结果，未验证当前知识库或请求序号；切库 watcher 虽清空结果，迟到响应仍可能覆盖新库。Enter 可绕过按钮 disabled 发起重复搜索。此为代码检查发现，尚未用延迟响应浏览器场景复现；应补回归并修复。
2. 搜索区头部仍有“向量检索 / 向量 + 本体 + 图谱证据”的旧文案，与下方混合检索说明不一致；还应核验无模型时仅关键词参与的提示。

优先收尾以上交互一致性并完成完整 UI 旅程，再用脱敏真实语料决定是否需要 Rerank；不把本次模拟题集全中作为直接进入 Wiki 的依据。

KE-T01、KE-T02a、KE-T02b1 原文归档/资产桥接、KE-T03a 证据批次与检索可见性、KE-T04a 全文/BM25 与混合召回、KE-T04b 结构化分块/定位/父块上下文已实现。本地 API 入库已接原文、证据、向量及有效批次/全文同步发布。安装态验收、替换/重处理交互与本体失效管理、其余 KE-T04（Rerank/业务评测）、KE-T05 Wiki 仍待完成。未执行用户数据迁移。

## 2026-10-16 验证

- 基于 WorkExpert `51fa72c` 工作区，新增统一契约、确定性身份工具和 4 项回归。
- `pnpm --filter @workexpert/contracts build`：通过。
- `pnpm --filter @workexpert/agent-core test`：165/165 通过（包含新增 4 项）；构建通过。
- `pnpm docs:build`：通过；存在文档站 bundle 大小提示。
- 未执行桌面安装态、真实模型和数据迁移测试：本步没有改动运行链路或持久化结构。
- 当前 limitation：versioned 仅描述引用身份完整性，不证明原文仍存在、权限有效或引用摘录核验通过；这些需要 KE-T02/T03 的仓储与解析服务完成。
- 下一步先验证原生 SQLite 的 Node/Electron 打包兼容，再实现仓储与入库批次发布；不得把当前工具导出视为已接通生产版本管理。

## KE-T02a 验证（2026-10-16）

- 新增 `storage/knowledge-evidence-store`：独立 SQLite schema v1、不可变批次、内容摘要校验、父子作用域/环校验、历史读取、CAS 有效批次切换。共享批次/指针契约在 contracts。
- 按 db 技能的安全迁移流程，所有数据库验证使用临时目录，事务初始化拒绝已有未知表或未来版本；未打开用户数据库。
- `pnpm --filter @workexpert/contracts build`：通过。
- `pnpm --filter @workexpert/storage test`：4/4 通过（含包构建）；首次测试辅助函数的类型推导编译失败，改为显式 TestContext 后通过。
- Electron 二进制以 `ELECTRON_RUN_AS_NODE=1 ... --test packages/storage/dist/test/*.test.js` 执行同套测试：4/4 通过。宿主 Node 22.22.1，Electron 内置 Node 22.21.1；两者有 SQLite experimental 提示。
- `pnpm --filter @workexpert/agent-core test`：165/165 通过，含构建。
- `pnpm docs:build` 与 `git diff --check`：通过；文档构建仍有 bundle 大小提示。
- 限制：本步按完整批次 JSON 保存证据，尚无逐 Chunk SQL 查询索引；未归档原文件、核验原文定位或接入 LanceDB。发布方法依赖调用方先完成索引，不提供跨 SQLite/LanceDB 事务。
- 未执行桌面安装包和 Windows/Linux 验收，因本步为未接线仓储；不能以 Electron Node 模式测试替代安装态验收。Node >=22.0 的全部版本尚未覆盖，生产接入前须确定最低运行时与明确不支持提示。
- 回滚：移除仓储调用/导出并保留新数据库；不修改旧 sql.js、LanceDB 或 domain KV，不执行降级删除。

## KE-T02b1：原文归档与资产桥接（2026-10-16）

- 新增共享不可变文件服务和独立 sources.sqlite 引用表。按 org/user 隔离，同一主体内按 SHA-256 复用文件；读取核验大小与摘要，拒绝路径穿越和符号链接。按照 db 技能在临时目录测试初始化/事务/未来版本拒绝，不操作已有资产数据库迁移。
- `/knowledge/ingest` 本地分支已接线：原文归档先于解析/Embedding，API 分配 documentId 并传给原有入库。成功/后续失败均可返回 sourceSnapshot；其 archived 状态不等于知识入库成功。非本地 provider 保持原链路。
- 可选 assetId 支持从自有资产导入（API/客户端服务接口，尚无资产选择器 UI）；独立复制后旧资产可变性不影响快照。文本资产按 UTF-8 输入，二进制仍走既有解析器。不允许共享、跨组织或无归属旧资产直接转存。
- 原文下载：认证后 `GET /knowledge/sources/:documentVersionId`，只允许归档用户本人及同组织读取；不接受客户端文件路径。尚无快照列表、恢复按钮、自动 GC 或彻底删除界面。
- 知识库页面增加归档成功提示与删除时的原文保留说明。现有删除操作仍只删除检索内容，不偷偷清理历史原文。
- `pnpm --filter @workexpert/contracts build`、`pnpm --filter @workexpert/storage test`：通过，storage 7/7。
- `pnpm --filter @workexpert/agent-core test`：166/166 通过，新增实际入库保留 API 文档 ID 的回归（Embedding mock）。
- `pnpm --filter @workexpert/api test`：6/6 通过。首次新增未登录测试返回 500，补显式 401 后重跑通过。
- Electron Node 模式运行 storage 全部测试及 knowledge-source API 测试：9/9 通过。
- API 类型检查、CJS 构建、renderer 类型检查、文档构建与 diff 检查均已执行通过；文档仍有 bundle 体积提示。
- 原生 SQLite 使用要求使 Node 最低声明调整到 22.13.0；实际验证为宿主 22.22.1 和 Electron 内置 22.21.1，仍有实验性 API 提示。安装包、Windows/Linux、最低版本运行时及真实模型未验证；不以测试运行态替代安装态。
- 新增持久化位于数据目录 `knowledge-sources/objects/` 和 `knowledge-sources/sources.sqlite`。不回填历史文件、不改变向量表，不接通证据批次双写或版本过滤。每次新导入仍分配新 documentId；上传重试去重到同一文档的语义留待 T03。
- 回滚为撤销 API 归档接线、恢复旧 Node 要求（如确需），保留新增文件及数据库；无破坏性迁移。资产迁移共享对象、逐块证据查询、失败任务恢复、可审计清理仍是后续工作。

## KE-T03a：证据与检索可见性（2026-10-16）

- 本地 API 将可信原文快照传给 agent-core；解析结果分块后先保存 SQLite 不可变证据，再生成/写入向量，回读核验后 CAS 发布。证据记录 parser 标签、分块参数、解析结果摘要与完整分块正文；Embedding 不改变分块身份。
- 各 KB 新增 `knowledge-evidence.sqlite`，v1→v2 事务迁移新增 membership、suppressed_chunks；按 db 技能在临时库验证迁移保留历史与冲突回滚，没有执行用户库迁移。旧 LanceDB chunks 表不改列，分块 ID 关联证据。
- 向量检索在 TopK 前筛选有效分块，返回前再校验；文档列表、分块列表、本体精确分块引用同样排除未发布/过期/删除分块。旧 JSON 与 LanceDB 合并去重，旧引用为 legacy-unverified，损坏/不支持的证据库 fail closed。明确采用 cosine 并统一 fallback 分数，不承诺与旧 L2 排名完全一致。
- 新版本化入库禁止向量写入失败时静默改写 JSON；维度不符有明确用户提示。按确定性 ID merge 写入，内部同文档/批次重试不重复向量；API 每次新导入仍分配新 documentId，并未实现请求级幂等、同名覆盖或替换入口。
- 文档删除先持久化屏蔽并提升 generation，再清理副本，迟到任务不能重新发布。保留历史证据与原文；单块删除记录逻辑屏蔽。尚无完整本体候选失效标注/修复流程。
- 交互不增加入口或设置：保留导入/查看/删除，成功说明“可以开始检索”，失败保留表单；文本提交保留首尾空白供原文归档。内部批次、SQLite/LanceDB 选择均不暴露给用户。
- 已修复验证中发现的版本化证据联合类型不够精确、Embedding 维度未显式约束、成功提示与原文件就绪提示键重名。真实 LanceDB 测试使用 checkoutLatest 验证跨连接写入后的物理行数，不用旧快照作判断。
- 限制：大库的 ID 过滤 SQL、membership 扫描和逐批次 JSON 证据读取尚未做规模基准；沿用本地全量列表 20,000 条上限。旧数据不回填，解析器外部依赖完整版本清单、单独向量索引构建身份、任务恢复及批次清理仍待建设。
- 回滚必须保留 v2 兼容读取与可见性过滤，不能直接部署忽略证据库的旧检索代码，也不能删除证据库来“恢复”。新增只读历史保留，未引入数据删除式迁移。

### KE-T03a 验证记录

- contracts 构建、storage 测试 9/9、agent-core 全量测试 167/167、API 测试 6/6 均通过。
- 新增集成回归使用临时 SQLite、真实 LanceDB 与 mock Embedding，覆盖批次重试、向量维度错误、旧版本过滤、本体精确引用不串版本、孤立向量隔离、旧 JSON 兼容、删除与迟到发布竞争、未来 schema 拒绝读取。
- API 类型检查与 CJS 构建、renderer 类型检查、`pnpm docs:build`、`git diff --check` 通过；文档构建有既有 bundle 体积提示。
- Electron Node 模式执行 storage、知识源 API、版本化入库集成测试：12/12 通过；原生 SQLite 仍有 experimental 提示。
- `pnpm concurrency:regression` 通过：DSH MCP/Skills 回归、AgentScope 单用户并发限制与多用户全局限制均通过；采用隔离临时数据目录和 stub，不调用真实模型。
- 未执行安装包、Windows/Linux、真实模型、大库性能及人工界面端到端验收。没有新增全文/BM25、ANN、本体指导 Wiki、替换/重处理界面或 WeKnora Provider；这些仍是后续分步范围。

## KE-T04a：全文/BM25 与混合召回（2026-10-16）

- 已接通“分块 → 有效批次发布与 FTS 写入同事务 → BM25 召回 → cosine 向量召回 → RRF 排名融合 → 再核验证据”闭环。删除同步清理全文派生行；待发布、历史及删除内容不计入有效全文语料。注入全文写入失败时验证旧头与旧索引均保留，返回稳定错误码 FULLTEXT_INDEX_FAILED。
- schema v3 增量迁移 v1/v2；有效证据自动补全文投影。旧无版本 LanceDB 按固定表快照、每页 1,000 条扫描，JSON 兼容数据同时补齐；进程内首搜执行，不使用旧列表的 20,000 条限制。补齐失败可重试，正常写入后同步维护。不会把旧数据标为 versioned。
- FTS5 使用运行时内建模块，没有新增依赖服务。预处理覆盖中英文混合、全半角、编号和标点；中文为单字/双字，不是词典语义分词。标题加权 2、正文 1；两路各取 20～100 个候选，RRF k=60，去重后取 TopK。检索元数据描述实际 channels/degraded，分数不是置信概率。
- 不增加检索入口、开关或数据库选项。向量异常且有关键词命中时保留匹配结果、明确提示降级；无模型配置可做关键词查询。新查询清空旧结果以避免失败后误读；搜索页和本体验证页将混合结果显示为排序分，保留旧协议路由键但标签改为“原始查询”。
- 使用 db 技能要求的临时数据库事务验证，未打开或迁移真实用户库。首轮仓储测试发现 scope 严格契约误收整个批次对象，已改为显式 scope 字段并重新通过，未放宽契约。

### 实际验证

- 工作区仍基于此前未提交变更继续实施，没有回滚已有代码。宿主 Node v22.22.1。
- `pnpm --filter @workexpert/contracts build`：通过。
- `pnpm --filter @workexpert/storage test`：13/13 通过，含真实 FTS5/BM25、查询计划、v1/v2 迁移、重开持久化、迁移失败回滚、发布失败回滚、删除与迟到补齐。
- `pnpm --filter @workexpert/agent-core test`：169/169 通过。新测试使用真实 LanceDB、临时 SQLite、mock Embedding；包含 1,002 条旧 Lance 数据跨页补齐、JSON 兼容、知识库目录隔离、中文/编号、两路互补、RRF 去重、无模型/服务故障、版本切换与删除。
- `pnpm --filter @workexpert/api test`：6/6 通过；API 类型检查与 CJS 构建通过。
- `pnpm --filter @workexpert/renderer typecheck`：通过；`pnpm docs:build`、`git diff --check`：通过，文档 bundle 大小提示仍在。
- `ELECTRON_RUN_AS_NODE=1 apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --test packages/storage/dist/test/*.test.js packages/agent-core/dist/test/knowledge-hybrid.test.js packages/agent-core/dist/test/knowledge-versioned-runtime.test.js apps/api/test-dist/knowledge-source.test.js`：18/18 通过。SQLite 仍有 experimental 提示。
- `pnpm concurrency:regression`：DSH MCP/Skills、AgentScope 单用户与全局并发限制通过，使用临时数据和 stub。

### 边界、风险与回滚

- 未执行安装包、Windows/Linux、真实模型、人工 UI 端到端、业务相关性评测或大库性能基准；当前证明功能正确性，不宣称召回率/性能提升幅度。安装态需验证 FTS5、原生 SQLite/LanceDB 依赖与新索引目录持久化。
- 首次迁移/历史补齐有时间和额外磁盘成本；search_chunks 是可重建的正文/token 投影。现有文档列表 20,000 条限制不因本步自动解除。外部直接修改底层文件后的实时同步、索引修复界面和自动清理不在本步范围；没有新增 ANN、父子块、Rerank、Wiki 或 WeKnora Provider。
- 回滚必须保留 schema v3 兼容读取/删除过滤，可停用混合查询但不能直接部署只认识 v2 的代码；不删除原文、证据库或旧向量。决策和需求见 [ADR-0005](../../../architecture/adr/0005-local-hybrid-retrieval.md) 与 [KE-T04a 规格](README.md)。

## KE-T04b：结构化分块、定位与父块上下文（2026-10-16）

- 新本地导入改用 structured-utf16-v1 启发式分块：识别 ATX/Setext 标题、段落、列表、管道表格和围栏代码；不超过上限的结构尽量整体保留，超长结构按换行/句子/空白降级，再做不切断 UTF-16 代理对的硬切。子块最大 1,200，父块最大 3,600；纯空白片段不进入 Embedding。
- 新版证据保存 headingPath、规范化解析文本的精确 UTF-16 切片位置和可选 parentChunkId。父块作为同批次 parentChunks 保存于 SQLite，只有子块进入 membership、LanceDB、FTS 和列表计数；父块不额外生成向量。单子块不另存父块。
- 父子写入校验作用域、版本、摘要、长度、无环、位置包含、子片段与父原文切片一致，且父正文不存在未跟踪的非空白内容。数据库兼容标识升至 v4，不改既有表或批次 payload，旧版本无定位/父块继续可读，不自动重处理。
- 搜索仍返回命中子块正文；context 单独附父正文与证据。同父去重，最终单库/本体混合/跨库工具 TopK 输出的父上下文总长上限 7,200。最终同步重新校验有效证据，任一同父子块被删除则不展开整个父块；查询期间删除也不回流已删正文。失败知识库没有有效结果时不会在上下文阶段再次阻断其他库结果。
- UI 沿用原导入/搜索，仅结果有上下文时出现折叠“查看上下文”；片段详情显示解析文本偏移并明确不是原文件页码。工具说明区分命中与邻近上下文，内部身份不作为用户正文。

### 实际验证

- 延续此前未提交工作区，未覆盖既有变更。按照 db 技能在临时库测试升级/事务/删除，未迁移用户库。
- `pnpm --filter @workexpert/contracts build`：通过。
- `pnpm --filter @workexpert/storage test`：16/16 通过，新增父子校验、父块不参与检索、删除兄弟块抑制上下文、v3→v4 保留旧 payload/全文行为。
- `pnpm --filter @workexpert/agent-core test`：172/172 通过。新增结构与精确定位测试、重复段落/CRLF/emoji/长结构/空白代码块、真实 Lance + mock Embedding 的子块计数、上下文去重/预算、查询与删除竞争、跨库与故障库隔离、重处理和删除回归。
- `pnpm --filter @workexpert/api test`：6/6 通过；API 类型检查和 CJS 构建通过。`pnpm --filter @workexpert/renderer typecheck`、`pnpm docs:build`、`git diff --check` 通过，文档 bundle 大小提示仍在。
- `ELECTRON_RUN_AS_NODE=1 apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --test packages/storage/dist/test/*.test.js packages/agent-core/dist/test/knowledge-chunker.test.js packages/agent-core/dist/test/knowledge-context.test.js packages/agent-core/dist/test/knowledge-hybrid.test.js packages/agent-core/dist/test/knowledge-versioned-runtime.test.js apps/api/test-dist/knowledge-source.test.js`：24/24 通过；SQLite experimental 提示仍在。
- `pnpm concurrency:regression`：通过，覆盖 DSH MCP/Skills 与 AgentScope 单用户/全局并发，临时数据与 stub。
- 验证中修正了迁移测试仍期待 v3、测试 fixture 显式 undefined 与不可变 JSON 规范化不一致、测试列表联合返回的隐式 any；未放宽生产校验。代码复核补充“无结果故障库不再次恢复上下文”的隔离保护，并加回归。

### 边界、风险与回滚

- 结构解析为启发式，不是完整 Markdown AST；未恢复 PDF 原生页码/坐标、OCR、HTML 表格或跨页表头。超长表格/代码块可按行分拆，不复制表头/围栏来冒充原文。旧数据不会自动获得父块或新定位。
- 父块有 SQLite 正文冗余和读取/校验成本；7,200 是字符预算而非模型 token 预算。本步未做大库性能或真实业务相关性/回答质量评测，不能声称质量提升幅度。安装包、Windows/Linux、真实模型和人工 UI 端到端仍未执行。
- 未实施 Reranker、Wiki、WeKnora Provider、ANN、替换/重处理 UI 或原文页码跳转。
- 回滚须保留 v4 和新字段兼容读取，可停用新分块及上下文恢复，不可直接部署 v3 严格读取代码或删除证据库。详情见 [KE-T04b 规格](README.md)。
