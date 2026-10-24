# Memory-Continuity M5 实际执行报告

后续 0.2.0-dev.3 后端加固、指令更新和补充验证见 [BACKEND-RESULTS](BACKEND-RESULTS.md)。以下保留 0.2.0-dev.2 的原始结果。

日期：2026-10-24。版本：0.2.0-dev.2，包名 `@dsh-external/dsh-memory-continuity`。开发基线 ee6b5a1898f128a0baf953ea192ba80795ac674d；隔离分支 `feat/m5-layered-continuity`。原 main 与发布包不覆盖。

## 范围与当前结论

M5 核心已实现：独立人物连续性、五类记忆、三级展开、确定性条件、预算与原因、原始快照绑定、历史携带/失效诊断、命令及工作台只读预览。全局记忆沿用原有实现，实际新宿主测试覆盖与 M5 一起进入请求。用户取消单会话压缩，继续显式干净续接；本轮不新增 Ultra 适配。

参考工作台增加导航和注入预览，支持浅/深/系统主题；用户随后把前端外包。已按最终要求把交接重写为纯功能需求，不规定外包布局、框架或接口实现。内置 imagegen 按明确要求生成一张视觉参考；插件与验证没有调用付费模型 API。

本报告记录完整命令结果。真实 TGZ、独立源码重建及最终交付哈希在文末追加；包内报告可能停留于打包时点，交付目录旁置 RESULTS 为最终记录。

## 修改文件及原因

| 文件 | 原因 |
| --- | --- |
| `src/rp/injection.ts` | 严格有界配置、中文滑动词项、五类/三级、方向关系、主观感受标签、强制/可选选择、预算原因及 trace |
| `src/rp/injection-binding.ts` | 配置与 trace 校验、原宿主文本交叉认证、独立持久标记，防止删除字段降级 |
| `src/rp/packet.ts` | 同一 read view 内完成新模式选择与渲染；绕过 Ultra 排序依赖；保留完整 PacketProof、全局与最终预算门禁 |
| `src/rp/host-journal.ts` | v2 严格可选扩展、原选择证据与记录版本绑定；未升级 branch/global schema |
| `src/rp/rp-plugin.ts` | 空白根显式配置、命令预览、恢复/续接/工具帧绑定、原 journal 备份、发送认证和只读管理接入 |
| `src/rp/person/management-server.ts` | 同源有令牌的只读预览接口，限制输入且不提供模型写入口 |
| `src/rp/person/manager-ui.ts` | 参考工作台视觉、主题、选择原因、来源详情与历史分区；外包最终 UI 待验收 |
| `src/rp-plugin.ts`、`package*.json`、`cordis.patch.yml`、编辑器标题 | 对外更名 Memory-Continuity；保留原命令、数据路径和默认禁用 |
| `test/rp-injection*.test.mjs`、管理/包测试 | 15 项新增回归/验收及更名合同；详见下表 |
| README、M5 文档、设计补充、实施计划、SOURCE-MANIFEST | 使用、兼容、更名、外包功能需求、审阅及真实结果 |

## 回归证据

| 测试/问题 | 首次结果 | 实现后结果 |
| --- | --- | --- |
| 无关字段不从完整 projection/primaryPerson 旁路进入；关系方向与实际来源；规则、排除/固定、预算、过时拒绝 | Task 1 0/4，退出 1 | 4/4，退出 0 |
| 原生 preview/实际请求/全局记忆/历史携带/干净续接；去掉绑定拒绝降级；过时历史拒绝发送 | Task 2 0/3，退出 1 | 3/3，退出 0 |
| 工作台只读预览与命令一致，非授权/额外字段/过长查询拒绝 | 新接口尚不存在，退出 1 | 管理验收整组 4/4，退出 0 |
| M5 工具循环原绑定 + 冷恢复 | 只到第一次终端调用，退出 1 | 两次终端调用及冷恢复下一轮，退出 0 |
| 错误 JSON 不封锁健康会话 | 返回一般控制失败，退出 1 | invalid_record，随后正确配置与输入成功，退出 0 |
| 只改历史 trace 并重算外围 hash，不能被原宿主正文认证 | 恢复未封锁，退出 1 | 恢复封锁，退出 0 |
| 中文关键词在奇偶偏移处仍命中 | “我想去钟楼”漏选，退出 1 | 三种偏移均正确；超 128 词项明确标记 |
| 感受属于主观记录，场景过期后 pin 不复活 | 缺少感受标签，退出 1 | 标签与过期测试通过，退出 0 |
| 实际前版 reader 拒绝新增 journal，原备份保持原样可读 | 缺少备份文件，退出 1 | 1/1，退出 0 |

只读审阅的四项 Important 及修复见 [REVIEW](REVIEW.md)。本轮没有递归子代理，始终一个代码修改者；审阅者不运行构建/安装/测试。

## 已执行完整命令

日志目录 `work/person-m5-2026-10-24/`。下表不是拼接定向重跑。

| 命令 | 退出码 | 实际结果 |
| --- | ---: | --- |
| `npm run typecheck` | 0 | TypeScript 完整检查 |
| `npm run build` | 0 | 入口、类型、离线编辑器、source manifest |
| `npm test` | 0 | **单次完整 229/229，0 失败、0 跳过、0 取消，125.794 秒** |
| `npm run evaluate:fixture` | 0 | 12 个固定样例、49 个标注输出，未生成模型回答 |
| `npm run evaluate:life` | 0 | 四类离线故事 4/4，75.935 秒，maxRss 122560 KiB，模型质量 unverified |
| `npm pack --dry-run` | 0 | 实际 npm 清单检查；当时 265 文件（追加报告会改变最终文件数） |

