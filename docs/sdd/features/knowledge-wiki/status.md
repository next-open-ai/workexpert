# Wiki 当前状态

## WK-T19（2026-10-21）

完成已有主题辅助合并：未发布草稿按规范化标题/别名精确匹配已发布主题，预览优先展示新增章节，旧内容与完整结果折叠。保留目标人工草稿、证据和原发布版本，仅保存更新草稿，随后沿用核对发布。双方版本/CAS、幂等和容量拒绝保护已实现；原生成草稿保留，非自动全库去重，不做语义消歧或矛盾裁决。

- storage 36/36、API 36/36、agent-core 201/201通过；API/renderer构建、用户手册回归、文档构建及diff whitespace检查通过。WK-M19-T覆盖预览、来源隔离、UTF-16、精确去重、容量拒绝、并发冲突和幂等；浏览器完整Wiki回归通过，包含匹配→预览→保存→核对发布、原发布隔离及原草稿保留。
- 最终新增内容优先的界面已重跑浏览器并检查截图。按db技能使用临时库验证事务；agent-browser CLI缺失，使用仓库Playwright回退。无真实用户库写入、真实模型调用、安装态或规模性能验收。
- SDD、架构说明、手册及应用内手册产物同步。无新增配置、依赖或表迁移；回退移除新入口/API即可，已保存修订沿用旧读取。保留既有构建包大小警告。
- WK-T20来源变更入口、WK-T21检索诊断、WK-T22阅读维护待后续；统一Reranker与召回质量评测继续排除。

## WK-T11（2026-10-18）

完成：仅优化混合知识库renderer交互，统一“知识库设置”，只读诊断改名“技术信息”，配置开启与实际命中分离，检索诊断默认折叠，补查询状态/标签/键盘回归。索引状态中文化，配置可用不再冒充索引就绪。保存设置清除当前旧结果。无后端、权限、数据或排序变更。

- 2026-10-18，Node v22.22.1，在既有未提交工作区增量实施，未撤销历史改动。`pnpm --filter @workexpert/renderer typecheck`、renderer `build`、`node scripts/core-ui-browser-regression.mjs --knowledge-search`、`node scripts/core-ui-browser-regression.mjs --wiki`、`node scripts/user-manual-regression.mjs`、`pnpm docs:build`、`git diff --check`通过。未跟踪脚本/规格另作no-index whitespace检查，无错误。
- WK-U08覆盖短查询不请求、初始/加载/空结果/错误提示、旧请求隔离、本体strategy不等于实际命中、索引stale不伪报就绪、诊断默认折叠与键盘展开、保存同库设置清除旧结果。真实Wiki旅程验证设置保存/重载、来源标记/跳转，既有生成、编辑、批量发布、长文、重启和删除通过。
- 截图已检查列表、设置、融合结果和390px检索区域。首次窄屏检查发现全局侧栏展开会挤压内容，原“根页面无横向滚动”断言不足；测试改为通过现有按钮收起侧栏后检查检索面板实际边界，再完整重跑通过。本轮未重构全局移动端导航，窄屏仍建议收起侧栏。
- agent-browser CLI本机不可用，使用仓库Playwright/Chrome回退。仅临时SQLite、虚构资料和本地模型桩；无真实用户库操作。renderer无独立test命令，以类型/构建和浏览器回归验收；后端单测、并发专项、安装态与真实模型质量未重跑，因本轮不改后台执行。保留既有bundle大小和动态导入警告。
- 手册8.3/8.4及应用内生成产物已同步。无依赖/配置/schema迁移；撤销本轮UI变更即可回退，不影响已保存Wiki、索引或开关。

## WK-T10（2026-10-18）

完成：本地知识库新增“启用 Wiki 融合检索”，默认关闭、与本体开关独立。保留原文关键词/向量及可选本体处理，将已发布且来源有效的 Wiki 词法候选作为另一类结果做外层 RRF；关闭不影响 Wiki 浏览与独立搜索。结果区分派生页面与原文证据，并支持直接打开页面和来源。ADR-0009、SDD、手册8.3及应用内产物同步。

- contracts build、agent-core/API/renderer typecheck、API/renderer build 通过；storage **33/33**、agent-core **185/185**、API **28/28**，知识验收 **5/5**（合成关键词10条均首位，不代表语义质量），并发专项和手册回归通过。
- WK-R04覆盖默认关闭、独立开关、可信上下文、客户端伪造不生效、草稿隔离、版本替换/来源失效、稳定排序、工具调用、空库不创建数据库及损坏库明确失败。WK-U07真实浏览器覆盖保存/刷新、融合结果与来源跳转、关闭后独立搜索保留；原有生成、批量发布、编辑、重启和删除旅程同时通过。
- 首次浏览器回归因测试从详情页返回卡片时漏点“返回列表”超时；修复测试导航后完整重跑通过。agent-browser CLI 不可用，使用仓库 Playwright 回退。仅临时 SQLite/资料和本地模型桩，无真实数据发布或模型费用。
- 无新依赖、数据库迁移、Wiki 向量索引或重建要求；无需新增页面级权限。默认 Pi 的 kb_search 已验证，未声称其他执行引擎完成同等验收。未验证安装态、真实模型质量与规模性能；保留既有 bundle/SQLite experimental 提示。

