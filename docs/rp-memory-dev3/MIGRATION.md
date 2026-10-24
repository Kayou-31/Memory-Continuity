# dev.3 兼容、容量与恢复

## 当前仓库（2026-10-24）

当前产品和 GitHub 仓库为 **Memory-Continuity**：<https://github.com/Kayou-31/Memory-Continuity>。正式版包名为 `@dsh-external/dsh-memory-continuity`，主命令 `/memcont`，旧 `/rp` 兼容。旧仓库地址保留跳转，安装包与数据目录不因仓库更名而改动。详见 [仓库迁移说明](../REPOSITORY-MIGRATION.zh.md)。

## 0.2 预览版历史说明（2026-10-23）

当时项目和入口正式更名为 **Ultra-RP-Memory**，仓库为 `Kayou-31/dsh-ultra-rp-memory`，包为 `@dsh-external/dsh-ultra-rp-memory@0.2.0-dev.1`。下文按日期保留的“尚未发布”“本地未修复”等描述属于当时状态；本次发布审查及实际结果以 [RESULTS.md](RESULTS.md) 和 [发布审查报告](RELEASE-0.2-REVIEW-2026-10-23.md) 为准。

升级请先备份日常使用配置及全部相关数据；替换包名，保留 `rp-memory` 配置节点、`/rp` 命令、`.dsh-rp` 和 `.dsh-rp-policy` 数据目录，不同时激活新旧入口。人物工作区启用前备份且要求新版读取；全局分段存储需另行手动启用，默认布局不变。宿主日志继续 v2，无法认证的旧工具／记忆包历史只允许恢复和干净续接，不补造证明。具体备份与回退步骤见[人物工作室与存储说明](../person-studio-storage.zh.md)。本轮没有对日常使用数据执行迁移。

2026-10-22 本地命名调整：产品名 Ultra RP Memory，包入口由 `@dsh-external/dsh-rp-memory` 改为 `@dsh-external/dsh-ultra-rp-memory`。Ultra Mode 为可选适配对象，不是依赖；保留独立使用能力。安装新命名包时替换旧配置中的包名，保留 Cordis 节点 id `rp-memory`、`/rp` 命令、`rp_memory_*` 工具、`.dsh-rp` / `.dsh-rp-policy` 目录及原配置；不要同时激活两个入口。目录和协议没有因改名而迁移，真实用户 profile 的包替换尚未实测。已有发布包、GitHub 仓库 URL 和历史来源记录保持原名，新命名包尚未发布。

运行 peers 保持精确 DSH 0.2.1-rc.2、Cordis 4.0.5、Schemastery 3.18.5 / session format 4。新增的 loader 1.0.6、agent-loop/commands/session-projection/session-persistence-jsonl 开发依赖仅用于离线原生集成测试；没有新增运行时外部服务。branch/global 的 v1 目录、事务和幂等历史保留。sessionMemoryPolicy/v1 和唯一 coordinator 保留，根服务 rpSessionAdmission 使用进程内 owner 和实际 SDK options 身份，不能用 JSON 票据授权。

## 故障诊断和关闭

关闭同步撤销 owner 新请求资格，再取消 agent，独立结算队列、封锁每个绑定和清理资源。失败会聚合报告，不恢复准入。重复 close 返回同一 promise。封锁失败保留 retired binding 障碍。安装失败清理本次 reservation/lease/effects，长期根 guard 保留。

`/rp status` 和宿主 status 可诊断受损会话；状态只包含分支、生命周期、错误码和输入 ID。普通 input/adopt/send 等仍要求健康。`/rp continue-clean [branchId]` 重新独立授权并检查 branch fence，建立同分支干净 root；旧 root 保持 blocked。新 root 不复制旧消息、frame、工具回执；有效已接受输入只作为已处理账本绑定继承，禁止自动重发 dispatching/dispatched 输入。创建中途失败会撤销新绑定并清理句柄。用户仍需在宿主选择新会话，插件不声称已切换 UI。

损坏 journal 不提供可信 branchId 或输入。只能使用用户显式 branchId 且当前宿主能够独立授权的分支建立新 root；没有修补校验和或未经验证的批量迁移。

## host journal v2

新回执绑定实际 source/event/summary/state 的 ID、revision 和本次 Result 哈希；进程内 WeakMap 关联精确 Result 对象及 authority，SDK execution token 关联 caller/callId/generation/packet 和渲染内容。status/error 回执包含有限元数据、空 records 和哈希。错误回执只返回固定错误码，不持久化任意异常正文。

同会话 journal 使用统一保存尾部；receipt 在 coordinator 外结算并预留该尾部，锁内复核证明、生命周期和版本，在 rename 前再次复核。原生工具取消、agent 销毁、队列改变均不能用过期验证签发成功回执。后续请求重新检查检索 records 以及原有 packet/global 依赖。

