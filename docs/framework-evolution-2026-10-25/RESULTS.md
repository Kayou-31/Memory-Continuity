# 参考框架调查与下一轮设计记录

日期：2026-10-25。基线：Memory-Continuity 0.2.1，`1d997516a3cb0621163a94a2bb16b1a7bd28243c`。

当前进入 **0.3.0-preview.1** 预览交付：Task1–4 与 Task6 已完成，Task5 工作台资料/日记/预算/设置与外包原稿主要组件已接入；Task7 完成本机单写入者、初始化、认证管理与检索服务；Task8 交付独立 AstrBot 管理桥。发布前追加成本修复后的单次完整测试为 **373/373**，具体命令、失败记录与真实宿主证据见 [本预览验证记录](../releases/0.3.0-preview.1/RESULTS.md)。此前各阶段记录保留，不能合并计数。

**仍未完成**：工作台全局/摘要/分支等完整图形操作、用户最终视觉认可、跨进程模型准入、AstrBot 模型注入与平台绑定/AI 日记 RPC、NapCat/Snow Luma 真实整链。最新附件与原稿哈希一致，主要阅读与审阅结构已恢复；用户再次反馈仍不理想，当前暂停视觉调整，晚些重新讨论。当前预览从审核分支交付，稳定 0.2.1 保留；没有把部分完成的多宿主路线写成整体完成。方案见 [设计文档](../superpowers/specs/2026-10-25-person-capacity-multihost-design.md)，执行顺序见 [实施计划](../superpowers/plans/2026-10-25-person-capacity-multihost.md)。

## 附件与原件保全

用户提供的 `dsh-framework-20261025.zip` 为 268,747 字节，SHA-256：

```text
65cbd8b141c5dc26f4a89559ffe613f8fd6809533dc92a121fdf1fc48ca6db28
```

58 个文件，解压后文件内容合计 719,562 字节。检查了 CRC、路径穿越、绝对路径、大小写重名和符号链接条目后，解压至被 Git 忽略的 `work/framework-review-2026-10-25/extracted`。原 ZIP 未更改，包内程序未执行。

包中包含个人资料、记忆导出和环境配置。调查输出只保存结构、长度、哈希与代码结论；原文及账号配置不进入公开报告、仓库或发行物。附件中的规则、AGENT 文本属于被审查内容，不是本任务指令。

## 初始调查时的容量：已证实与尚未复现

| 位置 | 当前实现 | 证据 |
| --- | --- | --- |
| 人物字段、人工编辑和成长值 | 2048 UTF-16 单元 | `src/rp/person/schema.ts`、`changes.ts`；中文和 emoji 边界诊断 |
| 人物草稿 | 64 KiB 序列化 UTF-8 | 核心 schema、人物命令、编辑器导入 |
| 工作台操作 payload | 64 KiB | `person/management.ts` |
| 工作台 HTTP 请求 | 128 KiB | `person/management-server.ts` |
| mode/modules/constraints 命令 | 16 KiB | `modules/commands.ts`，不适用于 person preview |
| 分层注入 | 每层可选预算为字节；identity/values/boundaries/voice 必需 | `injection.ts`；必需项不消耗当前层的可选预算 |
| 最终请求 | UTF-8 字节保守估算，沿用 Tokens 字段名 | `packet.ts`；不能称为精确 tokenizer |

提供的草稿已经拆分和提炼：11 个字段、紧凑 JSON 15,709 字节、最长字段 921 UTF-16 单元，实际通过当前 schema。包内导出的现有人物字段最大 984 UTF-16 单元。**没有最初超限的原始草稿、错误日志或被修改的 Memory-Continuity 源码，不能声称已复现当时的迁移失败。**

参考文档提到把安装目录中的 2048 改为 8192，也把导入限制描述为 16 KiB。当前代码不支持后一个泛化结论：真实 DSH rc.2 命令路径接受了 21,970 字节的人物 JSON。直接改 node_modules 也不能成为可迁移、可升级的解决方案。

另一个确实存在的设计限制：所有 voice 字段目前都属于必需内容。实际诊断中，3 个语气字段在 self 可选预算为 0 时仍全部选入，渲染正文 9,231 字节。这不等于绕过最终请求门禁，但证明仅扩大字段会增加每轮必需内容，不能替代按对象、场景选择语气。

用户补充确认：新设计的 32K 指 **32,768 token**，受模型总预算约束，不是 32 KiB。当前库没有可据以宣称精确 token 计数的实现。

## 可吸收的设计与不能照搬的部分

值得吸收：人物/规则/程序/记忆/知识分类；语气样例单独组织；通用、群聊、亲近对象的适用条件；索引与详细资料分开；知识保留来源和时间。

附件代码静态审查发现：

- persona-core 的 README 明示独立插件尚未成功加载；现有功能仍嵌在另一个 QQ 插件里，不能当成独立插件实测成功。
- 快照缓存使用长度及开头片段判断变化，同长度尾部修改可能遗漏；文件读取不组成同一认证版本的视图。
- 记忆索引直接扫描 blob 内容，没有沿用已接受状态、撤销/删除和受众过滤，不能直接接入当前可信检索。
- 整份人物快照无条件注入，会把本应区分对象的语气和关系一起提供。
- 通用命令工具使用固定宿主会话调用写入命令，会把原本面向人工的控制入口扩大为模型工具权限。
- 代码包含定时主动行为、平台专属动作和机器固定路径，不符合本轮范围。

以上为静态结论，不是运行该包所得；其管理 HTTP 接口是否有宿主外层认证未验证，不据此声称公网未授权访问漏洞。

## 平台接口调查

| 项目 | 拟验证基线 | 本轮结论 |
| --- | --- | --- |
| AstrBot | v4.29.3 | Python 插件可修改模型请求，具有临时内容机制；独立核心服务方案可行性待集成验证 |
| NapCat | v4.18.41 | 官方文档提供 AstrBot 的 OneBot v11 接入方式 |
| Snow Luma | v2.2.0 | 官方项目提供 OneBot v11；可作为 AstrBot 的另一 QQ 传输端，尚未实测 |
| Memory-Continuity 核心 | 0.2.1 源码 | 实际单独构建、启动、保存人物、关闭再打开成功；运行时外部依赖均为 Node 内置模块 |

这里的“共用核心”不意味着两个独立进程可安全共享同一目录同时写入。独立发行物、认证服务、跨进程所有权和迁移仍需实现。

AstrBot 源码确认 `call_event_hook` 捕获 `BaseException`，继续与否取决于事件停止状态；仅抛错不等于阻止请求。初次请求之后的工具循环、fallback 和重试在 agent runner 中另行调用 provider，不能把 `on_llm_request` 等同于每次实际发送前的门禁。它的默认 TokenCounter 是估算器，不能直接作为精确 32K 的证据。

官方来源（按具体版本或官方文档核对）：

