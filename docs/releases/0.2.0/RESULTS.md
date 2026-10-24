# Memory-Continuity 0.2.0 正式版验证记录

日期：2026-10-24。当前发布是在已验证后端上接入交付工作台，不扩展未实现的未来功能。

## 基线与范围

- 工作分支 `feat/m5-layered-continuity`；本轮前基线 `561916a2a336402b365359ef056cde5e0ffa0598`，远端 main `b752fcc7fe8442a1430cc2f255961430d49913a9` 是其祖先，未覆盖后续修改。
- 用户输入 `memory-continuity.zip`：22 个条目，278427 字节，SHA-256 `570ed14bf19510b68e18e6ae54541ea10522e0e3ccd5f8145a94eeae42b880c2`。原件保留；解包前检查路径、重复项、链接与 CRC。
- 采用交付 CSS、布局、双人物身份和视觉语言，使用现有 TypeScript/原生 DOM 接入真实后端。不执行第三方 build.sh，不纳入 demo seed、假 API、CDN、模拟注入或浏览器人物数据库。
- 一个执行者和一个只读审阅者；所有构建、测试和打包串行。无付费 API、后台自动功能或生产 profile 写入。

## 修改文件与原因

| 文件 | 原因 |
| --- | --- |
| `src/rp/person/management-client.ts` | 路由白名单、内存凭证、撤权与迟到响应保护、明确不确定写入提示和同确认 ID 人工重试 |
| `src/rp/person/workbench-client.ts` | 将人物、经历、关系、目标、成长、注入、续接与规则页面接入真实 snapshot/prepare/confirm |
| `src/rp/person/workbench-page.ts`、`manager-ui.ts` | 无个人数据的静态外壳，保留 nonce CSP、textContent 渲染和原后端入口 |
| `ui/workbench/styles.css`、`workbench-style.ts`、`scripts/workbench-style.mjs`、`scripts/build.mjs` | 随插件离线分发双主题样式，构建时生成内嵌样式，不引入新运行时依赖 |
| `test/rp-workbench-client.test.mjs` | 四项请求/撤权/不确定结果/关闭回归 |
| `scripts/host-acceptance/workbench-browser.mjs` | 使用真实 SDK 和隔离 profile 提供人工浏览器验收入口 |
| `package.json`、lock、README、发布说明和报告 | 0.2.0 版本、真实交付范围、安装边界与未来计划 |

## 回归与实际执行结果

工作证据目录：`work/frontend-integration-2026-10-24/`。正式发布附件保留命令日志与截图；不公开本地管理 token、profile 或原始会话凭证。

先增加四项 transport 回归，旧实现 **0/4，退出 1**（`client-red.log`），实现后 transport + 真实管理 host/server **10/10，退出 0**（`client-host-green.log`）。覆盖请求白名单、缺失凭证、403 撤权、旧成功响应、同 review ID 重试、真实关闭和 persistence_uncertain。

| 实际命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `npm run typecheck` | 0 | 完整 TypeScript 检查，2.026 秒 |
| `npm run build` | 0 | 插件、类型、离线编辑器、工作台样式和 manifest，2.279 秒 |
| `npm test` | 0 | **单次完整 253/253，失败/跳过/取消均 0，138.226 秒** |
| `npm run evaluate:fixture` | 0 | 12 个固定样例、49 个标注输出，modelGenerated=false |
| `npm pack --dry-run --json` | 0 | 285 个实际打包条目，文件集合与预期一致 |
| `npm pack --json --pack-destination <交付目录>` | 0 | 实际 0.2.0 插件 TGZ |
| 独立目录 `npm run typecheck`、`npm run build` | 均 0 | 复制 297 个源码文件，未复制 lib；复用锁定依赖，重建 manifest 逐字节一致 |
| `RP_PERSON_BUNDLE=<解包 lib/index.js> node --test --test-concurrency=1 test/rp-injection-host.test.mjs test/rp-person-host.test.mjs test/rp-management-host.test.mjs test/rp-command-help.test.mjs` | 0 | 实际 TGZ 安装到真实 SDK，**19/19**，10.999 秒，零失败/跳过/取消 |
| `git diff --check` | 0 | 无空白错误 |

以上全量执行于全部运行时代码改动完成后。定向测试不拼接成全量通过；后续仅文档、版本元数据排版与打包验收收尾。

