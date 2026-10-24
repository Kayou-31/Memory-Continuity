# RP narrator Memory（P3）

P3 提供手动采纳的 narrator Memory。RP 默认关闭；没有自动将 completion 当作采纳，没有原生历史压缩，没有 strict character POV。dev.2 的宿主目标是 `0.2.1-rc.2`、session format 4、本地合成 provider；dev.1 的 `0.2.0-rc.2` 验证证据另行保留。桌面 UI、真实模型和付费 provider 未运行。最终独立包、原生探针和历史回归的实际范围见对应发行报告。

## 启用条件

可信宿主调用 `installRpPlugin(ctx, config)`。`enabled` 默认 false；关闭时只保留惰性的旧 RP 会话发送阻断，不扫描目录、不捕获内容、不调用模型。启用须由宿主提供实际 profileRoot、workspaceRoot、明确的 contextWindow/inputLimit 与预算，并确认当前组合中的所有记忆写入者都参与共享策略。`knownCooperatingWriters:true` 是部署范围的明确声明，不能证明任意未接入第三方插件或私有 compactor 安全。

启用代码会核对实际依赖版本、原生 AgentRegistry/LlmRuntime/SystemPrompt 类、服务原型、命令/flush 接口和 session format；每次实际消费还重新认证 live agent、来源、完整历史、分支、修订、可见性、删除、全局来源、预算及持有的消费租约。配置布尔值不代替这些 live 门。

示例测试预算为 recentCompleteTurns=8、targetTotalTokens=48000、triggerTotalTokens=72000、outputReserveTokens=8192、toolReserveTokens=2048、packetSoftTokens=8000。**测试中的 100000 总窗口和 90000 输入上限只属于合成 fixture，不能复制为真实模型容量。** 容量未知或配置不适合动态输出预留时拒绝发送。

## 实际命令流程

所有命令经真实 `dsh-commands`。普通 user-role 消息、历史对白和模型工具均没有控制授权。命令不记录 rawInput；回执只包含简短状态或记录 ID，不复制正文。

1. 在新建、排空的 root 会话执行 `/memcont start`，创建剧情分支。已有工程 run、工程历史、归档恢复入口或 native compactor 的会话不能直接切换。
2. 用 `/memcont input 你的剧情输入` 明确采纳输入后驱动宿主。助手完成仅成为候选。用 `/memcont status` 查看可选候选来源 ID；执行 `/memcont accept <sourceId>` 选择该版本后继续下一轮。`rp_memory_status` 也是只读模型工具，不能执行选择。
3. `/memcont reject <sourceId>` 拒绝候选；`/memcont retcon {"targetEventIds":[...],"events":[...]}` 修改现有事件。新的提示不能抹掉原生旧历史；旧原文或旧 runtime snapshot 已失效时实际请求被拒绝。
4. `/memcont continue-clean [branchId]` 创建全新原生 root session，在原生 setup 中绑定选定的既有 RP 分支，不使用 resume/fork seed，不复制污染的宿主历史。命令返回 sessionId；用户通过宿主已有会话选择入口进入它。没有自动切换 UI tab 的承诺。
5. `/memcont fork` 固定当前分支前缀并返回新 branchId；再用 continue-clean 进入它。后续父分支消息不进入该子分支。
6. `/memcont delete {"sourceRevisionIds":["..."],"publicationDisposition":"retain"}` 明确选择保留独立批准发布；用 `"delete"` 选择同时删除已授权发布副本。多分支物理别名仍须 P2 所需的全部授权；当前简单命令不暗中获得其他分支权限。

最近窗口按可信持久 input 操作绑定及 accepted assistant 配对。普通控制命令不计轮；修订不重复计轮；拒绝版本不计轮。未完成的输入组在干净续接中保留，并可由新的明确输入继续该组。packet 中的原文窗口与结构化数据分开。

`/memcont status` 显示候选、pending input 和 ambiguous dispatch ID。输入先保存 intent，再提交采纳，再记录 dispatching，最后唤醒宿主。`/memcont resume-input <sourceId>` 对未 dispatch 的 intent 幂等完成采纳并发送一次。若进程在 dispatch marker 后中断，无法证明是否唤醒时状态为 ambiguous，禁止自动重发；应检查旧会话或显式创建干净续接。测试覆盖三个持久边界中断和独立冷进程恢复；这不是断电耐久性承诺。

## 独立全局控制

全局操作不需要先创建剧情 branch，也不需要手填随机 profileId：宿主从可信 profile 身份解析。以下都是命令平面的用户操作：

```text
/memcont global preference {"key":"language","body":"中文"}
/memcont global publish {"worldId":"world_demo","key":"rule","body":"选定并批准公开的设定"}
/memcont global list {"worldId":"world_demo"}
/memcont start
/memcont global adopt {"worldId":"world_demo","publicationId":"上一步返回的ID"}
```

profile 偏好只允许 language/person/dialogue_format/prose_style。world/character 发布可附 entityId；新 revision 必须显式 supersedes 当前发布。私有剧情 source 与 approved_publication source 独立，读取批准快照不会开放私有原文。分支只采用显式选中的 world revision；发布新版不会自动升级旧剧情。撤回 profile 最新偏好不会复活被其替代的旧偏好。

