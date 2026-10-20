# DSH RP Memory Implementation Plan

> 面向 Codex／agentic workers：若环境装有 Superpowers，执行时采用 `executing-plans`，需要独立审查时采用相应只读 review 流程。未安装这些技能时按本计划直接执行，不伪造技能、命令或工具。默认一个实现者；最多一名并行只读审查者。

**Goal:** 在当前仓库新增可独立安装的 RP 记忆与压缩插件，支持全局设定、本局记忆、分支修订、角色视角和可恢复压缩。

**Architecture:** RP 领域模型与工程 MemoryRun 分离；低层来源能力经适配器复用；以权威事务日志、有效来源 manifest、确定性投影和发送前 fence 保证连续性。所有原生操作先经过能力验证。

**Tech Stack:** 沿用仓库 TypeScript / ESM / node:test / esbuild / pnpm 及实际 pinned DSH SDK；初版不增加数据库、向量服务、Web 框架或多 agent 调度依赖。

**Spec:** [01_RP_MEMORY_SPEC.md](01_RP_MEMORY_SPEC.md)；契约：[03_CONTRACTS_REFERENCE.ts](03_CONTRACTS_REFERENCE.ts)；验收：[04_ACCEPTANCE.md](04_ACCEPTANCE.md)；源码接入：[05_BASELINE_AND_CAPABILITIES.md](05_BASELINE_AND_CAPABILITIES.md)。

**Baseline:** `00bc770ef5e0819fb0fb3bee4afbd9576e303364`，Ultra 0.6.0，Memory 0.1.0。以下源码路径相对仓库根目录；新增文件是待实现目标，不代表已经存在。

## Global Constraints

- 读取适用的 AGENTS.md，先检查当前工作区；保留用户未提交的修改。若当前 HEAD 已更新，记录实际版本，核对与本基线相关的差异，不能重置用户分支。
- 源码主树维护在根 `src/`；伴随包 `core-src/` 是构建生成物，不能维护两套算法。
- 默认不启用 RP 和原生压缩，不改用户现有 profile，不自动触发真实付费模型、发布 npm、推送或修改远端。
- 第一个红测必须针对数据、状态或接口行为。不要先写空函数再用“文件存在”测试宣称阶段完成；不要让生产宿主适配器回落成测试桩。
- 测试文件使用 `test/rp-*.test.mjs`，明确匹配现有 `test/*.test.mjs`。TypeScript 源码内部使用与现有工程一致的 `.js` 导入后缀。
- 所有模型输入／JSON／磁盘记录都经过运行时 schema 校验。类型断言、模型自报权限和字符串里出现的用户指令不构成授权。
- 准确标注 verified / unsupported / failed / unverified。mock 通过只证明应用规则，不能证明原生宿主能力。
- 构建、高占用测试串行。每次故障先保留命令、环境、错误和阶段；同一根因失败两次后停止原样重跑，诊断根因并继续不受影响工作。此规则与摘要 job 的最多 3 次尝试是不同层级。
- 不设置武断的小内存硬上限，不进行 OOM 重启循环，不随意删锁文件／改依赖版本／扩大权限来获得绿灯。
- 阶段结束保存工作区检查点和进度；已有提交授权时可本地提交。远端发布不属于本计划。发现宿主能力缺失时阻止依赖该能力的路径，完成其他已授权阶段。

## Review Focus

| 高风险输入／失败模式 | 必须证据 |
| --- | --- |
| 再生成、编辑、retcon 与祖先／兄弟分支 | A05–A08、A12–A17、A26–A27；检查有效来源和依赖，不只检查摘要文字 |
| 秘密进入原始近期消息、工具、多模态元数据 | A01–A02、A18–A20、A29；检查实际最终请求 |
| 任务期间 canon / visibility / 删除变化 | A20、A25–A28、A33；阻止旧结果发布和重建复活 |
| 压缩提交、flush、lifecycle、reader 不一致 | A10、A34–A38；失败注入与原生重启 trace |
| 自包含构建和工程／RP 竞争 | A09、A11、A22、A39–A40；实际 TGZ + 两种安装顺序 |

