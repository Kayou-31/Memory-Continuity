# 给 Codex 的完整执行提示词

将下方内容复制给在该仓库工作的 Codex。它授权按方案实施修复和本地验证，不授权自动发布或修改其他仓库。

---

请为 `Kayou-31/dsh-rp-memory` 实施 dev.3 稳定性修复。

先读取本地 AGENTS.md、工作区改动，以及：

1. `docs/superpowers/specs/2026-10-21-rp-memory-dev3-design.md`
2. `docs/superpowers/plans/2026-10-21-rp-memory-dev3.md`
3. `docs/rp-memory-dev3/ACCEPTANCE.md`

审查基线是 `4272dd98ed40afb0b3bb162014c97da0fd49e242` / `0.1.0-dev.2`。若当前 HEAD 已更新，请检查相关差异，保留用户改动，只修仍存在的问题，不回退版本。先报告当前基线，然后直接开展已有授权范围内的工作，无需为每个实现步骤重新向我确认。

### 执行目标

按计划顺序完成 T1、T2、T3、T4a、T5、T6、T4b、T7、T8、T10。T9 作为独立小提交：若实现它，更新评测政策版本；若延后，明确报告旧评测局限。

- 关闭先同步撤销 RP owner，再做异步取消/清理；根门禁不凭 `mode=rp` 放行。
- status 和 continue-clean 能处理失败队列；旧 root 保持 blocked，不能自动重发 ambiguous 输入。
- 在 store.commit 中让受事件改写影响的 source-only 旧摘要和依赖摘要失效，保留原始 source 和其他分支。
- 检索使用稳定视图；回执绑定实际返回的 record IDs/revisions 和内容 hash；旧工具历史不能按当前数据补造 proof。
- 全局写入在 blob/commit 前预检完整 UTF-8 envelope；保留有限控制余量；新事务前先修当前合法头 seal。
- 合并后的 anchors 在保存前校验；批量 retract 基于一个原始 ledger 计算并原子提交。

### 技术和兼容约束

保持 DSH SDK 0.2.1-rc.2、Cordis 4.0.5、Schemastery 3.18.5 和 session format 4 的精确边界。本轮不开放自动摘要、strict POV、原生 compaction，不新增向量库，不重写 branch/global 存储。只升级 host journal 为 v2，并完成兼容读取、备份、recovery-only 和干净续接方案。

保留现有 sessionMemoryPolicy/v1 和唯一共享 coordinator；新增 RP admission 不能替换工程 policy 或引入第二把锁。不得持锁等待同锁队列、whenIdle、外部 verification 或工具 next。模型只能读取；用户采纳/发布和权限校验仍由可信宿主控制。

### 工作节奏

默认一个写代码的 agent；最多一个只读审阅者，不递归派生。任一时刻最多一个安装、构建或测试进程。每项先用最小回归证明失败，再实现、跑该组测试并做小提交。新增测试名称带验收编号，保证计划中的 test-name-pattern 命中。

不要每改一个文件就重复全量测试；最后集中执行一次 typecheck、build、全量 test、fixture 和 pack 检查。有具体失败时只按证据扩大测试范围。不要随意设置 128 MB 内存上限，不并行重试 OOM/超时。遇到 store_locked、EIO、超时或路径问题，记录真实原因、退出码和日志，不改测试来隐藏失败。

测试用临时 profile、确定性故障点和精确 SDK 的合成 terminal，不调用付费模型，不碰真实用户数据。A22 曾在全量运行失败、换临时目录单独通过；这不是全量已通过的证明，请在最终验收如实记录。

### 最终交付

给出改动摘要、提交清单、验收编号映射、实际运行命令和退出码、v1→v2 恢复说明、容量边界、未覆盖项。将结果写入 `docs/rp-memory-dev3/RESULTS.md`。版本目标为 `0.1.0-dev.3`，但只有对应门槛满足后才能称为完成。

不要自动 npm publish、push 或合并；不要把未运行的宿主/最终 TGZ 混装测试写成通过。若精确 SDK 缺少计划需要的能力，给出源码和失败测试证据，保留拒绝门禁，不静默降低安全约束。
