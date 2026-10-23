import {randomUUID} from 'node:crypto'
import {canonical,type RpStore} from '../store.js'
import type {HostAuthority,InputFence} from '../types.js'
import type {MemoryCoordinator} from '../session-policy.js'
import {cloneInput,object,RpError,text} from '../schema.js'
import {unwrap,createRetrieval} from '../retrieval.js'
import {retrievalEvidence,type RetrievalRecordRef} from '../retrieval-evidence.js'
import {projectPerson} from '../person/projection.js'
import {createPersonProposal} from '../person/changes.js'
import {MODULES,HARD_CONSTRAINTS,createRuntimeBinding,digest,type RuntimeBinding} from './contract.js'

export interface ModuleReceipt {protocol:'rp.module-result/v1';callId:string;moduleId:string;moduleVersion:string;bindingSha256:string;inputFence:InputFence;records:readonly RetrievalRecordRef[];resultSha256:string;execution:'core-only'}
export const moduleDisplay=(value:unknown,receipt:ModuleReceipt)=>({result:value,receipt,notice:'核心读取/待审候选回执；不是外部行动完成证明。'})
/** Context and result handles are process-local capabilities, never JSON grants. */
export interface ModuleContext {readonly binding:RuntimeBinding}
const contexts=new WeakMap<object,{authority:HostAuthority;check:()=>void;hash:string}>()
export function resolveModuleContext(context:ModuleContext,authority:HostAuthority) {
  const p=contexts.get(context)
  if(!p||p.authority!==authority||p.hash!==digest(context))throw new RpError('scope_denied','Unknown module context capability')
  p.check();return {...structuredClone(context.binding),hardConstraints:HARD_CONSTRAINTS}
}
export type ModuleRuntime=ReturnType<ReturnType<typeof createModuleService>['create']>
export function createModuleService(store:RpStore,coordinator:MemoryCoordinator,entityIds:readonly string[],inputs:(a:HostAuthority)=>ReadonlySet<string>) {
  return Object.freeze({registry:MODULES,create(authority:HostAuthority,config?:unknown,active:()=>boolean=()=>true) {
    const binding=createRuntimeBinding(config), proofs=new WeakMap<object,ModuleReceipt>();let revoked=false
    const check=()=>{if(revoked||!active())throw new RpError('ownership_lost','Module runtime revoked')}
    const context:ModuleContext={binding:structuredClone(binding)}
    contexts.set(context,{authority,check,hash:digest(context)})
    return Object.freeze({
      binding:()=>structuredClone(binding),context:()=>{check();resolveModuleContext(context,authority);return context},revoke:()=>{revoked=true},
      async run(moduleId:string,input:unknown,key:string=randomUUID()) {
        check();text(key,180)
        const module=MODULES.find(m=>m.id===moduleId),c=binding.config.constraints
        if(!module||!binding.config.enabledModules.includes(moduleId))throw new RpError('scope_denied','Module disabled or unknown')
        if(module.capabilities.some(cap=>c.deniedCapabilities.includes(cap)))throw new RpError('scope_denied','Module capability denied')
        const data=cloneInput(input)
        if(Buffer.byteLength(canonical(data),'utf8')>65536)throw new RpError('invalid_record','Module input exceeds 64 KiB')
        return coordinator.mutate(async()=>{
          check();const before=unwrap(await store.readFence(authority)),callId=randomUUID();let value:unknown,records:RetrievalRecordRef[]=[]
          const proofFor=(value:unknown):ModuleReceipt=>({protocol:'rp.module-result/v1',callId,moduleId,moduleVersion:module.version,bindingSha256:binding.sha256,inputFence:structuredClone(before),records:structuredClone(records),resultSha256:digest({value}),execution:'core-only'})
          const outputBudget=(value:unknown)=>{if(Buffer.byteLength(canonical(moduleDisplay(value,proofFor(value))),'utf8')>c.maxOutputBytes)throw new RpError('context_budget_exceeded','Complete module result and receipt exceed configured byte limit')}
          if(moduleId==='person-view'){
            const r=object(data,['personId'])
            value=unwrap(await store.withReadView(authority,view=>{
              const person=projectPerson(view,r.personId),ids=new Set([person.originEventId,...person.fields.map(f=>f.eventId),...person.relationships.flatMap(r=>r.supportEventIds),...person.goals.flatMap(g=>g.supportEventIds)])
              records=view.events.filter(e=>ids.has(e.id)).map(e=>({id:e.id,revision:digest(e),kind:'event'}));return person
            }))
          }else if(moduleId==='recall'){
            const r=object(data,['query'],['limit']);const limit=r.limit??c.maxReadRecords
            if(!Number.isInteger(limit)||limit<1||limit>c.maxReadRecords)throw new RpError('scope_denied','Module read limit exceeded')
            const retrieval=createRetrieval(store,{entityIds,inputSourceIds:inputs})
            try{const result=await retrieval.search(authority,{query:r.query,limit});value=unwrap(result);const proof=retrievalEvidence(result,authority);records=[...proof.records];if(canonical(proof.inputFence)!==canonical(before))throw new RpError('stale_input','Module retrieval changed')}finally{retrieval.dispose()}
            value={...(value as any),nextCursor:null}
          }else{
            const r=object(data,['changes']);if(!Array.isArray(r.changes))throw new RpError('invalid_record','Growth changes required')
            if(r.changes.some((v:any)=>c.protectedFieldIds.includes(v?.fieldId)))throw new RpError('scope_denied','Protected person field')
            const ids=new Set(r.changes.flatMap((v:any)=>[v.previousEventId,...(Array.isArray(v.causeEventIds)?v.causeEventIds:[])]))
            records=unwrap(await store.withReadView(authority,v=>v.events.filter(e=>ids.has(e.id)).map(e=>({id:e.id,revision:digest(e),kind:'event' as const}))))
            // Only propose is reachable; raw store avoids re-entering coordinator.
            const guarded=new Proxy(store,{get(target,k){if(k==='savePayloadCopy')return async(a:HostAuthority,p:any)=>{check();outputBudget(JSON.parse(p.body));return target.savePayloadCopy(a,p)};const value=Reflect.get(target,k,target);return typeof value==='function'?value.bind(target):value}})
            const propose=createPersonProposal(guarded,entityIds)
            value=unwrap(await propose(authority,data,'module:'+key))
          }
          check();outputBudget(value)
          if(canonical(unwrap(await store.readFence(authority)))!==canonical(before))throw new RpError('stale_input','Module input changed during operation')
          check();const result={value},proof=proofFor(value)
          proofs.set(result,proof);return result
        })
      },
      async verify(result:object):Promise<ModuleReceipt>{
        check();const proof=proofs.get(result)
        if(!proof||proof.resultSha256!==digest(result))throw new RpError('scope_denied','Uncertified module result identity or content')
        if(canonical(unwrap(await store.readFence(authority)))!==canonical(proof.inputFence))throw new RpError('stale_input','Module result snapshot changed')
        check();if(proof.resultSha256!==digest(result))throw new RpError('scope_denied','Module result changed during verification');return structuredClone(proof)
      },
    })
  }})
}
