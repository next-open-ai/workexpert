# Wiki 测试与验收规格

WK-U08另覆盖配置就绪但索引stale时显示“索引待重建”，不显示“索引就绪”；无状态时不伪造成功。

WK-U08：搜索协议浏览器回归覆盖初始/短查询/加载/空结果/失败与重试、旧请求隔离、排序分和路径默认折叠/键盘展开、没有实际本体路线不声称命中、有路线才提示；Wiki真实旅程覆盖统一设置保存/重载、开关状态标记、简短派生来源及打开页面。390px无横向溢出、输入有可访问名称。临时数据与模型桩，截图检查列表/搜索/设置；不以mock搜索代表真实召回质量。

WK-R04/U07：可关闭融合的正负场景与边界见contracts 0.11。临时真实SQLite/归档/FTS验证发布、来源、主体隔离与融合；本地模型桩浏览器验证保存开关/搜索标签/页面入口，禁止操作真实用户库。执行contracts/storage/agent-core/API测试构建及renderer类型、手册、浏览器回归。

## WK-U06：批量发布

通过真实 API/SQLite 浏览器回归验证：跨分页全选、取消确认零提交、多选发布、部分失败继续且可见、旧选择遇到修订变化拒绝、全部发布剩余草稿、发布后搜索可见；保留单页发布与预览回归。分页请求失败不得发布已收集子集。仅临时库和本地模型桩。

状态：实施中；规格版本：0.2；更新日期：2026-10-16。关联：[追踪](traceability.md)。用例是目标范围，已实现/执行的子集见 status，不以部分仓储测试代表完整 API/UI 验收。

WK-T02 实现入口：`packages/storage/src/test/knowledge-wiki-store.test.ts`；WK-E01 底层集成子集：`packages/agent-core/src/test/knowledge-wiki-lifecycle.test.ts`，使用真实文件归档、原文入库、SQLite/LanceDB 与 Wiki 仓储，草稿由测试显式构造、仅 Embedding mock；不是模型生成/API/浏览器 E2E。

| 测试 ID | 层级/场景 | 必须断言 |
| --- | --- | --- |
| WK-C01 | contracts DTO | 无版本/越界位置/非法链接/超限/未知 sourceKind 拒绝；派生页不冒充原文证据 |
| WK-S01 | storage 迁移 | 临时 v4→v5、事务故障回滚、未来版本拒读；旧批次/FTS/父块/删除状态保持 |
| WK-S02 | storage 发布 | 修订不可变、草稿不可检索、并发 CAS 仅一方成功；发布中断不产生正文/FTS不同版本 |
| WK-S03 | 生命周期 | 原文换版→stale，删除/块抑制→blocked；历史/摘要/反向链接/索引均不可回流 |
| WK-G01 | 生成 | 多文档多块到多页面、标题/父上下文、覆盖计数、歧义保留；虚构 refId/错摘要/跨库引用拒绝 |
| WK-G02 | 任务 | 取消、超时、有限重试、超预算、同 key 重试、进程中断与显式恢复；旧头变更不发布，人工编辑不覆盖 |
| WK-R01 | 词法召回 | 中文单字/双字、英文大小写、全半角、编号、标题与歧义别名；精确优先、同档 BM25 顺序、同页去重、稳定分页 |
| WK-R02 | 一跳 | 入链/出链、自环、环、重复、归档/草稿/过期/越权节点；最多10条、无二跳、related 不冒充 hit |
| WK-R03 | 索引与模型独立 | 无 Embedding/本体时词法可用，索引重建一致；FTS 故障明确报错而非空结果 |
| WK-A01 | API 安全 | 未登录、跨组织/owner/库/来源、批量混入、失去来源权限、历史读取；不存在与越权一致，无标题摘要泄露 |
| WK-A02 | 个人 Wiki HTTP 子集 | `apps/api/src/modules/knowledge/wiki-routes.test.ts`：真实 SQLite/归档、仅认证注入；401/其他用户/管理员/跨组织404，草稿不召回、BM25、历史拒读、来源删除/抑制、一跳、分页、CAS/幂等/人工编辑、未知参数与身份注入拒绝、GET 不迁移 v4、不创建缺失库 |
| WK-U01 | 浏览器交互 | 目录→页面→互链→来源→返回；空/错误/过期/草稿/冲突、窄屏和键盘；迟到请求与重复操作隔离 |
| WK-U02 | 渲染安全 | script/事件属性/javascript URL/远程图片不执行或隐式请求；模型原文指令不触发工具 |
| WK-E01 | E2E 真实存储 | 原文入库→生成草稿→核对发布→FTS召回→互链→原文定位→换版/删除；只模型可 mock，知识 API 不 mock |
| WK-E02 | 重启/恢复 | 正常重启后页面与FTS一致；受控崩溃检查点不重复提交，输入变化拒绝续作；只终止测试子进程 |
| WK-B01 | 性能/质量 | plan 中固定规模、延迟与磁盘指标；≥30条原创词法题，Hit@5/MRR@5/引用完整率；真实语义另评审 |
| WK-D01 | 手册 | 实际 UI 步骤、截图、限制与手册一致，生成产物更新，应用内目录/锚点/链接可用 |

