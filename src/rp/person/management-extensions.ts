import {randomUUID} from 'node:crypto'
import type {RpStore} from '../store.js'
import {canonical} from '../store.js'
import type {createCanonicalService} from '../canonical.js'
import type {HostAuthority,InputFence,SourceRevision} from '../types.js'
import {object,cloneInput,text,id,RpError} from '../schema.js'
import {unwrap} from '../retrieval.js'
import {createDocumentService} from './documents/service.js'
import {importPersonDocument} from './documents/import.js'
import {reconcileDocumentRevision} from './documents/reconcile.js'
import {documentValue,documentHead,documentPolicies} from './documents/format.js'
import type {PersonDocumentDraft,DocumentSectionPolicy} from './documents/types.js'
import {createDiaryService} from '../diary/service.js'
import {validateDiaryDraft} from '../diary/schema.js'
import {diaryHead,diaryPolicyCandidate} from '../diary/format.js'
import type {WorkbenchSettings} from './management-settings.js'
export interface ManagementImpact {title:string;changes:string[];personIds:string[];branchId:string;history:string;recovery:string;mandatory:boolean}
export interface ExtensionReview {payload:any;validate?:()=>void;execute:(source:SourceRevision)=>Promise<unknown>}
export function managementImpact(action:string,payload:any,branchId:string):ManagementImpact{
 const labels:Record<string,string>={'experience-configure':'设置 AI 经历候选','experience-adopt':'采纳经历候选','experience-reject':'拒绝经历候选','summary-adopt':'采纳摘要候选',create:'建立人物起点',edit:'修改人物定义','set-policy':'修改成长边界','set-injection':'修改人物核心选择',agent:'改变经历、关系或目标',adopt:'采纳人物成长',reject:'拒绝成长候选',propose:'提交待审阅成长','document-import':'保存完整人物资料','document-retract':'撤回人物资料','diary-configure':'修改共同日记权限','diary-write':'保存共同日记','diary-delete':'隐私删除日记',settings:'保存工作台提醒偏好','host-budget':'改变记忆预算','host-injection':'改变注入规则','host-person':'改变聊天人物绑定','host-mode':'切换聊天用途','host-module':'调整可选能力模块','host-constraints':'修改人物与用途规则'}
 const changes:Record<string,string>={
  'experience-configure':payload.enabled?'允许当前人物在获授权的聊天中低频提出经历候选；不会自动采纳，也不启动额外后台调用。':'停止新的 AI 经历提案；已有候选仍可审阅。',
  'experience-adopt':'将这段候选及核对过的来源保存为正式经历，参与后续授权回忆。',
  'experience-reject':'保留拒绝决定，阻止同一输入的候选被重复提出。',
  settings:'只改变修改前的提醒方式；每次保存仍需要你明确确认。',
  'diary-configure':payload.allowAgentWrite?'允许该人物在获授权的当前对话中写自己的日记。':payload.previousEventId?'关闭 AI 日记写入，已有日记保留。':'建立共同日记，先只允许你写入。',
  propose:'这次只提交成长建议，等你审阅后才会改变人物。',
  'host-budget':'调整后续对话可使用的记忆总量与各层上限。',
  'host-injection':'调整后续对话选择、展开人物记忆的方式。',
  'host-person':'当前聊天会使用选定人物的身份与记忆。'
 }
 return {title:labels[action]??'人工变更',changes:[changes[action]??'保存后，后续有权限的对话可能依据新的有效记录组织回应。'],personIds:[...new Set([payload.personId,...(payload.actorIds??[]),payload.fromId,payload.toId,payload.ownerId].filter((v):v is string=>typeof v==='string'))],branchId,
  history:action==='settings'?'人物、记忆和写入权限都不会因此改变。':action.startsWith('host-')?'保留已经记录的原文和历史；这次修改作用于当前聊天配置。':action==='diary-configure'?'双方已有的日记与修订历史都会保留。':action==='diary-delete'?'清除这篇日记的全部版本及派生内容；外部备份不由本插件管理。':action==='diary-write'?'保留原作者；修改 AI 日记时保留原稿，并记录人类修订者。':'保留原始历史与修订来源；失效内容不会继续作为当前记忆。',
  recovery:action==='settings'?'可以随时在工作台设置里重新开启弹窗。':action.startsWith('host-')?'可在空白根会话重新调整；已有聊天历史时，请先干净续接。':action==='diary-configure'?'以后可以再次调整写作权限，关闭权限不会删除日记。':action==='diary-delete'?'此操作不能在工作台撤销；请先确认删除范围。':'可再次明确修订；旧会话历史失效时需要干净续接。',mandatory:['create','diary-delete'].includes(action)}
}
export function managementExtensions(store:RpStore,service:ReturnType<typeof createCanonicalService>,entities:readonly string[],authority:HostAuthority,guard:()=>void,settings:{read:()=>Promise<WorkbenchSettings>;write:(expected:WorkbenchSettings,value:boolean,key:string,guard:()=>void)=>Promise<WorkbenchSettings>}){
 const documents=createDocumentService(store,service,entities),diary=createDiaryService(store,service,entities)
 type Upload={draft:PersonDocumentDraft;previousEventId?:string;fence:InputFence;expires:number;policies?:DocumentSectionPolicy[];revisionReview?:ReturnType<typeof reconcileDocumentRevision>;revision:number;attempted?:boolean}
 const uploads=new Map<string,Upload>(),access=(personId:string)=>({personId,boardId:'shared'})
 const sweep=()=>{for(const [key,u]of uploads)if(!u.attempted&&u.expires<Date.now())uploads.delete(key)}
 const uploadValue=(key:string,u:Upload)=>({id:key,draft:structuredClone(u.draft),policies:structuredClone(u.policies??[]),previousEventId:u.previousEventId??null,...(u.revisionReview?{revisionReview:structuredClone(u.revisionReview)}:{}),expiresAt:new Date(u.expires).toISOString(),command:'/memcont document preview '+key})
 const findUpload=(key:string,personId?:string)=>{sweep();const u=uploads.get(key);if(!u)throw new RpError('stale_input','Upload cancelled or expired; 资料草稿已取消或过期，请重新解析');if(personId&&u.draft.personId!==personId)throw new RpError('scope_denied','Upload belongs to another person');return u}
 const policy=async(personId:string)=>{
  const head=unwrap(await store.withReadView(authority,view=>diaryHead(view.ledger!.authorityChanges,diaryPolicyCandidate(personId,'shared')),{audit:true}))
  return head?unwrap(await diary.settings(authority,access(personId))):null
 }
 return {
  revoke:()=>uploads.clear(),settings:settings.read,
  async upload(input:unknown){
   const v=object(cloneInput(input),['personId','documentId','title','mime','encoding','base64'],['previousEventId']);id(v.personId);if(!entities.includes(v.personId))throw new RpError('scope_denied','Unknown document person')
   if(!['text/plain','text/markdown'].includes(v.mime)||v.encoding!=='utf8')throw new RpError('invalid_record','只接受 UTF-8 文本或 Markdown')
   text(v.base64,1398104);const bytes=Buffer.from(v.base64,'base64');if(bytes.length>1048576||bytes.toString('base64')!==v.base64)throw new RpError('capacity_exceeded','文档上限为 1 MiB，且必须使用完整 base64')
   let original:string;try{original=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}catch{throw new RpError('invalid_record','文件不是有效 UTF-8；未替换或丢弃字符')}
   const draft=importPersonDocument({personId:v.personId,documentId:v.documentId,title:v.title,format:v.mime==='text/markdown'?'markdown':'text',text:original})
   if(v.previousEventId!==undefined)id(v.previousEventId)
   let revisionReview:ReturnType<typeof reconcileDocumentRevision>|undefined
   if(v.previousEventId!==undefined){
    const prior=unwrap(await documents.read(authority,v.personId,v.documentId))
    if(prior.eventId!==v.previousEventId||prior.status!=='active')throw new RpError('stale_input','修订版本已变化；请重新载入资料')
    revisionReview=reconcileDocumentRevision(prior.draft,draft,prior.policies)
   }
   sweep()
   if(uploads.size>=4)throw new RpError('capacity_exceeded','最多保留四份待导入草稿；请取消旧草稿')
   const fence=unwrap(await store.readFence(authority));guard();const key=randomUUID().replaceAll('-',''),u:Upload={draft,previousEventId:v.previousEventId,fence,expires:Date.now()+600000,revision:0,...(revisionReview?{revisionReview}:{})};uploads.set(key,u)
   return uploadValue(key,u)
  },
  discardUpload(key:string){text(key,64);if(uploads.get(key)?.attempted)throw new RpError('persistence_uncertain','资料保存已尝试，请先检查结果；不能取消成可重新提交的新草稿');uploads.delete(key);return {discarded:true}},
  updateUpload(input:unknown){const v=object(cloneInput(input),['id','personId','policies']);text(v.id,64);id(v.personId);const u=findUpload(v.id,v.personId);if(u.attempted)throw new RpError('persistence_uncertain','资料保存已尝试，不能改写待恢复的草稿');u.policies=documentPolicies(v.policies,new Set(u.draft.sections.map(s=>s.sectionId)));u.revision++;return {saved:true,revision:u.revision}},
  async read(input:unknown){
   const v=object(cloneInput(input),['kind','personId','id']);id(v.personId);if(v.kind==='upload')text(v.id,64);else id(v.id)
   if(v.kind==='upload'){const u=findUpload(v.id,v.personId);return {...uploadValue(v.id,u),snapshotChanged:canonical(u.fence)!==canonical(unwrap(await store.readFence(authority))),attempted:u.attempted===true}}
   if(v.kind==='document')return unwrap(await documents.read(authority,v.personId,v.id))
   if(v.kind==='diary')return unwrap(await diary.read(authority,{...access(v.personId),entryId:v.id}))
   if(v.kind==='diary-history')return unwrap(await diary.history(authority,{...access(v.personId),entryId:v.id}))
   throw new RpError('invalid_record','Unknown management read')
  },
  async snapshot(personIds:string[]){
   sweep()
   const records=unwrap(await store.withReadView(authority,view=>view.events.flatMap(e=>{const v=documentValue(e);return v&&personIds.includes(v.personId)&&documentHead(view.ledger!.authorityChanges,v.personId,v.documentId)===e.id?[{personId:v.personId,documentId:v.documentId,eventId:e.id,title:v.manifest?.title??v.documentId,status:v.manifest?'active':'withdrawn',bytes:v.manifest?.utf8Bytes??0,sha256:v.manifest?.sha256??null}]:[]}),{audit:true})),diaries=[]
   for(const personId of personIds){const p=await policy(personId);diaries.push({personId,settings:p,listing:p?unwrap(await diary.list(authority,{...access(personId),limit:32})):null})}
   const fence=unwrap(await store.readFence(authority)),pendingUploads=[...uploads].filter(([,u])=>personIds.includes(u.draft.personId)).map(([id,u])=>({id,personId:u.draft.personId,documentId:u.draft.documentId,title:u.draft.title,bytes:u.draft.utf8Bytes,sha256:u.draft.sha256,expiresAt:new Date(u.expires).toISOString(),status:u.attempted?'uncertain':canonical(u.fence)===canonical(fence)?'pending':'stale'}))
   return {documents:records,pendingUploads,uploadCapacity:{active:uploads.size,limit:4},diaries,preferences:await settings.read()}
  },
  async prepare(action:string,input:any,key:string,expected:InputFence,prefs:WorkbenchSettings):Promise<ExtensionReview|undefined>{
   if(action==='settings'){const v=object(input,['impactConfirmation']);if(typeof v.impactConfirmation!=='boolean')throw new RpError('invalid_record','Explicit boolean required');return {payload:v,execute:()=>settings.write(prefs,v.impactConfirmation,key,guard)}}
   if(action==='document-import'){
    const v=object(input,['uploadId'],['policies']),u=findUpload(v.uploadId),revision=u.revision
    if(u.attempted)throw new RpError('persistence_uncertain','资料保存已经尝试，请检查状态或重试原确认')
    if(canonical(u.fence)!==canonical(expected))throw new RpError('stale_input','Upload snapshot changed')
    const p=unwrap(await documents.preview(authority,{draft:u.draft,...(u.previousEventId?{previousEventId:u.previousEventId}:{}),...((v.policies??u.policies)?{policies:v.policies??u.policies}:{})},key))
    return {payload:{...p.draft,policies:p.policies,revisionReview:p.revisionReview??null,previousEventId:u.previousEventId??null},validate:()=>{const live=findUpload(v.uploadId);if(live!==u||live.revision!==revision)throw new RpError('stale_input','Upload changed after review');u.attempted=true},execute:async source=>{const result=unwrap(await documents.confirm(authority,p.handle,source));uploads.delete(v.uploadId);return result}}
   }
   if(action==='document-retract'){
    const v=object(input,['personId','documentId']),prior=unwrap(await documents.read(authority,v.personId,v.documentId));if(prior.status!=='active')throw new RpError('source_unavailable','Document already withdrawn')
    return {payload:{...v,previousEventId:prior.eventId},execute:async source=>unwrap(await documents.retract(authority,source,{...v,personId:v.personId,documentId:v.documentId,previousEventId:prior.eventId,expected,idempotencyKey:key}))}
   }
   if(action==='diary-configure'){
    const v=object(input,['personId','allowAgentWrite']);if(typeof v.allowAgentWrite!=='boolean')throw new RpError('invalid_record','Explicit diary permission required');const p=await policy(v.personId)
    const data={...access(v.personId),allowAgentWrite:v.allowAgentWrite,humanId:p?.humanId??'local_user',audiences:p?.audiences??[{kind:'local' as const}],...(p?{previousEventId:p.eventId}:{})}
    return {payload:data,execute:async source=>unwrap(await diary.configure(authority,source,{...data,expected,idempotencyKey:key}))}
   }
   if(action==='diary-write'){
    const v=object(input,['personId','draft']),draft=validateDiaryDraft(v.draft);await policy(v.personId)
    return {payload:{personId:v.personId,draft},execute:async source=>unwrap(await diary.writeHuman(authority,source,{...access(v.personId),draft,expected,idempotencyKey:key}))}
   }
   if(action==='diary-delete'){
    const v=object(input,['personId','entryId']);unwrap(await diary.read(authority,{...access(v.personId),entryId:v.entryId}))
    return {payload:v,execute:async source=>unwrap<unknown>(await diary.privacyDelete(authority,source,{...access(v.personId),entryId:v.entryId,expected,idempotencyKey:key,affectedBranchIds:[authority.scope.branchId]}))}
   }
  }
 }
}
