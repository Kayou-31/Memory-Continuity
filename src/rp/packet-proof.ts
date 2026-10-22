/** Proof of the records actually used to compose a historical packet. */
import { createHash } from 'node:crypto'
import { canonical, type RpStore } from './store.js'
import type { HostAuthority, ProjectionResult, SemanticEvent, Summary } from './types.js'
import { hash, id, object, RpError } from './schema.js'
import { unwrap } from './retrieval.js'

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
  if (!proof) throw new RpError('stale_input', 'Historical packet has no original proof; use clean continuation')
  validatePacketProof(proof)
  const before = unwrap(await store.readFence(authority)), events = unwrap(await store.readEvents(authority)), summaries = unwrap(await store.readSummaries(authority)), projection = unwrap(await store.replayProjection(authority))
  const records = new Map<string, { kind: 'event' | 'summary'; revision: string }>([...events.map(event => [event.id, { kind: 'event', revision: digest(event) }] as const), ...summaries.map(summary => [summary.id, { kind: 'summary', revision: digest(summary) }] as const)])
  if (proof.projectionSha256 !== projectionHash(projection) || proof.records.some(record => records.get(record.id)?.kind !== record.kind || records.get(record.id)?.revision !== record.revision)) throw new RpError('stale_input', 'Historical packet records changed; use clean continuation')
  if (canonical(before) !== canonical(unwrap(await store.readFence(authority)))) throw new RpError('stale_input', 'Packet proof changed during validation')
}