实际 TGZ 的 285 个条目和 SOURCE-MANIFEST 中 **111 个 src/lib/ui 文件**均通过路径、类型、长度和 SHA-256 检查。独立重建 manifest SHA-256 为 `ac432b6a844873eae1d1c8677b488bef5ba7a928d4e38b9811587f892c32bf39`。补齐报告后重新打包，仅文档内容变化；最终文件哈希、源码 ZIP CRC/逐条 Git blob 校验和发布提交以附件 `RELEASE-RECEIPT.json` 与 `SHA256SUMS.txt` 为准，避免报告内自引用哈希。

## CU 浏览器验证

运行的是 DSH 精确 SDK 的真实插件入口与隔离持久化 profile，所有表单均调用真实服务端；终端适配器离线，浏览器流程模型调用数为 0。

- 新建人物：服务端预览、取消、再次预览、明确确认；手动刷新后仍可读。
- 经历 → 成长建议 → 人工采纳 → 注入：确认前候选不改变人物，确认后新字段进入实际注入文本。
- 定向关系与承诺：选择真实经历作为依据，服务端预览并确认；实际注入出现关系、相关往事和未完成承诺。
- 浅色/深色主题、中文长文本、原样 HTML 攻击样例、安全显示、实际选择层筛选与 UTF-8 字节说明。
- 关闭入口：服务端撤销、页面清空、全部业务按钮禁用。随后刷新因服务已关闭连接被拒绝，浏览器工具拦截了内置 data: 错误页；未绕过策略。
- 实测发现并修复：busy 时按钮看似可点击但无效、已采纳成长错误使用最新值作“之前”、确认弹窗暴露原始字段名、注入条目不展示实际文本。确认重试提示与刷新取消语义也经只读审阅后修正。
- 测试浏览器警告/错误日志为空（第二轮关闭前读取）。截图保存在发布证据附件中。
- 实际 TGZ 再次启动新隔离宿主，CU 完成人物单字段编辑的前后预览、确认、手动刷新与持久化核对；最终浅/深色表单截图和空错误日志保留。

窄屏模拟能力没有取得可用文档接口；没有改用其他通道操作浏览器。**不声明窄屏/移动设备、完整键盘与读屏器通过。** 三次人工关闭测试宿主的 Ctrl-C shell 退出码为 1，结束回调均成功写入状态并显示模型调用 0；这不是自动测试通过记录。

## 环境、兼容与迁移

Node 22.23.3、npm 11.16.0、TypeScript 5.9.3、esbuild 0.25.12；DSH 0.2.1-rc.2/session format 4、Cordis 4.0.5、Schemastery 3.18.5。Windows PowerShell；沿用锁定本地依赖，无新增依赖、无联网安装。

本轮没有更改存储协议。branch/global v1、host journal v2、M0 人物 requiredCapabilities 与 M5 marker/备份拒绝规则保持；旧版不能读取新人物工作区或未经认证的历史时继续 fail-closed。更名不搬动数据目录，不自动迁移；升级前备份完整 profile。主命令 /memcont，旧 /rp 兼容，没有 /mc。

## 失败、未覆盖与限制

- 首次 Git 访问被本机失效代理 127.0.0.1:12450 阻断。查明配置后仅对本仓库命令临时清空代理，直连 fetch 成功；未修改全局设置。
- 一次工具读取 glob 写法不适用于 Windows，随后改为 rg 的 -g；一次 patch 同路径删除与新增被工具拒绝，未产生部分写入；一次 CU 文档接口不存在，停止尝试。
- 本版没有真实模型语义对照；fixture/life 是固定记录与协议证据，不能解释为真实人格质量。
- 未验证真实生产 profile 升级、真实断电、多日长跑、跨系统/SDK、负载上限与完整设备矩阵。长链仍有全历史认证成本；本地词法检索不等于语义向量。
- 历史对象描述符异常、一次 typecheck 0xC0000005、历史压缩 ZIP 单条目损坏的根因未查明；保留旧报告，最终源码使用未压缩 ZIP 并逐条核验。
- 当前不实现技能学习、复杂用途产品、多人物社会、第三方模块市场、日历提醒或自由增删已有字段。只在发布页列为未来可能方向。
- 管理入口 token 不持久化，刷新整个网页后须从宿主重新获取入口。浏览器只读预览不清理旧聊天上下文；严格删除后仍应干净续接。

