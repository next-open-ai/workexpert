# 桌面本地检索组件打包修复

## 需求与任务

- DK-R01 / DK-T01：API 依赖收集包含当前平台已安装的 optionalDependencies；必需依赖缺失仍失败。不携带其他 OS/CPU 的原生包。
- DK-R02 / DK-T02：每次 stage 后在仓库之外验证依赖闭包，真实执行 LanceDB 建表、写入、更新与向量召回；失败阻止生成安装器。
- DK-R03 / DK-T03：入库因 LanceDB 组件缺失或加载不兼容失败，提供修复安装包提示，不误导反复重试或更换 embedding。保留原文和异常 cause，不静默降级为成功。
- DK-R04 / DK-T04：macOS ARM64 安装器体积预算从 200 MB 调整为 250 MB，容纳必需原生组件；保留超限失败门禁，其他平台预算不变。无数据迁移，回退仅需恢复该配置。
- DK-R05 / DK-T05：依赖使用标准 Resources/api/node_modules，兼容 CJS require 与真实业务动态 import。校验不得把错误目录复制改名为 node_modules 后再测试。用 Electron 自带 Node 在仓库外按原样布局执行动态 import、建表、更新、验证写入与召回；旧 node_deps 布局和缺原生组件必须失败。
- DK-R06 / DK-T06：打包后再次使用最终应用内的 Electron 可执行文件和 Resources/api 验证，防止打包器过滤/遗漏依赖；加入 release workflow，失败不上传安装器。
- DK-R07 / DK-T07：启动最终安装应用内的真实 API bundle，临时用户/临时库/本机 embedding 桩完成 Markdown 文本导入、归档读取及带版本证据的召回。与 renderer 一致，Markdown 以 UTF-8 content 提交；不声称覆盖 PDF 等二进制解析。不使用真实模型凭证或用户数据，所有数据根显式隔离。

## 契约与兼容

依赖目录改为 Resources/api/node_modules，沿用原生平台 runner 打包，不支持交叉架构 stage。主进程 NODE_PATH 同步新目录（CJS 兼容），动态 import 使用标准目录解析，不依赖该环境变量。无数据或配置迁移，不修改向量/SQLite schema。回退打包布局必须同时回退启动设置，旧安装包不原地修补。
入库仍沿用现有失败 HTTP 响应的 message/code；新增错误码 KNOWLEDGE_STORAGE_COMPONENT_UNAVAILABLE。
维度不一致保持 EMBEDDING_DIMENSION_MISMATCH，其余写入失败保持现有通用提示。组件错误不向用户暴露本地路径/堆栈。
回退代码仅影响未来安装包；已有安装包须重新构建安装。原文无需重新上传，修复后重试索引。

## 测试规格与追踪

- DK-T01 → desktop dependency 单测：平台筛选、可选依赖缺失、必需依赖缺失、递归依赖完整性。
- DK-T02 → desktop 隔离回归：真实 API 生产依赖 staging 到临时目录，禁用仓库依赖回退，LanceDB 写入/更新/检索；删除原生组件的负例应失败。
- DK-T03 → agent-core 单测：模块缺失、原生不兼容、嵌套 cause、维度错误及普通错误；API 单测验证 code/message 透传、私有路径不泄漏和原文仍可读取。
- DK-T05 → Electron 负例证明旧布局 require 成功但 import 失败；原样隔离校验应拒绝，改为标准目录后 1024 维写入/更新/回读/召回通过；删除 native 后失败。
- DK-T06 → 最终应用资源及 Electron 二进制校验，目录发现与缺应用/缺 API 时失败；原生 runner 对当前平台执行。仅临时 DB，无真实 embedding 服务调用。
- DK-T07 → `scripts/packaged-knowledge-api-regression.mjs <release-dir>`；release workflow 在上传前执行真实 API 验收。

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
- DK-T04（2026-10-23）：临时稀疏 DMG 文件调用真实 `report-package-size.mjs` 验证 4/4 通过：227.1 MB 在旧 200 MB 预算失败、在新 250 MB 预算通过；250 MB 边界通过、多 1 字节失败。`git diff --check` 通过。本次未推送、触发 Actions 或重新生成安装器；配置提交到待发布 ref 后生效。

### 2026-10-26 ESM 加载修复验收

- 根因：原生依赖虽已补齐，但业务 bundle 保留 `import('@lancedb/lancedb')`，ESM 不读取 NODE_PATH；旧校验既用 require 又把目录改名，误掩盖了真实布局错误。
- DK-T05～07 已实现。本机 `node --test apps/desktop/scripts/*.test.mjs`：17/17 通过，旧布局负例明确 ERR_MODULE_NOT_FOUND，新布局与缺原生组件负例符合预期。
- API 目录执行 `node_modules/.bin/tsup`：通过；根目录 `node apps/desktop/scripts/stage.mjs`：通过，使用 Electron 37.10.3 / Node 22.21.1 动态 import、1024 维写入/更新/回读/召回。API 资源 138.92 MB，没有新增平台原生包。
- 使用 electron-builder `--dir --publish never`、现有本机 Electron distribution、关闭签名，在 `/tmp/workexpert-packaged-check.FXpNUo` 生成真实 macOS arm64 `.app`；未安装到 Applications，未修改用户数据。
- `node apps/desktop/scripts/verify-packaged-knowledge.mjs /tmp/workexpert-packaged-check.FXpNUo`：最终 `.app` 的 Electron + 原样 API 资源隔离验证通过。
- `node scripts/packaged-knowledge-api-regression.mjs /tmp/workexpert-packaged-check.FXpNUo`：通过。真实打包 API 导入 Markdown 文本，4 个切片、1024 维向量、原文读取及版本证据召回 4 个结果；显式断言包含 vector 通道，防止仅关键词降级伪通过。本机 embedding 测试桩，无外部模型调用。测试初次误按二进制提交 Markdown 被现有 parser 拒绝，已改为与 renderer 一致的 content 输入；未修改业务解析器来迎合测试。
- API 目录 `node_modules/.bin/tsup --config voice-test.config.ts && node --test test-dist/*.test.js`：37/37 通过。
- desktop 类型检查、脚本语法及 `git diff --check`：通过。Windows 最终应用验收由原生 release runner 执行，本机未验证；本次未生成 DMG/EXE、未签名、未推送或触发远端发布。测试 `.app` 为临时未签名产物，不等同正式安装器。
