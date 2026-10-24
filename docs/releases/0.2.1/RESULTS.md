# Memory-Continuity 0.2.1 验证记录

日期：2026-10-24。这个版本让现有插件可以随 DSH 升级到 rc.3，同时保留 rc.2 支持。人物、记忆、注入与工作台沿用 0.2.0 的实现；没有开启后台自动功能，也没有调用付费模型 API。

## 基线与范围

- Git 基线 `58c38b22a1687dd2d1e68bc77cebc40a84bcc1cf`，分支 `fix/dsh-021-rc3-compat`。开始时工作区干净，已检查实际 HEAD 和远端 main，没有覆盖后续修改。
- 官方 SDK 标签：rc.2 `687f282e8625c6b8d11ff58211a90524be2e4317` → rc.3 `1f81c047fc48fa190a683e469daa699857e9afe8`。[上游比较](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.2.1-rc.2...dsh-v0.2.1-rc.3)中相关九个原生包的完整 src tree SHA 一致；本轮另外使用实际 npm 分发包运行测试，没有用源码比较替代集成验证。
- 复用已有 rc.2 依赖，不修改共享 node_modules。在 `work/release-0.2.1/sdk-rc3` 独立安装 rc.3，再给验证副本设置独立依赖入口。两套环境各核对 36 个 `@deepseek-ai` 包，其中 31 个 DSH 包分别全部为 rc.2、rc.3；实际 manifest 路径、版本与 SHA-256 见证据中的 `sdk-inventory.json`。
- 一个代码执行者、一位只读审阅者，无递归代理；安装、构建、测试、打包全部串行。测试只用项目内临时 profile 和合成数据，未修改生产配置。

## 修改文件与原因

| 文件 | 改动 |
| --- | --- |
| `src/rp/native-sdk.ts` | 提取严格版本组合校验；五个直接 DSH peers 必须同属 rc.2 或 rc.3，Cordis 与 Schemastery 保持精确固定 |
| `src/rp/rp-plugin.ts` | 读取真实解析模块的 manifest 后调用统一校验，仍在读取服务、分配 owner 和打开记忆前执行；保留既有类型/原型及 format 4 检查 |
| `package.json`、`package-lock.json` | 版本升为 0.2.1；engine 与直接 peer 范围允许两套已知 SDK，开发依赖锁继续固定 rc.2 |
| `test/rp-sdk-compat.test.mjs` | 元数据一致性与实际原生 SDK 启动/离线请求回归 |
| `test/rp-sdk-versions.test.mjs` | 对每个直接 peer 检查两方向混版、旧版、未来版、缺失及非法值；检查基础组件精确版本 |
| `test/fixtures/rp/native-host.mjs` | 插件启动拒绝时释放 Cordis 上下文，避免失败验证残留服务 |
| `scripts/host-acceptance/package-compat.test.mjs` | 要求显式提供解包后的真实安装器，验证保存失败、失败关闭、诊断与干净续接，不允许回退到源码 |
| `SOURCE-MANIFEST.json` | 更新源码和构建产物清单；113 个 src/lib/ui 文件 |
| README、中文命令、M5 入口、仓库迁移说明、`docs/releases/0.2.1/` | 更新当前版本和兼容范围，保留中文首页布局、原前端截图、历史报告和未验证项 |

## 先失败，再修复

真实 rc.3 环境中先运行新兼容回归，旧实现 **0/2，退出 1**。失败分别是包声明没有 rc.3，以及运行时明确报出 `requires … 0.2.1-rc.2; found 0.2.1-rc.3`。实现后，兼容与组合回归合计 **6/6，退出 0**。日志为 `rc3-red.log`、`rc3-green.log`。

原生宿主测试实际使用 Cordis、DSH agent/session/LLM/tools/prompt、JSONL persistence 和 commands。终端适配器固定输出，网络 guard 阻止模型及外网连接；管理接口测试显式允许本机 IPv4 loopback。这里的“真实 SDK”不是完整桌面应用，也不是模型质量评测。

## 完整验证

下列两列各自是一次完整运行结果。rc.3 首次全量失败单独记录在下一节，未将定向重跑拼接成全量通过。所有产品代码改动在这些完整运行之前已完成；后续新增的是实际包验收脚本和文档。