## 依赖顺序与里程碑

| 阶段 | 依赖 | 可审查成果 |
| --- | --- | --- |
| P0 宿主与基线能力 | 无 | 精确 SDK 探针、当前测试基线、可用档位 |
| P1 领域／来源／存储 | P0 的环境与来源结论 | 可重放的有效来源账本；未接入生产自动 hooks |
| P2 采纳／分支／状态 | P1 | 可纠正、分叉、撤回和删除的故事历史 |
| P3 全局／检索／packet | P2；注入／会话模式门 | 可用的 Memory 档；strict POV 单独受能力门控制 |
| P4 模型候选／分层摘要 | P3；模型服务可用或手工候选模式 | 场景／章节摘要与有界作业；不必已经开启原生压缩 |
| P5 原生压缩／恢复 | P4 + 全部压缩能力门 | 可恢复的 Compaction 档 |
| P6 打包／发布验收 | 可用的前述阶段 | 独立 TGZ、安装证据、模式限制和评估报告 |

P5 原生能力不足时，P6 仍可交付如实标为 Memory 档的预览包；不能把 P5 标成完成。自动采纳能力不足时，P2 可提供明确的人工作品采纳流程；没有可靠原始来源的路径不可进入正式压缩。

## P0 — 核对基线并建立能力探针

### 文件

- 读取：`AGENTS.md`、`package.json`、锁文件、`tsconfig.json`、`src/{memory-plugin,evidence-support,memory-host,evidence,context-memory,context-archive,context-archive-store,knowledge-host,knowledge-store}.ts`、`scripts/build*.mjs`、已有测试／host-acceptance 工具。
- 新增：`scripts/host-acceptance/rp-capability-probe.mjs`、`test/rp-capability.test.mjs`、`test/fixtures/rp/host-traces/`。
- 新增设计／进度：`docs/rp-memory-capabilities.zh.md`、`docs/rp-memory-progress.md`。
- 输出证据：`artifacts/rp/capabilities.json`、`artifacts/rp/baseline.json`；不提交含凭据／私人文本的产物。

### 操作

- [ ] 检查工作区、实际 HEAD 和包管理器；读取依赖声明与锁文件，记录精确 SDK 版本。既有环境不完整时先报告缺项，按仓库正规安装方式补齐已允许依赖；网络失败不得无限重复。
- [ ] 运行既有 typecheck/test 基线，记录原本的失败，不把它们算成 RP 修复成果。
- [ ] 定义探针 CLI：`--mode offline --output <path>`，创建临时 profile，使用本地模拟 provider 驱动真实 SDK，网络默认禁止。
- [ ] 为 05 列出的 11 个 capability 各写正例、负例和证据路径；原生能力缺失时记录状态和降级，不创建替代“假 API”。
- [ ] 专门证明最终模型请求的注入／过滤边界、accepted 与 generated 的区别、revision/fork、持久替换和 lifecycle 恢复。
- [ ] 以 A01–A04 写能力门红测；实现 capability report 的运行时解析和模式判定。报告生成器本身不能用默认 verified。
- [ ] 按是否真的复用路径，登记 05 的四项原有风险需要修复还是由 RP 独立实现隔离。

### 接口

`probeHost(environment) -> Promise<CapabilityReport>` 是新 CLI 内部接口。结果 schema 与 03 一致。未运行 probe 的 capability 必须为 unverified。确切 DSH 事件名、方法、header 版本只能引用实际 SDK 与 trace。

### 验证命令

~~~
git status --short
git rev-parse HEAD
pnpm run typecheck
pnpm test
node --test test/rp-capability.test.mjs
node scripts/host-acceptance/rp-capability-probe.mjs --mode offline --output artifacts/rp/capabilities.json
~~~

新命令在本阶段实现后才能执行。测试环境不支持某 capability 时，测试断言正确拒绝，报告保留 unverified / unsupported，不把拒绝路径当原生成功路径。

