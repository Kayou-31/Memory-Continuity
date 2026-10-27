/** Explicit user management capability. No model tools or autonomous work. */
import {randomUUID,createHash} from 'node:crypto'
import {canonical,type RpStore} from '../store.js'
import {createCanonicalService} from '../canonical.js'
import {createAgentMemory} from '../agent-memory.js'
import {createPersonService} from './service.js'
import {projectPerson} from './projection.js'
import {semanticProtocol} from '../semantic-registry.js'
import {object,cloneInput,text,RpError} from '../schema.js'
import {unwrap} from '../retrieval.js'
import {withPublicationGuard} from '../publication-guard.js'
import type {HostAuthority,InputFence} from '../types.js'
import type {MemoryCoordinator} from '../session-policy.js'
import {workbenchSettings,type WorkbenchSettings} from './management-settings.js'
import {managementExtensions,managementImpact,type ExtensionReview} from './management-extensions.js'
import type {createOrganizer} from '../organizer.js'
import type {SummaryService,SummaryContext} from '../summarizer.js'

const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex')
const uid=()=>randomUUID().replaceAll('-','')
export interface ManagementHost {
 snapshot():unknown
 prepare(action:string,payload:unknown):Promise<{payload:unknown;command:string}>
 apply(command:string,key:string,check:()=>Promise<void>):Promise<unknown>
}
export function createManagementService(store:RpStore,control:Parameters<typeof createCanonicalService>[1],entities:readonly string[],coordinator:MemoryCoordinator,profileRoot:string,assistance?:{organizer:ReturnType<typeof createOrganizer>;summaries:SummaryService}){
 const canonicalService=createCanonicalService(store,control,{entityIds:entities}),person=createPersonService(store,canonicalService,entities),agent=createAgentMemory(store,canonicalService,entities)
 const settings=workbenchSettings(profileRoot)
 return Object.freeze({create(authority:HostAuthority,active:()=>boolean=()=>true,host?:ManagementHost,summaryContext:SummaryContext={}){
  let revoked=false
  const guard=()=>{if(revoked||!active())throw new RpError('ownership_lost','Management capability revoked')}
  const authorize=async()=>{guard();unwrap(await control.checkManagement(authority));guard()}
  const extra=managementExtensions(store,canonicalService,entities,authority,guard,settings)
  type Stamp={fence:InputFence;candidatesHash:string;preferences:WorkbenchSettings;hostHash:string}
  type Review={stamp:Stamp;action:string;payload:any;handle?:object;extension?:ExtensionReview;hostCommand?:string;key:string;result?:unknown;done?:boolean;attempted?:boolean;confirming?:Promise<unknown>}
  const snapshots=new Map<string,Stamp>(),reviews=new Map<string,Review>()
  const retain=<T>(map:Map<string,T>,id:string,value:T)=>{if(map.size>=32)map.delete(map.keys().next().value!);map.set(id,value)}
  const check=async(stamp:Stamp)=>{
   await authorize();const fence=unwrap(await store.readFence(authority)),candidates=unwrap(await person.list(authority));guard()
   if(canonical(fence)!==canonical(stamp.fence)||digest(candidates)!==stamp.candidatesHash||canonical(await settings.read())!==canonical(stamp.preferences)||digest(host?.snapshot()??null)!==stamp.hostHash)throw new RpError('stale_input','Management snapshot changed; refresh and review again')
  }
  return Object.freeze({
   assertActive:guard,
   revoke(){revoked=true;snapshots.clear();reviews.clear();extra.revoke()},
   async upload(input:unknown){return coordinator.mutate(async()=>{await authorize();const result=await extra.upload(input);guard();return result})},
   async discardUpload(id:string){return coordinator.mutate(async()=>{await authorize();return extra.discardUpload(id)})},
   async updateUpload(input:unknown){return coordinator.mutate(async()=>{await authorize();return extra.updateUpload(input)})},
   async cancel(id:string):Promise<unknown>{return coordinator.mutate(async()=>{await authorize();text(id,64);const review=reviews.get(id);if(review?.attempted&&!review.done)throw new RpError('persistence_uncertain','这项修改已尝试，请核对结果；不能当作未执行预览取消');if(review?.done)return {committed:true};reviews.delete(id);return {cancelled:true}})},
   async read(input:unknown){await authorize();const result=await extra.read(input);guard();return result},
   async organize(input:unknown){
    const r=object(cloneInput(input),['snapshotId','operation'],['candidateId']);text(r.snapshotId,64)
    await authorize();const stamp=snapshots.get(r.snapshotId);if(!stamp)throw new RpError('scope_denied','Unknown management snapshot');await check(stamp)
    if(!assistance)throw new RpError('capability_missing','当前核心未接入整理能力')
    const result=await withPublicationGuard(guard,async()=>{
     if(r.operation==='summary')return unwrap(await assistance.organizer.summarize(authority,{},summaryContext))
     if(r.operation==='review')return unwrap(await assistance.organizer.review(authority))
     if(r.operation==='handoff')return unwrap(await assistance.organizer.handoff(authority))
     if(r.operation==='candidates')return unwrap(await assistance.summaries.list(authority))
     if(r.operation==='candidate'){text(r.candidateId,256);return unwrap(await assistance.summaries.get(authority,r.candidateId,summaryContext))}
     throw new RpError('invalid_record','Unknown organizer operation')
    })
    await check(stamp);if(Buffer.byteLength(canonical(result))>2*1024*1024)throw new RpError('capacity_exceeded','整理结果超过 2 MiB；请使用有界核心指令')
    return result
   },
   async snapshot(){return coordinator.mutate(async()=>{
    await authorize()
    const data=unwrap(await store.withReadView(authority,view=>{
     const ids=[...new Set(view.events.flatMap(e=>semanticProtocol(e)==='person-origin/v1'&&e.payload.kind==='occurrence'?[e.payload.actorIds[0]]:[]))]
     const events=view.events.filter(e=>e.payload.kind==='occurrence'&&semanticProtocol(e)!=='person-origin/v1')
     return {fence:view.fence,persons:ids.map(id=>projectPerson(view,id)),experiences:events.slice(-200),experienceCount:events.length}
    },{audit:true}))
    const candidates=unwrap(await person.list(authority)),timelines=[]
    for(const p of data.persons){const t=unwrap(await person.timeline(authority,p.personId));timelines.push({...t,changes:t.changes.slice(-200),changeCount:t.changes.length})}
    const extension=await extra.snapshot(data.persons.map(p=>p.personId))
    const stamp={fence:structuredClone(data.fence),candidatesHash:digest(candidates),preferences:extension.preferences,hostHash:digest(host?.snapshot()??null)};await check(stamp)
    const id=uid(),result={id,entityIds:[...entities],...data,...extension,candidates,timelines,notice:'手动刷新；每次变更先预览再确认。人物变化后，旧聊天可能需要 /memcont continue-clean。'}
    if(Buffer.byteLength(canonical(result))>2*1024*1024)throw new RpError('capacity_exceeded','Management snapshot exceeds 2 MiB; use bounded core commands')
    retain(snapshots,id,stamp);return result
   })},
   async prepare(input:unknown){
    const r=object(cloneInput(input),['snapshotId','action','payload']);text(r.snapshotId,64);text(r.action,32)
    if(Buffer.byteLength(canonical(r.payload))>65536)throw new RpError('capacity_exceeded','Management action exceeds 64 KiB')
    return coordinator.mutate(async()=>{
     guard();const stamp=snapshots.get(r.snapshotId);if(!stamp)throw new RpError('scope_denied','Unknown management snapshot');await check(stamp)
     const id=uid(),review:Review={stamp:structuredClone(stamp),action:r.action,payload:r.payload,key:'manager_'+id}
     if(r.action==='create'){const p=unwrap(await person.preview(authority,r.payload,review.key));review.handle=p.handle;review.payload=p.draft}
     else if(['edit','set-policy','set-injection'].includes(r.action)){
      const op=object(r.payload,['personId','fieldId','note',r.action==='edit'?'value':r.action==='set-injection'?'injection':'policy'],['validity'])
      const current=unwrap(await person.read(authority,op.personId)).fields.find(f=>f.fieldId===op.fieldId)
      if(!current)throw new RpError('source_unavailable','Current person field unavailable')
      review.payload={...op,previousEventId:current.eventId,operation:r.action}
     }else if(r.action==='adopt')object(r.payload,['candidateIds'])
     else if(r.action==='reject')object(r.payload,['candidateId'])
     else if(r.action==='propose')object(r.payload,['changes'])
     else if(r.action==='summary-adopt'){
      object(r.payload,['candidateId']);if(!assistance)throw new RpError('capability_missing','当前核心未接入摘要审阅')
      const candidate=unwrap(await assistance.summaries.get(authority,r.payload.candidateId,summaryContext))
      review.payload={candidateId:r.payload.candidateId,summary:candidate.proposedSummary,proposedEvents:candidate.proposedEvents}
     }
     else if(r.action==='agent'){
      object(r.payload,['kind'],['actorIds','description','sourceRevisionIds','fictionalTime','fromId','toId','relation','value','previousEventId','causeEventIds','note','ownerId','goalId','category','objective','status','progress','nextAction','targetEntityId'])
      if(!['experience','relationship','goal'].includes(r.payload.kind))throw new RpError('scope_denied','Unsupported management Agent operation')
     }else if(['host-budget','host-injection','host-person','host-mode','host-module','host-constraints'].includes(r.action)){
      if(!host)throw new RpError('capability_missing','当前宿主不支持此工作台控制')
      const next=await host.prepare(r.action,r.payload);review.payload=next.payload;review.hostCommand=next.command
     }else{
      const extension=await extra.prepare(r.action,r.payload,review.key,stamp.fence,stamp.preferences)
      if(!extension)throw new RpError('scope_denied','Unsupported management action')
      review.extension=extension;review.payload=extension.payload
     }
     await check(stamp);retain(reviews,id,review)
     const impact=managementImpact(review.action,review.payload,stamp.fence.branchId)
     return {id,action:review.action,payload:structuredClone(review.payload),impact,showImpactDialog:impact.mandatory||review.action!=='settings'&&stamp.preferences.impactConfirmation,fence:structuredClone(stamp.fence),notice:'确认才会写入；此预览不能跨会话、版本或管理窗口使用。'}
    })
   },
   async confirm(id:string){
    text(id,64);const candidate=reviews.get(id)
    if(candidate?.action==='summary-adopt'){
     await authorize();if(candidate.done){unwrap(await store.ensureDurable(authority,unwrap(await store.readFence(authority))));guard();return structuredClone(candidate.result)}
     // Summary publication owns the coordinator itself; never await it under the management lock.
     if(!candidate.confirming)candidate.confirming=withPublicationGuard(guard,async()=>{
      const source=await coordinator.mutate(async()=>{
       await authorize();if(!candidate.attempted)await check(candidate.stamp);candidate.attempted=true
       return unwrap(await store.observeSource(authority,{idempotencyKey:candidate.key,origin:'user_control',role:'user_control',turnId:candidate.key,publicText:'用户明确采纳摘要候选 '+candidate.payload.candidateId}))
      })
      guard();const result=unwrap(await assistance!.summaries.adopt(authority,source,candidate.payload.candidateId,{...summaryContext,idempotencyKey:candidate.key}));guard()
      candidate.result=result;candidate.done=true;return structuredClone(result)
     }).finally(()=>{candidate.confirming=undefined})
     return candidate.confirming
    }
    if(candidate?.hostCommand){
     // Host commands drain this coordinator themselves. Reserve the review under
     // the lock, then execute outside it to avoid a queue/coordinator deadlock.
     await coordinator.mutate(async()=>{await authorize();if(candidate.done)return;if(candidate.attempted)throw new RpError('persistence_uncertain','宿主变更已尝试；请先刷新核对，不要重复提交');await check(candidate.stamp);candidate.attempted=true})
     if(candidate.done)return structuredClone(candidate.result)
     const result=await host!.apply(candidate.hostCommand,candidate.key,()=>coordinator.mutate(()=>check(candidate.stamp)))
     candidate.result=result;candidate.done=true;guard();return structuredClone(result)
    }
    return coordinator.mutate(()=>withPublicationGuard(guard,async()=>{
    await authorize();text(id,64);const r=reviews.get(id);if(!r)throw new RpError('scope_denied','Unknown management review')
    if(r.done){unwrap(await store.ensureDurable(authority,unwrap(await store.readFence(authority))));guard();return structuredClone(r.result)}
    const prefix=r.action==='create'?'person:':r.action==='edit'||r.action==='set-policy'||r.action==='set-injection'?'person_edit:':r.action==='adopt'?'person_adopt:':r.action==='reject'?'person_reject:':''
    const prior=r.attempted&&r.action!=='propose'?unwrap(await store.readControlCommit(authority,prefix+r.key)):null
    if(!prior&&!(r.attempted&&r.extension))await check(r.stamp)
    if(!r.attempted)r.extension?.validate?.()
    r.attempted=true
    const ctl=unwrap(await store.observeSource(authority,{idempotencyKey:r.key,origin:'user_control',role:'user_control',turnId:r.key,publicText:'用户在本机管理页明确确认 '+r.action+' '+digest(r.payload)}));guard()
    let result:unknown
    if(r.extension)result=await r.extension.execute(ctl)
    else if(r.action==='create')result=unwrap(await person.confirm(authority,r.handle!,ctl))
    else if(r.action==='edit'||r.action==='set-policy'||r.action==='set-injection')result=unwrap(await person.apply(authority,ctl,{...r.payload,expected:r.stamp.fence,idempotencyKey:r.key}))
    else if(r.action==='adopt')result=unwrap(await person.adopt(authority,ctl,r.payload.candidateIds,r.key))
    else if(r.action==='reject')result=unwrap<unknown>(await person.reject(authority,ctl,r.payload.candidateId,r.key,r.stamp.fence))
    else if(r.action==='propose'){const p=unwrap(await person.propose(authority,r.payload,r.key,r.stamp.fence));result={candidateId:p.id}}
    else result=unwrap(await agent.apply(authority,ctl,{...r.payload,expected:r.stamp.fence,idempotencyKey:r.key}))
    r.result=result;r.done=true;guard();return structuredClone(result)
   }))},
  })
 }})
}
export type ManagementController=ReturnType<ReturnType<typeof createManagementService>['create']>
