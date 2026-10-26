import {documentPolicies} from './format.js'
import {validatePersonDocument} from './schema.js'
import {RpError} from '../../schema.js'
import type {PersonDocumentDraft,DocumentSectionPolicy} from './types.js'
/** Suggestions only: never copy an ambiguous title's audience or enabled flag. */
export function reconcileDocumentRevision(previous:PersonDocumentDraft,next:PersonDocumentDraft,policies:readonly DocumentSectionPolicy[]=[]){
 const old=validatePersonDocument(previous),draft=validatePersonDocument(next),validated=documentPolicies(policies,new Set(old.sections.map(s=>s.sectionId)))
 if(old.personId!==draft.personId||old.documentId!==draft.documentId)throw new RpError('scope_denied','Document revision identity changed')
 const body=(d:PersonDocumentDraft,s:PersonDocumentDraft['sections'][number])=>d.text.slice(s.startUtf16,s.endUtf16)
 const used=new Set<string>(),matches:{previousSectionId:string;nextSectionId:string;reason:string;textChanged:boolean;suggestedCategory:PersonDocumentDraft['sections'][number]['category'];suggestedPolicy?:DocumentSectionPolicy}[]=[]
 for(const section of draft.sections){
  const exact=old.sections.filter(s=>body(old,s)===body(draft,section)),uniqueExact=exact.length===1&&draft.sections.filter(s=>body(draft,s)===body(draft,section)).length===1
  const titles=old.sections.filter(s=>s.title===section.title),uniqueTitle=titles.length===1&&draft.sections.filter(s=>s.title===section.title).length===1
  const prior=uniqueExact?exact[0]:uniqueTitle?titles[0]:undefined
  if(!prior||used.has(prior.sectionId))continue
  used.add(prior.sectionId);const p=validated.find(p=>p.sectionId===prior.sectionId)
  matches.push({previousSectionId:prior.sectionId,nextSectionId:section.sectionId,reason:uniqueExact?'exact-text':'unique-title',textChanged:!uniqueExact,suggestedCategory:p?.category??prior.category,...(p?{suggestedPolicy:{...structuredClone(p),sectionId:section.sectionId}}:{})})
 }
 return {requiresConfirmation:true,matches,unmatchedNext:draft.sections.filter(s=>!matches.some(m=>m.nextSectionId===s.sectionId)).map(s=>s.sectionId),unmatchedPrevious:old.sections.filter(s=>!used.has(s.sectionId)).map(s=>s.sectionId),notice:'匹配是建议；正文改变、重复标题和受众条件请核对。确认前不会沿用旧规则。'}
}
