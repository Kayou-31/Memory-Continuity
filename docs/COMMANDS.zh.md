# Memory-Continuity 中文指令速查

> 适用本轮 **0.3.0-preview.1**。稳定版 0.2.1 不包含新的人物原文、共同日记与 32K 预算；请核对安装包版本。相关专题见 [人物资料](framework-evolution-2026-10-25/RESULTS.md)、[共同日记](shared-diary.zh.md)、[记忆预算](memory-budget.zh.md)。

兼容 DSH 0.2.1-rc.2 / rc.3。插件包为 `@dsh-external/dsh-memory-continuity`，宿主主命令为 `/memcont`（Memory + Continuity），旧 `/rp` 保留为兼容别名；旧数据目录不改名。人物工作台已接入真实后端；在会话内执行 /memcont person manage 打开，所有写入须先预览再明确确认。

## 工作台资料导入与提醒设置

以下功能包含在本轮预览包中，不属于稳定版 0.2.1。

执行 `/memcont person manage` 后，可在“完整人物资料”页选择 UTF-8 Markdown 或文本文件，单份最多 1 MiB。先解析，再核对章节分类、注入资格和适用范围，最后明确确认保存。原文保留 BOM 与换行；未分类章节不会被丢弃，默认只保存、不注入。修订原文后必须重新解析；章节编号随原文校验值变化，请重新核对分类与条件。

工作台上传后还会返回一条临时短指令。它使用上传时的默认分类，不包含网页中尚未保存的分类调整：

```text
/memcont document preview <uploadId>
/memcont document confirm <reviewId>
/memcont document discard <uploadId>
```

`uploadId` 与 `reviewId` 使用实际返回值，不能互换。上传草稿与当前管理入口、人物、人生线和版本绑定，有效期 10 分钟；过期或底层数据变化后重新上传，不会自动重试写入。`discard` 取消尚未导入的临时草稿，不会撤回已经保存的资料。

“共同日记”页支持建立日记本、人类写作、明确授权 AI 写作、读取与修订、查看历史、导出和隐私删除。授权 AI 写作不会开启后台任务，AI 仍需在当前已授权的对话中调用工具。删除是单独的必要确认，且不删除外部备份或宿主已经收到的内容。

“工作台设置”里的“修改前提示对后续对话的影响”默认开启，可切换为页内预览。关闭弹窗后仍须明确点击“确认写入”；权限、来源、版本校验和必要确认不受影响。偏好保存在当前本机 profile，AI 不能修改它。

“记忆预算”页显示实际计量方式，可预览并修改总额和五层上限；当前聊天人物绑定与注入配置也使用服务端预览。修改这些聊天配置需要空白根会话，已有历史时先干净续接。精确 tokenizer 与保守计量的区别见 [记忆预算](memory-budget.zh.md)。

## 从哪里开始

```text
/memcont help
/memcont help person
/memcont help injection
/memcont help recovery
/memcont help memory
/memcont help modules
/memcont help storage
```

帮助无需先 `/memcont start`，故障会话也能查看；帮助不读写记忆，不调用模型，也不解除封锁。状态诊断用 `/memcont status`。

## 建立人物并启用分层记忆

先确认宿主配置允许人物 ID `erin`，在独立测试 profile 和空白根会话执行。确认创建人物前备份 profile 与工作区；人物工作区需要新版读取。

```text
/memcont start
/memcont person preview {"schemaVersion":1,"kind":"person-draft","personId":"erin","fields":[{"fieldId":"name","kind":"identity","value":"林澈","policy":"stable"},{"fieldId":"background","kind":"background","value":"在钟楼旁长大","policy":"growable"}],"relationships":[],"goals":[]}
```

核对预览后，使用实际返回的 ID（不要照抄占位符）：

```text
/memcont person confirm <previewId>
/memcont person use erin
/memcont injection set {}
/memcont injection show
/memcont injection preview 你记得钟楼吗
```

以上预览不调用模型。真正对话使用 `/memcont input <文本>`，会调用宿主配置的模型；本轮测试使用离线终端，没有在线调用。

## 注入配置

