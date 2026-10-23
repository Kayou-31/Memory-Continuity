# Ultra-RP-Memory M4 与产品化实施计划

> 使用 superpowers:executing-plans，本会话一个修改执行者，最后最多一个只读审阅者。

**Goal:** 串行交付 M4、统一管理、经过验证的长期存储扩展及正式名称。
**Architecture:** 复用人物核心和宿主控制；管理页使用手动启动的本机服务；存储在 UI 验收后单独实施。
**Tech Stack:** TypeScript、现有 esbuild、Node22、原生 DSH SDK，无新外部服务。
**Spec:** ../specs/2026-10-23-person-m4-product-design.md

## 全局约束

一次一个构建/安装/重型测试；不付费调用；不后台自动工作；保留 RED 和失败证据；不复写稳定版本。当前已有专用 feature checkout，继续原分支，避免复制依赖。用户授权已覆盖实现、打包、推送和正式名称，内部低风险选择记录在本计划。

## Task 1 — M4

- [ ] 新增 `test/rp-life-evaluation.test.mjs`：同 source 错误内容不计支持；遗漏/撤销证据不能得分；重复断言不能加分。先 RED。
- [ ] `scripts/benchmarks/life-score.mjs` 实现明确标注规则 scorer；四类实际 core/SDK 故事，写 JSON 结果到 work。
- [ ] 定向测试、实际离线 SDK 生命周期和长历史串行验证，报告两个对照及未验证模型质量。

## Task 2 — 统一管理

- [ ] `src/rp/person/management.ts` 管理快照与显式动作；`management-server.ts` 本机服务；`manager-ui.ts` 自包含页面；`rp-plugin.ts` 手动 open/close 命令与生命周期。
- [ ] 先 RED：未知 token、外部 Origin、旧快照/篡改动作拒绝；批量候选原子采纳；会话关闭撤权；真实宿主导入/编辑/成长闭环。
- [ ] 实现并验证人物列表/表单、来源时间线、关系/目标和成长队列；真实浏览器交互与 SDK 数据闭环分别记录。
- [ ] UI 验收后才能开始 Task 3。

## Task 3 — 长期存储

- [ ] 根据基准和当前校验路径补充物理布局/迁移设计。
- [ ] 先 RED：跨段读取、旧 reader 拒绝、损坏/缺段拒绝、备份核验、恢复/幂等、控制容量保留。
- [ ] 实现受限显式扩展；证明原历史仍在；记录实际容量、冷读与失败恢复边界。

## Task 4 — 审阅与交付

- [ ] 一个只读审阅者，确认的问题先 RED 再修复。
- [ ] 独立连续执行 typecheck、build、npm test、evaluate:fixture、evaluate:life、pack --dry-run；实际 TGZ 重跑 SDK 验收。
- [ ] 更新 RESULTS、迁移/管理说明、旧文档当前状态；源码 ZIP、TGZ、证据 ZIP、SHA256。
- [ ] 正式更名与 GitHub 分支/PR 更新，不合并 main，不覆盖旧 Release，不发布 npm。

## Review Focus

管理页持有旧快照与并发写的 TOCTOU；Origin/Host/token 泄露和生命周期；部分失败后的幂等；删除后的 UI 缓存；物理分段不得绕过原历史校验。

## 执行账本

- Task 3 implemented: 显式全局分段8/12MiB，旧v1默认不动，真实旧reader拒绝/备份恢复通过；3条初始RED、备份和4097边界RED后修复。宿主+旧global回归15/15；容量/旧reader/4097各1/1。详见RESULTS。单只读审阅已关闭已确认备份问题，数组限制最后补RED/GREEN。开始Task 4集中验收。

- Task 2 complete: 实际浏览器手动全流程，原生SDK管理闭环；只读审阅5项先RED后修复，管理9/9、相关回归37/37、类型检查exit0。截图与命令在同一work证据目录。允许进入Task 3。

- Task 1 complete: scorer RED→2/2 GREEN；四类 core 故事和120干扰4/4；原生SDK12次clean+重建+撤权1/1。首轮脚本/fixture错误保留日志，不是生产回归。实际命令在 work/person-m4-2026-10-23/commands.jsonl。

- 初始：Git clean，HEAD 9eda3d0；PR #1 open，main d114b91。无新增 worktree，沿用用户现有专用开发 checkout。
- Ruling: 真实模型长期质量保留未验证；本轮 M4 先做离线规则和真实 SDK，不调用付费 API，也不以合成输出声称语义质量。
