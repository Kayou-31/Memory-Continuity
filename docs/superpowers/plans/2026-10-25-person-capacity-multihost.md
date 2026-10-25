# 完整人物资料与多宿主分包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user explicitly chose serial implementation by the primary agent, with at most one read-only reviewer and no recursive delegation.

**Goal:** 完整保存和管理人物资料，将每次请求中的记忆内容限制在明确的 32,768 token 预算内，交付可独立安装的核心、DSH 和 AstrBot 包，并分别验证两种 OneBot QQ 接入。

**Architecture:** 沿用 `src/rp` 的 TypeScript 存储核心、认证快照和人工确认，不重写 Python 数据库。新增文档能力与版本化计量，再提供受认证的独立核心服务；DSH 入口、AstrBot Python 插件和发行物各自独立。核心独占同一 profile 的写入权。

**Tech Stack:** TypeScript、Node.js 22+、esbuild、node:test；DSH 0.2.1-rc.2/rc.3；AstrBot v4.29.3 Python 插件；OneBot v11。

**Spec:** [已确认设计](../specs/2026-10-25-person-capacity-multihost-design.md)

## Global Constraints

- 用户已确认方案并授权实施细节由开发者决定；持续串行执行，不再按任务索取许可。
- 32K = 32,768 token，所有主动记忆注入及实际请求中保留的记忆工具回填合计计量；没有匹配 tokenizer 就标明保守估算，不能冒充精确计数。
- 不假设 1M 上下文；完整请求、输出与工具预留仍校验。没有可信宿主准入能力的路径不宣称兼容。
- 原文单文档 1 MiB UTF-8；完整保存，不自动摘要、自动采纳或压缩。分块不得切开代理对，不把“分块”作为删字理由。
- 旧 v1 预算、branch/global 数据语义保留；新能力先备份，再持久化 requiredCapabilities；旧读取器拒绝未知能力。
- 只用合成公开 fixture；私人附件、凭据、真实历史不进入 Git、日志或发布包。
- 同一时刻最多一个安装、构建或重型测试；最多一个只读审阅者，无递归代理。两次相同错误后先分析根因。
- 分包：核心、DSH、AstrBot、源码；NapCat/Snow Luma 是接入端。无自动系统服务和开机任务，无付费 API。
- 用户后续授权共同日记：显式开启后AI可通过专用工具写/修订自己的日记，无须逐篇确认；普通记忆工具仍只读，不能写用户日记或修改事实。所有影响后续对话的人工变更默认显示统一影响弹窗，可在工作台设置关闭；版本和权限校验不能关闭。

## Review Focus

- CRLF、BOM、emoji、组合字符和 Markdown 未知标题：原文可按哈希完整往返，未知内容保留。任务1、2。
- 同长度修改、缓存命中与并发撤销：不得再用长度或文件名猜版本。任务2、4。
- 群内冒充私聊对象、跨账号相同消息 ID、重连：权限先于相关性，幂等命名空间不随 socket 变化。任务3、8、9。
- 工具循环和 fallback 切模型：重新计量并准入，不复用旧 tokenizer 或旧记忆证明。任务4、8。
- 超限、断电、第二写入者和不确定发送：旧数据可读、可恢复；不重发 ambiguous 输入。任务2、7、8。

## 文件边界

保留现有生产代码位置和 DSH 包入口。新增人物文档代码置于 `src/rp/person/documents/`；计量置于 `src/rp/token-budget.ts` 及 `src/rp/tokenizers/`；独立宿主接口和 RPC 置于 `src/core/`；核心发行 manifest 在 `packages/core/`；Python 插件在 `adapters/astrbot/`。构建脚本负责从唯一实现产出各包，不复制存储实现。

本计划的短期执行记录使用 `.superpowers/sdd/2026-10-25-person-capacity-multihost/progress.md`，公开结果继续追加到 `docs/framework-evolution-2026-10-25/RESULTS.md`。每项先写失败测试，保存失败原因，再实现、验证和提交；实际命令及退出码随任务记录。

### Task 1: 无损文档解析与边界

**Files:** 新建 `src/rp/person/documents/schema.ts`、`types.ts`、`import.ts`；导出于 `src/rp/memory.ts`；测试 `test/rp-person-documents.test.mjs`。

**Interfaces:** `importPersonDocument(input: {documentId:string;personId:string;title:string;format:'text'|'markdown';text:string}): PersonDocumentDraft`；`validatePersonDocument(input:unknown): PersonDocumentDraft`。草稿含协议、原文字节哈希、原文、按 UTF-16 定位的 sections/chunks；分类枚举 `persona|rule|program|memory|knowledge|unclassified`。每块最多 8192 UTF-8 字节；总原文最多 1048576 字节；自动解析只创建待审草稿，不赋予记录权威。

