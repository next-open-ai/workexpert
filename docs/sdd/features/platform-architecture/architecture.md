# 平台架构规格

> 状态：待评审（实现逆向基线）  
> 规格版本：1.0.0  
> 更新日期：2026-10-27  
> 关联：[需求](requirements.md) · [边界契约](contracts.md) · [全局架构](../../../architecture/architecture.md)

配套图形见 [ADR 可视化附录：逻辑分层、运行时、数据安全与部署网络拓扑](../../../architecture/adr/diagrams.md)。

## 1. 系统上下文

```text
Desktop Renderer / Web Browser / Telegram / Feishu / Relay client
                     │
        ┌────────────┴────────────┐
        │                         │
 Electron Main                Gateway
 (window, IPC, secrets,       (transport adapters,
 child processes)             identity allowlist)
        │                         │
        └────────────┬────────────┘
                     ▼
              Fastify API (loopback)
          auth · routes · domain single writer
                     │
        ┌────────────┼─────────────┐
        ▼            ▼             ▼
  Orchestrator    Agent Core     Storage
  session/run/    model/tool/    file/evidence/
  project/task    capability     wiki repositories
        │            │
        │       ┌────┴──────────┐
        │       ▼               ▼
        │   in-process pi   AgentScope / dsh
        │                    sidecar processes
        └──────── AgentEvent / OrcEvent ────────>
```

所有入口最终进入 API 的鉴权与服务端上下文组装。Gateway 只把外部消息映射为统一通道消息和编排请求；Renderer 只通过 HTTP/SSE 或 Desktop preload 暴露的受限 IPC 使用平台能力。

## 2. 运行拓扑

| 运行单元 | 主要职责 | 禁止职责 | 生命周期 |
| --- | --- | --- | --- |
| Electron Main | 窗口、preload、safeStorage、子进程、桌面文件/平台动作 | 模型推理、业务编排 | 桌面应用主进程 |
| Renderer | UI、客户端状态、API/SSE 调用 | Node/Electron 直连、密钥读取、授权裁决 | 浏览器/Vue |
| API | 鉴权、路由、服务端上下文、域 KV 单写、静态 Web 托管 | 将凭据返回客户端 | 本地 Fastify 进程 |
| Gateway | 通道适配、白名单、会话映射、指令转发 | 自建业务状态机、直接模型调用 | Desktop fork 或独立进程 |
| Agent Core | 唯一模型执行、工具/Skill/MCP、能力模型、后端适配 | 持久化会话真相 | API 内库 + sidecar 客户端 |
| Orchestrator | 会话/run/审批、滚动记忆、项目 DAG、durable task、事件 | Provider 凭据管理、UI 行为 | API 内服务 |
| Sidecar | 隔离具体执行引擎，映射统一事件 | 写平台域状态 | 子进程/进程池 |

Desktop 模式由 Main 启动 API/Gateway；Web Launcher 启动 API 并托管 renderer 静态文件；Docker 是 Web 形态的部署包装。公开数据应用/手机传文件路由可在鉴权区外注册，但必须各自持有显式的 token/范围校验，不能因此放宽受保护 API。

## 3. 依赖方向

```text
apps/renderer ──HTTP/IPC types──> apps/api / preload boundary
apps/gateway  ──channel/orch────> apps/api
apps/api      ──> orchestrator ──> agent-core
apps/api      ──> storage
agent-core    ──> contracts + tools
orchestrator  ──> contracts (+ injected runner/storage)
storage       ──> contracts
channel       ──> contracts or transport-neutral own types
```

关键不变量：

- 禁止 renderer 反向依赖 Node/Electron；
- 禁止其他包直接引入模型 SDK 绕过 agent-core；
- 禁止 Gateway 或 Desktop Main 成为域数据的并行写者；
- 编排层通过注入 runner、repository、dispatcher 保持可测试，而不是感知具体 Provider。

## 4. 请求与事件主链

### 4.1 对话/run

