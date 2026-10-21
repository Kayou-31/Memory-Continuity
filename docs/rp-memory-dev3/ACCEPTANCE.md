# dev.3 验收矩阵

**当前状态：全部待实现、待执行。** 本文是验收规格，不是测试报告。每个编号表示一组行为要求，不要求一项对应一个独立测试进程；同类用例应复用 fixture 并串行执行。

运行时发布门槛为 R01—R35、R37—R39。R36 随评测改进任务单独验收。R40 在发行说明声明相应宿主/companion 兼容时为必须通过，否则明确标为未验证并收窄声明。

## A. 关闭、归属与恢复

| ID | 设置/触发 | 必须观察到的结果 | 文件/任务 |
|---|---|---|---|
| R01 | 已激活 RP；注入 host journal rename EIO 导致 queue/saveQueue 失败；调用 close 后对旧 session 再请求 llm | 根 guard 拒绝；合成 terminal 计数不增加；其他绑定仍尝试 block；关闭错误可诊断 | rp-host-lifecycle / T1 |
| R02 | 活动流在确定性 latch 暂停；调用 close，再发请求，最后让流结束 | 新准入立即撤销；旧流取消/结束后释放 lease；无持锁等待 whenIdle 的死锁；没有 late receipt/packet 发布 | rp-host-lifecycle / T1 |
| R03 | 并发/重复 close；一个 dispose 失败；另一个 session 正常 | close 使用同一结果；每个清理项独立尝试；失败不恢复 owner，也不漏掉其他会话封锁 | rp-host-lifecycle / T1 |
| R04 | admission 中两个 RP owner；工程 policy 先加载/后加载；旧 owner 关闭时尝试同 session 重新绑定；重复插件安装 | 无第二个 coordinator；owner 不互相污染；旧封锁完成前不能重绑；宿主不支持重复工具注册时第二实例明确拒绝且不破坏第一实例 | rp-host-lifecycle / T1 |
| R05 | 只设置 mode RP、伪造普通 JSON ticket、停用 owner、遗留磁盘 marker，分别调用 llm；同时测试真正认证的请求 | 前四种拒绝；只有真实 options 身份 + 活 owner + 当前 stamp 的请求进入 terminal；disabled 不扫描/建库 | rp-host-lifecycle / T1 |
| R06 | 队列拒绝后调用 `/rp status`、宿主 status、普通 input/adopt/send | status 给结构化诊断与输入 ID；业务路径仍拒绝；诊断不泄漏正文 | rp-host-lifecycle / T2 |
| R07 | 可独立验证的 branch，旧 session 已 blocked，执行 continue-clean | 新 root 的消息/工具历史为空；仍能从同 branch 读取有效剧情和已采纳记忆；旧 root 继续拒绝 | rp-host-lifecycle / T2 |
| R08 | 新 root 创建过程改变 fence/权限或注入创建/保存失败 | 新句柄清理、没有可发送的半绑定 agent；旧会话保持 blocked；不是部分成功 | rp-host-lifecycle / T2 |
| R09 | observed/accepted/dispatching/dispatched 输入混合；另测损坏 journal | 恢复不自动重发；ambiguous IDs 可见；损坏 journal 的 branchId 不被信任；明确 branchId 也需独立授权 | rp-host-lifecycle / T2 |

## B. 剧情与摘要

| ID | 设置/触发 | 必须观察到的结果 | 文件/任务 |
|---|---|---|---|
| R10 | 原文支持蓝钥匙事件；source-only scene → chapter → arc；retcon 为金钥匙 | 所有受影响旧摘要 inactive；新 packet/history 不再把这些摘要当作有效摘要注入，投影为金钥匙；原始 source 仍可作为历史证据按权限读取，不能用整包禁止出现“蓝”字作为断言 | rp-summary / T3 |
| R11 | 先采纳 source-only summary，再采纳关联事件，最后改写事件 | 旧摘要照样失效；不依赖创建摘要时已有 supportEventIds | rp-summary / T3 |
| R12 | 同时有无关来源摘要、父分支和兄弟分支 | 只改变目标分支相关派生视图；无关摘要、原始来源与其他分支不被清空 | rp-summary + rp-branch / T3 |
| R13 | 分别使用 supersedes/correction/invalidatedIds；相同操作重试；关闭重开 store | 各提交入口都触发同一闭包；幂等不重复提交；重开后失效保留；新 fence 的合法重建可采纳 | rp-summary / T3 |

