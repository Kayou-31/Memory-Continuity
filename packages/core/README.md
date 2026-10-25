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

新版 DSH 入口和独立核心共用单写入者保护，同一 profile 的第二个实例会被拒绝。先关闭旧实例再切换宿主；旧版程序没有这项协议，升级和迁移前仍需由管理员确认已停止全部旧写入者。本阶段仍请使用独立测试 profile；本机服务提供管理与只读检索，AstrBot 的模型请求接线尚未完成，不能把核心包验收当作宿主兼容验收。

如果进程异常退出，先运行 `memcont-core owner inspect --profile <绝对路径>`。确认这是要恢复的 profile 后，把诊断中的 `sha256` 原样传给 `memcont-core owner recover --profile <绝对路径> --expected <sha256>`。只有已确认死亡的进程可以恢复；活动进程、无法确认的 PID、损坏记录及过期摘要都会拒绝。恢复本身中断可在旧恢复进程退出后再次诊断处理，不按时间强行抢占。

所有权恢复只允许重新打开存储，**不会把旧会话变成可发送状态**。工作区或全局事务另有未完成写锁时，仍需沿用已有的事务诊断与恢复；不要删除锁文件或改写历史。已发送但结果不明的输入仍需检查，必要时 `continue-clean`，不能自动重发。

## 显式启动本机服务（开发接口）

```text
memcont-core serve --config <配置绝对路径> --connection <新连接文件绝对路径>
```

服务仅监听 `127.0.0.1` 的随机端口，在前台运行，输入 `quit` 停止。连接文件记录本次 URL 和管理凭据；普通终端输出不包含凭据。连接文件必须不存在，正常退出会删除本次文件；异常退出留下的文件保留用于诊断，恢复后指定一个新文件。请把它放在当前账户专用目录，不提交 Git、不发到群聊。Windows 文件访问权限由所在目录的 ACL 决定，POSIX 的 `0600` 不能替代 Windows ACL。

配置是管理员准备的 JSON，最大 64 KiB：

```json
{
  "schemaVersion": 1,
  "profileRoot": "D:/Memory-Continuity/test-profile",
  "entityIds": ["erin"],
  "bindings": [{
    "id": "main",
    "personId": "erin",
    "request": {
      "workspaceId": "使用实际工作区ID",
      "campaignId": "使用实际人生线ID",
      "branchId": "使用实际分支ID",
      "viewpoint": {"kind": "narrator"},
      "visibility": {"policyId": "使用实际策略ID", "revision": 0, "audienceSetId": "public"},
      "audienceSetIds": ["public"],
      "permissions": ["read", "observe", "commit", "control"]
    }
  }]
}
```

示例中的 ID 必须换成可信应用已建立并授权的真实记录；服务启动时逐项校验，不会根据示例自动创建工作区、分支或权限。当前还没有面向普通使用者的一键初始化向导。模型不能提供或改写这份配置。

所有 RPC 均为 `POST`，使用 `Content-Type: application/json` 和 `Authorization: Bearer <凭据>`，Host 必须与连接文件的地址一致；如发送 Origin，它也必须一致。

| 入口 | 权限与用途 |
| --- | --- |
| `/v1/admin/status` | 管理凭据；列出绑定和会话，明确返回 `modelDispatch: false` |
| `/v1/admin/session` | 管理凭据；传入配置中的 `bindingId`，签发短期 `sessionId` 和只读 `toolToken` |
| `/v1/admin/workbench` | 管理凭据与 `sessionId`；显式打开该绑定的工作台 |
| `/v1/admin/snapshot`、`prepare`、`confirm`、`confirmation` | 管理凭据与 `sessionId`；取得快照、预览修改、明确确认、查询持久回执 |
| `/v1/admin/verify` | 管理凭据与 `sessionId`、`receiptId`；复核此前实际检索结果，不能用新版本替旧内容背书 |
| `/v1/admin/revoke` | 管理凭据与 `sessionId`；撤销会话并关闭对应工作台 |
| `/v1/tool/search`、`get` | 只读 `toolToken`；沿用有界检索参数，返回实际结果及认证回执 |

普通请求和响应各限 128 KiB；最多 32 个在途请求、16 个连接、64 个会话，会话最长十分钟。默认请求时限十秒，超时和断开后的在途操作仍受发布检查约束。较大的原文导入使用显式工作台的独立上传通道。`personId` 用于人物上下文，不取代分支、受众和权限检查。

确认回执保存在 profile 的 `core-confirmations` 目录中，仅保存操作类型、绑定摘要和内容摘要，不复制人物或日记正文。冷启动后，同一已完成确认返回原回执，不重复修改；旧的未确认预览必须重新预览，已尝试但完成证据缺失的操作保持 `persistence_uncertain`，需要先核对当前内容。损坏回执不会自动修复。最多保留 4096 份预览历史，达到上限后拒绝新预览，已有读取与诊断仍可用；暂未提供归档工具，不能自行删历史来绕过上限。

当前 RPC 尚不提供模型派发、模型侧日记写入、平台身份绑定或跨进程模型请求准入。工作台与只读检索可以独立运行，AstrBot / NapCat / Snow Luma 的完整适配仍需后续验证。

数据沿用已有 branch/global v1 与新人物、原文、共同日记的能力标记及备份规则。不要把新版工作区直接交给旧读取器；恢复旧版前核对完整备份。固定 tokenizer 与字体资源保留各自的上游许可证；`SOURCE-MANIFEST.json` 记录实际包中文件大小与 SHA-256。

在完整源码仓库执行 `npm run build:core` 生成新的独立打包目录。核心 JavaScript 和声明从 `src/core/index.ts` 及共用源码构建，不维护另一份存储代码。npm 包内的 sourcemap 包含对应 TypeScript 源文；完整仓库包含构建脚本、回归测试和 DSH / 后续其他适配源码。本轮通过 GitHub 分发，不在 npm 注册表自动发布。
