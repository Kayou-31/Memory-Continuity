# Snow Luma：本预览的接入范围

Memory-Continuity 0.3.0-preview.1 **尚未完成 Snow Luma 整链验收**。Snow Luma 官方介绍列出 OneBot v11 的 HTTP、WebSocket 与反向 WebSocket 等接入方式，见 [官方说明](https://snowluma.github.io/en/docs/guide/introduction)。这说明存在协议对接方向，不代表本项目已经完成兼容验证。

本项目不复制或捆绑 Snow Luma 程序，也没有登录账号、注入 QQ 进程或发送真实消息。当前交付的 AstrBot 4.29.3 管理桥只连接本机 Memory-Continuity 核心，提供管理员私聊的状态、工作台与关闭入口；它没有模型注入、平台人物绑定、聊天自动导入或 AI 日记工具。

若自行评估，固定双方版本，先通过各自官方文档验证 OneBot 接入，再按 [管理桥说明](../../adapters/astrbot/README.md) 连接同机核心。OneBot 网络 token 与本项目的核心管理凭据用途不同，不能互换；核心工作台仍仅在本机可访问。

实际 QQ 私聊/群聊、多账号、相同消息 ID 的隔离、重复上报、重连、两端同时连接和长时间运行都保留为未验证。本轮不把 Snow Luma SDK 或 MCP 的存在当作可授予模型管理人物、删除记忆或发信的依据。后续实现会复用同一记忆核心，并单独验证平台事件来源与准入生命周期。
