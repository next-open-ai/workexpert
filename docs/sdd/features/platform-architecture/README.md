# PAB-001 · WorkExpert 平台架构基线

> 文档状态：待评审  
> 规格版本：1.0.0  
> 更新日期：2026-10-27  
> 逆向基线：当前仓库源码、Accepted ADR 与 `docs/architecture/architecture.md`

本规格包把 WorkExpert 已实现的平台边界逆向整理为可追踪的 SDD。它约束“系统由哪些运行单元组成、依赖朝哪个方向、状态和密钥由谁写、公共契约在哪里定义”，不替代各业务功能 SDD。

- [需求](requirements.md)
- [架构规格](architecture.md)
- [边界契约](contracts.md)
- [任务](tasks.md)
- [测试规格](test-spec.md)
- [追踪矩阵](traceability.md)
- [状态](status.md)
- [ADR 决策体系分析](../../../architecture/adr/analysis-2026-10-27.md)
- [ADR 可视化附录：分层架构与部署拓扑图](../../../architecture/adr/diagrams.md)

## 范围

覆盖 Desktop Main、Renderer、API、Gateway、Agent Core、Orchestrator、Contracts、Tools、Storage、Channel 及 AgentScope/dsh sidecar 的平台边界。知识、Wiki、模型能力、项目编排等详细行为仍以各自功能 SDD 为准。

## 文档优先级

安全红线和 Accepted ADR 高于本规格；本规格高于专题实现说明中的历史描述。发现冲突时不得通过本规格反转 ADR，应新建 ADR 并标明替代关系。
