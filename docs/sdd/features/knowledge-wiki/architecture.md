# Wiki 架构设计

2026-10-21 WK-R18 → WK-T18 → WK-R18-T：[显式断点续跑](resumable-generation.md)替代下文“候选仅内存/不能续跑”的历史限制。旧任务仍只能重新生成，新任务按私有检查点恢复；不自动调用模型，实际验证见 status。

状态：实施中；规格版本：0.2；更新日期：2026-10-16。关联：[ADR](../../../architecture/adr/0006-evidence-driven-wiki.md)、[契约](contracts.md)。本文为目标架构，已实现范围以 status 为准。

## 1. 模块所有权

| 模块 | 职责 |
| --- | --- |
| contracts | Zod Wiki DTO、证据关联、状态和错误码，禁止复制类型 |
| storage | evidence SQLite Wiki 表、短事务、CAS、全文投影、检查点、审计 |
| agent-core | 文档/块候选抽取、主题归并、生成、输出结构验证；唯一模型调用层 |
| orchestrator | Wiki 服务编排、任务状态转换、预算、取消和重试，注入仓储与模型执行器 |
| apps/api | 认证、作用域解析、授权、路由装配；API 进程唯一运行写入者 |
| renderer | 页面浏览、草稿审阅和进度展示，不直连文件、SQLite 或模型 |

Wiki 任务不强制变成项目任务，也不重写项目、数字员工、既有本体审批状态机。编排层定义 Wiki 审阅动作并沿用宿主身份/审计规则，避免将 Wiki 草稿写入本体事实候选表。

## 2. 数据模型与事务

在现有每库 evidence SQLite 增加 wiki_ 前缀表。WK-T02 的 v5 包含页面、不可变修订、章节定位、证据索引、互链、FTS、幂等回执和审计；WK-T04a 的 v6 增加 wiki_generation_jobs 元数据/逐页检查点，不修改 v5 含义。普通证据库保持新建 v4，显式生成经过 VACUUM INTO 一致备份、完整性/版本/批次数核验后升级，旧原文功能兼容 v5/v6。生成编排状态由 orchestrator 管理，API 适配 SQLite 仓储；模型密钥只留调用内存。全量目标与当前有界子集的差异见 closure。

完整目标模型：

| 表 | 核心键/字段与约束 |
| --- | --- |
| wiki_pages | pageId PK、scope、slug、publishedRevisionId 可空、draftRevisionId 可空、generation、archivedAt；scope+slug 唯一 |
| wiki_revisions | revisionId PK、pageId、parentRevisionId、title、summary、bodyMarkdown、aliases、categoryPath、contentHash、authorType、createdBy/At；不可变 |
| wiki_sections | revisionId+sectionId PK、headingPath、正文 UTF-16 半开区间；正文仅在 revision 中权威保存 |
| wiki_evidence_refs | revisionId+refId PK、sectionId、完整 KnowledgeEvidence、引用摘录摘要；按 documentId/version/revision/chunk 建反查索引 |
| wiki_links | revisionId+targetPageId+anchor PK、kind=mention；目标必须同库，反向链接按 targetPageId 索引 |
| wiki_search_pages | rowid、pageId UNIQUE、revisionId、规范化标题/别名/摘要/正文 token；可重建投影 |
| wiki_fts | external-content=wiki_search_pages；发布/撤回时事务内同步 |
| wiki_jobs / wiki_job_items | jobId、主体、请求摘要、预算、状态、检查点；item 记录输入块及 processed/failed/skipped 状态 |
| wiki_audit | eventId、actor、动作、目标与基线版本、时间、结果；不记录密钥和完整原文 |
| wiki_mutations | scope+operation+idempotencyKey 唯一、请求摘要、元信息回执；与写入同事务 |

当前 revision 使用不可变 JSON payload 保留完整契约（含 headingPath、全部证据字段），sections/refs/links 是同事务生成的关系索引，并非另一份可独立编辑的真相源。evidence_refs 的 source_scope 包含 provider/knowledgeBaseId/documentId，与 processingRevisionId/chunkId 联合定位原文；版本与摘要仍在完整 revision payload 中核验。

目标授权 scope 为知识库（ADR-0008），当前 v5 仍存 orgId、ownerUserId、knowledgeBaseId 的个人 namespace，WK-T09b 负责兼容迁移，不能直接删除用户过滤。服务端根据知识库归属定位数据库，不接受客户端路径。slug 用于展示，互链以 pageId 为准；改名不改 ID。别名不要求全局唯一，有歧义返回多页。章节 ID 在单个修订内稳定，不假定跨修订标题相同就代表同一段。

发布事务：校验页面 generation 与来源有效头 → 插入不可变修订/章节/引用/链接 → 切发布指针 → 替换全文投影 → 写审计。模型生成、读取文件、网络请求不占数据库写锁。保存草稿不更新公开 FTS。