### 完成条件

能力矩阵能被复核；每个 verified 有真实本地 SDK 断言与精确版本；缺失项明确阻止相关产品路径。保存进度与下一步入口。

## P1 — 领域类型、来源适配与权威存储

### 文件

- 新增：`src/rp/{types,schema,store,source-adapter,capabilities}.ts`。
- 新增：`test/rp-store.test.mjs`、`test/fixtures/rp/story-fixture.mjs`。
- 只在确认必要时修改：`src/evidence.ts` 的共享来源原语；默认先在 RP adapter 包装。

### 接口与边界

- `parseRecord(input: unknown) -> Result<RpRecord>`：按 schemaVersion 与 record kind 校验未知字段、尺寸／深度、ID、有限安全整数、来源哈希与语义字段。
- `RpStore.commit(authority, batch) -> Promise<Result<InputFence>>`：权威事务提交；同一幂等键同一效果，冲突 fence 返回 stale_input。
- `readSource(authority, span) -> Promise<Result<string>>`：经当前范围、分支、删除、视角及哈希校验才返回原文。
- `replayProjection(authority)` 此阶段先保证日志读出顺序和 schema 完整，正式 reducer 在 P2 实现；未完成函数不得注册为可用生产服务。

### 操作

- [ ] 先按 A05–A11 建立两个 workspace、两个 campaign、分支和来源的确定性夹具。
- [ ] 由 03 提炼实际 `types.ts`，补全按 kind 的权威 mutation schema，不能保留开放 JSON 作为生产“随便写”入口。
- [ ] SourceRevision 保持原文本哈希和 message revision；candidate／accepted 状态保存在分支绑定，不能原地改共享 blob。
- [ ] 实现稳定 workspaceId、真实根目录绑定与显式迁移；复制同名目录不获得原身份，旧路径新项目不能继承历史。
- [ ] 实现排他写入锁、不可变事务批次、校验、原子提交和重启重放。检查文件损坏／中断／重复消费；索引与快照可重建，权威元数据不可当缓存清理。
- [ ] 记录 fork manifest、canon 绑定、visibility、deletion generation、采纳结果等全部有效性元数据，避免以后重建复活已撤销内容。
- [ ] 实现来源读取／稳定正文分页的底层快照；验证 UTF-16 引文边界及 UTF-8 哈希。
- [ ] 证明 EvidenceStore adapter 只使用公开来源能力，不把 RP 台词写入 requirement／operations。

### 验证

~~~
pnpm exec tsc -p tsconfig.json
node --test test/rp-store.test.mjs
~~~

红测先跑到预期行为失败，再做最小实现。通过后保存一次检查点；测试缺失不是通过。

### 完成条件

重启重放得到同一有效来源 manifest；重复投递不增加事实；迁移不扩大授权；磁盘损坏不会生成“可恢复”假结果。此阶段不启用生产自动 hooks。

## P2 — 采纳、分支、纠正与状态 reducer

### 文件

- 新增：`src/rp/{canonical,reducer,host-adapter}.ts`。
- 在 `store.ts` 扩充分支／删除事务；新增 `test/rp-branch.test.mjs`。
- 补充夹具：明确世界事实、错误信念、台词、秘密、物品转移、关系转折、倒叙、旧消息编辑。

### 接口与边界

- `applyCanonicalChange(change: CanonicalChange, authority: HostAuthority) -> Promise<Result<InputFence>>`。
- `reduceEvents(events, branchManifest, policy) -> { state, claims, conflicts }`：无网络、无模型、同输入同输出。
- `forkBranch(authority, parentRevision, prefixManifest) -> Promise<Result<Branch>>`：固定历史；不跟随可变父指针。
- `applyControl(authority, userControlSource, operation)`：retcon／撤回／遗忘／隐私删除等受信操作，分别有 schema。

### 操作

