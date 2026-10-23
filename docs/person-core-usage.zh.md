# 人物创建与工作区升级

人物核心独立运行，Ultra Mode 是可选兼容插件。人物属于工作区、剧情和人生分支；同一原生会话选择一个主要人物。其他人物仍可作为同一世界中的对象存在。

## 创建人物

1. 在可信插件配置 `entityIds` 中登记人物和关系对象的 ID，例如 `erin`、`bea`。草稿不能自行增加可信实体。
2. 双击包内 `ui/person-editor/index.html`。编辑身份、背景、表达、价值观和边界，可以添加初始关系、目标及承诺。编辑器不连接网络或模型，不直接操作 profile。
3. 生成导入命令。进入 DSH 的新根会话，先运行 `/rp start`，再粘贴 `/rp person preview {…}`。确认预览里的人物、字段、关系、目标和升级提示。
4. 运行 `/rp person confirm person_preview_…`。人物起点和全部初始定义原子提交；关系和目标引用明确标注的“用户定义人物起点”，不冒充真实宿主行动。
5. 运行 `/rp person use erin`，然后 `/rp input 你好`。`/rp person show erin` 可查看当前人物。

编辑器导出的文件是初始定义模板，不携带授权、宿主消息或工具结果。导入后的最终权限检查由宿主完成。草稿上限 64 KiB，最多 128 个字段，每字段 2048 个 UTF-16 单元，最多 32 条初始关系、16 个目标，合计不超过 256 个初始化事件。初始目标为 active/0。

预览只在当前进程、原始授权和对应剧情版本中有效；修改剧情后需重新预览。原生入口根据规范化草稿形成稳定操作键，同一份草稿在确认回执丢失后可重新预览、确认，不重复生成人物。独立 API 调用方须保留自己的 operationKey。重复创建同一个分支中的人物会被拒绝。

原有身份、背景、表达或规则事件与人物字段有冲突时，导入明确列出冲突事件，用户可使用另一个已登记实体。插件不自动改写旧事件。人物建立后，普通 `/rp agent state` 和原始 commit 不能绕过人物字段规则。

## 会话与续接

`/rp person use` 只能在没有宿主消息的新根会话使用。有历史时先 `/rp continue-clean`，再在新会话切换人物。同一分支的干净续接保留已验证的主要人物；明确换到另一分支时，在新根重新选择人物。

Journal v2 新增可选人物绑定及每个历史 packet 的原始绑定证明。旧的非人物会话仍按原规则处理。人物历史缺失绑定证明时进入 recovery-only；不会用当前人物状态补造历史证明。干净续接不复制旧宿主消息和工具结果，不自动重发 ambiguous 输入。

## 首次启用前备份与旧版拒绝

第一次人物事务在发布前备份对应工作区，失败时不提交人物事务。备份位于：

`<profileRoot>/.dsh-rp/v1/backups/<workspaceId>/backup_…/`

完整备份含 `manifest.json`（文件列表、大小和 SHA-256、启用前 sequence/headHash）、`workspace/` 内的 bindings/commits/seals/blobs、`profile/identity.json`、项目 marker 和对应的插件 host journal。复制和回读核验在工作区 writer lock 下进行；host journal 若在复制期间变化则拒绝完成备份。没有 manifest 的残留目录是未完成备份，不可用作恢复依据。

人物事务保持 schemaVersion 1，但增加被事务哈希覆盖的 `requiredCapabilities: ["rp.person-core/v1"]`；后续事务保留这一要求。新 reader 可读取原 v1 数据，遇未知或倒退的能力要求会拒绝。实际基线 fdd9209 的旧 reader 会拒绝对应整个工作区，包含其他分支；不影响其他工作区和 global store。人物命令的 effectHash 包含能力要求和完整 batch。

回退时停止全部写入者，核验完整备份，先保留当前升级后内容，再恢复整个对应工作区及匹配的插件 journal 集合。保持原来的 profile/project 根目录及目录身份，不通过复制到另一个新根冒充旧授权。不要删除 capability 字段或裁剪事务来降级。恢复点之后的变更不会出现在恢复后的工作区中。

