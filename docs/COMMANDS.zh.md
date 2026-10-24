# Memory-Continuity 中文指令速查

适用正式版：0.2.1，兼容 DSH 0.2.1-rc.2 / rc.3，指令与 0.2.0 保持一致。插件包为 `@dsh-external/dsh-memory-continuity`，宿主主命令为 `/memcont`（Memory + Continuity），旧 `/rp` 保留为兼容别名；旧数据目录不改名。人物工作台已接入真实后端；在会话内执行 /memcont person manage 打开，所有写入须先预览再明确确认。

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

`/memcont compact`、`/memcont strict-pov`、`/memcont summarize-auto` 保持拒绝。当前模型只读工具不具备自动写入、自动采纳或外部行动权限。