## 数据与质量门禁

WK-U05 对应 WK-T06c：通过 `scripts/lib/wiki-ui-regression.mjs` 验证“打开 Wiki”直达、页面章节树展开/收起、同页操作不重复读取、章节定位与焦点、窄屏和原链路。交互契约见 ui，无接口或数据库变化。

WK-G01c/G02c/A07/U04 对应 WK-T04c（contracts 中生成反馈优化）：agent-core 解码与分类、orchestrator 安全错误持久化、API 可读错误码、Wiki 浏览器截断失败→明确原因→显式重新生成。不能以放宽来源校验换取生成成功。

WK-G01b/G02b/A06 对应 WK-T04b，边界及断言见 [有界分批](batching.md)，入口分别为 agent-core、orchestrator 的 wiki-generation.test.ts 和 API wiki-routes.test.ts。

WK-U03 / WK-A05 对应 WK-T06b：`scripts/lib/wiki-editing-ui-regression.mjs` 通过 `pnpm ui:wiki` 执行，真实服务覆盖多章节/UTF-16 区间、引用不变、别名去重、已发布隔离、保留历史、重新核对发布、未保存关闭确认、390px 窄屏、服务端已提交但客户端响应丢失后的幂等重试、CAS 冲突保留输入与只读对照。只在丢响应场景注入浏览器传输失败，服务端保存真实执行；不 mock 知识 API 结果。API `wiki-routes.test.ts` 增加 A05，验证新修订发布前后的搜索和历史隔离。

WK-G01a/G02a/A04/U01a 对应 [小批量闭环](closure.md)：分别为 agent-core `wiki-generation.test.ts`、orchestrator `wiki-generation.test.ts`、API `wiki-routes.test.ts` 的 A04，以及 `pnpm ui:wiki`。浏览器用真实 API、SQLite、LanceDB、归档和 Pi 适配，仅外部模型/Embedding 使用本机 HTTP 桩；覆盖核对发布、别名/正文查询、互链、下载、重启和删除。WK-S01a 验证 v4/v5→v6 备份及迁移失败回滚。

WK-A03：见 [库级归属规格](ownership.md)。入口 `apps/api/src/modules/knowledge/ownership-routes.test.ts`，另在 orchestrator/project 测试持久化 owner 传递。包含真实 session 登录/用户目录；测试模拟数据，不读真实配置。库级守卫测试不替代库内继承验收。

所有工程回归在 mkdtemp、隔离组织和虚构资料执行，不用真实用户库。词法固定题集至少覆盖精确标题、别名、正文、无匹配和删除；初始目标精确标题/唯一别名 Top1=100%，普通词法 Hit@5≥90%，越权/删除泄露=0、引用身份验证=100%。相关性目标未达必须分析并评审，不能删难题凑通过；这些数字不代表生成事实准确率。

业务验收检查人工采样陈述的支持程度、冲突呈现和关键资料覆盖；记录模型版本、prompt/recipe、语料版本和预算，未授权真实模型不执行。跨平台安装态单列，不用 Web E2E 或 Electron Node 模式代替。

## 运行门禁

实现阶段按修改范围运行 contracts build、storage/agent-core/orchestrator/API test 与 renderer build；涉及编排执行运行 `pnpm concurrency:regression`，涉及 dsh 再运行 `pnpm dsh:regression`。保持 `pnpm knowledge:acceptance`、`pnpm ui:knowledge:lifecycle` 现有基线；新增 Wiki E2E 命令在 T07 创建前不得声称存在。

文档阶段仅执行 `pnpm docs:build` 和 `git diff --check`；功能测试标未执行。手册阶段执行 `pnpm manual:generate`、`pnpm manual:regression`、`pnpm docs:build`，并检查生成 diff。每项结果在 status 记录命令、环境、范围及限制。