| 实际命令 | rc.2 退出码 / 耗时 | rc.3 最终退出码 / 耗时 |
| --- | --- | --- |
| `npm run typecheck` | 0 / 1.933 秒 | 0 / 2.018 秒 |
| `npm run build` | 0 / 2.162 秒 | 0 / 2.267 秒 |
| `npm test` | **0 / 259 项全部通过 / 136.130 秒** | **0 / 259 项全部通过 / 137.082 秒** |
| `npm run evaluate:fixture` | 0 / 0.177 秒 | 0 / 0.198 秒 |
| `npm pack --dry-run --json` | 0 / 0.700 秒 | 0 / 1.493 秒 |

两次通过的完整测试均为 **0 失败、0 跳过、0 取消**；Node test runner 自身耗时分别为 135946.8043 ms 和 136898.1817 ms，表中为包含 npm 启动的命令耗时。

259 项包含既有生命周期、请求准入、保存故障恢复、旧读取器拒绝、retcon/删除/检索一致性、全局容量与 seal、anchors、批量撤回、人物与成长、分层条件注入、工作台接口等回归。各测试文件和原验收边界保留，没有把它们改成模拟通过。

固定语料仍为 12 个样例、49 个标注输出，`modelGenerated=false`。这只说明固定记录与协议行为，不说明真实模型已经具有长期人格或语义质量。

### 首次 rc.3 全量失败及处理

首次 `npm test` **退出 1**，共 254 项计数，252 通过、2 个文件级失败，耗时 137.730 秒。`rp-injection-compat.test.mjs` 和 `rp-person-compat.test.mjs` 在准备历史读取器时执行 `git archive <历史提交> src`，验证副本位于父仓库子目录，Git 按子目录前缀找不到 `src`。两个文件尚未展开全部用例，因此计数少于正常的 259。

保留 `rc3-test.log` 和 `rc3-results.json` 后，仅为验证进程设置实际仓库的绝对 `GIT_DIR` 与副本的 `GIT_WORK_TREE`。独立 archive 路径探针退出 0，随后重新完整执行上述五条命令，结果记录为 `rc3-final-*.log` / `rc3-final-results.json`。没有更改产品代码、删除失败测试或降低断言。

## 实际插件包与源码构建

候选实际 TGZ 通过 `npm pack --json --pack-destination <候选目录>` 生成，退出 0。同一文件分别解包到两套依赖环境，逐条检查路径、重复项、成员类型、长度与 SOURCE-MANIFEST SHA-256，再运行：

```text
RP_PERSON_BUNDLE=<解包目录/package/lib/index.js>
node --test --test-concurrency=1 scripts/host-acceptance/package-compat.test.mjs test/rp-injection-host.test.mjs test/rp-person-host.test.mjs test/rp-management-host.test.mjs test/rp-command-help.test.mjs
```

| 检查 | 实际结果 |
| --- | --- |
| rc.2 候选 TGZ 宿主 | 21/21，退出 0，11.608 秒 |
| rc.3 同一候选 TGZ 宿主 | 21/21，退出 0，11.680 秒 |
| 两套 TGZ 归档/manifest 校验 | 退出 0，113 个源码/产物/界面文件校验一致 |
| 从独立源码 ZIP 解包后 `npm run typecheck` | 退出 0，2.461 秒 |
| 同目录 `npm run build` | 退出 0，2.300 秒；没有复制 lib，复用精确锁定的 rc.2 依赖 |
| 独立重建与 rc.3 构建 manifest 对照 | 均与主工作树逐字节一致 |

独立构建 manifest SHA-256：`402f61a53941a1b6dfdbc3da8d3a1722e5b2e2a0db620356c86e95f726286e62`。重建用候选源码包含当时的 305 个文件；最终完整源码另含随后整理的发布文档，以发布回执的 Git 提交和逐条 Git blob 校验为准。

实际 TGZ 的两项新增故障验收证明：保存观察消息失败后，关闭即使报错也会封锁所有测试会话，旧请求不能到达终端；失败队列仍允许不泄露观察正文的诊断和干净续接，新会话继承相同分支、没有旧宿主消息，并能完成新的离线请求。另 19 项覆盖人物、分层注入、冷恢复、历史证明拒绝、真实 HTTP 管理入口与命令流程。