## C. 检索一致性与回执

| ID | 设置/触发 | 必须观察到的结果 | 文件/任务 |
|---|---|---|---|
| R14 | 在 acceptedSources/events/summaries/projection/正文的两次读取之间插入删除或 retcon | 成功响应不能是混合视图；snapshot_changed 或既有授权/不可用拒绝；不得返回已撤销旧正文 | rp-retrieval / T4a |
| R15 | 首次 ranking 期间以及 get 的 verification 回调期间发生写入 | 初始结果和分段输出也经过一致性检查；不能仅修续页 validate；失败不发新可用 cursor | rp-retrieval / T4a |
| R16 | 初始匹配 23 条，page=7，中间追加一条无关/新匹配项 | 固定分页仍是原来的 23 条，唯一且无重排/混入新项；不因任意 contextRevision 变化一律失败 | rp-retrieval / T4a |
| R17 | 固定 cursor 跨 authority、branch、canon binding；目标删除/修订；中文代理对分段 | 未授权/过期拒绝；合法分段拼接 hash 一致；UTF-16 边界正确 | rp-retrieval / T4a |
| R18 | 工具返回后、生成 receipt 前插入删除/retcon，或替换 SDK rendered content | 不得按新 fence 为旧正文签发成功 receipt；新的合法工具结果有实际 records refs | rp-host-receipts / T4b |
| R19 | 同 callId 不同 agent/owner，过期 generation，复制公开 proof JSON，复用旧 Result | 不能冒用 proof；仅该次可信 Result 与执行身份可生成回执；取消/错误/close 清掉 pending 项 | rp-host-receipts / T4b |
| R20 | 把 summary/state 的工具结果保存进原生历史，再令该记录失效；另测无关 append | 前者下一次发送在 terminal 前拒绝；后者实际 refs 未变可继续；同时保持原有全局依赖门禁 | rp-host-receipts / T4b |
| R21 | v1 无工具历史、有工具历史、frames 有而 receipts 缺失、损坏 v1、合法/损坏 v2、升级写入故障 | 只有可证明无工具历史的 v1 可原子升级；不明历史 recovery-only；不回填 proof；失败保留 v1 原字节备份/原件；新 root 使用 v2 | rp-host-receipts / T4b |

## D. 全局容量与故障恢复

| ID | 设置/触发 | 必须观察到的结果 | 文件/任务 |
|---|---|---|---|
| R22 | 构造合法累计状态，令下一完整 envelope 刚到/刚超过硬限；另检查 state 未超但 envelope 超限 | 合法边界可读；超限 mutation 返回 capacity_exceeded，旧 readFence/数据/冷重开成功；不会写入不可读文件 | rp-global-recovery / T5 |
| R23 | 大量中文/emoji、最大长度 privateSourceIds；分别耗尽字节与 key count | 使用 UTF-8 完整 envelope 字节；两种限制都生效；不依赖 JS length 或单条正文大小 | rp-global-recovery / T5 |
| R24 | 新 publish 到达 3 MiB/3072 软限；再 revoke/privateDeletion；再触及硬限；另测旧合法近硬限 | 软限拒绝增长，控制操作在硬限内仍可用；硬限明确拒绝而原数据可读；不宣称无限控制容量 | rp-global-recovery / T5 |
| R25 | 容量拒绝、无效 approval、相同 key 重试、多 grants 中无匹配 publication 的合法 privateDeletion | 拒绝不产生新 blob/commit/key；已提交同 key 重试不再消耗空间；合法 no-op 不变成 invalid_record | rp-global-recovery / T5 |
| R26 | 第一笔 commit 后 seal rename 失败；第二次用新 key 再遇 seal 失败 | 第二次先补旧 seal，失败时不新增 commit；最多一个未封存头；下一次可恢复 | rp-global-recovery / T6 |
| R27 | 用同 key+同完整输入重试，再用相同 key 改 body/expected 等 | 前者返回原结果并补 seal/purge，无重复 commit；后者 idempotency_conflict | rp-global-recovery / T6 |
| R28 | 分别在 blob、commit rename 前、commit rename 后、seal、purge 注入 I/O 故障 | 错误符合实际阶段；commit 已发布后为 persistence_uncertain；未 seal 的 tombstone 不触发物理 purge | rp-global-recovery / T6 |
| R29 | 缺旧 commit、错误 hash、两个未封存头、显式恢复 write.lock | 损坏仍拒绝；不通过截断/伪造 seal 自动修好；恢复锁不等于修复事务链 | rp-global-recovery / T6 |

