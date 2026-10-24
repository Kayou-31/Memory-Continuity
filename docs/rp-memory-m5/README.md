# Memory-Continuity M5：人物连续性

本文说明已随 `0.2.0` 正式版交付的 M5 人物连续性能力。原名 Ultra-RP-Memory；插件包为 `@dsh-external/dsh-memory-continuity`，仓库为 [Kayou-31/Memory-Continuity](https://github.com/Kayou-31/Memory-Continuity)。分层模式直接使用独立 planner，既有全局记忆继续可用，无需 Ultra Mode。完整指令见 [中文速查](../COMMANDS.zh.md)；宿主内使用 `/memcont help`。实际发布验证与未覆盖项见 [正式版 RESULTS](../releases/0.2.0/RESULTS.md)。

## 启用和查看

沿用 README 的精确 SDK 配置、预算与可信写入者要求。新模式需要空白根会话和显式人物绑定：

```text
/memcont start
/memcont person use erin
/memcont injection set {}
/memcont injection show
/memcont injection preview 我想去钟楼，回忆与小贝的往事
/memcont person manage
```

`erin` 必须是已授权并创建的人物。创建流程仍是 `person preview <草稿>` → `person confirm <previewId>`。已有历史时先 `/memcont continue-clean`，在新宿主会话选择返回的新根，再设置配置。干净续接继承有效剧情分支、人物及注入配置，不复制旧宿主消息、不重发 ambiguous 输入。

关闭注入：空白且已绑定人物的根会话执行 `/memcont injection set null`。不在旧上下文上伪装“已清除”。旧模式保持可用；升级不会自动启用分层功能。

## 五类记忆、三级深度

- 自我核心：身份、价值观、边界、表达为强制字段；背景与性格可按主题选入。stable/growable 是变化规则，不等于每轮必须塞入。
- 当前处境：已授权且有效的感受和阶段；感受明确标注为感受记录。场景/序号过期后不可由 pin 复活。
- 关系背景：保留方向，按对象/内容命中；冲突和未解决张力不能被普通排除隐藏。
- 相关往事：已接受事件及已采纳摘要，以中文滑动双字和本地词项匹配；不虚构语义相似度。
- 未完成事项：当前进行中的目标/承诺，及按主题命中的已结束项目；保留状态与对象。

overview 提供标明节选的概览，association 提供记录内容，evidence 附带最多两个原始来源的有界节选。来源全文通过既有只读工具按授权读取。原始历史和摘要 anchors 均不截断或改写。

## 配置例子

```json
{
  "depth": "association",
  "budgets": {"self":2400,"situation":2400,"relationships":2400,"recollection":4800,"unfinished":2400},
  "pin": [],
  "exclude": [],
  "aliases": {"bea":["小贝"]},
  "rules": [
    {"layer":"recollection","when":{"terms":["钟楼"],"recall":true},"depth":"evidence"}
  ]
}
```

所有预算单位均为 **UTF-8 字节**，不是模型 tokenizer 的精确 token。各层可选项预算默认如上，单层最多 64 KiB；还有 packetSoftTokens（沿用原名称但仍保守估算）和完整请求上限。强制内容不会为满足可选预算而被删；完整请求超限就拒绝发送并提示干净续接。

条件支持 `modes/persons/branches/scenes/entities/terms/recall`。同一 rule 的不同字段全部满足，同一字段列表任一命中；同层多条 rule 为任一命中。设置某层 rules 后覆盖该层默认相关性条件，但不能覆盖权限、有效性、强制内容或排除。exclude 优先于普通 pin；排除强制核心/冲突会直接拒绝组装。实体别名只可指向宿主配置的已授权实体；不允许任意代码、正则或模型调用。

配置最多 32 KiB、32 条规则、64 个别名实体、每个 8 个别名、pin/exclude 各 256 个 ID。相关性使用前 128 个不同本地词项，超出时 `lexicalTermsTruncated=true`，预览提示缩短问题。不能把这套规则解释为真实模型的完整理解能力。

## 原因预览与历史边界

命令和工作台调用同一 planner。预览显示候选 ID/版本/内容 hash、选中与否、层/深度、命中/排除/预算原因、原查询/场景/用途/序号，以及人物连续性文本。实际发送时重新组装与检查，不复用预览当作授权票据。

预览把本轮选择与宿主仍携带的历史分开。旧快照通过原始 PacketProof、配置、来源权限与全局依赖校验；历史 trace 还必须匹配当时宿主正文嵌入的快照 ID 和人物文本 hash。话题变化本身不删除旧历史。删除/纠正/过期等使旧证明失效时，发送 fail-closed；可诊断后干净续接。

未知旧式状态、锁定 canon、冲突和完整证据门禁继续保守保留。因此 M5 不保证缩小整个历史请求；也不能保证模型必定不引用旧文本。

## 数据与更名兼容

branch/global store 的 v1 不变。host journal 仍为 v2，新增严格可选的 `injectionBinding` 与原始 `injection` trace。旧读取器遇到扩展必须拒绝，不补造旧历史证明。

首次在已有空白根启用前，将原 journal 原样 fsync 备份为 `.json.pre-m5-backup`；独立 `.injection.json` marker 防止删除配置字段后无声降级。备份不授权旧程序继续读取新的 M5 历史；如果回退软件，请保留新版资料并使用独立 profile/干净新会话。手动备份完整 profile 仍是跨版本升级的建议流程。备份属于受控留存副本，不承诺随隐私删除自动清除。

包名变为 `@dsh-external/dsh-memory-continuity`；配置节点和 `.dsh-rp` 路径保留；主命令使用 `/memcont`，旧 `/rp` 保留为兼容别名。按新的 cordis.patch.yml 替换入口，不能同时启用旧包和新包。GitHub 仓库已正式更名，旧地址保留自动跳转；见 [仓库迁移说明](../REPOSITORY-MIGRATION.zh.md)。更名不触发记忆数据迁移。

## 工作台与未开启的能力

正式版工作台已接入真实宿主，提供人物创建与编辑、经历、定向关系、目标/承诺、成长审阅和注入预览，支持浅色/深色/系统主题。每个写操作保持预览→确认；管理入口只监听回环地址，令牌只存页面内存。仅主题偏好保存在 localStorage。重新加载整页后需从宿主重新打开入口；关闭入口会撤销凭证并清空页面。

不做单会话压缩（用户已取消），不做后台自动摘要/反思、自动成长采纳、strict POV 或新 Ultra 兼容验收。管理与预览不调用模型；实际对话使用宿主配置的模型，费用取决于该服务。发布测试没有付费 API 调用。技能经验、更完整的用途界面和更深的长期检索仍是 [未来方向](../releases/0.2.0/RELEASE.zh.md#未来可能做的功能)。
