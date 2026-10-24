# 后续开发入口

2026-10-24 的 Memory-Continuity 0.2.0-dev.3 后端补充见 [M5 后端报告](../rp-memory-m5/BACKEND-RESULTS.md)，中文指令见 [COMMANDS](../COMMANDS.zh.md)。以下历史结果保留，不将旧版本结果改写为新版本实测。

# Ultra-RP-Memory 实际执行报告（dev.3 至 0.2.0-dev.1）

## 2026-10-24：Memory-Continuity M5

项目在本轮本地开发版更名为 Memory-Continuity。M5 的完整命令、单次 229/229、回归失败与修复、真实包验证及剩余边界单列于 [M5 RESULTS](../rp-memory-m5/RESULTS.md)；纯功能前端交接见 [功能需求](../rp-memory-m5/FRONTEND-HANDOFF.md)。以下历史记录保留，不能替代 M5 验证。

## 2026-10-23：0.2 预览版发布前完整复审

用户已明确授权：重新完整审查 0.2，确认无阻塞问题后合并并发布预览版，附插件及完整源码，中文说明并保留已知问题和未验证项。下文历史“未合并／未发布”仅描述当时状态。

基线 main `d114b91ad8942742717a3c21890caba9658e3a93`，审核起点 `fabf9b65757f62ea39b77cb913bc34294e99920e`。一个修改执行者、一个只读审阅者，未递归代理，重型任务串行；没有安装依赖、付费模型调用或日常数据迁移。GitHub 当时无 CI 检查，PR 可合并。具体审阅范围、发现、裁定见 [发布审查报告](RELEASE-0.2-REVIEW-2026-10-23.md)。

新增确认并修复 **1 个 P2**：公开 `canonical.applyControl` 的人物协议入口可绕过人物草稿的已配置实体检查。`src/rp/canonical.ts` 对人物起点 actor 与字段 subject 检查同一实体集合；普通旧事件与存储格式不变。`test/rp-person.test.mjs` 新回归先失败（未知人物返回 `ok:true`，退出码 1），修复后整文件 **5/5、退出码 0**；拒绝时 fence 和有效事件均不变。`SOURCE-MANIFEST.json` 由重新构建生成。唯一只读审阅者复核修复后无剩余已确认的 Critical／Important 阻塞；这是预览范围的审查意见，不是无缺陷证明。

修复前已经串行跑过一轮完整 213/213 与旧包 31/31，保存在 `evidence/release-0.2-preview/before-fix/`，**不作为修复后验收**。修复后重新从头执行全部六命令，开始于 **2026-10-23 14:11:09 UTC**，本轮日志在 `evidence/release-0.2-preview/final/`：

| 实际命令 | 退出码 | 本轮结果 |
| --- | ---: | --- |
| `npm run typecheck` | 0 | TypeScript 类型检查 |
| `npm run build` | 0 | 独立构建、声明、离线编辑器、源码清单 |
| `npm test` | 0 | **214/214，0 失败／跳过／取消，112.12 秒；单次完整运行** |
| `npm run evaluate:fixture` | 0 | 固定标注规则，无模型调用 |
| `npm run evaluate:life` | 0 | 四类故事 4/4，120 段干扰，两个证据对照；75.06 秒，进程 maxRSS 107768 KiB |
| `npm pack --dry-run` | 0 | 215 文件；后续实际包加入发布审查报告和公开证据，另作实际解包验收 |

环境：Node **22.23.3**（V8 **12.4.254.21-node.57**）、npm **11.16.0**、TypeScript **5.9.3**、esbuild **0.25.12**；DSH **0.2.1-rc.2 / session format 4**、Cordis **4.0.5**、Schemastery **3.18.5**。可选工程组合仅为 Ultra **0.6.1-dev.rp.1**、Memory／Decision **0.1.1-dev.rp.1**。

最终实际包由 `node work/person-m4-2026-10-23/pack-artifacts.mjs release-reviewed` 生成，退出码 **0**；实际 npm pack、目录列表、解包、96 项清单与当前源码／lib／ui 的逐项校验均成功。包为 **236 文件、826602 字节、解包 3044411 字节**，SHA-256 **30caccebceabc8c42dcf64c04219c96598bfb1f44f396da86754874286f07f8d**。先前 790429 字节审核包不作为本次发布包；新包包含实体白名单修复。打包后新增的最终说明与日志另附，不为更新包内报告再次压包。

设置 `RP_BUNDLES_ROOT=work/person-m4-2026-10-23/release-reviewed`、`RP_PERSON_BUNDLE=work/person-m4-2026-10-23/release-reviewed/rp/package/lib/index.js`，运行：

```text
node --test --test-concurrency=1 scripts/host-acceptance/dev3-companion.test.mjs test/rp-person-host.test.mjs test/rp-modules-host.test.mjs test/rp-management-host.test.mjs test/rp-storage-host.test.mjs
```

实际 **退出码 0，31/31，0 失败／跳过／取消，16.12 秒**。覆盖独立运行、Ultra 双顺序及关闭优化、Memory／Decision 共存、原生会话和 JSONL 冷恢复、人物成长、模块约束、管理写入／关闭竞态、指定全局范围升级。实际 SDK 配合本地合成终端；仅管理测试允许回环 HTTP，其余网络仍拦截。另运行 `node work/release-02-2026-10-23/package-authority.mjs work/person-m4-2026-10-23/release-reviewed/rp/package/lib/index.js`，**退出码 0，1/1**，直接导入最终包的公开 `openRpMemory`，确认未知人物提交返回 `scope_denied`，分支及有效事件保持不变。此 1 项不拼入前述 31 项或完整 214 项。

发布目标为合并 PR #1 到 main 后的 **v0.2.0-dev.1 预览版**，中文发布说明、插件 TGZ、完整源码 ZIP、审查／验证／迁移报告、日志和校验值一并提供；不发布 npm、不覆盖历史发行附件。最终合并提交、上传校验与发布状态以 GitHub 页面和发行附件 `release-verification.json` 为准。

PR #1 已合并，合并提交 **2f9aae783511eb416c36ccdca4130f722056b64d**。已比较合并树与受审修复提交 **009b9ccc1c084e4f133f29820a70e7467e4972b2** 完全一致，tree 为 `fdbf774d8b329d7ca32c7d6b79bfc2d220f65a96`；本地 main 已快进。合并后只追加发布验证文档和日志，不更改受测生产代码。

**源码 ZIP 追加验证及失败保留：** 从合并提交生成源码 ZIP，解包后全部 **255 个跟踪文件** 与原提交 SHA-256 一致，复用已锁定的本地依赖目录（目录连接，未安装依赖），在独立解包目录使用同一 Node 22.23.3／npm 执行类型检查。首次 `npm run typecheck` 进程异常退出 **-1073741819（0xC0000005）**，只留下 tsc 启动信息、没有 TypeScript 错误诊断；后续 build 未执行。核对源文件、tsconfig 和启动脚本后，未更改源码、依赖、运行参数或内存限制，仅作一次同命令复验，**typecheck 退出码 0**，随后 **build 退出码 0**；重建后的 SOURCE-MANIFEST 与原构建逐字节一致。此失败根因仍未知，不把复验当成首次成功，也不归因为 Node/V8/硬件。它作为新增的工具链稳定性限制保留，日志在 `evidence/release-0.2-preview/source-archive/`。没有在缺少 Git 历史的源码解包目录伪称跑过完整测试；完整 214/214 来自前述仓库运行。最终源码归档仅追加这些文档和证据，生产源码保持已验证内容。

发布准备另有两项非产品命令失败：首次暂存差异检查发现公开日志末尾空行，归一化后通过，原始日志未改；一次 PowerShell 中未加引号的 Git tree 表达式解析失败，加引号后确认 tree。两者均未进入测试结果计数，也未修改生产实现。

只读审阅者追加检查后认为，源码归档进程异常没有形成新增已证实的代码阻塞；首次失败及唯一一次复验分别保存在 `source-build-audit.json`。首次命令精确起止时间未捕获，只保留日志修改时间和实际工具返回的退出码。此异常与此前存储描述符异常不合并归因。发布时继续标为预览版，保留两项已知稳定性风险。

**发行附件额外校验：** 追加文档后，一次 Git 默认压缩的源码 ZIP 中 `LUNA-RESULTS.json` 与源文件哈希不符；独立 Python 3.13.15 读取确认 `Bad CRC-32`，两项检查均 exit 1，损坏 ZIP 已隔离保留、不上传。工作区干净，该文件与 HEAD 的 Git 对象相同；`git fsck --no-reflogs --full` exit 0，无损坏对象。停止使用此次默认压缩流程，改用 `git archive --format=zip -0` 保存原始内容；同提交的 264 个源码文件及 90 个证据文件通过完整内容／CRC 校验，exit 0。归档异常根因仍未知，不归因为硬件，也不与其他异常合并归因。最终包含本记录的归档重新验证，准确文件数和哈希见发行附件；插件 TGZ 保持已验收原字节。另一次证据 ZIP 生成命令因 PowerShell 内联路径参数解析错误 exit 1，先单独计算参数后修正；没有更改产品代码。原始差异、独立读取结果与替换策略保存在 `source-archive/archive-packaging.json`。

兼容与迁移：继续独立包和 `sessionMemoryPolicy/v1`；branch/global 语义记录 v1、journal v2 保留。人物工作区启用前备份并要求新版；全局分段需人工明确启用、先备份校验，旧读取器拒绝新布局，禁止混用旧写入者。不对未经认证工具历史补造证明；更名不自动迁移数据，替换入口时避免新旧包同时启用。

**保留的已知问题：** 历史首次完整测试 212/213 的对象描述符异常根因仍未确定，本轮未复现、不宣称已修复；全历史扫描仍有成本，游标尚无容量淘汰，未引用分段页不自动回收，独立备份不随在线隐私删除清理。控制硬上限也会拒绝新事务。没有自动摘要、压缩、自动采纳或自主行动。

**未完成／未验证：** 完整用途产品、技能学习、多人物社会、自主生活、分支持久索引及更长历史界面仍未完成。最终界面长 ID 换行／清空选择器的浏览器复查仍受历史崩溃阻断；真实模型长期语义、多日运行、真实断电、生产配置迁移、其他 OS／Node 和其他 Ultra 版本仍未验证。M4 标注成绩不是模型语义质量。

## 当前追加：2026-10-23 M4 与产品化

以下历史段落按执行时点保留。M0–M3 已推送 PR #1（9eda3d0）；后文历史“未 push”不是当前 GitHub 状态。

