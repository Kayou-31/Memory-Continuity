# NapCat：本预览的接入范围

Memory-Continuity 0.3.0-preview.1 **尚未完成 NapCat 整链验收**。NapCat 本身提供 OneBot v11 网络接入；可参考其 [官方连接文档](https://napneko.github.io/NapCatQQ-Desktop/docs/connections/)。本项目不捆绑 NapCat，不会替你登录 QQ 或建立外部连接。

当前分工是 NapCat 处理 QQ 协议、AstrBot 处理平台事件、独立核心保存人物和记忆。本轮 AstrBot ZIP 只提供管理员私聊的 `connect/status/open/close` 管理命令，模型注入、聊天自动导入、平台人物绑定和 AI 日记工具均未开放。

如自行试用管理桥，先按 AstrBot 与 NapCat 官方文档建立已有的 OneBot 接入，核对完整地址、路径和 token；不要把 Memory-Continuity 的核心管理凭据填成 OneBot token。随后使用同机的核心配置和 AstrBot 插件设置，按 [管理桥说明](../../adapters/astrbot/README.md) 显式连接。返回的工作台地址只适用于核心所在电脑，不是远程 WebUI。

本轮验证了真实 AstrBot 4.29.3 的加载器、配置、命令调度与发送阶段，但最终消息终端为合成记录器。未测试实际 QQ 登录、私聊/群聊收发、断线重复上报、跨账号隔离、双端同时接入、真实网络鉴权和长期运行。协议兼容描述不能替代这些验证；本页不承诺 NapCat 已可用于模型记忆对话。

未来平台接线将单独验证持久化接入实例、机器人、会话、消息 ID 的组合，不把消息正文中的身份声明当作管理员权限，不把 WebSocket 重连当作新授权。