未提供 globalGrants 配置时，用户命令产生的明确授权可以持久保存。若显式提供 globalGrants（包括空数组），它是当前范围和受众的 allowlist；旧命令授权日志不能扩大或恢复已移除的配置授权。外部配置授权本身不写入命令授权日志。历史 snapshot 保存实际 publication/source/hash/scope，消费时重新授权；移除或缩窄 grant 会阻断旧 snapshot。

全局事务与分支 head 分开。全局读取核对独立 GlobalFence；prepared packet 在消费时要求精确 CAS。历史已发送的 snapshot 按其实际依赖重新认证；普通 append 和未 adopt 的新版 world canon 不自动使有效旧依赖失效。偏好替换、撤回、删除或权限缩小按实际适用性阻断。

## 检索、预算和工程共存

搜索先做范围、分支、修订、删除、受众与知识资格检查，再排序和计数。实体按 ID 过滤；同名不合并。可检索原文、有效事件、摘要和状态。search cursor 固定结果集合，body cursor 固定正文 revision/hash；插入不混入旧集合，撤回/删除/跨授权 cursor 拒绝。动态 verification 放在页外，不改变可拼接正文。cursor 不缓存第二份明文。

最终预算计入完整请求的 system、messages、所有原生历史 snapshot、工具 schema、toolHistory 和相关 metadata。当前计量是将完整 JSON 的 UTF-8 字节数按一字节一 token 加 framing 余量的保守压力估计，标为 estimated，不是账单或精确 tokenizer。动态 R=max(outputReserve, actual maxTokens)+toolReserve；检查 I≤Imax 且 I+R≤C。组装阶段先移除可选历史；八轮与当前输入仍超限则 context_budget_exceeded，provider 调用数不增加。

根 `dsh.session-memory-policy/v1` 与 evidence v2 协议跨 bundle 共用。RP 会话拒绝工程 begin/access/capture/context/pre-step/compactor；工程请求没有 RP 数据与 RP 工具 schema。RP-first 的旧 evidence 服务边界 reservation 会使不认识该协议的 v1 bundle 拒绝接入；兼容 bundle 可以接管并在释放后恢复边界。持久所有权 marker 和 root-owned 惰性恢复 veto 防止关闭/卸载 RP 后退回工程或继续发送旧 RP 历史。

当前 raw 剧情来源只支持纯 `text` blocks，以及已登记的 message ID、role 和 source metadata：user 的 `kind`，assistant 的 `kind/provider/model`。实际消息 hash 必须与可信观察一致。reasoning/thinking、image/audio、混合 text 与 tool-call、未知 rich blocks 或未认证 metadata 均 fail closed；没有将其删掉后继续发送的 full-filtering 能力。纯只读 `rp_memory_*` tool-call、tool result 与下一次原生请求走独立操作回执认证，不作为剧情自动采纳。此范围是本地 synthetic provider 证据，不保证真实模型的额外 metadata 可直接工作。

消费租约覆盖 downstream middleware 的 await 和整个 provider stream。所有由 openRpMemory 暴露的正文/分支/global 写入、迁移、删除及 grant 撤销共用 coordinator。等待中的变更尚未生效；其提交在线性化租约之后。approval 撤销只取消未来尚未提交的发布/采用，提交边界再次核验。它不等于撤回已发布正文。

## P4 接入约束与保留边界

P4 必须复用 `openRpMemory` 返回的 `store/control/global/coordinator`，不能另开 writer 绕过协调。`coordinator.mutate` 用于已知写入，`policy.request` 的释放函数必须在完整 stream finally 中调用；禁止持锁后再调用已经持锁的 writer，避免嵌套死锁。

当前 RP `llm/stream` 只放行经过本适配器组装和全历史认证的实际 AgentLoop 请求。未知 direct candidate/summary stream 没有 purpose 豁免。P4 新增模型任务时须建立可信 job→session/input fence/global fence 的专用绑定和最终 gate，给生成器的接口不得包含 store、HostAuthority、commands.execute 或批准权。P3 未运行真实模型抽取/摘要。

隐私删除承诺覆盖本插件已声明的可删 blob 和批准删除的独立 publication。tombstone 先落盘；物理清理失败可观察并按同 key 重试。宿主原始 JSONL、外部模型、备份及用户明确保留的发布副本不在物理删除承诺中。宿主残留违规原文通过 veto 阻断，不声称已从原生历史擦除。

strict POV/full filtering、自动采纳、原生持久替换和压缩仍关闭。真实 UI、真实 provider、付费模型、长期语义质量、外部未知写入者、跨进程请求独占和断电恢复未验证。独立 retcon 污染旧 raw 与独立 wrong-branch 污染旧 raw 的原生负例本阶段未执行，不能从大测试标题推导全部 A 项通过。

## dev.3 稳定性修复

本轮新增的关闭/诊断/干净续接、host journal v2、容量、检索证明和摘要失效规则见 [兼容与迁移说明](rp-memory-dev3/MIGRATION.md)，实际执行结果见 [RESULTS](rp-memory-dev3/RESULTS.md)。本文原有 dev.1/dev.2 历史证据仍保留其原验证范围。

## 长期 Agent 控制（2026-10-23 本地开发版）

新增 `/memcont agent <JSON>`（experience/state/relationship/goal），以及只读的 `/memcont goals`、`/memcont relationships`、`/memcont self`。这些显式命令会将用户控制原文写入来源账本，读取命令会显示当前事实正文；它们不注册为模型写工具。完整示例、前驱与来源约束、目标状态机和 continue-clean 流程见 [长期 Agent 记忆与成长](agent-memory.zh.md)。
