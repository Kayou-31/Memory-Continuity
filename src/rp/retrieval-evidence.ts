/** Private association with the exact successful Result, never a JSON ticket. */
import { createHash } from 'node:crypto'
import { canonical } from './store.js'
import type { RpStore } from './store.js'
import type { HostAuthority, InputFence } from './types.js'
import { readConsistentRecords, type RetrievalRecord } from './retrieval-index.js'
import { RpError } from './schema.js'
export type RetrievalRecordRef = Readonly<Pick<RetrievalRecord, 'id' | 'revision' | 'kind'>>
export type RetrievalEvidence = Readonly<{ inputFence: InputFence; records: readonly RetrievalRecordRef[]; resultSha256: string }>
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')
const proofs = new WeakMap<object, { authority: HostAuthority; proof: RetrievalEvidence }>()
export function bindRetrievalEvidence<T extends object>(result: T, authority: HostAuthority, inputFence: InputFence, records: readonly RetrievalRecordRef[]): T {
  const proof = structuredClone({ inputFence, records, resultSha256: hash(result) })
  Object.freeze(proof.inputFence); proof.records.forEach(Object.freeze); Object.freeze(proof.records); Object.freeze(proof)
  proofs.set(result, { authority, proof }); return result
}
export function retrievalEvidence(result: object, authority: HostAuthority): RetrievalEvidence {
  const bound = proofs.get(result)
  if (!bound || bound.authority !== authority || bound.proof.resultSha256 !== hash(result)) throw new RpError('scope_denied', 'Uncertified retrieval Result identity or body')
  return bound.proof
}
export async function verifyRetrievalEvidence(store: RpStore, authority: HostAuthority, proof: RetrievalEvidence, inputs: ReadonlySet<string>) {
  const view = await readConsistentRecords(store, authority, inputs), a = proof.inputFence, b = view.fence
  if (a.branchId !== b.branchId || a.canonBindingsHash !== b.canonBindingsHash || a.visibilityRevision !== b.visibilityRevision || a.deletionGeneration !== b.deletionGeneration || a.policyVersion !== b.policyVersion) throw new RpError('stale_input', 'Retrieval authorization changed')
  const map = new Map(view.records.map(r => [r.id, r]))
  if (proof.records.some(r => map.get(r.id)?.revision !== r.revision || map.get(r.id)?.kind !== r.kind)) throw new RpError('stale_input', 'Retrieved record was invalidated; use clean continuation')
  return view.fence
}
