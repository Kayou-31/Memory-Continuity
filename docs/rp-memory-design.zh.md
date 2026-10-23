# Ultra RP Memory：独立使用与可选适配

产品目标是为可长期培养的 Agent 提供记忆连续性，让互动经历、关系、承诺与可复用经验逐步积累。RP 是当前已实现的场景；更完整的目标、技能和习惯成长属于后续设计。独立运行与可选 Ultra Mode 适配是并列使用方式，不能要求用户先安装 Ultra 才能使用核心记忆。

本版本提供用户明确采纳的 narrator Memory、独立分支与 global 权限、来源检索、分层摘要和候选作业边界。本地开发入口已命名为 `@dsh-external/dsh-ultra-rp-memory`，版本仍为 `0.1.0-dev.3`；已发布历史包使用旧名 `@dsh-external/dsh-rp-memory`。这是可独立使用的插件，Ultra Mode 适配为可选能力，不要求安装任何 Ultra 工程包。当前已验证的是特定兼容版本共存；同会话检索/预算算法叠加的后续方向及未修复问题见 [审查报告](rp-memory-dev3/REVIEW-2026-10-22.md)。

BSD-3-Clause；上游为 Kayou-31/dsh-ultra-mode，设计基线 `00bc770ef5e0819fb0fb3bee4afbd9576e303364`。后续开发 checkpoint 仅本地，不能把该哈希拼成假 GitHub 链接。独立仓库的 UPSTREAM.json 记录原路径、字节和哈希；完整开发源归档补充工程共存来源。下文保留 dev.2 适配阶段的机制与边界；dev.3 的实际验收以 [RESULTS](rp-memory-dev3/RESULTS.md) 最新节为准。

默认 `enabled:false`、`contextCompression:false`、`strictPov:false`。dev.2 精确适配 SDK `0.2.1-rc.2`、session format 4、Cordis `4.0.5`、Schemastery `3.18.5`；SDK `0.2.0-rc.2` 使用冻结 dev.1。启用入口拒绝旧版与混版 peers。根 wrapper 不要求禁用实例先初始化原生服务，启用时会复核实际服务身份、容量和已声明的合作写入者。跨 SDK 历史迁移未测；在新隔离 profile 验证后再决定使用，不能将此版本适配视为已有剧情数据迁移承诺。

独立源码仓库保留 src/rp 与单份 src/rp-plugin.ts；专用 build 默认输出 RP 的 ESM 与类型。完整开发仓库仍以 root src 为权威；companions/core-src 是生成快照。构建和 pack 不执行 live 驱动，包没有隐藏 root 或工程伴随包依赖。安装后的启用与用户控制见 [narrator说明](rp-memory-narrator.zh.md) 和 [候选说明](rp-memory-summary.zh.md)。

首次只在隔离测试 profile 试用：安装 TGZ，配置真实 profileRoot/workspaceRoot、实体白名单、实际模型容量与输出/工具预留；先保持禁用。确认所有写入者都参与共享策略后才显式启用并在空 root 会话 `/rp start`。配置 `knownCooperatingWriters:true` 是部署者的可信声明，不检测任意未知插件。测试预算不是建议的真实模型参数。

正常输入必须经 `/rp input`；完成消息只是候选，使用 `/rp status` 后 `/rp accept SOURCE_ID` 明确选定。人工提案使用 `/rp summary JSON`，随后 `/rp candidate ID` 查看元数据并 `/rp adopt ID`；正文需从用户自己提交的提案和授权来源复核。模型工具只有 rp_memory_search/get/status，不能进行采纳、纠错或全局发布。全局 preference/publish/list/adopt、retcon、delete、fork、continue-clean 的实际 JSON 语法遵循上面两份说明。

隐私删除覆盖登记可删 blob 与选择删除的独立批准发布。跨分支别名需相关授权；宿主 JSONL、外部模型与备份不承诺物理擦除。保留的违规原生历史会触发请求拒绝，使用 `/rp continue-clean` 创建新 root 并由用户选择；不宣称自动过滤原始历史或自动切换 UI。

P5 原生 CAS/lifecycle/recovery/ownership 门未通过，`/rp compact` 和 `/rp strict-pov` 明确拒绝。后台自动候选 `/rp summarize-auto` 同样 capability_missing。只支持纯 text 与已登记元数据；reasoning/rich 或未知 metadata 拒绝。默认禁用实例验收不证明激活后的真实模型质量。真实模型、桌面交互、长期扮演、跨进程排他、断电恢复仍未运行。

同次兼容版本：Ultra `0.6.1-dev.rp.1`、Memory/Decision `0.1.1-dev.rp.1`；旧公开包没有本次协议，不承诺同时运行。RP 单独使用无需安装工程包。A40 工程共存证据来自完整开发仓库的真实 helper/native 探针；独立 RP 测试只覆盖明确列出的源码与机制，不自动复跑工程行为。
