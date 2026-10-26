/** Proof of the records actually used to compose a historical packet. */
import { createHash } from 'node:crypto'
import { canonical, type RpStore } from './store.js'
import type { HostAuthority, ProjectionResult, SemanticEvent, Summary } from './types.js'
import { hash, id, object, RpError } from './schema.js'
import { unwrap } from './retrieval.js'
import {documentHead,documentValue} from './person/documents/format.js'
import {currentDiaryEvents} from './diary/selection.js'

export interface PacketProof {
  readonly records: readonly { readonly id: string; readonly kind: 'event' | 'summary'; readonly revision: string }[]
  readonly projectionSha256: string
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')
// Context revisions change on unrelated source appends. They are not projected facts.
const projectionHash = (projection: ProjectionResult) => digest({ ...projection, state: projection.state.map(({ contextRevision: _revision, ...value }) => value) })

export function validatePacketProof(input: unknown): asserts input is PacketProof {
  const proof = object(input, ['records', 'projectionSha256']); hash(proof.projectionSha256)
  if (!Array.isArray(proof.records) || proof.records.length > 4096) throw new RpError('store_corrupt', 'Invalid packet records')
  const seen = new Set<string>()
  for (const record of proof.records) {
    object(record, ['id', 'kind', 'revision']); id(record.id); hash(record.revision)
    if (!['event', 'summary'].includes(record.kind) || seen.has(record.id)) throw new RpError('store_corrupt', 'Invalid packet record identity')
    seen.add(record.id)
  }
}
export function capturePacketProof(events: readonly SemanticEvent[], summaries: readonly Summary[], projection: ProjectionResult): PacketProof {
  const proof: PacketProof = { records: [...events.map(event => ({ id: event.id, kind: 'event' as const, revision: digest(event) })), ...summaries.map(summary => ({ id: summary.id, kind: 'summary' as const, revision: digest(summary) }))], projectionSha256: projectionHash(projection) }
  validatePacketProof(proof); return proof
}
export async function verifyPacketProof(store: RpStore, authority: HostAuthority, proof: PacketProof | undefined): Promise<void> {
  return verifyPacketProofs(store,authority,[proof])
}
/** One authorization snapshot per admission, with no cross-request validity cache. */
export async function verifyPacketProofs(store: RpStore, authority: HostAuthority, input: readonly (PacketProof|undefined)[]): Promise<void> {
  const proofs:PacketProof[]=[]
  for(const proof of input){if(!proof)throw new RpError('stale_input','Historical packet has no original proof; use clean continuation');validatePacketProof(proof);proofs.push(proof)}
  if(!proofs.length)return
  unwrap(await store.withReadView(authority,view=>{
    const diaries=new Set(currentDiaryEvents(view,undefined,undefined).map(e=>e.id))
    const events=view.events.filter(event=>{if(event.payload.kind==='diary_entry')return diaries.has(event.id);const d=documentValue(event);return !d||!!view.ledger&&!!d.manifest&&documentHead(view.ledger.authorityChanges,d.personId,d.documentId)===event.id})
    const records = new Map<string, { kind: 'event' | 'summary'; revision: string }>([...events.map(event => [event.id, { kind: 'event', revision: digest(event) }] as const), ...view.summaries.map(summary => [summary.id, { kind: 'summary', revision: digest(summary) }] as const)])
    const projected=projectionHash(view.projection)
    for(const proof of proofs)if (proof.projectionSha256 !== projected || proof.records.some(record => records.get(record.id)?.kind !== record.kind || records.get(record.id)?.revision !== record.revision)) throw new RpError('stale_input', 'Historical packet records changed; use clean continuation')
    return true
  },{audit:authority.viewpoint.kind==='narrator'}))
}