M4 已完成离线范围：`scripts/benchmarks/person-life.mjs` 复用实际 core，在120段干扰经历下运行人物/情境、定向关系/承诺、Retcon/隐私/分支、模块撤销/冷读四类故事，4/4断言通过。`life-report.json` 记录 72.28秒、maxRSS 117432 KiB（单样本整个进程），不是吞吐/p95。相同故事的三个证据窗口：有效记忆3/3、最近8条0/3、未过滤存档3/3但暴露撤销证据；这仅为3项标注证据可用性，不是模型回答或人格质量。

`test/rp-life-evaluation.test.mjs` 先因缺scorer RED，完成后2/2；同source无关句子、错误revision、未返回证据、错误事实、重复断言分别处理。真实SDK新增 `test/rp-life-host.test.mjs`：12次干净续接保留人物、重建宿主、停用模块后下游不再收到请求，1/1。所有输出为本地合成Terminal，网络guard启用，无付费调用。

证据：`work/person-m4-2026-10-23/commands.jsonl` 和对应日志。life-first exit1（评测脚本错误使用Result包装模块API），查实际接口后修正，life-corrected exit0；life-host首次exit1（测试fixture的drop不能释放插件创建的root），改用实际session flush和宿主销毁，life-host-corrected exit0。未降低生产校验。此处不代表最终全量通过，最终命令另记。

统一管理完成：`person/management.ts` 复用人物/Agent 核心，服务端保存预览与原始 fence；`management-server.ts` 提供仅手动打开的回环 HTTP 服务；`manager-ui.ts` 提供人物、经历/时间线、关系/目标、成长审阅和用途规则面板；`rp-plugin.ts` 负责实际会话生命周期。`/rp person manage` 打开，`manage-close` 关闭；无轮询、自动采纳或模型调用。界面更换查看人物不自动改变聊天绑定，用途/规则在此只读，旧经历超过最近200条需使用核心查询。

新增 `rp-management.test.mjs`、`rp-management-server.test.mjs`、`rp-management-host.test.mjs`。先保存缺服务/命令的RED，后完成实际核心与原生SDK闭环。只读审阅五项均先复现再修复：快照对象别名、撤权后的提交竞态、已发布但回执丢失的重试、独立写入者与候选提案竞态、打开监听器时关闭入口。`publication-guard.ts` 在真正发布临时文件及 rename 前复验权限，已提交事务仍完成 seal；已经发送给文件系统的 rename 不能事后撤销。新增的原始 fence 参数使提案/拒绝在核心读视图中复验。

`management-review-green` 9/9、`manager-final-typecheck` exit0、`manager-related` 37/37 exit0（相关人物/模块/生命周期和管理测试）。这是定向验证，最终全量另列。首次管理typecheck有两处类型错误、原生HTTP首轮被原有禁止所有网络guard挡住，日志均保留。验收guard默认仍禁网，只有显式 `RP_ACCEPTANCE_LOOPBACK=1` 允许127.0.0.1 HTTP，不允许外部地址/HTTPS/DNS查询。

实际浏览器在临时测试profile完成：创建林澈、钟楼救援经历、成长提案与人工采纳、erin→bea定向关系、承诺建立/暂停、关闭入口。证据为 `manager-browser.png`、`manager-browser.txt`；服务已经关闭。所有故事为合成测试数据，没有付费调用。

长期存储首期完成：`global-segments.ts` 与 `global.ts` 新增显式升级、先校验/备份/sync、按内容寻址的256KiB页、重建完整状态与全部历史校验；`rp-plugin.ts` 增加人工 storage-status/storage-enable。默认3/4MiB布局不变，升级后8/12MiB完整逻辑envelope；8192 publications、8192发布keys/12288控制keys。`schema.ts` 仅允许分段完整状态检查显式指定8192数组上限，其他输入默认4096不变。

`rp-global-segments.test.mjs` 先RED缺入口，后覆盖旧历史原件/备份、页重用、缺失/损坏/降级拒绝、备份故障、连续seal故障、8/12MiB边界、4097条记录与冷读。`rp-storage-host.test.mjs` 验证原生宿主按scope手动升级、不调用模型；`rp-person-compat.test.mjs` 使用实际旧源码构建reader，升级后读写拒绝，完整备份恢复后可读。只读审阅及自查补出备份未校验正文、文件sync、子文件ENOENT误吞、旧4096数组限制，均已修复；可触发问题保留RED日志，未更改v1的默认容量行为。

定向证据：`segments-related` 15/15 exit0（含旧global恢复/孤儿回归）；`segments-boundary` 1/1 exit0；`segments-old-reader` 1/1 exit0；`segments-count-red` exit1 → `segments-count-green` 1/1 exit0。最初3.345MiB边界单样本升级/追加/撤销约1.26秒、进程maxRSS201244KiB，17个页文件；这是隔离夹具且历史短，不是长期压测或保证。最终全量另列。

使用和回退说明见 `docs/person-studio-storage.zh.md`。备份含旧正文且不受在线隐私删除管理；没有完成manifest的目录不可信。孤儿页保留，不自动GC；全历史扫描仍存在。本轮没有触及日常profile、后台功能或付费API。版本正式提升0.2.0-dev.1，包名已为 @dsh-external/dsh-ultra-rp-memory；协议、配置节点与数据路径保留兼容名称。

首次集中验收（2026-10-23 13:33:17 UTC）typecheck/build exit0，完整测试 **212/213、exit1**，无跳过/取消。唯一失败是4097条存储回归最后读取阶段，返回 `store_corrupt: Global metadata schema corrupt: Cannot use 'in' operator to search for 'value' in [object Unknown]`。同一代码独立跑存储整文件7/7、随后同规模状态连续20次读取exit0，未能复现。没有改校验、降低数据规模或切换Node去掩盖错误；根因未确定，不宣称已修复，不能推断为磁盘或V8故障。首轮日志完整保留在final-verification，单独复验在segments-suite-diagnosis/descriptor-diagnostic。

GitHub仓库已正式更名 Kayou-31/dsh-ultra-rp-memory，仓库ID1427477600和PR #1保留；本地remote同步。没有修改main、发布npm/Release或覆盖旧附件。

第二轮从头串行执行于 **2026-10-23 13:37:49–13:41:00 UTC**，没有修改生产校验或测试内容，准确命令/时间在 `work/person-m4-2026-10-23/final-verification-2/commands.json`：

| 命令 | exit | 本次实际结果 |
| --- | ---: | --- |
| npm run typecheck | 0 | TypeScript检查 |
| npm run build | 0 | 独立bundle、声明、离线编辑器、SOURCE-MANIFEST |
| npm test | 0 | **213/213，0失败/跳过/取消，111.04秒**，单次完整运行 |
| npm run evaluate:fixture | 0 | 固定标注规则，未调用模型 |
| npm run evaluate:life | 0 | 四类4/4，120干扰，74秒，进程maxRSS103904KiB；3/3、0/3、3/3且带撤销证据的两个对照 |
| npm pack --dry-run | 0 | 0.2.0-dev.1包预检，161文件；实际包另列 |

最终浏览器复查尝试时内置标签页显示 `This page crashed`，其data:崩溃页被工具URL策略拦截；没有切换通道绕过。较早的真实浏览器创建/编辑/成长/关系/承诺流程和截图保留，但最后补的长ID换行与清空所有选择器未完成浏览器复查，不能标为已实测。临时演示Node进程已关闭，未留下自动服务。该崩溃根因未确定，不推断为插件或宿主缺陷。

实际打包：`node work/person-m4-2026-10-23/pack-artifacts.mjs final` exit0，npm pack后tar列表/解包/逐项hash核验，**210文件、96条manifest、790429 bytes，解包2849544 bytes**。比集中dry-run的161文件多出本轮公开审核证据；src/lib/ui均与本次构建manifest一致。TGZ SHA256 **092f72405f447de312b993ab4417eb54b80030c9315da6476b18fa63ef0b450c**。已测包保持该哈希，不为补末尾验收结论重新压包；最终RESULTS与源码ZIP另附。

设置 `RP_BUNDLES_ROOT=work/person-m4-2026-10-23/final`、`RP_PERSON_BUNDLE=work/person-m4-2026-10-23/final/rp/package/lib/index.js`，执行：

```text
node --test --test-concurrency=1 scripts/host-acceptance/dev3-companion.test.mjs test/rp-person-host.test.mjs test/rp-modules-host.test.mjs test/rp-management-host.test.mjs test/rp-storage-host.test.mjs
```

**exit0、31/31，0失败/跳过/取消，16.67秒**，日志actual-tgz-host.log。包括独立模式、Ultra前后加载、优化开关、Memory/Decision共存、实际原生会话/工具/JSONL冷恢复、人物/成长请求、管理创建编辑/采纳/关闭竞态、选定全局scope升级。为了确保关闭竞态用的是实际包，测试fixture增加已有RP_PERSON_BUNDLE环境选择分支；默认源测试行为不变，生产源码未改变。真实SDK搭配本地合成Terminal；仅管理页测试明确允许127.0.0.1，其他网络guard保持禁网。

环境仍为Node22.23.3/npm11.16.0/TS5.9.3/esbuild0.25.12，DSH0.2.1-rc.2/session4、Cordis4.0.5、Schemastery3.18.5；Ultra仅0.6.1-dev.rp.1，Memory/Decision仅0.1.1-dev.rp.1。未安装新依赖。源码ZIP可独立构建；完整suite的旧reader测试需要完整Git历史，实际工程组合测试还需要精确TGZ附件。

已测TGZ同时放入审核分支 `artifacts/0.2.0-dev.1/`，不发布Release/npm；最终交付在 `D:/Codex/2026-10-20/dsh-rp-memory-dev-3-https/outputs/ultra-rp-memory-0.2.0-dev.1-2026-10-23/final`，包含插件TGZ/ZIP、源码ZIP、证据ZIP、中文说明、最新RESULTS和SHA256。公开证据副本去除本机路径，原始失败记录保留，管理凭证/真实profile不上传。

Git push已成功：审核分支从9eda3d0推进至957e1d1，包含M4 a56706e、人物工作室77053da、分段与命名d35c820、构建/包/日志957e1d1；后续提交仅补交付文档状态。PR仍为 `https://github.com/Kayou-31/Memory-Continuity/pull/1`，main仍d114b91，没有合并稳定分支。最终源码归档的精确提交和各产物哈希记录在交付目录delivery-manifest.json/SHA256SUMS.txt。

**已完成：M4离线/宿主范围、统一人物管理与成长审阅首期、显式全局分段存储、更名和开发包审核交付。未完成：完整用途产品、技能学习、多人物社会、自主生活、分支持久检索索引及更长历史UI。未验证：单次间歇对象检查异常根因、最终浏览器复查、真实模型长期语义、连续多日使用、真实断电、日常profile迁移、任意Ultra版本。** 旧Luna/fixture不补足这些缺口；历史章节的“尚未M4/实时UI/分段”按当时时点保留。