来源有效头切换/删除/块抑制与 Wiki 依赖失效使用同一数据库事务；独立来源权限变化无法同事务时，所有读取/搜索/扩展/历史接口必须实时复核，失败关闭。源版本更新后过期页面保留授权浏览并显著提示，但移出默认搜索/扩展；源删除、抑制或失去证据读取权时整页阻断正文与摘要，防止派生泄露。不允许“引用链接隐藏了但正文还在”的降权。

## 3. 生成流程

当前已实现子集见 [0.7 有界分批](batching.md)：orchestrator 顺序运行最多 8 个批次，agent-core 校验全部引用并保守汇集同名候选；API 每批调用前及逐页保存时重新校验整个输入快照。中间候选只在内存，SQLite v6 仍保存逐批块计数与逐页检查点，不新增表。以下已有页面匹配、长块切片、增量续作等是完整目标，不代表已交付。

1. 用户显式选择已入库文档，预检权限、版本、模型配置和预算；冻结有效批次与完整块清单。
2. 读取标题、headingPath 和必要父上下文建立主题候选；父块只提供上下文，不在覆盖率中重复计数。
3. 遍历全部选定子块，输出候选主题和指向输入句段的引用；长块按预算切片并保留位置映射。不通过搜索 TopK 代替遍历。
4. 对照已有页面标题/别名/摘要建立合并建议；同名不同义保留独立主题/待确认项，稳定排序后串行提交同页草稿。
5. 生成带章节及 refId 的 Markdown；验证引用存在、作用域、摘要、位置和有效头；没有证据的事实不得进入可发布草稿。
6. 识别文中主题提及，解析为实际 pageId；未解析链接作为草稿问题，不凭空创建空页面。保存原子草稿及检查点，待人工核对后发布。

原文更新只标记过期并提示“更新草稿”，首期不自动触发付费模型。只重处理受影响文档和页面；旧支持关系只有在新修订发布时替换，历史不覆写。一个任务产出多页允许逐页审阅；存在未处理/失败块时任务为 partial，页面必须通过完整证据校验，不能把 partial 标成全库完成。

## 4. 首期查询与浏览

0.11扩展：依据ADR-0009/WK-T10，新增可选统一召回，按库关闭/开启；既有原文排序与Wiki词法排序作为两类候选做外层RRF。可信访问上下文由API生成，agent-core复用storage只读访问，不新增schema或Wiki向量。详细身份/来源/错误边界以contracts 0.11为准；下文独立Wiki检索仍保持。

空查询返回目录，不全表模糊扫描。非空查询：权限过滤 → 标题/别名规范化精确匹配 + FTS 候选 → 同 pageId 去重 → 排序 → 有界片段 → 可选一跳。

排序为确定性元组：精确标题优先、精确别名其次、其余 FTS；同档使用 BM25（较小值更优），随后 pageId 稳定打破平局。初始 FTS 列权重标题 5、别名 4、摘要 2、正文 1，属于可评测参数而非质量承诺。沿用 knowledgeTokens；查询构造器转义字面词，不直接执行用户 FTS 表达式；设置长度、token 与结果上限。

首期一页一条全文结果，所谓页面聚合主要是精确与 FTS 去重；以后章节检索才需多章节归页。摘要片段来自命中修订，不拼接历史正文。不将 Wiki 引用数量作为独立证据数。

一跳只读取直接出链/反向链接的当前可访问已发布页面，排除自环、归档、过期和已返回项；按稳定 ID 去重，深度固定 1。普通搜索默认不扩展；浏览相关页按需请求。扩展作为 related 单独返回，注明 seedPageId、方向，不冒充直接命中。不递归加载全文，不调用 Neo4j。

## 5. 安全与扩展

首期依据 ADR-0008 改为知识库授权：新库归创建者，旧库管理员指派，库内最终继承权限，不建设页面/文档 ACL。WK-T09a 已接库级入口守卫，但旧来源上传者和 Wiki namespace 兼容归 T09b；过渡期间额外限制仍保留。无权限和不存在的资源统一 404；认证缺失为 401。客户端 Markdown 禁用原始 HTML、脚本、危险 URL、远程图片自动加载；外链显式打开，不服务端抓取。模型输出不能直接执行 SQL、路径或工具动作。

为未来外部来源预留 discriminated source identity，当前仅启用 local-evidence，其他类型拒绝。MediaWiki 接入应独立定义站点+pageId+revisionId、格式转换、移动/删除/权限同步。统一搜索的词法融合已由 ADR-0009 落地；Wiki 语义索引仍待独立设计，不把派生 Wiki 冒充原始 KnowledgeEvidence。
