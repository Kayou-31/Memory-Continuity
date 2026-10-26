/** Marks are derived only from verified ledger records, never protocol text. */
import { createHash } from 'node:crypto'
import type { AuthorityChange, SemanticEvent } from './types.js'
import { invalid } from './schema.js'
import {diaryCandidate,diaryPolicyCandidate} from './diary/format.js'
export type SemanticProtocol = 'agent-memory/v1' | 'person-core/v1' | 'person-origin/v1' | 'person-document/v1' | 'shared-diary/v1' | 'shared-diary-policy/v1'
const marks = new WeakMap<object, SemanticProtocol>()
export const semanticProtocol = (event: object) => marks.get(event)
export const markSemantic = (event: object, protocol: SemanticProtocol) => { const old = marks.get(event); if (old && old !== protocol) invalid('conflicting semantic protocols'); marks.set(event, protocol) }
export const personOriginCandidate = (personId: string) => 'person_origin_' + createHash('sha256').update(personId).digest('hex')
export const documentCandidate = (personId: string, documentId: string) => 'person_document_v1_' + createHash('sha256').update(JSON.stringify([personId,documentId])).digest('hex')
export function markerProtocol(changes: readonly AuthorityChange[], event: SemanticEvent): SemanticProtocol | undefined {
  const found = new Set<SemanticProtocol>()
  for (const c of changes) {
    if (c.kind !== 'candidate_adoption' || c.record.decision !== 'accepted' || c.record.eventIds.length !== 1 || c.record.eventIds[0] !== event.id || c.record.summaryIds.length) continue
    if (c.recordId === 'growth_' + event.id && c.record.candidateId === 'agent_memory_v1') found.add('agent-memory/v1')
    if (c.recordId === 'person_' + event.id && c.record.candidateId === 'person_core_v1') found.add('person-core/v1')
    if (c.recordId === 'document_' + event.id && event.payload.kind === 'person_document' && c.record.candidateId === documentCandidate(event.payload.value.personId,event.payload.value.documentId)) found.add('person-document/v1')
    if (c.recordId === 'diary_policy_'+event.id&&event.payload.kind==='diary_policy'&&c.record.candidateId===diaryPolicyCandidate(event.payload.value.personId,event.payload.value.boardId))found.add('shared-diary-policy/v1')
    if (c.recordId === 'diary_entry_'+event.id&&event.payload.kind==='diary_entry'&&c.record.candidateId===diaryCandidate(event.payload.value.personId,event.payload.value.boardId,event.payload.value.entryId)&&c.record.sourceRevisionIds.length===1&&c.record.sourceRevisionIds[0]===event.payload.value.content.sourceRevisionId)found.add('shared-diary/v1')
    if (c.recordId === 'person_origin_' + event.id && event.payload.kind === 'occurrence' && event.payload.actorIds.length === 1 && c.record.candidateId === personOriginCandidate(event.payload.actorIds[0])) found.add('person-origin/v1')
  }
  if (found.size > 1) invalid('conflicting semantic ledger markers')
  return [...found][0]
}
export const hasPersonOwner = (changes: readonly AuthorityChange[], personId: string) => changes.some(c => c.kind === 'candidate_adoption' && c.record.decision === 'accepted' && c.record.candidateId === personOriginCandidate(personId) && c.record.eventIds.length === 1 && c.recordId === 'person_origin_' + c.record.eventIds[0])
export const requiresPerson = (changes: readonly AuthorityChange[]) => changes.some(c => c.kind === 'candidate_adoption' && (c.record.candidateId === 'person_core_v1' || c.record.candidateId.startsWith('person_origin_')))
export const requiredSemanticCapabilities = (changes: readonly AuthorityChange[]) => [
  ...(requiresPerson(changes) ? ['rp.person-core/v1'] : []),
  ...(changes.some(c => c.kind === 'candidate_adoption' && c.record.candidateId.startsWith('person_document_v1_')) ? ['rp.person-documents/v1'] : []),
  ...(changes.some(c=>c.kind==='candidate_adoption'&&/^shared_diary_(policy|entry)_/u.test(c.record.candidateId))?['rp.shared-diary/v1']:[]),
].sort()
export function inheritSemanticMarks(from: unknown, to: unknown, seen = new WeakSet<object>()) {
  if (!from || !to || typeof from !== 'object' || typeof to !== 'object' || seen.has(from)) return
  seen.add(from); const mark = marks.get(from); if (mark) marks.set(to, mark)
  for (const key of Object.keys(from)) inheritSemanticMarks((from as Record<string, unknown>)[key], (to as Record<string, unknown>)[key], seen)
}