执行日期：2026-10-20（America/Tijuana）；日志保留 UTC 时间戳。此文件记录实际执行，不把方案文件当作通过证据。

**更新：** 本文保留首次实现和 Luna 补验的历史结果；2026-10-22 的审查与 store 重构见“第二代审查与局部重构”和 [审查报告](REVIEW-2026-10-22.md)。之后用户确认新名称与独立使用定位，最新入口命名及验证见末节“Ultra RP Memory 命名与独立使用”。Luna 补验当时没有修改生产源码；此后重构和入口命名修改各自记录，没有开启任何自动能力。

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

## 首次交付时的状态（历史节点）

- **已完成：** T1–T8核心实现与先红后绿回归；T9固定事实引用绑定；T10版本、独立构建/类型检查、一次109项完整suite、fixture、成功dry-run和实际TGZ及10项原生bundle验证；源码/日志/patch/哈希交付。
- **未完成的扩展验收：** 上表每行列出的额外故障/排列未全部穷举，尤其工程companion最终包双加载顺序R40。不能将此报告宣称为全部R矩阵子情形已完成或任意混装兼容。
- **未验证：** 真实模型质量、日常用户profile迁移、跨SDK、桌面完整UI、长期运行、断电和其他OS/Node全版本。自动功能继续关闭。push/Release/npm发布按任务约束未执行。

## Luna 与原生宿主补验（2026-10-21 UTC）

用户明确授权后，在 `c8448e6` 基础上执行本节。没有改动 `src/`、生产摘要/压缩开关、存储协议或版本号。branch/global 仍为v1、host journal仍为dev.3的v2，迁移规则与MIGRATION一致；没有新增历史迁移、付费API、push或发布。此前原始交付文件保留，本节更新交付单独放在当前会话 `outputs/dev3-luna-followup/`。

### 实际代码、输入和执行边界

外部控制器直接 bundle 当前 `src/rp/memory.ts`。其实际调用链包含 observeSource → applyControl → summaries.propose/adopt → retcon/privacy_delete/fork → packets.prepare → retrieval.search/get。与此前最终TGZ（SHA-256 `62cbb39a7fa020abaf28eb84a1f5fad818418bd3a9868eb82aeecd45564cfcd2`）内22份src文件逐一核对，全部一致；不是手写一套相似存储来代替 dev.3。所有剧情、来源和密语都是合成测试数据，独立work profile未接触日常用户数据。

固定四场景：远期事实/人物关系方向、Retcon、隐私删除、兄弟分支。每个场景先生成一份摘要候选并在测试profile中显式采纳，再执行相关变更。生成12个完整近期轮次，实际packet保留最后8轮、16条消息。A组只获得这些近期消息；B组获得完全相同的近期消息，加上实际有效packet.text和预选的有界授权检索结果。不是自主检索评测，也不能把差异单独归因于摘要。

4个摘要任务和8个答题任务全部串行，逐个收到完成后才派下一个；均指定 `gpt-6-luna`、`low`、`fork_turns=none`。摘要直接给文本；答题仅准许读取指定prompt文件一次，随后禁止额外工具、写文件和创建代理。主执行者保存原始响应，没有为提高分数重跑、改写答案或事后修改金标准。另有第13个只读Luna任务审阅评分和证据边界，不计入实验样本，没有修改文件。

`LUNA-RESULTS.json` 保存所有12个实验任务的完整prompt、模型原始JSON、prompt哈希、实际packet/候选/检索输出、固定评分和人工审阅；`LUNA-PLAN.md` 保存预先方案与执行裁决。请求的模型路由有spawn参数证据，但底层实际请求数、token、费用、子任务完整工具审计、内部自动压缩事件没有导出，均不推算。共享工作区是软隔离，不能证明严格沙箱盲测，也没有宣称关闭了Codex内部压缩。没有连接新的付费模型API；Codex子代理消耗账号额度。

### 原始结果与没有通过的部分

每题只允许冻结金标准里的简短值；引文还须是对应记录内的连续原文，并包含该题预先规定的事实支撑片段。null只有在该题应拒答且无引文时计为合理拒答。不是用另一个模型给自己的答案打分。

| 场景 | 近期组正确 / 3 | 记忆组正确 / 3 | 记忆组严格引文支持或合理拒答 / 3 | 实际现象 |
|---|---:|---:|---:|---|
| 远期事实/关系方向 | 0 | 3 | 3 | 记忆组保留持有人、位置及双向不同态度；近期组均拒答 |
| Retcon | 0 | 2 | 0 | 回答琥珀色和林岚，没有回答旧蓝色；两条引用只给after值，严格支撑条件不满足；口令题拒答 |
| 隐私删除 | 1 | 3 | 3 | 两组均拒答已删除口令；记忆组保留独立来源的会合地点与船票持有人 |
| 分支 | 0 | 0 | 0 | 两组均拒答；记忆组未输出兄弟分支事实，但没有回答当前分支事实，不能视为语义保真通过 |
| **合计** | **1/12** | **8/12** | **6/12** | 原始分数包括1个应拒答题；其余11题中记忆组答对7题，严格引文支持5题 |

两组prompt合计为11,736与24,987 UTF-8字节。它们是输入文本字节数，既不是token数，也不是精确压缩率；两组输入量不同。单次、短合成场景、无重复抽样、无统计显著性，不代表真实长对话、其他模型或DSH provider质量。

**夹具和评价限制必须随分数一起读：** Retcon将口令放在通用`rule`字段，没有提供明确口令映射；分支把路线、凭据、队长分别放在同一个`key`实体的`location/inventory/identity`里，没有领域语义映射。控制器中的状态与兄弟分支隔离断言成立，但答题拒答不能单独归因于模型或产品缺陷。512 UTF-16字符的有界get可以停在半截JSON，payload位于截断前；本轮没有提供后续分页。下一轮需改进表达和分页，**本轮没有修完夹具再重跑来替换原始结果**。分支语义评测及Retcon口令题保持不确定/未充分验证。

4份摘要的核心旧事实均保留，但有额外语义偏差：Retcon摘要把“没有改变”写成“后续仍不确定”；分支摘要增加“无其他未决事项”的宽泛断言。结构校验接受来源和锚点不表示摘要自然语言已获全面认证。只读审阅确认评分为固定事实/引文条件，未发现需修改生产代码的问题，并明确支持上述隔离、夹具和宿主证据限制；无用户人工裁决声明。

实际控制器还断言：Retcon后旧摘要不在新packet；删除后原source不出现在search且get拒绝；分支变更后当前摘要失效而父分支摘要和兄弟分支自身状态保留。这些是实际代码机制证据，独立于Luna答题分数。

### 已补齐的原生宿主验证

真实解包加载RP最终TGZ，以及沿用dev.1原字节的Ultra `0.6.1-dev.rp.1`、Memory/Decision `0.1.1-dev.rp.1`。没有修改工程companion源码或TGZ。用实际Cordis/AgentLoop/CommandRuntime/Session/JSONL persistence/ToolRuntime/LlmRuntime与合成terminal，测试进程装载network guard，禁止真实模型网络访问。

- RP+Memory、RP+Ultra+Memory、RP+Decision+Memory各跑工程先加载和RP先加载，共6项：共享同一个`sessionMemoryPolicy/v1`，RP不进入工程memory，伪造/直接下游调用拒绝，真实认证input恰好进入terminal一次，disabled调用安全，continue-clean保留分支且空宿主历史，close后旧会话和新clean会话都不能旁路。
- 第7项启动两个全新Node进程：工程先加载时，RP disabled仍拒绝旧RP会话；重新启用后status可诊断、ambiguous输入不自动重发，continue-clean继承原分支且空历史。两个冷进程terminal计数均为0。
- 一次完整原生补验 **7/7、0失败、0跳过、exit0，2.484秒**，`host-companion-final.log`；不是把此前3项定向检查拼成7项。初始6/6以及后续包含冷进程的6/7失败均保留对应日志。

精确SDK的package.json在验收脚本中逐个读出并断言：DSH服务`0.2.1-rc.2`、Cordis`4.0.5`、Schemastery`3.18.5`。合成terminal验证的是宿主集成，不是Luna经DSH provider调用，也不是桌面UI验证。R40的这三个固定组合及两顺序已从首次报告的未执行更新为有证据；其它混装组合不扩展声明。

### 本轮文件与命令

| 修改/新增 | 原因 |
|---|---|
| `benchmarks/rp/luna-pilot.json` | 预先固定四场景、问题、正确值和事实支撑片段 |
| `scripts/benchmarks/luna-pilot.mjs` | 独立测试控制器；prepare/materialize/score；没有模型API路径、没有生产自动能力 |
| `scripts/benchmarks/luna-score.mjs`、`test/rp-luna-pilot.test.mjs` | 先红后绿的2项评分回归：同源无关引文、正确引文、虚构记录ID、重复答案拒绝 |
| `test/fixtures/rp/native-host.mjs` | 测试用安装前后钩子、指定真实bundle和冷启动目录；生产源码未改 |
| `scripts/host-acceptance/dev3-companion.test.mjs`、`dev3-cold.mjs` | 真实TGZ双顺序、准入/关闭/空历史续接及全新进程恢复 |
| README、sdk021/evaluation文档、LUNA-PLAN、LUNA-RESULTS、本报告 | 更新实际证据、模型失败和未验证项 |

Node **22.23.3**，npm **11.16.0**；其余构建/SDK版本沿用前文。本轮集中验收明确以Node22启动npm-cli，并将Node22加入子进程PATH，未安装/升级依赖、未设置低内存上限。`work/verify-followup.ps1` 的一次串行运行从 **2026-10-21 06:45:24Z 到06:46:30Z**：

| 命令 | 实际退出码与结果 |
|---|---|
| `npm run typecheck` | 0 |
| `npm run build` | 0，独立声明及bundle构建 |
| `npm test` | **0；111 tests / 111 pass / 0 fail / 0 skip；61.200秒，一次完整suite** |
| `npm run evaluate:fixture` | 0，原12个固定标注样本，仍不代表真实模型输出 |
| `npm pack --dry-run --cache work/npm-cache` | 0，75文件；与首次交付的打包错误分开记录 |

实际形式均为`node22 npm-cli.js ...`，`followup-results.json`含每条命令的起止时间和退出码。此后更新仅涉及报告/归档，最终包还会独立记录pack与bundle重放，不将这些定向验证加入111项计数。评分器首次退出1、修复后0；prepare首次退出1、修正夹具后的v2退出0；materialize、score、collect均退出0。

