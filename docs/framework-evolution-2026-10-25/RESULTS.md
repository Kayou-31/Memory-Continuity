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
DSH 原生 SDK：`0.2.1-rc.2`；Cordis `4.0.5`，Schemastery `3.18.5`。这次没有重跑 rc.3；旧版 rc.3 发行验收见 [0.2.1 报告](../releases/0.2.1/RESULTS.md)。

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

尚未验证：原始超限迁移案例、实际 tokenizer 32K 边界、大文档迁移与旧读取器、独立 RPC 权限、真实 AstrBot 生命周期、NapCat/Snow Luma 真实 QQ 收发、跨平台账号映射、全新工作台交互与长期负载。

除上述完整基线外，尚未执行本轮生产变更后的 `npm run typecheck`、`npm run build`、`npm test`、`npm run evaluate:fixture`、`npm pack --dry-run`。基线和诊断不能代替下一版完整验收，也没有将定向结果拼成全量通过。