- [ ] 以 A12–A20 编写红测。对新回答／备选／编辑／中止构造不同 canonical events，不用最后时间戳推断采纳。
- [ ] 自动采纳只接入 P0 verified 的 native event；否则使用明确的人工选择来源版本。宿主完成事件仍保留为来源观察，不能升格 canon。
- [ ] 实现父 revision 固定前缀、分支本地 supersession overlay、兄弟／既有后代不受 retcon 影响。
- [ ] 编辑后把受影响后缀设为 pending_replay，失效依赖；明确采纳后再从新来源重放。
- [ ] 实现 world / belief / utterance / uncertain 与 truth 三值；缺失证据不推断 false，冲突不按时间戳覆盖。
- [ ] 实现角色知识取得／失忆、方向性关系、状态转移、承诺与未决冲突；保留支持来源。
- [ ] 实现三种“忘记”的不同操作；隐私删除先持久化 tombstone 并阻断再清理，旧 job 不可复活。无法过滤宿主残留原文时阻断受影响请求。
- [ ] 整理 adapter 对真实宿主事件的精确映射；未支持路径返回具体错误，不能通过类型断言调用不存在的 API。

### 验证

~~~
pnpm exec tsc -p tsconfig.json
node --test test/rp-store.test.mjs test/rp-branch.test.mjs
~~~

### 完成条件

读同一分支可得到唯一可解释状态；retcon 与隐私删除跨索引／缓存／任务有效；源码和 reducer 中没有把模型置信度当成权限或客观事实的路径。

## P3 — 全局记忆、检索与完整上下文

### 文件

- 新增：`src/rp/{global,retrieval,packet,tools,session-policy}.ts`、`src/rp-plugin.ts`。
- 有界修改：`src/evidence-support.ts` 及盘点发现的其他工程直接 hooks，使其遵守共同 session policy。
- 新增：`test/rp-retrieval.test.mjs`；共存基础用例先放 `test/rp-package.test.mjs`，P6 再补 TGZ 场景。

### 接口与边界

- `publishGlobal(authority, approvedControl, publicationDraft) -> Promise<Result<GlobalPublication>>`：真实用户授权、固定内容和范围。
- `RpGlobalStore.commit(authority, batch: GlobalCommitBatch) -> Promise<Result<GlobalFence>>`：独立 profile/world 事务，不要求存在剧情 branchId；只有分支显式采用新 canon 时才推进分支 contextRevision。
- `search(authority, query, cursor?) -> Promise<Result<SearchPage>>`：先授权／有效性过滤，再排序分页。
- `get(authority, id, cursor?) -> Promise<Result<RecordPage>>`：固定正文＋页外实时校验状态。
- `buildPacket(authority, requestContext, budget) -> Promise<Result<MemoryPacket>>`。
- `prepareFinalRequest / measureFinalRequest / admitFinalRequest`：03 的应用接口；实际实现必须由已验证的原生请求路径承载。
- `session-policy` 使用根宿主可共享的服务／协议 `dsh.session-memory-policy/v1`；不同 bundle 中的 module-local Map 不能代替共享服务。

### 操作

- [ ] 以 A21–A25 及 A01–A02 编写红测；加入 global 显式发布、canon revision 绑定和拒绝自动关系迁移。
- [ ] 实现 Profile preference 白名单、world／character 定义和战役显式绑定；更新设定不自动追溯改写旧分支。
- [ ] 用户从私有剧情发布选定 canon 时生成独立 approved_publication 来源；原文无权者只能读发布快照；删除操作明确是否撤回副本。
- [ ] 实现确定性词项／实体检索；中文查询、同名不同实体、错分支、无权标题／数量均测试。向量检索保持后置。
- [ ] 分开实现检索快照 cursor 与正文 cursor；在页间改变验证状态／并发插入／撤权／删除，不能错位拼接或跨视角复用 cursor。
- [ ] 实现最近八个完整 accepted turn + 当前未完成轮；最终请求全体内容按视角过滤。不能只测 packet。
- [ ] 预算用实际 C、Imax、动态输出预留；校验 target／trigger ≤ min(C, Imax+R)。先移除可选历史，必保留内容仍超限则明确拒绝。
- [ ] 接入独立 RP service 与默认关闭配置。在 RP 会话中，工程语义摄取、entry、beforeStep 和 compactor 统一跳过；在工程会话中 RP 不注入。活动模式切换先排空，不直接拆掉仍在使用的 archive reader。
- [ ] 注册最小读工具／提案工具和真实用户控制入口；scope 由宿主绑定，模型不能凭参数写全局。UI 缺失时明确采用已支持的控制方式。
- [ ] 新 plugin 的 apply/dispose 处理准备中任务、写入队列和 lease。异步回调销毁后不能再追加 packet。

