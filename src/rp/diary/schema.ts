import {cloneInput,hash,id,invalid,object,RpError,sourceSpan,text} from '../schema.js'
import {documentTitle} from '../person/documents/schema.js'
import type {DiaryDraft} from './types.js'

/** Syntax and size only. Successful validation never certifies evidence or authorship. */
export function validateDiaryDraft(input:unknown):DiaryDraft {
  const d=object(cloneInput(input),['entryId','title','body'],['previousEventId','reflection'])
  id(d.entryId);documentTitle(d.title);text(d.body,65536)
  if(Buffer.byteLength(d.body,'utf8')>16384)throw new RpError('capacity_exceeded','Diary body exceeds 16 KiB UTF-8')
  if(d.previousEventId!==undefined)id(d.previousEventId)
  if(d.reflection!==undefined){
    const r=object(d.reflection,[],['understanding','context','uncertainty','revisionNote','evidence'])
    for(const key of ['understanding','context','uncertainty','revisionNote'])if(r[key]!==undefined)text(r[key],4096)
    if(r.evidence!==undefined){
      if(!Array.isArray(r.evidence)||r.evidence.length>16)invalid('diary evidence count')
      const seen=new Set<string>()
      for(const raw of r.evidence){
        const e=object(raw,['eventId','revision','span']);id(e.eventId);hash(e.revision);sourceSpan(e.span)
        if(e.span.endUtf16<=e.span.startUtf16)invalid('empty diary evidence span')
        const key=JSON.stringify([e.eventId,e.revision,e.span.sourceRevisionId,e.span.startUtf16,e.span.endUtf16])
        if(seen.has(key))invalid('duplicate diary evidence');seen.add(key)
      }
    }
    if(Buffer.byteLength(JSON.stringify(r),'utf8')>16384)throw new RpError('capacity_exceeded','Diary reflection exceeds 16 KiB UTF-8')
  }
  return d as DiaryDraft
}
