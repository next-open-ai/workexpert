# 平台架构追踪矩阵

> 状态：待评审  
> 规格版本：1.0.0  
> 更新日期：2026-10-27

| 需求 | ADR/设计 | 实现证据 | 验证 |
| --- | --- | --- | --- |
| PAB-REQ-001 | 全局架构、运行形态 | `apps/desktop`、`apps/api`、`apps/gateway`、`scripts/start-web.mjs` | TEST-001, 005 |
| PAB-REQ-002 | AGENTS 分层红线 | renderer、preload、API service clients | TEST-002 |
| PAB-REQ-003 | ADR-0003、应用模型架构 | `packages/agent-core` capability/provider adapters | TEST-003 |
| PAB-REQ-004 | gateway-m0、project orchestration | `packages/orchestrator`、API orchestration routes | TEST-001, 004 |
| PAB-REQ-005 | SDD 工作流 | `packages/contracts` | TEST-003 |
| PAB-REQ-006 | gateway-m1/m2 | `packages/channel`、`apps/gateway/src/adapters` | TEST-005 |
| PAB-REQ-007 | gateway-m0、settings storage | API domain KV、Desktop storage forwarding | TEST-004, 006 |
| PAB-REQ-008 | settings storage | Desktop safeStorage、fork secret snapshot | TEST-006 |
| PAB-REQ-009 | execution backend、AgentScope ABI、dsh sidecar | execution backend registry、sidecar clients | TEST-001, 009 |
| PAB-REQ-010 | Skill 执行策略与 workspace 边界 | tools/skill runtime/workspace write | TEST-007 |
| PAB-REQ-011 | ADR-0004/0005/0006/0008/0009 | storage + knowledge runtime + Wiki | TEST-008 |
| PAB-REQ-012 | ADR 分析、专题架构 | dispatcher、event terminal states、health/runtime status | TEST-004, 009 |
| PAB-NFR-001～006 | 全局架构、工程规则、ADR 索引 | package boundaries、tests、docs | TEST-001～010 |

## 下游功能规格

| 平台能力 | 功能 SDD |
| --- | --- |
| 应用模型与统一工具 | `application-model-capabilities`、`unified-tool-interface` |
| 对话附件与持续任务 | `chat-attachments`、`conversation-durable-task` |
| 知识原文、证据、本体与 Wiki | `local-document-ingest`、`knowledge-evidence`、`ontology-rag-phase-1`、`knowledge-wiki` |
| 视觉、语音与展示 | `image-understanding`、`voice-input-v1`、`chat-markdown-presentation` |
| 发布与安装 | `release-readiness`、`windows-start-menu-registration` |
