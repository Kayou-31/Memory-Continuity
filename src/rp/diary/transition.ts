import {canonical} from '../store.js'
import {denied,invalid,RpError} from '../schema.js'
import {semanticProtocol} from '../semantic-registry.js'
import type {AuthorityChange,HostAuthority,SemanticEvent,SourceRevision,SourceSpan} from '../types.js'
import {diaryCandidate,diaryContent,diaryHash,diaryHead,diaryPolicy,diaryPolicyCandidate,diaryValue} from './format.js'
import {requireDiaryAdmission} from './admission.js'
export async function checkDiaryTransition(event:SemanticEvent,history:readonly SemanticEvent[],changes:readonly AuthorityChange[],authority:HostAuthority,source:(id:string)=>SourceRevision,read:(span:SourceSpan)=>Promise<string>) {
  const p=diaryPolicy(event),v=diaryValue(event)
  if(p){
    const head=diaryHead(changes,diaryPolicyCandidate(p.personId,p.boardId))
    if(head!==p.previousEventId)throw new RpError('stale_input','Diary policy predecessor changed')
    const origin=history.find(e=>e.id===p.originEventId)
    if(!origin||semanticProtocol(origin)!=='person-origin/v1'||origin.payload.kind!=='occurrence'||origin.payload.actorIds[0]!==p.personId)denied('Diary person origin unavailable')
    if(head){const e=history.find(e=>e.id===head),prior=e&&diaryPolicy(e);if(!prior||prior.humanId!==p.humanId||prior.originEventId!==p.originEventId)denied('Diary participant identity changed')}
    if(!event.sources.some(s=>source(s.sourceRevisionId).origin==='user_control'))denied('Diary policy requires human control')
  }
  if(!v)return
  const policyEvent=history.find(e=>e.id===v.policyEventId),policy=policyEvent&&diaryPolicy(policyEvent)
  if(!policy||policy.personId!==v.personId||policy.boardId!==v.boardId||diaryHead(changes,diaryPolicyCandidate(v.personId,v.boardId))!==policyEvent!.id)denied('Current diary policy required')
  const head=diaryHead(changes,diaryCandidate(v.personId,v.boardId,v.entryId))
  if(head!==v.previousEventId)throw new RpError('stale_input','Diary entry predecessor changed')
  const priorEvent=head?history.find(e=>e.id===head):undefined,prior=priorEvent&&diaryValue(priorEvent)
  if(head&&!prior)throw new RpError('source_unavailable','Diary predecessor unavailable')
  if(prior&&(prior.author!==v.author||prior.createdAt!==v.createdAt)||!prior&&v.author!==v.editor)denied('Diary original author changed')
  const original=source(v.content.sourceRevisionId)
  if(v.modifiedAt!==original.capturedAt||!prior&&v.createdAt!==original.capturedAt)invalid('diary timestamp provenance')
  if(!event.sources.some(s=>canonical(s)===canonical(v.content)))invalid('diary original source coverage')
  diaryContent(v,await read(v.content))
  if(v.editor==='agent'){
    const a=requireDiaryAdmission(authority)
    if(!policy.allowAgentWrite||v.author!=='agent'||a.boardId!==v.boardId||a.personId!==v.personId||a.policyEventId!==v.policyEventId||canonical(a.execution)!==canonical(v.execution)||a.sourceHash!==v.content.publicTextSha256)denied('Diary writer grant mismatch or disabled')
    if(original.origin!=='agent_diary'||original.host?.sessionId!==v.execution!.sessionId||original.host?.messageId!==v.execution!.callId)denied('Diary execution provenance')
    for(const id of v.execution!.sourceRevisionIds){source(id);if(!event.sources.some(s=>s.sourceRevisionId===id))invalid('diary input coverage')}
  }else if(original.origin!=='user_control')denied('Human diary edit requires actual human source')
  for(const ref of v.evidence){
    const e=history.find(e=>e.id===ref.eventId)
    if(!e||diaryHash(e)!==ref.revision||['person_document','diary_policy','diary_entry'].includes(e.payload.kind))throw new RpError('source_unavailable','Diary evidence event unavailable or unverified')
    if(!e.sources.some(s=>s.sourceRevisionId===ref.span.sourceRevisionId&&s.publicTextSha256===ref.span.publicTextSha256&&s.startUtf16<=ref.span.startUtf16&&s.endUtf16>=ref.span.endUtf16))denied('Diary evidence source not covered by event')
    if(!event.sources.some(s=>s.sourceRevisionId===ref.span.sourceRevisionId))invalid('diary evidence source coverage')
    await read(ref.span)
  }
}