这份备份仅覆盖插件管理的数据及关联身份文件，不是整个 DSH 用户目录备份，不承诺恢复外部原生会话日志、模型服务或其他插件状态。原生会话历史不匹配时继续使用干净根会话。需要整机/宿主回退的用户还应自行备份宿主数据。插件不会自动执行破坏性恢复。

## 隐私和当前边界

删除来源会继续撤销依赖的人物字段、关系、目标、摘要和缓存；正文仍存于可删除 blob。用户导出的模板、启用前备份、外部宿主日志和已发给模型的内容是独立副本，不会因插件内删除而自动消失。

一个草稿/分支只使用一个 audience。当前原生宿主仍为 narrator 模式，不能将个人认知字段理解为完整历史的角色秘密隔离。后台自动摘要、自动采纳、原生压缩和 strict POV 保持关闭。

“完整的人”是用户可构建和持续塑造的产品目标，不表示插件或模型具有人的意识。离线回归与实际 SDK 终端捕获验证的是数据和调用路径；真实模型的长期人物一致性另需独立评估。

人物成长（M2）通过可信命令手动操作，模型工具保持只读。普通编辑不撤销前史，策略切换保持字段值；成长仅允许 growable 字段。`trait`（性格倾向）、`feeling`（当前感受）、`stage`（人生阶段）与原有五类字段共享同一协议。

- `/rp person show erin` 查看当前有效字段、关系和目标。
- `/rp person timeline erin` 查看字段链、理由、原因 ID、剧情时间、接受序号、当前/过期标记和该人物失效记录 ID。已失效正文不会重新载入；界面中的未设定不能由模型自动补写。
- `/rp person edit {"personId":"erin","fieldId":"name","previousEventId":"从 show 取得","value":"林川","note":"从今天起使用新名字"}`：明确修订今后的字段值，不 Retcon 过去。
- `/rp person set-policy {"personId":"erin","fieldId":"care","previousEventId":"当前字段事件 ID","policy":"stable","note":"保持这一点"}`：追加策略记录，旧成长候选过期。
- `/rp person propose {"changes":[{"changeId":"care1","personId":"erin","fieldId":"care","previousEventId":"当前字段事件 ID","value":"愿意托付","causeEventIds":["已接受的经历事件 ID"],"note":"一起救援后更信任同行者"}]}`：保存可删除的待审正文，不直接改变人物。
- `/rp person candidates` 列出候选完整内容、基准 fence 与 pending/stale/accepted/rejected 状态。
- `/rp person adopt {"candidateIds":["候选 ID"]}`：最多16条变化，从同一初始 fence 预演并一次原子提交；排序不取决于勾选顺序，任一冲突整批拒绝。
- `/rp person reject {"candidateId":"候选 ID"}`：记录拒绝；不采纳正文。拒绝记录是元数据，候选正文仍在可删除存储内，随关联来源的隐私清理删除。

同一提案可用 `previousEventId:null, previousChangeId:"同提案中的 changeId"` 明确串联变化；不允许环、未知前驱、偷偷更换字段、候选改变策略。原因必须是已接受的世界经历；人物初始化起点不能冒充后续真实经历。源数组只保留此次原因与此次控制，前驱沿 dependencyIds 追溯。

`policy:"situational"` 必须带 `validity:{"kind":"scene","sceneId":"rp_scene"}` 或 `validity:{"kind":"sequence","from":1,"through":20}`。有效区间两端均包含，接受序号是插件已接受来源的顺序（包含用户控制），不是消息轮数、电脑日期或年龄；可在 timeline/账本查看。过期后从当前人物和通用 state 投影移除，事件保留，不能回退到前驱值。编辑情境字段时可以明确给出新的 validity。普通关系/目标仍使用已有 `/rp agent` 显式操作和 `/rp relationships`、`/rp goals` 查询，方向与前驱不变；首期新增的成长候选队列专用于人物字段。

静态编辑器可创建情境字段、性格和阶段，生成新草稿；现有人物更新、成长审阅和时间线采用上述可信命令。实时在线页面、自动候选生成、自动采纳、自动推进年龄和后台摘要未开启。旧会话包含已失效检索结果或字段时，门禁可能要求 continue-clean。

## 用途与能力模块（M3）