### 验证

~~~
pnpm exec tsc -p tsconfig.json
node --test test/rp-capability.test.mjs test/rp-retrieval.test.mjs test/rp-package.test.mjs
~~~

### 完成条件

能用实际宿主支持路径运行 Memory 档；无法过滤整个请求时 strict POV 明确禁用；同一会话不会同时触发工程和 RP 入口；global 与本局事实隔离。原生压缩仍关闭。

## P4 — 结构化候选与场景／章节摘要

### 文件

- 新增：`src/rp/{candidates,jobs,summarizer}.ts`。
- 新增：`test/rp-summary.test.mjs`、`test/fixtures/rp/semantic-candidates.json`。
- 领域 schema／全局发布仍复用 P1–P3，不让摘要器直接持有写权限。

### 接口与边界

- `CandidateGenerator.generate(input, signal) -> Promise<unknown>`：不持有 HostAuthority 或 RpStore。
- `validateCandidate(input: unknown, snapshot) -> Result<MemoryCandidate>`：权限、来源和身份由宿主填充／推导。
- `runSummaryJob(job, generator) -> Promise<Result<Summary>>`：提交须按 InputFence CAS。
- `summarizeScene / summarizeChapter` 可共用一套 level 参数，不创建两套并发系统。

### 操作

- [ ] 以 A26–A32 写红测，使用可控 async barrier 暂停候选生成，在暂停期间改变分支／source／canon／visibility／deletion／policy。
- [ ] 每个 profile 最多一个摘要模型 job；按 branch 串行提交。总尝试上限 3，达到上限后 deferred／failed，无热循环或无限微任务。
- [ ] 若宿主模型入口可用，接入原生取消、超时和用量；缺失时接受人工结构化候选，保持模型能力未验证，不直接请求外部 API 绕过宿主。
- [ ] 默认按场景结束或预算阈值处理增量，不强制每条短对白额外调用模型。场景自动划分先给建议，显式边界优先。
- [ ] 场景／章节／长线摘要保留完整来源 manifest、关键事件、精确锚点和可见性；不把旧摘要当原始事实。
- [ ] 任务过期则拒绝发布；已发布摘要按当前依赖有效性重用，新消息不必作废无关场景摘要。
- [ ] 设置可执行的关键状态核对及语义评估输出；把“有来源但曲解了来源”的错误记入质量报告，不用结构校验伪装解决。

### 验证

~~~
pnpm exec tsc -p tsconfig.json
node --test test/rp-summary.test.mjs
~~~

### 完成条件

模型只能提出候选；范围、版本和来源校验有负例；摘要的可见性和溯源链成立；作业有界；实际模型效果仍列为待测，不能用 stub 压缩率宣称质量。

## P5 — RP 原生压缩、恢复与所有权

### 文件

- 新增：`src/rp/{compaction,archive-store,recovery}.ts`。
- 修改：`host-adapter.ts`、`session-policy.ts` 和 RP plugin 的请求前门。
- 新增：`test/rp-compaction.test.mjs`、`scripts/host-acceptance/rp-recovery-proof.mjs`。
- 原工程 `context-archive.ts` 的逐字保留校验不因 RP 改弱。

### 接口与边界

