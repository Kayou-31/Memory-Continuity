# 接到你自己的应用里

Memory-Continuity 是独立的人物与记忆系统。当前 DSH 适配器连接聊天请求，AstrBot 提供管理桥；两者使用同一核心。工作台和记忆数据不以 DSH 为前提。其他应用也可以通过接口适配。

这份说明对应 Memory-Continuity 0.3.1 随附的独立核心 0.1.0-preview.3。接口可用不代表某个第三方宿主已经兼容：适配器仍需自己完成身份绑定、来源认证、生命周期与发送前校验。当前接口处于预览阶段，请锁定核心包版本，升级前备份并跑自己的接入回归；`/v1` 是协议路径，不是永久不变的兼容承诺。

## 两种接入方式

| 方式 | 适合什么应用 | 当前边界 |
| --- | --- | --- |
| `@memory-continuity/core` TypeScript / Node.js API | 能在 Node.js 22+ 中维护可信宿主状态的应用 | 共用人物、资料、日记、经历候选、检索、管理工作台；宿主自行集成模型请求链 |
| 核心本机 HTTP 服务 | Python 或其他语言，希望先接管理与只读检索 | 仅 loopback；提供短期只读工具凭据及独立管理凭据；不提供远程模型派发或通用模型写入 RPC |

源码入口为 `src/core/index.ts`。构建后的包包含类型声明、源码映射和文件哈希清单，不依赖 DSH SDK。

```ts
import {openMemoryCore, openCoreService} from '@memory-continuity/core'

const memory = await openMemoryCore({
  profileRoot: 'D:/Memory-Continuity/my-app/profile',
  entityIds: ['erin'],
})
// 可信应用负责创建/打开工作区，确定真实人物、分支、受众和权限。
// 不把 memory.control 或完整 memory 对象暴露成模型工具。
// 如需跨语言管理，可使用管理员预先配置的 bindings 显式打开服务：
// const service = await openCoreService({memory, bindings})
// await service.close() // 服务会等待在途操作，并关闭它持有的 memory。
await memory.close()
```

从新目录开始可使用 `memcont-core init`，再显式 `serve`。完整命令与绑定配置见[独立核心说明](../../packages/core/README.md)。同一 profile 只能由一个有效写入实例持有；不要让多个应用直接同时打开同一目录。可以由一个核心服务服务多个已授权绑定。

## HTTP 接口与操作顺序

所有请求为 `POST` JSON，使用连接文件中的实际地址。管理凭据只留在可信应用内，不能放进提示词、模型工具参数、公开网页或日志。模型最多取得当前会话的只读 `toolToken`。

| 入口 | 凭据 | 用途 |
| --- | --- | --- |
| `/v1/admin/status` | admin | 查看真实绑定与会话；当前 `modelDispatch` 为 `false` |
| `/v1/admin/session` | admin | 用预先配置的 `bindingId` 建立短期管理会话及只读工具凭据 |
| `/v1/admin/workbench` | admin | 用 `sessionId` 显式打开工作台；自建适配器先使用默认 `independent-core` 能力 |
| `/v1/admin/snapshot` | admin | 获取本次操作所依据的快照 |
| `/v1/admin/prepare` | admin | 依据快照预览具体修改，返回确认句柄 |
| `/v1/admin/confirm`、`confirmation` | admin | 人工确认后提交，或查询持久回执 |
| `/v1/admin/cancel` | admin | 取消尚未执行的预览；已尝试或不确定结果不能伪装成未执行 |
| `/v1/admin/verify` | admin | 校验此前实际返回的检索回执；不要用新的检索结果替代原回执 |
| `/v1/admin/revoke` | admin | 使会话及其工作台失效 |
| `/v1/tool/search`、`get` | toolToken | 有界、只读、带来源认证的检索 |

返回使用 `{ok:true,value:...}` 或 `{ok:false,code,message}`。不要自动重试写入；遇到 `persistence_uncertain`，先查询回执并核对当前数据。`stale_input` 需要重新读取与预览，不能偷偷用最新版本确认旧操作。

HTTP 请求/响应各限 128 KiB，管理会话最长十分钟；较大资料通过显式工作台上传。未提供公网部署、CORS 全开放、跨平台账号自动合并或“任何模型都能写任何记忆”的接口。

## 若要接入聊天和 AI 经历候选

Node API 已提供 `memory.experienceCandidates`，但它不是模型可自行申请权限的入口。可信适配器先认证和保存当前对话原文，再签发只覆盖当前人物、会话、输入与允许来源窗口的 writer。模型只提交描述、认知类型、理由和精确原句，不能提供自己的 authority。

用户明确开启后才允许提案；同一输入、相同提案内容的重复请求复用已有候选；更换内容会返回 `idempotency_conflict`。每个人物在当前人生线每五分钟最多一次、滚动二十四小时最多八次持久准入，最多三十二条待审；已消费的准入不会因撤回原话而退还。配额仅限制候选写入，并不替代宿主的模型调用与重试预算。候选不会自动变成正式经历：工作台或可信人工命令必须再次核对并明确采纳。

适配器需把真正返回的记录 ID、版本、内容摘要和工具结果绑定到宿主历史，后续发送前重新验证。关闭、人物切换、授权撤销和证据失效时，旧写入能力不得继续使用；未知结果不得自动重放。普通聊天可以选择调用提案工具，因此可能有正常的工具后续模型请求；本功能不额外启动后台总结调用。真实模型能否准确挑选事件仍需单独评测。

当前 DSH 路径接了这一整条链。AstrBot 管理桥和独立 HTTP 服务可以管理候选，但还没有模型提案写入 RPC；Snow Luma 也未完成聊天适配验收。不能把工作台中的开关视为所有宿主都已具备生成能力。

## 接入验收最低要求

- 在正确人物、分支和受众中读到允许的数据；其他作用域读不到。
- 来源撤回、隐私删除或权限撤销后，在途结果和旧工具回执不会继续通过。
- 重复输入、断线、超时、持久化失败及冷启动不会重复写入或自动重放未知请求。
- 工作台说明实际连接能力，未接的模型预览、预算和续接不可伪装成可用。
- 用实际宿主 SDK 或实际程序完成回归；离线适配器只证明接线，不证明模型质量或供应商费用。

DSH 的 rc.2 / rc.3 原生 SDK 离线结果见[0.3.1 验证报告](../releases/0.3.1/RESULTS.md)；完整桌面应用流程另列。AstrBot 当前是管理桥；NapCat 的真实 QQ 收发与 Snow Luma 完整接入仍未验证。第三方自行适配时，请在自己的说明中同样列明验证范围。
