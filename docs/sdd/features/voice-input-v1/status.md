# 语音输入 V1 状态

- 已建立独立 `/api/voice/asr/*` 会话、音频上传和事件流。
- 已建立 `/api/settings/voice/input` 管理配置与 `/api/voice/input/capabilities` 能力查询。
- 桌面输入框保留语音转文字入口和测试窗口。
- 已移除实时语音会话、语音播报、音色克隆、工作桥接、手机通话 UI 与相关契约。
- 配置目录为 `~/.workexpert`，默认端口为 Renderer 50831、API 50832、手机 HTTPS 50833。