失败诊断：首次host测试错误地把Schemastery schema的调用结果当作原始配置再传给Cordis，volatile配置拒绝；改为让真实Cordis校验原始JSON后通过。冷启动首测在blocked旧会话上调用业务`ready`，返回ownership_lost；改测所要求的诊断`status`和`continue-clean`后通过，没有放宽业务门禁。解包命令有一次PowerShell空管道语法错误，解析阶段未执行，随后修正。没有重复同一错误无限重试。模型答题失败没有自动重试。

### 当前完成、未完成、未验证

- **已完成：** 4个摘要+8个答题的Luna串行pilot、真实dev.3代码复用与22份源码哈希核验、原始输入输出及固定评分交付；R40三个固定组合双顺序、disabled/准入/关闭/续接和冷启动ambiguous恢复；一次111项完整suite和规定五条集中命令。没有为本轮补验引入生产功能或数据迁移。
- **未完成：** 分支夹具的领域语义表达、Retcon口令映射、完整分页材料，以及修订后独立新一轮语义试验；这次模型答题不是全绿。前文各行额外故障点/排列仍未全部穷举，R40范围只更新本节明确覆盖的子项。
- **未验证：** 严格沙箱盲测和内部无自动压缩、实际token/费用/底层请求数、真实长上下文质量、不同随机重复与统计稳定性、Luna经DSH provider的真实调用、跨SDK日常profile迁移、桌面完整UI、长期运行、断电及其他OS/Node全版本。合成宿主测试与Codex Luna任务不能互相替代这些证据。

最终打包字节数、SHA-256、精确本地提交和重放日志放在外部补验`delivery-manifest.json`，避免将包自身哈希写进包内。此前交付的TGZ/ZIP/manifest原件保留。

归档阶段补记：加入只读审阅文档后，实际npm pack本身退出0、包有76文件；外围检查脚本仍写死75，因`76 !== 75`退出1。保留首份pack JSON；按实际新增文件改为验证允许路径和审阅文档存在，再执行最终打包，不将这一外围断言失败隐藏为全程无错。

最终归档验证：实际pack及外围检查均退出0，76文件；解包后逐项核对46个manifest条目的字节数/SHA-256并与本地构建比较，全部一致，生产bundle与首次交付相同。对更新TGZ入口的原生companion/冷进程补验 **7/7、exit0**，生命周期补验 **10/10、exit0**；日志分别为`followup-final-tgz-companion.log`、`followup-final-tgz-lifecycle.log`。这两次定向运行不计入前面的111项完整suite。之后仅纳入本段归档记录，最终包继续按同一入口重放并由外部manifest记录准确哈希，不在本文嵌入自引用哈希。

## 第二代审查与局部重构（2026-10-22）

用户先要求完整审查和算法改进，再授权尝试局部重构。当前审查基线为已发布第二代的 `d114b91ad8942742717a3c21890caba9658e3a93`，开始时工作区干净；本轮修改在本地 `refactor/replay-safety-20261022`，没有更新远端、Release、npm 或版本号。沿用原 D 盘项目和依赖，一个代码执行者与一个只读审阅者，无递归代理，重型过程串行。

### 修改与回归

| 文件 | 实际修改与原因 |
|---|---|
| `src/rp/store.ts` | 一次已验证加载内缓存固定历史前缀，带 sequence 上界和克隆隔离；事务 key 用 Set 查重；最终分支事务 envelope 预检；派生 blob 先形成草案再发布；写完正文重新验证权限 |
| `test/rp-replay.test.mjs` | 新增 5 项真实 store 回归：重放工作量、完整容量拒绝及冷读取、同批纠正、正文发布后的 marker 身份变化、固定父修订和下一次磁盘篡改检测 |
| `SOURCE-MANIFEST.json` | 根据实际 build 更新 src/lib 的字节数和 SHA-256 |
| `README.md`、`MIGRATION.md`、本报告 | 显示本地重构与已发布版本的区别，订正旧 companion 未测描述，保留历史验收边界 |
| `REVIEW-2026-10-22.md` | 8 项正确性发现、失败复现、修复状态、性能测量、后续建议与未验证范围 |

基线对 12 层 fork、13 笔事务的单次 readFence 执行 16,382 次实际 #apply，优化后为 182；同次微基准耗时 132.45 ms → 13.95 ms。不是长期、p95 或真实剧情统计基准。Set 子步骤的收益没有单独测量。缓存仅存在于一次加载及其历史前缀，不跨请求、authority 或磁盘读取，保留现有校验、隐私 tombstone 和 fence 防线。

审查复现的分支容量问题：4,166,534 字节合法输入被接受后写出 4,301,627 字节 envelope，导致后续和冷启动读取 store_corrupt。本地已在写派生 blob 前拒绝这种事务，旧 fence/文件集合不变，缩小输入可继续提交。branch/global v1、host journal v2 和共享 policy 协议不变；没有数据迁移、截断历史或自动修复损坏链。全局普通发布 3 MiB/控制 4 MiB 规则未改。

先红后绿证据包括原算法与容量失败、同批纠正草案读取、只读复审提出的最终授权时机问题。最后 5 项新增测试全部通过，复审确认授权检查恢复到正文写完之后。一次夹具误将独立来源建成同一 host message 的新 revision，已纠正并保留失败日志；没有修改产品来迁就错误 fixture。完整故障与夹具诊断见审查报告，不隐藏测试工具自身错误。

### 本轮实际命令

Node **22.23.3**、npm **11.16.0**、TypeScript **5.9.3**、esbuild **0.25.12**；实际 native peers 为 DSH **0.2.1-rc.2**、Cordis **4.0.5**、Schemastery **3.18.5**。没有安装/升级依赖。命令由指定 Node22 启动 `C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js`，子进程 PATH 使用同一 Node，npm cache 位于仓库 `work/npm-cache`。

基线先执行 `npm run typecheck` exit0 和一次完整 `npm test` **111/111、0 fail、0 skip、exit0**（2026-10-22 14:25:10.204Z–14:26:34.556Z）。以下是修改完成后**另一次完整串行验收**，未拼接定向测试：

| 命令 | UTC 起止 | 退出码及实际结果 |
|---|---|---|
| `npm run typecheck` | 14:47:56.247–14:47:57.781 | 0 |
| `npm run build` | 14:47:57.782–14:47:59.538 | 0，声明和独立 bundle 构建成功 |
| `npm test` | 14:47:59.538–14:49:04.864 | **0；116 tests / 116 pass / 0 fail / 0 skip；65.120秒** |
| `npm run evaluate:fixture` | 14:49:04.866–14:49:05.070 | 0，固定标注 fixture；无真实模型质量声明 |
| `npm pack --dry-run` | 14:49:05.071–14:49:14.585 | 0，77 个包内文件；没有实际发布 TGZ |

五条命令来自同一次 `work/review-2026-10-22/final-verify.mjs`，`final-commands.json` 保存完整命令、可执行路径、起止时间和退出码，`final-*.log` 保存完整输出。此前 28/28、4/4、5/5 都是单独定向验证，不加到 116 项中。最后仅更新报告文字时，不重跑无关源码测试；如复查包清单，其日志单独列出。

### 未修复问题与证据边界

完整审查新确认 3 项 P1、5 项 P2，A1 分支容量已修，**A2–A8 共 7 项尚未修复**：

- 旧宿主 packet 未绑定实际注入摘要，摘要失效后可能通过旧上下文再次发给下游；新 packet 已无摘要并不能阻止此路径。
- 失败的全局发布遗留 tmp/孤立正文，后续成功隐私删除未清除这些磁盘副本；未证明正常检索 API 可读到它们。
- canonical 幂等重试快捷返回跳过缺失 seal 补齐；其他类似上层快捷返回为静态待核。
- text+合法 tool-call 的原生混合消息被错误封锁；纯 tool-call 对照可完成第二轮。
- 非法命令 JSON 被当作 persistence_failed，错误封锁健康会话。
- 命令 grant 保存失败后仍留在内存，重试可使用未持久化授权。
- 健康会话 status 的 blocked=true 与实际 ready=true 不一致。

这些额外诊断有真实失败日志：host 1/5 通过、packet 0/1、global 0/2、基线 store 0/2；退出码均为1。未将它们隐藏或算入 npm test 的116项。它们保存在审查证据目录，原因和修复建议逐项写入 [完整审查报告](REVIEW-2026-10-22.md)。优先修复旧上下文与物理删除，再推进下一次发布。

**已完成：** 当前代码审查、故障复现、限于 store 的算法/容量重构、5 条新回归及只读复审、一次116项完整 suite、规定五条命令、文档订正和证据归档。未开启生产自动摘要、strict POV、原生压缩或自动采纳，未新增付费 API/模型请求。

**未完成：** A2–A8、批量授权视图读取、游标容量约束、中文检索与摘要选择算法改进、修订 Luna 夹具后的独立试验。本轮没有把全部审查建议一次性改进生产代码。

**未验证：** 新构建 TGZ 的实际 companion 全组合加载、真实模型/长期人生语义连续性、桌面完整 UI、长期运行、断电、大规模 payload/分支峰值内存、p95/吞吐、其他系统和日常 profile 迁移。前轮 TGZ 集成证据不替代本轮新构建的打包后验证，dry-run 也不等同实际安装。本轮最新的 Ultra+RP 人生连续性目标仅记录为后续架构方向，没有以默认开启自动能力来冒充实现。

## Ultra RP Memory 命名与独立使用（2026-10-22）

用户确认产品名 **Ultra RP Memory**、技术名 **dsh-ultra-rp-memory**，并明确“适配 Ultra，也可以单独使用”。进一步定位为长期培养 Agent 的记忆与成长基础：经历、关系、承诺及做事经验应跨互动持续积累，角色扮演为使用场景之一。这里记录的是产品方向，不代表完整成长、技能学习或自主行动已经实现。

以本地提交 `7c81dd07b4f48eca280331848c44d2501ca6906c` 为起点，同步更新 package.json、package-lock.json 两个根名称、Cordis patch、公开入口导出及 effect 标签为 `@dsh-external/dsh-ultra-rp-memory`。版本仍为 0.1.0-dev.3，没有改远端仓库 URL、历史发布包、UPSTREAM 来源、存储目录或协议。Cordis 配置 id `rp-memory`、`/rp` 和 `rp_memory_*` 保持原值。

运行依赖仍只有原生 DSH/Cordis/Schemastery peers，没有新增 Ultra Mode、Ultra Memory 或 Ultra Decision 依赖。README、安装设计文档和 MIGRATION 增加独立运行、可选适配与旧入口替换说明；SOURCE-MANIFEST 由实际构建更新。独立的原生宿主测试继续运行。当前 Ultra 证据仍限固定版本共存，同一 RP 会话的检索/预算等深度叠加仍待实施。

