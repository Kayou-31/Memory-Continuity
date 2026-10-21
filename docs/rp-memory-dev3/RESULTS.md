# DSH RP Memory 0.1.0-dev.3 实际执行报告

执行日期：2026-10-20（America/Tijuana）；日志保留 UTC 时间戳。此文件记录实际执行，不把方案文件当作通过证据。

## 基线和环境

独立仓库 Kayou-31/dsh-rp-memory 初始工作区干净，本地 HEAD 与重新 fetch 后 origin/main 均为 `4272dd98ed40afb0b3bb162014c97da0fd49e242`，没有后续修复被覆盖。开发分支 `fix/rp-memory-dev3`。沿用 `D:/Codex/2026-10-20/https-github-com-kayou-31-dsh/work/rp-memory-021-public`，没有迁移旧环境；ZIP 的四份缺失 docs 已合入，无关文件保留。

Windows x64，D 盘 NTFS。PowerShell OSVersion=10.0.26200.0，npm 日志 OS=Windows_NT 10.0.26300；不扩展解释为具体系统发行版。测试/构建子进程 Node **22.23.3**（完整测试 evidence.json 已记录）；npm **11.16.0**。最初系统 npm.ps1 的前端实际使用 Node 24.18.0，打包恢复时明确由 Node 22 启动同一 npm-cli。TypeScript 5.9.3、esbuild 0.25.12、DSH native peers 0.2.1-rc.2、Cordis 4.0.5、Schemastery 3.18.5、session format 4。原生验收增加 loader 1.0.6 和同版 agent-loop/commands/projection/jsonl persistence 开发依赖，既有直接依赖未升级。

一个代码执行者、一个只读审阅者，无递归代理；重型进程串行；未设任意低内存上限。没有 push、发布或覆盖稳定版本，没有真实/付费模型调用。原生验收使用独立临时 profile、本地合成 terminal 和网络 guard，相关网络日志为空。

接口预检：T1/T2 共用 Bound/queue；T3/T8 共用失效闭包；T4a/T4b 共用稳定检索视图；T5/T6 共用全局事务入口；T4b 依赖 T5 完整 envelope 检查。

## 修改文件、原因和回归

| 任务 | 实现文件 | 改动及回归 |
|---|---|---|
| T1 | `admission.ts`、`session-policy.ts`、`rp-plugin.ts` | opaque owner、真实 options ticket、stamp 与根 guard；先 retire 再独立 block；锁外等队列；安装失败回滚 reservation。`rp-host-lifecycle.test.mjs` |
| T2 | `rp-plugin.ts` | status/continue-clean 先分流，独立授权/fence、空历史 clean root、失败清理、ambiguous 不重发。生命周期/journal 回归 |
| T3 | `store.ts` | 中央固定点闭包反复传播失效事件来源，失效 source-only summary、上层 DAG/cache，保留原来源与独立分支。`rp-summary.test.mjs` |
| T4a | `retrieval-index.ts`、`retrieval.ts` | fence A/B 稳定视图、ranking/分页/get/verification 复验；固定结果及 canon/权限/revision 校验。`rp-retrieval.test.mjs` |
| T4b | `retrieval-evidence.ts`、`host-journal.ts`、`retrieval.ts`、`rp-plugin.ts` | Result/authority 私有证明、实际 refs/hash、SDK token/caller/callId/generation/packet/渲染正文；journal 尾部预留与 CAS；v2 provenance、v1 受限迁移。`rp-host-receipts.test.mjs` |
| T5 | `schema.ts`、`types.ts`、`global.ts` | capacity_exceeded；完整 UTF-8 envelope 3/4 MiB、3072/4096 keys 预检；draft 先验后写 blob；host v2 同样限额。`rp-global-recovery.test.mjs` |
| T6 | `global.ts` | 先补旧 seal、核对 seal 对应链 hash；区分 rename 前后错误；冷重开同输入幂等恢复。全局恢复回归 |
| T7 | `schema.ts`、`candidates.ts` | 完整 span 去重后统一 256 校验；258/257 提案拒绝，去重256可 get/adopt。摘要回归 |
| T8 | `canonical.ts` | 原 ledger 统一验证 targets、suffix 排除显式目标，一次提交。`rp-branch.test.mjs` |
| T9 | `scripts/benchmarks/rp-memory.mjs`、`benchmarks/rp/golden.jsonl` | factId/精确元组对应人工允许 sourceId+quote；固定标注 policy/corpus v2。`rp-evaluation.test.mjs` |
| T10 | README、narrator/sdk/summary/evaluation docs、MIGRATION、package/lock、UPSTREAM、SOURCE-MANIFEST | dev.3、开发测试依赖、兼容/回退边界；UPSTREAM 旧映射标明为历史，当前源码哈希由实际 build 生成 |

