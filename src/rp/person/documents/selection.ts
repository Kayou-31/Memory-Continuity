import type {RpReadView} from '../../store.js'
import type {SemanticEvent, SourceSpan} from '../../types.js'
import {documentHead, documentValue} from './format.js'
import {documentHash} from './schema.js'
import type {AudienceIdentity} from './audience.js'
import type {DocumentCategory} from './types.js'
export interface SelectedDocumentChunk {id:string;event:SemanticEvent;text:string;label:string;category:DocumentCategory;span:SourceSpan}
/** Scope/audience filtering is already done by the read view; conditions only narrow it. */
export async function selectDocumentSections(view:RpReadView,personId:string,context:AudienceIdentity|undefined):Promise<SelectedDocumentChunk[]> {
  if(!view.ledger)return []
  const selected:SelectedDocumentChunk[]=[]
  for(const event of view.events){
    const v=documentValue(event)
    if(!v||v.personId!==personId||!v.manifest||documentHead(view.ledger.authorityChanges,personId,v.documentId)!==event.id)continue
    for(const policy of v.policies??[]){
      const w=policy.when
      if(!policy.enabled||(w.sceneIds&&!w.sceneIds.includes(view.context.sceneId??'')))continue
      if(w.kind!=='all'&&(!context||w.kind!==context.kind))continue
      if(w.platform&&w.platform!==context?.platform||w.accountId&&w.accountId!==context?.accountId||w.senderIds&&!w.senderIds.includes(context?.senderId??'')||w.groupIds&&!w.groupIds.includes(context?.groupId??''))continue
      // Do not emit excluded titles, IDs, reasons or counts, nor read their spans.
      for(const c of v.manifest.chunks.filter(c=>c.sectionId===policy.sectionId)){
        const span={sourceRevisionId:v.manifest.sourceRevisionId,publicTextSha256:v.manifest.sha256,startUtf16:c.startUtf16,endUtf16:c.endUtf16,quoteSha256:c.sha256}
        selected.push({id:'document_part_'+documentHash(JSON.stringify([event.id,c.chunkId])).slice(0,40),event,text:await view.readSource(span),label:policy.label,category:policy.category,span})
      }
    }
  }
  return selected
}
