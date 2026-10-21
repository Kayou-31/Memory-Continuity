# RP Memory dev.3 设计规格

**状态：** 待实现；供 Codex 按约束执行。基线为 `4272dd98ed40afb0b3bb162014c97da0fd49e242`。本文件的新类型、阈值、文件和测试均为方案要求，不是当前已经存在的能力。

## 1. 目标与范围

dev.3 解决三类问题：会话出现失败时仍能关闭和恢复；剧情改写后所有派生内容同步失效；全局写入不会把可读数据推进到不可读状态。保持人工 narrator、来源可追溯、显式全局发布、固定分支和只读模型工具。

自动摘要、原生 compaction、严格 POV、向量库、数据库迁移、自动修复损坏事务链均不在本轮范围内。`contextCompression: true` / `strictPov: true` 仍须明确拒绝。不得为了通过测试降级这些能力门禁。

## 2. 必须维持的约束

| ID | 约束 |
|---|---|
| I1 | RP 请求必须同时具有正确会话归属、存活 owner 和本次请求认证。`mode === rp` 不是发送许可。 |
| I2 | 开始关闭时同步撤销 owner 的新请求准入；异步清理失败不会重新开放会话。 |
| I3 | 状态查询和受限恢复不依赖失败队列重新成功；恢复不能自动重发 dispatching/dispatched 输入。 |
| I4 | 被改写事件的旧派生摘要不能继续注入；原始证据不因保守失效而被伪造、改写或无故删除。 |
| I5 | 一次检索响应属于一个稳定授权视图；持久回执绑定实际返回记录的 revision 和实际内容哈希。 |
| I6 | 全局 commit 的完整字节串在任何 blob/commit 写入前通过与读取器一致的可表示性和容量校验。 |
| I7 | 追加新全局 commit 之前先封存当前合法头；幂等重试不会重复追加事务。 |
| I8 | 候选一旦保存为合法 pending，随后读取不应因为保存时漏检的合并锚点数量而失败。 |
| I9 | 批量控制基于同一原状态验证，结果不随显式目标排列改变。 |
| I10 | 无关追加可以保留固定检索分页；授权、删除、目标记录修订和 canon 绑定变化必须使相关旧结果失效。 |

## 3. 会话归属与请求门禁

### 3.1 在现有策略上增设根级 RP admission

保留 `sessionMemoryPolicy` 的 `dsh.session-memory-policy/v1` 协议和唯一 coordinator，避免破坏已经加载的工程插件。新增根级服务 `rpSessionAdmission`，协议 `dsh.rp-admission/v1`；不得新建第二个 coordinator，不得静默替换已有 policy。已有 admission 若协议不兼容，安装在获得会话归属前失败。

建议文件：`src/rp/admission.ts`。它是进程内可信宿主对象，opaque owner/ticket 不接受 JSON 反序列化，也不向模型暴露。建议接口轮廓：

```ts
type RpOwner = object;
type BindingStamp = Readonly<{ epoch: number; generation: number; active: boolean }>;

interface RpAdmission {
  readonly protocol: 'dsh.rp-admission/v1';
  createOwner(): RpOwner;
  bind(owner: RpOwner, sessionId: string, liveStamp: () => BindingStamp): void;
  retire(owner: RpOwner): void; // 同步、幂等；从此不能签发或使用新请求许可
  retireBinding(owner: RpOwner, sessionId: string): void; // 单个 agent 销毁不撤销其他会话
  issue(owner: RpOwner, sessionId: string, options: object,
        stamp: BindingStamp): () => void; // 返回撤销本次许可的清理函数
  permits(sessionId: string, options: object): boolean;
  release(owner: RpOwner, sessionId: string): void;
}
```

`permits` 必须重新核对 owner 存活、绑定身份和当前 stamp，不能只查曾经签发过 ticket。ticket 用 `WeakMap` 绑定实际进入 `llm/stream` 的 options 对象。不要修改被冻结的 SDK options，不要靠一个可伪造的 options 布尔值开后门。精确 SDK 集成测试必须验证中间件链保留对象身份；若实际不保留，应使用已验证的宿主调用身份机制，不能退化成信任序列化标记。