上表实现文件均在 `src/rp/`。新增一个 `test/fixtures/rp/native-host.mjs` 复用真实 AgentLoop/CommandRuntime/SystemPrompt/ToolRuntime/LlmRuntime 与 JSONL 持久化；本地合成 provider 没有替换原生服务。后台摘要、strict POV、原生压缩、自动采纳均未开启。

## 失败回归到通过的实际命令

下表 `node --test` 均带 `--test-concurrency=1`；日志位于仓库 `work/dev3-logs`，交付中一并归档。退出码是子命令真实退出码。

| 命令/阶段 | exit | 日志 |
|---|---|---|
| `node --test --test-concurrency=1 test/rp-host-lifecycle.test.mjs` T1 | 1 → 0 | `T1-red3.log` 预期blocked实际rp；`T1-green.log` |
| 同文件新增T2 R06/R07 | 1 → 0 | `T2-red.log`、`T2-green.log`；R08/R09补测 `T2-extended.log` exit0 |
| `--test-name-pattern='R1[0-3]\|A30' test/rp-summary.test.mjs test/rp-branch.test.mjs` T3 | 1 → 0 | `T3-red.log`（首红仅summary）、`T3-green.log` |
| `--test-name-pattern='R1[4-7]' test/rp-retrieval.test.mjs`，随后加入A22 | 1 → 0 | `T4a-red.log`返回旧event；`T4a-green.log` 3项；`T4a-deletion.log` exit0 |
| `--test-name-pattern='R22' test/rp-global-recovery.test.mjs`，随后加既有容量回归 | 1 → 0 | `T5-red.log`、`T5-green.log` |
| `--test-name-pattern='R26' test/rp-global-recovery.test.mjs` | 1 → 0 | `T6-red.log`错报invalid_record、`T6-green.log`；`T6-boundaries.log` 5/5 |
| `test/rp-host-receipts.test.mjs` T4b | 1 → 0 | `T4b-red.log`、`T4b-green2.log`、`T4b-extended.log`、`T4b-final.log` |
| `--test-name-pattern='R30' test/rp-summary.test.mjs` T7 | 1 → 0 | `T7-red.log`、`T7-green.log` |
| `--test-name-pattern='R33' test/rp-branch.test.mjs` T8 | 1 → 0 | `T8-red.log`、`T8-green.log` |
| `--test-name-pattern='R36' test/rp-evaluation.test.mjs`，随后全文件 T9 | 1 → 0 | `T9-red.log`、`T9-green.log` |
| 审阅追加：传递event来源摘要闭包 | 1 → 0 | `review-T3-red.log`、`review-T3-green.log` |
| 审阅追加：disposed/queue-save与receipt竞态 | 1 → 0 | `review-receipts-red.log` 两负例；`review-receipts-green.log` 15/15 |
| 审阅追加：失败安装reservation泄漏 | 1 → 0 | `review-install-red.log`、`review-install-green.log` |

最初两次T1因夹具的Session.append参数/surfaceOp错误各exit1，修正后才在T1-red3复现产品问题。T4b的fixture hash表达式及恢复后未准备packet前提也修正过，保留失败日志。R37首版容量夹具因反复序列化接近4MiB的JSON低效而主动中止，后改为一次计算padding；`T4b-boundary3.log` exit0。以上不作为产品通过证据，没有无限重试。

## 一次完整集中验收

