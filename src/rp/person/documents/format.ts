import {hash, id, integer, invalid, object, text} from '../../schema.js'
import {documentCandidate, semanticProtocol} from '../../semantic-registry.js'
import type {AuthorityChange, SemanticEvent} from '../../types.js'
import {DOCUMENT_CATEGORIES, type DocumentManifest, type DocumentValue, type DocumentSectionPolicy} from './types.js'
import {documentTitle, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_CHUNKS, MAX_DOCUMENT_CHUNK_BYTES, MAX_DOCUMENT_SECTIONS, validatePersonDocument} from './schema.js'

/** Structural validation here; the store verifies the actual accepted source bytes. */
export function validateDocumentValue(input: unknown): asserts input is DocumentValue {
  const v = object(input, ['protocol','operation','documentId','personId','originEventId','previousEventId','manifest'], ['policies'])
  if (v.protocol !== 'person-document/v1' || !['import','revise','retract'].includes(v.operation)) invalid('document operation')
  id(v.documentId); id(v.personId); id(v.originEventId)
  if (v.operation === 'import') { if (v.previousEventId !== null) invalid('document import predecessor') }
  else id(v.previousEventId)
  if (v.operation === 'retract') { if (v.manifest !== null || v.policies !== undefined) invalid('withdrawn document manifest'); return }
  const m = object(v.manifest, ['documentId','personId','title','format','sha256','utf8Bytes','sections','chunks','sourceRevisionId','textLengthUtf16'])
  id(m.sourceRevisionId); documentTitle(m.title); hash(m.sha256); integer(m.utf8Bytes,1); integer(m.textLengthUtf16,1)
  if (m.documentId !== v.documentId || m.personId !== v.personId || !['text','markdown'].includes(m.format) || m.utf8Bytes > MAX_DOCUMENT_BYTES || m.textLengthUtf16 > MAX_DOCUMENT_BYTES) invalid('document manifest identity or size')
  if (!Array.isArray(m.sections) || !m.sections.length || m.sections.length > MAX_DOCUMENT_SECTIONS || !Array.isArray(m.chunks) || !m.chunks.length || m.chunks.length > MAX_DOCUMENT_CHUNKS) invalid('document manifest counts')
  const sectionIds = new Set<string>(), chunkIds = new Set<string>()
  let sectionEnd = 0, chunkIndex = 0, bytes = 0
  const range = (r: Record<string,any>, start: number, end: number) => {
    integer(r.startUtf16); integer(r.endUtf16,1)
    if (r.startUtf16 !== start || r.endUtf16 <= start || r.endUtf16 > end) invalid('document range gap or overlap')
  }
  for (const raw of m.sections) {
    const s = object(raw, ['sectionId','title','category','startUtf16','endUtf16'])
    id(s.sectionId); documentTitle(s.title); range(s, sectionEnd, m.textLengthUtf16)
    if (sectionIds.has(s.sectionId) || !DOCUMENT_CATEGORIES.includes(s.category)) invalid('document section identity or category')
    sectionIds.add(s.sectionId)
    let chunkEnd = s.startUtf16
    while (chunkEnd < s.endUtf16) {
      const c = object(m.chunks[chunkIndex++], ['chunkId','sectionId','startUtf16','endUtf16','utf8Bytes','sha256'])
      id(c.chunkId); hash(c.sha256); integer(c.utf8Bytes,1); range(c,chunkEnd,s.endUtf16)
      if (chunkIds.has(c.chunkId) || c.sectionId !== s.sectionId || c.utf8Bytes > MAX_DOCUMENT_CHUNK_BYTES) invalid('document chunk identity or size')
      chunkIds.add(c.chunkId); bytes += c.utf8Bytes; chunkEnd = c.endUtf16
    }
    sectionEnd = s.endUtf16
  }
  if (sectionEnd !== m.textLengthUtf16 || chunkIndex !== m.chunks.length || bytes !== m.utf8Bytes) invalid('document manifest coverage')
  documentPolicies(v.policies, sectionIds)
}
export function documentPolicies(input:unknown,sectionIds:ReadonlySet<string>):DocumentSectionPolicy[] {
  const values=input??[]
  if(!Array.isArray(values)||values.length>MAX_DOCUMENT_SECTIONS)invalid('document policy count')
  const seen=new Set<string>()
  for(const input of values){
    const p=object(input,['sectionId','category','label','tags','enabled','when']);id(p.sectionId);text(p.label,128)
    if(!sectionIds.has(p.sectionId)||seen.has(p.sectionId)||!DOCUMENT_CATEGORIES.includes(p.category)||typeof p.enabled!=='boolean')invalid('document policy identity or category')
    seen.add(p.sectionId)
    const list=(v:unknown,max:number)=>{if(!Array.isArray(v)||!v.length||v.length>max||new Set(v).size!==v.length)invalid('document policy list');v.forEach(s=>text(s,256))}
    if(!Array.isArray(p.tags)||p.tags.length>16||new Set(p.tags).size!==p.tags.length)invalid('document policy tags');p.tags.forEach((s:unknown)=>text(s,64))
    const w=object(p.when,['kind'],['platform','accountId','senderIds','groupIds','sceneIds'])
    if(!['all','direct','group'].includes(w.kind))invalid('document audience kind')
    if(w.platform!==undefined)text(w.platform,128);if(w.accountId!==undefined)text(w.accountId,256)
    for(const key of ['senderIds','groupIds','sceneIds'])if(w[key]!==undefined)list(w[key],32)
    if((w.senderIds||w.groupIds)&&(!w.platform||!w.accountId))invalid('specific audience requires platform and bot account')
    if(w.groupIds&&w.kind!=='group')invalid('group condition requires group context')
  }
  return structuredClone(values) as DocumentSectionPolicy[]
}
export function documentValue(event: SemanticEvent): DocumentValue | null {
  if (semanticProtocol(event) !== 'person-document/v1') return null
  if (event.payload.kind !== 'person_document' || event.epistemic !== 'utterance' || event.authority !== 'character_statement' || event.supersedes.length) invalid('document semantic authority')
  validateDocumentValue(event.payload.value)
  return event.payload.value
}
/** Keep the latest ledger head even when its body becomes unavailable: never resurrect a predecessor. */
export function documentHead(changes: readonly AuthorityChange[], personId: string, documentId: string): string | null {
  let head: string | null = null
  for (const c of changes) if (c.kind === 'candidate_adoption' && c.record.decision === 'accepted' && c.record.candidateId === documentCandidate(personId,documentId)) {
    if (c.record.eventIds.length !== 1 || c.record.summaryIds.length || c.recordId !== 'document_'+c.record.eventIds[0]) invalid('document head marker')
    head = c.record.eventIds[0]
  }
  return head
}
export function documentFromManifest(manifest: DocumentManifest, text: string) {
  const {sourceRevisionId: _source, textLengthUtf16, ...draft} = manifest
  if (text.length !== textLengthUtf16) invalid('document original length')
  return validatePersonDocument({...draft, protocol:'person-document-draft/v1', text})
}
