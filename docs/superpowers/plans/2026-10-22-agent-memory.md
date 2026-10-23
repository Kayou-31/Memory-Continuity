# Ultra RP Memory：恢复修复与长期 Agent 成长计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. One writer, serial heavyweight commands; at most one final read-only reviewer, no recursive delegation.

**Goal:** 先修复 REVIEW-2026-10-22 的 A2–A8，再提供独立可用的长期经历检索、关系/目标演化和可选 Ultra 算法适配。

**Architecture:** RP 继续作为唯一记忆事实管理者。修复保持 branch/global v1，host v2 增加可验证 packet 证明，缺少证明的旧历史 recovery-only。成长建立在有来源、显式采纳的既有事件协议上；正常迁移与 retcon 分离，禁止无依据最后写入覆盖。可选 Ultra 适配通过受限的纯算法接口，不让工程运行时接管 RP 历史。

**Tech Stack:** TypeScript、Node 22.23.3、DSH 0.2.1-rc.2、Cordis 4.0.5、Schemastery 3.18.5；无新付费 API，无自动摘要/压缩/采纳。

**Spec:** `docs/rp-memory-dev3/REVIEW-2026-10-22.md` 的 A2–A8、Ultra 与完整人生方向；用户最新授权要求按此顺序实施。细化设计与裁决随任务写入执行记录。

**Baseline:** `85d15e3d3d3b2c4a73a197178b937855d7d05030`；新本地分支 `feature/agent-memory-20261022`，复用现有独立 checkout 和依赖，避免重复安装。发布、push 不在范围内。

## 顺序与完成契约

- [x] F1 / A2：packet.ts 绑定实际注入 records 与投影哈希；host-journal.ts 校验扩展证明；rp-plugin.ts 认证及旧记录 recovery-only。将原生旧摘要复现纳入 test；增加缺证明恢复/证明损坏/无关追加测试。先红后绿，不能靠删除历史 source 修复。
- [x] F2 / A3：global.ts 使发布前失败的 tmp/孤立正文具备确定可回收身份；删除覆盖所有属于失败操作的遗留正文，保留独立 retain 发布。故障注入两阶段、冷启动、错误 manifest、独立副本不误删。
- [x] F3 / A4：store 提供锁内校验并补 seal 的已提交效果确认；canonical/summarizer/jobs/payload copy 快捷返回共用确认路径。连续失败分类、冷重试、同键冲突、不得多发布。
- [x] F4 / A5：允许合法 assistant text 与授权 read tool-call 混合，仍校验每个 block、call 和最终请求；真实 AgentLoop 两轮正反例。
- [x] F5 / A6：统一命令 JSON 解析，将语法/结构错误转 invalid_record，不封锁健康会话；真实 I/O 故障仍 fail-closed。
- [x] F6 / A7：命令 grant 先持久化草案再激活内存；失败清理/撤销临时授权，重试与冷重启验证。不在 coordinator 内嵌套 coordinator。
- [x] F7 / A8：诊断状态区分未绑定、健康绑定和故障绑定；原生 ready/status 一致性回归。
- [ ] L1：细化并实现有界长期经历检索、中文词项/命中摘录与上下文选择，保留固定分页、来源证明和并发前后版本检查；先写跨章节固定语料。
- [x] L2：实现有来源的正常状态/关系迁移，保留前史与因果，拒绝陈旧前提/跨分支/无依据覆盖，retcon/删除后能重新构建。
- [ ] L3：实现长期目标/承诺生命周期与经历关联，提供明确控制命令/查询，纳入 packet/检索和持久化恢复；模型只能提出建议，不能自行采纳。
- [ ] L4：实现可选 Ultra 适配层，以授权 RP 视图作为唯一输入，独立模式始终可用；精确 SDK 下验证有/无兼容 Ultra、加载顺序、预算和旧历史拒绝。
- [ ] V：只读全分支复审、一次串行 typecheck/build/test/evaluate:fixture/pack dry-run、实际新包宿主验证、文档与 RESULTS 更新。声明真实模型、UI、长期运行及未覆盖范围。

每项流程：建立/运行失败回归 → 最小实现 → 相关测试通过 → 记录命令/退出码与裁决 → 再进入下一项。重型命令只跑一个；同错误连续两次停止盲重试并诊断。原始失败记录不覆盖，新增日志按阶段存入 `work/agent-memory-2026-10-22/`。