```text
/memcont injection set {"depth":"association","budgets":{"self":2400,"situation":2400,"relationships":2400,"recollection":4800,"unfinished":2400},"rules":[{"layer":"recollection","when":{"terms":["钟楼"],"recall":true},"depth":"evidence"}]}
/memcont injection preview 回忆钟楼附近的往事
```

`set` 完整替换配置，省略字段恢复默认值。只允许已绑定人物的空白根会话修改；`set null` 关闭分层选择。已有历史时先 `/memcont continue-clean`，再在宿主选择返回的新会话。

五层为 self/situation/relationships/recollection/unfinished；三级深度为 overview/association/evidence。预算单位是 UTF-8 字节。条件不能越过授权、有效性和强制核心；本轮未选中的内容仍可能留在旧会话里。配置字段与限制见 [M5 说明](rp-memory-m5/README.md)。

0.3 预览新增首轮／后续策略：显式启用 `/memcont budget set {}` 后，首轮按需使用最高 32,768 token 的总额度，后续可选记忆最多 2,048 当前计量单位；必需身份与已有工具历史另计，总预算仍有效。`injection preview` 会显示阶段、可选额度以及旧包是否退出发送视图。旧包原件保留用于认证，普通对话与工具结果不删减。完整规则见 [记忆预算](memory-budget.zh.md)。

## 人物、成长、经历与目标

| 指令 | 用途 |
| --- | --- |
| `/memcont person show [personId]` | 当前字段、方向关系、目标 |
| `/memcont person timeline [personId]` | 已确认的变化与原因 |
| `/memcont person edit <JSON>` | 人工修改，必须带 previousEventId 与 note |
| `/memcont person set-policy <JSON>` | 修改成长策略，同样核对当前版本 |
| `/memcont person propose <JSON>` | 提交有经历证据的成长建议 |
| `/memcont person candidates` | 查看待审阅候选 |
| `/memcont person adopt {"candidateIds":["实际候选ID"]}` | 人工批量采纳 |
| `/memcont person reject {"candidateId":"实际候选ID"}` | 拒绝候选 |
| `/memcont agent <JSON>` | 人工记录经历、关系、目标等 |
| `/memcont goals`、`/memcont relationships`、`/memcont self` | 原有基础状态视图；完整人物优先用 person show |
| `/memcont person manage`、`/memcont person manage-close` | 手动开启/撤销本机工作台入口 |

字段和成长 JSON 示例见 [人物核心](person-core-usage.zh.md)；经历/关系/目标见 [Agent 长期记忆](agent-memory.zh.md)。

## 用途、模块和约束

```text
/memcont mode show
/memcont mode set companion
/memcont modules list
/memcont modules enable recall
/memcont modules run {"moduleId":"recall","input":{"query":"钟楼","limit":4}}
/memcont constraints show
/memcont constraints set {"maxReadRecords":8,"maxOutputBytes":16384,"guidance":[{"id":"boundary","text":"尊重边界；推测必须说明不确定"}]}
```

用途支持 rp、companion、creation、project；内置能力为 person-view、recall、growth-review。仅人工执行，不是后台任务。constraints set 完整替换约束，省略字段恢复默认。约束 JSON 错误只返回参数错误，不更改原配置、不封锁健康会话；真正持久化故障仍会封锁。

已有历史时停用模块会封锁旧会话，需 continue-clean。人物规则是指导内容，不是模型必然遵守的保证，也不能修改系统硬约束。

## 全局记忆和存储

```text
/memcont global preference {"key":"language","body":"优先使用中文"}
/memcont global list {}
/memcont global storage-status {}
```

世界发布需要明确 worldId 与授权；世界内容采用固定发布修订，不能把通用偏好当作剧情事实。存储升级按 [管理与存储升级](person-studio-storage.zh.md) 备份和核验，再显式执行 `/memcont global storage-enable <作用域JSON>`。不要在不了解作用域时批量执行升级。

## 故障处理

1. 运行 `/memcont status`，查看 blocked、lastError、pendingInputIds 和 ambiguousInputIds。
2. 保存结果不确定时先核对当前内容，不能盲目重复提交。普通参数错误可以纠正参数后重试。
3. 旧会话不能继续发送时运行 `/memcont continue-clean [branchId]`，在宿主选择返回的新根；不会自动切换标签。
4. 有效剧情、人设和可认证配置按规则续接；旧宿主消息与工具结果不复制。无法认证的配置不会被偷偷继承。
5. ambiguous 输入不重发。`/memcont resume-input <sourceId>` 只接受明确尚未派发的输入。
6. 损坏 journal 不是可信分支来源；如需显式 branchId，必须来自独立授权记录。损坏备份不会被覆盖或静默修复。

