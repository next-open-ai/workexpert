# 2026-10-06 发布完整性验收

## 结论

建议 2—6 已落地并通过本机回归；建议 7 的 macOS arm64 安装包已构建并通过打包态启动与 DMG 完整性校验。Windows x64 构建已纳入 CI 矩阵，真实 Windows 安装启动及依赖外部凭据的 Provider 能力保留为发布前人工门槛。

## 已验证项目

- `pnpm test`：216 项通过。
- `pnpm typecheck`：所有可检查工作区通过。
- `pnpm size:check`：入口 JS 0.66 MiB、最大懒加载块 2.30 MiB、JS/CSS 合计 4.64 MiB、静态资源合计 5.16 MiB，均在门禁内。
- `pnpm orch:smoke`、`pnpm gateway:stub`、`pnpm gateway:feishu`、`pnpm gateway:relay`：通过，且测试自行启动隔离 API。
- `pnpm ui:core:regression`：首个管理员初始化、会话鉴权、页面懒加载导航、设置和空状态旅程通过。
- `pnpm npm:package:regression`：tarball 内容、临时 npm 安装和安装后 CLI doctor 通过；未包含源码映射、编译测试、`__pycache__` 或 `.pyc`。
- `pnpm docs:build`：通过。
- `pnpm package`：生成 `WorkExpert-0.2.16-arm64.dmg`；DMG CRC 校验有效。
- 打包应用 `WorkExpert.app`：使用隔离数据目录启动后 `/api/health` 返回 `status: ok`。

## 尚未声称通过的发布门槛

- Windows x64：CI 会构建并校验 `.exe` 产物及体积；仍需在真实 Windows 主机执行安装和启动验收。
- 真实 Provider：需发布候选凭据与配额，分别验证文本对话、视觉、语音和 embedding。离线 smoke 不替代此项。
- macOS 产物当前未签名；对外分发前仍需完成签名与 notarization（若发布渠道要求）。
