# Memory-Continuity 工作台接入与正式发布计划

> **For agentic workers:** 使用 superpowers:executing-plans，在当前隔离分支串行实施；一个只读审阅者，不递归委派。

**Goal:** 将用户交付的视觉工作台接入已实现后端，验证后发布插件包、完整源码和中文说明。

**Architecture:** 复用交付的静态 CSS、双人物身份提示、导航和卡片布局；使用原生 TypeScript DOM 客户端调用既有 snapshot → prepare → confirm。保留 nonce CSP 和离线运行，不携带演示数据库、模拟注入或 CDN。生产数据通过 textContent 渲染。

**Tech Stack:** TypeScript、现有 esbuild/Node 22、原生 DOM 与 HTTP；DSH 0.2.1-rc.2、Cordis 4.0.5、Schemastery 3.18.5。

**Spec:** `docs/rp-memory-m5/FRONTEND-HANDOFF.md`；用户 2026-10-24 提供 `memory-continuity.zip`，授权接入、CU 验证、GitHub 正式发布；随后明确未实现功能仅列未来计划，不扩展开发范围。

## Global Constraints

- 主命令 `/memcont`，兼容 `/rp`；存储协议不升级。
- 不开启后台自动功能，不调用付费 API，不新增 Ultra 兼容。
- 令牌只在内存，初始化立即清除 URL fragment；仅主题可存入 localStorage。
- 当前查看人物与聊天绑定人物分开；注入结果只取服务器真实 planner。
- 一个修改执行者、一个只读审阅者，同一时刻一个重型进程；保留原 ZIP 和所有失败证据。
- 现有功能之外的任意实体创建、批量档案增删、日期有效期、技能学习等写入未来计划，不能模拟成成功。

## Review Focus

1. 撤权后的迟到响应不能重新展示私有人物数据。
2. 网络失败或落盘不确定不得被描述为必然没有写入；确认必须保留幂等 review ID。
3. 页面切换、手动刷新或查看人物变化后，迟到预览不能覆盖当前页面。
4. 窄屏、长中文、键盘、深浅主题与空白工作区必须可操作。
5. Release 的包与源码必须来自最终已测提交，保留未验证范围和未来计划。

## Task 1: 生产客户端与工作台

- [x] 在 `test/rp-workbench-client.test.mjs` 先测试请求白名单、撤权晚响应、确认重试、网络不确定提示，再实现 `src/rp/person/management-client.ts`。
- [x] 复用 `ui/workbench/styles.css`；生成受控静态样式模块。用 `workbench-client.ts` 和 `manager-ui.ts` 实现导航、人物、经历、关系、目标、成长、注入与配置说明。
- [x] UI 仅调用现有管理接口；所有写入先显示服务端 review，明确确认后刷新快照。未来功能列在说明中。
- [x] 运行定向回归，记录 RED/GREEN；保留真实 SDK 宿主测试。

## Task 2: 浏览器及完整验证

- [ ] 启动隔离真实 SDK 宿主，使用 CU 实测创建、预览/取消/确认、证据、成长、注入、刷新、关闭及主题/窄屏。
- [x] 修复实测问题；串行运行 typecheck/build/npm test/evaluate:fixture/pack dry-run。
- [ ] 实际 TGZ 验收、独立源码重建与 ZIP CRC/Git blob 检查。

## Task 3: 正式发布

- [x] 更新中文 README、RESULTS、正式发布说明和未来计划；版本依据远端实际 tags 收口。
- [ ] 只读审阅最终差异，修复阻塞问题。检查远端并保留后续提交，推送、PR/合并和 GitHub Release 按用户已授权执行。
- [ ] 上传插件包、完整源码、校验文件，核验发布页和资产。报告实际完成、未完成、未验证。

## 进度与裁定

- 基线 `561916a`；现有隔离 worktree 与干净工作树已核验。
- 输入 ZIP SHA-256 `570ed14bf19510b68e18e6ae54541ea10522e0e3ccd5f8145a94eeae42b880c2`；22 条目，解压后约 1 MiB。原件及安全解压副本在 `work/frontend-integration-2026-10-24/incoming`。
- 裁定：原型声称替换 API 即可的说明不能覆盖生产数据模型。采用真实功能表单与原型视觉；不移植模拟状态、日期时钟、八个伪模块或 token 预算。
- 只读预审完成，重点确认 hash 路由令牌泄露、假关闭、查询缓存、模拟注入与前端整表写入差异；本轮逐项消除。

- 最终完整 253/253、独立重建、实际 TGZ 19/19 已通过。CU 主要桌面流程通过，窄屏/设备/完整键盘矩阵未验收；状态详见 docs/releases/0.2.0/RESULTS.md。
- 发布按用户明确授权继续执行；最终远端提交、源码完整性和资产哈希记录在 Release 附件 RELEASE-RECEIPT.json，不将计划勾选当作发布成功证据。