更新既有 `test/package.test.mjs`，验证新名称在实际构建入口、package、lock 与 patch 中一致，且没有 Ultra companion 运行依赖、默认禁用约束保留。先在旧构建上运行，因旧包名得到预期失败，exit1（`package-red.log`）；修改并构建后纳入下面完整 suite 验证，没有额外增加测试计数。

Node 22.23.3、npm 11.16.0，SDK 与依赖版本不变。一次完整串行五命令验收保存在 `work/rename-2026-10-22/final-commands.json` 和对应日志：

| 命令 | UTC 起止 | 实际结果 |
|---|---|---|
| `npm run typecheck` | 14:57:25.707–14:57:27.254 | exit0 |
| `npm run build` | 14:57:27.255–14:57:29.057 | exit0 |
| `npm test` | 14:57:29.057–14:58:34.697 | exit0，116/116，0失败/0跳过，一次完整运行 |
| `npm run evaluate:fixture` | 14:58:34.698–14:58:34.908 | exit0，固定标注 fixture，不代表真实模型质量 |
| `npm pack --dry-run` | 14:58:34.908–14:58:35.388 | exit0，新包名，77个文件 |

此后仅补写本节与产品方向文档；文档最终包清单复查另存 `document-final-pack.json`，不合并为另一轮全量测试。改名不解决前节 A2–A8 的7项遗留问题，未验证真实用户 profile 的新旧包替换或新命名 TGZ 实际安装。没有启用自动摘要/压缩/采纳，没有真实模型调用，没有 push、远端改名、npm/Release 发布或覆盖已发布包。

## 七项遗留修复与 Agent 记忆成长（2026-10-23，当前本地交付）

本节更新前文的历史状态：**A2–A8 七项遗留问题已修复，显式 Agent 经历、身份/关系成长、目标/承诺及可选 Ultra 适配已实现并完成下述验证。** 实际开发基线 `85d15e3d3d3b2c4a73a197178b937855d7d05030`，分支 `feature/agent-memory-20261022`。沿用实际 checkout、依赖与原有修复，没有回滚到最早审查基线。仍为 `@dsh-external/dsh-ultra-rp-memory@0.1.0-dev.3` 的本地开发快照；未 push、发布 Release/npm、覆盖历史包或安装到日常 profile。

一个执行者修改代码，最后一个只读审阅者静态复核，无递归代理；所有构建、测试和打包串行。未设置低内存上限，未安装或升级依赖，未调用付费 API 或真实模型。后台自动摘要、strict POV、原生压缩、自动采纳和自主行动均保持关闭。

### 修改文件、原因与回归证据

| 项目 | 主要实现与回归文件 | 修复效果与定向结果 |
|---|---|---|
| F1 / A2：历史 packet 认证 | `packet-proof.ts`、`packet.ts`、`host-journal.ts`、`rp-plugin.ts`；`rp-packet-proof.test.mjs` | 证明绑定组装时实际使用的事件/摘要 revision 与投影哈希，拒绝失效旧上下文，不以后读结果追认。缺证明 recovery-only，损坏证明不能提供可信分支。先红；初次相关测试 20/20，后续边界及最终全量覆盖 |
| F2 / A3：失败发布明文清理 | `global.ts`；`rp-global-orphans.test.mjs` | 在验证完整全局历史及 writer lock 后回收未发布正文/tmp；已登记独立 retain 副本保留。覆盖 blob/commit 前失败、有无同键重试、冷读及隐私删除。先红，7/7；进一步冷恢复边界通过 |
| F3 / A4：上层幂等返回绕过 seal | `store.ts`、`canonical.ts`、`summarizer.ts`、`jobs.ts`、`memory.ts`；`rp-seal-ack.test.mjs` | `ensureDurable` 在锁内验证并补 seal 后才能确认已提交效果；连续失败仍返回 persistence_uncertain，冷恢复不多发布。五条快捷路径先红，相关测试 45/45 |
| F4 / A5：混合文本和只读工具调用 | `rp-plugin.ts`；`rp-native-tool-mixed.test.mjs` | 接受真实 AgentLoop 合法 text+tool-call；严格校验每个 block、唯一 call ID、工具名和参数。未知工具/推理块仍拒绝。先红，4/4 |
| F5 / A6：非法命令 JSON 污染会话 | `rp-plugin.ts`；`rp-command-json.test.mjs` | 统一语法/对象结构错误为 invalid_record，健康会话可继续；I/O 故障仍 fail-closed。七组命令先红，命令+生命周期 16/16 |
| F6 / A7：未持久化 grant 被激活 | `rp-plugin.ts`；`rp-command-grant.test.mjs` | 授权草案完成 tmp/sync/rename 后才激活；失败不发布内存授权并清 tmp，可重试和冷恢复。先红，grant+receipts 10/10 |
| F7 / A8：健康状态误报 blocked | `rp-plugin.ts`；`rp-diagnostic.test.mjs` | 明确区分未绑定、健康、故障、关闭；与 ready/实际准入一致。先红，diagnostic+生命周期 10/10 |
| L1：长期检索 | 新 `lexical.ts`，更新 `retrieval.ts`、`packet.ts`；`rp-retrieval.test.mjs` | 中文相邻双字词项、词组匹配、有界计分与原文命中摘录，固定分页仍使用原结果集合。先红；最后 retrieval+orphans 22/22。属于词项检索，未宣称语义检索 |
| L2：经历与关系/身份成长 | 新 `agent-memory.ts`、`growth-format.ts`，更新 `canonical.ts`、`reducer.ts`、`store.ts`、`memory.ts`；`rp-growth.test.mjs`、`fixtures/rp/growth.mjs` | 明确人类控制来源、原因经历、唯一当前前驱；保留旧经历，拒绝陈旧/跨分支/无依据迁移，Retcon/隐私删除沿依赖失效。初次先红；growth+branch 29/29，删除/null 边界 4/4 |
| L3：目标与承诺 | `agent-memory.ts`、`growth-format.ts`、`rp-plugin.ts`、`packet.ts`；`rp-goals.test.mjs`、`rp-agent-host.test.mjs` | 独立 goalId，active/paused/completed/abandoned、进度与终止规则；`/rp agent`、`goals`、`relationships`、`self`，模型仍仅有三个只读工具。先红；goals+growth 6/6，原生+goals 3/3；追加目标推进后干净续接实际请求 1/1 |
| L4：Ultra 可选适配 | 新 `memory-optimizer.ts`，更新 `packet.ts`、`rp-plugin.ts`、公开 `src/rp-plugin.ts`；`rp-optimizer.test.mjs`、实际包宿主脚本 | 受限纯排序接口只返回已授权候选 ID，去重、预算收紧；无 Ultra 或显式关闭时独立运行。先红，optimizer+原生 3/3；实际包宿主见下文 |
| 复审修正 | `growth-format.ts`、`store.ts`、`canonical.ts`、`agent-memory.ts`；追加 growth 回归及 `scripts/host-acceptance/agent-legacy.mjs` | 直接来源不累积前驱全部来源；新成长需同事务账本 marker，普通旧 JSON 不被重新解释。3 项先红，相关测试 36/36；长链和真实旧源码探针见下文 |
| 文档/构建 | README、新 `docs/agent-memory.zh.md`、MIGRATION、narrator 指南、执行计划、`AGENT-REVIEW-2026-10-23.md`、本报告、`SOURCE-MANIFEST.json` | 命令示例、兼容/降级规则、人工确认边界和实际证据；manifest 由 build 生成，不手写构建哈希 |

实现路径均在 `src/rp/`（特别标注除外），回归均在 `test/`。原始日志集中于 `work/agent-memory-2026-10-22/`，交付证据归档保留失败与通过日志。上述定向测试互相有重叠，**不相加为完整测试数量**。

### 失败与复审裁决

F1–F7 和 L1–L4 的预期失败回归均保留。L1 首轮 17/18、exit1 暴露 F2 对已登记正文目录的过早拒绝，使隐私删除来不及发布 tombstone；改为已登记正文交回 read/purge 协议，最终 22/22、exit0，保留 `l1-green.log` 与 `l1-green-2.log`，不把首轮写成成功。类型检查有两类开发期错误：Map 联合类型推断、optimizer 参数 implicit any；明确类型后重新检查通过。F4 首次命令含错误的既有测试文件名，仅实际执行的 4 项计数，后续及最终全量运行了真正的 receipts 文件。一次 `git diff --check` 发现新增行 CRLF 尾部空白，规范换行后 exit0。

只读审阅确认来源累积与旧 JSON 误解释两项 P2，均先补失败回归后修正；窄审未发现新的具体 P1/P2。旧 marker 后补的疑点已有“必须引用本事务事件”和不可变事件 ID 检查共同阻止，探针确认拒绝，不重复修改。完整裁决见 [只读复审记录](AGENT-REVIEW-2026-10-23.md)。未将静态审阅当成独立测试运行。

### 一次完整验收与额外宿主验证

Node **22.23.3**、npm **11.16.0**、TypeScript **5.9.3**、esbuild **0.25.12**。运行时验证的 DSH peers 与 AgentLoop/commands/session-persistence-jsonl 为 **0.2.1-rc.2**，Cordis **4.0.5**、Schemastery **3.18.5**。npm 由指定 Node22 启动 `C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js`，子进程 PATH 使用该 Node，缓存位于仓库 `work/npm-cache`。

`work/agent-memory-2026-10-22/final-round-1/final-verify.mjs` 的同一次串行运行：

| 命令 | UTC 起止（2026-10-23） | 退出码与结果 |
|---|---|---|
| `npm run typecheck` | 10:07:01.503–10:07:03.215 | **0** |
| `npm run build` | 10:07:03.217–10:07:05.185 | **0**，独立 bundle 与声明构建 |
| `npm test` | 10:07:05.185–10:08:33.176 | **0；154 tests / 154 pass / 0 fail / 0 skip；87.758 秒，一次完整 suite** |
| `npm run evaluate:fixture` | 10:08:33.177–10:08:33.361 | **0**；固定标注 fixture，不代表真实模型语义质量 |
| `npm pack --dry-run` | 10:08:33.362–10:08:41.978 | **0**；90 文件 |

完整 stdout/stderr 与每条命令的起止、退出码在 `final-round-1/final-commands.json` 和 `final-*.log`。本轮未在完整 suite 失败后用定向重跑拼接成功。之后只调整文档、测试补验脚本和归档，不修改产品实现。