## E. 候选与批量 API

| ID | 设置/触发 | 必须观察到的结果 | 文件/任务 |
|---|---|---|---|
| R30 | 两个合法 scene 各有 129 个互不重复 anchors，合成 chapter | propose 即 invalid_candidate，无新 candidate blob/meta；不是保存后 get/adopt 才失败 | rp-summary / T7 |
| R31 | 重复 span 去重后正好 256；正好 257；不同 source/offset/hash 但 quote 文本相同 | 完整元组去重；256 可提议/读取/采纳；257 拒绝；不同 span 不被误合并 | rp-summary / T7 |
| R32 | 中文/emoji 边界、失效 hash、被删除来源和历史超限候选 | 继续严格 span 校验；旧非法候选明确拒绝并允许按既有授权丢弃/重建，不静默截断 | rp-summary / T7 |
| R33 | 两个相同初始 ledger 分别 retract [A,B] 和 [B,A] | 显式 A/B 都 retracted；其余相关 host_public 后缀 pending_replay；最终 disposition 一致 | rp-branch / T8 |
| R34 | 合法目标混入非法目标；后缀夹有 user_control；重复目标 | 非法批次整批不提交；control 不误当剧情后缀；重复目标遵守明确 schema 规则 | rp-branch / T8 |
| R35 | retract 同 key/同完整输入重试，随后重开 | 只提交一次、状态稳定；不把不同排列同 key 自动当等效操作 | rp-branch / T8 |

## F. 评测与交付边界

| ID | 设置/触发 | 必须观察到的结果 | 文件/任务 |
|---|---|---|---|
| R36 | 蓝眼睛事实引用灰外套原句；正确原句；跨源/空/错引用 | 错证据扣分，正确证据通过；每条 fact 对应允许支持 quote；报告标 v2 fixture，未声称真实模型测评 | rp-evaluation / T9，可延期 |
| R37 | 带 retrieval refs 的 v2 host journal 逼近完整 JSON 上限，或迁移备份/原子发布失败 | 先预检再写；失败不覆盖原可读 journal；会话 blocked 但 status / continue-clean 可用；不接受部分 proof | rp-host-receipts / T4b |
| R38 | disabled；开启 compact/strict POV；模型工具伪造写入/approval；旧来源/分支越权 | 默认不捕获、不建库；未支持能力仍拒绝；读工具不能采纳/发布/扩大授权；现有隔离回归保留 | 相关回归 + package / T10 |
| R39 | 串行 typecheck、build、全量 test、fixture、pack dry-run | 每项有版本、命令与退出码；A22 有明确结果；manifest 对应最终源码；未运行不写通过 | RESULTS / T10 |
| R40 | 若声明工程 companion 混装/特定宿主支持：最终 TGZ、精确 SDK、独立 profile，两种加载顺序 | 真实最终包启用/禁用/关闭/恢复与准入测试通过；否则声明该组合未验证，不能以源码 mock 冒充 | 宿主 acceptance / T10，按声明触发 |

## 实施者填写结果时的模板

```text
验收编号：
提交 SHA：
Node / npm / SDK / OS / 文件系统：
运行命令：
实际退出码：
结果：通过 / 失败 / 未运行
关键断言或失败阶段：
日志位置：
仍未验证的范围：
```

不要填写“测试预计通过”。预期行为留在本矩阵，实际证据单独写 RESULTS.md。