- `prepareArchive(authority, inputFence, surfaceSnapshot) -> Promise<Result<RpArchiveManifest>>`：持久 prepared 候选，尚不生效。
- `compactRpSession(authority, lease, manifest) -> Promise<Result<RecoveryState>>`：最多一次完整平衡区间替换。
- `inspectRecovery(authority, archiveId)`：分别证明 committed / persisted / lifecycleClosed / recoverable。
- `assertAdmission(authority, request, fence) -> Result<ready>`：所有 pending、reader、来源、预算和权限在实际请求边界复核。

### 操作

- [ ] 先复核 P0 的替换／恢复／独占能力及实际 SDK 版本。门未过就把 P5 标 blocked，完成 P6 的 Memory 档交付。
- [ ] 以 A33–A38 写每个故障边界的红测；务必覆盖“未替换但 lifecycle 已开且关闭失败”以及“替换成功、原文存在、end 失败”。
- [ ] 选择完整 accepted 老轮，保护最近八轮、当前轮、系统要求、富媒体和完整工具对。只支持前缀时 barrier 返回 limited，不假装支持任意 span。
- [ ] 在 prepare 前证明原文可持久恢复；生成 `rp.context/v1` / `rpa_` manifest，校验文本／来源／摘要／scope 哈希。
- [ ] 真实租约内重新检查 fence 与 surfaceGeneration；原生替换与 lifecycle 使用 probe 证实的准确调用，不复制可能失效的源码 cast。
- [ ] 分别记录 surfaceCommitted、persisted、lifecycleClosed、recoverable。start 或 end 中断不能以 committed 为唯一条件清 pending。
- [ ] 重启从原生日志和不可变 manifest 对账，确认真实状态再继续；提交后 flush 不确定时阻断，不宣称回滚。
- [ ] 压缩开关关闭只停新压缩；已使用 capsule 的恢复 reader 继续保留。卸载前若无法保留恢复能力，拒绝危险的即时拆除并提供可验证恢复步骤。
- [ ] 检测工程／RP／原生第三方竞争，覆盖两种安装顺序与 lease 释放。无独占证明则关闭压缩。
- [ ] 在最终请求边界重测完整输入及预留；不达软目标但硬限内可以 limited，硬限外不发送。

### 验证

~~~
pnpm exec tsc -p tsconfig.json
node --test test/rp-compaction.test.mjs
node scripts/host-acceptance/rp-recovery-proof.mjs --mode offline --output artifacts/rp/recovery.json
~~~

recovery-proof CLI 在本阶段新增，固定 trace 与故障点，不能默默启用在线模型。

### 完成条件

原生离线证明全部故障状态恢复或被正确阻断；实际压后请求变小；原文可验证恢复；当前调用路径独占且闭合。若仅应用 fake session 通过，P5 保持未通过原生验收。

## P6 — 打包、回归与 RP 质量评估

### 文件

- 新增：`packages/dsh-rp-memory/{package.json,cordis.patch.yml,README.md,src/index.ts}`。
- 修改：`scripts/build-companions.mjs`；按实际生成物需要调整 ignore／manifest；原 root 版本是否更新遵循仓库发布规则。
- 新增：`test/rp-package.test.mjs`、`test/rp-evaluation.test.mjs`（已有则补齐）。
- 新增：`scripts/host-acceptance/rp-package-proof.mjs`、`scripts/benchmarks/rp-memory.mjs`。
- 新增：`benchmarks/rp/golden.jsonl`、`docs/rp-memory-design.zh.md`、`docs/rp-memory-evaluation.zh.md`。

### 操作