根 guard 留在 root，生命周期长于插件 lease。持久 RP ownership marker 只表示“不能按工程会话直接发送”，不表示授权。在有 marker、policy RP/blocked 或 admission 绑定的会话上，guard 要求 policy 为 RP 且本次 ticket 有效。普通工程会话继续走既有工程规则。

owner 插件的前置 hook 负责认证再签发 ticket；其他 RP 实例没有绑定此会话时应委托后续 hook，由根 guard 作最终判断，不能先把另一个合法实例拒绝。根 guard 一次安装；disabled 路径可安装惰性拒绝门禁，但不扫描 profile、不建库、不捕获消息。owner 隔离测试不等于新增完整多实例产品支持；若宿主拒绝重复工具/命令注册，应在获取会话归属前明确拒绝第二次安装，并保全现有实例，无需本轮新增多实例工具路由。

### 3.2 请求与锁顺序

先在 coordinator 锁外等待 `queue` / `saveQueue` 的稳定尾部，再捕获 queue 身份、generation、policy epoch。取得既有 request lease 后只核对这些值未变，再做请求认证；不要在持有同一 coordinator 的锁时等待可能正在申请它的队列。

若队列尾部已变化，释放 lease，返回 `stale_input`；不做无限自旋。认证成功后签发本次 ticket，再进入 `next()`，在 `finally` 撤销 ticket、释放 lease。回调中必要的存储读取仍要执行现有权限和 packet 校验。

### 3.3 关闭状态机

建议 `open -> closing -> closed`，缓存同一个 `closePromise`。

1. 同步进入 closing、`retire(owner)`、递增绑定 generation、撤销当前 packet。
2. 立即发出 shutdown abort 与 `agent.cancel`；这一步不等待 coordinator。
3. jobs、agent idle、queue、saveQueue 各自结算并收集错误。一个失败不能跳过其他会话的封锁。
4. 对每个绑定尝试 `policy.block`，将失败状态持久化到可写的 host journal，再独立清理 hooks、句柄和 lease。
5. 只有在该 session 已封锁后才释放 ownership 槽位；如果封锁失败，保留 retired owner 障碍，避免旧 close 稍后把新 owner 的同名 session 封锁。
6. 已开始的 provider 请求依靠宿主取消与流的 finally 退出。根门禁保证后续新请求拒绝；不能承诺撤回已经发送的网络数据，也不能声称能强制终止忽略 AbortSignal 的 provider。

队列和保存入口在 closing 后拒绝新业务写入。最终 blocked journal 保存使用受限的内部收尾路径；不得通过把 `closed=false` 暂时恢复来完成。清理异常聚合上报，owner 仍保持撤销；不把 `Promise.allSettled` 当作“所有关闭成功”。不能在持锁时等待 whenIdle。

## 4. 状态诊断与干净续接

拆出“等待队列结算”和“要求会话健康”两种行为：前者可以返回最近错误，后者仍阻止业务读写和生成。`/rp status`、宿主 `status()` 与 `/rp continue-clean` 在普通 `drain` 前分流。

- status 报告生命周期、policy 状态、branchId、最近错误码、pending 和 ambiguous 输入 ID。不要打印正文、全局私有源映射或未经校验 journal 的内容。
- continue-clean 先取消旧 agent，旧会话保持 blocked。用有效 authority 重新读取 branch fence、权限和当前有效数据，在同一授权分支建立新的干净 root。
- 不复制旧 messages、frames、receipts、未认证工具结果。可以从有效 ledger 重建已接受的输入绑定，但全部视为已处理历史，禁止恢复时自动 dispatch。
- `observed/accepted` 输入可由用户在经过验证的恢复路径显式处理；`dispatching/dispatched` 的发送结果可能不确定，不自动重发。
- 创建失败时销毁未提交的新句柄；发布前重新校验原 owner、授权和 branch fence。发布竞态失败不得留下可发送的半绑定 agent。
- 若旧 journal 损坏，只给出诊断，不能相信其中的 branchId。用户显式提供 branchId 且宿主可独立授权该 workspace/campaign/branch 时，才允许创建新 root；不修补校验和后假装历史可信。

## 5. retcon 与摘要失效

修复放在 `store.commit` 的中央失效闭包，而不是只在 `/rp retcon` 命令分支中补代码。

