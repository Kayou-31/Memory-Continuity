import {createHash} from 'node:crypto'
import {canonical, type RpStore} from '../../store.js'
import type {createCanonicalService} from '../../canonical.js'
import type {HostAuthority, InputFence, SourceRevision} from '../../types.js'
import {cloneInput, denied, failure, fence, id, invalid, object, RpError, text} from '../../schema.js'
import {unwrap} from '../../retrieval.js'
import {projectPerson} from '../projection.js'
import {documentFromManifest, documentHead, documentPolicies, documentValue} from './format.js'
import {validatePersonDocument} from './schema.js'
import type {DocumentManifest, DocumentValue, DocumentSectionPolicy, PersonDocumentDraft} from './types.js'

const digest = (v:unknown) => createHash('sha256').update(canonical(v)).digest('hex')
export function createDocumentService(store:RpStore, service:ReturnType<typeof createCanonicalService>, entityIds:readonly string[]) {
  type Preview = {authority:HostAuthority; draft:PersonDocumentDraft; policies:DocumentSectionPolicy[]; previousEventId:string|null; originEventId:string; eventId:string; key:string; expected:InputFence}
  const previews = new WeakMap<object,Preview>(), known = new Set(entityIds)
  const keyFor = (key:string) => {text(key,230);return 'person-document:'+key}
  const owner = (personId:string,documentId:string) => {id(personId);id(documentId);if(!known.has(personId))denied('unknown document person')}
  const priorResult = async(authority:HostAuthority,key:string,eventId:string) => {
    const prior = unwrap(await store.readControlCommit(authority,keyFor(key)))
    if (!prior) return null
    if (!prior.authorityChanges.some(c=>c.kind==='candidate_adoption'&&c.recordId==='document_'+eventId&&c.record.eventIds.length===1&&c.record.eventIds[0]===eventId)) throw new RpError('idempotency_conflict','Document operation key has different content')
    unwrap(await store.ensureDurable(authority,unwrap(await store.readFence(authority))))
    return {eventId,fence:prior.fence}
  }
  const controlSource = async(authority:HostAuthority,source:SourceRevision) => {
    const ledger = unwrap(await store.readLedger(authority)), actual = ledger.sources.find(s=>s.id===source.id)
    if (!actual || actual.origin!=='user_control' || actual.publicTextSha256!==source.publicTextSha256) denied('actual document confirmation required')
    return actual
  }
  const publish = async(authority:HostAuthority,ctl:SourceRevision,value:DocumentValue,eventId:string,key:string,expected:InputFence) => {
    const result = await service.applyControl(authority,ctl,{kind:'accept',idempotencyKey:keyFor(key),expected,
      sourceRevisionIds:value.manifest?[value.manifest.sourceRevisionId,ctl.id]:[ctl.id],
      events:[{id:eventId,personProtocol:'person-document/v1',epistemic:'utterance',payload:{kind:'person_document',value}}]})
    if (!result.ok) throw new RpError(result.code,result.message)
    return {eventId,fence:result.value as InputFence}
  }
  return Object.freeze({
    async preview(authority:HostAuthority,input:unknown,key:string) {
      try {
        keyFor(key)
        const v=object(cloneInput(input),['draft'],['previousEventId','policies']), draft=validatePersonDocument(v.draft),policies=documentPolicies(v.policies,new Set(draft.sections.map(s=>s.sectionId)))
        owner(draft.personId,draft.documentId)
        const previousEventId=v.previousEventId??null; if(previousEventId!==null)id(previousEventId)
        const view=unwrap(await store.withReadView(authority,view=>({ledger:view.ledger!,person:projectPerson(view,draft.personId),events:view.events}),{audit:true}))
        const eventId='document_'+digest([view.ledger.branch.workspaceId,view.ledger.branch.id,key,draft,previousEventId,...(policies.length?[policies]:[])]).slice(0,48)
        if (!await priorResult(authority,key,eventId)) {
          const head=documentHead(view.ledger.authorityChanges,draft.personId,draft.documentId)
          if(head!==previousEventId)invalid('document predecessor changed')
          if(head) {const e=view.events.find(e=>e.id===head),p=e&&documentValue(e);if(!p||p.operation==='retract')invalid('document predecessor unavailable or withdrawn')}
        }
        const handle=Object.freeze({}),p={authority,draft,policies,previousEventId,originEventId:view.person.originEventId,eventId,key,expected:view.ledger.fence}
        previews.set(handle,p)
        return {ok:true as const,value:{handle,documentId:draft.documentId,personId:draft.personId,sha256:draft.sha256,utf8Bytes:draft.utf8Bytes,inputFence:structuredClone(p.expected),operation:previousEventId?'revise':'import',draft:structuredClone(draft),policies:structuredClone(policies)}}
      }catch(e){return failure(e)}
    },
    async confirm(authority:HostAuthority,handle:object,source:SourceRevision) {
      try {
        const p=handle&&previews.get(handle);if(!p||p.authority!==authority)denied('unknown or cross-authority document preview')
        const ctl=await controlSource(authority,source),prior=await priorResult(authority,p.key,p.eventId)
        if(prior)return {ok:true as const,value:prior}
        if(canonical(unwrap(await store.readFence(authority)))!==canonical(p.expected))throw new RpError('stale_input','Document preview changed; preview again')
        // Observation is not acceptance. A failed commit leaves no visible document.
        const original=unwrap(await store.observeSource(authority,{idempotencyKey:'document-source:'+p.eventId,origin:'user_control',role:'user_control',turnId:'turn_'+p.eventId,publicText:p.draft.text}))
        const {text:_text,protocol:_protocol,...metadata}=p.draft
        const manifest:DocumentManifest={...metadata,sourceRevisionId:original.id,textLengthUtf16:p.draft.text.length}
        const value:DocumentValue={protocol:'person-document/v1',operation:p.previousEventId?'revise':'import',documentId:p.draft.documentId,personId:p.draft.personId,originEventId:p.originEventId,previousEventId:p.previousEventId,manifest,...(p.policies.length?{policies:p.policies}:{})}
        return {ok:true as const,value:await publish(authority,ctl,value,p.eventId,p.key,p.expected)}
      }catch(e){return failure(e)}
    },
    async read(authority:HostAuthority,personId:string,documentId:string) {
      try {
        owner(personId,documentId)
        return await store.withReadView(authority,async view=>{
          projectPerson(view,personId)
          const head=documentHead(view.ledger!.authorityChanges,personId,documentId),event=view.events.find(e=>e.id===head),value=event&&documentValue(event)
          if(!event||!value)throw new RpError('source_unavailable','Document head unavailable')
          if(!value.manifest)return {status:'withdrawn' as const,eventId:event.id,draft:null,fence:view.fence}
          const m=value.manifest,span=event.sources.find(s=>s.sourceRevisionId===m.sourceRevisionId)
          if(!span)throw new RpError('source_unavailable','Document original unavailable')
          return {status:'active' as const,eventId:event.id,draft:documentFromManifest(m,await view.readSource(span)),policies:structuredClone(value.policies??[]),fence:view.fence}
        },{audit:true})
      }catch(e){return failure(e)}
    },
    async retract(authority:HostAuthority,source:SourceRevision,input:{personId:string;documentId:string;previousEventId:string;expected:InputFence;idempotencyKey:string}) {
      try {
        const v=object(cloneInput(input),['personId','documentId','previousEventId','expected','idempotencyKey'])
        owner(v.personId,v.documentId);id(v.previousEventId);fence(v.expected);keyFor(v.idempotencyKey)
        const ctl=await controlSource(authority,source),eventId='document_'+digest([authority.scope,v,'retract']).slice(0,48)
        const prior=await priorResult(authority,v.idempotencyKey,eventId);if(prior)return {ok:true as const,value:prior}
        const person=unwrap(await store.withReadView(authority,view=>projectPerson(view,v.personId)))
        const value:DocumentValue={protocol:'person-document/v1',operation:'retract',personId:v.personId,documentId:v.documentId,previousEventId:v.previousEventId,originEventId:person.originEventId,manifest:null}
        return {ok:true as const,value:await publish(authority,ctl,value,eventId,v.idempotencyKey,v.expected)}
      }catch(e){return failure(e)}
    },
  })
}
