import type {RpReadView} from '../store.js'
import type {AudienceIdentity} from '../person/documents/audience.js'
import {diaryAudienceAllowed,diaryCandidate,diaryContent,diaryHead,diaryPolicy,diaryPolicyCandidate,diaryValue} from './format.js'
export function currentDiaryEvents(view:RpReadView,personId:string|undefined,audience:AudienceIdentity|undefined){
  if(!view.ledger)return []
  return view.events.filter(event=>{
    const v=diaryValue(event);if(!v||personId&&v.personId!==personId)return false
    if(diaryHead(view.ledger!.authorityChanges,diaryCandidate(v.personId,v.boardId,v.entryId))!==event.id)return false
    const head=diaryHead(view.ledger!.authorityChanges,diaryPolicyCandidate(v.personId,v.boardId)),policyEvent=view.events.find(e=>e.id===head),policy=policyEvent&&diaryPolicy(policyEvent)
    return !!policy&&diaryAudienceAllowed(policy,audience)
  })
}
export async function selectDiaryEntries(view:RpReadView,personId:string,audience:AudienceIdentity|undefined){
  const entries=[]
  for(const event of currentDiaryEvents(view,personId,audience)){
    const v=diaryValue(event)!,draft=diaryContent(v,await view.readSource(v.content)),r=draft.reflection
    const text=(v.author==='agent'?'AI':'人类')+'主观日记《'+draft.title+'》'+(v.editor!==v.author?'（由人类修订，原稿保留）':'')+'：'+draft.body+
      (r?.understanding?'\n当时的理解：'+r.understanding:'')+(r?.context?'\n适用情境：'+r.context:'')+(r?.uncertainty?'\n未验证之处：'+r.uncertainty:'')+(r?.revisionNote?'\n后续修正：'+r.revisionNote:'')
    entries.push({event,value:v,text})
  }
  return entries
}
