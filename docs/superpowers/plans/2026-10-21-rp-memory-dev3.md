# RP Memory dev.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development when delegated execution is available and appropriate, or superpowers:executing-plans for inline execution. Follow the resource constraints below: a single writer is the default, and delegation must not create parallel builds or tests.

**Goal:** 在 dev.2 上完成会话生命周期、派生摘要、检索证明和全局持久化的一致性修复，交付可恢复的人工 narrator RP Memory dev.3。

**Architecture:** 保留现有 branch/global v1 存储、显式控制与共享 coordinator；新增根级 RP admission、实际检索记录证明、host journal v2；在中央提交层修正摘要失效，在全局写入口统一预检和 seal 恢复。

**Tech Stack:** TypeScript 5.9.3、Node.js >=22、Node test runner、esbuild 0.25.12、精确 DSH SDK 0.2.1-rc.2 / Cordis 4.0.5 / Schemastery 3.18.5。使用仓库 lockfile。

**Spec:** [设计规格](../specs/2026-10-21-rp-memory-dev3-design.md)。行为与接口冲突时先核实当前源码；有意改变规格需在提交说明写明证据和取舍，不得静默绕过安全边界。

## Global Constraints

- 本文件用于实施；方案包本身尚未实现这些任务。所有复选框初始均未完成。
- 读取本地 AGENTS.md、现有工作区状态和用户后续要求。保留用户修改；当前 HEAD 超出审查基线时先做窄范围差异核对，不回退旧版本。
- 新建普通开发分支或既有隔离工作区即可。只在需要保护已有改动时创建 worktree；不要复制出多套安装与构建。
- 默认一个 Codex 写代码；最多一个只读审阅者，不递归创建 agent。任一时刻最多一个安装、构建或测试重进程运行。
- 每个任务先添加针对缺陷的最小失败用例，运行确认失败，再修实现、运行对应回归。最终只集中运行一次全量验收；实际失败后允许有因果依据地修复并重跑受影响项。
- 不设置任意的 128 MB Node 堆上限。OOM / 超时 / EIO / store_locked 必须保留命令、版本、路径、退出码和故障阶段，再缩小复现；不得并行重试或无依据重复跑全量。
- 保留精确 SDK 门禁、真实 authority、来源 hash、UTF-16 span、显式采纳/发布、分支隔离、幂等和删除代际检查。
- 不在测试中调用付费模型或真实用户 profile。故障测试用独立临时目录、确定性 latch/故障点；不靠 sleep 概率触发竞态。
- 不自动发布 npm、push、合并 PR 或修改工程 companion 仓库。需要协调 companion 升级时列出精确依赖与阻塞证据。

## Review Focus

1. 关闭时能否绕过门禁，失败恢复是否被相同失败队列永久卡住。
2. 是否引入第二个 coordinator、持锁等待队列/流的死锁、旧 owner 清理覆盖新 owner。
3. source-only 旧摘要和上层摘要是否随改写失效，分支和原始证据是否保留。
4. 返回正文与实际 revision、宿主工具回执及下一次发送验证是否完整对应。
5. 元数据写入前是否预检完整 envelope，seal 故障是否能够累积成永久损坏。
6. v1 数据迁移是否只保留可证明的事实，是否把“未验证/未运行”写成“支持/通过”。

## 任务顺序与文件边界

推荐执行顺序：**T1 → T2 → T3 → T4a → T5 → T6 → T4b → T7 → T8 →（T9）→ T10**。T4b 依赖 T5 的共用序列化上限；T5、T6 都改 global.ts，应由同一写入者顺序完成。