补齐文档后重新打包，并对最终同一 TGZ 重跑两套 21 项宿主验收。最终包哈希、条目数、命令退出码、源码 CRC/Git blob 校验和合并提交写在附件 `RELEASE-RECEIPT.json`、`SHA256SUMS.txt` 与证据归档中，避免报告自引用。完整源码来自最终 Git 提交；ZIP 不包含依赖、临时 profile 或开发缓存。旧读取器回归需要 Git 历史，审核完整 suite 时应克隆仓库。

## 环境、兼容与迁移

Windows、PowerShell；Node **22.23.3**、npm **11.16.0**、TypeScript **5.9.3**、esbuild **0.25.12**。两套 DSH 分别为 **0.2.1-rc.2 / 0.2.1-rc.3**，session format **4**，Cordis **4.0.5**、Schemastery **3.18.5**、Cordis loader **1.0.6**。

rc.3 独立安装命令 `npm install --ignore-scripts --no-audit --no-fund --maxsockets=1 --cache ./npm-cache --registry https://registry.npmjs.org`，退出 0，安装 47 个包。该过程需要 npm 网络下载，不是付费模型调用；未替换原有 rc.2 依赖。独立 package/lock 与实际依赖清单随证据提供，根开发 lock 保留 rc.2。

从 0.2.0 升级到 0.2.1 不改变 branch/global v1、host journal v2、人物 requiredCapabilities 或 M5 marker/备份规则，不搬动数据目录。原有无法认证工具历史仍 recovery-only，不自动重发 ambiguous 输入。升级前备份完整 profile 和工作区；升级 SDK 时使用同一版组件并完整重启宿主，不支持运行中热替换服务。主命令 `/memcont`、旧 `/rp` 兼容别名及既有配置键均保持。

## 审阅与已知限制

只读审阅未发现本次兼容实现引入的阻塞问题。审阅发现打包测试在安装器导出缺失时可能回退到源码，已增加显式函数断言，再执行实际 TGZ 验收。

另有一项**基线已有、未在本补丁修复**的限制：`verifyNative` 比较原生类型和原型，同类服务的不同实例可能拥有相同原型，因此不能声称所有运行时实例替换都能被识别。当前支持静态、已知合作组件组合；任意服务热替换不在支持范围，升级需要完整重启。没有把“保留原检查”写成“已锁定真实实例身份”。

尚未验证或未完成的内容：

- 完整 DSH rc.3 桌面应用的安装、插件菜单、浏览器交互。本轮的 HTTP 接口和原生 SDK 测试不能替代这项。既有工作台的桌面交互、双主题证据见 [0.2.0 报告](../0.2.0/RESULTS.md)，本轮不重复宣称为新验收。
- 实际混合依赖树的负向安装。目前有逐项组合函数回归与真实两套合法 SDK 验证，不能把它们描述为所有混装拓扑均已实测。
- 生产 profile 的真实升级、真实断电、多日长跑、压力上限、其他 Node/OS/SDK 组合、移动端、完整键盘/读屏器矩阵。
- 真实模型的长期连续性和语义质量。未做模型调用；现有固定样例、历史 Luna 证据仍按其原边界解释。
- 有界词法检索与长链认证的性能限制继续存在；没有新增向量检索、后台维护或自动成长。旧宿主上下文不会因本轮排除而消失，严格删除后仍需干净续接。
- 历史报告中的偶发构建异常、压缩归档损坏根因仍未查明。本次没有复现；源码与证据采用未压缩 ZIP 并逐项核验，不据此宣布历史根因已解决。

本轮诊断过程中一次 archive 探针使用相对输出路径，导致输出目录不存在；改为明确绝对路径后退出 0。一次 README patch 上下文不匹配，工具原子拒绝，删去无关上下文后成功。均未通过重复重试掩盖问题。

## 发布材料

新建 v0.2.1 正式发布，提供插件 TGZ、完整源码、验证证据、中文说明、报告、回执和 SHA-256。发布前核对测试树与合并树，发布后核对远端资产大小/digest 和标签；不覆盖 v0.2.0 的标签或资产，不向 npm registry 发布。最终提交、PR 与发布地址以回执为准。

本轮本地证据目录为 `work/release-0.2.1/`；发布附件只包含明确挑选的日志、依赖锁和校验结果，不包含管理 token、生产 profile 或会话凭据。