- [x] 写测试：完整拼接等于原文（含 BOM/CRLF/emoji）；1048576 字节通过、1048577 拒绝；标题和正文非法控制字符/孤立代理项拒绝；未知标题归待分类；相同输入产生相同段落标识；不接受伪造哈希、间隙/重叠范围和多余权限字段。
- [x] 运行 `node --test --test-concurrency=1 test/rp-person-documents.test.mjs`，确认缺少新导出导致断言失败。
- [x] 实现纯解析和验证，UTF-16 定位与 UTF-8 容量分别计算；禁止执行 Markdown/HTML；索引仅是待审草稿。
- [x] 重跑同一文件并运行 typecheck，检查边界证据。额外补了特殊对象属性名标题和同长度尾部修改回归，最终7/7。
- [x] 提交 `feat: add lossless bounded person document drafts`。

### Task 2: 文档持久化、备份与撤销

**Files:** 新建 `src/rp/person/documents/service.ts`、`format.ts`；修改 `store.ts`、`canonical.ts`、`semantic-registry.ts`、`person/projection.ts`、`memory.ts`；测试 `test/rp-person-document-store.test.mjs`。

**Interfaces:** `memory.documents.preview(authority,input,key)` 返回不透明预览句柄、内容哈希、fence 与差异；`confirm(authority,handle,controlSource)` 原子发布；`read(authority,documentId)` 在当前认证 read view 上还原文档；`retract` 复用人工控制和依赖失效。新的 semantic marker 与 `rp.person-documents/v1` workspace capability 一同验证，不接受正文自报协议。

- [ ] 写失败测试：原文保存/关闭/重新打开字节一致；被改写 chunk 哈希拒绝；过期/跨权限/重复确认行为；故障注入不发布半份文档；实际旧 0.2.1 reader 拒绝新能力、完整备份可恢复。
- [ ] 运行 `node --test --test-concurrency=1 test/rp-person-document-store.test.mjs` 并记录失败。
- [ ] 复用源 blob、来源 span 与受认证语义标记。原文一次存储，事件只保存必要定位/分类，不在每块重复整篇文档。完整事务 envelope 预检失败后旧版本仍可读取。
- [ ] 验证撤销、retcon、privacyDelete 与兄弟分支隔离；静态blob扫描不能返回未接受内容。执行文档、store、read-view 相关测试及 typecheck。
- [ ] 提交文档持久化功能及证据。

### Task 3: 细分类与受众条件

**Files:** 新建 `src/rp/person/documents/selection.ts`；修改 `injection.ts`、`injection-binding.ts`、`person/management.ts`；测试 `test/rp-person-audience.test.mjs`。

**Interfaces:** `AudienceContext` 从可信宿主能力获得；`selectDocumentSections(view, context, query)` 只返回当前可见的条目与引用。公开、指定对象/群条件存入认证记录，模型输入不能覆盖 AudienceContext。

- [ ] 写失败测试：相同人物在群/私聊选入不同语气样例；冒充对象的正文不提升权限；索引、原因、命中数不泄漏不可见内容；pin 不复活过期/删除/不可见条目。
- [ ] 运行受众测试并记录失败。
- [ ] 实现先权限后条件的选择；分类自定义标签与权限隔离；旧字段语义保持，旧 voice 的必需行为只有用户明确迁移才改变。
- [ ] 串行验证新测试与旧分层注入测试，提交。

### Task 3a: 双方共同日记与受限 AI 写入

**Files:** 新建 `src/rp/diary/{types,schema,service,tools}.ts`；修改 `semantic-registry.ts`、`store.ts`、`memory.ts`、`modules/contract.ts`、`rp-plugin.ts`；测试 `test/rp-diary.test.mjs`、`test/rp-diary-host.test.mjs`。

**Interfaces:** `memory.diary` 的人工管理能力和 `DiaryWriter` 分离；`DiaryWriter` 由显式开启的实际宿主会话颁发，只能创建或修订对应AI作者的记录。`write({title,body,previousRevision?,key})` 不接受 author/scope 等自报权限；绑定工具调用、来源、版本和幂等键。正文16KiB UTF-8、标题256 Unicode码点；读接口通过同一授权read view，条目标注作者和主观日记类型。