恢复 v1 前先验证完整 schema/checksum/身份及 authority。明确没有 frames、receipts 或原生 tool/tool-call 历史的 v1，保存原字节 `.v1-backup` 后原子升级；备份冲突或写入失败仍拒绝。含无法认证工具历史的 v1 保持原文件，进入 recovery-only，只允许诊断/干净续接。不会用当前检索状态倒填旧证明。dev.2 不保证读取 v2；回退必须使用保留的 v1 备份或建立新的干净 root，禁止只改版本数字。

## 容量与全局事务

完整 JSON envelope 按 UTF-8 字节预检并写入同一编码。普通 publish 限 3,145,728 字节、3,072 个幂等键；控制操作限 4,194,304 字节、4,096 个键。新增 `capacity_exceeded` 表示本次增长拒绝，旧数据仍可读。v2 host journal 同样受完整 envelope 4 MiB 上限约束，超限后可诊断并干净续接。控制余量有限；不删除幂等历史、不截断事务链，也不承诺达到硬限后还能无限写控制操作。

全局 mutation 先构造 metadata 草案和待写 blob，通过完整可表示性/容量检查后才写 blob、commit、seal，再 purge。新事务前先补封上一个合法未封存头；失败不发布新 commit。发布前 I/O 故障是 `persistence_failed`；commit 已 rename、seal/purge 未完成是 `persistence_uncertain`。使用同幂等键、同完整输入重试可补封/完成 purge，不重复追加；改变 expected/body 等仍冲突。损坏链、错误 seal hash、多个未封存头继续拒绝。显式恢复 writer lock 不代表修复历史。

## 派生记忆及限制

中央 commit 的固定点闭包传播事件来源和摘要依赖，包括传递失效事件，保留原始来源和独立分支。新检索和 packet 仅使用有效摘要。摘要 anchors 按完整 span 元组先合并去重，再校验 256 上限；超限必须重建，不能静默截断。批量 retract 在原 ledger 上统一验证目标与后缀，显式目标优先。

检索每个组装视图前后检查完整 fence；跨页仍保留最初结果集合，无关追加不会混入新结果。权限、删除、canon 绑定和目标 revision 改变会拒绝旧结果。实现依然使用完整账本重放和磁盘读取。2026-10-22 本地重构仅在同一次已验证加载内复用历史前缀，并对分支最终事务 envelope 做 4 MiB 预检；不改变 v1 格式、不跨读取缓存、不修复已经损坏的历史。嵌套空分支微基准见 [审查报告](REVIEW-2026-10-22.md)，真实长剧情性能仍未验证。

后台自动摘要、strict POV、原生上下文压缩、自动采纳均关闭。真实模型语义质量、付费调用、桌面完整 UI、跨 SDK 迁移、长期运行和断电耐久性未验证。不能强制结束忽略 AbortSignal 的 provider，也不能撤回关闭前已经发送的网络数据。已发布 dev.3 最终 TGZ 的 RP+Memory、RP+Ultra+Memory、RP+Decision+Memory 两种加载顺序，以及两个新进程的恢复路径已补验，精确版本与边界见 [RESULTS](RESULTS.md) 的 Luna 与原生宿主补验节；不扩大为任意混装兼容或本次未打包源码的 TGZ 验收。

2026-10-22 审查另确认旧宿主 packet 的摘要依赖认证、失败全局发布的明文清理等遗留问题，当前本地 store 重构没有修复这些路径。详见 [审查报告](REVIEW-2026-10-22.md) A2–A8；新 packet 摘要有效性不代表宿主里所有旧 packet 已被完整认证。

## 2026-10-23 成长开发版的追加规则

host journal 仍为 v2，但 packet/tool-call frame 增加 `packetProof`（实际注入的事件/摘要 ID 与内容 revision，以及当时状态投影哈希）。新 reader 只验证当时捕获的证明，不用当前账本倒填旧记录。缺证明的旧 packet 历史进入 recovery-only；损坏证明拒绝恢复。使用 `/rp continue-clean [branchId]` 延续独立授权的有效剧情。旧 reader 对新字段会 fail-closed，不支持直接降级读取新 journal。

成长记录使用既有 v1 JSON payload 中的保留标记 `protocol:"agent-memory/v1"`，同一事务以已有 candidate_adoption 格式写入明确成长标记，只有经账本验证标记的事件才能启用新语义。旧普通 JSON 中的同名 protocol 字段不会被重新解释。前驱和原因经历使用既有依赖链；没有 branch/global 格式迁移、没有后台历史补写。正常成长保留前史，普通未标记的 `before` 元数据行为保持不变。旧逻辑不理解成长投影，还可能因新依赖拒绝记录；探针确认修复前 reader 对后继成长返回 source_unavailable。禁止新旧写入者混用，降级须恢复写入成长前的独立备份。

新包名、配置路径、独立 native peers 继续保持上一节规则。`ultraMemoryOptimization` 为 true 时，仅在兼容 evidence v2 服务实际存在且有有效 lease 时启用本包适配器；服务缺失自动独立运行。旧协议依旧拒绝。详细生命周期、命令和限制见 [Agent 记忆与成长](../agent-memory.zh.md)。这次未在用户日常 profile 上做迁移或安装。
