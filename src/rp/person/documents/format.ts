import {hash, id, integer, invalid, object} from '../../schema.js'
import {documentCandidate, semanticProtocol} from '../../semantic-registry.js'
import type {AuthorityChange, SemanticEvent} from '../../types.js'
import {DOCUMENT_CATEGORIES, type DocumentManifest, type DocumentValue} from './types.js'
import {documentTitle, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_CHUNKS, MAX_DOCUMENT_CHUNK_BYTES, MAX_DOCUMENT_SECTIONS, validatePersonDocument} from './schema.js'

/** Structural validation here; the store verifies the actual accepted source bytes. */
export function validateDocumentValue(input: unknown): asserts input is DocumentValue {
  const v = object(input, ['protocol','operation','documentId','personId','originEventId','previousEventId','manifest'])
  if (v.protocol !== 'person-document/v1' || !['import','revise','retract'].includes(v.operation)) invalid('document operation')
  id(v.documentId); id(v.personId); id(v.originEventId)
  if (v.operation === 'import') { if (v.previousEventId !== null) invalid('document import predecessor') }
  else id(v.previousEventId)
  if (v.operation === 'retract') { if (v.manifest !== null) invalid('withdrawn document manifest'); return }
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