| 任务 | 修改或新增文件 | 完成标志 |
|---|---|---|
| T1 | 新 `src/rp/admission.ts`；改 `session-policy.ts`、`rp-plugin.ts`；新 `test/rp-host-lifecycle.test.mjs` | owner 撤销与根门禁，不依赖异步清理成功 |
| T2 | `rp-plugin.ts`；复用生命周期测试 | status / continue-clean 在受损会话仍可用 |
| T3 | `store.ts`；`test/rp-summary.test.mjs`、必要时 `rp-branch.test.mjs` | 改写事件连带失效 source-only 旧摘要 |
| T4a | `retrieval-index.ts`、`retrieval.ts`；`test/rp-retrieval.test.mjs` | 检索返回稳定视图且保留固定分页语义 |
| T5 | `schema.ts`、`types.ts`、`global.ts`；新 `test/rp-global-recovery.test.mjs` | 拒绝不可读的新 commit，预留有限控制余量 |
| T6 | `global.ts`；复用全局恢复测试 | 先补 seal 再追加，准确返回持久化错误 |
| T4b | 新 `retrieval-evidence.ts`、`host-journal.ts`；改 `retrieval.ts`、`rp-plugin.ts`、必要时 `memory.ts`；新 `test/rp-host-receipts.test.mjs` | 实际记录证明、v2 journal 与可控旧会话恢复 |
| T7 | `schema.ts`、`candidates.ts`；`test/rp-summary.test.mjs` | 合并后的 anchors 在保存前完整验证 |
| T8 | `canonical.ts`；`test/rp-branch.test.mjs` | 批量 retract 无顺序依赖、无部分提交 |
| T9 | `scripts/benchmarks/rp-memory.mjs`、`benchmarks/rp/golden.jsonl`、`test/rp-evaluation.test.mjs`、评测文档 | fixture 引用和事实逐项绑定；可独立延期 |
| T10 | README、相关 docs、package.json / lockfile、SOURCE-MANIFEST.json；必要的宿主 acceptance 脚本 | 版本、包、声明与实际验收一致 |

测试工具只抽取真实重复的 fixture 逻辑，最多增加一个 `test/fixtures/rp/native-host.mjs` 用于精确 SDK + 合成 terminal。不要为一次性的故障断言建立通用注入框架。

## 开始前：确认当前基线

- [ ] 记录 `git status --short`、`git rev-parse HEAD`、`node --version`、`npm --version` 和目标 OS/文件系统。
- [ ] 确认 package.json、lockfile、SDK 服务与 session format 符合基线；若已变化，列出差异以及哪些结论需重验。
- [ ] 依赖已齐全且锁文件未变时不重复 npm ci。否则执行一次 `npm ci`。
- [ ] 阅读现有同领域测试和构建脚本；建立 `docs/rp-memory-dev3/RESULTS.md`，记录每项验收命令、结果、退出码与未覆盖范围。
- [ ] 不先跑多轮全量测试：基线已有 78/79、A22 单独通过的有限证据；T10 再集中验证。

## T1：根级 owner 准入与可靠关闭

**依赖：** 无。对应 I1、I2；验收 R01—R05。

- [ ] 新增精确 SDK + 合成 terminal 测试，先复现：host journal rename 注入 EIO，队列拒绝，然后 close；旧会话再调用 llm 必须被拒绝且 terminal 计数不增加。
- [ ] 增加活动流的 latch 测试：流进入后 close，同步验证新请求拒绝；释放/取消旧流，确认 finalizer 结束。测试不使用真实网络。
- [ ] 实现规格 3.1 的 admission。根服务长期存在；owner 是 opaque 身份；ticket 绑定实际 options；根 guard 不以 mode RP 单独放行。
- [ ] 将请求等待队列移动到 request lease 外；锁内比较队列身份、epoch、generation。`certify` 拆成锁外结算与锁内无队列等待的认证，防止重入 coordinator。
- [ ] 实现缓存 closePromise 的 closing 状态：先同步 retire，再 abort/cancel；独立处理所有结算、block、journal、dispose、lease 结果。
- [ ] session 在成功 block 后才释放旧 owner 槽位；失败保留 retired 槽位。agent/disposed 先 retireBinding，只撤销该 session，再异步封锁，捕获错误而非产生无人处理的 rejection。
- [ ] 其他 RP 实例对不属于自己的 session 委托；覆盖两种工程/RP加载顺序、两个 RP owner、disabled、重复 close。若宿主不能重复注册工具，第二次安装需在获得归属前明确拒绝并保全第一实例，不扩展为完整多实例产品。
- [ ] 验证 close 后没有新回执、候选或 packet 发布；不要声称能撤回关闭前已经发出的 provider 请求。

