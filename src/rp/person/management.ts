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

const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex')
const uid=()=>randomUUID().replaceAll('-','')
export function createManagementService(store:RpStore,control:Parameters<typeof createCanonicalService>[1],entities:readonly string[],coordinator:MemoryCoordinator){
 const canonicalService=createCanonicalService(store,control,{entityIds:entities}),person=createPersonService(store,canonicalService,entities),agent=createAgentMemory(store,canonicalService,entities)
 return Object.freeze({create(authority:HostAuthority,active:()=>boolean=()=>true){
  let revoked=false
  const guard=()=>{if(revoked||!active())throw new RpError('ownership_lost','Management capability revoked')}
  type Stamp={fence:InputFence;candidatesHash:string}
  type Review={stamp:Stamp;action:string;payload:any;handle?:object;key:string;result?:unknown;done?:boolean;attempted?:boolean}
  const snapshots=new Map<string,Stamp>(),reviews=new Map<string,Review>()
  const retain=<T>(map:Map<string,T>,id:string,value:T)=>{if(map.size>=32)map.delete(map.keys().next().value!);map.set(id,value)}
  const check=async(stamp:Stamp)=>{
   guard();const fence=unwrap(await store.readFence(authority)),candidates=unwrap(await person.list(authority));guard()
   if(canonical(fence)!==canonical(stamp.fence)||digest(candidates)!==stamp.candidatesHash)throw new RpError('stale_input','Management snapshot changed; refresh and review again')
  }
  return Object.freeze({
   revoke(){revoked=true;snapshots.clear();reviews.clear()},
   async snapshot(){return coordinator.mutate(async()=>{
    guard()
    const data=unwrap(await store.withReadView(authority,view=>{
     const ids=[...new Set(view.events.flatMap(e=>semanticProtocol(e)==='person-origin/v1'&&e.payload.kind==='occurrence'?[e.payload.actorIds[0]]:[]))]
     const events=view.events.filter(e=>e.payload.kind==='occurrence'&&semanticProtocol(e)!=='person-origin/v1')
     return {fence:view.fence,persons:ids.map(id=>projectPerson(view,id)),experiences:events.slice(-200),experienceCount:events.length}
    },{audit:true}))
    const candidates=unwrap(await person.list(authority)),timelines=[]
    for(const p of data.persons){const t=unwrap(await person.timeline(authority,p.personId));timelines.push({...t,changes:t.changes.slice(-200),changeCount:t.changes.length})}
    const stamp={fence:structuredClone(data.fence),candidatesHash:digest(candidates)};await check(stamp)
    const id=uid(),result={id,entityIds:[...entities],...data,candidates,timelines,notice:'手动刷新；每次变更先预览再确认。人物变化后，旧聊天可能需要 /rp continue-clean。'}
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
     else if(['edit','set-policy'].includes(r.action)){
      const op=object(r.payload,['personId','fieldId','note',r.action==='edit'?'value':'policy'],['validity'])
      const current=unwrap(await person.read(authority,op.personId)).fields.find(f=>f.fieldId===op.fieldId)
      if(!current)throw new RpError('source_unavailable','Current person field unavailable')
      review.payload={...op,previousEventId:current.eventId,operation:r.action}
     }else if(r.action==='adopt')object(r.payload,['candidateIds'])
     else if(r.action==='reject')object(r.payload,['candidateId'])
     else if(r.action==='propose')object(r.payload,['changes'])
     else if(r.action==='agent'){
      object(r.payload,['kind'],['actorIds','description','sourceRevisionIds','fictionalTime','fromId','toId','relation','value','previousEventId','causeEventIds','note','ownerId','goalId','category','objective','status','progress','nextAction','targetEntityId'])
      if(!['experience','relationship','goal'].includes(r.payload.kind))throw new RpError('scope_denied','Unsupported management Agent operation')
     }else throw new RpError('scope_denied','Unsupported management action')
     await check(stamp);retain(reviews,id,review)
     return {id,action:review.action,payload:structuredClone(review.payload),fence:structuredClone(stamp.fence),notice:'确认才会写入；此预览不能跨会话、版本或管理窗口使用。'}
    })
   },
   async confirm(id:string){return coordinator.mutate(()=>withPublicationGuard(guard,async()=>{
    guard();text(id,64);const r=reviews.get(id);if(!r)throw new RpError('scope_denied','Unknown management review')
    if(r.done){unwrap(await store.ensureDurable(authority,unwrap(await store.readFence(authority))));guard();return structuredClone(r.result)}
    const prefix=r.action==='create'?'person:':r.action==='edit'||r.action==='set-policy'?'person_edit:':r.action==='adopt'?'person_adopt:':r.action==='reject'?'person_reject:':''
    const prior=r.attempted&&r.action!=='propose'?unwrap(await store.readControlCommit(authority,prefix+r.key)):null
    if(!prior)await check(r.stamp)
    r.attempted=true
    const ctl=unwrap(await store.observeSource(authority,{idempotencyKey:r.key,origin:'user_control',role:'user_control',turnId:r.key,publicText:'用户在本机管理页明确确认 '+r.action+' '+digest(r.payload)}));guard()
    let result:unknown
    if(r.action==='create')result=unwrap(await person.confirm(authority,r.handle!,ctl))
    else if(r.action==='edit'||r.action==='set-policy')result=unwrap(await person.apply(authority,ctl,{...r.payload,expected:r.stamp.fence,idempotencyKey:r.key}))
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