## WK-T06d（2026-10-17）

完成（WK-U06）：左侧草稿复选框、全选全部草稿、取消全选、发布所选、全部发布已实现。全量遍历分页后统一确认；逐页校验选择时版本并复用发布 API，失败继续且保留选择，成功不回滚。未修改权限、存储、模型或后台编排。

- 2026-10-17，Node v22.22.1，保留既有未提交改动。`pnpm --filter @workexpert/renderer typecheck`、renderer `build`、`pnpm --filter @workexpert/api test`（27/27）、`node scripts/core-ui-browser-regression.mjs --wiki`、`node scripts/user-manual-regression.mjs`、`pnpm docs:build`、`git diff --check` 通过；新增源码/脚本另检 whitespace。
- WK-U06 使用真实 API/SQLite 和强制每页一条的真实分页：第二页读取失败零发布、跨页全选、确认取消零提交、修改选择版本后成功1/失败1且新修订不发布、全部发布剩余页。另补手动取消/勾选和390px布局。原有单页发布、编辑/CAS、来源下载、页面章节树、重启/删除、长文生成及检索闭环通过。
- agent-browser 技能 CLI 本机缺失，使用仓库 Playwright/Chrome 回退；只操作临时知识库，本地 HTTP 模型桩，无真实用户数据发布或真实模型费用。手册8.5和应用内产物同步。
- 无配置/schema迁移；兼容既有单页 API，回滚只撤销批量入口，不撤回成功页面。批量不是原子事务或持久后台任务；离开停止后续提交，在途请求可能完成，重新打开以服务端目录为准。确认后新增页留待下次发布。未执行安装态、真实模型质量或规模性能；未改编排故未重跑并发专项。保留既有 bundle 大小、动态导入和 SQLite experimental 提示。

状态：实施中；规格版本：0.12；更新日期：2026-10-18。

## 实际范围

用户已明确授权按 ADR/SDD 开始落地。当前完成 WK-T02 页面契约/仓储底座，并实现 WK-T03 的存储失效钩子、WK-T05 的仓储查询子集。工作区仍基于 `51fa72c` 的此前未提交改动；保留既有修改，没有迁移或读取用户实际知识库，也没有调用真实模型。

已实现路径：选择版本化原文 → Pi 有界分批生成 → 来源与覆盖校验/同名章节汇集 → Wiki 草稿 → 编辑/对照/核对发布 → FTS/BM25 与标题/别名召回 → 页面互链 → 原文定位/下载 → 原文变化/删除后的可见性控制。生成和网页入口已接线，浏览器验收仅替换外部模型/Embedding，其余是真实组件。语义消歧、已有页融合、断点续算、完整历史恢复和真实模型质量仍未验收。

按用户最新要求优先功能闭环，暂停 WK-T09b 扩展。保留 T09a 的知识库归属和入口守卫，不新增页面级权限。旧个人 namespace 与来源上传者限制仍在，不声称已完成旧库继承迁移。

## 唯一任务状态

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| WK-T01 | 完成 | 用户授权采用方案，ADR Accepted；实施细化记录于规格 0.2 |
| WK-T02 | 完成 | 页面 Zod、显式 v5 迁移、不可变修订、引用/链接、发布/FTS/CAS/幂等与回归通过 |
| WK-T03 | 进行中 | 同事务来源失效、动态授权与个人 API 已接线；生成流程预检仍待 T04 |
| WK-T04 | 进行中 | T04a/b 已接线；语义消歧、已有页融合、断点续算仍待完成 |
| WK-T04b | 完成 | 自动顺序分批、同名候选保守汇集、来源/链接保持、逐批进度；G01b/G02b/A06及长文浏览器闭环通过 |
| WK-T04c | 完成 | 严格 JSON 围栏解码、跨包稳定的错误分类、固定中文原因与建议；G01c/G02c/A07/U04通过，无新权限/自动重试 |
| WK-T04a | 完成 | 单批完整输入、模型适配/引用校验、共享容量调度、v6任务与取消/中断，G01a/G02a/A04通过 |
| WK-T05 | 进行中 | 仓储查询及个人 HTTP 子集已验证；完整游标、历史列表/恢复待完成 |
| WK-T05a | 完成 | ADR-0007 个人 HTTP 子集与 WK-A02 回归通过；完整历史列表/恢复、签名游标不在本子阶段 |
| WK-T06 | 进行中 | T06a/b 阅读、编辑/版本对照及核对发布已接线，完整历史导航/恢复仍待完成 |
| WK-T06a | 完成 | 简洁 Wiki 页签、选择生成、草稿/发布、搜索互链、原文来源与下载，真实浏览器闭环通过 |
| WK-T06b | 完成 | 现有章节编辑、前后文本对照、只读引用、冲突保留输入和幂等重试；WK-U03/A05通过 |
| WK-T06c | 完成 | 本地库卡片“打开 Wiki”、页面→章节导航、章节聚焦/定位、分页保留正文；WK-U05 浏览器通过 |
| WK-T07 | 待开始 | 验收/基准 |
| WK-T08 | 进行中 | 小批量使用说明与应用内产物已同步，完整阶段门禁继续保留 |
| WK-T09a | 完成 | 库级配置归属、管理员一次性指派、桌面/Web统一入口、运行前校验，WK-A03 与相关回归通过 |
| WK-T09b | 待开始 | 旧 Wiki/原文定位兼容，撤掉库内重复用户限制，管理员简洁指派 UI 与手册 |
| WK-T10 | 完成 | 可选 Wiki 融合召回、可信运行上下文、结果来源和页面入口，WK-R04/U07通过 |
| WK-T11 | 完成 | 设置与检索交互简化、准确状态、WK-U08与原搜索/Wiki旅程通过 |

