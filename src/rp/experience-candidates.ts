/** Independent, bounded AI proposals. Only explicit human decisions create events. */
import {createHash} from 'node:crypto'
import {canonical,type RpStore} from './store.js'
import {cloneInput,denied,failure,hash,hostId,id,integer,object,RpError,sourceSpan,text} from './schema.js'
import {fullSpan,unwrap} from './retrieval.js'
import {projectPerson} from './person/projection.js'
import {MemoryCoordinator} from './session-policy.js'
import {withPublicationGuard} from './publication-guard.js'
import type {HostAuthority,InputFence,PayloadCopy,SemanticEvent,SourceRevision,SourceSpan} from './types.js'
const sha=(s:string)=>createHash('sha256').update(s).digest('hex'),digest=(v:unknown)=>sha(canonical(v))
const limits={cooldownSeconds:300,maxPending:32,maxPerDay:8,maxEvidence:8,maxQuoteChars:2048}
const prefix=(personId:string)=>'experience_candidate_'+sha(personId).slice(0,24)+'_'
const admissionPrefix=(personId:string)=>'experience_admission_'+sha(personId).slice(0,24)+'_'
const policyKey=(personId:string,origin:string)=>'experience_policy_'+digest([personId,origin])
type Proposal={description:string;epistemic:'world'|'utterance'|'uncertain';reason:string;evidence:{quote:string;sourceId?:string;startUtf16?:number}[]}
type Saved={protocol:'experience-candidate/v1';personId:string;originEventId:string;inputSourceId:string;sessionId:string;policyId:string;createdAt:number;inputFence:InputFence;proposal:Proposal;spans:SourceSpan[]}
export interface ExperienceExecution{personId:string;sessionId:string;inputSourceId:string;sourceRevisionIds:readonly string[]}
export interface ExperienceReceipt{personId:string;candidateId:string;bodySha256:string;resultSha256:string;state:'pending'|'accepted'|'rejected'}
export function validateExperienceReceipt(v:unknown):asserts v is ExperienceReceipt{const r=object(v,['personId','candidateId','bodySha256','resultSha256','state']);if(!['pending','accepted','rejected'].includes(r.state))throw new RpError('store_corrupt','Experience receipt state');id(r.personId);id(r.candidateId);hash(r.bodySha256);hash(r.resultSha256)}
function proposal(input:unknown):Proposal{
 const r=object(cloneInput(input),['description','epistemic','reason','evidence']);text(r.description,4096);text(r.reason,1024)
 if(!['world','utterance','uncertain'].includes(r.epistemic)||!Array.isArray(r.evidence)||!r.evidence.length||r.evidence.length>limits.maxEvidence)throw new RpError('invalid_candidate','Candidate needs a bounded event and exact evidence')
 for(const e of r.evidence){object(e,['quote'],['sourceId','startUtf16']);text(e.quote,limits.maxQuoteChars);if(e.sourceId!==undefined)id(e.sourceId);if(e.startUtf16!==undefined)integer(e.startUtf16)}
 return r as Proposal
}
export function createExperienceService(store:RpStore,control:{checkManagement(a:HostAuthority):Promise<any>},coordinator:MemoryCoordinator,registeredInputs:(a:HostAuthority)=>ReadonlySet<string>){
 const authorize=async(a:HostAuthority)=>{unwrap(await control.checkManagement(a))}
 const person=async(a:HostAuthority,p:string)=>{id(p);return unwrap(await store.withReadView(a,v=>projectPerson(v,p)))}
 const decision=(ledger:any,candidateId:string)=>ledger.authorityChanges.find((c:any)=>c.kind==='candidate_adoption'&&c.record.candidateId===candidateId)?.record.decision as 'accepted'|'rejected'|undefined
 // Quotas contain no conversation text and survive withdrawal of candidate evidence.
 // A persisted reservation is consumed even if the subsequent candidate write is uncertain.
 const admissions=async(a:HostAuthority,p:string,origin:string,includeId?:string)=>{
  const index=unwrap(await store.readPayloadCopyIndex(a,admissionPrefix(p)))
  const ids=index.slice(-64).map(c=>c.id);if(includeId&&index.some(c=>c.id===includeId)&&!ids.includes(includeId))ids.push(includeId)
  return unwrap(await store.readPayloadCopies(a,ids)).map(copy=>{
   const r=object(JSON.parse(copy.body),['protocol','personId','originEventId','createdAt','proposalSha256'])
   if(r.protocol!=='experience-admission/v1'||r.personId!==p||r.originEventId!==origin)throw new RpError('store_corrupt','Experience admission identity')
   integer(r.createdAt);hash(r.proposalSha256);return {id:copy.id,createdAt:r.createdAt as number,proposalSha256:r.proposalSha256 as string}
  })
 }
 const status=async(a:HostAuthority,p:string)=>{
  id(p)
  return unwrap(await store.withReadView(a,async view=>{
   const who=projectPerson(view,p),ledger=view.ledger!,key=policyKey(p,who.originEventId)
   const last=ledger.authorityChanges.filter(c=>c.kind==='candidate_adoption'&&c.recordId===key).at(-1)
   const policyId=last?.kind==='candidate_adoption'?last.record.controlSourceId:null
   // Audit metadata survives deletion. Only the effective, verified source can
   // authorize new proposals; never fall back to an older enable record.
   const ctl=view.sources.find(s=>s.id===policyId)
   const valid=!!ctl&&ctl.origin==='user_control'&&ctl.visibility.audienceSetId===a.visibility.audienceSetId
   if(valid)await view.readSource(fullSpan(ctl))
   return {personId:p,originEventId:who.originEventId,enabled:valid&&last!.kind==='candidate_adoption'&&last!.record.candidateId===key+'_on',policyId,limits:{...limits}}
  },{audit:true}))
 }
 const checkFence=async(a:HostAuthority,f:InputFence)=>{if(canonical(unwrap(await store.readFence(a)))!==canonical(f))throw new RpError('stale_input','Experience evidence changed during read')}
 // Older v1 copies did not list the policy as a dependency. Verify their saved
 // authorization without migrating history or requiring the switch to stay on.
 const validPolicies=async(a:HostAuthority,keys:string[])=>new Set(unwrap(await store.withReadView(a,async view=>{
  const valid:string[]=[]
  for(const key of new Set(keys)){id(key);const ctl=view.sources.find(s=>s.id===key&&s.origin==='user_control'&&s.visibility.audienceSetId===a.visibility.audienceSetId);if(ctl){await view.readSource(fullSpan(ctl));valid.push(key)}}
  return valid
 })))
 const validPending=async(a:HostAuthority,p:string,origin:string,ledger:any,index:readonly PayloadCopy[])=>{
  const pending=index.filter(c=>!decision(ledger,c.id)),valid=new Set<string>()
  // Legacy invalid copies can accumulate; read bounded batches without treating
  // invisible candidates as a permanent quota reservation. Admissions stay spent.
  for(let i=0;i<pending.length;i+=256){
   const copies=unwrap(await store.readPayloadCopies(a,pending.slice(i,i+256).map(c=>c.id)))
   const saved=copies.map(copy=>{const s=object(JSON.parse(copy.body),['protocol','personId','originEventId','inputSourceId','sessionId','policyId','createdAt','inputFence','proposal','spans']) as Saved;if(s.protocol!=='experience-candidate/v1'||s.personId!==p||s.originEventId!==origin)throw new RpError('store_corrupt','Experience pending identity');return {copy,s}})
   const policies=await validPolicies(a,saved.map(r=>r.s.policyId));for(const r of saved)if(policies.has(r.s.policyId))valid.add(r.copy.id)
  }
  return pending.filter(c=>valid.has(c.id))
 }
 const read=async(a:HostAuthority,p:string,candidateId:string)=>{
  id(candidateId);if(!candidateId.startsWith(prefix(p)))throw new RpError('source_unavailable','Candidate not available for this person')
  const start=unwrap(await store.readFence(a)),who=await person(a,p),copy=unwrap(await store.readPayloadCopies(a,[candidateId]))[0]
  if(!copy||copy.kind!=='job_input')throw new RpError('source_unavailable','Candidate evidence is no longer available')
  const s=object(JSON.parse(copy.body),['protocol','personId','originEventId','inputSourceId','sessionId','policyId','createdAt','inputFence','proposal','spans']) as Saved
  if(s.protocol!=='experience-candidate/v1'||s.personId!==p||s.originEventId!==who.originEventId||digest(JSON.parse(copy.body))!==copy.bodySha256)throw new RpError('store_corrupt','Candidate identity mismatch')
  if(!(await validPolicies(a,[s.policyId])).has(s.policyId))throw new RpError('source_unavailable','Candidate authorization source is no longer available')
  proposal(s.proposal);integer(s.createdAt);if(!Array.isArray(s.spans)||s.spans.length!==s.proposal.evidence.length)throw new RpError('store_corrupt','Candidate spans mismatch')
  const evidence=[]
  for(const [i,span]of s.spans.entries()){sourceSpan(span);const quote=unwrap(await store.readSource(a,span));if(quote!==s.proposal.evidence[i].quote)throw new RpError('store_corrupt','Candidate quote mismatch');evidence.push({...span,quote})}
  const ledger=unwrap(await store.readLedger(a));await checkFence(a,start)
  return {copy,s,evidence,state:decision(ledger,candidateId)??'pending' as const,fence:start}
 }
 const result=(r:Awaited<ReturnType<typeof read>>)=>({id:r.copy.id,state:r.state,bodySha256:r.copy.bodySha256})
 const binding=(ledger:any,ctl:SourceRevision)=>{const old=ledger.sourceBindings.find((b:any)=>b.sourceRevisionId===ctl.id);return old?.disposition==='accepted'?[]:[{sourceRevisionId:ctl.id,branchId:ledger.branch.id,turnId:ctl.turnId!,disposition:'accepted' as const,acceptedSeq:Math.max(0,...ledger.sourceBindings.map((b:any)=>b.acceptedSeq??0))+1}]}
 const actualControl=(ledger:any,ctl:SourceRevision)=>{if(!ledger.sources.some((s:SourceRevision)=>s.id===ctl.id&&s.origin==='user_control'&&s.publicTextSha256===ctl.publicTextSha256))denied('Actual human experience control required')}
 const api={
  async settings(a:HostAuthority,p:string){try{return {ok:true as const,value:await status(a,p)}}catch(e){return failure(e)}},
  async configure(a:HostAuthority,ctl:SourceRevision,input:{personId:string;enabled:boolean;key:string;expectedPolicyId?:string|null}){try{return {ok:true as const,value:await coordinator.mutate(async()=>{
   await authorize(a);const r=object(cloneInput(input),['personId','enabled','key'],['expectedPolicyId']);id(r.personId);text(r.key,180);if(typeof r.enabled!=='boolean')denied('Explicit enabled state required')
   const who=await person(a,r.personId),key=policyKey(r.personId,who.originEventId),operation='experience_config:'+digest([r.personId,r.key]),ledger=unwrap(await store.readLedger(a));actualControl(ledger,ctl)
   const prior=unwrap(await store.readControlCommit(a,operation));if(prior){if(!prior.authorityChanges.some(c=>c.kind==='candidate_adoption'&&c.record.controlSourceId===ctl.id&&c.record.candidateId===key+(r.enabled?'_on':'_off')))throw new RpError('idempotency_conflict','Experience setting changed');unwrap(await store.ensureDurable(a,ledger.fence));return status(a,r.personId)}
   if(r.expectedPolicyId!==undefined&&(await status(a,r.personId)).policyId!==r.expectedPolicyId)throw new RpError('stale_input','Experience policy changed after preview')
   unwrap(await store.commit(a,{schemaVersion:1,idempotencyKey:operation,expected:ledger.fence,sourceBindings:binding(ledger,ctl),events:[],summaries:[],jobs:[],invalidatedIds:[],authorityChanges:[{kind:'candidate_adoption',recordId:key,record:{candidateId:key+(r.enabled?'_on':'_off'),sourceRevisionIds:[],eventIds:[],summaryIds:[],decision:'accepted',controlSourceId:ctl.id}}],nextContextRevision:ledger.fence.contextRevision+1}));return status(a,r.personId)
  })}}catch(e){return failure(e)}},
  async writer(a:HostAuthority,raw:ExperienceExecution,live:()=>boolean=()=>true){try{
   await authorize(a);const x=cloneInput(raw);object(x,['personId','sessionId','inputSourceId','sourceRevisionIds']);id(x.personId);hostId(x.sessionId);id(x.inputSourceId)
   if(a.scope.kind!=='session'||x.sessionId!==a.scope.sessionId||!Array.isArray(x.sourceRevisionIds)||!x.sourceRevisionIds.length||x.sourceRevisionIds.length>64||!x.sourceRevisionIds.includes(x.inputSourceId))denied('Experience execution is not bound to this session')
   x.sourceRevisionIds.forEach(id);const ledger=unwrap(await store.readLedger(a)),current=ledger.sources.find(s=>s.id===x.inputSourceId)
   const eligible=(s:SourceRevision)=>s.visibility.audienceSetId===a.visibility.audienceSetId&&ledger.sourceBindings.some(b=>b.sourceRevisionId===s.id&&b.disposition==='accepted')&&(s.origin==='host_public'&&['user','assistant'].includes(s.role)&&s.host?.sessionId===x.sessionId||registeredInputs(a).has(s.id))
   if(!current||current.scope.kind!=='session'||current.scope.sessionId!==x.sessionId||!eligible(current)||(current.role!=='user'&&!registeredInputs(a).has(current.id)))denied('Current input is not a certified conversation source')
   const allowed=x.sourceRevisionIds.map(key=>{const s=ledger.sources.find(s=>s.id===key);if(!s||!eligible(s))denied('Untrusted conversation evidence');return s!})
   const issued=await status(a,x.personId);if(!issued.enabled)denied('AI experience proposals are disabled')
   let revoked=false;const guard=()=>{if(revoked||!live())throw new RpError('ownership_lost','Experience writer retired')};guard()
   return {ok:true as const,value:Object.freeze({revoke(){revoked=true},async propose(rawProposal:unknown){try{return {ok:true as const,value:await coordinator.mutate(()=>withPublicationGuard(guard,async()=>{
    guard();await authorize(a);const currentPolicy=await status(a,x.personId);if(!currentPolicy.enabled||currentPolicy.policyId!==issued.policyId)denied('Experience policy changed')
    const p=proposal(rawProposal),candidateId=prefix(x.personId)+digest([a.scope.branchId,x.inputSourceId]),index=unwrap(await store.readPayloadCopyIndex(a,prefix(x.personId)))
    if(index.some(c=>c.id===candidateId)){const old=await read(a,x.personId,candidateId);if(canonical(old.s.proposal)!==canonical(p))throw new RpError('idempotency_conflict','This input already proposed a different experience');guard();unwrap(await store.ensureDurable(a,old.fence));return result(old)}
    const view=unwrap(await store.readLedger(a)),pending=await validPending(a,x.personId,currentPolicy.originEventId,view,index);if(pending.length>=limits.maxPending)throw new RpError('request_limit_exceeded','Review pending experience candidates first')
    const admissionId=admissionPrefix(x.personId)+digest([a.scope.branchId,x.inputSourceId]),recent=await admissions(a,x.personId,currentPolicy.originEventId,admissionId),now=Date.now(),priorAdmission=recent.find(r=>r.id===admissionId)
    if(priorAdmission&&priorAdmission.proposalSha256!==digest(p))throw new RpError('idempotency_conflict','This input reserved a different experience proposal')
    if(!priorAdmission&&(recent.some(s=>now-s.createdAt<limits.cooldownSeconds*1000)||recent.filter(s=>now-s.createdAt<86400000).length>=limits.maxPerDay))throw new RpError('request_limit_exceeded','Experience proposal cooldown or daily limit reached')
    const spans:SourceSpan[]=[]
    for(const e of p.evidence){const matches:SourceSpan[]=[];for(const source of allowed){if(e.sourceId&&source.id!==e.sourceId)continue;const body=unwrap(await store.readSource(a,fullSpan(source))),at=e.startUtf16??body.indexOf(e.quote);if(at<0||body.slice(at,at+e.quote.length)!==e.quote)continue;if(e.startUtf16===undefined&&body.indexOf(e.quote,at+1)>=0)throw new RpError('invalid_candidate','Ambiguous repeated quote; supply its exact start');for(const off of [at,at+e.quote.length])if(off>0&&off<body.length&&/[\uD800-\uDBFF]/u.test(body[off-1])&&/[\uDC00-\uDFFF]/u.test(body[off]))throw new RpError('invalid_candidate','Quote splits a Unicode character');matches.push({sourceRevisionId:source.id,publicTextSha256:source.publicTextSha256,startUtf16:at,endUtf16:at+e.quote.length,quoteSha256:sha(e.quote)})}if(matches.length!==1)throw new RpError('invalid_candidate','Quote must uniquely match supplied conversation evidence');spans.push(matches[0])}
    const who=await person(a,x.personId),origin=unwrap(await store.readEvents(a)).find(e=>e.id===who.originEventId)!,saved:Saved={protocol:'experience-candidate/v1',personId:x.personId,originEventId:who.originEventId,inputSourceId:x.inputSourceId,sessionId:x.sessionId,policyId:issued.policyId!,createdAt:now,inputFence:view.fence,proposal:p,spans}
    await checkFence(a,view.fence);guard()
    if(!priorAdmission)unwrap(await store.savePayloadCopy(a,{idempotencyKey:admissionId,id:admissionId,kind:'job_input',sourceRevisionIds:origin.sources.map(s=>s.sourceRevisionId),dependencyIds:[origin.id],body:canonical({protocol:'experience-admission/v1',personId:x.personId,originEventId:origin.id,createdAt:now,proposalSha256:digest(p)})}))
    try{guard()}catch{throw new RpError('persistence_uncertain','Experience admission was reserved but caller retired; inspect before retrying')}
     const copy=unwrap(await store.savePayloadCopy(a,{idempotencyKey:candidateId,id:candidateId,kind:'job_input',sourceRevisionIds:[...new Set([issued.policyId!,x.inputSourceId,...spans.map(s=>s.sourceRevisionId),...origin.sources.map(s=>s.sourceRevisionId)])],dependencyIds:[origin.id],body:canonical(saved)}));try{guard()}catch{throw new RpError('persistence_uncertain','Experience candidate was published but its caller retired; inspect the pending list before retrying')}
    return {id:copy.id,state:'pending' as const,bodySha256:copy.bodySha256}
   }))}}catch(e){return failure(e)}}})}
  }catch(e){return failure(e)}},
  async list(a:HostAuthority,p:string){try{
   const start=unwrap(await store.readFence(a)),who=await person(a,p),ledger=unwrap(await store.readLedger(a)),index=unwrap(await store.readPayloadCopyIndex(a,prefix(p)))
   const pending=await validPending(a,p,who.originEventId,ledger,index),terminal=index.filter(c=>decision(ledger,c.id)).reverse(),chosen=[...pending,...terminal.slice(0,Math.max(0,64-pending.length))]
   if(pending.length>limits.maxPending)throw new RpError('store_corrupt','Experience pending capacity inconsistent')
   const copies=unwrap(await store.readPayloadCopies(a,chosen.map(c=>c.id))),policies=await validPolicies(a,copies.map(c=>JSON.parse(c.body).policyId)),items=copies.flatMap(copy=>{
    const s=object(JSON.parse(copy.body),['protocol','personId','originEventId','inputSourceId','sessionId','policyId','createdAt','inputFence','proposal','spans']) as Saved
    if(s.protocol!=='experience-candidate/v1'||s.personId!==p||s.originEventId!==who.originEventId)throw new RpError('store_corrupt','Experience list identity')
    if(!policies.has(s.policyId))return []
    const candidate=proposal(s.proposal);integer(s.createdAt);return {id:copy.id,state:decision(ledger,copy.id)??'pending',bodySha256:copy.bodySha256,description:candidate.description,epistemic:candidate.epistemic,createdAt:s.createdAt}
   })
   await checkFence(a,start);return {ok:true as const,value:{items,total:index.length,limit:64}}
  }catch(e){return failure(e)}},
  async availability(a:HostAuthority,p:string,inputSourceId?:string){try{
   const start=unwrap(await store.readFence(a)),settings=await status(a,p),ledger=unwrap(await store.readLedger(a)),index=unwrap(await store.readPayloadCopyIndex(a,prefix(p))),pending=(await validPending(a,p,settings.originEventId,ledger,index)).length
   const recent=await admissions(a,p,settings.originEventId),now=Date.now(),used=recent.filter(c=>now-c.createdAt<86400000).length
   const reason=!settings.enabled?'disabled':inputSourceId&&index.some(c=>c.id===prefix(p)+digest([a.scope.branchId,inputSourceId]))?'already_proposed':pending>=limits.maxPending?'pending_limit':used>=limits.maxPerDay?'daily_limit':recent.some(c=>now-c.createdAt<limits.cooldownSeconds*1000)?'cooldown':null
   await checkFence(a,start);return {ok:true as const,value:{allowed:reason===null,reason,pending,dailyRemaining:Math.max(0,limits.maxPerDay-used)}}
  }catch(e){return failure(e)}},
  async get(a:HostAuthority,p:string,candidateId:string){try{const r=await read(a,p,candidateId);return {ok:true as const,value:{...result(r),personId:p,description:r.s.proposal.description,epistemic:r.s.proposal.epistemic,reason:r.s.proposal.reason,evidence:r.evidence,createdAt:r.s.createdAt}}}catch(e){return failure(e)}},
  async decide(a:HostAuthority,ctl:SourceRevision,input:{personId:string;candidateId:string;decision:'accepted'|'rejected';key:string}){try{return {ok:true as const,value:await coordinator.mutate(async()=>{
   await authorize(a);const r=object(cloneInput(input),['personId','candidateId','decision','key']);if(!['accepted','rejected'].includes(r.decision))denied('Explicit candidate decision required');text(r.key,180)
   const saved=await read(a,r.personId,r.candidateId),ledger=unwrap(await store.readLedger(a));actualControl(ledger,ctl)
   if(saved.state!=='pending'){if(saved.state!==r.decision)throw new RpError('idempotency_conflict','Candidate already decided differently');unwrap(await store.ensureDurable(a,ledger.fence));return {id:r.candidateId,state:saved.state}}
   const bindings=binding(ledger,ctl),seq=bindings[0]?.acceptedSeq??ledger.sourceBindings.find(b=>b.sourceRevisionId===ctl.id)!.acceptedSeq!,sources=[...saved.s.spans,fullSpan(ctl)],events:SemanticEvent[]=r.decision==='accepted'?[{schemaVersion:1,id:'event_'+digest(r.candidateId),scope:a.scope,acceptedSeq:Math.max(seq,...sources.map(s=>ledger.sourceBindings.find(b=>b.sourceRevisionId===s.sourceRevisionId)?.acceptedSeq??seq)),fictionalTime:null,payload:{kind:'occurrence',actorIds:[r.personId],description:saved.s.proposal.description},epistemic:saved.s.proposal.epistemic,authority:saved.s.proposal.epistemic==='world'?'explicit_ooc':saved.s.proposal.epistemic==='utterance'?'character_statement':'inference',sources,visibility:a.visibility,supersedes:[],policyVersion:ledger.fence.policyVersion}]:[]
   await checkFence(a,saved.fence)
   unwrap(await store.commit(a,{schemaVersion:1,idempotencyKey:'experience_decision:'+digest([r.candidateId,r.key]),expected:ledger.fence,sourceBindings:bindings,events,summaries:[],jobs:[],invalidatedIds:[],authorityChanges:[{kind:'candidate_adoption',recordId:'experience_decision_'+digest(r.candidateId),record:{candidateId:r.candidateId,sourceRevisionIds:saved.s.spans.map(s=>s.sourceRevisionId).filter((id,i,all)=>all.indexOf(id)===i),eventIds:events.map(e=>e.id),summaryIds:[],decision:r.decision,controlSourceId:ctl.id}}],nextContextRevision:ledger.fence.contextRevision+1}));return {id:r.candidateId,state:r.decision as 'accepted'|'rejected'}
  })}}catch(e){return failure(e)}},
  async receipt(a:HostAuthority,p:string,returned:{id:string;state:string;bodySha256:string}){try{const r=await read(a,p,returned.id);if(canonical(result(r))!==canonical(returned))throw new RpError('stale_input','Proposal changed before receipt');return {ok:true as const,value:{personId:p,candidateId:r.copy.id,bodySha256:r.copy.bodySha256,resultSha256:digest(returned),state:r.state}}}catch(e){return failure(e)}},
  async verify(a:HostAuthority,p:string,proof:ExperienceReceipt){validateExperienceReceipt(proof);if(p!==proof.personId)denied('Experience receipt person mismatch');const r=await read(a,p,proof.candidateId);if(proof.resultSha256!==digest({id:proof.candidateId,state:proof.state,bodySha256:proof.bodySha256})||(proof.state!=='pending'&&proof.state!==r.state))throw new RpError('stale_input','Experience result hash or decision mismatch');if(r.copy.bodySha256!==proof.bodySha256)throw new RpError('stale_input','Experience receipt changed')},
 }
 return Object.freeze(api)
}
export type ExperienceService=ReturnType<typeof createExperienceService>