- [ ] 写失败测试：默认无AI写权限、开启后无需逐篇确认、关闭立即撤权；伪造作者/覆盖用户日记拒绝；重试不重复、过期修订拒绝、冷启动保留原稿和修改者；跨群/人物/分支不泄漏。
- [ ] 执行日记测试记录RED；在真实DSH SDK工具调用中验证实际工具权限、返回回执、停用和结果不确定时不重放。
- [ ] 实现专用日记协议和作者能力，不伪造每篇 user_control，不自动把日记提升为世界事实。用户编辑AI日记保留作者与人类修订归属，隐私删除清除各版本及派生结果。
- [ ] 吸收用户认可的 retcon-form 思路：自由正文之外提供可选“当时的理解、依据、适用情境、后续修正”结构；证据引用必须绑定本项目可验证片段，修正追加版本并使旧推断退出当前检索。格式完整性和片段覆盖不作为理解或事实真假的分数，普通日记不强填研究表。
- [ ] 复测日记、来源认证、隐私删除与准入；把检索结果纳入Task4预算、把管理界面和额外提醒开关纳入Task5，提交。

### Task 4: 明确的 32K token 预算与实际请求门禁

**Files:** 新建 `src/rp/token-budget.ts`、`src/rp/tokenizers/`；修改 `packet.ts`、`rp-plugin.ts`、`injection.ts`、`injection-binding.ts`、`host-journal.ts`、`retrieval.ts`；测试 `test/rp-token-budget.test.mjs`、`test/rp-token-budget-host.test.mjs`。

**Interfaces:** `MemoryBudgetV2` 明确 protocol、unit:'tokens'、limitTokens 默认32768、meter identity；`measureMemoryRequest(parts, meter)` 按实际发送顺序计量，包括保留的记忆工具返回；计数器绑定模型+tokenizer修订。新配置显式升级，旧数值继续按旧语义读取。实现时选用可离线验证的本地 tokenizer，具体选择写入执行记录。

- [ ] 写失败测试：32768通过/32769拒绝；包装和重复内容计入；中文、英文、emoji；必需内容不可越界；工具返回不绕过总额度；未知模型降级标明；切换模型撤销旧证明。
- [ ] 运行预算测试记录失败；使用真实 tokenizer 的固定向量另证计数能力，不能拿伪计数器当宿主精确计数验收。
- [ ] 实现预算分配、可选内容退让与完整请求再校验；记忆工具分页先选后认证，不能截断已认证结果。没有可信完整请求计量的部分保留保守保护并明确显示。
- [ ] 在实际 DSH rc.2/rc.3 离线 provider 上验证多轮工具、并发删除、动态输出预留、模型切换和超限零下游调用。
- [ ] 提交预算功能；若精确 tokenizer 不可验证，记录具体阻塞，只交付明确标注的降级方式，不伪报32K精确支持。

### Task 5: 工作台与导入命令

**Files:** 修改 `person/workbench-client.ts`、`person/management.ts`、`person/management-server.ts`、`person/editor.ts`、`command-help.ts`；新增文档管理与预算 UI 测试。

**Interfaces:** 管理 API 通过短期 upload/preview/confirm 句柄导入，固定可接受 MIME/编码、上限和认证；命令引用短句柄。前端只展示真实后端结果，不自行计算可信状态。

- [ ] 写失败测试：大文档上传可预览/撤销、未知部分保留、同长度尾部变化显示；受众条件编辑、预算单位与降级提示；过期管理会话和跨origin写入被拒绝。逐类验证影响后续对话的人工操作出现影响预览，工作台设置关闭后不弹额外提醒且保持明确保存/权限/版本校验；搜索和主题切换不弹，AI不能修改偏好。
- [ ] 运行对应管理和工作台测试记录失败。
- [ ] 接入新文档、分类、语气样例、共同日记与用量预览；日记展示双方作者和版本，用户写日记可被绑定人物检索。服务端统一生成行为影响说明，工作台设置“修改前提示对后续对话的影响”默认开启，可持久化关闭，覆盖人物/规则/关系/目标/记忆/日记/删除/注入/可见范围/绑定/AI写入授权，避免重复弹窗。复用现有浅/深色视觉；更新 `/memcont` 帮助。
- [ ] 实际浏览器验证导入→预览→确认→重开→导出、预算预览与切换主题；记录未覆盖项，提交。

### Task 6: 核心分包

**Files:** 新建 `packages/core/package.json`、`src/core/index.ts`；修改 `scripts/build.mjs` 或拆出 `scripts/build-core.mjs`；新增 `test/core-package.test.mjs`。DSH根package保留现名和入口；AstrBot稍后独立ZIP。

