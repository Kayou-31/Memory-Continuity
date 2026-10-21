/** Process-local capabilities. No serialized value is an owner or a request ticket. */
export const RP_ADMISSION = 'dsh.rp-admission/v1'
export type BindingStamp = Readonly<{ epoch: number; generation: number; active: boolean }>
type Binding = { owner: object; live: () => BindingStamp }
export class RpAdmission {
  readonly protocol = RP_ADMISSION
  private owners = new WeakMap<object, { active: boolean }>()
  private bindings = new Map<string, Binding>()
  private tickets = new WeakMap<object, { binding: Binding; session: string; stamp: BindingStamp }>()
  private installation?: object
  createOwner() { const owner = Object.freeze({}); this.owners.set(owner, { active: true }); return owner }
  reserve(owner: object) { if (this.installation) throw new Error('RP duplicate installation is unsupported'); this.installation = owner }
  unreserve(owner: object) { if (this.installation === owner) this.installation = undefined }
  bind(owner: object, session: string, live: () => BindingStamp) {
    if (!this.owners.get(owner)?.active || this.bindings.has(session)) throw new Error('RP session owner unavailable')
    this.bindings.set(session, { owner, live })
  }
  retire(owner: object) { const state = this.owners.get(owner); if (state) state.active = false }
  retireBinding(owner: object, session: string) { const b = this.bindings.get(session); if (b?.owner === owner) b.live = () => ({ epoch: -1, generation: -1, active: false }) }
  has(session: string) { return this.bindings.has(session) }
  release(owner: object, session: string) { if (this.bindings.get(session)?.owner === owner) this.bindings.delete(session) }
  issue(owner: object, session: string, options: object, stamp: BindingStamp) {
    const binding = this.bindings.get(session)
    if (!binding || binding.owner !== owner || !this.owners.get(owner)?.active || !stamp.active) throw new Error('RP owner retired')
    const ticket = { binding, session, stamp: { ...stamp } }; this.tickets.set(options, ticket)
    if (!this.permits(session, options)) { this.tickets.delete(options); throw new Error('RP request stamp changed') }
    return () => { if (this.tickets.get(options) === ticket) this.tickets.delete(options) }
  }
  permits(session: string, options: object) {
    const t = this.tickets.get(options), binding = this.bindings.get(session)
    if (!t || t.session !== session || t.binding !== binding || !this.owners.get(binding!.owner)?.active) return false
    const now = binding!.live(); return now.active && now.epoch === t.stamp.epoch && now.generation === t.stamp.generation
  }
}
export function acquireRpAdmission(root: { get(key: string): any; provide?(key: string, value: unknown): unknown }) {
  let value = root.get('rpSessionAdmission') as RpAdmission | undefined
  if (value && (value.protocol !== RP_ADMISSION || typeof value.permits !== 'function' || typeof value.reserve !== 'function')) throw new Error('Incompatible RP admission')
  if (!value) { if (!root.provide) throw new Error('Root admission provider unavailable'); value = new RpAdmission(); root.provide('rpSessionAdmission', value) }
  return value
}