`work/verify-dev3.ps1` 串行执行下列五条；`final-results.json` 保存开始/结束时间与退出码。完整suite来自一次运行，不是定向重跑拼接。

| 命令 | 首次集中运行结果 |
|---|---|
| `npm run typecheck` | exit0，`final-typecheck.log` |
| `npm run build` | exit0，TypeScript声明 + esbuild，`final-build.log` |
| `npm test` | **exit0；109 tests、109 pass、0 fail、0 skip；59.306秒**，`final-test.log` |
| `npm run evaluate:fixture` | exit0；12个固定样本、policy/corpus v2、modelGenerated=false、live not-run，`final-fixture.log` |
| `npm pack --dry-run` | **首次exit -3，Z_DATA_ERROR**，`final-pack-dry-run.log`，不能称为首次五项全绿 |

pack失败后的真实npm栈指向tar内容读取器，系统npm.ps1前端实际使用Node24.18。独立pacote生成归档后，用Node24与Node22的原生gunzip和同一npm tar reader均检查成功。没有证据把源码/下载本身判为损坏，也没有证明Node24必然失败。诊断在`pack-node24-diagnosis.log`，首错保留。

明确由Node22.23.3启动同一npm-cli，执行`pack --dry-run --cache work/npm-cache`，**exit0，73文件**；`pack-dry-run-node22.log`、`pack-node22-result.json`。这是打包的单独重跑，109/109结论只来自上表完整运行。

## 安装/工具失败记录

- 初次git fetch因127.0.0.1代理不可用失败；本命令级`git -c http.proxy= -c https.proxy= fetch origin`成功，没有改全局配置。
- 最初typecheck exit1，依赖副本缺Windows tsc垫片。`npm rebuild --ignore-scripts --bin-links=true --cache work/npm-cache` exit0。其后live()类型和一个隐式any各被类型检查发现并修复，最终exit0。
- 原生开发测试依赖首次离线安装exit1，Z_DATA_ERROR/ENOTCACHED；随后同精确版本联网安装，关闭本进程代理、禁止fetch自动重试，exit0、增加19包、audit 0 vulnerabilities。日志`native-test-dependencies*.log`。安装访问npm，测试没有网络调用。

## 验收覆盖及未验证子项

“通过”仅指列出的断言，不表示矩阵中所有调度或故障排列已穷举。

| 编号 | 实际证据及边界 |
|---|---|
| R01–R05 | 原生EIO/多绑定close、活动流、重复close、mode-only拒绝、真实options正例、opaque owner/stamp/复制options隔离、重复/失败安装恢复通过；每种disposer/block异常与工程companion两加载顺序未穷举 |
| R06–R09 | 失败队列诊断/业务拒绝、空历史同branch clean root、创建保存失败、ambiguous不重发、损坏journal无可信branch及显式branch独立授权通过；创建中权限/fence变化全调度未穷举 |
| R10–R13 | source-only scene早于event、chapter/arc/cache、原source/兄弟分支/幂等/冷重开、直接invalidatedIds与传递event来源失效通过；correction复合图及原生整包组合未穷举 |
| R14–R17 | 组装途中retcon/隐私删除拒绝旧event；A22固定23/7页、无关新增不混入、跨authority/撤回cursor、分段及原有UTF-16回归通过；外部进程全部调度未穷举 |
| R18–R20 | 实际refs/hash、渲染替换、返回后retcon、Result复制/authority冒用、真实store中summary/state依赖复验和无关append、验证暂停时disposed及queue/save竞态通过；未称为所有模型多轮组合已跑 |
| R21 | 无工具v1备份升级、有工具v1 recovery-only、损坏拒绝、合法v2和clean root通过；备份/升级每一I/O故障点、所有历史形态未穷举 |
| R22–R25 | envelope软限、近硬限控制拒绝、旧读取/冷重开、count limit、无新增blob、同key超软限重试通过；逐字节精确边界、Unicode key/多scope全组合未穷举 |
| R26–R29 | 连续seal EIO最多一未封存头、同输入冷重开/改body冲突、blob/commit前及rename后阶段、错误seal hash/两未封存commit拒绝和既有purge回归通过；断电/所有OS持久化故障未测 |
| R30–R32 | 258/257提案拒绝、无新增candidate metadata、完整span去重256可读/采纳及既有hash/来源/代理对回归通过；历史超限候选全部形态未穷举 |
| R33–R35 | 两固定子分支[A,B]/[B,A]一致、显式目标优先、非法整批无提交、同输入重试、父分支保留通过；不新增retract UI |
| R36 | 同源错引文、正确/空/不存在引文及原有false-sourced/归属/POV回归通过；12样本仅固定标注scorer验证，不能当真实模型语义质量 |
| R37 | 近4MiB合法v2恢复后新receipt超限，旧字节保留、capacity_exceeded、status/clean root可用通过 |
| R38–R39 | 默认关闭/未支持能力拒绝及隔离回归在完整109项通过；type/build/fixture exit0，pack首错与恢复分列 |
| R40 | 工程companion最终TGZ两加载顺序未运行，不扩大混装兼容声明。单独RP最终包补测见下节 |

