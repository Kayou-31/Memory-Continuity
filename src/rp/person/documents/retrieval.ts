import {randomUUID} from 'node:crypto'
import {canonical,type RpStore} from '../../store.js'
import {failure,hash,id,integer,object,RpError,sourceSpan,text} from '../../schema.js'
import {unwrap,type RetrievalSizing} from '../../retrieval.js'
import type {RetrievalEvidence} from '../../retrieval-evidence.js'
import type {HostAuthority,InputFence,SourceSpan} from '../../types.js'
import {lexicalScore,queryGroups} from '../../lexical.js'
import {resolveAudience,type AudienceContext} from './audience.js'
import {selectDocumentSections,type SelectedDocumentChunk} from './selection.js'
import {documentHash} from './schema.js'
import {documentExcerpt} from './excerpt.js'

export interface DocumentAccess {personId:string;audience?:AudienceContext}
export interface DocumentReceiptContext {personId:string;chunks:{id:string;recordId:string;revision:string;span:SourceSpan}[]}
export type DocumentEvidence=RetrievalEvidence&{document:DocumentReceiptContext}
const digest=(v:unknown)=>documentHash(canonical(v))
export function validateDocumentReceipt(value:unknown):asserts value is DocumentReceiptContext{
  const d=object(value,['personId','chunks']);id(d.personId)
  if(!Array.isArray(d.chunks)||d.chunks.length>32)throw new RpError('invalid_record','Document receipt chunks')
  const seen=new Set<string>()
  for(const c of d.chunks){object(c,['id','recordId','revision','span']);id(c.id);id(c.recordId);hash(c.revision);sourceSpan(c.span);if(seen.has(c.id))throw new RpError('invalid_record','Duplicate document receipt chunk');seen.add(c.id)}
}
function sameAuthorization(a:InputFence,b:InputFence){
  if(a.branchId!==b.branchId||a.canonBindingsHash!==b.canonBindingsHash||a.visibilityRevision!==b.visibilityRevision||a.deletionGeneration!==b.deletionGeneration||a.policyVersion!==b.policyVersion)throw new RpError('stale_input','Document authorization changed')
}

