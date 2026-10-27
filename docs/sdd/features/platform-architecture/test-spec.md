# 平台架构基线测试规格

> 状态：待执行  
> 规格版本：1.0.0  
> 更新日期：2026-10-27  
> 说明：本文件定义验证入口；实际结果只记录在 `status.md`，不会因脚本存在而标记通过。

| 编号 | 覆盖需求 | 验证方式 | 通过标准 |
| --- | --- | --- | --- |
| PAB-TEST-001 | 001, 004, 009 | `pnpm typecheck`、`pnpm test` | workspace 类型和包单测通过 |
| PAB-TEST-002 | 002 | renderer typecheck/build；检索 Node/Electron import | renderer 生产构建通过且无越界依赖 |
| PAB-TEST-003 | 003, 005 | contracts/agent-core 单测和依赖审查 | 公共 schema 可解析，模型适配不出现在其他包 |
| PAB-TEST-004 | 004, 007, NFR-003 | `pnpm concurrency:regression`、`pnpm durable-task:regression` | 调度、续跑、取消和并发回归通过 |
| PAB-TEST-005 | 006 | gateway/channel 单测与 stub smoke | 白名单拒绝、会话映射、消息回传通过 |
| PAB-TEST-006 | 008, NFR-002 | secret/domain KV 负向审查与相关 API 测试 | 公共响应和域文件不出现秘密字段 |
| PAB-TEST-007 | 010 | tool/skill/workspace 单测 | 写入、脚本、网络和路径越界被策略拒绝 |
| PAB-TEST-008 | 011 | knowledge acceptance 与 Wiki 生命周期测试 | 权威证据、可见性、派生页失效语义通过 |
| PAB-TEST-009 | 012 | 各专项 regression/smoke | 失败与降级可观测，终态不造假 |
| PAB-TEST-010 | 文档同步 | `pnpm manual:generate && pnpm manual:regression && pnpm docs:build` | 应用内手册产物与源一致，链接与站点构建通过 |

真实 Provider、Telegram/飞书真机、Relay 公网、桌面安装包需在发布验收中单独执行；无头桩通过不能替代这些验证。