## 审查

同一只读审阅者复审客户端撤权、令牌、渲染、实际接口、人工确认及注入绑定，未发现发布阻塞问题。审阅不替代运行验证。此前 M5/后端/命令阶段历史证据继续保留于各原报告，本报告记录当前正式版结果。

## 2026-10-24 仓库正式更名补记

用户明确要求将 GitHub 仓库改为 **Kayou-31/Memory-Continuity**，并更新链接、文档，保留旧地址跳转。已使用官方 REST PATCH 修改原仓库名称，仓库 ID 仍为 `1427477600`；没有创建替代仓库。README、repository 元数据、迁移文档、历史发布文档中的导航链接、本地 origin 以及 5 个版本的 GitHub 发布说明均已更新。操作前的仓库与 Release 元数据保存在本地 `work/repository-rename-2026-10-24/`。

| 实际检查 | 结果 |
| --- | --- |
| 官方仓库改名与 5 次发布说明 PATCH | 退出码 0 |
| 两个历史仓库地址、旧 PR #3、旧 0.2.0 发布页、旧插件下载 URL | 均为 HTTP 301，Location 指向 Memory-Continuity |
| 沿旧插件下载地址跟随跳转 | HTTP 200 |
| 新旧 Git 地址 `ls-remote ... refs/heads/main` | 均退出 0，更名时均指向 `4bb208293d5f60903fd70617566355b7125ed11c` |
| 改名前后全部 Release 附件对比 | **54 个附件**的 ID、名称、大小、digest、状态完全一致；tag 与预览/草稿状态不变 |
| `npm pack --dry-run --json` | 退出码 0，未创建替代正式包 |
| `git diff --check`、旧导航 URL 扫描 | 无空白问题；当前文本文件中没有旧导航 URL |

此次只有仓库、文档与包元数据修改，没有运行时代码修改，因此没有重跑完整测试或重新发布 v0.2.0 资产；上面的 253/253 与 19/19 仍明确属于正式版发布时验证。旧包和标签内文档保持历史快照，通过 GitHub 跳转继续可用。请勿复用旧仓库名，否则会破坏对应跳转。详见 [仓库迁移说明](../../REPOSITORY-MIGRATION.zh.md)。

## 2026-10-24 正式版 README 呈现补记

按用户指定的 LAN-TINA-WS README 重构版本调整首页：居中标题、版本徽章、下载入口、实际工作台截图、功能与命令表格、分步开始、折叠配置/FAQ/历史记录。全部产品描述按 0.2.0 实际范围整理；M5 使用说明和命令速查同步修正残留的开发预览、前端待接入表述，并区分不调用模型的管理预览与使用宿主模型的实际对话。

- 修改 `README.md`、`docs/rp-memory-m5/README.md`、`docs/COMMANDS.zh.md` 和本补记；新增 `docs/assets/workbench-light.jpg`、`workbench-dark.jpg`。两张图片与正式版验收证据的对应截图字节完全一致，1323 × 937；原证据扩展名虽为 PNG，实测内容为 JPEG，因此首页副本使用正确扩展名，没有重新绘制或改动截图。
- 本地文档检查覆盖上述三个使用文档的 **52 处相对链接/锚点/图片引用**，退出码 0；图像解码验证、原证据 SHA-256 对照通过。初次检查发现 Markdown 硬换行的尾空格，已改为显式换行；最终 `git diff --check` 退出码 0。
- `npm pack --dry-run --json` 退出码 0，包含两张截图，共 288 条目；只做打包预检，不创建或替换正式发布物。主要下载链接已与 GitHub 正式 Release 的资产元数据逐项核对。
- CU 已读取 GitHub 实际渲染的完整标题、表格、图片节点与折叠控件；随后尝试收起 GitHub 文件树时页面崩溃，内置错误页被 URL 策略阻断。未绕过限制，**最终像素截图和展开交互复查未完成**。
- 本次没有运行时代码变更，没有重跑全量测试；253/253、19/19 仍只表示上面的正式版发布验收。本次记录保存在本地 `work/readme-refresh-2026-10-24/`，已发布 v0.2.0 标签和附件保持不变。