## WK-T06c 直接打开与页面章节树验证

- 2026-10-16，Node v22.22.1，保持原未提交工作区。本次只改 renderer 的 KnowledgePage/WikiWorkbench、浏览器脚本与文档/手册截图，不改 API、存储、模型、编排或权限。知识库卡片直接打开现有 Wiki 页签，原管理入口保留。页面→当前页章节是阅读导航，不增加父子页面数据或匿名独立网站。
- `pnpm --filter @workexpert/renderer typecheck`、renderer build 通过；renderer 无单独 test 命令，以实际浏览器回归验证。`node scripts/core-ui-browser-regression.mjs --wiki` 通过 WK-U05：原入口及卡片直达、页面展开/收起且不重复读取、章节定位/焦点、390px无横向溢出、真实分页加载时正文保留。仅把目录请求 limit 改为1验证分页，未 mock 返回数据或放宽服务端校验。
- 首次分页测试错误地预期满页即没有下一游标；旧接口在后续空页确认结束。调整为先断言第二页加载且正文不变，再请求空页，完整重跑通过。未修改存储分页行为。短文/长文生成、围栏/截断错误、编辑/CAS、发布/检索、互链/来源、重启/删除等既有浏览器旅程同时通过。
- 浏览器技能 CLI 本机缺失，使用既有 Playwright/Chrome 回退。实际页面树截图已视觉检查并更新 `user-manual-wiki.png`，手册 8.5 与应用内产物同步。`node scripts/user-manual-regression.mjs`、`pnpm docs:build`、`git diff --check` 通过，保留既有 bundle 警告。
- 未重跑后端包/并发专项（实现未改动），未做真实模型、安装态或大规模评测。仅临时测试库和本地模型桩，无真实资料外发。没有迁移；回滚只需移除入口/目录 UI，已有页面与修订不受影响。多级父子页面、拖拽分类、独立站点 URL 不在本次范围。

## WK-T04c 生成反馈优化验证

- 2026-10-16，Node v22.22.1，在此前未提交工作区增量实现。修改 contracts、agent-core、orchestrator、API 适配和 renderer 提示；无权限扩展、新依赖、数据库迁移或额外模型调用。既有任务 errorCode 字符串保持兼容，回滚不需数据操作。
- `pnpm --filter @workexpert/contracts build`、agent-core test **182/182**、orchestrator test **61/61**、API test **27/27**、API/renderer typecheck 通过。增加完整 JSON/json或无语言围栏兼容、混杂说明/截断/超长拒绝、引用校验不绕过、已取消不调用、模拟超时信号、取消优先、错误码白名单与敏感信息不持久化，以及真实 API 错误读取/幂等重放测试。
- 初次测试夹具缺必填 apiKey，补齐后重跑。API 测试揭示打包后的 contracts 类存在多副本，单用 instanceof 无法识别跨包错误；改为 Symbol.for 稳定标记加白名单识别，仍拒绝普通供应商 Error 或仅带 code 的对象，真实 API 回归通过。
- `pnpm ui:wiki` 的构建阶段通过；首次浏览器在此前已记录的 API 进程正常退出 10 秒期限处失败，未改退出断言。最终 `pnpm --filter @workexpert/api build` 后 `node scripts/core-ui-browser-regression.mjs --wiki` 完整通过：本地 HTTP 桩输出带围栏 JSON 经真实 Pi 生成，length 终止即使带完整 JSON 也拒绝；UI 展示截断原因、无草稿、刷新零重试，显式新生成完成长文汇集/发布/搜索。编辑、来源、互链、删除、重启基线同时通过。退出偶发不稳定性仍未修复，不以重跑成功替代根因结论。
- 浏览器技能 CLI 缺失，沿用仓库 Playwright/Chrome 回退；测试仅使用临时资料和本地模型桩，无真实用户库或真实模型费用。`pnpm concurrency:regression`、`node scripts/user-manual-regression.mjs`、`pnpm docs:build`、`git diff --check` 通过；手册 8.5 与应用内产物同步。
- 未执行真实模型质量、真实网络 120 秒等待、安装态和规模性能；超时分类使用已到期信号模拟验证。未重跑 storage/原文专项（本轮未改变存储或原文检索实现）。仍保留既有 bundle 大小与 SQLite experimental 提示；不新增自动重试/续算，不将格式兼容视为事实准确率提高。

