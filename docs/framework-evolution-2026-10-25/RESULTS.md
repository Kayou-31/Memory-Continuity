# 参考框架调查与下一轮设计记录

日期：2026-10-25。基线：Memory-Continuity 0.2.1，`1d997516a3cb0621163a94a2bb16b1a7bd28243c`。

当前已完成 Task1–4：人物原文解析与持久化、分类与条件选择、双方共同日记核心及 DSH 工具、显式 32,768 token 总记忆预算。本次另按用户提供的旧版审查，修复失效权限与旧命令复制，补充准入诊断和 CI。修补后的单次全量为 **327/327**；下文保留各阶段的原始失败和验收范围。

**仍未完成**：新资料/日记/预算的工作台页面、统一影响提醒及设置开关、独立 core 包与服务、AstrBot 插件和 NapCat/Snow Luma 验证。现有双主题工作台继续沿用用户提供的前端，没有被离线人物编辑器替换。当前仍是未发布开发分支，0.2.1 发行物未覆盖。方案见 [设计文档](../superpowers/specs/2026-10-25-person-capacity-multihost-design.md)，执行顺序见 [实施计划](../superpowers/plans/2026-10-25-person-capacity-multihost.md)。

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
