# Architecture Decision Records

ADR 记录影响多个模块、长期难以逆转或需要明确替代方案的架构决策。编号一经分配不复用；已被替代的 ADR 保留并标注状态。

既有架构结论以 [全局架构](../architecture.md)、专题设计和各 ADR 为准，后续重大取舍应新增 ADR。

- [ADR 可视化附录：分层架构与部署拓扑](./diagrams.md) — 逻辑分层、控制/执行面、数据安全边界和部署网络拓扑；不单独产生新决策。
- [ADR 决策体系分析（2026-10-27）](./analysis-2026-10-27.md) — 当前 ADR-0003～ADR-0009 的决策链、SDD/实现对应与治理缺口；不产生新决策。
- [ADR-0003：图片能力与 Provider 协议分离](./0003-image-generation-provider-protocols.md) — Accepted。
- [ADR-0004：知识原文、证据与检索副本分离](./0004-knowledge-source-snapshots.md) — Accepted。
- [ADR-0005：SQLite 全文检索与本地混合召回](./0005-local-hybrid-retrieval.md) — Accepted。
- [ADR-0006：证据驱动的原生 Wiki 与轻量页面检索](./0006-evidence-driven-wiki.md) — Accepted，分阶段实施中。
- [ADR-0007：首期个人 Wiki 授权边界](./0007-personal-wiki-authorization.md) — **Superseded / 已替代**，目标被 ADR-0008 替代，保留阶段历史。
- [ADR-0008：知识库作为唯一内容授权边界](./0008-knowledge-base-ownership.md) — Accepted，旧库管理员指派，分步实施。
- [ADR-0009：可关闭的 Wiki 融合召回](./0009-optional-wiki-retrieval.md) — Accepted，保留派生来源、库级开关与分层RRF。

ADR-0001、ADR-0002 已退出当前架构体系；编号不复用，历史原文仅在 [归档](../../archive/adr-not-architecture/README.md) 中保留。
