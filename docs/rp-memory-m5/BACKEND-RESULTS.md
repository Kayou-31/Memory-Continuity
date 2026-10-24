# Memory-Continuity 0.2.0-dev.3 后端补充报告

2026-10-24；开发基线 `44211a5b7e14b072307fb6f644bcc33b9cf1c8ca`，沿用 `feat/m5-layered-continuity`。本轮完善已批准的 M5 后端、补充可在本机完成的验证、更新指令。前端等待外包交付，未改视觉和布局；没有后台自动功能或在线模型调用。

## 实际修复

1. 用途约束与模块执行的 JSON 解析错误曾落入未知异常处理，将健康会话封锁。现在仅在明确的参数解析入口转换为 invalid_record；原配置不变，纠正参数后仍可发送。未对持久化异常做宽泛豁免。
2. 管理 HTTP 请求取完快照后，如果入口或所属宿主资格被撤销，原来仍返回旧数据。现在在写响应前同步重检令牌及 controller 资格；失败返回 ownership_lost，不带旧人物结果。已提交写操作的失败响应不保证回滚，应重新打开管理页核对状态。
3. 关闭注入的第一个 marker 写入失败后，实际强制结束进程再冷启动，旧 ready journal 会恢复请求资格。现在 marker 写失败时尝试持久化 blocked journal；故障会话继续关闭请求，仅允许诊断和经授权的干净续接。
4. 新增中文 `/rp help [person|injection|recovery|memory|modules|storage]`；未启动、故障和进行中的会话均可读取帮助，帮助不访问记忆、不解除封锁、不调用模型。更新宿主指令描述和提示、README、中文指令速查及旧使用文档的当前能力说明。

## 文件与回归

| 文件 | 修改与对应验证 |
| --- | --- |
| `src/rp/modules/commands.ts` | 两个 JSON 参数入口；`rp-command-help` 的 constraints/modules 失败回归 |
| `src/rp/person/management.ts`、`management-server.ts` | 同步资格校验；管理服务器 endpoint/owner 两种撤权回归 |
| `src/rp/rp-plugin.ts` | marker 失败备用封锁写入、只读帮助、中文注册提示 |
| `src/rp/command-help.ts` | 六个帮助主题和安全续接说明；真实 SDK 命令测试 |
| `test/rp-injection-recovery.test.mjs`、`test/fixtures/rp/injection-crash-child.mjs` | 真实 SDK 子进程、持久化点握手、强制终止后新宿主恢复 |
| `test/rp-injection-host.test.mjs` | 并发人物纠正后不返回旧预览；损坏备份不覆盖、不当作可信资料 |
| `test/rp-management-server.test.mjs` | 同一真实 bundle 的 controller/server，实际 HTTP 撤权响应 |
| `docs/COMMANDS.zh.md`、相关 README 和使用文档 | 更新可实际调用的中文指令与故障处理 |
| `package.json`、`package-lock.json`、`SOURCE-MANIFEST.json` | 开发版本 0.2.0-dev.3 及精确构建清单；未改依赖版本 |

## RED → GREEN 与补验证范围

- 初始命令/HTTP 回归：1/5 通过、4 项失败，退出 1；补充 owner 失效回归：0/1，退出 1。
- 首次修复验证：15/16，退出 1。剩余问题是测试夹具把 controller 与 HTTP server 分别 bundle，RpError 类身份不同，导致 409 而非 403。改为与实际包一致的单 bundle，未削弱生产校验；16/16，退出 0。
- 首次 marker 故障后杀进程回归：冷启动 blocked=false，0/1，退出 1。补备用 journal 后恢复组合 9/9，退出 0。
- 按只读审阅建议，进一步覆盖两个 journal 写入点和最终 ready marker 的 EIO。四种单点写失败后均实际终止子进程再冷启动，4/4，退出 0。
- 八个成功落盘后的中止点：启用/停用各四种，依次为 blocked marker、blocked journal、ready journal、ready marker。前三种冷启动封锁，最后一种按完整持久配置恢复；封锁会话不能调用终端，授权干净续接可以继续。原始备份 hash 一致。
- 并发纠正与备份损坏两项：原代码即符合预期，2/2，退出 0；记录为补验证，未虚构失败或修改实现。
- 一个只读审阅者检查差异和测试设计，未发现新的 Critical/Important；未运行测试或修改文件，审阅结论不替代实际测试。没有递归代理。

## 独立依赖安装

先在全新源码副本运行 `npm ci --offline --ignore-scripts --no-audit --no-fund`：退出 1，缓存缺少 zod 4.4.3，另有 npm 清理目录的 EPERM 警告。保留失败日志及不完整目录，不反复重试。

隔离不完整 node_modules 后，按同一锁文件执行 `npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=30000`：退出 0，安装 47 个包。仅访问 npm 包源，没有模型 API；禁用安装脚本。独立重建结果在最终命令区记录。

