# RP 人工结构化候选、分层摘要与作业

P4 扩展 P3 的人工 narrator Memory。普通 `/rp accept <sourceId>` 仍只表示用户选定这一版对白；结构化事件与摘要需要独立提案和采纳。SDK `0.2.0-rc.2` 尚无经过可信 admission 的后台候选调用路径，`/rp summarize-auto` 明确返回 `capability_missing`。自动采纳、strict POV、native compaction 均未因此解锁。

## 实际用户入口

先按 [narrator 使用说明](rp-memory-narrator.zh.md) 建立会话，输入剧情。`/rp status` 返回续写候选 source ID；先执行 `/rp accept <sourceId>` 采纳正式续写，再保留同一个 ID 提交下列人工摘要候选。`SOURCE_ID` 要替换成该实际 ID；这里的 `selection` 是真实用户明确指定的摘要范围，`proposal` 是仍须校验的数据。

```text
/rp summary {"selection":{"level":"scene","sourceRevisionIds":["SOURCE_ID"],"dependencySummaryIds":[],"supportEventIds":[],"boundary":"explicit"},"proposal":{"schemaVersion":1,"proposedEvents":[],"proposedSummary":{"level":"scene","text":"艾琳把蓝钥匙放在桌上。","sourceRevisionIds":["SOURCE_ID"],"exactAnchors":[]}}}
```

返回 `candidate_...` ID，不会立即改变有效事件或摘要。`/rp propose` 接受相同格式。用户必须从自己提交的 JSON 审阅候选内容；当前 `/rp candidate` 仅返回元数据，不能查看候选全文。命令不把正文复制进持久回执，以便原始依赖被隐私删除时清理候选副本。

| 命令 | 行为 |
| --- | --- |
| `/rp candidates` | 当前范围内候选 ID、pending/stale/accepted/rejected、事件数、是否有摘要 |
| `/rp candidate <candidateId>` | 校验当前 fence，返回 ID、层级、事件数和原始来源 ID；原文通过既有 `rp_memory_get` 读取 |
| `/rp adopt <candidateId>` | 真实用户操作，来源/权限/branch/global/policy 复验后，原子提交事件、摘要和采纳记录 |
| `/rp reject-candidate <candidateId>` | 记录拒绝决定，不采纳事件或摘要；同一候选不会再被反向采纳 |
| `/rp jobs` | 当前分支作业的状态、总尝试数、ID，以及后台原生生成 blocked 状态 |
| `/rp recover-jobs` | 将遗留 queued/running/prepared/stale 作业置为 deferred；不会重新调用模型 |
| `/rp summarize-auto` | 当前始终 `capability_missing`，额外 provider 调用为 0 |

回执只保存 metadata/ID；候选与 job 输入正文使用 P1 `savePayloadCopy(kind=job_input)` 的可清理 blob，不写入不可删除的 job 记录或事务明文。已发布摘要进入 P3 packet 与实际请求的现有预算/admission 门。发生 retcon、删除或旧宿主历史污染后，既有阻断和干净续接规则仍适用。

## 事件提案及身份

`proposedEvents` 的每项只允许 `payload`、`epistemic`、`sources` 和适用时的 `beliefHolderId`。`sources` 必须是选定有效来源上的 UTF-16 半开引用，带原文和引文 SHA-256，不可切断 surrogate pair。`beliefHolderId` 与 payload 的 subject 保持独立，并须存在于可信 entity allowlist。关系变化还需要选定有效事件作为 trigger；无来源、未知实体和含糊 holder 不生效。

ID、scope、visibility、accepted、authority、fence 与依赖元数据不能从模型输出自报。提案带这些未知字段会被拒绝。world 权威根据真实来源与用户控制推导；原本的台词和信念保留 character_statement，uncertain 保留 inference。锁定 canon、偏好与纠错继续走专用用户控制，不从普通提案扩大权限。

## scene、chapter、arc

scene 使用明确选定的 accepted 原始来源。chapter 指定场景 summary ID 作为 `dependencySummaryIds`；arc 指定 chapter ID。高层摘要的 `sourceRevisionIds` 必须覆盖去重后的全部原始来源，不能把子摘要文字冒充新的原文。子摘要的 support events 和 exact anchors 自动继承；手工提供的锚点仍须逐条核验。

不同受众分区的来源暂时拒绝混合摘要，这是受众交集规则的保守实现。模型或用户提案写入 `public` 不产生授权。明确的 approved_publication 例外仍由 P3 全局发布协议承载。

普通 append 只使正在生成或等待采纳的旧 fence 过期；已发布且依赖仍有效的场景摘要可以继续使用。来源修订/retcon 通过 P1 DAG 使依赖场景、章节、长线和登记 cache 失效；其他独立场景保留。canon/visibility/摘要政策变化另使不适用的摘要失效。

## 作业和验证边界

`CandidateGenerator.generate(input, signal)` 是可信测试/适配器注入接口。它只取得脱离宿主能力的来源片段、已有事件、子摘要、实体列表和规则；没有 store、HostAuthority、commands 或 grants。P4 没有注册任何真实模型 provider、后台 SDK stream、额外 sessionId 或 purpose 例外。

同一根 `MemoryCoordinator` 按真实 profile 目录键维护一个生成槽，覆盖同 root 下不同插件实例、memory 实例及 workspace。生成期间不持写入锁，其他可信输入能够推进 fence；发布重新进入相同 coordinator。该槽是单宿主进程内的合作协调，不宣称多宿主进程排他或原生 compactor 所有权。

job 状态与输入副本仍在 P1 同一 sealed transaction chain；独立 job operation 校验精确 expected state、attempt、身份和幂等 operation ID，不推进语义 `contextRevision`。兼容 P1 的 `CommitBatch.jobs` 原子 enqueue 仍绑定该提交后的 result fence。P4 运行前在 running 记账后确认生成快照；终态 committed 与 summary 在同一分支事务，校验 expected job，不能拆开落盘。取消和异常在 finally 释放根槽；冷恢复只延后，最多三次尝试，持续 stale 第三次后 deferred，没有第四次或热循环。

所有 P4 生成都是固定输出的离线 fixture。取消是合作式协议：generator 必须响应 AbortSignal 并关闭自己的 stream 后才 settle。`timeoutMs` 只是发出 abort 请求，不保证不合作的 generator 在硬截止时间退出；close 会等真实退出，profile 槽也会一直保留，避免底层仍运行时启动第二个任务。真实 SDK stream 关闭、实际模型 usage、输出预留和语义质量未运行。已有 P3 实际叙事请求的 output reserve 与完整预算门继续适用。摘要 `measuredTokens` 标为 estimated，使用 UTF-8 bytes 的保守估计，不是 tokenizer 或收费 token。

`semantic-candidates.json` 给出真实“蓝钥匙”来源、正确摘要和结构合法的“金钥匙”错误摘要。实现代理编写的固定 fixture 标注与 exact-claim scorer 把错误计为 unsupported/critical error。它验证评价报告能拒绝已标注的错误，不证明一般自然语言摘要忠实。人工复核、真实模型质量与 live 扮演均为 not-run，live 样本数为 0。