一次只读审阅发现的传递摘要闭包、receipt串行化/提交CAS和失败安装reservation问题均先红后绿修复。未安排第二轮泛化审阅。branch/global v1保留，host v2仅受限升级；v1未认证工具历史recovery-only。dev.2回退需原字节备份/新root，不能改版本号冒充迁移。详见MIGRATION.md。

## 性能和未运行范围

实现仍完整重放账本/重建检索授权视图，A22定向约26秒、完整suite约59秒，不是生产吞吐/p95基准。控制容量有限，达到硬限后不能无限写操作；长期容量治理需要另立迁移/compaction协议。未验证真实模型语义质量、付费调用、桌面完整UI、长期运行、断电耐久性、其他OS/Node全版本、跨SDK用户历史迁移或任意插件混装。忽略AbortSignal的provider不能被强制结束，关闭前已发送网络数据不能撤回。

## 最终包补充记录

SOURCE-MANIFEST由实际build生成。最终TGZ、源码ZIP、修改patch、日志和交付哈希清单写入本次会话outputs；不将包自身哈希写进包内报告以避免自引用。实际pack及最终bundle验证结果在生成后补记。

补记：`node22 npm-cli.js pack --json --pack-destination work --cache work/npm-cache` 实际exit0，首份TGZ 365,312字节、73文件（`actual-pack.json`）；系统tar解包exit0。随后将原生生命周期夹具的安装函数替换为**这份TGZ解出的lib/index.js**，运行 `node --test --test-concurrency=1 work/final-package/lifecycle.test.mjs`，**10/10通过、0失败、0跳过，exit0**，包含实际包默认禁用、异常close/准入、活动流、重复/失败安装、故障诊断、clean root和ambiguous输入。本次补测仍不包含工程companion组合。

被测试TGZ入口与本地构建入口SHA-256一致。纳入本报告补记后仅重新打包文档，最终交付包逐条核对包内manifest/src/lib哈希并与已测入口比较；最终TGZ字节数和SHA-256记录在外部 `delivery-manifest.json`。没有用源码测试代替这10项实际bundle测试，也没有把10项补测拼接进前面109项完整suite。

实现提交：`a97eaf24cc25881827a55b0d699a24c880a9724c`。交付HEAD另含方案/结果/迁移文档提交，精确HEAD在外部交付清单；均只在本地，没有push。

## 交付状态

- **已完成：** T1–T8核心实现与先红后绿回归；T9固定事实引用绑定；T10版本、独立构建/类型检查、一次109项完整suite、fixture、成功dry-run和实际TGZ及10项原生bundle验证；源码/日志/patch/哈希交付。
- **未完成的扩展验收：** 上表每行列出的额外故障/排列未全部穷举，尤其工程companion最终包双加载顺序R40。不能将此报告宣称为全部R矩阵子情形已完成或任意混装兼容。
- **未验证：** 真实模型质量、日常用户profile迁移、跨SDK、桌面完整UI、长期运行、断电和其他OS/Node全版本。自动功能继续关闭。push/Release/npm发布按任务约束未执行。
