# 证据驱动的知识 Wiki

状态：实施中；规格版本：0.12；更新日期：2026-10-18。

本规格承接 KE-07 / KE-T05。目标是在现有知识库中提供可生成、审核、浏览、检索、互链和追溯的 Wiki，不依赖本体、图数据库、Wiki 向量或外部 Provider。已接通有界分批生成、同名主题汇集、按章节编辑/版本对照、核对发布、浏览检索与来源回溯；语义消歧、已有页面合并、断点续算和历史恢复仍待后续，实际验证见 status。

## 阅读入口

| 文档 | 内容 |
| --- | --- |
| [ADR-0006](../../../architecture/adr/0006-evidence-driven-wiki.md) | 长期取舍、备选、后果 |
| [ADR-0009](../../../architecture/adr/0009-optional-wiki-retrieval.md) | 可关闭Wiki融合召回，详细契约见contracts的WK-T10 |
| [requirements](requirements.md) | 需求、边界、成功条件 |
| [ownership](ownership.md) | WK-13 / WK-T09a/b 库级归属、旧库指派、迁移与测试契约 |
| [closure](closure.md) | 0.5 小批量闭环范围、接口、限制与验收 |
| [batching](batching.md) | 0.7 长文有界分批、同名主题汇集、兼容与验收 |
| [生成反馈优化](contracts.md) | 0.8 严格围栏兼容、失败分类与处理建议 |
| [直接打开与页面章节树](ui.md) | 0.9 卡片直达、页面展开、章节定位 |
| [多选和全部发布](ui.md#wk-t06d-多选和全部发布-0-10-2026-10-17) | 0.10 左侧选择、跨分页全选、批量确认和逐页结果 |
| [architecture](architecture.md) | 模块、存储、生成与检索设计 |
| [contracts](contracts.md) | 数据、接口、权限和错误语义 |
| [state-machine](state-machine.md) | 任务、草稿、发布和过期状态 |
| [ui](ui.md) | 简洁交互、异常态与浏览路径 |
| [plan](plan.md) | 分期、迁移、运维和风险 |
| [tasks](tasks.md) | 实施任务、依赖与完成条件 |
| [test-spec](test-spec.md) | 分层测试与验收门禁 |
| [traceability](traceability.md) | 需求—任务—测试追踪 |
| [manual-plan](manual-plan.md) | 实现后的用户手册同步要求 |
| [status](status.md) | 唯一任务状态与实际执行证据 |

基线：[统一知识证据](../knowledge-evidence/README.md)、[全局架构](../../../architecture/architecture.md)。本包未接线的 API、模型生成和 UI 不得作为已上线能力宣传。
