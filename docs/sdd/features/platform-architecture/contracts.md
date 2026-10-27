# 平台边界契约

> 状态：待评审  
> 规格版本：1.0.0  
> 更新日期：2026-10-27  
> 关联：[需求](requirements.md) · [架构规格](architecture.md)

## 1. 公共契约事实源

| 契约族 | 事实源 | 消费者 |
| --- | --- | --- |
| Agent 引擎、能力、工具调用、事件、用量 | `packages/contracts/src/index.ts` | API、agent-core、orchestrator、renderer |
| 知识证据/归属/Wiki/评测 | `packages/contracts/src/knowledge-*.ts`、`retrieval-evaluation.ts` | API、storage、agent-core、renderer |
| 持续任务/模板任务 | contracts + orchestrator types | API、orchestrator、renderer |
| 通道消息与流 | `packages/channel/src/types.ts` | Gateway 与 adapters |
| 编排记录与事件 | `packages/orchestrator/src/types.ts`、`events.ts` | API 与编排客户端 |

跨包新增公共字段必须先进入 contracts 或所属协议包并提供兼容性策略；不得从某个 Vue 组件、route handler 或 Provider 响应反推为公共契约。

## 2. 版本与兼容

- 带 `version` 的 invocation/result、持久记录或 sidecar ABI 仅接受明确支持的版本。
- 新增可选字段应保持旧消费者可读；删除、改名、枚举收窄或语义变化属于破坏性变更。
- 持久化 schema 升级必须写明备份、迁移、回滚读取范围；旧代码不得覆盖新格式。
- Provider 原始响应必须在 agent-core 内规范化，不能直接泄漏为平台事件。

## 3. 错误语义

| 类别 | 语义 |
| --- | --- |
| 认证/授权 | 401/403；需防枚举时无权与不存在统一 404 |
| 校验 | 400/422；不得进入模型或持久化层后才解释字段 |
| 冲突/CAS | 409；调用方重新读取基线后重试 |
| 上游/sidecar | 明确 failed/timed-out/cancelled，不转换成 completed |
| 能力缺失 | 返回可操作错误或显式降级标志，不静默替换语义不同的能力 |

## 4. 敏感字段

API Key、App Secret、access token、通道 token、解密快照和私有数据库路径不得出现在公共响应、`AgentEvent`、模型 prompt、普通日志或 domain KV。公共 model/provider ref 只能携带非秘密标识与经过批准的展示信息。
