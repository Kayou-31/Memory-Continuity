# 按需复核与可靠性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 修复已复现的四项正确性问题，加入零模型调用的相似内容人工复核，并测量依赖传播是否值得优化。

**Architecture:** 现有独立核心、授权视图、v1 存储和人工确认继续作为唯一事实边界。新算法只处理当次已验证输入；不增加宿主耦合、后台任务、自动采纳或持久索引。

**Tech Stack:** TypeScript / Node 22，现有 esbuild、node:test、AstrBot Python 离线夹具。

**Spec:** 已批准的 `work/audit-2026-10-27/ALGORITHM-PLAN.zh.md` 与 `AUDIT.zh.md`（基线 ba28665）。

## Global Constraints

- 一个源码执行者、一个只读审阅者；一个重型进程；测试仅隔离合成数据与本机回环。
- 不接付费 API、不启用后台整理、不自动改正史，保留现有前端；后续用户授权了整理页局部精修。
- 保留权限、分支、来源和历史认证；普通分页不因无关追加永久失效。
- 不合并、不推送、不发布；本轮保存可审核改动和命令证据。

## Review Focus

- 参数在首次 await 前及知识检查期间改变，结果始终使用入口快照（Task 1）。
- 删除/关闭发生在最终 seal 读取、提交 rename 进行中或其他实例提交时，不释放旧结果（Task 2）。
- 授权来源删后，旧/新 writer 均拒绝；普通有效设置仍可重试（Task 3）。
- HTTP 超时后偏好不再新发布；真实已发布失败仍可诊断（Task 4）。
- 相似但否定/日期/人物不同的文本不能自动认定重复；截断必须报告覆盖（Task 5）。

### Task 1: 读取输入快照

Files: `src/rp/store.ts`, `test/core-read-lifetime.test.mjs`.
Interface: `readSource(authority, input): Promise<Result<string>>` 不变。
- [x] 用实际核心添加可变 span 测试，运行确认返回了错误正文。
- [x] 在公开入口同步复制并验证，再用同一 span 授权和读取。
- [x] 定向回归通过，记录 RED/GREEN。

### Task 2: 结果释放有效性

Files: `src/rp/store.ts`, `test/core-read-lifetime.test.mjs`.
Interface: 当次读取失败返回既有 `stale_input` / `ownership_lost`，不自动重试。
- [x] 添加最终加载期间 close、privacy_delete 和共享实例写入测试，先看失败。
- [x] 用同步生存检查与共享发布代数覆盖最后等待，不引入读写嵌套锁。
- [x] 验证普通读取、无关追加后固定分页及已有读视图测试。

### Task 3: 经历开关有效来源

Files: `src/rp/experience-candidates.ts`, `test/rp-experience-candidates.test.mjs`.
Interface: `settings().enabled` 只承认有效控制来源；writer 继续绑定策略 ID。
- [x] 删除独立开关来源后，断言 settings 禁用且旧/新 writer 拒绝，先看失败。
- [x] 在一致视图中验证实际有效来源，保留有效审计记录，不隐式回退旧授权。
- [x] 运行经历候选/宿主回归。

### Task 4: 偏好发布取消

Files: `src/rp/person/management-settings.ts`, `test/core-service.test.mjs`.
Interface: 设置保存执行现有 `assertPublicationAllowed()`，不改变提醒开关授权意义。
- [x] 在实际 HTTP confirm 的 sync/rename 之间造成超时，断言旧偏好不变，先看失败。
- [x] 发布前检查外层 guard，保留发布后 uncertain 语义。
- [x] 运行核心服务/确认归档/工作台回归。

### Task 5: 相似复核

Files: 新增 `src/rp/similarity-review.ts`，修改 `src/rp/organizer.ts`, `src/rp/person/workbench-reading.ts`；新增纯算法和整理集成测试、固定评测夹具。
Interface: `review()` 增加独立 `similarity` 结果：groups/pairs、原文证据、差异提示、coverage、work stats；旧 duplicates 不变。
- [x] 固定独立标注例：近似重复、否定、时间变化、不同人物、Unicode、链式相似、热门桶、耗尽预算和删除；先测缺失能力。
- [x] 移植有界 q-gram 候选与全组两两比较约束的思想为 TS 纯函数；保留来源说明，不引入 Python/RapidFuzz。
- [x] 仅读取授权视图并先隔离语义归属，输出建议，不写任何正式/候选记忆。
- [x] 在现有整理页显示相似项、原文入口与覆盖限制；保留原布局。
- [x] 固定数据集对比精确重复基线，测召回/建议准确率/比较次数/耗时/内存。未改善则保留离线实验、不夸大收益。

### Task 6: 依赖传播影子评估

Files: `scripts/benchmarks/dependency-propagation.mjs`（实验）；必要时新增纯 helper 与 `src/rp/store.ts` 的经过验证替换。
Interface: 已验证状态中的 active ID / invalidated ID 集合完全一致；不更改持久格式。
- [x] 链、菱形、多根、缺失依赖、环与重采纳的固定及生成图，对照现有与队列算法。
- [x] 测量操作次数和时间，记录语义未定项，不借优化改变语义。
- [x] 仅在完整一致且收益明确时采用；否则明确延期。

### Task 7: 交付验证

- [x] 一个只读审阅者审查最终 diff，优先处理功能和来源边界回归。
- [x] 串行 `npm run typecheck`, `npm run build`, `npm test`, `npm run evaluate:fixture`, `npm pack --dry-run`；补 AstrBot 离线和新增算法评测。
- [x] `docs/iteration-2026-10-27-review/RESULTS.md` 记录文件、RED/GREEN、完整命令退出码、收益/代价、版本与未验证项。
- [x] 保留本地分支供审核，不推送/合并/发布。


执行决策：相似复核比较有明确归属的有效经历描述，并核对其实际来源范围；不对所有旧聊天片段做模糊归并。依赖传播 76 个影子案例等价，但正常写入顺序无明确收益，保留生产实现。两次完整验收先后暴露读中写入和预算测试遗漏分支，分别修复，完整证据保留，不拼接为通过。

