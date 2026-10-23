# Ultra RP Memory：长期 Agent 记忆与成长

本地开发版，2026-10-23。目标是让同一个 Agent 的经历、关系、身份、目标和承诺跨互动延续。当前实现是有来源、可解释、人工确认的成长账本。它不会让模型获得独立意识，也不提供后台自主生活、技能训练或自动行动。

## 独立运行与可选 Ultra

无需 Ultra 即可启用，仍使用 `/rp` 命令和三个 `rp_memory_*` 只读工具。模型可以根据原文和当前状态提出建议，只有用户的明确控制命令能采纳变化。

安装兼容 Ultra 0.6.1-dev.rp.1 / Memory 0.1.1-dev.rp.1 后，默认 `ultraMemoryOptimization:true` 允许本包的纯 RP 适配器启用。`/rp status` 的 `memoryOptimization.available` 和 `packet` 分别显示可用策略与本次 packet 的实际策略；没有兼容服务时为 `standalone`。设为 false 可关闭适配而保留 RP。

叠加范围是 RP 内的可选记忆排序、重复经历抑制、上下文余量约束以及双方共享会话准入协议。适配器只收到已授权的 RP 候选，返回的 ID 必须属于该集合；它不能添加工程日志、扩大权限、替换原文或提高预算。当前 Ultra 没有公开的 RP 纯算法复用接口，因此这里运行的是本包的 `ultra-rp/v1` 适配算法，**没有调用 Ultra 的原生归档或压缩实现**。Ultra 的工程捕获、工程工具与工程历史仍不进入 RP 会话。

## 经历与来源

先把 `erin`、`bea` 等实体 ID 加入可信配置的 `entityIds`，在干净 root 执行 `/rp start`。以下命令由用户执行；示例中的记录 ID 必须替换为实际输出。

```text
/rp agent {"kind":"experience","actorIds":["erin","bea"],"description":"艾琳在钟楼救下贝雅，两人共同保管一把钥匙。","fictionalTime":"第一年春天","sourceRevisionIds":[]}
```

返回 JSON 中的 `eventId` 是经历 ID。空 `sourceRevisionIds` 表示用户明确陈述这段经历，用户控制原文作为来源；如果从已有对白中整理经历，传入已经接受的来源 ID。尚未接受的回复、其他分支不可见的来源和未知实体会被拒绝。自然语言描述的真实性由用户确认，插件不会把文本匹配当作事实验证。

经历可以按中文词项检索。搜索记录先经过权限和一致性检查，再排序；摘录保持原文，`rp_memory_get` 可读取对应完整记录及来源。分页固定初始结果集合，不会因为无关追加而混入新条目。`rp-terms/v2` 是词法检索，不是向量检索或语义推理。

## 关系和身份如何成长

第一次关系记录使用 `previousEventId:null`；后续变化必须指定该关系的当前事件 ID，并给出已接受的经历作为原因。

```text
/rp agent {"kind":"relationship","fromId":"bea","toId":"erin","relation":"trust","value":"开始信任","previousEventId":null,"causeEventIds":["替换为经历ID"],"note":"救援后建立信任"}
```

关系支持 trust、affection、loyalty、rivalry、debt、promise、kinship、alliance、tension。数值没有预设心理含义：可以使用清晰描述或自定义 JSON 值，插件不把单一分数等同于人格。

身份、背景、说话风格等沿用既有状态键，示例：

```text
/rp agent {"kind":"state","entityId":"erin","key":"identity","value":"愿意承担责任的旅行者","previousEventId":null,"causeEventIds":["替换为经历ID"],"note":"这次救援后的自我认识"}
```

正常成长保留旧事件及其原始来源，只改变当前投影的有效前驱。过期前驱、冲突状态、无来源的变化均被拒绝；锁定 canon 必须经明确 Retcon 处理。`before` 字段本身仍不能自动消除普通状态冲突。

`/rp relationships` 查看当前关系，`/rp self` 查看 identity、voice、background。返回的 `supportEventIds` 可用于下一次变化的 `previousEventId`；保留旧经历可以解释变化过程。

## 长期目标和承诺

每个拥有者可以有多个独立目标，以 `goalId` 区分。任务用 `category:"task"`；对某人的承诺用 `category:"promise"` 并指定 `targetEntityId`。

```text
/rp agent {"kind":"goal","ownerId":"erin","goalId":"return_key","category":"promise","targetEntityId":"bea","objective":"归还贝雅的钥匙","status":"active","progress":0,"nextAction":"去钟楼找贝雅","previousEventId":null,"causeEventIds":["替换为经历ID"],"note":"明确作出的承诺"}
```

新目标必须从 active、0 开始。推进时提交完整目标字段，保持 objective 和对象不变，指定上一个事件 ID、原因经历和新进度。支持 active、paused、completed、abandoned；完成必须是 100，进度不能倒退，暂停期间不能推进。终止后应建立新的 goalId；想修正错误历史则用 Retcon。

`nextAction` 是下一步打算的记忆，不会执行行动或创建计划任务。`/rp goals` 返回当前目标、进度、来源和支持事件；目标始终属于上下文中的当前状态，相关旧经历在预算内补入。

## 持久化、修订与续接

成长包装使用 `agent-memory/v1`，保存在既有 state_change / relationship_change 的 JSON 值中，并由同一事务的显式 candidate_adoption 标记认证。没有标记的普通 JSON 即使含有同名 protocol 字段，也继续按旧语义读取。branch/global v1 和事务历史不截断。前驱与经历的依赖会写入已有 dependencyIds，Retcon、撤回或隐私删除会让依赖它们的后续成长失效，重新重放可回到最后仍有效的阶段。固定子分支保留自己继承时的前缀。

**已有原生消息的会话发生事实或目标变化后，旧 packet 可能失效。** 执行 `/rp continue-clean`，按宿主已有方式进入返回的新 root，再发送新输入；有效剧情和成长账本延续，旧宿主消息不复制。插件不会静默改写历史或自动重发 ambiguous 输入，也不自动切换 UI。

直接使用独立 npm API 时，可从包入口导入 `openRpMemory`，调用 `memory.agentMemory.apply(authority, actualUserControlSource, operation)`。authority 与控制来源必须由可信宿主提供。相同幂等键重试须保留完整原输入（包括 expected）；已发布但未 seal 的效果要先补齐 durable receipt 才返回成功。

## 已知边界

- packet 最多补入 8 条经历，经历与摘要共同消耗可选预算；必须保留的状态、规则与近期原文仍受最终完整请求上限保护，超限时明确拒绝。
- 检索每次仍读取验证账本和相关正文，没有跨请求持久搜索索引。没有无限生命周期、百万事件吞吐或峰值内存的实测证明。
- 成长只保存本次直接来源，祖先通过依赖边保留；既有单次来源数、JSON 深度、事务 envelope 和 journal 上限仍然有效。超限拒绝新增，不截断前史；当前不提供自动分卷或历史压缩。
- 原始记录不是语义真相判定器。真实模型能否稳定理解长期关系、执行目标和体现人格连续性尚未验证。
- 旧 reader 不具备新增成长投影语义，也可能因不认识前驱依赖而拒绝新记录。v1 格式不变不代表可安全降级；写入成长数据后不要使用旧版访问同一 profile，回退应使用写入前的独立备份。
- 后台摘要、自动采纳、strict POV、原生压缩、自主行动、付费 API 均未开启。