1. API 鉴权并依据持久化用户、员工、模型、Skill、MCP 和知识库配置组装运行上下文。
2. Orchestrator 创建 run，dispatcher 按 session/user/global 容量调度。
3. Agent Core 解析执行后端，统一发出 `AgentEvent`。
4. Orchestrator 持久化结构事件；流式 delta 只透传，终态、审批、产物和用量形成可追踪记录。
5. 高风险工具进入 `waiting-approval`，决议后续跑同一业务 turn 的新 attempt。

### 4.2 项目

Plan 版本冻结任务和 DAG；ProjectRun 绑定 planVersion；ChangeSet 只失效目标和下游节点。任务 run 使用私有 run workspace，最终交付经显式发布或终态扫描晋升到 project workspace。过程脚本不得作为交付物自动晋升。

### 4.3 外部通道

Adapter → `UnifiedMessage` → Gateway 授权/会话映射 → `/api/orch` → 终态或流式 `UnifiedReply`。通道用户字符串白名单与本地账号仍是两套身份边界，不得把白名单命中解释为本地 owner 身份。

## 5. 状态、存储与密钥

| 数据 | 权威位置/写者 | 可重建或缓存 | 安全说明 |
| --- | --- | --- | --- |
| 会话、run、项目、domain KV | API/Orchestrator | UI 镜像 | API 单写；文档级锁保护并发更新 |
| Provider/搜索/通道密钥 | Desktop Main safeStorage 或部署时显式秘密注入 | 子进程内存快照 | 不进入 domain.json、renderer、普通日志 |
| 原文快照 | Storage 不可变文件对象 | 否 | 按组织/用户或知识库授权读取 |
| 证据/Wiki/治理状态 | SQLite | FTS 投影可重建 | 权威版本、发布与删除语义在同一治理边界 |
| 向量检索 | LanceDB | 是 | 不是证据真相源；必须受可见性过滤 |
| sidecar 状态 | dispatcher/pool 内存与观测接口 | 是 | 崩溃摘除、冷却和补位不得改变业务授权 |

## 6. 安全边界

- 服务端忽略客户端提交的 owner、org、数据库路径和凭据替代值；授权上下文来自当前认证和保存配置。
- Skill 仅在策略允许时写 workspace、运行自身脚本或访问明确 HTTPS host；工具审批不能被模型文本绕过。
- `workspace-isolation` 只提供路径/产物隔离，不等于 OCI/microVM 安全沙箱。
- 外部通道缺省拒绝；中继仅转发，不因此获得额外平台权限。
- Wiki 是原文证据的派生阅读材料；来源撤销或版本失效必须阻止旧派生内容泄露。

## 7. 可靠性与降级

| 场景 | 要求语义 |
| --- | --- |
| AgentScope/dsh 不可用 | 按明确配置失败或使用已声明的后端回退；不得伪造同等能力 |
| 安全沙箱不可用 | 只生成、提示配置，或经用户明确授权使用本机受限运行；禁止静默降级 |
| 向量检索失败 | 仅在关键词链可用且规格允许时显式降级；证据库异常不可绕过 |
| Gateway/IM 不可用 | 不影响本地 UI/API；报告通道状态与可操作错误 |
| 模型/工具取消 | 发出确定的 cancelled/failed 终态，释放 dispatcher/sidecar 容量 |
| 配置迁移失败 | 保留备份和旧数据，不以空配置覆盖原值 |

## 8. 可观测与验证面

- `AgentEvent`：run、reasoning/message delta、tool/capability、artifact、usage、终态。
- `OrcEvent`/SSE：会话、审批、项目、任务和文件发布变化。
- `/api/runtime/status` 与状态流：dispatcher、用户/全局容量、sidecar 池。
- 测试层：包单测 → API/脚本回归 → 浏览器回归 → 真实 Provider/真机/安装态验收。

## 9. 演进规则

本规格记录当前边界。改变单写者、密钥托管、模型调用归属、通道/编排分工、执行隔离或知识权威存储时，先新增 ADR；新增业务行为时建立独立功能 SDD，并从本规格追踪矩阵链接，不在本文堆积任务状态。