## WK-T04b 有界分批验证

- 2026-10-16，Node v22.22.1，基于原未提交工作区增量实现；规格见 [batching](batching.md)。contracts 放宽任务输入/页数上限，agent-core 增加纯分批/归组函数，orchestrator 顺序执行与持久化块进度，API 每批及保存前复核完整来源，renderer 仅补进度与自动分批说明。无新权限、模型供应商、服务、依赖或 SQLite schema 迁移，无真实资料操作。
- `pnpm --filter @workexpert/contracts build`、agent-core test **179/179**、orchestrator test **59/59**、API test **26/26**、storage test **32/32** 通过。覆盖块数/字符/元数据/批次上限、全覆盖顺序、同名归组/歧义保留/容量回退、Unicode、引用/链接、逐批检查点、失败/取消停止后续调用、旧任务兼容和 64 页新任务契约。API 101 块分两批后真实保存/发布/FTS，超限零模型调用、批间来源抑制阻止下一次调用均通过。
- API/renderer typecheck 通过；`pnpm ui:wiki` 的全部包构建通过。扩展 `scripts/lib/wiki-ui-regression.mjs`：旧短文保持一次逻辑调用，新增长文真实入库→多次 Pi 调用→同名页汇集→全量证据/进度→发布/别名召回。最终 `node scripts/core-ui-browser-regression.mjs --wiki` 通过，同时覆盖此前编辑/CAS/重启/删除链路。浏览器技能 CLI 本机缺失，按回退路径使用仓库现有 Playwright/Chrome。
- 浏览器首次新增场景等待到了旧任务完成提示，补上新任务 POST 回执及选择面板关闭等待，未修改产品行为。一次重跑在旧场景正常重启 API 时超出脚本 10 秒退出期限；未放宽断言，随后完整重跑通过。该偶发进程退出不稳定性保留为风险，未把重跑成功解释为根因已修复。
- `pnpm concurrency:regression`、`pnpm knowledge:acceptance` **5/5**、`node scripts/user-manual-regression.mjs`、`pnpm docs:build`、`git diff --check` 通过。手册 8.5 与应用内产物同步。保留已有 bundle 大小及 SQLite experimental 提示。
- 未执行真实模型语义质量、安装态/跨平台、规模性能评测；使用本地模型/Embedding 桩以避免费用与真实资料外发。分批候选只在内存，失败/取消保留已保存草稿但不支持中间候选恢复；同名汇集不是语义消歧，仍需人工核对。
- 兼容与回滚：旧任务继续可读；新上限下的任务不能交给旧严格上限读写器。可关闭新生成入口并保留本版读写器与 SQLite v6，无需数据迁移或删除原文/修订。权限和项目/数字员工治理不变。

## WK-T06b 编辑与版本对照验证

- 2026-10-16，Node v22.22.1，在原未提交工作区增量实现；无数据库/schema、存储或模型编排变更，无新权限，无真实资料操作。仅新增 renderer 编辑组件/客户端方法与测试/文档。
- `pnpm --filter @workexpert/api test` **23/23**、API typecheck、renderer typecheck/build、storage test **32/32** 通过。新增 WK-A05 验证草稿保存/幂等/CAS、旧修订不变和发布前后 FTS 隔离。
- `node scripts/core-ui-browser-regression.mjs --wiki` 通过：原有生成完整链路，加 WK-U03 多章节/emoji 偏移、引用不变、重复别名规范化、旧发布版继续搜索、重新核对发布、已存在草稿入口、未保存关闭取消、丢失成功响应的幂等重试、并发冲突保留输入、最新版本只读对照与390px布局。真实 API 保存；仅在丢响应场景注入浏览器传输失败，重试仍经过真实 API。
- 浏览器技能 CLI 本机不可用，使用仓库现有 Playwright/Chrome 隔离环境。编辑截图已视觉检查。扩展多章节测试初次错误地期待未变化章节出现在“仅显示变化项”的对照中，改为分别检查变化文本和保留章节输入后重跑通过，未改变产品行为。
- 手册 8.6 说明操作、冲突处理和边界；关闭/刷新未保存提醒，保存超时30秒后可重试相同幂等键，不自动重试。编辑只保留在当前弹窗内，手动关闭后不提供本地草稿恢复；冲突合并需复制内容、重新打开编辑，不暗中改 CAS 基线。
- 收尾：最终 renderer build、Wiki 浏览器全链路、`node scripts/user-manual-regression.mjs`、`pnpm docs:build`、`git diff --check` 通过；手册生成产物同步，新增文件另检 whitespace。仍有既有 bundle 大小和 SQLite experimental 提示。
- 未执行真实模型/跨平台安装态/性能基准（本轮不改模型链路）；未重跑完整编排并发专项（未改编排/调度）。完整历史恢复、增删章节和更换来源仍未实现。回滚可移除编辑入口，已有修订继续使用当前仓储读取，无需数据降级。

## WK-T04a / WK-T06a 小批量闭环历史验证

