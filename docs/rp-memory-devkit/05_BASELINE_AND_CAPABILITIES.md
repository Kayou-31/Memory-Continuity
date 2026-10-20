# 05｜源码基线、接入边界与 Phase 0 能力探针

本文是开发交接说明，不是已实现功能清单，也不是 DSH SDK 文档。Phase 0 结束前，所有新增宿主能力均视为未验证；不得把本文件中的应用适配层接口名称写成宿主现有方法。

## 1. 固定基线与证据层级

本次只读审查基线为 GitHub `Kayou-31/dsh-ultra-mode` 的精确 commit：

```text
00bc770ef5e0819fb0fb3bee4afbd9576e303364
Ultra: @dsh-external/dsh-ultra-mode 0.6.0
Memory: @dsh-external/dsh-ultra-memory 0.1.0
```

版本与构建入口见固定源码：[根 package.json](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/package.json#L1-L56)、[Memory package.json](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/packages/dsh-ultra-memory/package.json#L1-L31)。此后实现应重新记录实际开发 commit，不能继续沿用本基线作为新产物的来源哈希。

| 分类 | 可以如何表述 | 不能由此推导 |
| --- | --- | --- |
| 现状：固定源码已存在 | 某文件实现了某条路径、检查或构建约定 | 该路径已在所有原生版本、桌面端或异常场景通过验收 |
| 拟新增：RP 应用设计 | 拟增加独立包、RP schema、session policy、适配器和探针 | 方法已存在、默认开启、已承诺宿主兼容 |
| 原生未验证：Phase 0 | 需要在精确 pinned SDK 上观察并复现 | 可用自写 mock 的通过结果替代原生证据 |

本次审查没有安装依赖、运行付费模型或验证原生 SDK。因此下文 capability 的初始状态均为 `unverified`。

## 2. 现有能力与安全复用范围

### 2.1 可复用的底层原始证据能力

`EvidenceStore` 已有 source/chunk 标识、SHA256、持久记录完整性检查、宿主来源定位和有预算的检索返回。参考：[evidence.ts:6–26](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/evidence.ts#L6-L26)、[49–59](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/evidence.ts#L49-L59)、[110–185](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/evidence.ts#L110-L185)。公开文本提取明确不索引 reasoning：[memory-host.ts:71–87](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/memory-host.ts#L71-L87)。

建议通过 `src/rp/source-adapter.ts` 在仓库内做源码级复用，并把需要的代码打入独立 RP bundle；现有根包没有公开 `EvidenceStore` 子路径导出，不能通过已安装包的内部 `lib/...` 深导入建立运行时依赖。参考：[package.json:37–46](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/package.json#L37-L46)。

原始证据校验只证明记录与来源文本一致。它不证明回复已被用户选中、不证明内容属于当前故事分支，也不证明某角色知道该事实。RP 的 canonical selection、revision、分支可达性和 POV 授权必须由独立 RP 层决定。`projectId/runId/routeId` 如需用于底层 source 存储，由适配器映射，不能把这些旧字段直接当成故事/分支安全模型。

### 2.2 不直接复用 `MemoryRun` 的工程语义

现有 `MemoryRun` 含 task、requirement、operations、报告、协作路线、阶段和预算账本；`recordTask` 会创建工程需求/项目状态，工具成功返回会写 executed operation；恢复入口也要求核对工程操作账本。参考：[memory-host.ts:277–325](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/memory-host.ts#L277-L325)、[666–683](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/memory-host.ts#L666-L683)、[783–796](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/memory-host.ts#L783-L796)。

因此 RP 角色、关系、世界设定、场景和角色知识不应通过强制类型转换塞入 `ProjectState` 或旧 `SemanticKind`。只复用经过边界审查的低层 source 操作；RP 数据、索引、授权与生命周期另建。

### 2.3 当前压缩不等于 RP 长对话摘要

现有普通压缩主要替换可恢复的旧工具结果；完成轮归档仍检查用户和公开 assistant 文本逐字保留。[context-archive.ts:196–198](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/context-archive.ts#L196-L198)。因此不能承诺“打开当前 Memory 压缩就能把 RP 对话压成剧情摘要”。RP 摘要、证据和 surface replacement 是三个独立能力，必须分阶段验证。

## 3. 拟新增包与文件边界

新增包名为 `@dsh-external/dsh-rp-memory`，目录为 `packages/dsh-rp-memory`。维护源码位于根 `src/`，包内副本由构建生成，不维护第二套算法。

| 拟新增路径 | 边界 |
| --- | --- |
| `src/rp-plugin.ts` | 配置、显式 opt-in、独立 root service、lease 与清理 |
| `src/rp/types.ts` | RP domain schema、版本和 provenance |
| `src/rp/host-adapter.ts`、`capabilities.ts` | 唯一宿主接入面；能力探针结果和兼容门禁 |
| `src/rp/source-adapter.ts`、`store.ts` | 原始来源适配与独立 RP 持久状态 |
| `src/rp/canonical.ts`、`reducer.ts` | accepted/revision/fork 处理及过期提取失效 |
| `src/rp/retrieval.ts`、`packet.ts` | 分支/POV 过滤和有预算的记忆包 |
| `src/rp/session-policy.ts` | RP 与工程模式的共同会话所有权判断 |
| `src/rp/compaction.ts` | 独立门禁；未通过原生恢复/独占验证前不启用 |
| `packages/dsh-rp-memory/{package.json,cordis.patch.yml,README.md,src/index.ts}` | 独立安装元数据与生成核心入口 |
| `test/rp-*.test.mjs` | 根测试命令可发现的回归测试 |
| `scripts/host-acceptance/rp-capability-probe.mjs` | 不调用付费模型的 pinned SDK 原生探针 |

上述均是拟新增文件，不表示当前仓库已有这些文件。具体函数名例如 `observeCanonicalChanges()`、`buildRequestContext()`、`claimSessionPolicy()` 如在交接中出现，只代表应用适配层接口提案；实现前必须映射到探针确认的宿主机制，不能声称 DSH 原生提供这些方法。

## 4. 同宿主共存：先做显式互斥会话模式

现有 `ultraEvidenceSupport` 是根 context 的共享工程证据服务。owner 只允许 `ultra | memory | decision`，优先级为 Memory > Ultra > Decision，并选择整份权威配置。参考：[evidence-support.ts:10–18](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/evidence-support.ts#L10-L18)、[44–48](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/evidence-support.ts#L44-L48)、[126–128](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/evidence-support.ts#L126-L128)。

RP 不得冒用 `owner: 'memory'`，也不得用类型断言硬塞第四个 owner。拟新增独立服务/协议 `dshRpMemory` / `dsh-rp-memory/v1` 和独立存储命名空间，但独立服务名本身不足以防止冲突。

第一版允许同一宿主安装多个包，**每个会话显式选择工程模式或 RP 模式，活动会话内互斥**。共同 session policy 必须被所有相关接线读取：

- RP 会话中，Ultra/Memory 的工程 `beforeStep`、entry、上下文 injection 和 compactor 必须跳过；协调插件的其他直接接线也要盘点，不能只改一个监听器。
- 工程会话中，RP 的记忆包、提取任务和 compactor 不运行。
- session policy 要固定会话身份和模式，异步准备后重查；切换模式先停止活动请求并排空写入，不在一个请求中混用两种上下文。
- 最初只支持关闭状态或新会话进入 RP；带已提交工程 `arc_` 检查点的活动会话，不得为切换模式直接撤掉仍依赖的恢复 reader。
- 共同 policy 未实现或未通过共存验收时，拒绝冲突模式启动，而不是悄悄同时运行两个 compactor。

现有服务确实会在 pre-step 调用工程 memory 并追加工程恢复入口：[evidence-support.ts:78–96](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/evidence-support.ts#L78-L96)。当前 compactor 通过 `ctx.get('compaction')` 判断原生 owner：[memory-host.ts:900–920](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/memory-host.ts#L900-L920)。若 RP 只注册一个私有服务，它未必会被这个检查发现。因此“`compaction` 为空”也不能单独证明无其他插件改写 surface。

## 5. 构建系统必须显式修改的地方

当前附属包不是自动发现的。固定源码：[build-companions.mjs](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/scripts/build-companions.mjs#L22-L72)。

| 现有位置 | 修改要求 |
| --- | --- |
| `companionAcceptanceFiles` 第 23–30 行 | variant allowlist 目前只有 memory/decision；为 RP 定义自己的离线脚本闭包，不机械复制在线实验脚本 |
| `buildCompanions` 第 38–40 行 | 循环和 `packages/dsh-ultra-${variant}` 目录公式改为显式 descriptor；直接加 `rp` 会生成错误目录 |
| 第 46–49 行 | descriptor 显式指定 `src/rp-plugin.ts`，保持自包含 ESM bundle、native externals 和 sourcemap |
| 第 51–54 行 | 保留非原生 runtime dependency 检查，不偷偷加入外部数据库/embedding 依赖 |
| 第 56 行 | 当前只有 Decision 构建 client；RP UI 能力未验证前不新增虚假的 client 集成 |
| 第 57–71 行 | 验收脚本、入口、构建来源和产物 SHA 写入 RP source manifest |
| 第 43–44 行 | 当前复制全部 core source/types；若缩小 RP snapshot，必须准确记录依赖闭包，不能宣称当前复制逻辑已隔离所有源码 |

推荐 descriptor 映射：

```text
memory   → packages/dsh-ultra-memory   → src/memory-plugin.ts
decision → packages/dsh-ultra-decision → src/decision-plugin.ts
rp       → packages/dsh-rp-memory      → src/rp-plugin.ts
```

根 `tsconfig.json` 已包含 `src`，通常能覆盖 `src/rp-plugin.ts` 与 `src/rp/**/*.ts`；`src/client` 被排除，UI 需要单独处理。[tsconfig.json:12–19](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/tsconfig.json#L12-L19)。

**防漏测试要求：**根测试命令为 `node --test test/*.test.mjs`，不会自动覆盖 `test/rp/*.test.mjs`。优先使用 `test/rp-*.test.mjs`；如改测试发现规则，必须用一个故意失败的临时探针证明新路径确实被执行，随后移除该临时探针。[package.json:48–56](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/package.json#L48-L56)。

## 6. Phase 0：在本地 pinned SDK 上证明能力

使用独立临时 profile、固定 SDK/package 精确版本和合成 fixture；网络 guard 默认拒绝外网。不得加载日常桌面 profile、真实凭据、真实用户故事，也不得为探针调用付费模型。模拟 provider 可用于驱动真实宿主生命周期，但 mock 结果不能证明真实 provider 的质量、价格或服务行为。若本地缺少 SDK 或 UI 环境，记录 `unverified` 及缺失条件，不安装不明版本后声称兼容。

统一状态只有：

| 状态 | 含义 |
| --- | --- |
| `verified` | 对指定精确环境运行原生探针，断言通过且证据可复核 |
| `unsupported` | 已核实该环境没有所需机制，或明确不支持该操作 |
| `failed` | 已执行探针但行为不满足契约，保留失败 trace |
| `unverified` | 尚未运行、证据不足或环境缺失 |

属性存在、类型声明可编译、单元 mock 通过均不足以单独标为 `verified`。

| capability key | 必须证明的原生行为 | 不满足时的产品门禁 |
| --- | --- | --- |
| `canonicalReplySelection` | 完成、流式中止、失败、用户选择替代回复分别产生什么事件；generation complete 是否等于 accepted；选中项的稳定 ID 是否持久 | 使用显式人工选定 canonical，禁止自动把每个 assistant 完成事件写成剧情事实 |
| `messageRevisions` | 用户/assistant 编辑、再生成后的 ID、seq、revision、旧版本失效及重启恢复；异步提取基于旧 revision 时被拒绝 | 无可靠 revision 映射则关闭自动提取/提交，保留人工确认 |
| `forkLineage` | fork 的父子关系、继承范围、分支选择和旧分支可达性；分叉后事实不会互串 | 不支持自动分支；禁止以仅有 sessionId 的粗过滤冒充 lineage 隔离 |
| `requestInjection` | 记忆包能进入最终 assembled request；角色/source、顺序、幂等性与 system/tools/pending messages 一致；重复 pre-step 不重复注入 | 仅展示记忆包或人工使用，不声称模型已看到 |
| `requestContextFiltering` | 能审查/替换整个最终请求的所有模型可见内容，包括最近原始消息、system/developer、工具返回、记忆包和 pending 输入；所有请求路径受同一 policy 约束 | 只能追加时仅允许明确的 `narrator` 模式，不能开启 strict POV，不能承诺角色秘密隔离 |
| `durableSurfaceReplacement` | pinned surface API、合法替换跨度、seq/generation 变化、raw log 保留、持久化及重启 replay；并发 append 后必须拒绝旧准备结果 | 仅注入，不做 surface 压缩；不能用任意截断历史代替 |
| `lifecycleRecovery` | compaction start/summary/replace/end 分别失败、中止、重启的恢复规则；区分 committed、durable、closed；未关闭 lifecycle 不能清 pending 放行 | 阻止后续业务/model admission，恢复或明确终止；不伪称回滚 |
| `tokenAccounting` | 最终请求包含的 system/tools/messages 与 pending，meter pressure 与 provider usage 的区别，压缩后重测和预留预算；计数不因重复 hook 翻倍 | 使用明确标注的保守估计和更严格预算；不宣称精确计费 token |
| `exclusiveCompactionOwnership` | RP/工程/native 三方所有权、两种加载顺序、卸载/关闭/切换权威；任何同会话第二 owner 都明确拒绝 | 关闭压缩，或拒绝冲突 session mode |
| `modelInvocation` | 原生模型服务是否存在、受支持的调用方式、取消/超时、结构化结果、用量归属；使用本地合成 provider 驱动真实调用路径 | 不调用模型，保持确定性记录或人工确认；不虚构 `ctx.llm.extract()` |
| `uiIntegration` | 宿主是否有受支持的设置/状态/编辑器入口；权限、重连、刷新、会话选择是否正确 | 记录 headless/配置方式；不能声称已有桌面 UI 或表单 |

### strict POV 的不可省略门禁

只过滤长期记忆检索结果仍可能泄露秘密：角色不知道的秘密可能已经出现在最近 assistant 原文、工具结果或系统附带资料中。strict POV 要对**整个最终请求**执行授权投影，然后在最终 model boundary 断言没有未授权材料；检索过滤与提示词要求“不要泄露”都不能替代这一条件。

若宿主只允许追加记忆消息，产品可提供 narrator 模式：明确告知叙述者模型可能看到完整故事材料，角色视角只是一种叙事约束。该模式不得标为角色秘密隔离。探针必须捕获实际最终请求，不能仅检查 `packet.ts` 返回的局部字符串。若某调用路径无法观察/过滤，strict POV 对该路径保持关闭。

### 最小可填写报告

下例为**应用适配层报告提案**，不是 DSH 原生返回值。执行者补全版本、probe、证据和限制，不得预先填通过数。

```json
{
  "schemaVersion": 1,
  "baselineCommit": "00bc770ef5e0819fb0fb3bee4afbd9576e303364",
  "host": { "packageVersions": {}, "sessionHeaderVersion": null },
  "evidenceRoot": null,
  "capabilities": {
    "canonicalReplySelection": { "status": "unverified", "probe": null, "evidence": [], "contract": null },
    "messageRevisions": { "status": "unverified", "probe": null, "evidence": [], "contract": null },
    "forkLineage": { "status": "unverified", "probe": null, "evidence": [], "contract": null },
    "requestInjection": { "status": "unverified", "probe": null, "evidence": [], "contract": null },
    "requestContextFiltering": { "status": "unverified", "probe": null, "evidence": [], "contract": null },
    "durableSurfaceReplacement": { "status": "unverified", "probe": null, "evidence": [], "contract": null },
    "lifecycleRecovery": { "status": "unverified", "probe": null, "evidence": [], "contract": null },
    "tokenAccounting": { "status": "unverified", "probe": null, "evidence": [], "contract": null },
    "exclusiveCompactionOwnership": { "status": "unverified", "probe": null, "evidence": [], "contract": null },
    "modelInvocation": { "status": "unverified", "probe": null, "evidence": [], "contract": null },
    "uiIntegration": { "status": "unverified", "probe": null, "evidence": [], "contract": null }
  },
  "allowedModes": [],
  "limitations": []
}
```

每项 evidence 应指向可复核的本地测试断言、脱敏事件 trace/最终请求 fixture 和重启结果；必须保留负例。CLI/session 探针、UI 验收和未来模型质量评估分开报告。未运行模型不影响判断某个本地原生调用入口是否可用，但不能因此声称在线模型已验证。

## 7. 四项既有风险作为复用回归项

以下是源码审查发现及待原生复验风险，不要求为本 RP 工作修复所有无关旧代码。只有实际复用到的路径必须通过回归；不复用的路径注明隔离边界。

| 回归项 | 固定源码证据 | RP 验收要求 |
| --- | --- | --- |
| 早期 knowledge/rich 阻塞后续归档 | `selectPrefix` 只选择位置前缀并遇到不合格事件停止；选中段含 rich/knowledge 时整段拒绝：[context-archive.ts:122–143](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/context-archive.ts#L122-L143)、[185–189](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/context-archive.ts#L185-L189) | 构造早期阻塞事件；不得承诺任意后续片段都会归档或强达 token 目标。若设计新选择器，必须另证工具配对、完整轮次和恢复身份 |
| lifecycle 未关闭时 pending 被过早清除 | 归档有独立 `closed` 状态，而恢复检查在已验证 capsule 数匹配后清 `archiveRecoveryPending`：[context-archive.ts:163–165](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/context-archive.ts#L163-L165)、[208–234](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/context-archive.ts#L208-L234)、[memory-host.ts:378–384](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/memory-host.ts#L378-L384) | 注入 compaction/end 失败并重启；receipt 可读取不等于 lifecycle 已关闭。确认最终放行同时满足闭合、持久与恢复 reader 可用 |
| 全局 get 分页正文随 verification 变化 | 每次 get 重新核查来源，把 verification 序列化进正文后按 offset 分页：[knowledge-host.ts:210–225](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/knowledge-host.ts#L210-L225) | 多页读取间改变来源可用性；不把变化正文当稳定页流。RP 使用固定 snapshot/revision/content hash，禁止静默拼接不同版本 |
| publisher/key 版本链与 root rebind 冲突 | 版本组只按 publisher/key：[knowledge-store.ts:104–105](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/knowledge-store.ts#L104-L105)；精确 supersedes 链：[255–276](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/knowledge-store.ts#L255-L276)；授权绑定 canonical root：[knowledge-host.ts:73–98](https://github.com/Kayou-31/dsh-ultra-mode/blob/00bc770ef5e0819fb0fb3bee4afbd9576e303364/src/knowledge-host.ts#L73-L98) | 同一 publisher ID 重绑 root 后，旧链不可见与新发布链前驱要求要有明确行为；不沿用该链当 RP 世界身份，不为通过测试扩大旧授权 |

## 8. 最终包验收清单

- 根 TypeScript/typecheck 与既有包回归通过；验证新测试确实被发现。
- RP manifest、patch 身份、`lib/types/rp-plugin.d.ts`、入口、source manifest 和声明一致。
- 从最终 TGZ 在无仓库、无 Ultra/Memory 同级包的隔离 fixture 中导入，确认自包含；metafile 不包含仓库相对运行时依赖。
- 构建保持现有 Memory/Decision 产物行为；重复构建不依赖旧生成文件。
- pinned 原生离线加载、卸载、应用退出、写入中止和重启恢复可复现。
- 两种安装顺序、RP/工程 session policy、模式冲突拒绝、单 lease 释放与最后清理均有负例。
- canonical、revision、fork、过期提取拒绝和 POV 过滤测试检查实际数据和最终请求；不能只验证“相关文字出现过”。
- 只有 compaction 全部能力通过才启用压缩；仅有 capture/injection 通过可以发布受限模式，但必须如实列出限制。

本文交付范围是设计与开发交接，不包含产品实现、依赖安装、原生探针执行、线上模型实验或上传发布。
