# M5 只读审阅与修复记录

2026-10-24，基线 ee6b5a1898f128a0baf953ea192ba80795ac674d；一个修改执行者，一个只读审阅者；审阅者不运行构建/测试、不修改文件、不派生代理。审阅范围为 planner、packet、journal、宿主控制、管理 API/参考 UI 及相应测试。没有将审阅意见当作测试证据。

审阅指出 4 项 Important，均确认并按 RED→GREEN 修复：

| 问题 | 实际修复 | 回归与证据 |
| --- | --- | --- |
| P1：工具调用历史帧缺失 injectionBinding，后续工具循环自我封锁 | assistant tool-call 帧保留原始绑定；工具回执继续绑定实际结果 | `M5 actual native tool loop...`：RED 仅一次终端调用；GREEN 两次调用及冷恢复下一轮成功 |
| P2：错误配置 JSON 被当持久化错误，误封锁健康会话 | 使用统一 commandObject，将语法错误归为 invalid_record，发生在任何写入前 | `invalid injection JSON...`：RED 返回普通控制失败；GREEN 原绑定/未封锁状态保留，正确设置和输入随后成功 |
| P2：历史 trace 与实际宿主文本未交叉绑定 | 恢复、预览、发送认证都验证原正文中的 personContinuity.snapshotId 与文本 hash | `changed historical trace...`：RED 改查询并重算外围 hash 仍恢复；GREEN 进入 recovery-only，不发送 |
| P2：中文分词按不重叠双字，奇偶偏移影响命中 | 使用滑动中文双字；前 128 个不同词项限制写入 trace，并在 UI 显示 | `Chinese keyword...`：RED “我想去钟楼”漏匹配；GREEN 三种偏移一致。另测词项上限明确标记 |

另由实现者补充：感受用“感受记录”而非客观事实标签；过期感受不可由 pin 恢复（先红后绿）。首次启用保存原 journal 的 fsync 备份，实际前版读取器拒绝新字段、可读取原备份（先红后绿）。

类型检查曾发现一个空数组类型推断错误，以及文本修改误将 packet 局部变量插入检索回执分支；退出码 2。根据明确编译位置修复，后续类型检查退出 0。没有对相同错误反复重试。

用户随后将前端外包，参考页面和图片随源码保留，最终外包 UI 不在本轮审阅结论中。审阅不是无缺陷证明；最终完整命令、打包、真实 SDK 与未验证边界见 RESULTS。
