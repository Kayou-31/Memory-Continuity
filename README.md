# Memory-Continuity · 0.2.0

**独立的人物连续性与长期记忆插件。** 技术名称 `dsh-memory-continuity`，npm 包名 `@dsh-external/dsh-memory-continuity`。无需安装 Ultra Mode、Ultra Memory 或 Ultra Decision 即可使用 RP 的记忆、检索、分支和人工采纳功能；运行时仅依赖下文列出的 DSH 原生 peers。

M5 新增模型视角的五类记忆、三级展开、确定性条件选择与原因预览。完整使用说明见 [M5 使用与迁移](docs/rp-memory-m5/README.md)，[中文指令速查](docs/COMMANDS.zh.md) 对应宿主 `/memcont help`。实际结果见 [M5 RESULTS](docs/rp-memory-m5/RESULTS.md) 、[后端补充验证](docs/rp-memory-m5/BACKEND-RESULTS.md) 和 [dev.4 指令更名验证](docs/rp-memory-m5/COMMAND-RENAME.md)。本版已将交付工作台接入真实宿主，提供人物、经历、定向关系、目标/承诺、成长审阅与注入预览，支持浅色/深色/跟随系统。写入须服务端预览并由你确认；浏览器仅保存主题，关闭入口会撤销凭证。正式版结果和限制见 [0.2.0 验证报告](docs/releases/0.2.0/RESULTS.md)，[中文发布说明与未来计划](docs/releases/0.2.0/RELEASE.zh.md)。没有自动摘要、压缩或付费模型调用；使用显式干净续接衔接会话。


上一版 **Ultra-RP-Memory 0.2.0-dev.1** 的历史验证：修复一个核心人物入口的实体白名单缺口；修复后单次完整 **214/214**、实际安装包宿主 **31/31**、包内公开接口回归 **1/1**、四类人生故事 **4/4**，类型检查、独立构建和打包通过。[中文发布说明](docs/rp-memory-dev3/RELEASE-0.2.zh.md) · [发布审查报告](docs/rp-memory-dev3/RELEASE-0.2-REVIEW-2026-10-23.md) · [插件包与校验](artifacts/0.2.0-dev.1/)。历史首轮212/213的一次对象描述符异常根因仍未确定，最终浏览器复查仍受历史崩溃阻断；失败及未验证范围保留在 [完整验证报告](docs/rp-memory-dev3/RESULTS.md)。这是预览范围的证据，不是长期生产稳定性声明。

产品重点是**让用户自己搭建、持续塑造一个完整的“人”**：定义身份、背景、性格与价值观，让经历、关系、承诺和做事经验在后续互动中延续。Memory-Continuity 自成体系，可发展 RP、陪伴、创作、项目助手等用途。本轮 M5 独立运行，不新增 Ultra Mode 兼容依赖。当前包括人物草稿与原子创建、宿主绑定、稳定/成长/情境字段、显式成长队列、批量确认、时间线、经历、定向关系和目标/承诺账本。四种用途、三个内置能力模块和双层约束来自 M3，模块默认关闭。M4 增加固定故事与实际宿主连续性验证，结果只证明测试范围内的证据和协议，不代表模型人格质量。

人物管理提供**工作台**：在已启动的 RP 会话手动执行 `/memcont person manage`，打开返回的本机地址，统一创建/编辑人物、记录经历、修改关系/目标、预览并确认成长；没有轮询、自动采纳或后台活动。仍可使用 [离线人物编辑器](ui/person-editor/index.html) 和 [可信命令](docs/person-core-usage.zh.md)。全局长期存储增加先备份再显式启用的分段模式，默认旧布局不变，详见 [管理与存储升级](docs/person-studio-storage.zh.md)。完整用途产品、技能学习、多人物社会和自主生活仍属后续工作。

正式名称为 **Memory-Continuity**；历史包、报告、`rp-memory` 配置节点、`.dsh-rp` 数据目录保留；主命令改为 `/memcont`，旧 `/rp` 作为兼容别名。替换旧入口时更新包名，不同时启用新旧两个入口；更名不触发数据迁移。GitHub 地址在发布迁移前继续使用原仓库。

dev.3 修复请求准入、异常诊断/干净续接、retcon 摘要依赖、稳定检索与实际记录回执、全局容量和 seal 恢复、锚点合并及批量撤回。host journal 使用 v2，branch/global 的 schemaVersion 保持 v1。新人物工作区增加显式 requiredCapabilities 事务扩展：首次启用前自动备份，整个对应工作区要求新版读取，global 和其他工作区不受影响；旧程序不得继续写新人物工作区。升级前阅读 [迁移与恢复规则](docs/rp-memory-dev3/MIGRATION.md)；本轮执行结果及未测边界见 [RESULTS](docs/rp-memory-dev3/RESULTS.md)。历史 dev.1/dev.2 的证据不代替 dev.3 验证。人工采纳、自动功能关闭和默认禁用保持原有约束。