**定向命令：** `node --test --test-concurrency=1 test/rp-host-lifecycle.test.mjs`。

**提交建议：** `fix(rp): revoke request ownership before async shutdown`。

## T2：失败诊断与干净恢复

**依赖：** T1。对应 I3；验收 R06—R09。

- [ ] 添加失败 queue 与失败 saveQueue 用例：status 能返回诊断；普通 input/adopt/send 仍拒绝。
- [ ] 在 command 路由中提前处理 status / continue-clean。实现 `settleBound()` 返回结构化错误；普通工作仍走 `requireHealthyBound()`。命名可调整，职责不能混合。
- [ ] continue-clean 先封锁旧会话；独立检查当前 agent、cwd、workspace/campaign/branch 授权与 fence；建立新 root，发布前再验 fence 与 owner。
- [ ] 新 root 不复制 messages/frames/receipts。历史 input bindings 只用于追溯，不触发自动 dispatch；明确呈现 ambiguous input IDs。
- [ ] 覆盖创建中途失败、权限撤销、分支变化：清理新句柄，旧会话仍 blocked。
- [ ] 损坏旧 journal 不提取可信 branchId；仅用户显式 branchId + 独立 authority 校验可进入新 root。
- [ ] 检查原生 UI 说明仍准确：创建新 root 后用户在宿主选择会话，不伪报已切换 UI。

**定向命令：** `node --test --test-concurrency=1 --test-name-pattern='R0[6-9]' test/rp-host-lifecycle.test.mjs`。在新测试名称中保留验收编号，使过滤确实命中。

**提交建议：** `fix(rp): recover failed sessions without replaying ambiguous inputs`。

## T3：事件改写使旧摘要失效

**依赖：** 无；建议 T2 后做。对应 I4；验收 R10—R13。

- [ ] 建立蓝钥匙→金钥匙 fixture：同一 source、独立事件、无 supportEventIds 的 scene、引用 scene 的 chapter/arc。retcon 前合法，retcon 后旧摘要必须不可注入。
- [ ] 增加摘要先于事件采纳的变体，避免只给新候选补 supportEventIds 就误以为修复完成。
- [ ] 在 `store.commit` 收集被改写旧事件及来源，加入 pre-existing active summaries，再跑现有 DAG 失效闭包。包含 invalidatedIds、supersedes、correction target 路径。
- [ ] 只改该 branch 的有效记录，不撤销原 source；在两个分支和一个无关摘要上断言状态未受影响。
- [ ] 冷重开后旧摘要仍失效；同 key 重试不重复提交；新候选可在新 fence 下生成并经用户采纳。

**定向命令：** `node --test --test-concurrency=1 --test-name-pattern='R1[0-3]|A30' test/rp-summary.test.mjs test/rp-branch.test.mjs`。

**提交建议：** `fix(rp): invalidate source-backed summaries after event corrections`。

## T4a：稳定检索视图

**依赖：** 无；先于 T4b。对应 I5、I10；验收 R14—R17。

