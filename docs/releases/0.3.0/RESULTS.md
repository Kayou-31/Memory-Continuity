# Memory-Continuity 0.3.0 实际执行报告

本轮在 `fix/reliability-cost-next` 的 `cd42f9b307ef145341de7116d06f7dd47eb5c789` 上继续实施，合并此前未提交的可靠性与成本改动。目标为正式 DSH 插件 0.3.0；独立核心和 AstrBot 管理桥保留各自预览版本。没有覆盖旧稳定版，也没有使用外包 HTML 中的模拟后端。

## 改了什么

| 文件/范围 | 原因与行为 |
| --- | --- |
| `ui/workbench/continuity.css`、`workbench-reading.ts`、`workbench-page.ts`、`workbench-client.ts` | 暖白墨青与深色主题、人物卡片、档案分组、经历时间线、成长对照、注入左右栏、会话延续及规则布局；人物选择区固定，导航可滚动 |
| `management.ts`、`management-server.ts`、`management-client.ts`、`memory.ts`、`core/confirmations.ts` | 复用已有 organizer，接入显式整理/交接、候选读取与摘要采纳；始终校验权限和快照，避免嵌套协调器锁 |
| `rp-plugin.ts`、`management-extensions.ts` | 用途、模块和约束先预览再确认，绑定安全空白根会话；排队之后再次检查，旧预览不能改写已开始聊天的配置 |
| `documents/reconcile.ts`、`documents/service.ts`、`workbench-extensions.ts` | 旧章节匹配建议与可检查的条件填回草稿；不自动启用注入或丢弃原文 |
| `organizer.ts`、`summarizer.ts` | 带来源的本地摘录候选、幂等复用、精确重复/冲突/待办复核、交接；工作台与命令入口共享宿主动态摘要校验上下文 |
| `context-retention.ts`、`request-cost.ts`、`host-journal.ts`、`packet-proof.ts`、`retrieval.ts` | 不变工具步骤复用上下文、持久化请求/重试上限、批量来源证明、显式替代表述检索；原始证据和分支权限保留 |
| 包元数据、README、命令与发布文档 | DSH 0.3.0、独立核心 0.1.0-preview.2；AstrBot 管理桥 0.1.0-preview.1 未伪装为完整模型适配 |

工作台没有新增后台行为。模块开关控制真实的 `person-view`、`recall`、`growth-review`，不是关系、情绪等虚构独立能力。创作大纲与项目看板标记未接入。人物归档、最近使用时间、完整会话链及全局记忆管理 GUI 尚未补齐，现有真实命令保留。

## 回归与审阅依据

- `rp-workbench-organizer.test.mjs`：授权、未知操作、快照/撤销拒绝、同候选复用、候选不自动生效、采纳幂等且无嵌套锁、资料条件只形成建议。初始缺接口失败保留，修复后通过。
- `rp-management-host-extension.test.mjs`：实际原生 SDK 的用途、三个模块与规则确认；预览过期拒绝；预览后开始聊天再确认拒绝；命令生成候选由工作台读/采纳，工作台候选由命令读取。
- `rp-cost-reliability-host.test.mjs`、`rp-injection-cost-host.test.mjs`：工具链不重复堆完整包、每输入和每步重试限制、故障后新输入额度、冷恢复、落盘故障、认证竞态、首轮与后续预算。
- `rp-organizer.test.mjs`、`rp-proof-batch.test.mjs`：整理边界、批量证明与跨版本拒绝；另有已有的权限、删除、分支、seal、容量及历史读取器回归。
- 独立只读审阅发现摘要入口遗漏宿主 epoch/global context、诊断状态 `denied` 与实际 `rejected` 不一致两项重要问题。前者写了原生跨入口失败回归后修复；后者由实际离线失败/重试上限触发的浏览器页面验证。审阅者复核两项修复闭合。未报告新的已证实权限放行问题，但这不等于形式化安全证明。

## 串行执行记录

Windows；Node **22.23.3**，TypeScript **5.9.3**，Cordis **4.0.5**，Schemastery **3.18.5**；两套原生 SDK 分别是 DSH **0.2.1-rc.2 / rc.3**。Python **3.13**；AstrBot **4.29.3**。所有重型命令串行，未设低内存上限。npm 通过同一 Node 的 npm-cli.js 启动。