用途 `rp`、`companion`、`creation`、`project` 共用人物与人生线。用途改变上下文中的模式信息，供以后添加自有功能分支；当前并不是四套完整产品，也不会自动创建 Git 分支或复制剧情。没有 Ultra Mode 仍可使用全部人物核心与三个内置模块。有已验证兼容版 Ultra 时，仅叠加 `ultra-rp/v1` 可选排序，不调用工程归档或压缩。

新会话默认 `rp`，所有模块默认关闭。可信用户命令示例：

```text
/rp start
/rp mode set companion
/rp modules list
/rp modules enable person-view
/rp modules enable recall
/rp modules run {"moduleId":"person-view","input":{"personId":"erin"}}
/rp modules run {"moduleId":"recall","input":{"query":"钟楼","limit":3}}
```

`person-view` 返回授权人物视图；`recall` 每次返回有界结果，完整分页仍使用现有 `rp_memory_search` 工具；`growth-review` 提交人工审阅候选。模块命令不会自动加入模型历史。不会加载用户输入的脚本，不授予真实工具执行、模型调用或正式写入能力。同进程 npm 插件仍属于可信宿主代码，这套接口不是操作系统沙箱。

```text
/rp modules enable growth-review
/rp modules run {"moduleId":"growth-review","input":{"changes":[{"changeId":"care1","personId":"erin","fieldId":"care","previousEventId":"当前字段事件ID","value":"愿意托付","causeEventIds":["已接受经历ID"],"note":"共同经历支持这次变化"}]}}
/rp person candidates
/rp person adopt {"candidateIds":["模块返回的候选ID"]}
```

最后一步仍需用户明确决定。模块输出有调用 ID、模块版本、原始 fence、实际记录 revision 和内容哈希；回执只证明核心读取或候选操作，不能证明某个外部行动真正执行。独立 API 的 `runtime.verify(result)` 只认证原返回对象；复制 JSON、修改内容、跨 runtime 或版本变化均拒绝。回执不是跨进程通行证。

## 双层约束

系统硬约束一直生效：权限和来源验证、请求总预算、固定能力白名单、不自动采纳、不后台执行、不授予外部执行权。用户规则可进一步收紧模块操作：

```text
/rp constraints set {"maxReadRecords":8,"maxOutputBytes":16384,"deniedCapabilities":["propose-growth"],"protectedFieldIds":["boundary"],"guidance":[{"id":"honesty","text":"保留不确定性，不把推测说成已经发生的事实"}]}
/rp constraints show
```

`set` 完整替换本会话用户约束，未给出的字段恢复默认值；因此检查返回的完整配置。模块权限限制只约束模块通道，用户的明确 person edit/adopt 控制仍遵守人物核心的原有权限规则。保护字段按 fieldId 匹配。

`maxReadRecords` 为单次模块检索上限 1–32（默认16）；`maxOutputBytes` 为实际返回值、认证回执和说明合计 UTF-8 字节上限 1024–32768（默认16384）。写候选前先检查，超限明确拒绝，不截断。用户行为指引最多16条、每条512个UTF-16单元；它们进入 mandatory context 并占用总请求预算，但自然语言遵守程度需要模型评测，不能作为权限或真实行动证明。

模式、启用模块和规则变更要求空 root，有历史时先 `/rp continue-clean`。`/rp modules disable recall` 可在请求进行时撤销后续准入并取消当前请求；有历史的原会话会被封锁，续接到干净会话后保留停用配置。已经输出的内容不会被撤回，取消遵循宿主适配器的响应行为。

M3 使用 journal v2 的可选 `runtimeBinding` 扩展，并在工作区 ownership marker 保存配置 hash 与撤销状态；branch/global v1 未变。旧会话不补造历史证明，启用 M3 需干净续接；旧版不能解释新增 journal 扩展时会拒绝。升级前保留 profile、项目 marker 和原生 session 数据备份；本次没有自动迁移生产目录。恢复-only 续接关闭所有模块并回到默认 RP，用户再显式配置。

撤销 marker 写入失败时会尝试保存 blocked journal；两条持久化路径任一成功，冷恢复会保持封锁。若二者都不能写入并异常退出，无法保证未落盘状态跨崩溃保留，会报告 `persistence_uncertain`；当前进程保持撤销。已开始的候选持久化也可能完成，但不会自动成为事实，用户可查看候选队列。无真实断电保证。
