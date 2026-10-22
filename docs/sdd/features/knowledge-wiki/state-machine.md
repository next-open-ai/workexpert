# Wiki 状态与一致性

2026-10-21 WK-R18 → WK-T18 → WK-R18-T：[显式断点续跑](resumable-generation.md)替代下文“候选仅内存/不能续跑”的历史限制。旧任务仍只能重新生成，新任务按私有检查点恢复；不自动调用模型，实际验证见 status。

小批量任务采用 [closure](closure.md) 的单次调用、中断不自动恢复策略；完整多阶段续作仍为后续目标。

状态：已接受；规格版本：0.2；更新日期：2026-10-16。关联：[契约](contracts.md)、[架构](architecture.md)。这是目标状态机，任务编排尚待实现。

## 页面不是单一状态枚举

页面分别维护发布指针、草稿指针、archivedAt；发布后仍可有新草稿。freshness 动态计算为 current/stale/blocked，不能用 published 覆盖它。检查失败默认 blocked，不展示敏感内容。

| 事件 | 结果 | 保证 |
| --- | --- | --- |
| 首次生成/编辑 | 新不可变草稿 | 不进入公开目录/FTS |
| 审阅发布 | 发布指向已审阅修订，清相应草稿，generation+1 | 内容、引用、链接、FTS、审计同事务 |
| 新草稿生成 | 原发布指针不变 | 不覆盖人工已发布正文 |
| 原文新版本发布 | 依赖旧版的页 stale，移出默认搜索/扩展 | 授权浏览带过期提示，等待更新 |
| 原文删除/块抑制/权限失效 | blocked | 正文、摘要、历史及邻居接口均不能绕过 |
| 页面归档 | archivedAt 非空，撤出索引 | 原文件/修订保留，入链显示不可用占位 |
| 历史恢复 | 历史内容复制为新草稿 | 不直接发布旧证据，不覆盖历史 |
| CAS 冲突 | 409，保留生成产物/编辑输入 | 用户比较后再提交，不最后写入获胜 |

首期不可逐句安全删除派生知识，因此只要有一个必要来源 blocked，整页正文阻断；管理页仅显示允许的状态元信息。用户可重新生成排除失效来源的草稿，经审阅后恢复页面。

## 任务状态

queued → running → completed / partial / failed / cancelled；running → interrupted（进程恢复时）；interrupted → queued 仅用户显式恢复。running 的 phase 为 snapshot/extract/merge/validate/save；取消先置 cancelRequested，在安全边界停止，不强行宣称中断在途供应商请求。

每块处理结果先落检查点，再推进计数；任务完成指“草稿生成结束”，不等于页面发布或事实验证完成。processed+failed+skipped=total 才可终结；全部 processed 且输出通过校验为 completed，有可用草稿但输入失败/跳过为 partial，无可用产物则 failed。无候选但全部处理成功可 completed 且 0 页，明确说明。

模型暂时错误最多额外重试 2 次，指数退避；鉴权、无配置、非法证据及超预算不重试。默认每库仅一个生成任务运行，单任务模型并发 1；复用宿主容量治理，不绕过全局/用户限制。每模型调用设 120 秒超时（供应商取消为尽力而为）；任务预算默认最多 100 次请求、200,000 输入 token、50,000 输出 token，UI 开始前显示估算，可下调。预算根据 tokenizer/供应商用量可用性分别标记 estimated/reported，不宣称准确金额；每次调用前预留最坏请求预算，超限停止为 partial/failed。

进程重启不自动续费调用；恢复复核全部输入头和页面基线，变化则 SOURCE_CHANGED。检查点避免重复保存草稿，但供应商超时后计费是否发生无法保证 exactly-once，需如实记录 unknown usage。