1. 从当前分支 accepted 状态收集本次将被 invalidated / supersedes / correction target 影响的旧事件 ID。
2. 从这些旧事件的可信 metadata 取得 `sourceRevisionIds` 集合。
3. 对**提交前已存在且有效**的 summary：若其 source 引用与上述集合有交集，则加入 invalidated 集合。
4. 运行现有 dependency DAG 传递闭包，让依赖它的 chapter/arc 一同失效。
5. 原始 source 保留。只影响本次分支的有效视图；父分支和兄弟分支仍按各自固定历史解释。

这是保守依赖规则：一个原文同时支持多个事实时，可能让部分仍正确的旧摘要也过期；后续按新状态重建即可。不能把原始 source 一并撤销，否则会损失来源证据。新状态下重新生成的摘要可以使用合法来源，但仍需遵守人工采纳和普通校验；此规则不等于自动证明新摘要语义正确。

必须覆盖：摘要在事件采纳之前生成、没有 supportEventIds、两级以上依赖、冷重开、无关摘要和分支隔离。仅为新摘要自动补事件 ID 不足以修复已经保存的旧摘要。

## 6. 一致检索与实际记录回执

### 6.1 一次读取的一致性

在 `retrieval-index.ts` 新增一个内部一致读取入口：

```ts
type RetrievalView = Readonly<{
  fence: InputFence;
  records: readonly RetrievalRecord[];
}>;
async function readConsistentRecords(
  store: RpStore, authority: HostAuthority, inputSourceIds: ReadonlySet<string>
): Promise<RetrievalView>;
```

顺序为 readFence A -> 来源/事件/摘要/投影与正文读取 -> readFence B。完整 fence（包含 contextRevision、source manifest、canon bindings、权限与删除代际）相同才返回；不同则 `snapshot_changed`。权限或正文失效则按现有拒绝语义退出。所有子读取仍使用同一真实 authority。不得加入“读取失败就用缓存旧正文”的补偿。

首次 ranking、搜索翻页、get 首段和后续分段都使用这一入口。get 的外部 verification 回调完成后，再做一次一致校验，确认目标 revision 仍相同。每次调用只做约定的有限读取，不做无界重试。

注意两个比较层次不同：读取期间要求完整 fence 相同；跨页保持固定结果时允许无关 append 改变 contextRevision，但要求 authority、branch、policy、visibility、deletion、canon 绑定未变化，且最初固定结果的每个 ID/revision 仍有效。保留 A22 的 23 条结果按 7 条翻页且不混入新增项的行为。

### 6.2 实际结果的可信证明

选择本轮实施：**新增实际记录证明，并显式升级 host journal**。不继续用工具完成后的全量 source/event 列表代替它实际返回的记录。

建议新增 `src/rp/retrieval-evidence.ts` 与 `src/rp/host-journal.ts`：前者只负责证明类型、结果哈希和验证；后者从 rp-plugin 提取 journal 校验与兼容读取，避免继续把全部状态逻辑堆在一个文件里。

```ts
type RetrievalRecordRef = Readonly<{
  id: string;
  revision: string;
  kind: 'source' | 'event' | 'summary' | 'state';
}>;
type RetrievalEvidence = Readonly<{
  inputFence: InputFence;
  records: readonly RetrievalRecordRef[];
  resultSha256: string; // canonical(此次成功的 Result 对象) 的哈希
}>;
```

retrieval 成功后，在私有 WeakMap 将 proof 绑定**该 Result 对象**和实际 authority。search proof 至少覆盖这次返回的 items；固定 cursor 的完整结果清单仍由现有 cursor 状态校验。get proof 覆盖实际 record revision，响应哈希同时绑定片段与游标信息。proof 不作为模型可以提交的参数；公开 JSON 里的 fence、ID、hash 不能替代这个关联。

工具 execute 取得 proof 后，在宿主私有 pending 表按 `(owner, agent identity, callId, generation)` 记录 proof、packetId 和预期渲染文本哈希。tools/execute wrapper 从该表消费记录，核对 SDK render 后的实际 text/content、当前 owner/packet 与 proof 的授权和记录版本，再创建 receipt。跨调用、跨 agent、过期 generation、被替换文本一律拒绝。pending 项在成功、错误、取消和 close 时清理。

收到失败 Result 时，不签发“检索到事实”的 proof，也不复用上一次 proof；宿主可为固定错误码和安全文本签发独立 error 回执，空 records，不能混入来源正文。`rp_memory_status` 使用独立的无正文状态回执（含权限 fence、空 records 和内容哈希），不能借 status 名字注入任意正文。