- [ ] 用两个 authority/内存实例共享同一测试 store，在 readEvents 或正文读取 latch 处插入 privacy_delete / retcon，证明当前实现可混合旧内容和新 fence。
- [ ] 新增 `readConsistentRecords(): Promise<RetrievalView>`，完整 fence 前后比较，失败返回 snapshot_changed；所有来源、摘要和投影读取均在该入口内。
- [ ] 初次 ranking 与后续 validate 使用一致视图，不再先取 fence 后不验证多次子读取。
- [ ] get 外部 verification 后再次确认稳定视图及目标 revision；过期 cursor 不留可复用的新 continuation。
- [ ] 固定分页用“权限不变 + 固定 IDs/revisions 有效”判断，避免把任何 contextRevision 改变都当作整批分页失效。
- [ ] A22 继续返回原固定 23 条；跨 authority、删除、canon 变更、记录修订必须拒绝。不得通过跳过 A22 解锁后续任务。

**定向命令：** `node --test --test-concurrency=1 --test-name-pattern='R1[4-7]|A22' test/rp-retrieval.test.mjs`。

**提交建议：** `fix(rp): read retrieval records under a stable authorization fence`。

## T5：全局容量预检与有限余量

**依赖：** 无；先于 T6、T4b。对应 I6；验收 R22—R25。

- [ ] 新增 `capacity_exceeded` 错误码、共用 `MAX_RP_JSON_BYTES`，将读取侧 magic number 替换为同一常量，保留原上限语义。
- [ ] 写入预检校验完整 canonical envelope 的结构、UTF-8 字节数、计数；写入使用已校验的同一字符串。
- [ ] 将 global update 的 blob 写入改为 draft 中的 pendingBlobs；验证 scope、approval、effect、next metadata 和容量后才写 blob。
- [ ] 新 publish 采用 3 MiB / 3072 keys 软限；控制操作采用现有 4 MiB / 4096 keys 硬限。阈值有命名常量和注释，不用正文字符数替代。
- [ ] 相同 key 命中先于新增长限制；保留旧合法大状态读取、合法 no-op privateDeletion 和多 grants 删除语义。
- [ ] 构造接近边界的合法累计 fixture，再执行一次真实 mutation。断言拒绝后没有新 blob/commit/key，旧状态、readFence、冷重开仍可用。
- [ ] 覆盖中文/emoji 的 UTF-8 大小、bytes 与 key count 两种耗尽路径、软限后的控制余量、旧近硬限状态和最终硬限拒绝。

**定向命令：** `node --test --test-concurrency=1 --test-name-pattern='R2[2-5]' test/rp-global-recovery.test.mjs`。

**提交建议：** `fix(rp): preflight global envelopes before publication`。

## T6：全局 seal 恢复和持久化阶段

**依赖：** T5。对应 I7；验收 R26—R29。

- [ ] 连续注入两次 seal rename 失败，第二次使用新 key。旧实现会形成两个未封存头；新实现不得追加第二个 commit。
- [ ] writer lock 内 load 后先补当前合法头 seal，再进入下一 draft。先检查已有同 key 的 effect 冲突，修 seal 不应绕过权限。
- [ ] 追踪“commit rename 是否完成”的明确阶段，映射 persistence_failed / persistence_uncertain；不要把任意 fs 异常变成 invalid_record。
- [ ] 同 key、同完整输入重试：完成 seal/purge 并返回原结果；不重复追加、不消耗新 key。同 key 改 expected/body 等仍按已有 effect 规则冲突。
- [ ] tombstone + seal 之后才 purge；失败 purge 可重试。权限变化时不能用旧 approval 绕过当前 grant。
- [ ] 损坏链继续拒绝，显式 writer lock 恢复也不能偷偷修复两个未封存 commit 或伪造历史。

**定向命令：** `node --test --test-concurrency=1 --test-name-pattern='R2[6-9]' test/rp-global-recovery.test.mjs`。

**提交建议：** `fix(rp): seal the accepted global head before appending`。

## T4b：实际记录回执和 host journal v2

**依赖：** T1、T2、T4a、T5。对应 I1、I5、I10；验收 R18—R21、R37。

