# 0.3.0-preview.1 验证记录

本报告以最终发行检查为准。实现过程、失败回归与此前检查点详见 [本轮完整记录](../../framework-evolution-2026-10-25/RESULTS.md)，不把不同代码版本的定向结果拼成一次全量通过。

## 发布范围

DSH 0.3.0-preview.1、独立核心 0.1.0-preview.1、AstrBot 管理桥 0.1.0-preview.1；完整源码独立分发。AstrBot 模型注入、平台绑定、模型日记工具、NapCat/Snow Luma 整链及工作台视觉定稿均不在已完成声明中。稳定 0.2.1 不覆盖，不开启后台自动功能或付费 API。

## 本轮最后修正

- `src/core/cli-init.ts`、`cli.ts`：新增显式空白初始化。`test/core-init.test.mjs` 先 2/3（成功路径缺失），实现后 3/3；实际进程验证配置、服务、工作台和退出释放，旧目录/非法 ID 拒绝且保持原数据。真实核心 TGZ 测试也覆盖初始化命令。
- `src/rp/store.ts`：整分支审阅发现来源撤回可绕过显式失效的写入受众限制，回归先 7/8，加入来源写受众检查后 8/8。另发现 raw deletion marker 可用空来源列表绕过人物视角及目标范围；回归先 8/9，修复要求 narrator/control、可写来源和真实依赖闭包，保留原始 v1 标记读取及合法源删除语义。
- `test/rp-explicit-invalidation.test.mjs`：新增跨受众源撤回、character/broad-reader tombstone、无来源/无关依赖目标拒绝与合法自身来源删除。原始拒绝路径应保持 fence 与内容不变。
- README、核心/AstrBot说明、中文命令及平台文档：统一预览分包、初始化流程、备份/回退规则和未开放的宿主能力。文档中的参考架构不作为运行时指令。

## 工作台原稿对照与交互

本次附件 `index (1).html`、此前的 `index.html` 与保存的外包原稿均为 344,320 字节，SHA-256 均为 `9b30cb5d409db92aa125e133fe0a5016ef7a3be186c3f1e8beef39f380c3eeaa`。没有改动原件，没有执行其演示接口。

`workbench-client.ts`、`workbench-extensions.ts`、`ui/workbench/styles.css` 恢复原稿分层注入清单/阅读栏、成长对照与审阅工具条、用途与模块卡片、约束双栏、续接携带范围；新增资料和日记沿用原稿字体、色彩及阅读布局。生成文件 `workbench-style.ts` 与 `SOURCE-MANIFEST.json` 随构建更新。注入页修正了预算用量字段，读取真实 `memoryBudget.usage`，不再把新预算误显示为旧配置。

真实 rc.2 宿主、合成人物、CUA 浏览器交互：注入 8/11 项及 3 项排除筛选、浅/深色、明确设置 32768 后显示 9385/32768 的 UTF-8 保守计量、创建并选择成长候选、建立人类日记/预览/确认/回读全文、导入 152 字节原文/分类/默认不注入/确认/回读均有操作证据。实际宿主关闭记录 `modelCalls: 0`；这里没有模型语义评测。用途/模块与续接页面只展示真实状态，没有原稿的虚构开关或历史。

首次 UI 类型检查暴露 textarea 类型推断问题，修正类型后定向管理检查 11/11、退出 0。最后 UI 代码重新完成下方五项检查，不能沿用视觉修改前的 365/365。只读审阅复核了预算、模块、注入 trace、日记摘要和读写授权契约，没有新增明确阻塞；用户视觉认可仍待反馈。

## 最终检查

最终运行代码在 Node 22.23.3 下依次完成以下命令，回执位于发行证据包 `ui-final/verification-receipts.json`：

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| `npm run typecheck` | 0 | 类型检查通过 |
| `npm run build` | 0 | DSH 独立构建；296 项构建清单逐项校验 |
| `npm test` | 0 | **一次完整 365/365**，192896.4173ms；失败、取消、跳过均为 0 |
| `npm run evaluate:fixture` | 0 | 固定语料检查完成，不代表真实模型语义效果 |
| `npm pack --dry-run --json` | 0 | DSH 打包预检通过 |

整分支只读审阅以 `1d997516` 为基线，覆盖本分支及最后修正；审阅者未运行测试或修改代码。两条显式失效授权路径先复现再修复，最终相关存储、原文和日记定向检查 **50/50**，并包含在上述完整 365 项中。静态复核没有发现新的、具有明确证明链的发布阻塞；这不替代运行验收。

