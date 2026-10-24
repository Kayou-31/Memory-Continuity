# M5 人物连续性与分层条件注入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. 串行实现；最后仅一名只读审阅者，不派生子代理。

**Goal:** 把人物连续性、五类记忆、三级深度、确定性条件和中文原因预览接到独立插件的真实请求与恢复路径。

**Architecture:** 在现有 read view 内完成选择和渲染；保留完整 PacketProof 与最终请求门禁。新注入配置只允许空白根会话修改，使用独立持久标记和 journal v2 的严格可选扩展绑定；旧历史不补造证明。预览与真实请求调用同一 planner，明确区分当前选择、仍携带的历史和无法通过校验的历史。

**Tech Stack:** TypeScript、Node 22.23.3、DSH 0.2.1-rc.2、Cordis 4.0.5、Schemastery 3.18.5、node:test、esbuild。

**Spec:** ../specs/2026-10-24-ultra-rp-layered-context-design.md，以下最新指示优先。

## Global Constraints

- 2026-10-24 用户已批准 M5；随后取消单会话压缩，沿用显式 continue-clean。全局记忆复用既有实现。本轮不开发 Ultra 兼容，不依赖 Ultra 优化器。
- 不开启自动摘要、压缩、自动采纳、后台任务，不连接付费 API。
- 在隔离工作树 `work/rp-memory-m5`、分支 `feat/m5-layered-continuity` 实施；从 ee6b5a1 开始，不覆盖既有发布。当前聊天目录不是实际仓库，因此使用 Git 原生 worktree，复用同版本 node_modules junction，不重复安装。
- 数据授权、来源、有效性、冲突与最近至少八个完整回合先于相关性和预算。旧未知结构保守保留，禁止静默截断或放松证据校验。
- 五类功能是选择/表达分类，不是五种权限。三级深度只影响本轮可选证据展开，不修改原始历史。
- 串行运行重型命令；不使用未经测量的内存限制；同类错误两次后分析而非重复。
- 每个实现任务先写失败测试并记录退出码；全量结果必须来自同一次完整命令。

## Review Focus

- 条件不命中时，完整 projection 或 primaryPerson 不得旁路重复泄漏已分类可选字段。
- 新会话配置与人物绑定、条件输入、选择的版本/hash、渲染文本、历史上下文必须绑定一致；旧读取器拒绝新增字段。
- 状态过期/删除/retcon 导致旧历史证明失效时拒绝发送；不能把本轮未选中等同于历史删除。
- 预览不写故事、不发送模型、不认证过时查询结果；实际发出前重新组装并校验。
- 普通话题变化不误判为历史证明损坏；授权变化必须关闭请求。

## Task 1 — 确定性注入 planner 与 packet

- 新增 `src/rp/injection.ts`：有界严格配置、五类/三级、查询和实体匹配、必选/排除/预算解释、中文模型模板、摘要/事件引用、snapshot hash。
- 修改 `src/rp/packet.ts`：可选注入绑定和 preview query；在相同 read view 内选择。旧模式路径保留，新模式独立执行，不调用 Ultra optimizer。
- 新增 `test/rp-injection.test.mjs`：RED → core filtering、directional relation、belief tags、query conditions、pin/exclude conflict、mandatory budget、invalid/stale inputs → GREEN。

## Task 2 — 宿主启用、真实注入、诊断闭环与恢复

- 新增 `src/rp/injection-binding.ts`：严格 config binding、独立持久 marker。
- 修改 `src/rp/host-journal.ts` 与 `src/rp/rp-plugin.ts`：`/rp injection show|set|preview`，只在空白根变更；快照证据、旧历史分组、冷恢复、continue-clean 保留有效配置；不认证已丢失的历史。
- 新增 `test/rp-injection-host.test.mjs`：真实 SDK offline terminal，先 RED 再实现，覆盖实际模型可见内容、预览无模型调用、历史携带、clean continuation、marker/journal 证据删除与恢复拒绝、全局记忆共存。
- 旧 reader 对扩展 journal 的拒绝实测；故障或并发变更不得认证旧状态。

## Task 3 — 中文操作说明与交付验证

- README、设计附录和 RESULTS 写清启用、调整预算、查原因、历史局限与独立能力。预览命令为本批完整可用入口，不额外扩大为重做管理界面。
- 更新包版本与说明为 M5 开发预览；完整串行运行 `npm run typecheck`、`npm run build`、`npm test`、`npm run evaluate:fixture`、`npm pack --dry-run`，再实际 pack 并对 TGZ 运行宿主验收。
- 一名只读整分支审阅者；必要修复按 RED/GREEN，修改影响全量结果时重新跑完整相关命令。保留历史已知问题、失败退出码、未测真实语义质量及长期运行。
- 写入 `docs/rp-memory-m5/RESULTS.md`，更新原总报告链接，不自动 push 或发布。

## Execution Ledger

- Preparation: 从 ee6b5a1 的干净工作区创建隔离分支，保留本地设计提交。全局记忆已有，压缩由用户明确取消。
- Task 1: 已实现。七项 planner 回归覆盖选择、规则、预算、中文词项、主观感受与过期拒绝；完整结果见 RESULTS。
- Task 2: 已实现。六项原生宿主回归和一项真实旧 reader 兼容测试；只读审阅四项问题均有失败回归与修复。
- Task 3: typecheck、build、单次完整 229/229、fixture、四类离线故事、pack dry-run 已完成；独立源码副本 typecheck/build 退出 0，生成 manifest 完全一致。真实 TGZ 的 100 个 manifest 文件通过逐条校验；包内插件真实 SDK 宿主验收 13/13。最终归档校验记录见交付目录旁置 RESULTS。
- 后续用户指示：产品更名 Memory-Continuity；提供浅色/深色参考工作台；前端交外包。最终交接仅列功能需求，不规定框架、接口或布局。