| 命令/检查 | 退出码 | 实际结果 |
| --- | ---: | --- |
| `npm run typecheck` | 0 | 通过 |
| `npm run build` | 0 | 独立 DSH 包、声明、编辑器和本地 CSS 生成通过 |
| `npm test` | 0 | **392/392**，0 失败、0 跳过，一次完整运行约 219.4 秒 |
| `npm run evaluate:fixture` | 0 | 固定语料 12 个样本、49 个预设输出；真实模型 0 样本 |
| `npm pack --dry-run` | 0 | 当次预检 527 文件；最终增加报告后文件数另列于产物清单 |
| `npm pack --pack-destination …/candidate --json` | 0 | 生成实际候选 TGZ |
| 候选 TGZ + rc.2，4 个宿主测试文件 | 0 | **22/22** |
| 候选 TGZ + rc.3，初次错误环境 | 1 | 包从父目录解析到 rc.2，而宿主为 rc.3；原型检查拒绝，未降级安全检查 |
| 同一 TGZ + 独立 rc.3 包/测试目录 | 0 | **22/22**，不是把两次定向结果拼成一次全量 |
| `node scripts/build-core.mjs --out …/core-stage` | 0 | 核心预览 0.1.0-preview.2，188 个清单文件 |
| 核心 TGZ 离线安装、写入、另进程冷读、服务恢复、init | 各 0 | 无 DSH 依赖；资料哈希、日记与 fence 一致；持久确认回执一致，无自动重放 |
| `python scripts/build-astrbot.py --out …zip` | 0 | 管理桥独立 ZIP |
| AstrBot 4.29.3 的 `unittest discover -s adapters/astrbot/tests -v` | 0 | **12/12**，本机 HTTP 终端，未连真实模型或 QQ |

实际 TGZ 的四个测试文件为 `test/rp-cost-reliability-host.test.mjs`、`test/rp-injection-cost-host.test.mjs`、`test/rp-management-host-extension.test.mjs`、`scripts/host-acceptance/package-compat.test.mjs`，运行 `node --test --test-concurrency=1`。rc.3 同时隔离测试依赖与包依赖，不能只设 `RP_NATIVE_SDK`。

完整日志保存在项目 `work/release-0.3.0`；公开证据随本目录 `evidence` 提供；日志中的短期测试凭据已脱敏，本机原日志保留。为使用实际 TGZ，管理宿主测试在完整运行后增加了可选 `RP_PERSON_BUNDLE` 测试入口；生产实现未因此变化，随后 rc.2 / rc.3 各 22 项均使用该入口。

## 浏览器实际操作

使用真实插件 + 原生 SDK + 隔离 profile，通过浏览器人工路径验证；没有调用参考 HTML 的假 API。

- 导航、人物搜索、查看贝雅时聊天人物仍为林澈；关闭入口后人物名、头像、面包屑、正文及当前聊天全部清空。
- 成长提案填写并选经历 → 预览 → 确认后保持待审阅；批量采纳预览可取消，取消不改变人物。
- 本地摘要生成、候选预览/采纳与状态刷新；交接预览显示实际用户原话和有效待办。
- 三模块开关：取消不改变状态，确认后从后端重读；用途切到陪伴保留已有模块；规则编辑、保存；已有历史点击开关被引导先干净续接。
- 关闭额外影响弹窗后，下一次模块变更使用页面内审阅，仍有明确确认按钮。
- 共同日记从默认关闭 AI 写作的权限建立，到人类日记保存；含 HTML 的测试文本原样显示，没有脚本执行或浏览器控制台错误。
- 资料导入、逐章分类与私聊条件；修订后匹配两章，未自动沿用旧注入资格。点击填回后恢复到草稿，取消后原文仍是原 110 字节。
- 真实请求上限拒绝时显示恢复警示；绑定健康与请求被拒绝不再混为一谈。浅色/深色桌面实际截图保留。

