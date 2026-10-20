# 给 Codex 的启动提示词

把完整开发包放到仓库的 `docs/rp-memory-devkit/`，然后复制下面提示词。若目录不同，只改第一段路径。

---

你正在开发我的 DSH 插件仓库。请读取 `docs/rp-memory-devkit/` 中的 00–06 文件，并据此实现 RP 专用插件 `@dsh-external/dsh-rp-memory`。DSH 是运行宿主，Codex 是开发工具。

先读取适用的 AGENTS.md、当前 git 状态和已有进度文件。基线是 `Kayou-31/dsh-ultra-mode@00bc770ef5e0819fb0fb3bee4afbd9576e303364`，Ultra 0.6.0、Memory 0.1.0；如果我本地版本更新，核对相关差异后按当前版本继续，保留我的未提交改动，不擅自回退。

按 02 的 P0–P6 顺序执行。先完成 P0 的实际 pinned DSH SDK 能力探针与既有测试基线，再进入领域与存储实现。文档中的 RpHostAdapter、控制入口和 capability key 都是拟新增应用契约，不能因为文档写了名字就伪造原生 SDK API。未验证能力要明确记录，关闭相应路径，继续完成不受阻的阶段。

产品重点：

1. 单独的新包与 RP 领域模型；复用低层来源／哈希／恢复能力，不把对白写入工程 requirement 或 operations。
2. 全局偏好、世界／角色设定、战役／分支剧情、当前会话／场景分层；全局写入需要真实用户控制或已有明确范围授权。普通剧情不能自动污染其他故事。
3. 仅已采纳版本进入有效历史；生成备选、编辑、retcon、fork、撤回与隐私删除必须联动失效来源依赖、摘要、状态和缓存。
4. world／belief／utterance／uncertain 分开；缺证据不能当作 false；角色知识必须有取得来源，关系具有方向与动因。
5. 保留最近 8 个完整 accepted turn 与当前未完成轮；完整最终请求统一做 scope／branch／revision／POV 过滤。宿主只能追加提示词时禁用 strict POV。
6. 场景、章节和长线摘要保留原始来源与关键锚点；模型只产候选。摘要 job 默认每 profile 并发 1、每任务最多 3 次尝试，提交要校验完整 input fence。
7. 原生压缩单独经过能力门与独占权检查，区别 surfaceCommitted、persisted、lifecycleClosed、recoverable。提交后状态不确定必须阻断实际模型请求，不能假报回滚或清掉 pending 继续。
8. 同宿主按 session 显式选择工程或 RP 模式；双方读取共同 session policy；独立 service 名不足以防止竞争。
9. 完整执行 04 的确定性验收，另列真实模型语义效果未测项。哈希／schema／mock 通过不能证明摘要理解正确。

开发方式：默认你单独实施，必要时最多加一名只读审查者；构建与高占用测试串行。不要设置武断的 128 MB／256 MB 内存上限，不无限重试 OOM、网络或同一个失败命令。同一根因连续失败两次后先诊断并记录，避免原样重跑；继续其他不受影响的工作。

每个阶段先写能证明关键行为的失败用例，再做最小实现并验证。不要创建只有 TODO、空函数或 mock 的插件就宣称完成。测试文件放 `test/rp-*.test.mjs`，确保现有测试命令能发现。每阶段更新 `docs/rp-memory-progress.md`，记录实际版本、修改、验证证据、阻塞、重试次数、检查点和下一步。

不需要为普通可逆的本地编码反复征求确认。若确实被宿主能力或重大需求选择阻塞，先完成其他可用路径，再给出具体限制与可选方案。不要自动修改我的日常 profile、启用真实模型或付费评估、推送远端、发布 npm、增加无关前端／数据库／多 agent 调度。

最终交付源码、可独立安装的 TGZ、capability report、验证摘要、使用说明和未完成项。原生压缩门未通过时如实交付 Memory 档预览，不能把 injection-only 称为已实现历史压缩。

现在开始 P0，并在完成可验证的工作后继续后续阶段。

---

## 新 Codex 会话续接提示词

继续 `docs/rp-memory-devkit/` 定义的 RP 插件开发。先读 `docs/rp-memory-progress.md`、适用 AGENTS.md 和当前 git diff，按上次检查点继续。已完成并有证据的阶段不重做；不要重复已确认的失败命令。核对未完成的 capability 与下一步唯一任务，完成后更新进度。保持单实现者、串行构建和真实验证规则。
