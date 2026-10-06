# Test specification

> 状态：已接受｜规格版本：0.1｜更新日期：2026-10-06

| 需求 | 自动化入口 | 通过条件 |
| --- | --- | --- |
| REL-01 | `pnpm build && pnpm size:check` | 所有分项预算通过且非对话页面生成独立 chunk |
| REL-02 | `pnpm orch:smoke && pnpm gateway:stub && pnpm gateway:feishu && pnpm gateway:relay` | 无外部 API 前置进程，全部离线通过 |
| REL-03 | `pnpm ui:core:regression` | Chrome/Chromium 中无 page error，核心旅程可达 |
| REL-04 | `pnpm npm:package:regression` | 内容断言、临时安装和 CLI doctor 通过 |
| REL-05 | `pnpm package` + 安装包人工验收 | 目标平台产物生成并从安装态启动 |

真实 Provider 验收必须单独记录厂商、模型、日期、费用与数据边界；缺少密钥时记为“未执行”。