开发分支的 `/memcont status` 还将两件事分开展示：`bindingHealth` 表示会话绑定健康程度，`requestAdmission` 表示最近一次请求在组装/发送阶段是否获准，以及错误码和原因。绑定为 healthy 但请求为 rejected 是可能的；请按 `recovery.action/detail` 处理，不要只看 blocked。下游服务报错不会被改写成记忆准入拒绝。

同一宿主中销毁后重建会话，历史认证中的 `modeEpoch` 可能已失效，需要 `continue-clean`；这项限制保留。若 provider/model 已改变，新会话还要重新 `/memcont budget set {}`。普通预算不足先检查输出预留和已保留的工具历史，不要靠删除 journal 绕过检查。

`/memcont compact`、`/memcont strict-pov`、`/memcont summarize-auto` 保持拒绝。普通检索工具只读；共同日记的专用写入工具仅在明确启用后、当前有效会话内可用，不授予人物编辑、事实采纳或其他外部行动权限。

### 开发版：跨宿主占用诊断

新版 DSH 插件与独立核心会拒绝同时写同一 profile。正常切换前关闭旧实例；异常退出后使用独立核心包中的本机指令：

```text
memcont-core owner inspect --profile <profile绝对路径>
memcont-core owner recover --profile <profile绝对路径> --expected <诊断中的sha256>
```

先确认路径与进程，再复制该次诊断的摘要。恢复只接受已确认死亡的旧进程；记录已变更、进程仍活着、无法确认或记录损坏都会拒绝。不要自行删除锁文件。事务写锁仍由原有事务恢复流程处理；占用恢复不等于会话恢复，旧会话仍可能需要 `continue-clean`，结果不明的输入不会自动重发。旧版程序没有这项占用协议，升级前仍需明确停止旧实例。

### 开发版：独立管理与检索服务

```text
memcont-core serve --config <配置绝对路径> --connection <新连接文件绝对路径>
```

这是独立核心包中的前台命令，不是 DSH 聊天指令。需要管理员提供已经建立的工作区、分支和权限配置；详细字段见独立核心包随附的 README。首次使用先运行 `memcont-core init --directory <新的绝对目录> --entity <人物ID>`，用生成的配置启动；已有目录不会被覆盖。

服务只监听本机。管理凭据写入指定的新连接文件，普通输出不显示；请使用账户专用目录，勿上传该文件。输入 `quit` 正常退出后删除本次连接文件并释放 profile。崩溃后先检查所有权，显式恢复后使用新连接文件；旧管理凭据、只读工具令牌和临时预览都不会继续生效。

已完成修改的持久确认回执可以在新管理会话中查询，同一确认不会重复修改。结果不明时保留 `persistence_uncertain`，先核对当前人物和历史，不自动重放。该服务尚未接入模型发送或 AstrBot 请求准入，不能用它代替 `/memcont status` 判断 DSH 会话能否发送，也没有开启后台功能。

### 开发版：AstrBot 管理桥

AstrBot 4.29.3 的独立 ZIP 目前只提供管理入口。默认关闭，在插件设置中启用并填写本机核心的连接文件后，使用管理员私聊：

| 指令 | 用途 |
| --- | --- |
| `/memcont connect` | 明确连接已启动的本机核心；不创建人物、不导入聊天 |
| `/memcont status` | 查看核心连接与可用绑定；模型注入仍显示未开放 |
| `/memcont open <绑定ID>` | 获得短期工作台地址，只能在运行核心的电脑打开，请勿转发 |
| `/memcont close` | 断开本桥并尝试撤销所开的临时会话，不退出核心进程 |

连接文件缺失、变化或传输失败后，恢复文件不会复活旧客户端。检查服务状态后重新发送 `connect`；不自动重连或重发。群聊和非管理员请求会被拒绝。这些同名命令属于 AstrBot 适配包，不是 DSH 命令的替代，也不代表 AstrBot 已获得人物注入或 AI 日记写入能力。
