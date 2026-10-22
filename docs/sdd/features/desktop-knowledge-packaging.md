# 桌面本地检索组件打包修复

## 需求与任务

- DK-R01 / DK-T01：API 依赖收集包含当前平台已安装的 optionalDependencies；必需依赖缺失仍失败。不携带其他 OS/CPU 的原生包。
- DK-R02 / DK-T02：每次 stage 后在仓库之外验证依赖闭包，真实执行 LanceDB 建表、写入、更新与向量召回；失败阻止生成安装器。
- DK-R03 / DK-T03：入库因 LanceDB 组件缺失或加载不兼容失败，提供修复安装包提示，不误导反复重试或更换 embedding。保留原文和异常 cause，不静默降级为成功。

## 契约与兼容

依赖目录仍为 Resources/api/node_deps，沿用原生平台 runner 打包，不支持交叉架构 stage。无数据或配置迁移，不修改向量/SQLite schema。
入库仍沿用现有失败 HTTP 响应的 message/code；新增错误码 KNOWLEDGE_STORAGE_COMPONENT_UNAVAILABLE。
维度不一致保持 EMBEDDING_DIMENSION_MISMATCH，其余写入失败保持现有通用提示。组件错误不向用户暴露本地路径/堆栈。
回退代码仅影响未来安装包；已有安装包须重新构建安装。原文无需重新上传，修复后重试索引。

## 测试规格与追踪

- DK-T01 → desktop dependency 单测：平台筛选、可选依赖缺失、必需依赖缺失、递归依赖完整性。
- DK-T02 → desktop 隔离回归：真实 API 生产依赖 staging 到临时目录，禁用仓库依赖回退，LanceDB 写入/更新/检索；删除原生组件的负例应失败。
- DK-T03 → agent-core 单测：模块缺失、原生不兼容、嵌套 cause、维度错误及普通错误；API 单测验证 code/message 透传、私有路径不泄漏和原文仍可读取。

## 发布验收与状态

DK-T01～03 已实现并通过下列本机回归（2026-10-22，macOS arm64 / Node 22.22.1）。只在临时目录验证，不操作用户知识库。不自动发布或改动旧安装包。
打包日志输出 staged 包数及隔离 LanceDB 校验结果，缺组件时构建非零退出。
安装器最终真机验收：新版本安装后导入 Markdown 并召回原文；需另行构建安装器执行。

### 验证记录

- `node --test apps/desktop/scripts/stage-dependencies.test.mjs`：3/3 通过，包含当前平台真实 API 依赖闭包的正负例。
- `node_modules/.bin/tsc -p packages/agent-core/tsconfig.json` 与 `node --test packages/agent-core/dist/test/*.js`：构建通过，203/203 测试通过。
- API 目录执行 `node_modules/.bin/tsup --config voice-test.config.ts` 与 `node --test test-dist/*.test.js`：构建通过，37/37 测试通过。
- 根目录执行 `node_modules/.bin/tsc -p apps/desktop/tsconfig.json --noEmit`、`node_modules/.bin/tsc -p apps/api/tsconfig.json --noEmit`、`git diff --check`：通过。
- `pnpm --filter @workexpert/desktop test` 因 Corepack 等待下载 pnpm 未完成，已终止本次进程；上面直接执行同一 Node 测试入口完成验证，无需下载新依赖。
- 未执行：完整 DMG/EXE 构建、安装后真机 UI 回归、Windows 原生运行。原因：本次为代码修复与本机依赖闭包验收，未发布安装器；Windows 由原生 release runner 的 stage 同步执行强制隔离校验。
