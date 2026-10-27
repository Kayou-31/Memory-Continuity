/** Presentation capabilities describe connected adapters; they never grant authority. */
export type ManagementSurface='independent-core'|'dsh'|'astrbot'|'snow-luma'
export function managementCapabilities(host:ManagementSurface='independent-core'){
 const chat=host==='dsh'
 return {protocol:'memcont.workbench-capabilities/v1',host,features:{persons:true,documents:true,diary:true,organize:true,chatBinding:chat,requestBudget:chat,injectionPreview:chat,continuation:chat,hostRules:chat},
  reopen:host==='dsh'?'请在 DSH 当前会话执行 /memcont person manage，打开新地址。':host==='astrbot'?'请在 AstrBot 管理员私聊发送 /memcont open <绑定ID>，重新打开工作台。':host==='snow-luma'?'请从 Snow Luma 适配入口重新建立连接；当前工作台不接管聊天。':'请通过核心服务的管理员入口重新打开工作台（/v1/admin/workbench）；旧链接不会恢复权限。',
  notice:chat?'人物与记忆由独立核心管理；当前 DSH 适配器提供聊天绑定、预算和请求预览。':'人物、资料、日记与人工审阅可独立管理；当前入口未接入模型请求或宿主会话创建。'}
}
export type ManagementCapabilities=ReturnType<typeof managementCapabilities>
