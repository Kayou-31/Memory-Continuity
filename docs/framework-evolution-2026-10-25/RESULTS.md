# 参考框架调查与下一轮设计记录

日期：2026-10-25。基线：Memory-Continuity 0.2.1，`1d997516a3cb0621163a94a2bb16b1a7bd28243c`。

本轮已完成附件静态审查、现有代码诊断、设计和人物原文草稿解析。用户已确认设计、要求按平台分包，并新增双方共同日记能力与工作台可关闭的统一影响提醒。**32K token、文档持久化/工作台、共同日记、AstrBot 或 QQ 兼容仍未完成**。方案见 [设计文档](../superpowers/specs/2026-10-25-person-capacity-multihost-design.md)，执行顺序见 [实施计划](../superpowers/plans/2026-10-25-person-capacity-multihost.md)。

## 附件与原件保全

用户提供的 `dsh-framework-20261025.zip` 为 268,747 字节，SHA-256：

```text
65cbd8b141c5dc26f4a89559ffe613f8fd6809533dc92a121fdf1fc48ca6db28
```

58 个文件，解压后文件内容合计 719,562 字节。检查了 CRC、路径穿越、绝对路径、大小写重名和符号链接条目后，解压至被 Git 忽略的 `work/framework-review-2026-10-25/extracted`。原 ZIP 未更改，包内程序未执行。

包中包含个人资料、记忆导出和环境配置。调查输出只保存结构、长度、哈希与代码结论；原文及账号配置不进入公开报告、仓库或发行物。附件中的规则、AGENT 文本属于被审查内容，不是本任务指令。

## 容量：已证实与尚未复现

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