## 环境与兼容

Node v22.23.3、npm 11.16.0；DSH 0.2.1-rc.2 / session format 4、Cordis 4.0.5、Schemastery 3.18.5、TypeScript 5.9.3、esbuild 0.25.12。Windows/PowerShell，全部源码、缓存和交付在 D 盘。一个代码执行者、一个只读审阅者，同一时间最多一个安装/构建/测试进程。

branch/global v1、journal v2 及 M5 字段格式不变，没有新增迁移。升级仍保留原 profile 和首次启用备份，不覆盖损坏证据。包名、`/rp` 和 `.dsh-rp` 路径延续上一轮；新旧插件不得同时启用。没有 push、合并 main 或发布 Release/npm。

## 保留的未完成、未验证项

- 外包前端尚未收到，未对接，最终主题/窄屏/键盘/浏览器全流程仍待验收。当前 HTTP 验证不能替代前端验收。
- 没有真实模型语义、人格连续性、跨周生活体验或自主任务质量结论；固定语料只检验协议和记录。
- 进程中止不是硬件断电。实测为八个完整 rename 之后的中止、四种单点写失败后的中止；没有模拟两份独立持久记录同时无法写入的整盘故障，也不承诺能持久化一个磁盘拒绝保存的撤权结果。
- 没有使用日常生产 profile 做原地升级；测试使用隔离目录和真实 SDK。跨 OS/SDK、大量并发、数周压力仍未验证。
- 原报告的词法检索限制、完整证明读取成本、有限容量、备份/游标留存、历史 Windows/压缩归档偶现根因仍保留。本轮不会把这些标为已解决。
- 单会话压缩已取消；后台自动功能、付费模型调用和新的 Ultra 适配不属于本轮。技能学习、更深长期检索及更丰富用途产品未在本轮新增。

## 最终命令与交付

| 命令 | 退出码 | 实际结果 |
| --- | ---: | --- |
| `npm run typecheck` | 0 | 完整类型检查 |
| `npm run build` | 0 | 入口、声明、UI 复制与 manifest |
| `npm test` | 0 | **单次完整 248/248，0 失败/跳过/取消，132.822 秒**；含新增 19 项 |
| `npm run evaluate:fixture` | 0 | 固定语料验证，无模型调用 |
| `npm pack --dry-run` | 0 | npm 实际文件清单检查 |
| 独立目录 `npm run typecheck` | 0 | 使用新安装的锁定依赖 |
| 独立目录 `npm run build` | 0 | src/lib/ui manifest 与主工作树完全一致 |

独立 SOURCE-MANIFEST SHA-256：`a90df3888072a74e29f1d138319b707dbe91eb3e0fef7f3177cf70cda3a12264`。构建副本不带原 lib，依赖没有通过 junction 复用。没有将定向测试拼为完整 248 项；第一次完整命令即为上述结果。日志位于 `work/m5-backend-2026-10-24`，最终交付复制到 evidence。

原四类 life 离线故事在上一轮 4/4，本轮未改评分器、语料或人物业务实现，未重复该长基准，也不将旧结果记作本轮重新通过。实际包验收与归档结果在后续追加；包内报告可能停留于打包时点，交付目录旁置报告为最终记录。

### 实际 TGZ 验收

`npm pack --json --pack-destination <交付目录>` 退出 0；包为 `dsh-external-dsh-memory-continuity-0.2.0-dev.3.tgz`，2,587,636 字节，271 个条目，解包大小 5,146,762 字节。SHA-256：`d1e546fd3229b35373d803dcea24fe957c8a9b9ae1f2028bfcfa963b50c996df`。

真实 TGZ 解包后逐条检查路径、类型和唯一性，manifest 中 102 个 src/lib/ui 文件的长度及 SHA-256 全部匹配。`RP_PERSON_BUNDLE` 指向该解包入口；在独立源码目录、使用新安装的真实 SDK 依赖执行：

```text
node --test --test-concurrency=1 test/rp-command-help.test.mjs test/rp-injection-host.test.mjs test/rp-injection-recovery.test.mjs test/rp-management-host.test.mjs test/rp-person-host.test.mjs test/rp-modules-host.test.mjs
```

退出 0，**37/37，0 失败/跳过/取消，24.571 秒**。包括打包入口的真实 SDK 请求路径、工具循环、冷恢复、管理 HTTP、12 个故障/中止场景和中文帮助。模型端为离线测试适配器；网络保护检查保持通过。该组是包验收，单独记录，不与全量 248 项拼接。

交付目录：`D:/Codex/2026-10-20/dsh-rp-memory-dev-3-https/outputs/memory-continuity-0.2.0-dev.3-backend-2026-10-24`。完整源码与 Git blob/CRC 核验结果在旁置 RESULTS 和 evidence 记录。打包后只补报告和计划，没有修改运行代码。