- 2026-10-16，Node v22.22.1，仍基于 `51fa72c` 的未提交工作区；保留所有此前改动。仅操作 mkdtemp 测试数据，没有真实模型费用、真实用户库迁移、外部 Provider 接入或权限管理扩展。
- `pnpm --filter @workexpert/contracts build`、storage test **32/32**、agent-core test **177/177**、orchestrator test **57/57**、API test **22/22** 通过；API typecheck/build、renderer typecheck/build 通过。新增覆盖完整引用、错误引用/链接/哈希、超限、备份/迁移失败回滚、跨作用域任务、幂等/容量/取消/部分保存/中断、模型期间来源抑制、草稿发布和来源定位。
- `node scripts/core-ui-browser-regression.mjs --wiki` 通过（正式复现入口 `pnpm ui:wiki` 会先构建）。真实登录、HTTP、LanceDB、SQLite、FTS、文件归档和 Pi 适配；只有外部 Embedding/模型使用本地 HTTP 桩。覆盖资料选择→生成→核对发布→别名/BM25→互链→原文件下载→API进程重启→原文删除后不可召回、390px 窄屏，以及恶意 HTML 不执行/不加载远程图片。Wiki 截图已人工检查并加入用户手册。
- `pnpm concurrency:regression` 通过，`pnpm knowledge:acceptance` **5/5** 通过。`manual:generate` 随 renderer 构建执行；`node scripts/user-manual-regression.mjs` 通过，新增 8.5 操作说明与应用内产物。
- 测试修复记录：初次新增编排夹具缺必填 WikiContent 字段，补齐真实结构后重跑通过；首次浏览器模型桩只支持字符串 user content，Pi 实际传数组，修正桩兼容两种输入后通过；SDK 默认有传输重试，规格和手册已改为“一次逻辑生成”，不宣传单次 HTTP 或计费上限。
- 原文生命周期旧夹具与此前 T09a 的服务端目录分配/配置解析冲突，已改为使用保存后的规范配置，并显式保存/恢复关键词-only 设置，不削弱生产权限或错误断言。该专项及最终文档构建结果见下方补充。
- 收尾补充：`node scripts/core-ui-browser-regression.mjs --knowledge-lifecycle` 通过，覆盖真实 PDF/DOCX、入库失败/重试、父块上下文、关键词/向量、原文删除与进程重启；`pnpm docs:build`、`git diff --check` 通过，新增文件另做 no-index whitespace 检查，无 whitespace 报告（新增内容本身产生 diff exit 1）。保留既有 SQLite experimental 和 bundle >500 kB 提示。
- 仍未执行：真实供应商语义质量、30题生成评审、10k页性能、跨平台安装态。完整长文分阶段生成/续作、去重合并现有页面、界面编辑/差异与历史恢复不在本子集，T04/T06/T07 不标完成。模型资料会发给用户选择的供应商；重启不自动调用，生成不自动发布。

## WK-T09a 验证与边界

以下为此前权限阶段记录；后续顺序已按用户要求调整为先推进 T04a/T06a，不再先做 T09b。

- 新库归认证创建者；未指派库不出现在普通列表；管理员 API 仅展示待指派摘要，并只能指派给同组织有效用户。配置更新保留其他用户/未指派行；删除保留墓碑防止 ID 复活。第一次写既有配置前备份，原子替换失败不覆盖原件。
- 旧桌面 domain KV 配置只读兼容导入，不推断其 namespace 即所有者；冲突位置报错。桌面与 Web 改走同一 API，切换账号清理知识库缓存，保存失败恢复最近服务器快照。原文件不移动，未执行真实用户库归属变更或 SQLite 迁移。
- HTTP 知识库操作不再信任请求中的目录；Wiki/下载入口先检查库归属。数字员工 runner 使用持久化 Run 身份重新校验知识库；项目确认/重试/审批恢复向 contextResolver 传递持久化 owner，未改变调度、审批或数字员工职责。
- `pnpm --filter @workexpert/contracts build`、API/renderer typecheck、API/renderer build 通过。renderer 的 prebuild/pretypecheck 自动运行 manual generator，产物未发生内容变化；不等于已交付新权限操作手册。
- `pnpm --filter @workexpert/api test`：19/19，通过 WK-A03 9项（含真实 session/用户目录、默认 Embedding 恢复和写入故障），以及原文/Wiki原有回归。首次原文跨用户测试仍期待400；依据新库级404契约更新断言后重跑，不改变拒绝访问结果。
- `pnpm --filter @workexpert/orchestrator test`：54/54，通过；新增持久化项目 owner 传递用例。首次新增测试缺必填 workspacePath 导致编译失败，补齐测试夹具后重跑通过。
- `pnpm concurrency:regression`：通过（包含 dsh MCP/Skills、AgentScope sidecar 与多用户队列桩）；`pnpm knowledge:acceptance`：5/5通过。没有真实模型调用。
- `pnpm docs:build`、`git diff --check`：通过。首次文档构建因未加代码标记的 `<id>` 被解析为 HTML 而失败，修正标记后重跑通过；保留既有 bundle 大小及 SQLite experimental 提示。
- 未执行浏览器/安装态/管理员指派 UI 验收：本子阶段没有该界面，仅调整配置客户端与 API；未执行旧个人 namespace/跨上传者继承验收，T09b尚未实现。现有共享 Provider 设置和直接云厂商管理接口不是完整租户凭证隔离，不声称全应用多租户安全。
- 新配置 schemaVersion=2；SQLite不变。回滚不能用旧全量配置保存覆盖新归属，建议停服务保留配置和备份后评估，原文件/证据/修订不删除。下阶段 T09b 完成后再恢复 Wiki 生成任务与浏览 UI 的主线。