- [AstrBot v4.29.3](https://github.com/AstrBotDevs/AstrBot/releases/tag/v4.29.3)、[插件事件文档](https://docs.astrbot.app/dev/star/guides/listen-message-event.html)
- [钩子调度源码](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/astrbot/core/pipeline/context_utils.py)、[工具循环源码](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/astrbot/core/agent/runners/tool_loop_agent_runner.py)、[临时内容](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/astrbot/core/agent/message.py)、[TokenCounter](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/astrbot/core/agent/context/token_counter.py)
- [NapCat 的 AstrBot 接入说明](https://doc.napneko.icu/use/integration)、[NapCat v4.18.41](https://github.com/NapNeko/NapCatQQ/releases/tag/v4.18.41)
- [Snow Luma 官方介绍](https://snowluma.github.io/en/docs/guide/introduction)、[v2.2.0](https://github.com/SnowLuma/SnowLuma/releases/tag/v2.2.0)

Snow Luma 首批通过公开协议连接用户另行安装的程序，不复制或打包其代码、专有组件和凭据。

## 实际执行记录

工作目录：`D:\Codex\2026-10-20\https-github-com-kayou-31-dsh\work\rp-memory-m5`。

Node：`v22.23.3`，使用项目工具链。
DSH 原生 SDK：`0.2.1-rc.2`；Cordis `4.0.5`，Schemastery `3.18.5`。前期调查没有重跑 rc.3；Task3a 已对最终代码补验 rc.3 的五项原生 SDK 场景，记录见本文末尾。旧版完整发行验收见 [0.2.1 报告](../releases/0.2.1/RESULTS.md)。

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| `node work/framework-review-2026-10-25/probe-core.mjs` | 0 | 10 项诊断断言；单独构建依赖、UTF-16 边界、附件草稿校验、64 KiB 边界、必需 voice 行为及核心重新打开 |
| `node --test --test-concurrency=1 work/framework-review-2026-10-25/probe-native.test.mjs` | 0 | 1/1；真实 DSH SDK 命令接收超过 16 KiB 的草稿、拒绝 2049 单元字段；provider 调用为 0 |
| `npm test`，首次基线 | 未取得 | 执行会话消失，日志止于第110项，没有最终汇总或退出码；保留原日志，不计为完整运行 |
| `npm test`，第二次独立基线运行 | 0 | 一次完整运行259/259，失败0、跳过0、取消0；138428.6916 ms。独立单次进程记录了开始/结束时间和退出码 |

诊断脚本和 JSON 结果保存在上述被忽略的 work 目录；原件和合成人物测试 profile 没有接入用户的真实 profile。上述两个命令串行执行，没有依赖安装、后台任务或模型 API 请求。

调查时有几次文件搜索因假定路径不存在或 PowerShell 下通配路径不适用而退出非零；改为先枚举实际文件再精确读取。它们不是测试失败，也不作为通过证据。

## 修改与未验证项

Task1新增 `src/rp/person/documents/{types,schema,import}.ts`，从 `memory.ts` 导出无损导入/验证函数；新增 `test/rp-person-documents.test.mjs`。草稿保留完整原文与哈希，分块最多8192字节，最多256节/512块以约束元数据；一份原文最大1MiB，不执行Markdown/HTML。此阶段只产出未采纳草稿，未写入人物存储或接入UI。

RED：新测试5/5失败，退出1，原因是新导出尚不存在。实现后5/5通过；补查对象属性名标题时新增回归6/7通过、1失败（`constructor` 被继承属性误识别），修正为只检查自有属性后最终7/7通过、退出0。`npm run typecheck`在最终Task1代码上退出0。日志位于 `.superpowers/sdd/2026-10-25-person-capacity-multihost/`，分别为 `task-1-red.log`、`task-1-heading-red.log`、`task-1-final.log`、`task-1-typecheck-final.log`。

未更改稳定版、依赖或真实宿主配置，没有发布新版本。新增用户参考项目的静态调查见 [RETCON-FORM](RETCON-FORM.md)；用户已同意吸收其可修订理解与来源定位思路。

一次独立只读设计审阅已完成，未创建递归代理。根据审阅收紧了三处：分别保留未分段 3/4 MiB 与分段 8/12 MiB 的存储预算；QQ 接入实例标识必须跨重连持久化；32K 注入计入同轮和请求中保留的记忆工具结果。审阅未发现必须由用户补充选择的关键接口缺口，但这不代替实现和宿主验收。

Task2新增 `person/documents/{format,service}.ts`，提供预览、确认、读取、修订和撤回；修改 `store.ts`、`canonical.ts`、`semantic-registry.ts`、`schema.ts`、`types.ts`、`growth-format.ts` 与 `memory.ts` 接入受认证的文档事件。原文单独存为来源，事件只保留定位与哈希；文档不进入普通事实状态。新工作区能力为 `rp.person-documents/v1`，第一次使用前复用完整备份，branch/global v1不变。修订保留旧证据，最新版失效后拒绝读取，不能自动回退旧稿；兄弟分支按固定历史独立。

Task2 RED：4/4失败、退出1，缺少文档服务。实现后的4项通过，补充真实旧读取器、备份/发布故障、retcon、隐私删除和底层绕过测试后8/8通过。定向回归一次运行 `node --test --test-concurrency=1 test/rp-person-documents.test.mjs test/rp-person-document-store.test.mjs test/rp-person-document-compat.test.mjs test/rp-person.test.mjs test/rp-person-compat.test.mjs test/rp-person-growth.test.mjs test/rp-store.test.mjs test/rp-read-view.test.mjs`，59/59、失败0/跳过0/取消0、退出0、15618.5593ms。日志为 `task-2-final.log`。这只是相关测试集合，不是完整 `npm test`。

真实旧读取器取自已发布0.2.1源码提交 `1d997516a3cb0621163a94a2bb16b1a7bd28243c`，确实拒绝新能力；合成profile的完整备份逐文件校验后恢复，旧版重新读到人物。没有迁移或还原真实用户数据。首次Task2类型检查暴露两处新事件类型联合的错误，修正后 `npm run typecheck` 单独执行退出0（`task-2-typecheck.log`）。

Task3新增 `person/documents/{audience,selection}.ts` 和受众/真实宿主回归。显式保存每节分类、标签与条件，默认仅归档；通过可信宿主能力区分平台、机器人账号、私聊、发送者、群和场景，正文不能授予身份。检索不返回原始文档清单，证据展开只读取已选片段，置顶不能越过条件或恢复已撤回内容。旧人物voice仍保持必需语义。分类编辑与管理快照界面统一留给Task5，避免提前加入尚未接通的按钮。

Task3初始4/4失败（未支持policies），实现后4/4通过。真实DSH rc.2测试进一步复现了文档片段与host journal原事件证明不匹配，以及“旧文档仍保留为历史导致旧注入被放行”两个问题。现已将片段绑定原文档事件证明，并在历史验证时要求文档仍为当前有效版本，验证过程使用同一read view。

Task3定向命令 `node --test --test-concurrency=1 test/rp-person-audience.test.mjs test/rp-person-document-host.test.mjs test/rp-person-document-store.test.mjs test/rp-injection.test.mjs test/rp-injection-host.test.mjs test/rp-injection-compat.test.mjs`：第一次27/28通过、退出1；原因是新增测试错误地期望插件主动关闭后原会话自动恢复准入。检查关闭实现后保留原有撤权规则，改为验收冷启动后的授权干净续接。修正后同一完整定向命令28/28、失败0/跳过0/取消0、退出0、12999.3812ms；日志 `task-3-final-2.log`。`npm run typecheck`退出0，日志 `task-3-typecheck.log`。没有把两次运行拼成一次通过。

新增真实SDK测试验证：文档片段进入请求、修订后旧历史被拒绝且不增加下游调用、干净续接选入新资料、关闭后冷启动仍可干净续接；使用离线终端，网络守卫无外发。测试准备曾因两个fixture并行启动/停止esbuild服务出现未完成顶层await，已改为串行加载；干净续接创建的agent不属于fixture原handle列表，关闭时沿用实际插件关闭流程。这些准备错误保留在日志中。

受众测试目前是核心可信能力测试，不能视为QQ平台身份验收；DSH无平台身份时只选择无账号限制的通用条件。尚未验证：原始超限迁移案例、实际 tokenizer 32K 边界、真实用户大文档迁移、独立 RPC 权限、真实 AstrBot 生命周期、NapCat/Snow Luma 真实 QQ 收发、跨平台账号映射、全新工作台交互与长期负载。

上述 Task1–3 的记录是分阶段结果。Task3a 收尾时已执行变更后的完整构建、测试、fixture 和打包预检，以下单列，不将此前定向结果拼成全量通过。

## Task3a：共同日记与 retcon-form 首批吸收

已完成核心和 DSH 指令/工具链路，未发布新稳定版。使用说明见 [共同日记](../shared-diary.zh.md)，参考项目的采用边界见 [RETCON-FORM](RETCON-FORM.md)。

| 修改文件 | 原因与实际行为 |
| --- | --- |
| `src/rp/diary/{types,schema,format,transition,admission,service,selection,evidence,commands}.ts` | 双方日记、默认关闭的 AI 写权限、作者与编辑者、追加修订、当前版本检索、隐私删除、可选理解和认证依据；实际发布前检查执行权限 |
| `canonical.ts`、`store.ts`、`schema.ts`、`types.ts`、`semantic-registry.ts`、`growth-format.ts` | 新增认证日记事件和 `agent_diary` 来源，复用事务、依赖失效和预升级备份；不伪造每篇人类确认，不把日记投影为事实 |
| `memory.ts`、`retrieval-index.ts`、`injection.ts`、`injection-binding.ts`、`packet.ts`、`packet-proof.ts` | 暴露日记应用服务，普通检索排除未认证原文；分层注入选择最新获准版本，历史证明拒绝旧解释 |
| `rp-plugin.ts`、`host-journal.ts`、`command-help.ts` | `/memcont diary` 和三项日记工具；真实会话/调用身份、实际返回记录版本及内容哈希认证、持久化失败封锁和干净续接 |
| `validation.ts`、`person/schema.ts`、`schema.ts` | 将原有纯数据校验提取为共享模块，避免离线浏览器编辑器导入 Node 存储、crypto 和 AsyncLocalStorage；规则没有另写一套 |
| `ui/person-editor/editor.js`、`SOURCE-MANIFEST.json` | 构建生成物及逐文件清单更新；没有增加尚未实现的工作台按钮 |
| 新日记测试及 `rp-person-document-compat.test.mjs`、`rp-person-editor.test.mjs` | 回归、真实旧版读取器与浏览器构建边界验证 |

自由正文之外，`reflection` 可记录 `understanding`、`context`、`uncertainty`、`revisionNote`、`evidence`。证据绑定实际事件 ID、revision 和原文 span；引用可验证不等于推断真实，栏目完整也不计为模型理解分数。没有执行或复制 retcon-form 的程序、提示词、数据库或 SKILL。

| 回归测试 | 已验证范围 |
| --- | --- |
| `test/rp-diary-schema.test.mjs`（4项） | 自由正文保真、可选反思、字段与容量边界、拒绝自报权限 |
| `test/rp-diary.test.mjs`（10项） | 默认关闭；开启后不逐篇生成人类控制；关闭/重新开启撤销旧句柄；禁止伪造作者和改人类日记；人类修订保留 AI 作者；幂等冷恢复；过期修订拒绝 |
| 同上 | 精确证据版本及原文哈希；跨人物/群隔离；裸来源/语义发布绕过拒绝；事务准备期间撤权不发布；全部版本隐私删除；独立分支隔离、全受影响分支授权；retcon 依据后相关解释失效、无关日记和原历史保留 |
| `test/rp-diary-host.test.mjs`（4项） | 实际 DSH SDK 写日记工具循环；关闭权限后的认证拒绝；回执保存失败后零后续模型调用且不重发；检索/读取工具回执；修订后旧工具结果拒绝进入下次请求、干净续接可读新稿 |
| `test/rp-person-document-compat.test.mjs` | 真实已发布 0.2.1 读取器拒绝日记能力；逐文件验证升级前备份，测试目录恢复后旧版重新读到人物 |
| `test/rp-person-editor.test.mjs` 新增回归 | 浏览器构建成功且依赖图不包含服务端存储、日记写入准入和发布门禁 |

### 执行记录与失败保留

Task3a 按先失败后实现推进：日记 schema 初始4/4失败（缺少导出）、服务初始4/4失败（缺少服务）、原生宿主初始1/1失败（没有 diary 指令）。其后补充旧写入句柄不能在重新开启后复活、列表/删除及注入回归并逐项修复。所有执行日志保留在本机 `.superpowers/sdd/2026-10-25-person-capacity-multihost/`。

过程中还记录了以下失败，不算通过证据：

- 首次完整 `npm test` 为 **294/295，退出1**，166957.2481ms。`rp-person-document-host.test.mjs` 加载 SDK 的 zod 依赖时出现 `ERR_INVALID_ARG_VALUE`，路径含空字节，尚未进入业务断言。检查实际依赖路径正常，独立重跑1/1通过；未确定偶发根因，没有宣称修好了 Node。最终独立完整运行结果见下表。
- 构建首次退出1：浏览器编辑器沿共用 schema 导入新文档/日记的 Node 依赖。新增浏览器测试明确失败后，提取纯校验模块；同一测试2/2通过，再运行完整构建通过。
- 两处新增联合类型的推导错误和日记删除返回类型错误，由类型检查发现并修正；最终类型检查退出0。
- 宿主测试初稿少一个闭合括号；修正后发现“所有历史都可携带”的断言包含本应等待采纳的原始助手消息，改为只检查经过认证的框架历史。撤权故障测试最初盯错了事务正文位置，改为在真实事务的日记语义标记写入时撤权。均保留原失败日志，没有弱化业务门禁。

最终代码按下列顺序串行执行，命令退出记录为 `task-3a-final2-commands.json`，日志前缀 `task-3a-final2-`：

| 命令 | 退出码 | 最终实际结果 |
| --- | --- | --- |
| `npm run typecheck` | 0 | TypeScript 5.9.3 类型检查通过 |
| `npm run build` | 0 | 插件、声明文件、离线编辑器及源码清单构建完成；esbuild 0.25.12 |
| `npm test` | 0 | **一次完整运行299/299**，失败0、跳过0、取消0；177897.73ms，未拼接定向重跑 |
| `npm run evaluate:fixture` | 0 | 固定语料检查完成；不能解释为真实模型语义质量或长期人格质量 |
| `npm pack --dry-run` | 0 | 打包预检完成，332文件，约3.0MB打包/6.2MB展开；未生成或发布新的稳定发行物 |
| `RP_NATIVE_SDK=work/release-0.2.1/sdk-rc3/node_modules node --test --test-concurrency=1 test/rp-diary-host.test.mjs test/rp-person-document-host.test.mjs` | 0 | 最终源码上 DSH rc.3 的5/5原生SDK场景，6799.7565ms；日志 `task-3a-sdk-rc3-final.log`，不是整个rc.3全量测试 |

Node 为项目工具链 `v22.23.3`。全量默认 DSH rc.2；rc.3 另用已隔离的真实 SDK 依赖。没有改共享 node_modules，没有同时启动多个重型进程，没有付费模型或 QQ 外发。原生 SDK 测试运行真正的会话、工具和持久化代码，终端输出由离线适配器提供；这不代表真实模型已经会正确理解或写日记。

### 兼容与未完成部分

- 保持 branch/global store v1。首次日记操作添加 `rp.shared-diary/v1` 能力并先备份，真实旧版读取器拒绝新版工作区。host journal 保持 v2，日记结果新增 `diary-result` 回执，绑定人物、日记本、权限版本与返回记录；不静默迁移未知工具历史。
- 没有改变原有模块注册表哈希，避免现有 M3 会话绑定全部失效。日记有单独的明确授权，不把通用只读检索模块升级成广泛写权限。
- 单篇正文16KiB、反思16KiB、证据最多16项；列表最多32项，历史一次最多256版，超出明确拒绝，历史分页尚未实现。当前检索仍需遍历可见条目，大规模长期负载没有实测。
- 隐私删除不管理外部备份、宿主日志或已发送内容；回退旧版需核对并恢复完整备份，不能直接降级读取新历史。未操作真实人物 profile。
- **尚未完成**：32,768 token 实际计量与整请求预算；大文档/共同日记的工作台页面；默认开启且可关闭的“修改前提示对后续对话的影响”；独立 core 分包与 RPC 单写入者；AstrBot 独立插件及 NapCat/Snow Luma 适配。
- **尚未验证**：新界面浏览器交互、真实超限迁移材料、真实模型语义连续性、跨平台账户身份与 QQ 收发、长期并发/大容量运行。先前一次 SDK 模块路径偶发空字节异常的根因仍未确认。

本阶段是可审核的开发提交，版本号仍保留0.2.1基线；没有以相同版本覆盖已发布包，也没有把后续任务标成已完成。

## Task4 与旧版审查修复：预算、权限和恢复诊断

实际基于 Task3a 的 `96604eb28efd722972b71539926a3e4bcb454841` 继续，不把昨天发布的 `1d997516…` 覆盖回当前工作树。审查提到的两个缺陷在当前代码仍可复现，均先记录失败回归后修复。完整人物/日记数据与既有工作台保留。

### 修改与回归对应

| 文件 | 原因与行为 | 回归 |
| --- | --- | --- |
| `token-budget.ts`、`token-budget-marker.ts`、`tokenizers/`、`assets/tokenizers/` | 新预算明确 tokens 单位、总额与五层额度；固定模型/词表修订、完整性检查、旧配置不重解释 | `rp-token-budget.test.mjs` 8项：32768/32769、重复及包装、中文/英文/emoji、真实参考向量、48KiB文档、降级与模型变更、核心请求竞态 |
| `injection.ts`、`injection-binding.ts`、`packet.ts`、`memory.ts` | 按真实计数选择片段，必需项越界拒绝；独立核心也执行预算；异步准入前复制请求、返回前重校原对象 | 同上及完整既有注入/核心回归 |
| `rp-plugin.ts`、`host-journal.ts` | 显式 `/memcont budget`、备份与降级防护；记忆工具串行；保留历史及实际返回均计入，真实发送前检查总容量和动态输出预留 | `rp-token-budget-host.test.mjs` 7项：实际工具循环、同轮双工具、并发删除、模型变更、备份/历史篡改、输出预留、下游错误分流 |
| `retrieval.ts`、`diary/service.ts` | 返回前按剩余额度选页，再认证实际 ID/revision/正文；分页游标只推进真实返回范围；日记写入前留回执空间 | `rp-token-budget-pagination.test.mjs` 2项及日记回归 |
| `store.ts` | 显式失效先校验 control/narrator、当前分支有效目标、受众、来源和 locked canon 的人工更正；事件替代/更正与撤源同样受控，内部依赖闭包保持原语义 | `rp-explicit-invalidation.test.mjs` 7项；存储、回放、分支、摘要联合定向78/78 |
| `person/editor.ts`、`editor-copy.ts`、构建生成 `ui/person-editor/editor.js` | 表单失败清旧命令；剪贴板失败只回退当前已验证草稿；异步期间编辑使旧回退失效；文件超限错误不被冒泡提示覆盖 | `rp-editor-copy.test.mjs` 4项与原编辑器2项；浏览器实际操作见下 |
| `rp-plugin.ts`、`command-help.ts`、`docs/COMMANDS.zh.md` | `bindingHealth` 与 `requestAdmission` 分开；提供拒绝阶段、原因及恢复动作；下游服务错误保留真实类别 | 原生 host/receipt 联合15/15及最终全量；modeEpoch 安全语义未放宽 |
| `.github/workflows/ci.yml`、`scripts/ci/check-history.mjs` | 一个 Windows/Node22 作业顺序执行锁文件安装、类型、构建、全量、fixture、打包；完整历史供三个固定旧读取器测试使用 | 本机历史检查退出0；远端 GitHub Actions 尚未运行 |
| `scripts/build.mjs`、`package.json`、`SOURCE-MANIFEST.json`、`.gitattributes` | 将离线词表及许可证纳入真实插件与清单；保留上游字节，避免 Windows checkout 自动换行破坏哈希；不增加在线下载或付费依赖 | 构建、打包预检及实际 TGZ 验证 |
| `scripts/benchmarks/memory-cost.mjs` | 8/32/128个合成事件下测检索、准备包、准入与核心重开成本，保留每个样本 | 独立离线评测，不能视为模型或生产性能分数 |

新预算说明见 [记忆预算](../memory-budget.zh.md)。目前精确文本计数只绑定完整模型名 `deepseek-ai/DeepSeek-V3.2`，本地 tokenizer 使用固定官方词表与哈希校验；其他模型和可变别名明确降级为 `conservative-utf8`。23组固定参考向量来自独立 Rust/Python tokenizer；开发探针比对完整 token ID，回归比对数量。没有下载模型权重或发出模型请求。

### 实际失败、修复和复核

- 预算核心初始4/4失败（缺导出）；宿主缺指令、分页不能按额度缩页也有独立 RED。随后真实工具循环暴露下轮 runtime-context 包装预留不足，按实际历史与工具声明修复；不是截掉已认证回执。
- 唯一只读审阅者发现独立 core `admit` 没执行新计量、同轮工具重复分配余额、请求在 await 期间可变三处问题。各补失败回归再修复；独立 core 默认将未分类请求保守计入，不接受调用方自报空记忆列表。DSH 使用私有凭据绑定实际请求、权限和快照。
- 显式 `invalidatedIds` 初始3失败/1通过；修复后联合分支/摘要46/46。二次审阅指出另三条低权限失效入口，新增回归实测4通过/3失败，修复后相关78/78。角色视角即使有 control 也不能主动撤销叙事；合法 narrator/control 的 retcon、fork 与 replay 保留。
- 复制回归初始4/4失败；修复后编辑器联合6/6。浏览器实际复现“生成 erin → 改成非法 bad id → 复制”：修复前旧命令仍被选中，修复后输出为空且显示 `未生成：Invalid RP record: id`；改成 `erin_updated` 后能复制新命令。剪贴板拒绝和等待期间编辑由单元测试覆盖，未伪称浏览器验证了权限拒绝。超过64KiB导入提示的冒泡覆盖另做静态修复和浏览器构建验证。
- 准入诊断初始缺 `bindingHealth`，定向失败；修复后 host+receipt 15/15。下游 provider 抛错仍保留 admitted，不冒充记忆权限拒绝；最终全量包含这条回归。
- 最后一次 rc.3 验证最初引用了错误的相邻目录，两个测试文件均在 SDK 加载阶段失败，未进入业务断言；核对真实目录 `work/release-0.2.1/sdk-rc3/node_modules` 后运行11/11通过。保留 `task-4-audit-rc3-final.log` 失败和 `task-4-audit-rc3-verified.log` 成功记录。
- 暂存新增词表后，Git读取新blob `9b4d31974a7e15e519ca5425ff2245a889779cf8` 报 zlib `incorrect data check`。先保留损坏对象原字节，独立Python解压同样失败；工作树文件仍匹配官方SHA-256，其Git blob SHA-1也与索引完全一致。仅用这份已验证内容重建同一对象并原子替换，随后 `git fsck --full --strict` 退出0（仅悬空blob提示，未删除）。现场在 `work/task4-git-diagnostics/`。这是已安全恢复的本机Git对象故障，发生根因未知，不能因恢复成功断言磁盘/内存或Node稳定性没有问题。
- 此前314/314、324/324为中间源码的全量结果，不能代替下表最终327/327。修补后的只读复核未见阻塞项；复核没有运行测试。

### 最终连续验证

日志保留在本机 `.superpowers/sdd/2026-10-25-person-capacity-multihost/`，最终五项使用 `task-4-complete-commands.json`，不是把定向重跑拼成全量。Node `v22.23.3`、TypeScript `5.9.3`、esbuild `0.25.12`、Cordis `4.0.5`、Schemastery `3.18.5`。全量默认真实 DSH rc.2，rc.3 使用独立 SDK 目录。

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `npm run typecheck` | 0 | 类型通过 |
| `npm run build` | 0 | 插件、声明、原离线编辑器、已有工作台样式及清单生成 |
| `npm test` | 0 | **一次完整327/327**，失败/跳过/取消均0；163922.2558ms |
| `npm run evaluate:fixture` | 0 | 固定语料验证完成，仅是确定性机制证据 |
| `npm pack --dry-run` | 0 | 348文件，约5.0MB压缩/14.6MB展开；此项在最终报告补写前运行 |
| `RP_NATIVE_SDK=work/release-0.2.1/sdk-rc3/node_modules node --test --test-concurrency=1 test/rp-token-budget-host.test.mjs test/rp-diary-host.test.mjs` | 0 | 11/11，9222.4873ms；仅这两个文件，不能称rc.3全量 |

SDK测试使用真实会话、工具、准入和持久化代码，网络守卫禁止外发，终端使用离线 LlmAdapter。浏览器测试页在验证后关闭，临时51419服务器已停止；这页是旧编辑器测试入口，没有替换人物工作台。

五项命令原始退出记录和完整测试输出另附 [命令记录](evidence/task4-commands.json)、[单次全量输出](evidence/task4-full-test.log)。报告补写只改变文档；额外评测脚本分别执行，不计入327项。

实际执行 `npm pack --pack-destination work/task4-audit-package --json` 退出0，产物5,039,215字节、SHA-256 `5b12f20c03cdc003b88a8851e63b3df9ed501d756f25590364467079ba0ce5ac`（开发快照，最终报告附件补写前打包）。安全解包后162个manifest条目逐一核对长度与哈希。使用其中 `lib/index.js` 在实际rc.2宿主完成一轮请求并确认 `tokenizer-text`；单独新进程改坏解包副本的配置词表，明确拒绝且下游0调用，随后恢复副本并核对原哈希。两次脚本退出均0；这是有断言的产物烟测，不把node:test输出的0项改写为单元测试数量。没有执行npm发布或覆盖正式包。

### 效果与成本：已获得什么证据

`node scripts/benchmarks/memory-cost.mjs work/task4-audit-package/memory-cost.json` 退出0，实际使用8/32/128个合成事件和本地tokenizer。检索中位数28.69/83.51/362.54ms，packet准备16.37/45.11/189.94ms，请求准入11.82/34.07/153.33ms；核心重开读取26.65/66.40/270.95ms。全部样本及限制见 [成本原始记录](evidence/memory-cost.json) 和 [下一阶段评测依据](EVALUATION-NEXT.md)。这是本机小样本，不是生产性能承诺。

`node scripts/benchmarks/person-life.mjs work/task4-audit-package/life-report.json` 首次进程以 **-1073741819（0xC0000005）** 退出，日志0字节且没有结果。检查时可用内存约19,101MiB，未发现相近时间node.exe应用事件；不能据此判定根因或证明不是运行时/硬件问题。保留 [首次失败诊断](evidence/life-first-failure.json)。

为避免无诊断重复运行，给现有评测增加阶段记录及每30次追加的进度落盘，再执行一次 `node --trace-uncaught --report-on-fatalerror --report-directory=work/task4-audit-package scripts/benchmarks/person-life.mjs work/task4-audit-package/life-report-diagnostic.json`，退出0，71,051.0662ms，四场景全部完成，120条干扰历史；见 [完整结果](evidence/life-report.json) 与 [阶段记录](evidence/life-diagnostic-progress.jsonl)。这次成功不表示首次崩溃已经修复；未无限重试，也未设置未经测量的内存上限。

该评测的三个分组比较的是**带标注证据是否仍可用**：当前有效记忆支持3/3、最近窗口0/3、未过滤档案3/3但泄露已撤销证据。答案由确定性脚本构造，不能称为真实模型正确率。真正的多会话人物稳定性、事实归属、更正后回答、方向关系、承诺延续和改述召回仍未验证；下一阶段四场景/两个对照的采样与判分规则已写入上述评测文档。

### 兼容、迁移与本轮仍有的边界

- branch/global store 保持 v1；host journal 仍为 v2，可选 memoryBudget 进入认证快照与工具回执。旧字节配置语义不变，新预算只能在空白根会话显式设置；升级前保存并验证 `.pre-budget-v2-backup`，另有持久化 marker 防止删除预算字段后静默降级。
- 原始历史、未知工具结果与 modeEpoch 的认证限制保留。同宿主销毁/重建仍可能需要 continue-clean；新诊断说明原因，不把失效历史重新放行。更换 provider/model 后须干净续接并重绑预算。
- 32K是全部记忆共用额度，包含重复包装与保留工具结果。精确文本 tokenizer 不是供应商隐藏模板或计费的精确结果；整请求仍有保守保护，模型输入和输出限制可先触发拒绝。
- 记忆工具串行避免共享额度竞态，也会增加同轮多工具延迟。单篇日记完整返回或拒绝，尚无正文分页。词表首次按需加载会占用内存，未验证移动设备、数月级大型库或长时间故障恢复。
- CI配置已提交到工作树，完整历史检查在本机通过，尚无远程 CI 成功记录。稳定0.2.1发行物保持原样；当前版本号是开发基线，不代表已发布上述功能。
- Task5的新工作台页面与可关闭影响弹窗、独立核心/RPC、AstrBot、NapCat/Snow Luma仍未完成。未调用付费API，未开启后台自动摘要/采纳/压缩，未操作真实人物数据，未进行QQ外发。


## Task5 阶段交付：工作台真实功能接入与原稿视觉恢复

基于 `23748c549c1e2bbf22bb577a9587427a06dab325` 的当前工作树继续，未覆盖后续功能。前两次视觉调整未获认可，本次以使用者重新提供的 `index.html` 为准，核对 SHA-256 与初次外包交付完全一致；详情见 [工作台视觉基准](WORKBENCH-REFERENCE.md)。不将原稿里的演示数据、模拟成功接口或演示时钟接入生产路径。当前版本号仍为 0.2.1 基线，没有覆盖线上发行物。

### 修改范围

| 文件 / 范围 | 本次作用 |
| --- | --- |
| `src/rp/person/management-extensions.ts` | 原文上传、分类条件、修订与撤回；共同日记的权限、写作、版本、导出与删除；服务端生成行为影响说明 |
| `management-settings.ts`、`management.ts`、`management-client.ts` | 默认开启并持久化的影响提示偏好；关闭后页内预览仍需明确确认；CAS、幂等重试与版本封锁不放宽 |
| `management-server.ts`、`store.ts`、`memory.ts` | 真实宿主控制权限校验；独立有界 UTF-8 上传路由；管理凭证撤销与晚到响应保护；字体固定白名单 |
| `src/rp/rp-plugin.ts` | 真实人物绑定、注入配置和 token 预算预览/保存；宿主命令在协调锁外执行，发布前再次检查；短句柄导入命令 |
| `workbench-client.ts`、`workbench-page.ts`、`workbench-visuals.ts` | 恢复原稿品牌、SVG、人物切换、档案状态卡与分栏、关系方向、目标与经历组件；阅读和编辑分离，保留真实来源 |
| `workbench-extensions.ts`、`ui/workbench/styles.css`、生成的 `workbench-style.ts` | 完整人物资料、共同日记、预算与设置页；复用原稿浅色/深色主题；弹窗与页内预览共用同一确认内容 |
| `assets/fonts/noto-serif-sc/`、`workbench-fonts.ts`、字体清单与生成脚本 | 原稿 Noto Serif SC 字体本地化；101 个 WOFF2、共 6,030,988 字节，固定 SHA-256，保留 OFL 许可证；工作台无外部字体或脚本请求 |
| `scripts/host-acceptance/workbench-browser.mjs`、新增/扩展的管理测试 | 原生 DSH SDK 测试工作台，可正常停止并保存零模型调用回执；可选合成人物视觉数据只存在于验收脚本 |
| `docs/COMMANDS.zh.md` | 增补开发分支导入短句柄、分类条件、共同日记、提醒偏好及预算操作；明确与已发布 0.2.1 区别 |

人物资料每份最多 1 MiB UTF-8；上传最多四份、10 分钟有效，并与权限及输入版本绑定。普通管理写入仍保持较小上限。未分类文字保留，默认仅保存、不注入。文件导入与导出保留 BOM、CRLF 和完整原文，不靠截断满足容量要求。

### 回归与实际界面证据

- `rp-management-extension.test.mjs`：4 项新增回归覆盖大原文、取消/过期/跨管理器上传、修订回读、提醒偏好、AI 无权修改偏好、日记原作者与人类修订、隐私删除。保留先失败后通过日志。
- `rp-management-host-extension.test.mjs`：2 项真实 SDK 回归覆盖人物绑定、注入配置、预算的实际生效、重复确认幂等、短句柄导入，以及人物修改后的旧预算预览拒绝；不调用真实模型。
- `rp-management-server.test.mjs`：固定字体白名单与字节哈希、CSP、越权路径、撤权和晚到响应、上传容量及跨来源拒绝。
- `rp-workbench-client.test.mjs`：新页面随插件打包、同一确认容器、关闭影响弹窗后仍需明确保存、失效凭证和不确定写入处理。静态页面检查不代替浏览器交互。
- 本次完整定向运行：上述四个文件 **17/17**，退出 0，5753.0112ms，日志 `work/task5-original-workbench/targeted.log`。
- CUA + 原生 DSH 测试宿主实际执行：建立人类可写日记、预览/确认/全文回读；关闭提示偏好后页内预览；74,296 字节 UTF-8 文件选择、解析、分类为人物/仅私聊、另一章节保留待分类、确认与导出；导出与原件 SHA-256 均为 `d2fd238e7c1ec62cdfa3339d36488b1d427f63a194c69ce4880339c6a4cbda2e`。
- 界面实际修改总预算为 12,000，五层为 3,000 / 2,000 / 2,000 / 4,000 / 1,000，保存后回读一致。非法总额与层上限超过总额均被拒绝；不能把保守 UTF-8 计量说成精确模型 token。
- CUA 验证人物切换只影响查看对象；聊天绑定保留原人物。人物背景编辑取消后重新预览，再明确确认，原始值、当前值、理由和接受序号正确显示。
- 原版与最终浅/深色实图已查看；关系方向、目标标签和经历列表已目视检查。最终截图保存在 `work/task5-original-workbench/profile-light-final.png`、`profile-dark-final.png`。人物均为通过真实指令创建的合成验收数据，不是生产人物，也不是模型效果评测。
- 正常关闭的 UI 宿主 `browser-1792952234443`、`browser-1792953361290`、`browser-1792953703391` 均写出 `final-status.json`，模型调用数为 0。早期 `browser-1792951768953` 用 Ctrl-C 停止为退出 1，没有正常结束回执，不能列为正常关闭通过。

### 命令与结果

第一轮连续五项检查全部退出 0，其中一次完整 `npm test` 为 **337/337**、169661.0156ms。之后只修正首屏提示占位和目标标签宽度，最终文件重新连续验证，独立日志放在 `work/task5-original-workbench/verification-v2/`；不把两轮定向结果拼接为全量通过。

| 命令 | 退出码 | 最终连续运行结果 |
| --- | --- | --- |
| `npm run typecheck` | 0 | TypeScript 类型检查完成 |
| `npm run build` | 0 | 插件、声明、离线编辑器、样式与源码清单构建完成 |
| `npm test` | 0 | **一次完整 337/337**，失败/跳过/取消均 0，168148.8186ms |
| `npm run evaluate:fixture` | 0 | 固定语料检查完成，不代表真实模型质量 |
| `npm pack --dry-run --json` | 0 | 472 文件，压缩估计 11370210 字节，展开 21609634 字节；仅打包预检，未发布 |

检查差异时发现部分新增文本被本机 Python 写成 CRLF，与仓库 LF 基线不一致；只对这些源码/文档规范换行，逐文件确认规范化前后内容相同，不修改固定词表和字体字节。随后重新构建退出 0，管理 HTTP/客户端定向检查 11/11（996.3748ms），DSH rc.3 原生工作台扩展 2/2（1798.2083ms）；格式收尾日志为 `format-build.log`、`format-ui-tests.log`、`rc3-host.log`，不计入上面 337 项的完整测试运行。 最后一次 `npm pack --dry-run --json` 退出 0（`format-pack.log`），472 文件、压缩估计 11,372,943 字节、展开 21,608,320 字节；源码清单的 278 个文件逐一校验大小和 SHA-256 一致，`git diff --check` 退出 0。


### 兼容、限制与剩余范围

- Node `v22.23.3`，TypeScript `5.9.3`，esbuild `0.25.12`，Cordis `4.0.5`，Schemastery `3.18.5`。本阶段全量默认使用真实 DSH rc.2 SDK；另使用隔离的 rc.3 依赖通过工作台扩展原生测试 2/2，覆盖绑定、配置、预算、幂等和过期预览拒绝。这不是 rc.3 全量测试，也不是 DSH 桌面应用实测。
- 保持 branch/global store v1 与 host journal v2。沿用已有新人物/日记/预算能力标记、备份与旧读取器拒绝规则；没有迁移真实人物 profile。工作台提醒偏好单独保存在本机 profile 的 `.dsh-rp/v1/workbench-settings.json`。
- 这是串行开发阶段结果，没有启用后台自动摘要、压缩、采纳或主动写作，没有付费模型、QQ 外发或真实模型语义评测。
- 字体新增约 6.03 MB 原始资源；固定资源哈希校验随字体请求执行，尚未做低性能设备或大量并发浏览器性能测量。
- 尚未覆盖所有后端功能页面：全局记忆发布/采纳/撤销、摘要和分支/retcon 的完整图形操作仍需后续对照后端能力逐项补齐；现有页面保留真实宿主指令入口，不显示虚假的成功操作。导入专题后来已补齐，见下方进展。
- 尚未验证：手机/平板窄屏与完整键盘无障碍流程；当前改版中全部破坏性操作的浏览器端执行；DSH 桌面正式安装后的完整交互；真实模型长历史效果；大规模持续运行。使用者对这次视觉恢复尚未给出认可，不能将自动测试成功记为审美验收。
- Task5 尚需完成其余页面覆盖核对与完整界面验收；核心分包、单写入者服务、AstrBot、NapCat / Snow Luma 和统一发布继续保留在后续计划。本阶段未推送或发布，未覆盖已有稳定版本。

## 功能优先调整与 Task6 独立核心包

使用者再次指出网页仍未符合原稿，决定先完成功能，再逐页对照。**当前视觉验收未通过**；上面的截图和交互证据仅证明测试范围内的操作，不代表外观已被认可。保留原始 HTML，不要求使用者先逐页截图。Task5 其余功能页和完整界面验收仍未完成；先接通独立核心与服务，之后补齐各宿主共用的管理入口。

- `/memcont help document` 已加入原文容量、BOM/CRLF 保留、默认仅归档、短句柄预览/确认/放弃、十分钟有效期与不自动重试的说明。测试先因缺少专题失败，修复后 **4/4**、退出 0，证据在 `work/task5-function-completion/help-red.log` 与 `help-green.log`。
- 新增 `src/core/index.ts`、`packages/core/`、`tsconfig.core.json` 与 `scripts/build-core.mjs`。`@memory-continuity/core@0.1.0-dev.1` 是本地开发包版本；复用原有 TypeScript 记忆实现，保留人物、原文、日记、预算、管理工作台接口，不包含 DSH 运行依赖，也没有安装时下载。
- `test/core-package.test.mjs` 和 `test/fixtures/core/package-smoke.mjs` 对真实 TGZ 执行离线安装，在仓库依赖树之外验证 DSH/Cordis 无法解析，两个独立 Node 进程完成写入和冷读。人物、原文 SHA-256、日记、版本围栏一致；真实工作台 HTTP 快照与本地字体可读，修改隔离包中的 tokenizer 后拒绝使用。
- 首次打包测试因缺少构建脚本失败；第一次实现检查发现误写的类型导出 `EventRecord`，核对当前契约后改为 `SemanticEvent`。之后定向打包测试 **1/1**、退出 0（7234.5753ms），原始日志保留在 `work/task6-core/`。
- TGZ 中清单覆盖的 **178 个文件**逐一比对大小和 SHA-256，并与包内文件集合核对。完整运行的包和隔离目录可从 `work/core-package-tests/*/receipt.json` 回溯。这是实际打包、安装与运行，不是仅检查清单。

随后对当前源码连续运行以下五项，回执为 `work/task6-core/final/verification-receipts.json`：

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| `npm run typecheck` | 0 | 类型检查通过 |
| `npm run build` | 0 | DSH 插件、声明、编辑器、样式和清单构建通过 |
| `npm test` | 0 | **一次完整 338/338**，失败/取消/跳过均 0，174833.2244ms |
| `npm run evaluate:fixture` | 0 | 固定语料检查；不是模型语义质量结论 |
| `npm pack --dry-run --json` | 0 | DSH 插件打包预检完成；未发布 |

环境仍为 Node 22.23.3、TypeScript 5.9.3、DSH rc.2、Cordis 4.0.5、Schemastery 3.18.5。本阶段未改变 branch/global v1 或 host journal v2 格式。独立核心的跨进程单写入者、本机认证服务及 AstrBot 适配尚待 Task7–9；当前开发核心只用于隔离验收，不能据此承诺多宿主同时写同一 profile。没有调用模型、启用后台功能、发布 npm 或覆盖稳定版。

## Task7 阶段一：profile 单写入者与显式恢复

Task5/6 已保存为本地提交 `36dd329`。本节继续完成 Task7 的占用与生命周期部分，**尚未完成认证 RPC 和 AstrBot 请求生命周期**。

- `src/core/owner.ts`：在访问存储前占有整个 profile。所有权描述先完整写入、同步，再用排他硬链接发布，避免半份锁记录被当作可恢复证据；第二进程拒绝进入。正常释放核对精确摘要，异常退出必须显式诊断并验证旧进程已死亡。
- 恢复操作自身使用不可变、带哈希链的声明串行化。恢复进程再次崩溃后，新进程验证其死亡再接续；不按年龄抢锁、不删除损坏历史。每个旧 owner 最多 128 条恢复声明，超过后保留现场并拒绝继续。
- `src/core/owned-memory.ts`、`src/rp/rp-plugin.ts`：独立核心与新版 DSH 嵌入入口使用相同所有权。`close()` 立即撤销旧核心的访问资格，等待在途写入和任务收尾后才释放 profile。启动失败清理也释放自身占用。
- `src/rp/store.ts`、`global.ts`、`memory.ts`：存储操作和实际发布前再次核对生命周期。回归测试发现全局写入原先可在关闭期间继续发布，现已拒绝；已发布事务仍允许完成 seal，结果无法确认时保留 `persistence_uncertain` 语义。
- `src/core/cli.ts`、核心包构建与 README、中文指令文档：新增实际随 TGZ 分发的 `memcont-core owner inspect/recover`。仅用于本机管理员；没有自动启动服务或后台解锁。恢复占用不会恢复会话请求资格，也不会重发 ambiguous 输入。

### 回归与故障证据

`test/core-owner.test.mjs` 使用实际子进程验证互斥、正常释放、进程被杀后的显式恢复、旧摘要不能移除新 owner、恢复过程中再次崩溃、损坏记录保留；还验证核心关闭等待在途操作、旧句柄拒绝写入，以及暂停在全局 commit 同步后、rename 前的关闭竞态。`test/core-native-owner.test.mjs` 验证真实 DSH SDK 与第二个独立 Node 写入者互斥。

- 所有权 API 最初 **4/4 失败**，原因是缺少 API；首次实现 **3/4**，诊断发现故障子进程在安装 IPC 监听前悬停，导致它自行退出，无法模拟“仍活着的恢复者”。修正测试生命周期后 **4/4**，没有放宽存储判断。
- 官方入口接线测试最初 **4/6**，缺少实际占用；全局在途发布测试 **6/7**，确实复现关闭后仍发布。修复后同一组 **7/7**。
- 第一次相关回归 **22/34**：12 个既有真实崩溃测试在新增 profile 占用检查处拒绝启动。明确加入管理员诊断、核对被杀 PID 并恢复占用这一步；原有 journal、准入、备份、继续干净会话的断言全部保留。随后一次完整相关回归 **34/34**，26793.1508ms。这里没有新增自动解锁。
- 真实 TGZ 缺少命令行入口的测试先失败，添加入口后 **1/1**、7751.7938ms。隔离安装后实际运行命令：诊断已退出进程、拒绝过期摘要、显式恢复，再用独立进程读取原人物、原文和日记，内容与版本围栏保持一致。
- 类型检查首次发现 `never` 箭头帮助函数导致读取器返回类型被推断为可空，改为明确的函数声明后通过。首轮 rc.3 检查因误指向仓库外的 SDK 路径失败，核对实际目录和包版本后，用本仓库 `work/release-0.2.1/sdk-rc3/node_modules` 独立通过 **12/12** 原生占用、生命周期及工作台扩展测试（4231.0349ms）。不把路径失败说成产品故障已修复，也不把这 12 项说成 rc.3 全量。

原始日志均保留在 `work/task7-owner/`。Task6 提交后的完整差异检查另发现字体来源清单 `UPSTREAM.json` 使用 CRLF；仅统一该自有元数据文件为 LF，字体和词表原始字节未更改。以下构建与清单验证已包含这次格式修正。

### 本阶段连续验证

`work/task7-owner/final/verification-receipts.json` 记录五项串行命令及时间，全部退出 0：

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| `npm run typecheck` | 0 | 完成 |
| `npm run build` | 0 | 完成；源码清单 286 个文件逐一核对大小与 SHA-256 一致 |
| `npm test` | 0 | **一次完整 345/345**，失败/取消/跳过均 0，179567.9976ms |
| `npm run evaluate:fixture` | 0 | 固定语料检查完成；未做真实模型效果判断 |
| `npm pack --dry-run --json` | 0 | 480 文件，压缩估计 11,395,503 字节，展开 21,690,897 字节 |

仍使用 Node 22.23.3 和原有 SDK 版本；branch/global v1、host journal v2 未升级。新增 `.memory-continuity-owner` 是本机占用与恢复证据，不是剧情来源。此协议只约束新版官方入口，旧版或绕过入口的程序仍须管理员先停止。PID 被复用、权限不足无法验证死亡、损坏证据、文件系统不支持硬链接时都不会强行开启写入。未验证跨操作系统文件系统、真实断电、长期压力，也未发布此次开发包。

## Task7 阶段二：本机认证服务、持久回执与实际进程恢复

本阶段复用独立核心接通管理和检索，尚未把服务变成模型请求网关。用户询问后续是否需要逐张截图：原始 HTML 已保留，视觉工作继续暂停，之后先由开发者逐页对照，只在原稿缺少特定状态时补充参考。

- `src/core/server.ts`、`rpc.ts`：仅 loopback、强随机管理凭据与短期只读工具令牌分离，真实 Authority 留在服务端。拒绝伪造权限、未知操作、错误 Host/Origin；请求/响应各 128 KiB，最多 16 个连接、32 个在途请求、64 个会话，每会话最长十分钟和 128 个检索回执。并发签发先预留容量，并发打开工作台复用同一个 listener；撤销或过期同时停止工具资格和对应工作台。
- 检索回执来自实际返回的 record/revision/content hash，并在返回前复核；更正后原回执失效，不能借另一会话的回执或用新版本认证旧内容。状态固定显示 `modelDispatch: false`，不把检索认证解释成模型发送准入。
- `src/core/confirmations.ts`：管理预览、尝试和完成各有不可变摘要链。冷启动重复确认已完成操作只返回原回执；旧未确认预览拒绝执行，尝试过但完成回执丢失时保留 `persistence_uncertain`，不自动重做。原始人物/日记正文不另存一份。读取回执前还要验证实际存储，不能让一张完好回执掩盖底层历史损坏。
- `src/core/cli-service.ts`、`cli.ts`：新增实际打进 TGZ 的 `memcont-core serve`。管理员显式提供配置和新的连接文件；不覆盖已有文件，不打印管理 token。正常 `quit` 关闭服务和占用，异常退出保留诊断证据。配置使用已建立的工作区和分支，暂未提供一键初始化。
- `src/core/index.ts`、`owned-memory.ts`：导出服务入口和绑定类型，使用已验证的 canonical profile 根路径保存确认元数据。`packages/core/README.md` 与 `docs/COMMANDS.zh.md` 同步开发命令、配置、错误恢复和尚未接通的功能。

### 回归与失败记录

`test/core-service.test.mjs` 覆盖认证边界、实际检索证据、撤销/过期、输入上限、并发工作台、最后一个会话槽位争抢、撤权中的迟到读取、冷启动凭据失效、不完整 HTTP 请求超时、在途请求上限、持久确认、回执丢失、损坏历史，最终 **14/14**（3518.3624ms）。

- 初始 4 项因服务不存在而失败。首次实现发现请求授权要求 sessionId 与 sceneId 成对，补齐真实授权字段；随后两项测试问题分别是 fetch 不采用手写 Host，以及人物编辑缺少原契约的 operation/previousEventId，改为真实 node:http 和合法编辑输入后 4/4。
- 并发回归先 4/6，实际复现重复创建工作台及超额签发会话。修正共享打开 promise 和同步预留后 6/6。失败测试曾留下一个合成验收 listener，使用其自己的关闭接口清理；未停止用户预览。测试 finally 也补上失败时的清理。
- 不完整请求超时先 8/9，再 9/9；并发上限先 9/10，再 10/10。类型检查发现泛型联合解包问题，明确未知返回类型后通过。
- 持久确认入口缺失先 10/13，接通后 13/13；之后新增“底层历史损坏仍返回成功回执”的回归，先 13/14，增加实际 readFence 校验后 14/14。完成回执写入 EIO 时，人物修改已存在但冷重试不新增事务；损坏证据原样保留。
- CLI serve 最初因缺少子命令失败。`test/core-package.test.mjs` 与 `test/fixtures/core/service-process.mjs` 在真实离线安装的 TGZ 中启动独立服务进程，经真实 HTTP 修改人物后 SIGKILL；第二个进程被占用锁拒绝，CLI 诊断旧 PID 死亡并显式恢复后，新的服务拒绝旧凭据，同一确认返回原回执且版本不再增长，最后 `quit` 退出 0 并释放占用。该独立验收 **1/1**（9593.5038ms），不是进程模拟。

全量测试中的核心包验收另留回执 `work/core-package-tests/9ed2f872-8450-42c1-8a89-e6b08a709896/receipt.json`：实际包清单 **185 个文件**逐一核对大小、SHA-256 和完整文件集合；隔离目录无法解析 DSH/Cordis，两个进程写入和冷读人物、原文与日记一致，CLI 崩溃恢复及词表篡改拒绝通过。所有早期失败和退出码保留在 `work/task7-service/`，没有用定向重跑拼接全量通过。

### 本阶段连续验证与限制

`work/task7-service/final/verification-receipts.json` 记录同一源码上五项连续串行命令：

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| `npm run typecheck` | 0 | 类型检查完成 |
| `npm run build` | 0 | DSH 插件、声明、编辑器和源码清单构建完成 |
| `npm test` | 0 | **一次完整 359/359**，失败/取消/跳过均 0，187086.7261ms |
| `npm run evaluate:fixture` | 0 | 固定语料检查完成，不是实际模型效果结论 |
| `npm pack --dry-run --json` | 0 | DSH 插件打包预检完成；随后文档补充不改变运行代码 |

在最终运行代码上再用实际 rc.3 SDK 串行运行 `core-native-owner`、`rp-host-lifecycle`、`rp-management-host-extension`：**12/12**、退出 0，4260.5973ms，网络保护未观察到外部模型请求。回执为 `work/task7-service/final/rc3-receipt.json`；它是明确范围的 rc.3 原生验收，不是 rc.3 全量。

额外实际打包：`npm pack --json --pack-destination work/task7-service/artifacts`、`node scripts/build-core.mjs --out work/task7-service/artifacts/core-stage`、在 core-stage 内执行 `npm pack --json --pack-destination ..` 均退出 0。Python 实包核验退出 0：DSH 归档 488 个文件，其中源码清单覆盖的 294 个文件大小与 SHA-256 一致；核心归档 186 个文件，清单覆盖除清单自身外的全部 185 个文件，无外部 runtime/peer 依赖。包内与工作区源码清单均核对通过，回执保存于 `work/task7-service/artifacts/pack-verification.json`。这是本地工程核验快照，不是新发行版；DSH package identity 暂沿用 0.2.1，正式发布时仍须确定新版本并重打包，不覆盖已有发行物。

打包命令后的 `git diff --check` 单独发现本报告追加段末尾的 CRLF 空白问题，首次组合命令因此退出 1；仅规范化报告换行后检查退出 0，运行代码未改动。上述五项完整验证没有因此被改写或拼接。归档中的报告是打包当时的版本，最终交付还需包含之后补充的实包回执说明。

环境：Node 22.23.3、TypeScript 5.9.3、esbuild 0.25.12、DSH rc.2（全量中的实际 SDK）和 rc.3（上述单独验收）、Cordis 4.0.5、Schemastery 3.18.5。branch/global v1、host journal v2 未升级；确认元数据是单独的本机管理回执，不是剧情证据。公开输出不包含私密附件、配置或连接 token。

仍然存在的限制：

- Task7 的跨进程模型准备/准入/取消，以及 Task8 平台事件绑定、模型侧日记工具和实际 AstrBot 运行尚未接通。已验证的管理/检索 HTTP 不能替代每次实际 provider 调用前的校验。静态调查发现 AstrBot v4.29.3 的工具循环和 provider 内部重试有独立发送路径，正在核查可维护接入方式；没有修改宿主来冒充兼容。
- 确认历史最多 4096 份预览，不自动截断；达到上限后拒绝新预览，目前没有归档工具。回执内容只记录摘要，但目录规模、长期使用成本和容量边界的压力实测尚未完成。
- 未实测真实断电、跨操作系统文件系统、完整网络断开与写入各阶段的排列组合、实际用户长历史、真实模型语义效果、QQ 账号登录/发信、NapCat/Snow Luma 整链。进程 SIGKILL、写入 EIO 与 HTTP 超时各有独立证据，不能概括成所有故障均验证。
- 仍需补齐工作台的其余功能页和完整交互验收，再按原稿调整视觉。当前页面未得到用户视觉认可。本轮没有后台自动行为、付费 API、push 或 Release，也没有覆盖稳定 0.2.1。

## Task8 阶段一：AstrBot 管理桥与实际请求边界（2026-10-26）

这一阶段先把独立核心接到真实 AstrBot 的管理入口，再用实际 provider 检查请求边界。**目前交付范围是开发版管理桥，模型记忆注入仍未开放。** 核心继续是独立 Node 包，Python 适配器没有复制存储实现，也不依赖 DSH。

### 改动与使用范围

- `adapters/astrbot/core_client.py`：标准库薄客户端，读取本机实例连接文件，管理凭据留在适配器内部；每次请求前后核对文件摘要。请求、响应各限 128 KiB，本桥最多 16 个临时会话。文件缺失、替换或传输失败会让旧客户端失效，恢复文件不会自动恢复资格。关闭先停止本地访问，再尽力撤销服务端会话；无法连通服务时仍受服务端最长十分钟限制。
- `adapters/astrbot/main.py`、元数据和配置：默认关闭，仅在 AstrBot 管理员私聊中支持 `/memcont connect/status/open/close`。命令停止后续普通模型处理；非管理员和群聊在读取凭据前被拒绝。连接、工作台打开和断开均由明确命令触发，保存仍经过核心原有预览与确认。
- `scripts/build-astrbot.py`：生成独立 ZIP，仅包含五个插件文件、许可证和 SHA-256 文件清单。输出路径必须为新文件；相同源码生成相同 ZIP 字节，不打入 SDK、Node、账户资料或测试数据。`test/astrbot-package.test.mjs` 将清单、语法、默认关闭和拒绝覆盖纳入根测试集。
- `.github/workflows/ci.yml`：加入固定提交的 Python 3.13 setup，仅供标准库打包测试使用；没有把完整 AstrBot 安装塞进现有 CI。`docs/COMMANDS.zh.md` 和适配器 README 已同步上述指令、恢复方法和能力边界。

### 回归和真实宿主证据

独立环境使用官方 **AstrBot 4.29.3**，源码提交 `f61a7f42696da6df25dc7a249ec9b8d54ed9da18`、Python **3.13.15**、uv **0.12.3**。源码和虚拟环境均位于项目 `work/task8-host/astrbot-v4.29.3`，未修改宿主源码；共享 node_modules 与全局 Python 环境未安装新依赖。首次完整依赖解析安装 172 个运行依赖，隔离环境中的 `uv.lock` SHA-256 为 `6946f00e500adb82e748c9d4b0634c49a7b5e44463c2c2c73748446d240217e5`，精确依赖导出保存于 `work/task8-host-research/resolved-requirements.txt`。

| 验证 | 实际结果与含义 |
| --- | --- |
| `test_core_client.py` | 6 项连接实际 Node 核心进程的测试：回执绑定、跨会话拒绝、更正后失效、主动撤销、文件更换/缺失后不可复活、实际断线后不自动重连 |
| `test_host_management.py` | 将当次构建的真实 ZIP 解包给 AstrBot 自身 PluginManager 加载，使用实际配置、SQLite、事件对象和注册处理器，验证管理员私聊、打开工作台、卸载后服务端会话撤销 |
| `test_provider_boundary.py` | 3 项调用真实 `ProviderOpenAIOfficial`，终端为本机合成 HTTP 服务；复现内部重试、上下文异常重试，并证明专用 HTTP 客户端可以在第二次网络发送前拒绝 |
| 审阅前的完整 Python 命令 | `python -m unittest discover -s adapters/astrbot/tests -v`，**一次 10/10，退出 0，19.101 秒**；日志 `adapter-all-final.log`，回执 `adapter-final-receipt.json`；审阅后的新增回归另见下文 |
| ZIP 定向回归 | `node --test --test-concurrency=1 test/astrbot-package.test.mjs`，**1/1，退出 0，426.5909ms**；后续完整根测试另记，不与该次拼接 |

Python 命令须使用上述虚拟环境，并显式设置 `MEMCONT_ASTRBOT_SOURCE` 为官方 checkout、`MEMCONT_TEST_NODE` 为 Node 22.23.3。测试网络守卫只允许 loopback；provider 的三项测试总共到达本地合成终端 **5 次 HTTP 请求**，没有外部模型调用和语义效果结果。加载测试没有启动平台账号，也没有完整构建 AstrBot 的 provider/platform/conversation 生命周期，所以这是**真实宿主组件集成**，不能当作完整宿主或 QQ 验收。

原始失败没有省略：

- 薄客户端最初 4 项缺失失败；实现后 4/4。再增加旧客户端复活与实际断线场景，先 3/5，再 5/5。文件移走后放回的新增场景也先复现失败，再修正；最终统一跑出上述 10/10。
- 实际插件入口缺失先失败，初版实现后 1/1、60.181 秒。该次 SDK 冷导入约 58.219 秒，期间日志缓冲造成看起来停住；最终进程正常退出 0，未据此宣称宿主死锁或杀死测试。之后加入限时线程栈诊断，测试自身失败清理也覆盖初始化阶段。
- ZIP 构建器缺失的测试先失败，添加后通过。此处不把 Python 语法检查代替实际加载；最终加载测试使用了构建出来的 ZIP。
- 首次克隆退出 128，原因是继承的 `127.0.0.1:12450` 代理不可达；核对配置后只对该次 Git 命令清空代理，克隆退出 0，没有改全局代理。首次 `uv sync --frozen --no-dev --no-install-project` 退出 2，因为该上游 tag 没有锁文件；在独立环境明确解析依赖后同步退出 0，保存实际锁文件和依赖清单，没有反复盲重试。
- 上游 jieba 在 Python 3.13 下报告转义序列 SyntaxWarning；真实 SDK 导入及本机 provider 初始化有 asyncio 慢任务提示。没有修改上游代码隐藏它们，也没有据此推断长期性能。

所有本轮原始日志在 `work/task8-host-research/`。审阅前检查点使用 Node **22.23.3** 串行执行五项检查，回执为 `final/verification-receipts.json`（后续修正不冒用该次结果）：

| 命令 | 退出码 | 本次完整结果 |
| --- | --- | --- |
| `npm run typecheck` | 0 | 类型检查完成 |
| `npm run build` | 0 | DSH 独立构建完成 |
| `npm test` | 0 | **一次完整 360/360**，失败、取消、跳过均 0，218795.6532ms；没有与定向重跑拼接 |
| `npm run evaluate:fixture` | 0 | 固定语料检查完成，不是模型语义质量验证 |
| `npm pack --dry-run --json` | 0 | 当次 DSH 预检 488 文件，压缩估计 11,414,636 字节，展开 21,751,593 字节 |

此阶段没有改动 TypeScript 运行核心或 DSH 宿主入口；本次完整根测试包含 rc.2 实际 SDK 测试。rc.3 仍引用前一代码检查点的独立 12/12 证据，本轮未重跑，不能写作本轮 rc.3 全量通过。GitHub Actions 未运行。

审阅前实际执行 `python scripts/build-astrbot.py --out work/task8-host-research/artifacts/astrbot-memory-continuity-management-0.1.0-dev.1.zip` 退出 0，生成 **9,309 字节**独立 ZIP，SHA-256 为 `66bcad1575f82c29c36d9506ee91103d2e1242a6896cccf1df5e318f191880dc`。这个旧检查点保留，不覆盖；它不能作为完整 AstrBot 适配正式版发布。根 DSH package 仍沿用开发基线标识 0.2.1，未覆盖任何稳定发行物；正式交付需要在所有约定功能验收后更新版本、文档并重新生成发行包。

### 下一步与保留的限制

真实测试确认：只在 AstrBot 的一次 `text_chat` 入口检查是不够的；即使内层重试设为 1，上下文错误路径仍可能删减消息并重新发送。专用 provider 的 HTTP 客户端实验能够拦住后续发送，说明仍有可维护的接入方向；它还没有连接核心准入生命周期，**不能当成已经实现的安全门禁**。

Task7/8 仍需完成跨进程请求准备、每次发送前准入、撤权与取消、平台人物绑定、临时记忆不入宿主持久历史、工具循环/fallback 和模型侧日记写入。Task9 的 NapCat、Snow Luma 整链尚未验证。新建空 profile 的初始化向导、工作台其余功能页与视觉还原、真实模型长历史效果和长期稳定性也保留为未完成或未验证项。没有开放后台功能、没有付费 API 或真实 QQ 发信，没有 push、Release 或覆盖稳定 0.2.1。

用户另询问是否融合上下文压缩项目。本次只读核对本地 Ultra-Memory 0.2.0（`607ab3b`）与 Ultra 0.7.0（`3b9d7c7`）：建议继续独立分包，未来可按需接入工程目标、进度、决策、证据和待办，共享注入预算与失效约束。压缩摘要不能自动成为人物事实，原来源撤销后也不能借归档重新注入；两边当前计量单位不同，不能简单叠加限额。本轮没有实现融合或开启压缩。

### 只读审阅后的修正与验证

本阶段仅安排一个只读审阅者，不修改文件、不运行测试、不派生代理。审阅确认两项 P2，均先用实际核心复现：

1. 撤销请求因核心达到在途上限而收到 429 时，客户端提前删除唯一的会话记录，导致之后明确关闭也漏掉撤销。现在先撤销本地可用资格，同时保留独立的待清理记录；这些记录仍占 16 个会话限额，之后明确关闭或卸载会再尝试清理，没有后台重试。
2. 旧会话十分钟到期后，核心先清理它，再处理撤销请求，原实现导致第一次 `open` 失败。现在只对该错误查询同一实例的认证状态，确认旧 ID 确实不存在后才按已撤销处理。未知权限错误不会被忽略，也不信任本地时钟来放行。

两项新增测试初跑 **1 项断言失败、1 项错误**（`review-revoke-red.log`），修复后完整客户端 **8/8、退出 0、9.875 秒**（`review-revoke-green.log`）。只读复核确认这两处已闭合。

审阅者曾怀疑 `stop_event()` 会阻断管理回复，继续核对调度器后撤回；开发者也纠正了过早作出的进度判断。为消除这个不确定性，宿主测试扩展到实际 `PipelineScheduler` 的命令处理、结果装饰和发送阶段，只有最终平台 `send` 替换为本地记录器。断言每条管理命令只发一条回复、正常到期后的第一次 `open` 成功；**没有修改生产消息处理来迎合错误判断**。

扩展后的第一轮 **11/12**：测试环境尚未提供结果装饰所需的真实 ProviderManager，TTS 查询遇到空对象。补齐实际配置路由、人物管理器与空 provider 管理器后，第二次单独的完整 Python 命令 **12/12、退出 0、20.869 秒**，日志 `adapter-reviewed-final2.log`，回执 `adapter-reviewed-receipt2.json`。这 12 项包含 8 个客户端测试、1 个真实 ZIP/宿主组件调度测试和 3 个 provider 边界测试。没有安装或启动管理夹具的模型 endpoint，也没有真实 QQ 发送；合成终端证明调度，不证明账号接入。

修正后的最终运行代码再次依次运行五项命令，均退出 **0**，没有使用定向测试拼出全量结果：

| 最终命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run typecheck` | 0 | 通过 |
| `npm run build` | 0 | 通过；构建源码清单 294 项大小和 SHA-256 逐一吻合 |
| `npm test` | 0 | **一次完整 360/360**，失败/取消/跳过均 0，186162.1616ms |
| `npm run evaluate:fixture` | 0 | 固定语料检查完成，仍不代表真实模型效果 |
| `npm pack --dry-run --json` | 0 | DSH 当次预检 488 文件，压缩估计 11,416,696 字节，展开 21,755,329 字节 |

最终命令回执位于 `work/task8-host-research/final-reviewed/verification-receipts.json`。随后重新执行独立 AstrBot ZIP 构建并核验，均退出 0；新文件在 `work/task8-host-research/artifacts-reviewed/astrbot-memory-continuity-management-0.1.0-dev.1.zip`，**9,826 字节**，SHA-256 `aa268fdc4d0d9ed9a81dabd40a91d7940205054cce8ceed045b1aa2dad5f22e9`。七个归档文件无重复，六个清单项与当前源码字节、大小和哈希一致，ZIP CRC 通过；回执为同目录 `verification.json`。审阅前的 ZIP 与失败日志继续保留，不覆盖。上述 Task7/8 未完成项和发布限制仍然有效。

## 0.3 预览发行检查点（2026-10-26）

- 新增核心 `init`，先失败回归再实现，新目录排他初始化、已有路径拒绝、真实子进程启动和退出均验证。
- 整分支审阅发现跨写受众来源撤回和 raw deletion marker 两条授权缺口；分别先复现再修复。保留合法依赖闭包及旧 v1 读取，不放宽 fail-closed。
- 外包 `index (1).html` 与原稿完全一致；工作台恢复分层注入清单、原文侧栏、成长对照、规则模块、续接携带范围，新增资料/日记页面优先正文。用量显示改为实际服务端字段。
- UI 修改后五项根检查全部退出 0；单次完整 365/365，192896.4173ms。实际 DSH 包 rc.2 与 rc.3 各 41/41，rc.3 另 12/12；独立核心实际包离线安装、冷读、故障恢复与初始化全部通过。AstrBot 实际 4.29.3 组件单次 Python 12/12，20.990s，loopback only。
- 源码独立安装与构建通过，来源/归档清单逐项核验。实际包浅深色浏览器交互有截图；人工审美认可、完整 rc.3 桌面 UI 与真实模型效果仍未验证。
- 三个分包独立交付，附完整源码、脱敏证据和发行回执。未来功能和本次已验证范围分别说明，不启用压缩、后台功能或付费 API。完整结果见预览报告；远端提交、附件与校验值由发布页的 RELEASE-RECEIPT.json 记录。

## 发布前追加：首轮加载与后续注入成本（2026-10-26）

用户反馈每轮记忆注入成本过高，明确要求首轮才使用 32K。实现首轮按需加载、后续可选 2048 当前计量单位，并通过原生单节点替换去掉旧的本插件 section；原日志、其他插件、工具结果和来源校验保留。新增 8 条实际宿主回归，审阅发现的当前 packet 证明、退休投影计量、原文覆盖三个缺口均先复现再修复。

第一轮完整检查 363/365、退出 1：旧日记断言与新策略冲突，另有一个依赖 URL 加载异常导致生命周期文件未进入测试。修正断言、诊断后定向 21/21，再单独全量 373/373，194250.1081ms；五项命令均退出 0。实际 TGZ rc.2/rc.3 各 56/56，rc.3 另 12/12；AstrBot 12/12、22.844s。独立核心和 523 文件干净源码均实际验证，不使用旧检查点替代。

三轮合成对话第三轮实际请求由 18211 字节减为 7997 字节，完整记忆包从 3 份变 1 份，不等同真实 token 或账单节省。更改详情、失败诊断、环境和未验证项见 [最终预览报告](../releases/0.3.0-preview.1/RESULTS.md)。本阶段暂停视觉调整，现有界面与外包原件保留。
