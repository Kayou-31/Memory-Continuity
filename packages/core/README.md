# Memory-Continuity 独立核心

这是供宿主适配器使用的 TypeScript / Node.js 核心开发包。它和 DSH 插件共用同一份存储、人物、日记与检索实现，不需要安装或启动 DSH。运行要求为 Node.js 22 或更高版本；没有安装脚本、在线词表下载或模型 API 调用。

```js
import {openMemoryCore} from '@memory-continuity/core'

const memory = await openMemoryCore({
  profileRoot: '/absolute/path/to/profile',
  entityIds: ['erin'],
})
// 由可信宿主建立工作区、人生线与真实权限；不要把 control 直接提供给模型。
// 停止准入，等在途写入收尾后再释放 profile 所有权。
await memory.close()
```

`openMemoryCore` 是可信应用入口，不是远程 RPC。`control` 只能留在本机可信宿主中；模型只能取得适配器签发的受限读写能力。`openWorkbench` 接受已有授权的管理控制器，显式打开 loopback 工作台，返回一次性管理地址；不会自动开启后台服务。

新版 DSH 入口和独立核心共用单写入者保护，同一 profile 的第二个实例会被拒绝。先关闭旧实例再切换宿主；旧版程序没有这项协议，升级和迁移前仍需由管理员确认已停止全部旧写入者。本阶段仍请使用独立测试 profile；本机 RPC 服务和 AstrBot 适配正在开发，不能把核心包验收当作宿主兼容验收。

如果进程异常退出，先运行 `memcont-core owner inspect --profile <绝对路径>`。确认这是要恢复的 profile 后，把诊断中的 `sha256` 原样传给 `memcont-core owner recover --profile <绝对路径> --expected <sha256>`。只有已确认死亡的进程可以恢复；活动进程、无法确认的 PID、损坏记录及过期摘要都会拒绝。恢复本身中断可在旧恢复进程退出后再次诊断处理，不按时间强行抢占。

所有权恢复只允许重新打开存储，**不会把旧会话变成可发送状态**。工作区或全局事务另有未完成写锁时，仍需沿用已有的事务诊断与恢复；不要删除锁文件或改写历史。已发送但结果不明的输入仍需检查，必要时 `continue-clean`，不能自动重发。

数据沿用已有 branch/global v1 与新人物、原文、共同日记的能力标记及备份规则。不要把新版工作区直接交给旧读取器；恢复旧版前核对完整备份。固定 tokenizer 与字体资源保留各自的上游许可证；`SOURCE-MANIFEST.json` 记录实际包中文件大小与 SHA-256。

在完整源码仓库执行 `npm run build:core` 生成新的独立打包目录。核心 JavaScript 和声明从 `src/core/index.ts` 及共用源码构建，不维护另一份存储代码。npm 包内的 sourcemap 包含对应 TypeScript 源文；完整仓库包含构建脚本、回归测试和 DSH / 后续其他适配源码。本轮通过 GitHub 分发，不在 npm 注册表自动发布。