## WK-T02 验证与限制

- `pnpm --filter @workexpert/contracts build`：通过。
- `pnpm --filter @workexpert/storage test`：30/30 通过，其中新增 Wiki 14 项，覆盖非法契约、迁移回滚、草稿隔离、发布/FTS原子性、幂等、双连接 CAS、中文/编号/别名、一跳、历史访问、来源失效及失效失败回滚原文事务。
- `pnpm --filter @workexpert/agent-core test`：174/174 通过。新增 WK-E01 foundation 使用真实原文归档、SQLite、LanceDB 和版本化入库/删除；测试构造草稿、仅 Embedding mock，不冒充模型生成或浏览器验收。
- 首轮新增集成测试因将带 knowledgeBaseId 的 WikiScope 直接传入 strict FileOwner 契约而失败；修正测试宿主适配，显式取 orgId/userId，授权检查读取原文引用元数据，原始字节验证在写事务外完成。最终专项及全量重跑通过，未放宽契约或断言。
- `pnpm --filter @workexpert/api test`：6/6 通过；API typecheck、CJS build 通过。
- `pnpm knowledge:acceptance`：5/5 通过，原文关键词基线未退化。
- Electron 37.10.3 的 Node 模式运行 `packages/storage/dist/test/knowledge-wiki-store.test.js`：14/14 通过；初次猜测顶层 node_modules/electron 路径不存在，改用 desktop 依赖实际解析路径后运行。不是 Electron 安装态验收。
- `pnpm docs:build`：通过，仍有既有 bundle >500 kB 提示；SQLite experimental 提示保留。Node v22.22.1。
- `git diff --check`：通过；新增文件另做 no-index whitespace 检查。
- 未运行 Wiki 模型生成、HTTP/UI、任务恢复、30题质量基准、10k页性能、真实模型、跨平台和安装态：相关功能尚未完成。本轮未改 orchestrator/并发/renderer，因此未跑编排并发、浏览器和手册回归；后续按任务门禁执行。

## 迁移、兼容与回滚

普通原文库仍创建 schema v4，原文读写兼容 v5/v6。当前首次显式生成会验证所选来源、执行 VACUUM INTO 一致备份、检查备份完整性/application_id/版本/批次数后升级 v6；v6 新增持久化任务，GET 不初始化。迁移失败回滚，备份保留不覆盖。已有 v6 不能交给旧 v4/v5 严格读写器直接降级；回滚应关闭 Wiki 入口并保留兼容读写器，不删除原文、修订或任务。按 db 技能仅在临时库验证迁移/失败回滚，没有迁移真实用户库。

正式用户手册已增加 8.5 小批量 Wiki 操作、实际测试截图、限制及原文变化说明，并生成应用内手册。完整 T08 门禁仍跟随完整 T04/T06/T07；小批量用户入口与工程闭环不等于真实模型质量和安装态验收。

## WK-T05a 个人 HTTP 阶段

- 用户选择个人 Wiki。新增 ADR-0007；不认领历史知识库，不新增共享权限，也不接 WeKnora Provider。
- 路由继承既有 session authGuard；测试专用身份注入不进入生产。管理员无跨用户读取特权；每次读取校验本人归档元数据和来源版本/删除状态。编辑和发布在写事务外校验原文文件完整性，事务内再次校验元数据。
- 服务端解析已保存配置，不接受客户端路径/身份/作者类型。GET 使用 existingOnly/readOnly，旧 v4 不升级、缺失库不创建；当前人工编辑不能创建第一页。目录使用 afterPageId；搜索为有上限 TopK，不支持签名游标或搜索翻页。
- `pnpm --filter @workexpert/contracts build`、`pnpm --filter @workexpert/storage test`（30/30）、`pnpm --filter @workexpert/api typecheck`、`pnpm --filter @workexpert/api test`（10/10，其中 WK-A02 4项）通过。初轮类型检查发现错误类导入名称不匹配，修正后重跑通过。
- `pnpm --filter @workexpert/agent-core test`（174/174）、`pnpm --filter @workexpert/api build`、`pnpm docs:build`、`git diff --check` 通过；保留已有 SQLite experimental 与文档 bundle 大小提示。
- WK-A02 使用真实 Fastify/SQLite/FTS/归档，覆盖跨用户/组织/管理员拒绝、来源撤销及块抑制、历史读取、草稿隔离、BM25、一跳/目录分页、CAS/幂等、人工作者固定、严格参数、GET无迁移。
- 未跑模型生成、浏览器、安装态、10k性能：本阶段未实现这些能力或改变 UI/编排。现有全局知识库设置的权限重构不在范围内，不能把个人 Wiki 隔离解读为整个应用多租户配置安全。
- 没有迁移真实用户库；未新增 schema 版本。关闭 Wiki 路由即可停止本阶段入口，保留所有原文与修订；已有 v5 库仍须兼容读写器，不做破坏性降级。

