# Memory-Continuity 独立核心

这是供宿主适配器使用的 TypeScript / Node.js 核心开发包。它和 DSH 插件共用同一份存储、人物、日记与检索实现，不需要安装或启动 DSH。运行要求为 Node.js 22 或更高版本；没有安装脚本、在线词表下载或模型 API 调用。

```js
import {openMemoryCore} from '@memory-continuity/core'

const memory = await openMemoryCore({
  profileRoot: '/absolute/path/to/profile',
  entityIds: ['erin'],
})
// 由可信宿主建立工作区、人生线与真实权限；不要把 control 直接提供给模型。
// 关闭时释放当前核心的检索和任务资源。
memory.retrieval.dispose()
await memory.jobs.close()
```

`openMemoryCore` 是可信应用入口，不是远程 RPC。`control` 只能留在本机可信宿主中；模型只能取得适配器签发的受限读写能力。`openWorkbench` 接受已有授权的管理控制器，显式打开 loopback 工作台，返回一次性管理地址；不会自动开启后台服务。

本阶段请只用独立测试 profile，不要让多个进程同时写同一 profile。跨进程单写入者服务和 AstrBot 适配仍属后续阶段；此包的隔离加载成功不等于这些宿主已经兼容。

数据沿用已有 branch/global v1 与新人物、原文、共同日记的能力标记及备份规则。不要把新版工作区直接交给旧读取器；恢复旧版前核对完整备份。固定 tokenizer 与字体资源保留各自的上游许可证；`SOURCE-MANIFEST.json` 记录实际包中文件大小与 SHA-256。

在完整源码仓库执行 `npm run build:core` 生成新的独立打包目录。核心 JavaScript 和声明从 `src/core/index.ts` 及共用源码构建，不维护另一份存储代码。npm 包内的 sourcemap 包含对应 TypeScript 源文；完整仓库包含构建脚本、回归测试和 DSH / 后续其他适配源码。本轮通过 GitHub 分发，不在 npm 注册表自动发布。
