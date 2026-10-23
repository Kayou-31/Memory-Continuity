# 人物核心 M0–M2 串行实施计划

> Execution: use superpowers:executing-plans; one writer, one final read-only reviewer.

**Goal:** 在现有可信记忆上实现可创建、可绑定、可解释成长的人物，保留独立运行和 Ultra 可选适配。
**Spec:** `docs/superpowers/specs/2026-10-23-ultra-rp-person-core-design.md`，用户于 2026-10-23 批准 M0/M1，验收后继续 M2；明确允许新人物 workspace 要求新版读取，启用前备份。
**Baseline:** `fdd9209f26185e346a862d422005cecd4770117a` / `feature/agent-memory-20261022`。沿用现有 D: 独立开发 checkout，不重新安装依赖。
**Architecture:** TypeScript，现有 v1 branch/global store、canonical commit、journal v2 和 sessionMemoryPolicy/v1；不加入后台任务或付费模型。

## 全局约束及验证

每项先添加失败回归并记录 RED，再实现并记录 GREEN。命令使用 Node 22.23.3；所有重型命令串行，完整输出保存到 `work/person-core-2026-10-23/`。不删除历史日志、不 push、不发布。M0/M1 验收确认后继续 M2。报告分别列出实际 SDK 流程、离线夹具、真实模型未验证边界。

## Task 1 — M0：单操作验证视图

**Files:** `src/rp/store.ts`, `growth-format.ts`, `packet.ts`, `retrieval-index.ts`; `test/rp-read-view.test.mjs`; `scripts/benchmarks/person-read-view.mjs`。
**Interfaces:** `RpStore.withReadView<T>(authority, work): Promise<Result<T>>`；回调取得 fence/events/summaries/projection/sources/可选 audit ledger 以及仅在回调存活期有效的 `readSource(span)`。同一次读取共享来源和事件验证；入口和出口重新验证 authority 和 fence。无跨操作缓存。
**Steps:**
1. 增加真实存储读取计数、投影一致性、回调后拒绝、并发删除及跨 authority 回归；运行定向测试，Expected: 新 API 尚不存在导致 RED。
2. 提取已验证来源/摘要辅助方法，保留权限检查；嵌套复制保留已有成长语义。packet 和检索使用视图，不改变分页/回执规则。
3. 运行定向一致性与宿主工具回归，Expected: GREEN。
4. 同一持久夹具生成 100/260 阶段；分别用基线与新版读取，记录实际耗时、元数据/正文读取次数与耗时、峰值 RSS、字节数。生成耗时单列，Expected: 输出语义相同、重复读取下降。
5. 更新结果，提交 M0。
**Completion:** 原有拒绝边界保留，测量有基线和新版本原始数据，无未解释失败。

## Task 2 — M1a：人物协议与工作区屏障

**Files:** `src/rp/person/{types,schema,format,service,projection}.ts`, 语义 registry、store、canonical、memory、types/schema；人物回归文件。
**Interfaces:** `memory.person.preview(authority,draft,operationKey)` 返回宿主内存 handle 和展示信息；`confirm(authority,handle,userControlSource)` 原子创建；`read(authority,personId)` 读取人物。personId=可信 entityId。草稿限制 64 KiB / 128字段 / 每字段2048 / 32关系 / 16目标 / 合计256事件。
**Steps:**
1. RED：未知实体、重复初始化、未认证 JSON、legacy 字段冲突、原子创建、冷读取、过期预览/不同权限/幂等重试。
2. 统一 marker registry；人物字段存现有 payload key，唯一 fieldId 和显式 person-core/v1 marker；store 所有入口执行冲突规则。
3. 首次人物提交前在 writer lock 下创建可核验的启用前备份；失败时不发布人物事务。事务增加可选 requiredCapabilities，纳入哈希和效果校验，能力只增不减，未知能力拒绝。
4. 用实际 fdd9209 源码测试旧 reader 拒绝整个新人物 workspace；旧 workspace/new reader 兼容；备份原位恢复验证。禁止删事务降级。
5. GREEN：人物起点 occurrence、字段、初始关系/目标同一 canonical commit；正文仍可删除；并发确认最多一个效果。

## Task 3 — M1b：编辑器及真实宿主闭环

**Files:** `ui/person-editor/`, `src/rp-plugin.ts`, journal/session 辅助模块，native host tests，package.json、中文文档。
**Interfaces:** `/rp person preview <draft-json>`、`/rp person confirm <preview-id>`、`/rp person show <entity-id>`、`/rp person use <entity-id>`；preview-id 仅映射宿主私有 handle。编辑器离线导出标准草稿，不写 profile。journal v2 可选绑定及原始 proof；旧会话不回填证明。
**Steps:**
1. RED：未知/过期确认、有历史切换拒绝、空会话绑定、cold resume/continue-clean 原绑定、缺证明 recovery-only、实际请求正确人物。
2. 实现离线表单和导出导入，可信命令预览/确认/绑定；空历史切换，有历史使用 clean root。
3. 真实 SDK + 实际打包验证 standalone/Ultra 共存，浏览器验证编辑器导出闭环。
4. 串行运行 typecheck/build/full test/fixture/pack dry-run，Expected: 全部退出0；写结果并提交 M1。遇到未解释核心失败不进入 M2。

## Task 4 — M2：可解释成长

**Files:** 人物 format/service/projection、可删除候选仓、人物命令与编辑器审阅/时间线、回归。
**Interfaces:** 字段操作 `edit`, `grow`, `set-policy`；策略 stable/growable/situational。候选由明确经历支持，确认最多16条，单初始快照、拓扑排序、全有全无。`edit/set-policy` 只可信用户操作；候选不能解除策略。
**Steps:**
1. RED：稳定字段拒绝成长、缺原因/前驱拒绝、编辑保留过去、策略变更使旧候选过期、情境过期只影响当前值。
2. 实现字段链和成长投影，direct source + dependencyIds，不扩散祖先原文。
3. RED：批量排列一致、冲突原子拒绝、祖先删除/Retcon 的依赖闭包、fixed fork 独立、冷恢复。
4. 实现可删除候选和显式确认、时间线/理由；不自动生成或采纳，不执行外部工具。
5. 真实 SDK 命令闭环与全套五命令验证，Expected: 实际退出0。

## Task 5 — 最终审阅与交付

一个只读审阅者审查整个变更；修复有证据的问题并补 RED/GREEN。最终串行执行五命令并保留退出码，生成实际 TGZ 和源代码/证据包，不覆盖旧交付。`docs/rp-memory-dev3/RESULTS.md` 写明修改、测试、环境、兼容/备份/迁移、限制、已完成/未完成/未验证。只有实测才能声称通过。