验证与 receipt 发布之间要有清晰线性化点：在 coordinator 锁外等待保存队列稳定，再在短 coordinator 临界区内复核 owner、queue 身份、proof 对应的稳定视图，并原子发布该 receipt journal。临界区内不调用 `next()`、外部 verification、队列尾部或会再次取同锁的函数；journal 写入使用不重入 coordinator 的专用原子持久化入口。读取结束后才发生的新 mutation 可以线性化在此工具结果之后，但下一次模型发送必须重新验证 receipt 依赖。

模型发送前，既核对原有 packet、全局依赖与消息正文哈希，也对每个检索 receipt 的实际 records 重做授权和 revision 校验。summary 和 state 都需要检查，不能只看 sources/eventIds。发生不相关追加时，records 未变可继续；实际依赖删除、retcon 或摘要失效则拒绝旧历史并提示干净续接。不要持锁等待可能需要同一锁的 queue。

### 6.3 host journal v2 与旧会话

- 仅宿主适配 journal 升级为 schemaVersion 2；branch/global 的 v1 磁盘布局、事务协议不改。
- v2 为 tool receipt/frame 增加受校验的 record refs 和 provenance 类型；保留包快照、普通 tool-call frame 的不同类型，避免把所有历史帧都误当成检索正文。
- v2 journal 的完整 envelope 同样在写入前检查第 7 节的可表示性和字节上限；proof 增长不能使原来可读的 journal 被覆盖成不可读文件。失败后保留 status / continue-clean 路径。
- v1 journal 的完整 checksum/schema 必须先通过。**任何无法证明其工具历史完整可追溯的 v1 会话均设为 recovery-only**；包括 receipts、frames 或宿主工具消息存在但无新 proof 的情况。不能仅因 receipts 表恰好为空就宣称没有旧工具历史。
- 可明确证明没有工具历史的 v1 journal，可在 authority/身份检查后原子写为 v2。保存原文件的字节备份再更新；失败保留原件可读。不可用当前有效 records 倒填旧工具结果的 proof。
- 有旧工具历史的会话保留原 journal，只允许 status / continue-clean；新 clean root 使用 v2，读取同一有效 branch，不复制旧工具历史。
- 不批量扫描迁移所有 profile。已有启动读取应识别并正确读取 v1/v2，升级只在目标会话激活/恢复时进行。dev.2 不保证读取 v2 host journal；回退需用备份或新 root，不能只改 schemaVersion 数字。

## 7. 全局容量与写入顺序

### 7.1 读取与写入共用上限

把现有 4 MiB JSON 上限提取为 `MAX_RP_JSON_BYTES = 4_194_304`，用于读取校验和写入预检。新增错误码 `capacity_exceeded`，明确“本次增长被拒绝，原状态仍可读”。

预检对象是完整 `{ state, sha256 }` envelope；校验序列化可表示性、结构限制和 `Buffer.byteLength(encoded, 'utf8')`。检查通过后写入**同一个 encoded 字符串**。不能只检查 state、正文大小、publications 数量或 JS 字符数。

`mutate` 里的 update 改成只构造 draft，不写 blob：

```ts
type GlobalMutationDraft = {
  resultId: string; // 控制操作可以为空串，保留当前语义
  pendingBlobs: readonly { relativePath: string; body: string }[];
};
```

pending 路径由可信代码生成。先完成 next metadata、幂等键、计数和 envelope 预检，再写 blob，再写 commit，再写 seal，最后 purge。容量拒绝前不留下新 blob、commit 或幂等记录；锁文件创建/释放与上一合法头的必要 seal 恢复不属于新业务提交。

### 7.2 有限控制余量

本方案的建议默认值：

| 用途 | 字节限制（完整 envelope） | 幂等键限制 |
|---|---:|---:|
| 新 publish，包括 superseding publish | 3,145,728（3 MiB） | 3,072 |
| revoke / privateDeletion 等控制操作 | 4,194,304（4 MiB） | 4,096 |

已有合法状态即使超过新 publish 软限，仍可读取；禁止新发布继续消耗控制余量。已有相同 key、相同 effect 的重试先走幂等分支，不增加 key/事务；仍可修 seal 或完成 purge。

