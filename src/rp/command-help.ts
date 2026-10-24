/** Read-only Chinese command reference, independent of session/store health. */
import {RpError} from './schema.js'

const topics:Record<string,string>={
 person:`人物与成长
/rp person preview <人物草稿JSON> → /rp person confirm <previewId>：预览后确认创建。
/rp person use <personId>：空白根会话绑定人物；有历史时先干净续接。
/rp person show [personId]、/rp person timeline [personId]：当前人物和变化历史。
/rp person edit <JSON>、/rp person set-policy <JSON>：明确修改字段或成长策略。
/rp person propose <JSON>、/rp person candidates：提交及查看成长候选。
/rp person adopt {"candidateIds":["候选ID"]}、/rp person reject {"candidateId":"候选ID"}：人工决定。
/rp person manage、/rp person manage-close：打开或撤销本机管理入口；不要分享带令牌的地址。
人物草稿和修改示例见 docs/person-core-usage.zh.md。`,
 injection:`分层与条件注入
/rp injection show：查看本会话配置。
/rp injection set {}：空白根会话先绑定人物，再启用默认配置。
/rp injection set <JSON>：设置 depth、budgets、pin、exclude、aliases、rules；完整替换配置。
/rp injection set null：在空白根会话关闭分层模式。
/rp injection preview <话题>：只读查看五类记忆、选择原因、来源和旧历史；不发送模型。
深度 overview/association/evidence；预算为 UTF-8 字节，不是精确 token。
已有历史先 /rp continue-clean 并选择返回的新会话。未选入不代表旧历史已删除；权限、有效性和强制核心不能被规则绕过。`,
 recovery:`诊断与安全续接
/rp status：检查 blocked、lastError、pendingInputIds、ambiguousInputIds。
/rp continue-clean [branchId]：封锁旧会话，创建干净根；在宿主手动选择返回的会话。
继承经验证的人物和配置；无法认证的配置不继承。原宿主消息与工具结果不复制。
损坏 journal 不能作为授权依据，可能需要明确且独立授权的 branchId。
/rp resume-input <sourceId>：仅明确未派发的待处理输入可以继续。
ambiguous 输入严禁自动重发；先核对宿主与持久记录。
保存结果不确定时先 status 和核对当前内容，不能盲目重新提交写操作。
/rp help [主题]：故障状态仍可查看，不解除封锁。`,
 memory:`经历、记忆与人工采纳
/rp start [branchId]：在空白根启动或绑定有效剧情分支。
/rp input <文本>：记录输入并发起模型请求。
/rp accept <sourceId>、/rp reject <sourceId>：决定候选原文。
/rp agent <JSON>：人工记录 experience、relationship、goal 等受支持操作。
/rp goals、/rp relationships、/rp self：查看目标、方向关系与基础状态。
/rp summary <JSON>、/rp candidates、/rp candidate <ID>：提出并检查结构化摘要候选。
/rp adopt <ID>、/rp reject-candidate <ID>：人工采纳或拒绝摘要候选。
/rp retcon <JSON>、/rp delete <JSON>、/rp fork：纠正、明确隐私删除、创建剧情分支。
/rp global preference <JSON>、/rp global publish <JSON>、/rp global list <JSON>、/rp global adopt <JSON>：通用偏好和显式世界发布/采用。
模型只读工具：rp_memory_search、rp_memory_get、rp_memory_status；不授予模型写入权。`,
 modules:`用途、能力与约束
/rp mode show、/rp mode set <rp|companion|creation|project>：查看或选择用途。
/rp modules list、/rp modules enable <ID>、/rp modules disable <ID>：查看与人工启停能力。
/rp modules run {"moduleId":"recall","input":{"query":"钟楼","limit":4}}：启用 recall 后手动检索。
/rp constraints show、/rp constraints set <JSON>：查看与设置权限内的预算和人物指导规则。
硬约束不可覆盖；人物规则属于指导，不保证模型执行。修改通常要求空白根会话；有历史时停用能力会封锁旧会话，需干净续接。
后台摘要、自动采纳、strict POV、会话压缩保持关闭。`,
 storage:`全局存储与升级
/rp global storage-status {}：查看默认全局存储状态。
/rp global storage-enable {}：人工启用分段存储，先按升级说明备份并核对范围。
指定世界/人物作用域使用包含 worldId/entityId 的 JSON，必须有相应授权。
升级和容量说明见 docs/person-studio-storage.zh.md。branch/global v1 保持兼容；人物工作区及扩展 journal 要求新版读取。
首次启用分层注入保留 .pre-m5-backup；备份不是全 profile 备份，不授权旧版本读取新历史。
容量或持久化出错后先检查状态，不截断历史、不反复发布。`
}

export function rpCommandHelp(topic:string=''):string{
 const key=topic.trim()
 if(key){if(!Object.hasOwn(topics,key))throw new RpError('invalid_record','未知帮助主题。使用 /rp help 查看主题。');return 'Memory-Continuity · '+topics[key]}
 return `Memory-Continuity 中文指令帮助
帮助只读，不写入记忆、不调用模型；沿用 /rp 命令。
/rp help person：人物、成长审阅、管理入口
/rp help injection：五类记忆、条件注入、原因预览
/rp help recovery：诊断、故障恢复、干净续接
/rp help memory：经历、关系、目标、摘要和全局记忆
/rp help modules：用途、能力模块和两层约束
/rp help storage：存储状态、备份与显式升级
首次使用：/rp start → 创建人物 → /rp person use <personId> → /rp injection set {} → /rp injection preview <话题>。
输入对话会调用宿主模型；帮助和预览不会。后台自动功能和压缩保持关闭。`
}
