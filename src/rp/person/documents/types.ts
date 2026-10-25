/** Draft metadata is descriptive, never a capability or accepted world fact. */
export const DOCUMENT_CATEGORIES = ['persona', 'rule', 'program', 'memory', 'knowledge', 'unclassified'] as const
export type DocumentCategory = typeof DOCUMENT_CATEGORIES[number]
export type DocumentFormat = 'text' | 'markdown'
export interface PersonDocumentInput {
  documentId: string
  personId: string
  title: string
  format: DocumentFormat
  text: string
}
export interface DocumentSection {
  sectionId: string
  title: string
  category: DocumentCategory
  startUtf16: number
  endUtf16: number
}
export interface DocumentChunk {
  chunkId: string
  sectionId: string
  startUtf16: number
  endUtf16: number
  utf8Bytes: number
  sha256: string
}
export interface PersonDocumentDraft extends PersonDocumentInput {
  protocol: 'person-document-draft/v1'
  sha256: string
  utf8Bytes: number
  sections: DocumentSection[]
  chunks: DocumentChunk[]
}
export interface DocumentManifest extends Omit<PersonDocumentDraft, 'text' | 'protocol'> {
  sourceRevisionId: string
  textLengthUtf16: number
}
export interface DocumentValue {
  protocol: 'person-document/v1'
  operation: 'import' | 'revise' | 'retract'
  documentId: string
  personId: string
  originEventId: string
  previousEventId: string | null
  manifest: DocumentManifest | null
}