## 执行记录

- 初始工作区干净，已核实实际 HEAD 与新命名入口。沿用之前的隔离开发 checkout，不触碰远端或日常宿主 profile。
- Ruling：用户已明确授权按审查建议继续开发；不再为每个已授权修复请求重复许可。成长实现先保持显式采纳和现有禁用功能，后续细化不扩大为后台自主执行。
- F1 进行中：host journal 保持 v2，通过可选 packetProof 扩展标识新证明；旧 reader 对未知字段 fail-closed，新 reader 对缺证明历史只允许 recovery-only。没有以当前投影追认旧 packet。

- F1：原生摘要复现和缺证明恢复分别先红（exit1），实现后 packet/receipts/lifecycle 一次定向 20/20（exit0），日志 f1-green.log。没有从后读出的 events 认证先前 packet；证明在 packet 构造时取值。
- F2 Ruling：完整已验证全局历史 + scope writer lock 足以区分已登记发布和从未发布的正文；回收未发布文件及临时文件，不增加第二本操作日志，不删除任何仍登记的 retain/active 副本。异常目录/符号链接拒绝而非跟随。

- F2：原两阶段故障回归先红 exit1；实现后 global recovery/orphans 7/7 exit0。进一步补冷启动、有/无发布重试及相同正文独立 retain 副本，连同 F1 损坏证明恢复，7/7 exit0（f1-f2-boundaries.log）。类型检查初次遇到 Map 联合值推断错误，明确泛型后 exit0（f1-f2-typecheck.log）。

- F3：五个高层幂等路径均先红（f3-red.log，0/5，exit1）；增加 store.ensureDurable 和 payload copy 补 seal，第二次故障仍返回 persistence_uncertain，冷恢复不多发事务。相关 store/summary/seal 45/45 exit0；typecheck exit0。

- F4：纯 tool 对照通过、混合文本基线失败（f4-red.log exit1）；完整 block 白名单验证后，实际 AgentLoop 纯工具/文本+工具通过，未知工具/推理内容拒绝，4/4 exit0（f4-green.log）。该次命令的错误文件名未选中既有 receipts 文件；不把它计入此轮覆盖，最终全量仍会运行。

- F5：7 个命令入口先红（exit1），统一 JSON 语法与对象必需字段验证后，畸形 JSON/primitive/缺字段不污染健康状态。命令与宿主生命周期 16/16 exit0（f5-green.log），I/O/队列失败仍拒绝准入。

- F6：重试成功但 grant journal 不存在的基线先红 exit1。改为持久化草案后才 authorize 并发布内存句柄，失败移除临时文件；原生冷重启重新授权并读到已发布记录。grant/receipts 10/10 exit0（f6-green.log），不嵌套 coordinator。

- F7：健康 ready/status 不一致先红 exit1；状态现在显式区分未绑定/健康/故障/关闭，diagnostic+lifecycle 10/10 exit0（f7-green.log）。七项修复定向验证完成，最终全量尚待新功能完成后统一执行。

- L1 检索阶段：中文连写查询/远端原文摘录先红；rp-terms/v2 使用有界字符双元组、逐词匹配与原文摘录，不声称语义理解。首轮 17/18 暴露 F2 清理对已登记正文的物理删除障碍处理过早；将已登记正文交回 read/purge 协议，复跑 retrieval+orphans 22/22 exit0。保留两轮完整日志，不合并宣称首轮通过。
- L2 设计裁决：在既有 v1 state_change/relationship_change 的 JSON value 中使用 protocol=agent-memory/v1 包装，包含 previousEventId、causeEventIds、note、value；不改变普通 before 元数据行为，不以时间或最后写入解决冲突。store 提交时校验当前前驱和来源覆盖；依赖使用已有 dependencyIds，因此 retcon/删除递归失效、固定分支继承仍适用。新 reader 展开当前值，旧 reader 可读格式但不具备成长投影语义，不承诺语义降级兼容。

- L2：服务缺失 0/3 先红；成长服务、锁内前驱/因果验证和 reducer 当前值展开后，growth+branch 29/29 exit0。补充隐私删除闭包与 null 边界 4/4 exit0，typecheck exit0。保留普通 before 不能解决冲突的原回归。