2026-10-22 的 [完整审查与局部重构](docs/rp-memory-dev3/REVIEW-2026-10-22.md) 包含新发现的 8 项正确性问题、已本地修复的分支事务容量问题和历史重放优化；旧 packet 摘要认证、失败全局发布的明文清理等遗留 7 项已在本地后续分支修复，新增先红后绿回归；最新完整验收结果见 RESULTS 最后一节。该本地分支未更新已发布的 dev.3 包，不能用既有测试通过代替这些新增问题的验收。

默认禁用；本版精确适配宿主 SDK **0.2.1-rc.2 / session format 4**，Cordis **4.0.5**、Schemastery **3.18.5**。0.2.0-rc.2 请使用冻结的 dev.1；本版拒绝旧版或混版 native peers。来源为 Kayou-31/dsh-ultra-mode 的本地 RP 开发分支；专用源码仓库为 [dsh-ultra-rp-memory](https://github.com/Kayou-31/dsh-ultra-rp-memory)。BSD-3-Clause。

中文文档：[安装、启用与能力边界](docs/rp-memory-design.zh.md) · [输入、采纳、检索与纠错](docs/rp-memory-narrator.zh.md) · [人工候选与分层摘要](docs/rp-memory-summary.zh.md) · [固定标注评价及未测项](docs/rp-memory-evaluation.zh.md)。原始设计另见 [开发包](docs/rp-memory-devkit/01_RP_MEMORY_SPEC.md)。

本轮宿主变化、实际验证和历史证据分列见 [SDK021 适配说明](docs/rp-memory-sdk021.zh.md)。

支持用户明确采纳的剧情修订、固定分支、来源检索、全局发布/采用、结构化人工候选和分层摘要。候选生成接口仅经离线固定输出验证。后台原生自动候选、strict POV、原生压缩/恢复、UI 自动切换、真实模型语义质量及长期运行均未通过验收。`/memcont compact`、`/memcont strict-pov`、`/memcont summarize-auto` 拒绝为 capability_missing。

安装本 TGZ 本身不启用。先在独立测试 profile 中配置实际 profileRoot/workspaceRoot、可信 entityIds、已核实预算与 knownCooperatingWriters；保留 enabled:false、contextCompression:false、strictPov:false。确认只有已声明的合作写入者后显式 enabled:true，再使用 `/memcont start`。不要把示例路径/预算直接套入日常 profile。实际激活配置和完整命令见发行包中文使用说明。

**历史共存证据（非本轮 M5 验收）**：此前使用兼容开发包：Ultra 0.6.1-dev.rp.1、Memory/Decision 0.1.1-dev.rp.1，其代码与 TGZ 沿用 dev.1 同哈希附件；其它旧公开版本没有共同 policy，不承诺可同时工作。无需为 RP 单独安装这些工程包。dev.3 补验已在精确 SDK 中加载实际 TGZ，覆盖 RP 与 Memory、Ultra+Memory、Decision+Memory 的两种顺序，以及冷启动禁用门禁/ambiguous 干净续接；7项原生验收通过。合成 terminal 不代表真实模型或桌面 UI。结果、哈希及其余边界见 [RESULTS](docs/rp-memory-dev3/RESULTS.md)。

2026-10-23 本地成长开发版重新执行一次完整 **154/154** 回归，并以实际新 TGZ 完成 **11/11** 原生补验，新增独立 Agent 流程、优化开关和双顺序实际请求去重。260 阶段持久化及祖先删除测试通过，但耗时约640秒；长链性能仍待改善，没有无限容量或真实模型“完整人生”质量的承诺。

本次升级保留实际服务身份、session format、正文/元数据哈希、来源、分支、预算、租约及全局权限门。SDK021 在发送前刷新 runtime contexts；未获既有认证的动态正文变化仍会被拒绝。跨 SDK 历史迁移未测，不能直接把 dev.1 日常 profile 当作迁移验收。

最终 Release RP TGZ 来自独立 RP 源码根：单份 src/rp 与 src/rp-plugin.ts、专用 build、对应 RP 类型；不包含 core-src。完整 core-src 调试快照仅留在本地开发树；公开完整开发源码归档保留原始 src 与生成脚本，可以重建这些快照，不携带其生成重复。最终运行入口只依赖声明的原生 peers；构建/打包不运行模型或 live driver。

## 从独立源码构建

Node 22.23.3 为本次验证运行时。安装声明依赖后执行：

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run evaluate:fixture
npm pack --ignore-scripts
```

默认 build 只构建 RP。依赖安装可能访问 npm；本次验收使用锁定的本地依赖副本，没有执行联网安装。离线环境须预备 lock 中的平台所需依赖。独立 suite 含来源/分支/检索/摘要/评分和默认入口，完整开发回归、native与工程共存的来源见 UPSTREAM.json 和发行报告。没有把原Ultra整个Git历史迁入新仓库；固定上游基线链接与本地checkpoint/源归档校验链保留来源。

源码ZIP可独立构建；旧reader兼容回归使用 `git archive` 读取历史提交，因此运行完整 `npm test` 请使用包含历史的Git克隆。实际TGZ的Ultra/Memory/Decision组合验收另需报告所列兼容附件。不要将源码构建成功解释为所有外部组合已在自己的环境验证。
