/** Rebuildable authorized view. No global index is ranked before scope checks. */
import { createHash } from 'node:crypto'
import type { RpStore } from './store.js'
import { canonical } from './store.js'
import type { HostAuthority, SemanticEvent, InputFence } from './types.js'
import { RpError } from './schema.js'
import { fullSpan, unwrap } from './retrieval.js'
export interface RetrievalRecord { id: string; revision: string; body: string; kind: 'source' | 'event' | 'summary' | 'state'; entities: readonly string[] }
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
export function eventEntities(e: SemanticEvent): string[] {
  const p = e.payload
  return p.kind === 'occurrence' ? [...p.actorIds] : p.kind === 'knowledge_change' ? [p.knowerId] : p.kind === 'relationship_change' ? [p.fromId, p.toId] : 'subjectId' in p ? [p.subjectId] : []
}
export async function authorizedRecords(store: RpStore, authority: HostAuthority, inputSourceIds: ReadonlySet<string>): Promise<RetrievalRecord[]> {
  return (await readConsistentRecords(store, authority, inputSourceIds)).records
}
export interface RetrievalView { fence: InputFence; records: RetrievalRecord[] }
export async function readConsistentRecords(store: RpStore, authority: HostAuthority, inputSourceIds: ReadonlySet<string>): Promise<RetrievalView> {
  const read = await store.withReadView(authority, async view => {
  const { sources, events, summaries, projection, fence } = view, result: RetrievalRecord[] = []
  for (const source of sources) {
    if (source.origin==='agent_diary'||source.origin === 'user_control' && !inputSourceIds.has(source.id)) continue
    const body = await view.readSource(fullSpan(source))
    result.push({ id: source.id, revision: source.publicTextSha256, body, kind: 'source', entities: [...new Set(events.filter(e => e.sources.some(s => s.sourceRevisionId === source.id)).flatMap(eventEntities))] })
  }
  // Document manifests contain conditions and titles for multiple audiences.
  // They are only exposed through the document selector, never raw recall.
  for (const event of events) { if(['person_document','diary_policy','diary_entry'].includes(event.payload.kind))continue; const body = canonical(event); result.push({ id: event.id, revision: sha(body), body, kind: 'event', entities: eventEntities(event) }) }
  for (const summary of summaries) { const body = canonical(summary); result.push({ id: summary.id, revision: sha(body), body, kind: 'summary', entities: [...new Set(events.filter(e => summary.supportEventIds.includes(e.id)).flatMap(eventEntities))] }) }
  for (const state of projection.state) { const { contextRevision: _context, ...content } = state, body = canonical(content); result.push({ id: 'state_' + sha(canonical([state.subjectId, state.key, state.epistemic, state.beliefHolderId ?? null])), revision: sha(body), body, kind: 'state', entities: [state.subjectId] }) }
  return { fence, records: result }
  })
  if (!read.ok && read.code === 'stale_input') throw new RpError('snapshot_changed', 'RP retrieval changed during assembly')
  return unwrap(read)
}
