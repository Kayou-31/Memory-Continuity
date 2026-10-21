# dev.2：DSH 0.2.1-rc.2 适配与验证边界

本版 RP `0.1.0-dev.2` 精确要求 DSH native peers `0.2.1-rc.2`、Cordis `4.0.5`、Schemastery `3.18.5`，Session format 仍为 4。完整原生测试组合还使用 loader `1.0.6`。官方 SDK 来源为 `dsh-v0.2.1-rc.2`，提交 `687f282e8625c6b8d11ff58211a90524be2e4317`。dev.1 的 `0.2.0-rc.2` TGZ 与证据保留，dev.2 不兼容该旧版或混版 peer 组合。

启用入口先核对自身实际解析的七个直接 native peers，再验证原生服务实例/原型身份与 session format；不会读取测试用 SDK 环境变量来伪造生产宿主版本。测试 bundle 显式定位新 SDK 根，并记录实际解析位置。主进程与六个冷恢复进程均使用同一新 SDK 根、同版本，不能从工程根的旧依赖回退。

SDK021 的 AgentLoop 会在准备请求后再次执行 `refreshContext`。原有正文和消息元数据认证保持原样。新增负例注册真实 required context provider，第一次 assembly 返回固定正文，发送前刷新返回不同正文；真实 session 中已出现新的 runtime snapshot，产品拒绝认证、provider 调用增量为零。正常完整请求、来源失效、全局权限、预算、租约、分支和恢复路径也在实际新版原生组合中运行。

本轮 Node `22.23.3` 验证：首个最小组 16 项中 15 pass、1 fail、0 skip；失败是新增拒绝负例的 command helper 未捕获预期 `ownership_lost`，保留了初次失败。修正夹具后只定向重跑 Memory，1/1 pass；该进程包含 41 条断言、主进程 23 次本地合成 provider 调用，六个恢复子进程分别计数，不能把 23 称为所有进程合计。旧版/混版公共入口各有真实原生模块及 manifest-resolution 夹具拒绝证据，实际 LlmRuntime.stream guard 为零；不代表全部任意宿主混装组合已穷举。

P0 另外一次固定输出复跑 exit 0、network 0。注入、固定原生 fork、本地合成模型调用 verified；canonical selection 与完整 filtering unsupported；durable replacement 仍 failed；lifecycle、token accounting、exclusive compaction ownership 和 UI unverified。这是 SDK 原生能力表，不替代 RP 应用的人工账本与预算证据。P5、strict POV 和后台原生自动候选持续关闭。独立 RP 根使用新依赖的默认 build（TypeScript 声明类型检查和 esbuild）exit 0，实际 TGZ 的隔离 import/disabled guard 证明由最终发行报告单独绑定。

本轮没有重复旧版 legacy822；其初始失败、定向修正及 40 skip 仍只属于 dev.1 的历史报告。工程 Ultra/Memory/Decision 三个 TGZ 沿用 dev.1 同哈希附件。dev.3 补验已实际解包 RP 与这三份 TGZ，覆盖 RP+Memory、RP+Ultra+Memory、RP+Decision+Memory 的两种加载顺序，另测冷进程禁用门禁和 ambiguous 干净续接，7项通过。仅这些固定组合、精确 SDK 与合成 terminal 有证据；任意混装不在声明范围。另有 Codex Luna 的四场景八回答受控 pilot，原始分数和夹具限制见 RESULTS；不能解释为 DSH 真实 provider 的语义质量验收。跨 SDK 既有 profile 历史迁移、付费 API、桌面完整操作、长期运行、断电持久性均未测。固定标注语料的历史分数仍只验证 scorer。

## dev.3 稳定性修复

本轮新增的关闭/诊断/干净续接、host journal v2、容量、检索证明和摘要失效规则见 [兼容与迁移说明](rp-memory-dev3/MIGRATION.md)，实际执行结果见 [RESULTS](rp-memory-dev3/RESULTS.md)。本文原有 dev.1/dev.2 历史证据仍保留其原验证范围。
