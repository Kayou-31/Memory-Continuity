import {createHash} from 'node:crypto'
import {canonical,type RpStore,type RpReadView} from '../store.js'
import type {createCanonicalService} from '../canonical.js'
import {cloneInput,denied,failure,fence,id,integer,object,RpError,text} from '../schema.js'
import {lexicalScore,queryGroups,hitExcerpt} from '../lexical.js'
import {fullSpan,unwrap,type RetrievalSizing} from '../retrieval.js'
import type {HostAuthority,InputFence,SourceRevision} from '../types.js'
import {projectPerson} from '../person/projection.js'
import {resolveAudience,type AudienceContext} from '../person/documents/audience.js'
import {withPublicationGuard} from '../publication-guard.js'
import {withDiaryAdmission} from './admission.js'
import {diaryAudienceAllowed,diaryCandidate,diaryContent,diaryHash,diaryHead,diaryPolicy,diaryPolicyCandidate,diaryValue,validateDiaryAudiences,validateDiaryExecution} from './format.js'
import {validateDiaryDraft} from './schema.js'
import type {DiaryAccess,DiaryAudience,DiaryDraft,DiaryExecution,DiaryPolicy,DiaryValue} from './types.js'
import {bindDiaryEvidence} from './evidence.js'

export function createDiaryService(store:RpStore,service:ReturnType<typeof createCanonicalService>,entityIds:readonly string[]){
  const known=new Set(entityIds),keyFor=(kind:string,personId:string,boardId:string,key:string)=>{text(key,180);return 'diary:'+diaryHash([kind,personId,boardId,key])}
  const access=(a:DiaryAccess)=>{id(a.personId);id(a.boardId);if(!known.has(a.personId))denied('Unknown diary person')}
  const policyFrom=(view:RpReadView,a:DiaryAccess,authority:HostAuthority)=>{
    access(a)
    const head=diaryHead(view.ledger!.authorityChanges,diaryPolicyCandidate(a.personId,a.boardId)),event=view.events.find(e=>e.id===head),policy=event&&diaryPolicy(event)
    if(!event||!policy)denied('Shared diary has not been configured')
    if(!diaryAudienceAllowed(policy,a.audience?resolveAudience(a.audience,authority):undefined))denied('Diary participants do not include this audience')
    return {event,policy}
  }
  const actualControl=async(authority:HostAuthority,source:SourceRevision)=>{
    const ledger=unwrap(await store.readLedger(authority)),actual=ledger.sources.find(s=>s.id===source.id)
    if(!actual||actual.origin!=='user_control'||actual.publicTextSha256!==source.publicTextSha256)denied('Actual human diary control required')
    return actual
  }
  const priorResult=async(authority:HostAuthority,key:string,eventId:string)=>{
    const prior=unwrap(await store.readControlCommit(authority,key));if(!prior)return null
    if(!prior.authorityChanges.some(c=>c.kind==='candidate_adoption'&&['diary_entry_'+eventId,'diary_policy_'+eventId].includes(c.recordId)))throw new RpError('idempotency_conflict','Diary operation key has different content')
    unwrap(await store.ensureDurable(authority,unwrap(await store.readFence(authority))))
    return {eventId,fence:prior.fence}
  }
  const readEntry=async(view:RpReadView,eventId:string)=>{
    const event=view.events.find(e=>e.id===eventId),v=event&&diaryValue(event)
    if(!event||!v)throw new RpError('source_unavailable','Diary entry unavailable')
    return {eventId:event.id,author:v.author,editor:v.editor,createdAt:v.createdAt,modifiedAt:v.modifiedAt,previousEventId:v.previousEventId,draft:diaryContent(v,await view.readSource(v.content)),fence:view.fence}
  }
  const certifiedRead=async<T>(authority:HostAuthority,a:DiaryAccess,read:(view:RpReadView)=>Promise<{value:T;eventIds:string[]}>,sizing:RetrievalSizing={})=>{
    const result=await store.withReadView(authority,async view=>{
      const policy=policyFrom(view,a,authority),data=await read(view)
      if(sizing.fits&&!sizing.fits({ok:true,value:data.value}))throw new RpError('context_budget_exceeded','Diary result cannot fit remaining memory budget')
      const records=data.eventIds.map(id=>{const event=view.events.find(e=>e.id===id);if(!event)throw new RpError('source_unavailable','Diary receipt event unavailable');return {id,kind:'event' as const,revision:diaryHash(event)}})
      if(a.audience)resolveAudience(a.audience,authority)
      return {value:data.value,proof:{inputFence:view.fence,records,diary:{personId:a.personId,boardId:a.boardId,policyEventId:policy.event.id}}}
    },{audit:true})
    if(!result.ok)return result
    return bindDiaryEvidence({ok:true as const,value:result.value.value},authority,result.value.proof)
  }
  const write=async(authority:HostAuthority,a:DiaryAccess,draftInput:unknown,editor:'human'|'agent',key:string,human?:{source:SourceRevision;expected:InputFence},execution?:DiaryExecution,active:()=>void=()=>{},issuedPolicyId?:string)=>{
    active();access(a);const draft=validateDiaryDraft(draftInput),operationKey=keyFor(editor,a.personId,a.boardId,key)
    if(execution){validateDiaryExecution(execution);if(authority.scope.kind!=='session'||authority.scope.sessionId!==execution.sessionId)denied('Diary execution session mismatch')}
    const eventId='diary_'+diaryHash([authority.scope.branchId,a.personId,a.boardId,draft,editor,execution??human?.source.id]).slice(0,48)
    const ctl=human?await actualControl(authority,human.source):undefined
    const view=unwrap(await store.withReadView(authority,view=>{
      const p=policyFrom(view,a,authority)
      if(editor==='agent'&&!p.policy.allowAgentWrite)denied('AI diary writing is disabled')
      if(editor==='agent'&&p.event.id!==issuedPolicyId)denied('Diary writer policy was replaced; obtain a new capability')
      return {ledger:view.ledger!,events:view.events,...p}
    },{audit:true}));active()
    const prior=await priorResult(authority,operationKey,eventId);if(prior)return prior
    const expected=human?.expected??view.ledger.fence;fence(expected)
    if(canonical(expected)!==canonical(view.ledger.fence))throw new RpError('stale_input','Diary write preview changed')
    const head=diaryHead(view.ledger.authorityChanges,diaryCandidate(a.personId,a.boardId,draft.entryId))
    if(head!==(draft.previousEventId??null))throw new RpError('stale_input','Diary entry predecessor changed')
    const previous=head?view.events.find(e=>e.id===head):undefined,pv=previous&&diaryValue(previous)
    if(head&&!pv)throw new RpError('source_unavailable','Diary predecessor unavailable')
    if(editor==='agent'&&pv?.author==='human')denied('AI cannot rewrite a human diary')
    const marker=view.ledger.authorityChanges.find(c=>c.kind==='candidate_adoption'&&c.recordId==='diary_policy_'+view.event.id)
    const control=ctl??(marker?.kind==='candidate_adoption'?view.ledger.sources.find(s=>s.id===marker.record.controlSourceId):undefined)
    if(!control)denied('Diary enable authorization unavailable')
    const body=canonical(draft),sourceHash=createHash('sha256').update(body).digest('hex')
    const publish=async()=>{
      const original=unwrap(await store.observeSource(authority,{idempotencyKey:operationKey+':source',origin:editor==='agent'?'agent_diary':'user_control',role:editor==='agent'?'assistant':'user_control',turnId:'diary_turn_'+diaryHash(operationKey).slice(0,40),publicText:body,...(execution?{host:{sessionId:execution.sessionId,messageId:execution.callId,messageRevision:'diary_'+diaryHash(draft).slice(0,40),eventSeq:0}}:{})}))
      const value:DiaryValue={protocol:'shared-diary/v1',boardId:a.boardId,personId:a.personId,entryId:draft.entryId,policyEventId:view.event.id,previousEventId:head,author:pv?.author??editor,editor,content:fullSpan(original),evidence:draft.reflection?.evidence??[],createdAt:pv?.createdAt??original.capturedAt,modifiedAt:original.capturedAt,execution:execution??null}
      const sourceRevisionIds=[...new Set([original.id,control.id,...value.evidence.map(e=>e.span.sourceRevisionId),...(execution?.sourceRevisionIds??[])])]
      const result=await service.applyControl(authority,control,{kind:'accept',expected,idempotencyKey:operationKey,sourceRevisionIds,events:[{id:eventId,diaryProtocol:'shared-diary/v1',epistemic:'utterance',payload:{kind:'diary_entry',value}}]})
      if(!result.ok)throw new RpError(result.code,result.message)
      try{active()}catch{throw new RpError('persistence_uncertain','Diary committed but execution owner changed; inspect before retrying')}
      return {eventId,fence:result.value as InputFence}
    }
    return withPublicationGuard(active,()=>execution?withDiaryAdmission({authority,boardId:a.boardId,personId:a.personId,policyEventId:view.event.id,execution,sourceHash,check:active},publish):publish())
  }
  return Object.freeze({
    async configure(authority:HostAuthority,source:SourceRevision,input:{boardId:string;personId:string;humanId:string;allowAgentWrite:boolean;audiences:DiaryAudience[];previousEventId?:string;expected:InputFence;idempotencyKey:string}){
      try{
        const v=object(cloneInput(input),['boardId','personId','humanId','allowAgentWrite','audiences','expected','idempotencyKey'],['previousEventId']);access(v as DiaryAccess);id(v.humanId);fence(v.expected);validateDiaryAudiences(v.audiences)
        if(typeof v.allowAgentWrite!=='boolean')denied('Explicit diary enable state required');if(v.previousEventId!==undefined)id(v.previousEventId)
        const ctl=await actualControl(authority,source),operationKey=keyFor('policy',v.personId,v.boardId,v.idempotencyKey),eventId='diary_policy_'+diaryHash([authority.scope.branchId,v,ctl.id]).slice(0,40)
        const prior=await priorResult(authority,operationKey,eventId);if(prior)return {ok:true as const,value:prior}
        const person=unwrap(await store.withReadView(authority,view=>projectPerson(view,v.personId)))
        const policy:DiaryPolicy={protocol:'shared-diary-policy/v1',boardId:v.boardId,personId:v.personId,humanId:v.humanId,originEventId:person.originEventId,previousEventId:v.previousEventId??null,allowAgentWrite:v.allowAgentWrite,audiences:v.audiences}
        const result=await service.applyControl(authority,ctl,{kind:'accept',idempotencyKey:operationKey,expected:v.expected,sourceRevisionIds:[ctl.id],events:[{id:eventId,diaryProtocol:'shared-diary-policy/v1',epistemic:'utterance',payload:{kind:'diary_policy',value:policy}}]})
        if(!result.ok)return result
        return {ok:true as const,value:{eventId,fence:result.value as InputFence}}
      }catch(e){return failure(e)}
    },
    async writer(authority:HostAuthority,input:DiaryAccess,live:()=>boolean=()=>true){
      try{
        const a={...input};access(a);let revoked=false
        const check=()=>{if(revoked||!live())throw new RpError('ownership_lost','Diary writer revoked');if(a.audience)resolveAudience(a.audience,authority)}
        check();const issuedPolicyId=unwrap(await store.withReadView(authority,view=>{const p=policyFrom(view,a,authority);if(!p.policy.allowAgentWrite)denied('AI diary writing is disabled');return p.event.id},{audit:true}));check()
        return {ok:true as const,value:Object.freeze({revoke:()=>{revoked=true},async write(draft:unknown,execution:DiaryExecution){try{check();const e=cloneInput(execution);validateDiaryExecution(e);return {ok:true as const,value:await write(authority,a,draft,'agent',e.key,undefined,e,check,issuedPolicyId)}}catch(e){return failure(e)}}})}
      }catch(e){return failure(e)}
    },
    async writeHuman(authority:HostAuthority,source:SourceRevision,input:{boardId:string;personId:string;draft:DiaryDraft;expected:InputFence;idempotencyKey:string}){
      try{const v=object(cloneInput(input),['boardId','personId','draft','expected','idempotencyKey']);return {ok:true as const,value:await write(authority,v as DiaryAccess,v.draft,'human',v.idempotencyKey,{source,expected:v.expected})}}catch(e){return failure(e)}
    },
    async read(authority:HostAuthority,input:{boardId:string;personId:string;entryId:string},audience?:AudienceContext,sizing:RetrievalSizing={}){
      try{const a=object(cloneInput(input),['boardId','personId','entryId']);id(a.entryId)
        return await certifiedRead(authority,{...a,audience} as DiaryAccess,async view=>{const head=diaryHead(view.ledger!.authorityChanges,diaryCandidate(a.personId,a.boardId,a.entryId));if(!head)throw new RpError('source_unavailable','Diary entry unavailable');return {value:await readEntry(view,head),eventIds:[head]}},sizing)
      }catch(e){return failure(e)}
    },
    async history(authority:HostAuthority,input:{boardId:string;personId:string;entryId:string}){
      try{const a=object(cloneInput(input),['boardId','personId','entryId']);id(a.entryId)
        return await store.withReadView(authority,async view=>{policyFrom(view,a as DiaryAccess,authority);const entries=view.events.filter(e=>{const v=diaryValue(e);return v&&v.personId===a.personId&&v.boardId===a.boardId&&v.entryId===a.entryId});if(entries.length>256)throw new RpError('capacity_exceeded','Diary history requires pagination');const result=[];for(const e of entries)result.push(await readEntry(view,e.id));return result},{audit:true})
      }catch(e){return failure(e)}
    },
    async list(authority:HostAuthority,input:{boardId:string;personId:string;query?:string;limit?:number},audience?:AudienceContext,sizing:RetrievalSizing={}){
      try{const a=object(cloneInput(input),['boardId','personId'],['query','limit']);text(a.query??'',4096,true);const limit=a.limit??16;integer(limit,1);if(limit>32)denied('Diary list limit exceeded')
        return await certifiedRead(authority,{...a,audience} as DiaryAccess,async view=>{
          policyFrom(view,{...a,audience} as DiaryAccess,authority);const items=[]
          for(const e of view.events){const v=diaryValue(e);if(!v||v.personId!==a.personId||v.boardId!==a.boardId||diaryHead(view.ledger!.authorityChanges,diaryCandidate(v.personId,v.boardId,v.entryId))!==e.id)continue
            const entry=await readEntry(view,e.id),body=entry.draft.title+'\n'+entry.draft.body,score=lexicalScore(body,queryGroups(a.query??''));if(score===null)continue
            items.push({eventId:e.id,entryId:v.entryId,author:v.author,editor:v.editor,title:entry.draft.title,excerpt:hitExcerpt(body,a.query??'',256),revision:diaryHash(e),score})
          }
          if(audience)resolveAudience(audience,authority)
          items.sort((a,b)=>b.score-a.score||a.eventId.localeCompare(b.eventId))
          const selected=items.slice(0,limit),result=()=>({items:selected.map(({score:_score,...v})=>v),truncated:items.length>selected.length,fence:view.fence})
          while(sizing.fits&&!sizing.fits({ok:true,value:result()})){if(selected.length<=1)throw new RpError('context_budget_exceeded','Diary search item cannot fit');selected.pop()}
          return {value:result(),eventIds:selected.map(e=>e.eventId)}
        },sizing)
      }catch(e){return failure(e)}
    },
    async privacyDelete(authority:HostAuthority,source:SourceRevision,input:{boardId:string;personId:string;entryId:string;expected:InputFence;idempotencyKey:string;affectedBranchIds:string[]},affectedAuthorities:readonly HostAuthority[]=[authority]){
      try{const a=object(cloneInput(input),['boardId','personId','entryId','expected','idempotencyKey','affectedBranchIds']);access(a as DiaryAccess);id(a.entryId);fence(a.expected);const ctl=await actualControl(authority,source)
        const sourceRevisionIds=unwrap(await store.withReadView(authority,view=>{
          policyFrom(view,a as DiaryAccess,authority)
          // The immutable semantic marker records only the diary original source,
          // so deletion does not accidentally erase the conversation or enable grant.
          return [...new Set(view.ledger!.authorityChanges.flatMap(c=>c.kind==='candidate_adoption'&&c.record.decision==='accepted'&&c.record.candidateId===diaryCandidate(a.personId,a.boardId,a.entryId)?[...c.record.sourceRevisionIds]:[]))]
        },{audit:true}));if(!sourceRevisionIds.length)throw new RpError('source_unavailable','Diary entry unavailable')
        return await service.applyControl(authority,ctl,{kind:'privacy_delete',idempotencyKey:keyFor('privacy',a.personId,a.boardId,a.idempotencyKey),expected:a.expected,sourceRevisionIds,affectedBranchIds:a.affectedBranchIds},affectedAuthorities)
      }catch(e){return failure(e)}
    },
    async settings(authority:HostAuthority,input:{boardId:string;personId:string}){
      try{const a=object(cloneInput(input),['boardId','personId']);return await store.withReadView(authority,view=>{const p=policyFrom(view,a as DiaryAccess,authority);return {eventId:p.event.id,...p.policy,fence:view.fence}},{audit:true})}catch(e){return failure(e)}
    },
  })
}
