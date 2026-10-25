import {createHash} from 'node:crypto'
import {canonical} from '../store.js'
import {denied,hostId,id,invalid,object,sourceSpan,text} from '../schema.js'
import {semanticProtocol} from '../semantic-registry.js'
import type {AuthorityChange,SemanticEvent} from '../types.js'
import type {AudienceIdentity} from '../person/documents/audience.js'
import type {DiaryAudience,DiaryPolicy,DiaryValue,DiaryExecution} from './types.js'
import {validateDiaryDraft} from './schema.js'
export const diaryHash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex')
export const diaryPolicyCandidate=(personId:string,boardId:string)=>'shared_diary_policy_'+diaryHash([personId,boardId])
export const diaryCandidate=(personId:string,boardId:string,entryId:string)=>'shared_diary_entry_'+diaryHash([personId,boardId,entryId])
export function diaryHead(changes:readonly AuthorityChange[],candidateId:string):string|null {
  let head:string|null=null
  for(const c of changes)if(c.kind==='candidate_adoption'&&c.record.decision==='accepted'&&c.record.candidateId===candidateId){
    if(c.record.eventIds.length!==1||c.record.summaryIds.length||!['diary_policy_'+c.record.eventIds[0],'diary_entry_'+c.record.eventIds[0]].includes(c.recordId))invalid('diary ledger head')
    head=c.record.eventIds[0]
  }
  return head
}
export function validateDiaryAudiences(input:unknown):asserts input is DiaryAudience[]{
  if(!Array.isArray(input)||!input.length||input.length>32)invalid('diary audience list')
  const seen=new Set<string>()
  for(const value of input){
    const a=object(value,['kind'],['platform','accountId','senderId','groupId'])
    if(!['local','direct','group'].includes(a.kind))invalid('diary audience kind')
    if(a.kind==='local'){if(Object.keys(a).length!==1)invalid('local diary audience')}
    else{text(a.platform,128);text(a.accountId,256);text(a.senderId,256);if(a.kind==='group')text(a.groupId,256);else if(a.groupId!==undefined)invalid('direct diary group')}
    const key=canonical(a);if(seen.has(key))invalid('duplicate diary audience');seen.add(key)
  }
}
export function diaryAudienceAllowed(policy:DiaryPolicy,context:AudienceIdentity|undefined):boolean {
  return policy.audiences.some(a=>a.kind==='local'?(!context||context.kind==='local'):!!context&&context.kind===a.kind&&context.platform===a.platform&&context.accountId===a.accountId&&context.senderId===a.senderId&&(a.kind!=='group'||context.groupId===a.groupId))
}
export function validateDiaryPolicy(input:unknown):asserts input is DiaryPolicy {
  const p=object(input,['protocol','boardId','personId','humanId','originEventId','previousEventId','allowAgentWrite','audiences'])
  if(p.protocol!=='shared-diary-policy/v1'||typeof p.allowAgentWrite!=='boolean')invalid('diary policy')
  for(const key of ['boardId','personId','humanId','originEventId'])id(p[key]);if(p.previousEventId!==null)id(p.previousEventId)
  validateDiaryAudiences(p.audiences)
}
export function validateDiaryExecution(input:unknown):asserts input is DiaryExecution {
  const e=object(input,['sessionId','callId','sourceRevisionIds','key']);hostId(e.sessionId);hostId(e.callId);text(e.key,180)
  if(!Array.isArray(e.sourceRevisionIds)||!e.sourceRevisionIds.length||e.sourceRevisionIds.length>32||new Set(e.sourceRevisionIds).size!==e.sourceRevisionIds.length)invalid('diary execution sources')
  e.sourceRevisionIds.forEach(id)
}
export function validateDiaryValue(input:unknown):asserts input is DiaryValue {
  const v=object(input,['protocol','boardId','personId','entryId','policyEventId','previousEventId','author','editor','content','evidence','createdAt','modifiedAt','execution'])
  if(v.protocol!=='shared-diary/v1'||!['human','agent'].includes(v.author)||!['human','agent'].includes(v.editor))invalid('diary identity')
  for(const key of ['boardId','personId','entryId','policyEventId'])id(v[key]);if(v.previousEventId!==null)id(v.previousEventId)
  sourceSpan(v.content);if(v.content.startUtf16!==0||v.content.endUtf16<1||v.content.quoteSha256!==v.content.publicTextSha256)invalid('diary original coverage')
  validateDiaryDraft({entryId:v.entryId,title:'_',body:'_',reflection:{evidence:v.evidence}})
  for(const key of ['createdAt','modifiedAt']){text(v[key],64);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v[key])||!Number.isFinite(Date.parse(v[key])))invalid('diary time')}
  if(v.editor==='agent')validateDiaryExecution(v.execution);else if(v.execution!==null)invalid('human diary execution')
}
export function diaryPolicy(event:SemanticEvent):DiaryPolicy|null {
  if(semanticProtocol(event)!=='shared-diary-policy/v1')return null
  if(event.payload.kind!=='diary_policy'||event.epistemic!=='utterance'||event.authority!=='character_statement'||event.supersedes.length)denied('diary policy semantic authority')
  validateDiaryPolicy(event.payload.value);return event.payload.value
}
export function diaryValue(event:SemanticEvent):DiaryValue|null {
  if(semanticProtocol(event)!=='shared-diary/v1')return null
  if(event.payload.kind!=='diary_entry'||event.epistemic!=='utterance'||event.authority!=='character_statement'||event.supersedes.length)denied('diary semantic authority')
  validateDiaryValue(event.payload.value);return event.payload.value
}
export function diaryContent(value:DiaryValue,body:string){
  const d=validateDiaryDraft(JSON.parse(body))
  if(d.entryId!==value.entryId||(d.previousEventId??null)!==value.previousEventId||canonical(d.reflection?.evidence??[])!==canonical(value.evidence))invalid('diary content metadata mismatch')
  return d
}
