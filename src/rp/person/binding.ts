import { createHash } from 'node:crypto'
import { canonical, type RpStore } from '../store.js'
import type { HostAuthority, InputFence } from '../types.js'
import { fence, hash, id, object, RpError } from '../schema.js'
import { unwrap } from '../retrieval.js'
import { projectPerson } from './projection.js'
export interface PersonBinding { protocol: 'rp.person-binding/v1'; personId: string; originEventId: string; originSha256: string; boundAt: InputFence }
export function validatePersonBinding(input: unknown): asserts input is PersonBinding {
  const b = object(input, ['protocol', 'personId', 'originEventId', 'originSha256', 'boundAt'])
  if (b.protocol !== 'rp.person-binding/v1') throw new RpError('store_corrupt', 'Unsupported person binding')
  id(b.personId); id(b.originEventId); hash(b.originSha256); fence(b.boundAt)
}
export async function createPersonBinding(store: RpStore, authority: HostAuthority, personId: string): Promise<PersonBinding> {
  return unwrap(await store.withReadView(authority, view => {
    const p = projectPerson(view, personId), origin = view.events.find(e => e.id === p.originEventId)!
    return { protocol: 'rp.person-binding/v1' as const, personId, originEventId: origin.id, originSha256: createHash('sha256').update(canonical(origin)).digest('hex'), boundAt: view.fence }
  }))
}
export async function verifyPersonBinding(store: RpStore, authority: HostAuthority, binding: PersonBinding) {
  validatePersonBinding(binding)
  const current = await createPersonBinding(store, authority, binding.personId)
  if (current.originEventId !== binding.originEventId || current.originSha256 !== binding.originSha256 || current.boundAt.branchId !== binding.boundAt.branchId) throw new RpError('stale_input', 'Original person binding is unavailable')
}
