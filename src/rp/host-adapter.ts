/** Native completion is observation only (source-adapter). P0 found no reliable
 * native selection or revision event. Native lineage can be inspected, but is
 * not a supported RP canonical fork mutation and must not create a branch. */
import type { HostAuthority, Result } from './types.js'
import type { createCanonicalService } from './canonical.js'
export async function applyNativeCanonicalEvent(_service: ReturnType<typeof createCanonicalService>, _authority: HostAuthority, input: { readonly kind: string }): Promise<Result<never>> {
  return { ok: false, code: 'capability_missing', message: `RP native ${String(input?.kind)} canonical mutation has no verified SDK event adapter; explicit user control is required` }
}