/** Only this bounded projection is passed to model tools. Management originals stay separate. */
export function createDocumentRetrieval(store:RpStore){
  type Fixed={authority:HostAuthority;access:DocumentAccess;fence:InputFence;ids:{id:string;revision:string}[];query:string;snapshotId:string}
  type Cursor={kind:'search'|'get';fixed:Fixed;offset:number;expires:number}
  const cursors=new Map<string,Cursor>(),proofs=new WeakMap<object,{authority:HostAuthority;proof:DocumentEvidence}>()
  const sweep=()=>{for(const [key,value]of cursors)if(Date.now()>=value.expires)cursors.delete(key)}
  const cursor=(key:string,kind:Cursor['kind'],authority:HostAuthority,access:DocumentAccess)=>{
    sweep();const c=cursors.get(key)
    if(!c||c.kind!==kind||c.fixed.authority!==authority||c.fixed.access.personId!==access.personId||c.fixed.access.audience!==access.audience)throw new RpError('scope_denied','Document cursor expired or belongs to another view')
    return c
  }
  const remember=(key:string,value:Omit<Cursor,'expires'>)=>{sweep();if(cursors.size>=256)cursors.delete(cursors.keys().next().value!);cursors.set(key,{...value,expires:Date.now()+600000})}
  const read=async(authority:HostAuthority,access:DocumentAccess)=>{
    id(access.personId);const audience=access.audience?resolveAudience(access.audience,authority):undefined
    const result=unwrap(await store.withReadView(authority,async view=>({fence:view.fence,chunks:await selectDocumentSections(view,access.personId,audience)}),{audit:true}))
    if(access.audience)resolveAudience(access.audience,authority)
    return result
  }
  const validate=(fixed:Fixed,current:Awaited<ReturnType<typeof read>>)=>{
    sameAuthorization(fixed.fence,current.fence)
    const map=new Map(current.chunks.map(c=>[c.id,c]))
    if(fixed.ids.some(r=>!map.has(r.id)||digest(map.get(r.id)!.event)!==r.revision))throw new RpError('stale_input','Document result set was revised, withdrawn or is unavailable')
    return map
  }
  const certify=<T extends object>(result:T,authority:HostAuthority,access:DocumentAccess,fence:InputFence,chunks:DocumentReceiptContext['chunks'])=>{
    const records=[...new Map(chunks.map(c=>[c.recordId,{id:c.recordId,kind:'event' as const,revision:c.revision}])).values()]
    proofs.set(result,{authority,proof:{inputFence:structuredClone(fence),records,resultSha256:digest(result),document:{personId:access.personId,chunks:structuredClone(chunks)}}})
    return result
  }
  const locator=(c:SelectedDocumentChunk,span:SourceSpan)=>({id:c.id,recordId:c.event.id,revision:digest(c.event),span})
  return Object.freeze({
    async search(authority:HostAuthority,access:DocumentAccess,input:{query?:string;limit?:number;cursor?:string},sizing:RetrievalSizing={}){
      try{
        object(input,[],['query','limit','cursor']);text(input.query??'',4096,true);const limit=input.limit??8;integer(limit,1);if(limit>32)throw new RpError('invalid_record','Document result limit is 32')
        const current=await read(authority,access);let fixed:Fixed,offset=0
        if(input.cursor){const c=cursor(input.cursor,'search',authority,access);fixed=c.fixed;offset=c.offset}
        else{const query=input.query??'',groups=queryGroups(query),hits=current.chunks.map(c=>({id:c.id,revision:digest(c.event),score:lexicalScore(c.text,groups)})).filter(c=>c.score!==null).sort((a,b)=>b.score!-a.score!||a.id.localeCompare(b.id));fixed={authority,access:{...access},fence:current.fence,ids:hits.map(({id,revision})=>({id,revision})),query,snapshotId:randomUUID()}}
        const map=validate(fixed,current),items=fixed.ids.slice(offset,offset+limit).map(r=>{const c=map.get(r.id)!,part=documentExcerpt(c,fixed.query,192);return {...locator(c,part.span),label:c.label,category:c.category,excerpt:part.text}}),next=randomUUID()
        const result=()=>({ok:true as const,value:{snapshotId:fixed.snapshotId,resultManifestHash:digest(fixed.ids),items:[...items],nextCursor:offset+items.length<fixed.ids.length?next:null}})
        while(sizing.fits&&!sizing.fits(result())){if(items.length<=1)throw new RpError('context_budget_exceeded','No complete document search item fits');items.pop()}
        const selected=result();if(selected.value.nextCursor)remember(next,{kind:'search',fixed,offset:offset+items.length})
        return certify(selected,authority,access,current.fence,items.map(({id,recordId,revision,span})=>({id,recordId,revision,span})))
      }catch(e){return failure(e)}
    },
    async get(authority:HostAuthority,access:DocumentAccess,input:{id?:string;cursor?:string;maxChars?:number},sizing:RetrievalSizing={}){
      try{
        object(input,[],['id','cursor','maxChars']);const max=input.maxChars??1024;integer(max,2);if(max>8192)throw new RpError('invalid_record','Document page exceeds 8192 UTF-16 units')
        const current=await read(authority,access);let fixed:Fixed,offset=0
        if(input.cursor){const c=cursor(input.cursor,'get',authority,access);fixed=c.fixed;offset=c.offset}
        else{const found=current.chunks.find(c=>c.id===input.id);if(!found)throw new RpError('source_unavailable','Document part unavailable in this view');fixed={authority,access:{...access},fence:current.fence,ids:[{id:found.id,revision:digest(found.event)}],query:'',snapshotId:randomUUID()}}
        const c=validate(fixed,current).get(fixed.ids[0].id)!,next=randomUUID();let length=max,part=documentExcerpt(c,'',length,offset)
        const result=()=>({ok:true as const,value:{id:c.id,recordId:c.event.id,revision:digest(c.event),snapshotId:fixed.snapshotId,text:part.text,sourceSpan:part.span,nextCursor:part.end<c.text.length?next:null}})
        while(sizing.fits&&!sizing.fits(result())){if(length<=2)throw new RpError('context_budget_exceeded','No complete document code point fits');length=Math.max(2,Math.floor(length/2));part=documentExcerpt(c,'',length,offset)}
        const selected=result();if(selected.value.nextCursor)remember(next,{kind:'get',fixed,offset:part.end})
        return certify(selected,authority,access,current.fence,[locator(c,part.span)])
      }catch(e){return failure(e)}
    },
    evidence(result:object,authority:HostAuthority):DocumentEvidence{
      const saved=proofs.get(result);if(!saved||saved.authority!==authority||saved.proof.resultSha256!==digest(result))throw new RpError('scope_denied','Uncertified document result identity or body')
      return structuredClone(saved.proof)
    },
    async verify(authority:HostAuthority,proof:DocumentEvidence,access:DocumentAccess){
      validateDocumentReceipt(proof.document)
      if(proof.document.personId!==access.personId)throw new RpError('scope_denied','Document receipt belongs to another person')
      const current=await read(authority,access);sameAuthorization(proof.inputFence,current.fence)
      const map=new Map(current.chunks.map(c=>[c.id,c])),records=new Map(proof.records.map(r=>[r.id,r]))
      if(records.size!==new Set(proof.document.chunks.map(c=>c.recordId)).size)throw new RpError('scope_denied','Document receipt record set mismatch')
      for(const ref of proof.document.chunks){
        const c=map.get(ref.id),r=records.get(ref.recordId),span=ref.span
        if(!c||c.event.id!==ref.recordId||digest(c.event)!==ref.revision||r?.kind!=='event'||r.revision!==ref.revision||span.sourceRevisionId!==c.span.sourceRevisionId||span.publicTextSha256!==c.span.publicTextSha256||span.startUtf16<c.span.startUtf16||span.endUtf16>c.span.endUtf16||documentHash(c.text.slice(span.startUtf16-c.span.startUtf16,span.endUtf16-c.span.startUtf16))!==span.quoteSha256)throw new RpError('stale_input','Document evidence was revised or is unavailable')
      }
      return current.fence
    },
    dispose(){cursors.clear()},
  })
}