- [ ] 为 search/get 成功 Result 添加私有 evidence 关联；`RetrievalEvidence` 使用稳定 view fence、实际记录 refs 和成功 Result 的 canonical 哈希。
- [ ] 将内部 proof 获取/验证保持在宿主模块边界。模型工具参数、可序列化公开返回值和任意用户对象都不能签发 proof。
- [ ] 通过现有 exec.callId 和精确 agent identity 连接 execute 与 wrapper；私有 pending 表同时核对 owner、generation、packetId、结果文本哈希。
- [ ] 增加工具返回到 receipt 保存之间 retcon/删除/替换文本的 latch；拒绝用新的 fence 为旧正文生成回执。
- [ ] 实现短临界区的 receipt 验证及原子 journal 发布，不在该区等待 next、外部 verification、队列尾部或再次取 coordinator。
- [ ] 抽出 `host-journal.ts`，定义 schemaVersion 2 和可区分的 packet/tool-call/retrieval-result/status/error frame。检索帧强制 evidence；status/error 只允许宿主生成的受限元数据与空 records，错误正文使用固定错误码/安全文本。
- [ ] v2 journal 对完整 envelope 使用 T5 的相同可表示性/字节上限预检；超限先拒绝，不能把原来可读的 host journal 写坏。status/continue-clean 仍可处理这种失败。
- [ ] session/event 将 receipt proof 保留在对应 frame；certify 对实际 summary/state/source/event revisions 逐条验证。普通 tool-call frame 不冒充已读事实。
- [ ] v1 通过校验后分类：明确没有工具历史可原子升级并保留原字节备份；任何旧 receipts/frames/原生工具历史无法证明时 recovery-only，只用 clean root 续接。
- [ ] 修改启动扫描和 resume，使合法 v1/v2 都能读取；不批量迁移、不用当前记录回填旧 proof。v2 新格式不得误进旧 v1 schema 校验。
- [ ] 覆盖存储重开、同 callId 跨 agent、过期 generation、伪造 proof、JSON 相同但对象非本次 Result、verification 后变化、保存失败和 close 清理。

**定向命令：** `node --test --test-concurrency=1 test/rp-host-receipts.test.mjs`。

**提交建议：** `fix(rp): persist verified retrieval dependencies in host journal v2`。

如变更较大，可拆“内部 proof 通道”和“宿主适配/迁移”两个提交；中间提交不发布 dev.3，不临时开放旧回执认证。

## T7：候选完整锚点集合校验

**依赖：** 无。对应 I8；验收 R30—R32。

- [ ] 新增 129+129 不相交 anchors 的 chapter proposal；必须在保存前失败而不是生成不可读 pending。
- [ ] 提取 MAX_EXACT_ANCHORS；合并后按完整 span 去重，验证实际数量、来源、hash 和 UTF-16 边界，再持久化。
- [ ] 验证恰好 256、重叠去重后 256、257、中文与代理对、被删除来源；拒绝不能留下新 candidate blob 或 metadata。
- [ ] 对既有超限候选提供解释性拒绝/可丢弃重建路径，不静默截断内容。

**定向命令：** `node --test --test-concurrency=1 --test-name-pattern='R3[0-2]' test/rp-summary.test.mjs`。

**提交建议：** `fix(rp): validate merged candidate anchors before persistence`。

## T8：批量 retract 原子化

**依赖：** T3 后实施便于复用失效验证。对应 I9；验收 R33—R35。

- [ ] 两个同样初始化的分支分别提交 `[A,B]` 与 `[B,A]`；显式目标都应 retracted，后缀 pending_replay 且不得覆盖 targets。
- [ ] 先统一校验目标，再计算 target set / suffix set，最后一次生成 bindings 并提交。不要在遍历过程中变更后续校验所用状态。
- [ ] 覆盖混入非法目标整批无提交、重复目标按既有 schema 规则处理、控制记录不被误当剧情后缀、同完整输入同 key 重试。
- [ ] 不新增 `/rp retract` UI 命令，修复现有 canonical API 即可。