## 设计阶段历史验证

- 基线：`51fa72c` 的已有未提交工作区；Node v22.22.1；仅本轮文档变化。
- `pnpm docs:build`：通过，VitePress 完成页面渲染与链接检查；仍有 bundle 大于 500 kB 的提示，不代表设计评审通过。
- `git diff --check`：通过。
- Wiki 功能单测、迁移、E2E、性能、真实模型和安装态：未执行，尚未实现。
- `manual:generate` / `manual:regression`：未执行，正式手册未修改；按 WK-T08 在实现后同步。

以上历史记录仅描述文档准备阶段；当前任务状态以本页上方表格为准。
# WK-T12 生成进度反馈 · 2026-10-19

已实现独立生成进度卡、真实文本块比例、保存页数、等待计时、首批等待说明、取消确认及轮询中断反馈；终态停止动画，支持减少动画偏好。无接口、存储或权限变化；用户手册已同步。

验证：`pnpm --filter @workexpert/renderer build`（含 vue-tsc）通过；`node scripts/core-ui-browser-regression.mjs --wiki` 通过，新增 WK-P-T01 覆盖运行中 0%、等待说明、取消入口、完成 100% 与停止动画；既有生成/编辑/发布/长文/来源回溯回归保持通过。已查看真实浏览器进度卡截图。测试使用临时数据和本地模拟模型，不涉及用户业务库或真实模型计费。构建存在既有大 bundle 警告。轮询断线、取消确认及 reduced-motion 分支未单独做浏览器自动化验收。
# WK-T13 Wiki 首页 · 2026-10-19

已实现应用内首页入口、已发布主题导航卡片、草稿预览目录、正文返回目录及分页加载。复用既有阅读/关联链接/来源链路，不新增公开站点、权限、模型调用或数据结构。生成失败不会产生首页内容；未发布草稿仅在预览目录显示。用户手册已同步。

验证通过：`pnpm --filter @workexpert/renderer build`（含类型检查）、`node scripts/core-ui-browser-regression.mjs --wiki`、`pnpm docs:build`、`git diff --check`。新增 WK-H-T01 覆盖草稿隔离、首页卡片→正文→关联页面→返回首页；既有批量发布、编辑、长文生成、重启和窄屏回归通过。已检查首页浏览器截图。使用临时库及模拟模型，未调用用户真实模型；构建保留既有 bundle 大小警告。无迁移，回滚 UI 不影响现有页面。
# WK-T14 引用可靠性与独立网页 · 2026-10-19

已实现：模型侧 source_N 短引用，精确恢复真实 chunkId 后继续严格证据/完整覆盖/页面链接校验；不自动重试或接受虚构引用。独立全屏 sandbox 网页及外部浏览器只读快照入口，已发布/current 页面分页读取，容量上限、纯文本转义、CSP 禁止脚本与联网，本地锚点互链；桌面通过受主窗口 sender 校验的 IPC 写入权限0600的临时HTML，正常退出清理。旧任务不自动恢复，新生成需用户发起；未发布草稿不导出。用户手册已同步。

验证通过：agent-core test 188/188；API test 32/32；`node --experimental-strip-types --test scripts/wiki-reader-regression.mjs` 1/1；agent-core/API/renderer 构建，desktop typecheck，desktop main 语法检查，docs:build。`core-ui-browser-regression.mjs --wiki` 最终通过（模拟模型实际收到 source_N 并还原证据），包含独立网页及外部新标签页。首次浏览器回归发现 srcdoc 锚点跳离阅读页，已改为独立 Blob URL 并重测通过；已检查外部阅读截图。既有大 bundle 警告保留。

未验证：用户真实模型再次生成、Electron 重启后的 OS HTML 默认程序启动；不能承诺模型输出永不失败。新桌面IPC需完全重启应用；快照不实时同步/不做后续撤回，异常退出的临时文件及用户另存副本可能留存。无数据库迁移，回滚相关代码不删除已有 Wiki。
# WK-T15 独立窗口与单篇视图 · 2026-10-19

已实现桌面独立 BrowserWindow（禁用脚本/Node，无 preload，阻止跨文档导航，不绑定主窗口关闭动作），Web 独立标签页；保留外部浏览器入口。快照以纯CSS :target/:has切换首页与单篇正文，互链及历史前进/后退可用，不再在首页铺开正文。快照仍含全部授权导出的已发布内容，隐藏视图不构成新的访问权限。无数据迁移，用户手册已同步。

验证：renderer build（含类型检查）、desktop typecheck/main与preload语法检查、快照单元回归、docs:build、git diff --check 通过；完整Wiki浏览器回归通过，WK-R16-T明确断言首页0篇可见正文、主题页1篇正文、首页卡片隐藏、互链/后退/返回及关闭标签后工作台未关闭。Electron 原生新窗口关闭隔离未实机操作验证；需完全重启桌面应用加载新IPC。既有构建大bundle警告保留。
# WK-T16 关联页面扩展 · 2026-10-19

