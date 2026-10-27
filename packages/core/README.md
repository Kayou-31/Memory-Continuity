# Memory-Continuity 独立核心

这是供宿主适配器使用的 TypeScript / Node.js 核心预览包。它和 DSH 插件共用同一份存储、人物、日记与检索实现，不需要安装或启动 DSH。运行要求为 Node.js 22 或更高版本；没有安装脚本、在线词表下载或模型 API 调用。

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

## 从一个新空间开始

在空文件夹中通过本地 TGZ 安装核心，无需 npm registry 发布：`npm install --ignore-scripts <核心TGZ绝对路径>`。安装后用 `npx --no-install memcont-core` 调用，或直接运行包里的 `lib/cli.js`。

```text
memcont-core init --directory D:/Memory-Continuity/my-person --entity erin
memcont-core serve --config D:/Memory-Continuity/my-person/core-config.json --connection D:/Memory-Continuity/my-person/connection.json
```

父目录需要已存在，`my-person` 必须是全新目录。初始化只建立空白 profile、工作区、life 分支和 main 管理绑定，授权人物 ID 为 `erin`；运行时换成你想用的 ID。没有自动创建人物、导入历史、调用模型或开启服务。随后在工作台里明确创建这个人物。

已有目录、文件和符号链接全部拒绝。初始化中断后保留现场，不能重新运行来覆盖；检查后选择一个新目录，或使用现有诊断工具处理旧数据。不要把此命令用于升级已有 profile。

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

示例中的 ID 必须换成可信应用已建立并授权的真实记录；服务启动时逐项校验，不会根据示例自动创建工作区、分支或权限。新空间可用上面的 `init` 生成真实 ID；已有数据仍须由可信应用显式绑定，没有自动历史迁移。模型不能提供或改写这份配置。

所有 RPC 均为 `POST`，使用 `Content-Type: application/json` 和 `Authorization: Bearer <凭据>`，Host 必须与连接文件的地址一致；如发送 Origin，它也必须一致。

| 入口 | 权限与用途 |
| --- | --- |
| `/v1/admin/status` | 管理凭据；列出绑定和会话，明确返回 `modelDispatch: false` |
| `/v1/admin/session` | 管理凭据；传入配置中的 `bindingId`，签发短期 `sessionId` 和只读 `toolToken` |
| `/v1/admin/workbench` | 管理凭据与 `sessionId`；显式打开该绑定的工作台 |
| `/v1/admin/snapshot`、`prepare`、`confirm`、`confirmation`、`cancel` | 管理凭据与 `sessionId`；取得快照、预览修改、明确确认、查询持久回执或取消未执行预览 |
| `/v1/admin/verify` | 管理凭据与 `sessionId`、`receiptId`；复核此前实际检索结果，不能用新版本替旧内容背书 |
| `/v1/admin/revoke` | 管理凭据与 `sessionId`；撤销会话并关闭对应工作台 |
| `/v1/tool/search`、`get` | 只读 `toolToken`；沿用有界检索参数，返回实际结果及认证回执 |

普通请求和响应各限 128 KiB；最多 32 个在途请求、16 个连接、64 个会话，会话最长十分钟。默认请求时限十秒，超时和断开后的在途操作仍受发布检查约束。较大的原文导入使用显式工作台的独立上传通道。`personId` 用于人物上下文，不取代分支、受众和权限检查。

确认回执保存在 profile 的 `core-confirmations` 目录中，仅保存操作类型、绑定摘要和内容摘要，不复制人物或日记正文。冷启动后，同一已完成确认返回原回执，不重复修改；旧的未确认预览必须重新预览，已尝试但完成证据缺失的操作保持 `persistence_uncertain`，需要先核对当前内容。损坏回执不会自动修复。活动记录上限 4096；完成或取消的阶段链先写入并校验 `archive/`，再清理活动副本，保留旧回执及取消墓碑。归档中断可恢复，未知尝试不清理；接近容量时可在工作台设置查看诊断。历史仍占磁盘，不通过截断事务或删除归档解决容量。

当前 RPC 尚不提供模型派发、模型侧日记写入、平台身份绑定或跨进程模型请求准入。工作台与只读检索可以独立运行，AstrBot / NapCat / Snow Luma 的完整适配仍需后续验证。

Node API 还提供 `memory.experienceCandidates`：可信宿主绑定原话与当前输入后，可签发有限的候选 writer；模型不能取得 `control`。当前只在 DSH 聊天路径完成接线，其他应用可以自行适配。开关默认关闭，候选需要人工采纳；模型工具后续请求仍计入宿主调用预算。接口与权限接入说明见完整源码中的 `docs/adapters/THIRD-PARTY.zh.md`。

数据沿用已有 branch/global v1 与新人物、原文、共同日记的能力标记及备份规则。不要把新版工作区直接交给旧读取器；恢复旧版前核对完整备份。固定 tokenizer 与字体资源保留各自的上游许可证；`SOURCE-MANIFEST.json` 记录实际包中文件大小与 SHA-256。

在完整源码仓库执行 `npm run build:core` 生成新的独立打包目录。核心 JavaScript 和声明从 `src/core/index.ts` 及共用源码构建，不维护另一份存储代码。npm 包内的 sourcemap 包含对应 TypeScript 源文；完整仓库包含构建脚本、回归测试和 DSH / 后续其他适配源码。正式版本通过 GitHub 分发，不在 npm 注册表自动发布；0.1.0-preview.3 是本轮本地候选，尚未推送或公开发布。