**定向命令：** `node --test --test-concurrency=1 --test-name-pattern='R3[3-5]' test/rp-branch.test.mjs`。

**提交建议：** `fix(rp): apply batch retractions from one immutable ledger view`。

## T9：fixture 引用支持与事实绑定（可单独延期）

**依赖：** 无；不阻塞运行时修复。验收 R36。

- [ ] 在同一原文含“蓝眼睛/灰外套”的 fixture 中，用灰外套 quote 支持蓝眼睛事实，建立必须扣分的负例。
- [ ] 每个 fact 增加人工允许 quote 列表（sourceId + exact quote）；引用须匹配该 fact 的允许项且原文存在。不把任意 substring 当证据。
- [ ] 保留原来的精确事实匹配、attribution 等独立指标；版本化为 rp-exact-annotation-fixture/v2，明确固定标注而非通用蕴含评测。
- [ ] 正确 quote 正例、跨 source、空 quote、错误 quote 全覆盖。报告仍声明 fixture、modelGenerated=false、live 未运行，不把固定输出当实测模型质量。

**定向命令：** `node --test --test-concurrency=1 test/rp-evaluation.test.mjs`。

**提交建议：** `test(rp): bind fixture citations to annotated facts`。

## T10：版本、集中验收与交付

**依赖：** T1—T8。验收 R38—R40；T9 未做须标注。

- [ ] 更新 README、narrator/sdk/summary 文档：新错误码、关闭/恢复行为、容量边界、host journal v2 和回退限制。保持自动摘要/strict POV/native compaction 关闭说明。
- [ ] 将 npm 版本调整为 0.1.0-dev.3，更新 lockfile 包版本而不顺手升级依赖；由现有 build 生成正确 SOURCE-MANIFEST，不手写“已验证”字段。
- [ ] 先审查 diff，排除用户 profile、临时 journal、测试正文、node_modules 和审查临时脚本。
- [ ] 运行以下集中验收，每个命令独立、串行执行并保存退出码：

```bash
npm run typecheck
npm run build
npm test
npm run evaluate:fixture
npm pack --dry-run
```

- [ ] 若 T9 延期，fixture 命令仍可检查原评测是否回归，但报告必须保留 v1 局限。首次全量的 A22 或其他失败不得只靠换目录后一个通过就记为全量通过。
- [ ] A22 若再出现 store_locked，先调查锁是否来自存活 writer、测试自身共享目录、遗留失败、路径身份或宿主文件系统；只在证据明确后修改。不要自动 rm 任意 write.lock。
- [ ] 精确 SDK + 合成 terminal 测试必须覆盖启用/禁用、恢复、closing、旧 journal、双加载顺序；若最终包混装还未跑，明确列为未验证，不宣传兼容任意版本插件。
- [ ] 若发行说明声称支持工程 companion 的组合，使用最终 TGZ 在独立临时宿主 profile 测一次精确版本组合，记录 bundle hash、SDK 和加载顺序。没有条件就缩小兼容声明。
- [ ] Node 22 是基准运行线。Node >=22 的宽泛声明、Windows 目标环境等要保留已测/未测边界；不把 Linux 合成测试当作完整跨平台宿主证据。
- [ ] 写 RESULTS.md：每个 R 编号通过/失败/未运行，命令、版本、退出码、覆盖范围。只需一次面向这些实际风险的最终审阅，不重复泛化测试轮次。

**交付内容：** 独立小提交、必要测试、dev.3 包与 manifest、兼容/迁移说明、实际验收结果和未覆盖项。交付给用户审阅，不自动发布。

## 计划自检

每项要求均映射到验收编号；关键调用顺序和新增类型已明确；容量的有限边界和旧 journal 的迁移限制已写明。实现中可以微调函数名或抽取方式，但不能把关键未决判断留给默认放行，也不能以扩大功能范围替代修复上述缺陷。