实际 DSH 候选 TGZ 解包后，分别对 rc.2 与 rc.3 运行 `scripts/host-acceptance/package-compat.test.mjs` 及 injection/person/management/command-help/modules/storage/recovery 宿主测试。两套环境分别使用各自真实 SDK 与包内 `lib/index.js`，rc.3 测试源码和模块解析也独立，避免借 rc.2 模块混合验收。rc.2 **41/41、27082.8969ms**；rc.3 **41/41、27771.6117ms**；另单独运行 rc.3 owner、生命周期及管理扩展 **12/12、4409.7141ms**，三个命令均退出 0。命令、退出码和耗时保存于 `ui-final/package-results.json`。

`python -m unittest discover -s adapters/astrbot/tests -v` 在隔离 AstrBot 4.29.3 中 **12/12、20.990 秒、退出 0**：8 个客户端回归、1 个真实 ZIP/PluginManager/PipelineScheduler 管理流程，以及 3 个真实 provider 的 loopback HTTP 重试边界测试。只有发送终端使用本地记录器；网络限制在 loopback，没有 QQ 登录或付费模型请求。测试中的 provider HTTP guard 是研究夹具，不是已经交付的模型接入。

独立核心实际 TGZ 在仓库依赖祖先以外离线安装，不带 DSH/Cordis 或运行时依赖；实际进程完成写入、冷读、异常结束、占用拒绝、显式恢复、确认回执幂等与新目录初始化，全部命令退出 0。三种分包分别核对归档路径、文件大小和 SHA-256，ZIP 另查 CRC。最终附件哈希及提交由 `RELEASE-RECEIPT.json` 和 `SHA256SUMS.txt` 提供，文档补充不会替换已经测试的运行代码。

干净源码验收另存 `ui-final/independent-build.json`：516 个源文件独立 ZIP 解包，在没有 node_modules、没有复制生成 lib 的目录执行 `npm ci`、类型、DSH 构建、核心构建和打包预检，全部退出 0。DSH 清单逐字节一致；核心运行代码、类型、资源和源码一致，只有两份 source map 的构建目录相对路径不同，规范化路径后完整 mappings 与 sourcesContent 一致。此前直接比较 source map 字节导致的比较器退出 1 保留为旧检查点，不是测试通过。源码 ZIP 可独立构建；运行旧版读取器回归需要完整 Git 历史，建议 clone 后执行，CI 使用 fetch-depth: 0。

实际发行候选 TGZ 的浏览器复核另外验证成长提案创建、前后对照、浅/深色与选中 1/1 计数；截图 `ui-final/ui-growth-actual-package*.png` 来自包内运行代码。视觉工作没有新增后台任务或模型调用。

## 环境与兼容

Windows，本轮固定 Node 22.23.3、TypeScript 5.9.3、esbuild 0.25.12；DSH rc.2 / rc.3、Cordis 4.0.5、Schemastery 3.18.5。AstrBot 固定 4.29.3（`f61a7f42696da6df25dc7a249ec9b8d54ed9da18`），Python 3.13.15；隔离虚拟环境在项目 work 内。共享 node_modules 未改动。

branch/global v1 与 host journal v2 保持不变。新的工作区能力标记要求新版读取；旧读取器拒绝与升级前完整备份恢复均有实际旧源码测试。新增 owner 与确认回执是本机恢复元数据，不是剧情证据。旧程序不参与新的占用协议，升级前仍须停止旧实例。

## 未完成、未验证与已知限制

- AstrBot 只提供已明确授权的管理动作；模型发送准入与平台身份/消息幂等、工具循环和 fallback 接入未完成。没有真实 QQ 登录、发信或 NapCat/Snow Luma 整链结果。
- 工作台已按原稿对照并做真实交互检查，但用户最终视觉认可仍待反馈；全局/摘要/分支等完整图形操作待补；新原文修改后章节 ID 随全文哈希变化，需要重新核对全部分类与适用条件，不自动继承旧选择。
- 真实模型质量、多会话长历史语义、生产数据迁移、断电、多日压力、其他 OS/SDK/Node、完整 rc.3 桌面 UI、完整无障碍与移动端矩阵未验证。
- 当前词法检索与证据认证有随数据增长的成本，不是无限记忆。确认历史上限 4096 份，不自动截断；尚无确认历史归档工具。
- 核心关闭先停止本地资格；失联时远端管理会话的立即撤销不能保证，仍受最长十分钟有效期限制。明确撤销失败会保留清理记录，后续明确关闭再尝试。
- 同宿主销毁重建会话可能因 `modeEpoch` 需要 `continue-clean`；保留这一认证边界，ambiguous 输入不会自动重发。
- 早期测试曾有一次 Node 0xC0000005、一次 Git 对象损坏，现场与恢复记录保留在完整报告中，根因未确定；不能用后续通过宣称系统性原因已修复。