**Interfaces:** 核心TGZ导出经审查的应用级bootstrap和数据契约，仅依赖 Node 或本地捆绑的计数器；不能暴露DSH初始化导入。完整源码包包含所有适配源码，DSH插件包不含Python运行依赖。

- [ ] 写失败打包测试：在没有DSH包的隔离目录安装/加载core，保存和冷启动读取；检查依赖与文件manifest；DSH原入口仍可加载。
- [ ] 运行分包测试确认失败。
- [ ] 产出核心包和DSH包，构建依赖分离，不复制存储源码，不修改共享node_modules。
- [ ] 对真实TGZ逐一检查文件/hash并进行隔离运行，提交。

### Task 7: 本机服务与单写入者

**Files:** 新建 `src/core/server.ts`、`rpc.ts`、`owner.ts`、`cli.ts`；测试 `test/core-service.test.mjs` 与独立子进程验收脚本。

**Interfaces:** 显式 `memcont-core serve`，loopback认证；RPC只使用受限句柄，真实Authority在服务端；管理能力与只读工具能力分离。owner覆盖整个profile和嵌入式DSH入口，真实第二进程被拒绝。连接信息只在明确管理入口显示。

- [ ] 写失败测试：无凭据/错误origin/伪造权限拒绝；并发第二writer拒绝；重启使旧句柄失效；写入中断和重复confirm冷恢复；超时不永久锁住profile。
- [ ] 运行服务测试确认失败。
- [ ] 实现有界消息、超时、取消、持久化幂等、管理入口及明确所有权恢复；不添加自动服务。
- [ ] 真实两个Node进程及断开/重启验收，复核DSH共存拒绝说明，提交。

### Task 8: AstrBot 独立插件

**Files:** 新建 `adapters/astrbot/{main.py,metadata.yaml,_conf_schema.json,README.md}`、`core_client.py`、`request_guard.py`、`tests/`；独立Python环境置于work，网络默认禁止模型终端外发。

**Interfaces:** 插件连接Task7服务；以可信平台事件换取受限会话能力；每次实际 provider 调用都经校验。管理员控制不注册为模型写入工具。适配AstrBot固定基线，后续版本先验证再放行。

- [ ] 写失败契约测试和实际AstrBot离线宿主测试：独立无DSH、临时内容不入持久历史、首次请求/工具回填/重试/fallback、撤权、core断开、ambiguous不自动重发。
- [ ] 运行测试确认失败，核查真实宿主函数是否提供可靠准入点。若无安全接入点，记录阻塞并继续Task9独立协议工作，不打补丁假装兼容。
- [ ] 实现Python薄客户端与可维护宿主适配，不重写存储核心；必要的宿主能力限制展示给管理员。
- [ ] 实际AstrBot加载、停用、冷恢复和会话隔离；打出可安装插件ZIP，提交。

### Task 9: NapCat 与 Snow Luma 接入契约

**Files:** 新建 `adapters/astrbot/tests/test_onebot.py`、`docs/platforms/{napcat,snow-luma}.md` 与合成协议fixture。

**Interfaces:** 复用AstrBot OneBot v11入口；消息幂等键绑定持久化接入实例、机器人、会话、消息ID；transport元数据不构成记忆权威。

- [ ] 写失败测试：私聊/群聊、相同messageId跨账号、重复上报、断线重连、伪造私聊身份、两端同时连接拒绝。
- [ ] 运行契约测试确认失败。
- [ ] 补齐适配校验和两个端的独立配置说明；不硬编码对方账号，不复制SnowLuma程序。
- [ ] 可用实际宿主时补无模型的接口验收；涉及真实账户或发信须有明确授权，否则记录未验证，提交。

### Task 10: 完整验证与交付

**Files:** 报告、README、各平台说明、打包脚本和最终版本manifest。

- [ ] 在最终代码上依次运行 `npm run typecheck`、`npm run build`、`npm test`、`npm run evaluate:fixture`、`npm pack --dry-run`，保存每条退出码；独立core、AstrBot和平台验收各自列结果。
- [ ] 用最终产物验证，完整源码检查不含私密附件、凭据、缓存、node_modules；核对归档内容和SHA-256。
- [ ] 一个新上下文只读审阅者审查整条分支；重要问题补失败回归再修，必要时重跑全量。没有实际验证的能力保留明确标签。
- [ ] 更新中文文档与报告，提交GitHub可审核分支/PR；按已授权范围发布通过验收的分包。技术阻塞不能以“全兼容”发布；发布范围若缩小需在说明中写清楚。
