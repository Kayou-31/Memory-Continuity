import {invalid} from '../../schema.js'
import {documentHash, documentInput, documentTitle, MAX_DOCUMENT_CHUNK_BYTES, MAX_DOCUMENT_SECTIONS, validatePersonDocument} from './schema.js'
import type {DocumentCategory, DocumentChunk, DocumentSection, PersonDocumentDraft, PersonDocumentInput} from './types.js'

const headings: Record<string, DocumentCategory> = {
  人物: 'persona', 人格: 'persona', 身份: 'persona', 背景: 'persona', 性格: 'persona', 语气: 'persona', 语气示例: 'persona', 表达: 'persona',
  规则: 'rule', 边界: 'rule', 程序: 'program', 记忆: 'memory', 经历: 'memory', 知识: 'knowledge',
  persona: 'persona', identity: 'persona', voice: 'persona', rules: 'rule', programs: 'program', memory: 'memory', knowledge: 'knowledge',
}

/** Heading recognition affects draft organization only; source bytes stay unchanged. */
function sections(input: PersonDocumentInput, sha256: string): DocumentSection[] {
  const starts = [{start: 0, title: input.title, category: 'unclassified' as DocumentCategory}]
  if (input.format === 'markdown') {
    let fence: {character: string; length: number} | undefined
    for (const match of input.text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)) {
      if (!match[0]) continue
      const start = match.index!, line = match[0].replace(/[\r\n]+$/u, ''), content = start === 0 ? line.replace(/^\uFEFF/u, '') : line
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(content)
      if (fence) {
        if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined
        continue
      }
      if (marker) { fence = {character: marker[1][0], length: marker[1].length}; continue }
      const heading = /^ {0,3}#{1,6}(?:[\t ]+|$)(.*)$/u.exec(content)
      if (!heading) continue
      const title = heading[1].replace(/[\t ]+#+[\t ]*$/u, '').trim() || '未命名章节'
      documentTitle(title)
      const key = title.normalize('NFKC').toLowerCase()
      const entry = {start, title, category: Object.hasOwn(headings, key) ? headings[key] : 'unclassified' as DocumentCategory}
      if (start === 0) starts[0] = entry
      else starts.push(entry)
      if (starts.length > MAX_DOCUMENT_SECTIONS) invalid('document exceeds 256 sections; split into separate documents')
    }
  }
  return starts.map((s, i) => ({sectionId: 'section_' + documentHash(JSON.stringify([input.documentId, sha256, s.start])).slice(0,40), title: s.title, category: s.category, startUtf16: s.start, endUtf16: starts[i+1]?.start ?? input.text.length}))
}

export function importPersonDocument(input: PersonDocumentInput): PersonDocumentDraft {
  const value = documentInput(input), sha256 = documentHash(value.text), parts = sections(value, sha256), chunks: DocumentChunk[] = []
  for (const section of parts) {
    let start = section.startUtf16, bytes = 0
    const emit = (end: number) => {
      const body = value.text.slice(start, end)
      chunks.push({chunkId: 'chunk_' + documentHash(JSON.stringify([section.sectionId, start, end])).slice(0,40), sectionId: section.sectionId, startUtf16: start, endUtf16: end, utf8Bytes: bytes, sha256: documentHash(body)})
      start = end; bytes = 0
    }
    for (let at = start; at < section.endUtf16;) {
      const cp = value.text.codePointAt(at)!, size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
      if (bytes + size > MAX_DOCUMENT_CHUNK_BYTES) emit(at)
      bytes += size; at += cp > 0xffff ? 2 : 1
    }
    if (start < section.endUtf16) emit(section.endUtf16)
  }
  return validatePersonDocument({...value, protocol: 'person-document-draft/v1', sha256, utf8Bytes: Buffer.byteLength(value.text, 'utf8'), sections: parts, chunks})
}