不能保证“满了以后无限删除”：幂等记录和快照都占空间，旧的接近硬限状态也不自动获得 1 MiB 余量。达到硬限时，新控制写入明确返回 capacity_exceeded，原数据维持可读；已有已提交操作的同 key 重试不受新发布软限阻挡。永久容量治理需要另立有迁移协议的 compaction/分段存储任务，不能本轮删除旧幂等键或截断事务链。

当前 no-op privateDeletion 的幂等语义保留，不能把“该 scope 没有匹配 publication”改成 invalid_record，否则遍历 global grants 的 `/rp delete` 会被无关 scope 卡住。无效操作不得消费容量；合法 no-op 仍可能消费一个新 key，因此控制余量是有限的。

### 7.3 seal 恢复与错误语义

在 writer lock 内 load 合法 current，确认至多存在一个已接受的未封存头。**在为下一事务写 blob/commit 前完成该头 seal**；若失败，终止本次新事务。空库 seq=0 没有旧 commit，跳过补 seal，不写入非法的 seq=0 seal。不能允许两个未封存 commit，也不能靠放松 load 检查掩盖故障。

- commit 成功发布前的写入失败：`persistence_failed`。
- commit rename 已成功，但 seal 或后续 purge 失败：`persistence_uncertain`，提示使用同一 key、同一完整输入重试；不要伪报成无效输入。
- 相同 key + 不同 effect：`idempotency_conflict`。
- tombstone 必须 commit 且 seal 后才能物理删除 blob。
- 缺失旧 commit、错误 hash、两个未封存头等已损坏状态继续 fail closed；不做自动截断、重排或伪造 seal。

本轮保证应用进程可观察故障下的协议一致性；不额外宣称已经验证所有操作系统断电后 rename/fsync 的耐久性。

## 8. 锚点与批量控制

### 8.1 exactAnchors

统一 `MAX_EXACT_ANCHORS = 256`。合并 proposal、selection、child summary 的 anchors 后，按完整 span 元组去重（sourceRevisionId、publicTextSha256、startUtf16、endUtf16、quoteSha256），再次检查数量和每个 span 的原文/hash/UTF-16 边界。超过上限在任何 candidate blob/meta 写入前返回 `invalid_candidate`。

不静默裁掉“超出的”关键事实，不只提高一处 schema 上限。129 + 129 个不重复 anchors 应拒绝；重叠去重后 256 个应保存、读取、采纳一致成功。旧非法候选可以解释性拒绝并允许用户丢弃重建，不能在读取时偷偷截断。

### 8.2 batch retract

以原 ledger 的同一快照验证所有显式 targets，生成 immutable target set。计算所有 target 之后的 host_public 后缀 union，pending_replay set 排除显式 targets。一次生成最终 sourceBindings 并提交；显式 targets 的 retracted 优先于后缀状态。

使用相同原始分支数据分别执行 `[A,B]` 和 `[B,A]`，最终 disposition 必须相同；任一非法目标导致整批不提交。不同顺序但共用同一个 key 的重试是否冲突仍服从现有 effect 哈希约定，本轮不偷偷重定义幂等 key 的含义。

## 9. 评测改进与后续路线

T9 为 fixture 每个事实增加人工标注的允许支持 quote 集合（包含 sourceId 与精确 quote）。评分要求引用匹配该事实的一条允许 quote，并能在原文中定位，不能只要求同一 source 的任意 substring。政策版本升为 `rp-exact-annotation-fixture/v2`。这是固定标注评测，不是通用自然语言蕴含判断，也不需要引入付费 judge。

dev.4 再做后台候选：沿用 job/fence、用户采纳、有限重试、过期结果丢弃；先完成小型有人工标注的 RP 长程场景评测。原生压缩必须另行证明历史替换、CAS、owner、取消和完整消息过滤能力；通过以前保持关闭。

## 10. 方案审阅重点

所有新对象的生命周期必须明确；读取证明与持久化证明不能互相伪造；旧资料不能通过迁移绕过认证；根门禁不能与工程插件生成第二把锁；容量与 seal 改动必须共用一个写入顺序。实施时如发现精确 SDK 不能支撑某项接口，报告具体源码和失败测试，再收缩适配层；不能通过关闭回归测试绕过。