以下各项单独计数，不并入 154：

| 实际命令/环境 | 退出码与证据 |
|---|---|
| `RP_GROWTH_STAGES=260 node22 --test --test-concurrency=1 --test-name-pattern="direct provenance" test/rp-growth.test.mjs` | **0，1/1，640.098 秒**；260 次真实持久化，每节点两条直接来源；删祖先独有来源后后代清除、独立新经历保留，`growth-260.log` |
| `git archive` 导出 `85d15e3` 的 src，`node22 scripts/host-acceptance/agent-legacy.mjs work/agent-memory-2026-10-22/legacy-baseline` | **0**；实际旧源码写入的两种普通 JSON 由当前冷读保持原值/投影/fence，事后补 marker 被拒；扩展探针确认旧 reader 对新成长依赖 fail-closed。`legacy-probe.log`、`legacy-probe-downgrade.log` |
| `node22 --test --test-concurrency=1 test/rp-agent-host.test.mjs` | **0，1/1**；真实 AgentLoop 先发送目标 0，再显式推进到 50、干净续接、发送新目标；新 root 空历史且同分支，旧 owner 拒绝。`agent-clean-host.log` |
| `node22 work/agent-memory-2026-10-22/pack-artifacts.mjs acceptance-1`（内部 `npm pack --ignore-scripts --json --pack-destination ...`） | **0**；实际 TGZ 90 文件，初包 449,325 字节；解包 56 个 src/lib manifest 条目的字节数/SHA-256 全与本地构建一致；companion TGZ 哈希与既有原件相同 |
| `RP_BUNDLES_ROOT=.../acceptance-1 node22 --test --test-concurrency=1 scripts/host-acceptance/dev3-companion.test.mjs` | **0**；首次 9/9；追加 standalone 和显式关闭优化后，独立一次 **11/11、0 fail、0 skip**。`companion-acceptance-1.log`、`companion-expanded.log`，不合并计数 |

实际 TGZ 验证包括 standalone；Ultra 已加载但优化关闭；Ultra+RP 的两种加载顺序及实际请求去重；RP+Memory、RP+Ultra+Memory、RP+Decision+Memory 各两种顺序；新冷进程 disabled 门禁和 ambiguous 输入干净续接不自动重发。仅使用固定 Ultra **0.6.1-dev.rp.1**、Memory/Decision **0.1.1-dev.rp.1**。网络 guard 未记录外部请求。真实 Cordis/SDK/AgentLoop/JSONL 持久化与实际 TGZ 已运行，终端回复为离线合成输出；这不是 DSH 桌面 UI 或真实 provider 验证。

最终报告纳入后重新实际打包并重放上述 11 项；准确字节数、包 SHA-256、提交 ID、最终入口日志和源码/证据归档在交付目录的外部 `delivery-manifest.json`，避免包内自引用哈希。初包和原始历史包保留。

### 兼容性、边界与剩余工作

- **已完成：** 七项遗留修复；有来源的经历、关系/身份正常成长、长期目标/承诺；中文词项检索和有界回忆；独立 npm API/原生命令；可选 Ultra 纯排序/预算适配；两项复审修正；154 项完整回归、规定五命令、实际 TGZ 11 项宿主补验、旧数据和 260 阶段持久化验证。
- **未完成的后续改进：** 批量授权视图读取、持久搜索索引、分页游标容量淘汰、长期历史分卷、技能训练/习惯成长、自主行动；此前 Luna 夹具修订后的独立新一轮语义试验。当前“成长”是用户确认的事件与状态机制，不是模型自己学会技能或自动形成性格。
- **未验证：** 真实模型的长期人格、关系理解、目标执行和语义记忆质量；真实长上下文/费用/token 统计；日常 profile 迁移、桌面完整 UI、其他 SDK/公开旧 Ultra 包；连续多日运行、断电、OS/Node 全矩阵、大规模分支峰值内存与 p95 吞吐。上轮 Luna 试验及本轮固定 fixture 分数均不能补足这些缺口。
- **数据兼容：** branch/global v1 不变，不截断历史。只有同事务显式账本标记启用新增成长语义；普通旧 JSON 不改写。旧版可能因新前驱依赖返回 source_unavailable，写入成长后禁止混用旧逻辑；降级须恢复写入前备份。host journal 保持 v2，缺少 packetProof 的历史 recovery-only；损坏或无法认证的历史不补信任、不迁移。详见 MIGRATION。
- **性能限制：** 260 阶段测试共 640 秒，含每步写入、全量验证与重新读取，不能当成单请求延迟或吞吐基准；它显示长链成本仍高。检索尚无持久索引，读写仍需验证账本及正文。packet 最多补入 8 条经历，共用摘要可选预算；必需状态或总请求超预算时拒绝。既有来源数、深度、事务 envelope/journal 上限保留，没有“无限人生”容量承诺。
- **Ultra 适配范围：** 本包的 ultra-rp/v1 排序/去重/预算算法只处理 RP 已授权视图，不能扩大权限或注入陌生记录；没有调用 Ultra 的工程归档/压缩器。不会把“可以叠加”宣传成已有 Ultra 全部项目优化已复用。

收尾补记：最终 ZIP 逐项核验首次退出1，发现 Windows tar 产生的中文成员名被 .NET 解码为替代字符，导致按准确路径查找失败。产品 TGZ、源码与测试未受影响；原件保留，新交付目录改用可移植 ASCII 附件名，再逐项核对归档内容的字节数和 SHA-256。此归档问题不隐藏为全程无错。

用户随后明确产品中心为“让用户自己搭建一个完整的人”，其他插件可在其下面作为能力分支。README、使用指南及新 `docs/person-core-direction.zh.md` 已按此定位更新；人物档案、价值观/人格连续性、人生阶段与可选能力模块列为下一阶段，未冒充本轮实现。此轮补充仅改文档，产品源码与154项完整测试对应版本相同。最终文档包为91文件，重新执行实际包宿主11项；精确结果和包哈希以外部交付manifest为准。

最终定位补充：Ultra-RP-Memory 可以有自己的多条功能/用途分支，Ultra-Mode 保持平行独立，只需兼容；文档已按最新说明修正，不把 Ultra-Mode 纳为必需内部子模块。当前可关闭的纯排序适配保留，不新增自动功能或强制依赖。

## 2026-10-23 人物核心 M0：读取视图（实施基线 fdd9209）

本轮获准串行实施 M0、M1，验收后继续 M2；用户明确接受人物工作区要求新版读取，启用前备份。当前此节只报告 M0，不代表 M1/M2 完成。

- store 新增 operation-local `withReadView`：单次初始完整验证 + 单次结束 authority/fence 验证，共享事件、摘要、来源验证和投影；没有跨请求缓存。回调结束后 readSource 关闭。
- packet 和 retrieval-index 使用同一视图；工具回执仍认证实际返回数据，分页仍校验固定结果。成长 marker 支持嵌套 clone。
- 新增 `test/rp-read-view.test.mjs`，覆盖真实加载计数、已验证成长投影、失效回调、伪造 authority、视图内删除后拒绝释放旧事件。
- 旧竞态测试从 readEvents/readSource/readFence 拦截点迁移至 withReadView 边界，保持 Retcon、删除、owner disposal、journal 竞态断言。

实际命令（Node 22.23.3；日志目录 `work/person-core-2026-10-23/`）：

| 命令 | 退出码 / 实际结果 | 日志 |
|---|---|---|
| `node --test --test-concurrency=1 test/rp-read-view.test.mjs`（实现前） | 1；2 个预期 RED，API 不存在 | m0-red.log |
| `npm run typecheck` | 0 | m0-typecheck.log |
| `node --test --test-concurrency=1 test/rp-read-view.test.mjs test/rp-retrieval.test.mjs test/rp-growth.test.mjs test/rp-packet-proof.test.mjs test/rp-host-receipts.test.mjs test/rp-native-tool-mixed.test.mjs`（第一轮） | 1；39 通过、2 失败、2 取消；旧注入点未触发 | m0-green.log |
| 同上（迁移竞态注入点后） | 0；43/43，通过，非全量测试 | m0-green-2.log |
| `node scripts/benchmarks/person-read-view.mjs` | 0；两组完整 packet 哈希与实际基线源码相同 | m0-benchmark.log |

性能对照为同机串行、每规模每版本 1 次新进程、操作系统暖缓存。100/260 个成长阶段使用真实持久事务、正文与 seal；为隔离读取开销，夹具预先批量提交，不代表逐轮完整交互延迟。没有 p95 或真实模型质量结论。

| 阶段 | packet 耗时：旧→新 | 完整 load 次数 | 正文读取次数 | 读取字节：旧→新 | 进程峰值 RSS KiB：旧→新 |
|---|---|---|---|---|---|
| 100 | 544.75 → 109.06 ms | 14 → 2 | 604 → 202 | 5,270,366 → 841,833 | 85,528 → 55,392 |
| 260 | 1269.74 → 257.16 ms | 14 → 2 | 1564 → 522 | 13,557,772 → 2,167,691 | 93,376 → 65,200 |

100 阶段持久数据 482,514 字节，增量准备 2.38 s；260 阶段 1,245,603 字节，后续准备 14.06 s。原始 `benchmark/2026-10-23T10-50-34-772Z/report.json` 包含夹具哈希、metadata/blob I/O 时长及包含解析/哈希/Schema 的链加载时长。I/O 与包含式 chainLoad 时间不能相加为互斥分项；未单独测量纯校验 CPU。峰值含模块初始化，单样本约 5 倍的本地 packet 组装差异不能外推为所有机器或真实模型端到端加速。

兼容性：M0 未改 branch/global/journal 格式或生产功能开关。仍需 M1 后完整五命令和实际 TGZ 宿主复验；M1/M2 和编辑器尚未在本节验收。

## 2026-10-23 人物核心 M1：创建、备份和宿主绑定

实现文件：`src/rp/person/`（严格草稿、协议、原子创建、读取、绑定与离线编辑器），`semantic-registry.ts`（统一认证标记），store/canonical/memory/growth-format/packet（所有底层入口及投影），host-journal/rp-plugin（可信命令与原始绑定证明），build/package/manifest（独立离线编辑器分发）。

人物起点、字段、初始定向关系和目标一次提交。首次启用 `rp.person-core/v1` 前，在 writer lock 下复制并逐文件哈希核验插件 workspace、identity、project marker 和关联插件 journal；完成 manifest 最后发布。备份失败不发布人物事务。能力集合单调增加，旧 reader 拒绝整个对应 workspace；global v1 不变。实际 fdd9209 源码 reader 的拒绝与整份 workspace 备份恢复均通过定向验证。该备份不包含 DSH 原生 session 历史、global 或其他插件状态，降级时需停写并恢复匹配的数据，不能删事务降级。

