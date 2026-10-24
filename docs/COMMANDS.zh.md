# Memory-Continuity 中文指令速查

适用开发预览：0.2.0-dev.3。插件包为 `@dsh-external/dsh-memory-continuity`，宿主命令继续使用 `/rp`；旧数据目录不改名。前端等待外包交付，本说明覆盖现有后端指令。

## 从哪里开始

```text
/rp help
/rp help person
/rp help injection
/rp help recovery
/rp help memory
/rp help modules
/rp help storage
```

帮助无需先 `/rp start`，故障会话也能查看；帮助不读写记忆，不调用模型，也不解除封锁。状态诊断用 `/rp status`。

## 建立人物并启用分层记忆

先确认宿主配置允许人物 ID `erin`，在独立测试 profile 和空白根会话执行。确认创建人物前备份 profile 与工作区；人物工作区需要新版读取。

```text
/rp start
/rp person preview {"schemaVersion":1,"kind":"person-draft","personId":"erin","fields":[{"fieldId":"name","kind":"identity","value":"林澈","policy":"stable"},{"fieldId":"background","kind":"background","value":"在钟楼旁长大","policy":"growable"}],"relationships":[],"goals":[]}
```

核对预览后，使用实际返回的 ID（不要照抄占位符）：

```text
/rp person confirm <previewId>
/rp person use erin
/rp injection set {}
/rp injection show
/rp injection preview 你记得钟楼吗
```

以上预览不调用模型。真正对话使用 `/rp input <文本>`，会调用宿主配置的模型；本轮测试使用离线终端，没有在线调用。

## 注入配置

```text
/rp injection set {"depth":"association","budgets":{"self":2400,"situation":2400,"relationships":2400,"recollection":4800,"unfinished":2400},"rules":[{"layer":"recollection","when":{"terms":["钟楼"],"recall":true},"depth":"evidence"}]}
/rp injection preview 回忆钟楼附近的往事
```

`set` 完整替换配置，省略字段恢复默认值。只允许已绑定人物的空白根会话修改；`set null` 关闭分层选择。已有历史时先 `/rp continue-clean`，再在宿主选择返回的新会话。

五层为 self/situation/relationships/recollection/unfinished；三级深度为 overview/association/evidence。预算单位是 UTF-8 字节。条件不能越过授权、有效性和强制核心；本轮未选中的内容仍可能留在旧会话里。配置字段与限制见 [M5 说明](rp-memory-m5/README.md)。

## 人物、成长、经历与目标

| 指令 | 用途 |
| --- | --- |
| `/rp person show [personId]` | 当前字段、方向关系、目标 |
| `/rp person timeline [personId]` | 已确认的变化与原因 |
| `/rp person edit <JSON>` | 人工修改，必须带 previousEventId 与 note |
| `/rp person set-policy <JSON>` | 修改成长策略，同样核对当前版本 |
| `/rp person propose <JSON>` | 提交有经历证据的成长建议 |
| `/rp person candidates` | 查看待审阅候选 |
| `/rp person adopt {"candidateIds":["实际候选ID"]}` | 人工批量采纳 |
| `/rp person reject {"candidateId":"实际候选ID"}` | 拒绝候选 |
| `/rp agent <JSON>` | 人工记录经历、关系、目标等 |
| `/rp goals`、`/rp relationships`、`/rp self` | 原有基础状态视图；完整人物优先用 person show |
| `/rp person manage`、`/rp person manage-close` | 手动开启/撤销本机参考工作台入口 |

字段和成长 JSON 示例见 [人物核心](person-core-usage.zh.md)；经历/关系/目标见 [Agent 长期记忆](agent-memory.zh.md)。

## 用途、模块和约束

```text
/rp mode show
/rp mode set companion
/rp modules list
/rp modules enable recall
/rp modules run {"moduleId":"recall","input":{"query":"钟楼","limit":4}}
/rp constraints show
/rp constraints set {"maxReadRecords":8,"maxOutputBytes":16384,"guidance":[{"id":"boundary","text":"尊重边界；推测必须说明不确定"}]}
```

用途支持 rp、companion、creation、project；内置能力为 person-view、recall、growth-review。仅人工执行，不是后台任务。constraints set 完整替换约束，省略字段恢复默认。约束 JSON 错误只返回参数错误，不更改原配置、不封锁健康会话；真正持久化故障仍会封锁。

已有历史时停用模块会封锁旧会话，需 continue-clean。人物规则是指导内容，不是模型必然遵守的保证，也不能修改系统硬约束。

## 全局记忆和存储

```text
/rp global preference {"key":"language","body":"优先使用中文"}
/rp global list {}
/rp global storage-status {}
```

世界发布需要明确 worldId 与授权；世界内容采用固定发布修订，不能把通用偏好当作剧情事实。存储升级按 [管理与存储升级](person-studio-storage.zh.md) 备份和核验，再显式执行 `/rp global storage-enable <作用域JSON>`。不要在不了解作用域时批量执行升级。

## 故障处理

1. 运行 `/rp status`，查看 blocked、lastError、pendingInputIds 和 ambiguousInputIds。
2. 保存结果不确定时先核对当前内容，不能盲目重复提交。普通参数错误可以纠正参数后重试。
3. 旧会话不能继续发送时运行 `/rp continue-clean [branchId]`，在宿主选择返回的新根；不会自动切换标签。
4. 有效剧情、人设和可认证配置按规则续接；旧宿主消息与工具结果不复制。无法认证的配置不会被偷偷继承。
5. ambiguous 输入不重发。`/rp resume-input <sourceId>` 只接受明确尚未派发的输入。
6. 损坏 journal 不是可信分支来源；如需显式 branchId，必须来自独立授权记录。损坏备份不会被覆盖或静默修复。

`/rp compact`、`/rp strict-pov`、`/rp summarize-auto` 保持拒绝。当前模型只读工具不具备自动写入、自动采纳或外部行动权限。
