# 知识库归属子阶段

状态：实施中；规格版本：0.4；日期：2026-10-16；依据 [ADR-0008](../../../architecture/adr/0008-knowledge-base-ownership.md)。

## 需求与任务

WK-13：知识库唯一内容授权边界；旧库明确指派，新库归创建者，禁止通过配置覆盖/路径替换绕过归属。WK-T09a 实现配置归属与入口守卫；WK-T09b 完成旧个人 Wiki 与原文物理定位兼容、库内权限继承和 UI/手册。两阶段不得混报完成。

## 契约

- knowledge-bases.json envelope 增加 schemaVersion=2；meta 每项有可选 ownership `{schemaVersion:1,orgId,ownerUserId,assignedBy,assignedAt}`。缺失表示未指派，不从当前登录者推断。删除行保留 retired=true，ID 不复用；secrets 仍在原配置 envelope，不写 domain KV。
- GET /api/settings/knowledge/bases：只返回当前组织/用户的未删除库，包含自己的配置。PUT 同路径：数组，兼容现有客户端；仅替换本人子集，不能覆盖未指派/其他用户/已删除 ID。所有权由服务端填入，原样往返可接受，伪造或修改拒绝；同用户保存仍为 last-write-wins，不宣称 CAS。
- GET /api/settings/knowledge/unassigned：仅管理员；仅 id/name/provider，不能返回目录或密钥。旧配置没有组织，因此待指派摘要对本机管理员可见；指派只能给管理员同组织的有效真实用户，不能给 internal-desktop。
- POST /api/settings/knowledge/bases/:knowledgeBaseId/assign：strict `{ownerUserId}`，管理员专用，一次性从未指派到 assigned。相同目标重试返回已有归属，不增加审计；已指派其他目标 409。不存在/越权404、无认证401、非管理员403、参数错误400、损坏存储503。
- 新本地库拒绝自定义 dataDir，服务端选取数据根下 `knowledge-bases/<id>`；旧本地库保留原目录，普通保存不能改变 provider/位置。ID 仅字母数字下划线连字符，旧不合法 ID 不自动改名。
- 写配置先保留完整 pre-ownership 备份，临时文件 fsync 后同目录 rename；写入无 await，符合 API 单写者。失败不清空原配置。未知 schema/损坏 JSON 拒绝读取和保存，不能回落空表。
- 原知识 HTTP 请求里的 knowledgeBase 只用于提取 ID，执行前替换成服务器已保存配置；未指派/跨用户/禁用库拒绝。保留原有本体发布治理流程，不新增页面 ACL。
- 桌面与 Web 使用同一配置 HTTP API；从 domain.json 中 `capabilities.knowledge` 和 `user:<id>:capabilities.knowledge` 只读兼容导入未指派记录，出现同 ID 不同位置则503，不静默取一方。旧 KV 路由不再允许读写该键；原 domain 文件保留不改写。本次保留共享 Provider 设置体系，不宣称已解决全应用凭证隔离。
- 直接聊天和编排 runner 执行边界重新授权所选知识库；编排使用持久化 Run 的 orgId/ownerUserId，不能从客户端 context 推断。项目 contextResolver 新增可选 ownerUserId 参数（旧一参回调兼容），确认/重试/审批恢复使用持久化项目所有者；无所有者不自动装配知识库。模型/Provider 默认值由服务端恢复，不能因替换客户端配置丢失 Embedding 设置。
- 本体分析任务新记录带 knowledgeBaseId，查询/取消检查该库归属；旧无归属任务保留记录但拒绝访问，不认领。

## 验证与追踪

WK-A03 → WK-13/WK-T09a：临时配置与 Fastify 验证新建归属、跨用户/组织拒绝、管理员不能读取他人库、旧库不认领、一次性指派/重复/冲突、同组织有效用户、配置子集合并、路径与身份注入、删除墓碑、坏文件保留与备份。WK-T09b 另验证库内跨原上传者访问及 Wiki 旧 namespace；A03 不代替该项。

UI 本阶段不新增管理页面；未指派旧库不在普通列表中。管理员通过上述 API 指派后才出现在所有者列表。禁止将后端入口称为已交付的图形操作流程，下一阶段补简洁“待指派”入口和手册。