回归与执行证据均在 `work/person-core-2026-10-23/`：
- m1-red.log exit1（三项缺新 API），m1-typecheck.log exit0，m1-core-green.log exit0（12/12）。
- m1-compat.log exit0（4/4）；这些额外兼容测试写于核心实现后，未声称先有 RED。
- m1-host-red.log exit1（两个缺命令），m1-host-typecheck.log exit0，m1-host-green.log exit0（2/2）。真实 pinned SDK 使用离线 Terminal，不调用模型。
- m1-atomic-red.log exit1 / m1-atomic-green.log exit0（10/10）：无字段 origin 以及后补 init 均拒绝。
- 审阅确认工具调用帧漏绑定：m1-review-tool-red.log exit1。首次修复后的 green/diagnostic/green-2 仍 exit1，原因分别涉及同宿主销毁恢复 modeEpoch、未采纳回复；cold-green 首次 exit1 因 close 主动封锁，调整为先正常 session drop 再重建宿主后，m1-review-tool-cold-green-2.log exit0（3/3）。保留全部失败，未移除断言。真正冷宿主覆盖工具调用、工具结果、第二次请求、原始 proof 恢复和后续请求。同宿主销毁重建后的历史 epoch 拒绝仍需 clean root。
- m1-review-parent-red.log exit1 / m1-review-parent-green.log exit0（29/29）：固定父前缀与新增事件同事务时，以继承后前置状态检查人物保护。
- m1-review-editor-red.log exit1（新分配器未实现）/ m1-review-editor-green.log exit0（1/1）：保存→重开后的字段/目标 ID 分配避让；这是逻辑回归，不是浏览器测试。
- 首次全量五命令 `m1-verification/final-commands.json` 全 exit0，其中 npm test 165/165；其后审阅修复另行完整重跑，不能将这次旧结果用于后来源码。

编辑器浏览器自动化被工具 file URL 策略拦截，未绕过。用户于本轮人工打开本机页面并反馈“页面正常，能生成命令”；标为用户人工验证，不冒充代理浏览器验证。导入/导出其余浏览器交互尚未完整人工验收。新版本未发布、未覆盖稳定包，无付费 API、自动摘要或压缩。
M1 审阅后完整复验：`m1-verification-2/final-commands.json` 五命令均 exit0，npm test 169/169（单次全量，非定向拼接）。实际包 `m1-final` 打包/解包/逐文件 SHA-256 核验 exit0，实际 TGZ 宿主组合测试 `m1-final-tgz-host.log` exit0（17/17），包括人物 standalone/Ultra-first/RP-first、实际工具循环及冷启动。精确包哈希/文件数见同轮 package-manifest.json。Node 22.23.3、npm 11.16.0、TS 5.9.3、esbuild 0.25.12；DSH 0.2.1-rc.2、Cordis 4.0.5、Schemastery 3.18.5。

## 2026-10-23 人物核心 M2：显式成长与情境状态

M0/M1 验证后继续 M2，仍为一个写入执行者、一个只读审阅者，所有构建和测试串行。本阶段修改 `person/{types,schema,format,projection,service,changes,editor}.ts`、`growth-format.ts`、`reducer.ts`、`store.ts`、`canonical.ts` 和原生命令适配。新增 `test/rp-person-growth.test.mjs`，扩充 `test/rp-person-host.test.mjs` 与实际 TGZ 组合脚本。

已完成行为：
- init/edit/grow/set-policy 有不同语义。edit 追加并保留历史；set-policy 保留值并使旧前驱候选过期；grow 只允许 growable，必须有有效世界经历、唯一当前前驱和理由，初始化 origin 不能冒充后续经历。
- trait/feeling/stage 复用明确人物语义标记，普通旧 JSON 不重解释。情境按 scene 或接受序号范围生效，先选择链头再过滤过期，避免复活旧值；人物视图、通用 state、检索和 packet 共用同一上下文。
- 成长候选正文放 managed job_input payload，登记前驱、原因和来源依赖；不会自动采纳。每次最多16条变化，合并后检查上限，从一个初始 fence 确定排序、预演并一次 canonical commit；冲突/循环/过期整批拒绝。已发布采纳和拒绝同键重试先确认持久性，不重放效果。
- 原因来源与本次控制进入直接 source 数组，前驱和祖先沿 dependencyIds，16条前驱链验证未发生来源线性膨胀。Retcon 撤销依赖成长和候选，固定子分支保留其快照；明确隐私删除在授权分支范围清理候选及成长正文。
- 原生命令支持 edit/set-policy/propose/candidates/adopt/reject/timeline；时间线区分当前、过期与失效 ID，正文无法验证或已删时不回填。离线编辑器新增倾向/感受/阶段和有效期；候选审阅及时间线首期使用可信命令。

### 实际执行与失败记录

全部在 `work/person-core-2026-10-23/`，退出码来自真实进程：

| 命令/证据 | 退出码 | 实际结果 |
|---|---:|---|
| node --test test/rp-person-growth.test.mjs（m2-fields-red） | 1 | propose 未实现及 M2 字段尚不支持，2失败 |
| npm run typecheck（m2-typecheck） | 2 | callback隐式any、canonical返回联合类型声明不匹配；已修正 |
| node --test --test-concurrency=1 test/rp-person-growth.test.mjs test/rp-person.test.mjs（m2-fields-green） | 0 | 6/6 |
| batch-initial | 1 | 测试代码在同步find回调中错误使用await，修正测试语法 |
| batch-red（文件名保留） | 0 | 批量/Retcon/隐私额外两项首次有效运行即通过，不宣称这份日志是RED |
| field-identity-red / green | 1 / 0 | 错用另一字段前驱已复现；修复后5/5 |
| native-red / green | 1 / 0 | 缺成长命令；实现后真实 SDK 闭环1/1 |
| boundary-red / green | 1 / 0 | reject重试冲突、时间线混入其他人物失效ID；修复后7/7，含16条链与17条拒绝 |
| npm run typecheck（m2-typecheck-2） | 0 | 定向修复后类型检查 |
| npm run typecheck（m2-verification） | 0 | 2026-10-23 11:34:01Z 开始，Node22 |
| npm run build（m2-verification） | 0 | JS、声明、离线编辑器和源码manifest生成 |
| npm test（m2-verification） | 0 | **单次完整177/177**，0失败/跳过/取消，67.09秒 |
| npm run evaluate:fixture（m2-verification） | 0 | 固定标注规则评测，不是模型语义成绩 |
| npm pack --dry-run（m2-verification） | 0 | 独立包预检成功 |
| node work/person-core-2026-10-23/pack-artifacts.mjs m2-acceptance | 0 | 实际TGZ打包、解包、116文件和78条manifest逐项校验；不是发布 |

五命令原始结果：`m2-verification/final-commands.json`，连续串行运行，不拼接定向重跑。实际包在独立输出目录，最终交付目录另列于根报告及 package-manifest；文档收尾重打包不改变运行代码，最终 manifest 核对源码/生成文件。SDK和Node版本与M1相同。

### 兼容、边界与未验证

- 保持独立 npm 包、global v1、branch schemaVersion1＋显式能力屏障、journal v2可选人物绑定和sessionMemoryPolicy/v1。新人物workspace要求新版是用户已批准的兼容选择。未对真实日常profile执行迁移或替换；自动备份/旧reader拒绝/测试工作区恢复已有真实文件系统和旧源码验证，整套DSH日常profile降级未实测。
- 只承诺实际测试的 Ultra 0.6.1-dev.rp.1、Memory/Decision 0.1.1-dev.rp.1；其他Ultra版本、混版SDK及跨SDK历史迁移未验证。
- 原生 SDK 使用本地合成 Terminal，真实工具注册、session、journal、请求门禁均运行；未调用任何付费API。没有真实模型长期人格一致性、主观关系质量、真实桌面全流程、断电恢复或无限人生容量的证明。
- 用户已人工确认 M1 编辑器可打开并生成命令。M2新增表单的完整浏览器交互、下载/剪贴板/导入组合仍未人工实测；相关 schema/ID分配/实际宿主导入由自动测试覆盖，二者分开记录。
- M0基准仅相同100/260阶段持久夹具的单样本读取对照，不是p95、写入性能或真实模型质量。事务链仍整体校验，候选列举目前读取活跃managed copies；大量人物/候选/长历史有成本，未引入分段存储，也未截断历史。
- 新队列首期覆盖人物字段；关系与目标复用既有显式Agent控制和查询，完整统一审阅UI未实现。情境序号包括控制来源，不是对话轮数；默认原生场景rp_scene，没有自动换场景或按系统时间衰老。
- 历史packet/工具结果受字段变化、过期、Retcon影响时可要求continue-clean。同一宿主内销毁后重建会话的modeEpoch不同也可能要求clean；不倒填或改写旧认证。
- 外部草稿/导出/启用前备份不随隐私删除自动清除。拒绝候选不物理删除正文；正文仍可删除并随关联来源清理。模型不能自行解除策略或采纳。
- M3能力模块/用途分支框架、M4长期体验评测、实时在线人物管理、技能学习、多人物社会和分段容量迁移均未实现。后台自动摘要、自动采纳、原生压缩、strict POV继续关闭。

M2 实际TGZ补验：`m2-actual-host.log` 退出0，**18/18**；运行命令为设置 RP_BUNDLES_ROOT=work/person-core-2026-10-23/m2-acceptance、RP_PERSON_BUNDLE=该目录/rp/package/lib/index.js 后执行 `node --test --test-concurrency=1 scripts/host-acceptance/dev3-companion.test.mjs test/rp-person-host.test.mjs`。新增人物成长在 standalone / Ultra先加载 / RP先加载均进入实际请求；工程归档未取得RP会话，自动摘要与压缩关闭。原始包哈希、SDK版本、每项观察与冷进程退出码在该目录 bundles.json、report.json、cold-*.log。审阅记录见 `PERSON-REVIEW-2026-10-23.md`。

交付状态：**已完成 M0、M1、M2**（按上述首期范围）；**未完成 M3/M4及实时UI/技能/多人物社会/分段容量**；**未验证真实模型语义、生产长期运行、整套桌面交互与真实断电/日常profile迁移**。没有push、Release/npm发布或替换稳定包。

## 2026-10-23 M3：用途、能力模块与双层约束

本节更新上节的阶段状态。实际基线 `326f3dbf2d519357c5c21958f0d2170e3b13bb0c`；用户确认同时实施系统硬约束和用户人物/用途规则。一个代码执行者、一个只读审阅者，没有递归代理；构建、测试、打包全部串行。包名与版本仍为 `@dsh-external/dsh-ultra-rp-memory@0.1.0-dev.3`，本地开发结果未推送或发布。