已实现知识库配置 wikiRelatedExpansionEnabled（缺省false），置于Wiki融合开关之下，关闭主开关时禁用但保留设置。仅统一召回生效；前3个Wiki直接命中、每页5个出链候选、一跳最多3页，词项重合筛选、去重、发布/来源检查及最终版本校验；最相关关联页占首命中后的补充位置，避免小topK永远不可见。WikiRecall.expansion保留起点和深度，召回详情展示“Wiki一跳关联扩展”。不新增模型调用/索引/数据库迁移；用户手册与ADR已同步。

验证通过：agent-core test 189/189（含WK-X02及真实存储WK-X03）；API test 32/32；contracts、API、renderer构建；docs:build；git diff --check。完整Wiki浏览器回归通过，覆盖默认未勾选、勾选保存/刷新、关闭主开关时禁用并保留子设置，既有阅读/发布/生成回归保持。第一次测试遇到测试夹具缺enabled以及重复保存未保留库路径，已修正夹具并重跑通过；未放宽生产校验。

测试使用临时库与模拟模型，未调用真实模型。此结果证明功能闭环，不证明业务准确率提升；关键词相关性不是语义相关性，需用业务题集决定是否启用。回滚或关闭开关不删除页面，旧知识库默认不扩展。构建存在既有bundle大小警告。
# WK-T17 生成阶段与显式重新生成 · 2026-10-21

已实现并通过本轮工程验证。任务保存实际阶段与批次，失败/取消/中断保留最后阶段；进度卡保持原有布局，详情默认折叠。重新生成仅预选仍可用的原资料，用户再确认才使用当前模型与最新资料创建新任务；列表失败清空选择，已有草稿不覆盖。不是断点续算，不增加模型自动重试，不接统一 Reranker；候选检查点/跨任务合并仍待后续。

已通过：`pnpm --filter @workexpert/contracts build`；orchestrator test 62/62；storage test 33/33；API build/test 33/33（均使用 `pnpm --filter @workexpert/<包> <命令>`）；renderer build（含 vue-tsc）；`pnpm concurrency:regression`；`node scripts/user-manual-regression.mjs`；`pnpm docs:build`；`git diff --check`。手册生成由 renderer prebuild 执行。已检查浏览器进度截图。第一次完整 Wiki 浏览器回归被旧“召回测试”定位阻断（现有界面已经改为“召回验证”表单），仅更新测试定位、保留原断言后，`node scripts/core-ui-browser-regression.mjs --wiki` 重跑全部通过，含阶段展示、详情默认折叠、重新生成预选/确认前零调用，以及原有长文生成、发布、搜索、来源、独立阅读、重启与删除闭环。

无表迁移，旧任务可读且不猜测阶段；新增可选 JSON progress 字段，回退须保留新 contracts 兼容读写层，不将已写新字段的数据交给旧 strict schema。测试使用临时库及本机模型桩，未调用真实模型、未验证安装态；构建存在既有 bundle 大小警告。关联 [WK-D17 / WK-D17-T](generation-diagnostics.md)。
# WK-T18 显式断点续跑 · 2026-10-21

已实现并通过本轮工程验证。已校验批次、稳定归并结果保存在任务私有版本化检查点，与进度原子写入；恢复只处理未完成批次，保存失败复用同一组页面及幂等键。源快照、模型身份及批次方案变化拒绝继续。新任务支持继续，旧任务不回填；最多20次显式恢复，重复请求不会重复调用，完成清理候选。任务列表活动优先、更新时间排序，续跑旧任务仍可见；本次计时不包含之前停放时间。页面人工修改仍由CAS保护，公开任务API不返回候选正文。

本轮仅交付 WK-T18，跨任务增量合并、来源更新入口、检索诊断和阅读维护待后续；按用户要求不做统一 Reranker 和召回质量评测。用户手册及应用内生成产物已同步。

已执行通过：contracts build、orchestrator test 65/65、storage test 33/33、API build/test 35/35、renderer build（含类型检查）、concurrency:regression、user-manual-regression、docs:build、git diff --check。命令分别为 `pnpm --filter @workexpert/<包> build/test`、`pnpm concurrency:regression`、`node scripts/user-manual-regression.mjs`、`pnpm docs:build`。首次浏览器运行在测试服务正常退出时超过10秒，保留断言并增加失败诊断，第二次及最终 `node scripts/core-ui-browser-regression.mjs --wiki` 均完整通过。覆盖续跑取消确认零调用、确认后沿用原jobId到完成，原有长文/发布/搜索/互链/阅读/重启/删除路径保持；已检查续跑进度卡截图。首次退出超时未稳定复现，保留诊断，不宣称已定位根因。

测试仅临时SQLite/文件与本机模型桩，不触碰用户库，不执行真实模型/业务质量评测；未验证安装态与真实供应商异常退出时计费。无表迁移；回滚须保留新storage/contracts兼容读取器，不将私有字段交给旧strict reader；失败任务候选仍保留，不自动删除历史。构建仍有既有bundle警告。详见 [WK-R18 / WK-R18-T](resumable-generation.md)。
