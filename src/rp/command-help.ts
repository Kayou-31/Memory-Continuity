/** Read-only Chinese command reference, independent of session/store health. */
import {RpError} from './schema.js'

const topics:Record<string,string>={
 budget:`记忆 token 预算
/memcont budget show：查看本会话绑定、计量方式与最近实际用量；故障状态也能诊断。
/memcont budget set {}：空白根会话显式启用总计 32,768 token。首次启用先保留 .pre-budget-v2-backup。
/memcont budget set {"limitTokens":16384,"layers":{"recollection":8192}}：设置总上限及各层上限，仍受宿主模型总容量与输出预留限制。
/memcont budget set null：只在空白根会话显式回到旧字节语义，不会自动迁移已有历史。
当前精确文本计数支持完整模型名 deepseek-ai/DeepSeek-V3.2；别名和其他模型明确显示 conservative-utf8。
provider 或 model 改变后须 continue-clean，再 budget set 重新绑定；不会猜测新模型沿用旧 tokenizer。
旧工具回执、重复记忆、全局内容与包装都占同一总额。必需内容超限时拒绝发送，不会偷偷截断。
这是本地文本 token 计量，不是服务端聊天模板或计费凭据；完整请求继续使用保守容量门禁。`,
 diary:`共同日记
/memcont diary enable：明确允许当前人物在对话中写自己的日记；默认未开启，不会后台写日记。
/memcont diary disable：停止 AI 写入；已有日记仍可查看。重新开启不恢复旧工具权限。
/memcont diary settings：查看权限与参与者。
/memcont diary list [关键词]、/memcont diary show <entryId>：搜索和读取最新日记。
/memcont diary write {"entryId":"today","title":"今天","body":"今天和你聊得很开心。"}：写人类日记。
修改时附 previousEventId（show 返回的 eventId）；保留原作者、编辑者和历史。
/memcont diary history <entryId>：查看原稿与修订。
/memcont diary delete <entryId>：显式隐私删除本条全部版本；涉及其他分支时需完整授权。外部备份和宿主日志不在此删除范围。
AI 工具：memcont_diary_write、memcont_diary_read、memcont_diary_search。AI 不能改人类日记、权限或人格。
reflection 可选记录理解、适用情境、不确定性、修订原因和认证依据；日记不自动成为事实。
历史引用失效时先 continue-clean；保存不确定时先诊断和检查现有日记，不盲目重试。`,
 person:`人物与成长
/memcont person preview <人物草稿JSON> → /memcont person confirm <previewId>：预览后确认创建。
/memcont person use <personId>：空白根会话绑定人物；有历史时先干净续接。
/memcont person show [personId]、/memcont person timeline [personId]：当前人物和变化历史。
/memcont person edit <JSON>、/memcont person set-policy <JSON>：明确修改字段或成长策略。
/memcont person propose <JSON>、/memcont person candidates：提交及查看成长候选。
/memcont person adopt {"candidateIds":["候选ID"]}、/memcont person reject {"candidateId":"候选ID"}：人工决定。
/memcont person manage、/memcont person manage-close：打开或撤销本机管理入口；不要分享带令牌的地址。
人物草稿和修改示例见 docs/person-core-usage.zh.md。`,
 injection:`分层与条件注入
/memcont injection show：查看本会话配置。
/memcont injection set {}：空白根会话先绑定人物，再启用默认配置。
/memcont injection set <JSON>：设置 depth、budgets、pin、exclude、aliases、rules；完整替换配置。
/memcont injection set null：在空白根会话关闭分层模式。
/memcont injection preview <话题>：只读查看五类记忆、选择原因、来源和旧历史；不发送模型。
深度 overview/association/evidence；原 budgets 仍是 UTF-8 字节。budget v2 启用后使用独立的 token layers 配置，见 /memcont help budget。
已有历史先 /memcont continue-clean 并选择返回的新会话。未选入不代表旧历史已删除；权限、有效性和强制核心不能被规则绕过。`,
 recovery:`诊断与安全续接
/memcont status：分别检查 bindingHealth（绑定健康）、requestAdmission（最近请求准入）、recovery（恢复指引），以及 blocked、lastError、pendingInputIds、ambiguousInputIds。
绑定 healthy 不表示最近请求已通过；requestAdmission.rejected 会显示阶段和原因。prepared 仅表示已组装，admitted 仅表示过了记忆门禁，不保证下游模型成功。
同宿主销毁重建后 modeEpoch 可能改变；保留历史认证规则，按提示 continue-clean，不直接解封旧快照。
/memcont continue-clean [branchId]：封锁旧会话，创建干净根；在宿主手动选择返回的会话。
继承经验证的人物和配置；无法认证的配置不继承。原宿主消息与工具结果不复制。
损坏 journal 不能作为授权依据，可能需要明确且独立授权的 branchId。
/memcont resume-input <sourceId>：仅明确未派发的待处理输入可以继续。
ambiguous 输入严禁自动重发；先核对宿主与持久记录。
保存结果不确定时先 status 和核对当前内容，不能盲目重新提交写操作。
/memcont help [主题]：故障状态仍可查看，不解除封锁。`,
 memory:`经历、记忆与人工采纳
/memcont start [branchId]：在空白根启动或绑定有效剧情分支。
/memcont input <文本>：记录输入并发起模型请求。
/memcont accept <sourceId>、/memcont reject <sourceId>：决定候选原文。
/memcont agent <JSON>：人工记录 experience、relationship、goal 等受支持操作。
/memcont goals、/memcont relationships、/memcont self：查看目标、方向关系与基础状态。
/memcont summary <JSON>、/memcont candidates、/memcont candidate <ID>：提出并检查结构化摘要候选。
/memcont adopt <ID>、/memcont reject-candidate <ID>：人工采纳或拒绝摘要候选。
/memcont retcon <JSON>、/memcont delete <JSON>、/memcont fork：纠正、明确隐私删除、创建剧情分支。
/memcont global preference <JSON>、/memcont global publish <JSON>、/memcont global list <JSON>、/memcont global adopt <JSON>：通用偏好和显式世界发布/采用。
通用记忆工具保持只读：rp_memory_search、rp_memory_get、rp_memory_status。共同日记的独立写入开关见 /memcont help diary。`,
 modules:`用途、能力与约束
/memcont mode show、/memcont mode set <rp|companion|creation|project>：查看或选择用途。
/memcont modules list、/memcont modules enable <ID>、/memcont modules disable <ID>：查看与人工启停能力。
/memcont modules run {"moduleId":"recall","input":{"query":"钟楼","limit":4}}：启用 recall 后手动检索。
/memcont constraints show、/memcont constraints set <JSON>：查看与设置权限内的预算和人物指导规则。
硬约束不可覆盖；人物规则属于指导，不保证模型执行。修改通常要求空白根会话；有历史时停用能力会封锁旧会话，需干净续接。
后台摘要、自动采纳、strict POV、会话压缩保持关闭。`,
 storage:`全局存储与升级
/memcont global storage-status {}：查看默认全局存储状态。
/memcont global storage-enable {}：人工启用分段存储，先按升级说明备份并核对范围。
指定世界/人物作用域使用包含 worldId/entityId 的 JSON，必须有相应授权。
升级和容量说明见 docs/person-studio-storage.zh.md。branch/global v1 保持兼容；人物工作区及扩展 journal 要求新版读取。
首次启用分层注入保留 .pre-m5-backup；备份不是全 profile 备份，不授权旧版本读取新历史。
容量或持久化出错后先检查状态，不截断历史、不反复发布。`
}

export function rpCommandHelp(topic:string=''):string{
 const key=topic.trim()
 if(key){if(!Object.hasOwn(topics,key))throw new RpError('invalid_record','未知帮助主题。使用 /memcont help 查看主题。');return 'Memory-Continuity · '+topics[key]}
 return `Memory-Continuity 中文指令帮助
帮助只读，不写入记忆、不调用模型；主命令 /memcont；旧 /rp 作为兼容别名。
/memcont help person：人物、成长审阅、管理入口
/memcont help diary：共同日记、明确授权、原稿与修订
/memcont help injection：五类记忆、条件注入、原因预览
/memcont help budget：32K 总记忆预算、模型绑定、计量方式
/memcont help recovery：诊断、故障恢复、干净续接
/memcont help memory：经历、关系、目标、摘要和全局记忆
/memcont help modules：用途、能力模块和两层约束
/memcont help storage：存储状态、备份与显式升级
首次使用：/memcont start → 创建人物 → /memcont person use <personId> → /memcont injection set {} → /memcont injection preview <话题>。
输入对话会调用宿主模型；帮助和预览不会。后台自动功能和压缩保持关闭。`
}