全量测试后只规范化了修改文件的 CRLF→LF，恢复仓库原格式；无行为改变。为重新生成精确清单执行第二次 build，退出 0；没有用重跑定向测试代替上面的全量结果。`git diff --check` 退出 0。此前一次检查因 Python 默认换行产生大量尾空白提示，已修复；不是隐藏测试失败。

早期 typecheck 退出 2：一个空数组推断和一个错误局部变量引用；按编译位置分析后修复。浏览器准备脚本第一次因测试关系字段误用中文枚举被严格校验拒绝，改为合法 trust 后启动成功；未改生产规则迎合测试。RED 测试与这些失败均保留原始日志。

## 环境

- Node v22.23.3；npm 11.16.0；TypeScript 5.9.3；esbuild 0.25.12。
- DSH 各原生 peers 0.2.1-rc.2 / session format 4；Cordis 4.0.5；Schemastery 3.18.5。
- Windows / PowerShell；源码、work、产物均在 D 盘。沿用已安装、锁定版本的 node_modules，无新增依赖安装。
- 主修改在 `D:/Codex/2026-10-20/https-github-com-kayou-31-dsh/work/rp-memory-m5`；原仓库 main 保留。

## 兼容与迁移

branch/global v1 未升级。host journal 保持 v2，新增严格注入字段和独立 marker；实际前版 reader 拒绝新增字段。首次启用之前将原 journal 原样 fsync 保存为 `.pre-m5-backup`。旧历史不补造选择回执；删除/损坏绑定、原始 trace 不匹配、过期/retcon/权限变化均按 fail-closed 处理。

包更名不搬移 `.dsh-rp`，不改 `/rp`。替换入口用新的 patch/package 名；不要同时启用旧、新两包。本轮没有 push、合并 main、改名远程仓库或发布 Release/npm。

## 未完成、未验证和已知限制

- 外包最终前端尚未交付/验收。本轮参考页面只确认可打开并载入真实测试人物；最终浅/深主题、窄屏、键盘和完整浏览器流程未做验收，不把源码/HTTP 测试当浏览器证据。
- 没有真实付费/免费模型语义对照，没有评估人物“像完整的人”的主观质量。fixture 和 life 分数只证明固定记录与协议，不代表真实理解、长期人格或任务能力。
- 单会话压缩已由用户取消；新 Ultra 兼容不在本轮范围；没有后台自动机制。技能学习、更丰富用途产品、第三方模块市场仍属于后续工作。
- 分词是有界本地词法，不是语义向量。排除针对选择条目，不是对最近原文、证据引用或旧上下文做全文隐私擦除；需要严格清除时走原有删除与干净续接流程。
- 仍保留完整事件/projection 的 PacketProof；大历史读取/认证有成本。未知旧式状态与强制冲突保守保留；不保证每轮或整段历史请求更小。预算是 UTF-8 保守估算，非 tokenizer 或账单。
- 未验证日常生产 profile 升级、真实断电、数日/数周长跑、跨 OS/SDK、并发量上限。冷恢复与故障注入不是断电证明。
- 历史对象描述符异常、独立 typecheck 的一次 0xC0000005、Git 压缩 ZIP 单条目损坏的根因仍未查明；原发布报告保留。最终源码 ZIP 沿用无压缩 ZIP 并逐条验证，避免把历史偶现隐藏为已根治。
- 备份、游标未全量自动回收、孤立页与历史存储容量上限的既有边界保留；本轮没有无限容量承诺。

## 独立源码重建

将 278 个源码文件复制到独立 `source-check` 目录，未复制 lib；复用同一组锁定版本的依赖，未运行安装或网络请求。在该目录执行 `npm run typecheck` 与 `npm run build`，退出码均为 0。生成的 SOURCE-MANIFEST 与主工作树逐字节一致，SHA-256 为 `8828b6f406a1d9a5cf64bca7055777814292e29c647c4a288f94c74a253bf201`；因此该清单覆盖的 src、lib、ui 文件内容一致。此检查不代表全新联网安装验证。

## 实际插件包验收

- `npm pack --json --pack-destination <交付目录>`：退出 0；产出 `dsh-external-dsh-memory-continuity-0.2.0-dev.2.tgz`，2,566,281 字节，266 个文件，解包内容 5,107,884 字节。
- SHA-256：`2cbe679c9d68c3cf5a23977cff491a907677123ca31aff9d9b7c2edc354da427`。
- 对真实 TGZ 检查所有条目路径、唯一性和类型后解包，SOURCE-MANIFEST 的 100 个 src/lib/ui 文件逐一核验长度与 SHA-256，退出 0。
- 令 `RP_PERSON_BUNDLE` 指向解包后的 `package/lib/index.js`，执行 `node --test --test-concurrency=1 test/rp-injection-host.test.mjs test/rp-person-host.test.mjs test/rp-management-host.test.mjs`：退出 0，**13/13，0 失败/跳过/取消，8.684 秒**。这些测试通过真实 SDK 安装包内插件，覆盖实际终端请求、工具循环、冷恢复、人物/成长、管理预览与会话延续；终端是离线测试适配器，不是在线模型。
- 实际包验收是补充证据，与此前单次完整 229/229 分开记录。打包后仅补充报告与计划状态，没有修改源代码或构建文件。
- 交付目录：`D:/Codex/2026-10-20/dsh-rp-memory-dev-3-https/outputs/memory-continuity-0.2.0-dev.2-m5-2026-10-24`。最终源码 ZIP、逐条验证及证据日志记录见该目录旁置 RESULTS 和 SHA256SUMS；插件内报告保留打包前时点。