窄屏、真实移动设备、完整键盘和读屏器矩阵未实测，不以 CSS 媒体查询代替验收。没有伪造最近使用时间、轮数或会话链。

## 失败和修正没有被抹掉

1. 整理测试先因接口不存在失败；资料修订测试有一次缺少人物起点的夹具错误，补齐前置后才得到目标失败。
2. 跨入口摘要回归第一次没有准备已接受的对话来源，先失败在前置条件；补上真实离线输入后复现 `stale_input`，修复后通过。
3. 浏览器夹具增加输入后，最初没有等宿主 idle，打开管理入口被拒绝；改为有界等待。失败重试夹具最初重复注册同一 provider，被 SDK 拒绝，改为独立名称，没有覆盖原适配器。
4. 浏览器有一处关闭入口仍残留人物名，已经复现并修复，最终关闭页面不含人物内容。部分浏览器定位因原生可访问性把 summary 或主题按钮显示成不同角色而失败，读取实际页面后使用正确标签定位；不算产品通过或失败。
5. rc.3 混依赖失败见上表，改为完全隔离；AstrBot 首次命令漏设测试专用环境变量，12 项初始化失败，补齐 `MEMCONT_TEST_NODE` 和 `MEMCONT_ASTRBOT_SOURCE` 后重新完整 12/12。

## 长对话、兼容与仍然存在的限制

本轮可靠性阶段已完成 64 次明确输入 / 72 次离线适配器调用，包含 8 次工具调用、第 25 轮冷恢复、第 41 轮明确续接；最长连续单会话 40 轮。原计划 128 轮的尝试在第 48 轮碰到保守预算边界，第 49 轮历史认证拒绝，没有完成，不能说“128 轮通过”。具体请求字节与本地校验耗时见[阶段报告](../../reliability-cost-2026-10-26/RESULTS.md)，本次 UI 验证没有把这组旧检查点冒充供应商请求或实际账单。

占位消息和普通/工具历史仍增长；语义归纳、向量召回、自由推理式做梦、多日负载与真实模型人格质量未验证。默认 16 次适配器准入和每步 2 次重试不能控制第三方适配器内部隐藏 HTTP 重试。64 轮本地性能样本没有统计置信区间。

branch/global **v1** 保持兼容，无历史截断。host journal **v2** 新增可选且严格校验的 `requestCost`，旧读取器可能拒绝；升级前备份全部 profile/工作区，降级恢复完整备份。保留 modeEpoch、来源认证和恢复专用规则，不自动迁移无法验证的历史。

AstrBot 仍只交付显式管理桥。模型注入、跨进程请求准入、QQ/NapCat/Snow Luma 完整链路未完成。完整 DSH 桌面安装、生产资料升级、真实断电、其他 OS、真实账单和真实模型效果未验证。没有后台自动功能或付费 API 调用。


## 源码与最终产物检查

Git ZIP 导出的候选源码包在 `assets/tokenizers/deepseek-v3.2/tokenizer.json` 上出现 CRC 校验失败，原因未定位到产品代码；这个失败包没有作为附件使用。改用 Git 索引/提交中的 blob 逐个读取，先核对 Git 对象哈希，再用 Python 标准库写 ZIP，随后逐文件核对 SHA-256 与 CRC。新的源码候选包含 578 个文件，解压后的 `npm run typecheck` 与 `npm run build` 均退出 0；依赖复用锁定的本机安装，未声称干净网络安装通过。

源码 ZIP 不包含 `.git`，历史读取器回归应使用完整 Git 克隆运行。公开日志仅规范化换行/行尾空白并脱敏短期测试令牌，原日志留在 `work/release-0.3.0`。

归档前对文本换行做了统一，重新构建后 `lib/index.js`、离线编辑器与 tokenizer 的 SHA-256 与已通过 rc.2 / rc.3 的候选包完全一致。主运行入口为 `96b13735420ecfabda1b5e0ec74090ffd0ab6284a99b58e6f7224e79ad6cf88c`。最终包还会核对清单文件哈希、同运行入口，并在实际附件上重跑关键宿主操作；附件大小、SHA-256 和远端核验记录与发布附件一起保存。