### 已实现与文件

| 文件 | 修改原因与效果 |
|---|---|
| `src/rp/modules/contract.ts` | 四种用途 rp/companion/creation/project；固定内置模块声明、版本/核心协议/能力/输出类型/关闭行为；严格配置与完整 binding hash |
| `src/rp/modules/runtime.ts` | 独立 runtime、调用内授权、同步撤销、有界读取与候选提交；实际返回对象+内容+原始 fence/记录 revision 认证，跨对象/跨 runtime/版本变化拒绝 |
| `src/rp/modules/commands.ts` | mode/modules/constraints 用户命令；配置和执行分开，模块结果不自动进入模型历史 |
| `src/rp/modules/marker.ts` | 独立配置撤销 marker；journal 保存失败保持冷恢复封锁，marker 失败后备写 blocked journal |
| `src/rp/{memory,packet,host-journal,rp-plugin}.ts`、`src/rp-plugin.ts` | 独立 API 与类型导出；mandatory purposeRuntime；原始绑定贯穿 packet/工具帧；空 root 切换、取消与干净续接；保存失败不恢复活跃权限 |
| `src/rp/person/changes.ts` | 抽出已有 propose 为窄接口，模块不接触采纳控制；复用原候选依赖/删除/前驱校验，没有新增事实库 |
| `test/rp-modules.test.mjs`、`test/rp-modules-host.test.mjs` | 8项核心及7项真实SDK离线回归；覆盖配置、权限、回执、并发、完整预算、候选、冷恢复与故障 |
| `test/rp-host-receipts.test.mjs` | v1夹具先建立真实无M3绑定的旧会话，避免把v2扩展伪装为v1；生产校验未放宽 |
| `scripts/host-acceptance/dev3-companion.test.mjs` | 实际TGZ增加三种加载顺序下的用途/约束/模块候选/人工采纳与停用路径 |
| README、人物用法、M3设计/计划/审阅记录、SOURCE-MANIFEST | 分发入口、操作说明、可复查证据与构建来源 |

三个内置模块是 person-view、recall、growth-review，默认均关闭。用途是共享核心的配置框架，不代表四套完整产品。硬约束强制控制能力白名单、来源/版本、输出预算和候选边界；用户可进一步禁用能力、保护字段、限制记录数。自然语言人物规则明确为行为指引，不能放宽系统约束，不宣称已做语义冲突识别。

### 回归与实际命令

证据根目录：`work/person-m3-2026-10-23/`。下表均为真实退出码，失败日志保留。node 指固定 Node22 executable，npm 经本机 npm-cli.js 调用。

| 实际命令/阶段 | 退出码与结果 | 日志 |
|---|---|---|
| `node --test --test-concurrency=1 test/rp-modules.test.mjs`，实现前 | 1，4/4缺少模块API | task1-red.log |
| 同上，首轮实现 | 1，2通过2失败：测试误依赖字段顺序、raw store代理未绑定private receiver | task1-tests.log |
| 同上，修正后 | 0，4/4 | task1-green.log |
| `tsc -p tsconfig.json --noEmit --emitDeclarationOnly false` | 首次2（关系/目标实际使用supportEventIds），修正0 | task1-typecheck*.log |
| `node --test --test-concurrency=1 test/rp-modules-host.test.mjs`，实现前 | 1，2/2缺宿主命令 | task2-red.log |
| M3+person宿主定向 | 0，6/6；本轮typecheck首次2（randomUUID推断过窄），显式string后0 | task2-tests.log、task2-typecheck*.log |
| 审阅回归：等待中篡改/撤销、冷恢复、完整回执预算 | RED退出1；修正后12/12退出0 | review-red.log、review-packet-red.log、review-cold-budget-red.log、review-green.log |
| 配置竞争、marker自身失败、prepare替换runtime引用 | 各RED退出1，修复后定向退出0 | config-race-red.log、marker-red.log、prepare-race-red/green.log |
| `node --test --test-concurrency=1 test/rp-modules-host.test.mjs test/rp-modules.test.mjs test/rp-host-lifecycle.test.mjs test/rp-person-host.test.mjs` | 0，27/27，之后另补prepare竞态1/1 | task2-green.log |
| 首轮完整五命令 | typecheck/build/evaluate/pack均0；test为1，191/192；非法v1夹具已定位修正 | 根目录 final-commands.json及final-test.log |
| `node --test --test-concurrency=1 --test-name-pattern='R21 v1 with no tools' test/rp-host-receipts.test.mjs` | 0，1/1；只证明修正夹具，非全量 | legacy-fixture-green.log |

最终完整五命令由独立 runner 从头连续串行执行，开始于 **2026-10-23 12:24:35 UTC**。没有将定向重跑拼成全量：

| 命令 | 退出码 | 实际结果 |
|---|---:|---|
| `npm run typecheck` | 0 | TypeScript类型检查 |
| `npm run build` | 0 | JS bundle、声明、编辑器和源码manifest |
| `npm test` | 0 | **192/192，0失败、0跳过、0取消**；测试报告70.73秒 |
| `npm run evaluate:fixture` | 0 | 固定标注规则评测；没有运行模型，不是模型语义成绩 |
| `npm pack --dry-run` | 0 | 独立npm包文件预检 |

最终五命令原始日志与时间/退出码：`work/person-m3-2026-10-23/final-verification/final-commands.json`。Node **22.23.3**、npm **11.16.0**、TypeScript **5.9.3**、esbuild **0.25.12**；精确宿主 **DSH 0.2.1-rc.2/session format4、Cordis4.0.5、Schemastery3.18.5**。

### 兼容与未验证边界

- 独立运行；Ultra仍仅使用已有 `ultra-rp/v1` 排序适配。兼容范围限实际验收的 Ultra **0.6.1-dev.rp.1**、Memory/Decision **0.1.1-dev.rp.1**；其他版本不能据此宣称支持。
- branch/global v1不变，人物workspace原reader屏障不变。journal保持v2，仅新增可选 runtimeBinding；旧会话不后补历史证明，需continue-clean启用M3。marker未知/缺失/撤销或绑定不匹配则封锁；recovery-only续接默认RP且模块关闭。无生产数据迁移或真实profile替换。
- 用户规则是自然语言指引；硬约束不是模型语义质量保证。保护字段和禁用能力针对模块通道，可信用户原有手动人物操作仍由原核心规则控制。
- marker与journal两条写入均失败且进程异常退出时，不能保证未落盘撤销跨崩溃保留；报告persistence_uncertain，当前进程保持封锁。已启动的候选持久化可能完成为未采纳候选，查看审阅队列处理；不会自动变成事实。无真实断电、磁盘损坏恢复或恶意本地代码隔离证明。
- 模块回执是进程内原对象认证，不是可复制的授权令牌；原始fence变化即拒绝，需要重新调用。独立调用方须管理runtime.revoke与幂等key。有限检索模块不保存分页游标，完整分页继续用原检索API。
- 未新增后台自动摘要、自动采纳、外部工具执行、原生压缩、strict POV或付费模型调用。项目用途不调用Ultra工程压缩；没有构造“真实执行过”的虚假经历。
- M4长期体验、完整用途产品、任意第三方模块市场/代码加载器、实时管理UI、技能学习、多人物社会和分段容量仍未完成。M3没有新增浏览器UI；旧编辑器人工验证边界维持M2记录。真实模型人格/关系质量、生产长期性能和桌面端到端仍未验证；M0性能数据不能解释为M3新性能成绩。

审阅过程见 `M3-REVIEW-2026-10-23.md`：单个只读审阅者；所有已确认P2补RED后修复，最后窄复核确认prepare引用竞态已关闭。包及SDK交付证据见本节后续实际TGZ验收记录。

### M3 实际 TGZ 验收与最终状态

`node work/person-m3-2026-10-23/pack-artifacts.mjs m3-final` 退出 **0**：实际 npm pack（不是发布）、tar 安全列表/解包、包文件数与 manifest 逐项 SHA-256 核验成功。产物 **128 文件**，manifest **86 条**；TGZ **575,708 bytes**，解包 **2,247,350 bytes**。运行代码、声明、编辑器与工作区当前 manifest 一致。

实际包路径：`D:/Codex/2026-10-20/dsh-rp-memory-dev-3-https/outputs/person-m3-2026-10-23/m3-final/dsh-external-dsh-ultra-rp-memory-0.1.0-dev.3.tgz`

SHA-256：`6b0de5a757f5e7fce47c4248bf6806ef860840b3ef07a49ecbfb66aeea6e7c16`。

设置 `RP_BUNDLES_ROOT=work/person-m3-2026-10-23/m3-final` 和 `RP_PERSON_BUNDLE=work/person-m3-2026-10-23/m3-final/rp/package/lib/index.js` 后运行：

```text
node --test --test-concurrency=1 scripts/host-acceptance/dev3-companion.test.mjs test/rp-person-host.test.mjs test/rp-modules-host.test.mjs
```

退出 **0，28/28，0失败/跳过/取消，14.03秒**。日志 `work/person-m3-2026-10-23/actual-tgz-host.log`；同轮 `m3-final/report.json` 记录精确SDK、包哈希、加载顺序与观察，`cold-*.log` 为真实独立Node进程冷启动输出。原生session、命令、工具、journal和llm管线实际运行，终端是本地合成适配器；网络guard通过，不存在付费模型请求。

新增实际包场景覆盖 companion standalone、project Ultra先加载、creation RP先加载；模块查看、完整来源回执、待审成长、用户采纳、用途/规则进入请求，以及停用后新请求拒绝。既有Ultra关闭优化、Memory/Decision各加载顺序、工程隔离、冷恢复和人物工具循环继续通过。

**已完成：M3 首期用途与能力模块框架、双层约束、独立/兼容组合、恢复和并发回归。未完成：M4及完整用途产品、实时UI、第三方模块市场、技能/社会/分段容量。未验证：真实模型长期语义、生产长跑、完整桌面交互、真实断电及日常profile迁移。** 本地功能版本仍dev.3，未push、未发布Release/npm、未覆盖稳定版本。此验收段在包验证后追加；交付目录旁置RESULTS.md和证据ZIP包含最新报告，TGZ保持已测哈希不变。


## 2026-10-24 正式版工作台接入

当前 Memory-Continuity 0.2.0 的工作台、完整 253/253、实际插件包、浏览器交互和发布结果统一记录于 [正式版 RESULTS](../releases/0.2.0/RESULTS.md)。本文件以上为原阶段历史证据，保留当时未验证范围，不回填为当时已通过。
