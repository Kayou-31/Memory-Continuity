import {createHash} from 'node:crypto'
import {cloneInput, hash, id, integer, invalid, object, RpError, text, wellFormed} from '../../schema.js'
import {DOCUMENT_CATEGORIES, type PersonDocumentDraft, type PersonDocumentInput} from './types.js'

export const MAX_DOCUMENT_BYTES = 1024 * 1024
export const MAX_DOCUMENT_CHUNK_BYTES = 8192
export const MAX_DOCUMENT_SECTIONS = 256
export const MAX_DOCUMENT_CHUNKS = 512
export const documentHash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

export function documentTitle(value: unknown): asserts value is string {
  text(value, 512)
  if ([...value].length > 256) invalid('document title exceeds 256 code points')
}

function inputFields(v: Record<string, any>) {
  id(v.documentId); id(v.personId); documentTitle(v.title)
  if (!['text', 'markdown'].includes(v.format)) invalid('document format')
  text(v.text, 4 * MAX_DOCUMENT_BYTES)
  if (Buffer.byteLength(v.text, 'utf8') > MAX_DOCUMENT_BYTES) throw new RpError('capacity_exceeded', 'Document original exceeds 1 MiB UTF-8')
}

export function documentInput(input: unknown): PersonDocumentInput {
  const v = object(cloneInput(input), ['documentId', 'personId', 'title', 'format', 'text'])
  inputFields(v)
  return v as PersonDocumentInput
}

/** Validate every offset and digest; callers cannot hide omitted text in metadata. */
export function validatePersonDocument(input: unknown): PersonDocumentDraft {
  const d = object(cloneInput(input), ['protocol', 'documentId', 'personId', 'title', 'format', 'text', 'sha256', 'utf8Bytes', 'sections', 'chunks'])
  if (d.protocol !== 'person-document-draft/v1') invalid('document protocol')
  inputFields(d); hash(d.sha256); integer(d.utf8Bytes, 1)
  if (documentHash(d.text) !== d.sha256 || Buffer.byteLength(d.text, 'utf8') !== d.utf8Bytes) invalid('document original digest or size')
  if (!Array.isArray(d.sections) || !d.sections.length || d.sections.length > MAX_DOCUMENT_SECTIONS) invalid('document section count')
  if (!Array.isArray(d.chunks) || !d.chunks.length || d.chunks.length > MAX_DOCUMENT_CHUNKS) invalid('document chunk count')
  const sectionIds = new Set<string>(), chunkIds = new Set<string>()
  let sectionEnd = 0, chunkIndex = 0
  const range = (v: Record<string, any>, start: number, end: number) => {
    integer(v.startUtf16); integer(v.endUtf16, 1)
    if (v.startUtf16 !== start || v.endUtf16 <= start || v.endUtf16 > end) invalid('document range gap or overlap')
    const body = d.text.slice(start, v.endUtf16)
    if (!wellFormed(body)) invalid('document range splits Unicode character')
    return body as string
  }
  for (const raw of d.sections) {
    const s = object(raw, ['sectionId', 'title', 'category', 'startUtf16', 'endUtf16'])
    id(s.sectionId); documentTitle(s.title)
    if (sectionIds.has(s.sectionId) || !DOCUMENT_CATEGORIES.includes(s.category)) invalid('document section identity or category')
    sectionIds.add(s.sectionId); range(s, sectionEnd, d.text.length)
    let chunkEnd = s.startUtf16
    while (chunkEnd < s.endUtf16) {
      const c = object(d.chunks[chunkIndex++], ['chunkId', 'sectionId', 'startUtf16', 'endUtf16', 'utf8Bytes', 'sha256'])
      id(c.chunkId); id(c.sectionId); hash(c.sha256); integer(c.utf8Bytes, 1)
      if (chunkIds.has(c.chunkId) || c.sectionId !== s.sectionId) invalid('document chunk identity or section')
      chunkIds.add(c.chunkId)
      const body = range(c, chunkEnd, s.endUtf16)
      if (Buffer.byteLength(body, 'utf8') !== c.utf8Bytes || c.utf8Bytes > MAX_DOCUMENT_CHUNK_BYTES || documentHash(body) !== c.sha256) invalid('document chunk digest or size')
      chunkEnd = c.endUtf16
    }
    sectionEnd = s.endUtf16
  }
  if (sectionEnd !== d.text.length || chunkIndex !== d.chunks.length) invalid('document ranges omit original text')
  return d as PersonDocumentDraft
}
