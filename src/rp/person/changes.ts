import {createHash} from 'node:crypto'
import {canonical,type RpReadView,type RpStore} from '../store.js'
import type {createCanonicalService,EventProposal} from '../canonical.js'
import type {HostAuthority,InputFence,JsonValue,SemanticEvent,SourceRevision} from '../types.js'
import {cloneInput,denied,failure,id,invalid,object,RpError,text,fence as validateFence} from '../schema.js'
import {unwrap} from '../retrieval.js'
import {markSemantic} from '../semantic-registry.js'
import {currentGrowthHeads} from '../growth-format.js'
import {personValue,checkPersonTransition,personApplies} from './format.js'
import {personKeys} from './schema.js'
import {projectPerson} from './projection.js'
import type {PersonValue,PersonValidity} from './types.js'
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex')
type Change={changeId:string;personId:string;fieldId:string;previousEventId:string|null;previousChangeId?:string;value:string;causeEventIds:string[];note:string}
type Saved={protocol:'person-growth/v1';id:string;inputFence:InputFence;changes:(Change&{eventId:string})[]}
function validateChange(raw:unknown):asserts raw is Change {
  const c=object(raw,['changeId','personId','fieldId','previousEventId','value','causeEventIds','note'],['previousChangeId']);id(c.changeId);id(c.personId);id(c.fieldId);text(c.value,2048,true);text(c.note,2048)
  if(c.previousChangeId!==undefined){id(c.previousChangeId);if(c.previousEventId!==null)invalid('choose one predecessor')}else id(c.previousEventId)
  if(!Array.isArray(c.causeEventIds)||!c.causeEventIds.length||c.causeEventIds.length>32||new Set(c.causeEventIds).size!==c.causeEventIds.length)invalid('person growth causes')
  c.causeEventIds.forEach(id)
}
/** Sort once from the initial snapshot; sibling input permutations have identical effects. */
function ordered(changes:Saved['changes']) {
  const byId=new Map(changes.map(c=>[c.eventId,c]));if(byId.size!==changes.length||changes.length>16||!changes.length)invalid('growth batch size/identity')
  const pending=new Map(byId), result:Saved['changes']=[]
  while(pending.size) {
    const ready=[...pending.values()].filter(c=>!pending.has(c.previousEventId!)).sort((a,b)=>a.eventId.localeCompare(b.eventId))
    if(!ready.length)invalid('cyclic person predecessors')
    for(const c of ready){pending.delete(c.eventId);result.push(c)}
  }
  return result
}
function makeEvent(view:RpReadView,history:readonly SemanticEvent[],personId:string,eventId:string,value:PersonValue):SemanticEvent {
  const previous=history.find(e=>e.id===value.previousEventId)
  if(!previous||previous.payload.kind!=='state_change'||previous.payload.subjectId!==personId)throw new RpError('stale_input','Person predecessor unavailable')
  const event:SemanticEvent={...previous,id:eventId,acceptedSeq:view.context.acceptedSeq+1,payload:{kind:'state_change',subjectId:personId,key:personKeys[value.kind],after:value as unknown as JsonValue},authority:'explicit_ooc',epistemic:'world',supersedes:[]}
  markSemantic(event,'person-core/v1');checkPersonTransition(event,history);return event
}
function compile(view:RpReadView,changes:Saved['changes'],known:ReadonlySet<string>) {
  const history=[...view.events], proposals:EventProposal[]=[]
  for(const c of ordered(changes)) {
    if(!known.has(c.personId))denied('unknown person entity')
    const previous=history.find(e=>e.id===c.previousEventId),old=previous&&personValue(previous)
    if(!old || old.fieldId!==c.fieldId)throw new RpError('stale_input','Person field predecessor unavailable')
    const value:PersonValue={...old,operation:'grow',value:c.value,previousEventId:c.previousEventId,causeEventIds:c.causeEventIds,note:c.note}
    const event=makeEvent(view,history,c.personId,c.eventId,value)
    const sources=[...new Set(c.causeEventIds.flatMap(id=>history.find(e=>e.id===id)!.sources.map(s=>s.sourceRevisionId)))].sort()
    proposals.push({id:event.id,personProtocol:'person-core/v1',epistemic:'world',payload:event.payload,sourceRevisionIds:sources});history.push(event)
  }
  return proposals
}
export function createPersonChanges(store:RpStore,service:ReturnType<typeof createCanonicalService>,entityIds:readonly string[]) {
  const known=new Set(entityIds)
  const load=async(authority:HostAuthority,view:RpReadView)=>{
    const copies=unwrap(await store.readPayloadCopies(authority))
    return copies.filter(c=>c.id.startsWith('person_candidate_')&&c.kind==='job_input').map(copy=>{
      const p=object(JSON.parse(copy.body),['protocol','id','inputFence','changes'])
      if(p.protocol!=='person-growth/v1'||p.id!==copy.id||!Array.isArray(p.changes)||!p.changes.length||p.changes.length>16)invalid('saved person candidate')
      validateFence(p.inputFence);if(p.inputFence.branchId!==view.fence.branchId)denied('candidate branch')
      for(const c of p.changes){const {eventId,...change}=object(c,['eventId','changeId','personId','fieldId','previousEventId','value','causeEventIds','note']);id(eventId);validateChange(change)}
      return p as Saved
    })
  }
  const decision=(view:RpReadView,id:string)=>view.ledger!.authorityChanges.find(c=>c.kind==='candidate_adoption'&&c.record.candidateId===id)
  return {
    async apply(authority:HostAuthority,control:SourceRevision,input:unknown) {
      try {
        const op=object(cloneInput(input),['operation','personId','fieldId','previousEventId','note','expected','idempotencyKey'],['value','policy','validity']);text(op.idempotencyKey,220);validateFence(op.expected);id(op.personId);id(op.fieldId);id(op.previousEventId);text(op.note,2048)
        if(!known.has(op.personId))denied('unknown person entity')
        if(!['edit','set-policy'].includes(op.operation))denied('only human edit/set-policy; growth uses review queue')
        if(op.operation==='edit'){text(op.value,2048,true);if(op.policy!==undefined)invalid('edit cannot change policy')}
        else if(op.value!==undefined)invalid('policy cannot change value')
        const key='person_edit:'+op.idempotencyKey,eventId='person_'+digest({key,op}).slice(0,48)
        const prior=unwrap(await store.readControlCommit(authority,key))
        if(prior){if(!prior.authorityChanges.some(c=>c.kind==='candidate_adoption'&&c.record.eventIds.includes(eventId)))throw new RpError('idempotency_conflict','Person edit changed');unwrap(await store.ensureDurable(authority,unwrap(await store.readFence(authority))));return {ok:true as const,value:{eventId,fence:prior.fence}}}
        const proposal=unwrap(await store.withReadView(authority,view=>{
          if(canonical(view.fence)!==canonical(op.expected))throw new RpError('stale_input','Person edit changed')
          const old=view.events.find(e=>e.id===op.previousEventId),value=old&&personValue(old)
          if(!value||value.fieldId!==op.fieldId)throw new RpError('stale_input','Person field predecessor changed')
          const {validity:_oldValidity,...base}=value
          const policy=op.operation==='set-policy'?op.policy:value.policy,validity=policy==='situational'?(op.validity??value.validity):undefined
          if(policy!=='situational'&&op.validity!==undefined)invalid('validity on persistent field')
          const next:PersonValue={...base,operation:op.operation,value:op.operation==='edit'?op.value:value.value,policy,previousEventId:op.previousEventId,causeEventIds:[],note:op.note,...(validity?{validity:validity as PersonValidity}:{})}
          const event=makeEvent(view,view.events,op.personId,eventId,next)
          return {id:eventId,personProtocol:'person-core/v1' as const,epistemic:'world' as const,payload:event.payload}
        }))
        const fence=unwrap<InputFence | import('../types.js').PrivacyDeletion>(await service.applyControl(authority,control,{kind:'accept',expected:op.expected,idempotencyKey:key,sourceRevisionIds:[control.id],events:[proposal]}))
        return {ok:true as const,value:{eventId,fence}}
      }catch(e){return failure(e)}
    },
    async propose(authority:HostAuthority,input:unknown,key:string) {
      try {
        text(key,220);const raw=object(cloneInput(input),['changes']);if(!Array.isArray(raw.changes)||!raw.changes.length||raw.changes.length>16)invalid('growth batch count');raw.changes.forEach(validateChange)
        const changes=raw.changes as Change[];if(new Set(changes.map(c=>c.changeId)).size!==changes.length)invalid('duplicate change IDs')
        return await store.withReadView(authority,async view=>{
          const candidateId='person_candidate_'+digest([view.fence.branchId,key,changes.slice().sort((a,b)=>a.changeId.localeCompare(b.changeId))]).slice(0,48)
          const ids=new Map(changes.map(c=>[c.changeId,'person_'+digest([candidateId,c.changeId]).slice(0,48)]))
          const compiled=changes.map(c=>{const {previousChangeId,...rest}=c;if(previousChangeId&&!ids.has(previousChangeId))invalid('unknown proposed predecessor');return {...rest,previousEventId:previousChangeId?ids.get(previousChangeId)!:c.previousEventId,eventId:ids.get(c.changeId)!}})
          compile(view,compiled,known)
          const dependencies=[...new Set(compiled.flatMap(c=>[...c.causeEventIds,...(view.events.some(e=>e.id===c.previousEventId)?[c.previousEventId!]:[])]))].sort()
          const sources=[...new Set(dependencies.flatMap(id=>view.events.find(e=>e.id===id)!.sources.map(s=>s.sourceRevisionId)))].sort()
          const saved:Saved={protocol:'person-growth/v1',id:candidateId,inputFence:view.fence,changes:ordered(compiled)}
          unwrap(await store.savePayloadCopy(authority,{idempotencyKey:'person_candidate:'+key,id:candidateId,kind:'job_input',sourceRevisionIds:sources,dependencyIds:dependencies,body:canonical(saved)}))
          return saved
        })
      }catch(e){return failure(e)}
    },
    async list(authority:HostAuthority) {
      return store.withReadView(authority,async view=>(await load(authority,view)).map(p=>({ ...p,state:(decision(view,p.id) as any)?.record.decision??(canonical(p.inputFence)===canonical(view.fence)?'pending':'stale') })),{audit:true})
    },
    async adopt(authority:HostAuthority,control:SourceRevision,candidateIds:readonly string[],key:string) {
      try {
        text(key,220);if(!Array.isArray(candidateIds)||!candidateIds.length||candidateIds.length>16||new Set(candidateIds).size!==candidateIds.length)invalid('candidate selection');candidateIds.forEach(id)
        const ids=[...candidateIds].sort(),operationKey='person_adopt:'+key
        const prior=unwrap(await store.readControlCommit(authority,operationKey))
        if(prior){const priorIds=prior.authorityChanges.flatMap(c=>c.kind==='candidate_adoption'&&c.record.candidateId.startsWith('person_candidate_')?[c.record.candidateId]:[]).sort();if(canonical(ids)!==canonical(priorIds))throw new RpError('idempotency_conflict','Person batch changed');unwrap(await store.ensureDurable(authority,unwrap(await store.readFence(authority))));return {ok:true as const,value:{fence:prior.fence}}}
        const ready=unwrap(await store.withReadView(authority,async view=>{
          const all=await load(authority,view),selected=ids.map(id=>{const p=all.find(p=>p.id===id);if(!p)throw new RpError('source_unavailable','Person candidate unavailable');if(decision(view,id))invalid('candidate already decided');if(canonical(p.inputFence)!==canonical(view.fence))throw new RpError('stale_input','Person candidate snapshot changed');return p})
          const events=compile(view,selected.flatMap(p=>p.changes),known).map(e=>({...e,sourceRevisionIds:[...new Set([...e.sourceRevisionIds!,control.id])].sort()}))
          return {events,expected:view.fence,personCandidates:selected.map(p=>({candidateId:p.id,eventIds:p.changes.map(c=>c.eventId),decision:'accepted' as const}))}
        },{audit:true}))
        const fence=unwrap<InputFence | import('../types.js').PrivacyDeletion>(await service.applyControl(authority,control,{kind:'accept',idempotencyKey:operationKey,sourceRevisionIds:[control.id],...ready}))
        return {ok:true as const,value:{fence}}
      }catch(e){return failure(e)}
    },
    async reject(authority:HostAuthority,control:SourceRevision,candidateId:string,key:string) {
      try { id(candidateId);text(key,220)
        const prior=unwrap(await store.readControlCommit(authority,'person_reject:'+key))
        if(prior){if(!prior.authorityChanges.some(c=>c.kind==='candidate_adoption'&&c.record.candidateId===candidateId&&c.record.decision==='rejected'))throw new RpError('idempotency_conflict','Person rejection changed');unwrap(await store.ensureDurable(authority,unwrap(await store.readFence(authority))));return {ok:true as const,value:prior.fence}}
        const expected=unwrap(await store.withReadView(authority,async view=>{if(!(await load(authority,view)).some(p=>p.id===candidateId))throw new RpError('source_unavailable','Person candidate unavailable');return view.fence},{audit:true}))
        return await service.applyControl(authority,control,{kind:'accept',idempotencyKey:'person_reject:'+key,expected,sourceRevisionIds:[control.id],events:[],personCandidates:[{candidateId,eventIds:[],decision:'rejected'}]})
      }catch(e){return failure(e)}
    },
    async timeline(authority:HostAuthority,personId:string) {
      try{id(personId);if(!known.has(personId))denied('unknown person entity')
        return await store.withReadView(authority,view=>{
          const person=projectPerson(view,personId),heads=new Set(currentGrowthHeads(view.events).map(e=>e.id)),owned=new Set([person.originEventId])
          const marked=new Set(view.ledger!.authorityChanges.flatMap(c=>c.kind==='candidate_adoption'&&c.record.candidateId==='person_core_v1'?[...c.record.eventIds]:[]))
          let changed=true
          while(changed){changed=false;for(const r of view.ledger!.records)if(marked.has(r.id)&&!owned.has(r.id)&&r.dependencyIds.some(id=>owned.has(id))){owned.add(r.id);changed=true}}
          return {personId,fence:view.fence,originEventId:person.originEventId,
            changes:view.events.flatMap(e=>{const v=personValue(e);return v&&e.payload.kind==='state_change'&&e.payload.subjectId===personId?[{...v,eventId:e.id,acceptedSeq:e.acceptedSeq,fictionalTime:e.fictionalTime,sourceRevisionIds:e.sources.map(s=>s.sourceRevisionId),current:heads.has(e.id)&&personApplies(e,view.context),expired:heads.has(e.id)&&!personApplies(e,view.context)}]:[]}),
            invalidatedEventIds:view.ledger!.records.filter(r=>!r.active&&owned.has(r.id)).map(r=>r.id)}
        },{audit:true})
      }catch(e){return failure(e)}
    }
  }
}