- [ ] 以 A39–A42 写独立 import 与工程隔离红测。
- [ ] buildCompanions 改成显式 descriptor：memory→dsh-ultra-memory、decision→dsh-ultra-decision、rp→dsh-rp-memory；正确声明各自 entry／acceptance closure／是否有 client。
- [ ] 入口参考现有伴随包生成方式，RP 入口重导出生成 `core-src/rp-plugin.js`，声明路径对应 `lib/types/rp-plugin.d.ts`；所有身份／patch／manifest／README 一致。
- [ ] 保留 native externals 限制；snapshot 若先复制完整 core，文档如实说明；若缩小闭包则证明不漏依赖。禁止悄悄深导入 root 或其他伴随包。
- [ ] 构建一次完整产物，再以 ignore-scripts pack 避免重复运行高占用构建。记录 pack 返回的实际文件名，测试不能猜 TGZ 名。
- [ ] 从 TGZ 在没有源码仓库、Ultra 或 Memory 同级包的隔离 fixture 导入。原生 peer 使用已经 pinned 的本地依赖；缺失时报缺失，不偷偷访问网络。
- [ ] 执行全部 RP 测试与既有回归；验证 root glob 的实际发现数。只有具体失败或 gate 要求才扩大重测。
- [ ] 建立固定中文 RP 语料：事实／谎言／误解／道具／承诺／关系／秘密／倒叙／retcon／分支。评估程序 fixture 模式无模型无网络。
- [ ] 分开输出确定性正确性、模型语义质量和真实 RP 体验。指定关键事实召回、unsupported claims、主体归属、POV 错漏及来源支持率；不要只追求压缩率。
- [ ] 在线评估入口必须要求明确模型、预算和确认参数，不作为默认 build/test 的副作用。
- [ ] README 写清实际支持模式、SDK 版本、全局／本局范围、设置、纠错／删除、恢复限制、已有测试及未完成门；交付可安装 TGZ 与验证报告，不自动发布。

### 验证命令

仓库根目录：

~~~
pnpm run typecheck
pnpm run build
pnpm test
node --test test/rp-*.test.mjs
node scripts/benchmarks/rp-memory.mjs --mode fixture --corpus benchmarks/rp/golden.jsonl --output artifacts/rp/fixture-report.json
~~~

上面的 RP 子集测试若已从同一构建通过且 root test 证明全部被发现，可省去重复执行；不得省略 test discovery 证据。

工作目录 `packages/dsh-rp-memory`，根 `artifacts/rp` 已创建：

~~~
npm pack --ignore-scripts --json --pack-destination ../../artifacts/rp > ../../artifacts/rp/pack.json
~~~

回到仓库根目录：

~~~
node scripts/host-acceptance/rp-package-proof.mjs --pack-info artifacts/rp/pack.json --output artifacts/rp/package-proof.json
~~~

### 完成条件

交付实际 TGZ、测试摘要、capability report、已测 SDK 版本和未过的门。质量阈值是有限语料目标，不能宣称“无限无损长记忆”。Memory 档可如实交付；Compaction 档必须另有 P5 原生证据。

## 每阶段进度模板

写入 `docs/rp-memory-progress.md`，后续 Codex 会话先读它：

~~~
实际 HEAD / 工作分支：
本设计版本：v1.0
当前阶段：P?
可用模式：capture / memory / compaction
已完成行为：
改动文件：
最近验证命令与结果：
失败的精确命令、根因与已尝试次数：
未验证 capability 及证据路径：
已保留检查点：
下一步唯一实施任务：
需要用户决定的具体事项（仅确实阻塞时）：
~~~

## 实施自检

- [ ] 所有新功能映射到 spec 段落、具体路径和测试；没有漏掉 global 发布／撤回／canon 绑定或隐私删除。
- [ ] 类型、默认值、错误码、阶段与命令一致；03 参考契约的简写已在生产 schema 中补成严格 discriminated unions。
- [ ] 阶段中写到的 CLI、fixtures 和工具均已真正实现；报告没有把缺失测试当成功。
- [ ] 用户采纳、故事真实性、角色知识、宿主授权四件事没有互相替代。
- [ ] 最终请求包含近期原始消息的正确修订，且错误分支、被拒绝版本、删除项、无权来源未进入任何请求路径。
- [ ] 压缩恢复门没有通过 catch 后清空 pending 或 retry loop 隐藏错误。
- [ ] 未自动启用真实模型、改用户配置、发布产物或扩展项目范围。
