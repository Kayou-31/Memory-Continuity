/** Cooperative root protocol. This is not a native compaction/exclusive-owner claim. */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
export const SESSION_MEMORY_POLICY = 'dsh.session-memory-policy/v1'
export const EVIDENCE_POLICY_PROTOCOL = 'dsh-ultra-evidence/v2'
interface Root { root?: Root; get(key: string): any; provide?(key: string, value: unknown): () => unknown; on?(name: string, listener: any): () => unknown }
export type SessionMode = 'off' | 'engineering' | 'rp' | 'blocked'
export class MemoryCoordinator {
  private tail: Promise<unknown> = Promise.resolve()
  private profileJobs = new Set<string>()
  /** Root-shared, process-local candidate-generation slot; not a native owner lease. */
  takeProfileJob(profileId: string): (() => void) | null {
    if (this.profileJobs.has(profileId)) return null
    this.profileJobs.add(profileId); let done = false
    return () => { if (!done) { done = true; this.profileJobs.delete(profileId) } }
  }
  async lock(): Promise<() => void> {
    const before = this.tail; let release!: () => void
    this.tail = new Promise<void>(resolve => { release = resolve }); await before.catch(() => {})
    let done = false; return () => { if (!done) { done = true; release() } }
  }
  async mutate<T>(work: () => Promise<T>): Promise<T> { const release = await this.lock(); try { return await work() } finally { release() } }
}
export class SessionMemoryPolicy {
  readonly protocol = SESSION_MEMORY_POLICY
  readonly coordinator = new MemoryCoordinator()
  private sessions = new Map<string, { mode: SessionMode; epoch: number; modeEpoch: number }>()
  private writers = new Set<{ kind: string; drain(): Promise<void> }>()
  private stopped = false
  private root?: Root
  private legacyGuard?: () => unknown
  private rpSeen = false
  bindRoot(root: Root, kind: string) { this.root = root; if (kind === 'rp') { this.rpSeen = true; this.ensureLegacyBarrier() } }
  ensureLegacyBarrier() {
    if (!this.rpSeen || !this.root || this.root.get('ultraEvidenceSupport') !== undefined) return
    const self = this
    this.legacyGuard = this.root.provide?.('ultraEvidenceSupport', Object.freeze({ protocol: EVIDENCE_POLICY_PROTOCOL, policyReservation: SESSION_MEMORY_POLICY,
      releaseReservation() { const dispose = self.legacyGuard; self.legacyGuard = undefined; dispose?.() },
    }))
  }
  status(session: string) { return { ...(this.sessions.get(session) ?? { mode: 'off' as SessionMode, epoch: 0, modeEpoch: 0 }) } }
  registerWriter(kind: string, writer: { drain(): Promise<void> }) {
    if (this.stopped) throw new Error('Session memory policy disposed')
    const item = { kind, drain: () => writer.drain() }; this.writers.add(item)
    return async () => { await item.drain(); this.writers.delete(item) }
  }
  async activate(session: string, mode: 'rp' | 'engineering', proof: { idle: boolean; safe: boolean }) {
    return this.coordinator.mutate(async () => {
      if (this.stopped || !proof.idle || !proof.safe) throw new Error('RP activation requires a drained safe session and known cooperating writers')
      for (const writer of this.writers) await writer.drain()
      const current = this.status(session), next = { mode, epoch: current.epoch + 1, modeEpoch: current.modeEpoch + 1 }
      this.sessions.set(session, next); return { ...next }
    })
  }
  async mutate<T>(session: string | null, work: () => Promise<T>): Promise<T> {
    return this.coordinator.mutate(async () => { const result = await work(); for (const [id, old] of this.sessions) if (session === null || session === id) this.sessions.set(id, { ...old, epoch: old.epoch + 1 }); return result })
  }
  async request(session: string, epoch: number): Promise<() => void> {
    const release = await this.coordinator.lock(), state = this.status(session)
    if (this.stopped || state.mode !== 'rp' || state.epoch !== epoch) { release(); throw new Error('RP request policy changed') }
    return release
  }
  /** Keep a closed RP session blocked: unloading must not turn it into engineering. */
  async block(session: string) { await this.coordinator.mutate(async () => { const old = this.status(session); this.sessions.set(session, { mode: 'blocked', epoch: old.epoch + 1, modeEpoch: old.modeEpoch + 1 }) }) }
}
export function engineeringAllowed(context: { root?: any; get?(key: string): any } | undefined, session: string | undefined): boolean {
  const ctx = typeof context?.get === 'function' ? context as Pick<Root, 'get'> : context?.root as Pick<Root, 'get'> | undefined
  if (!ctx || typeof ctx.get !== 'function' || typeof session !== 'string' || !session) return true
  // Persisted RP ownership survives a disabled/missing RP plugin and either
  // loading order. Presence alone is a barrier; no untrusted body is imported.
  const key = createHash('sha256').update(session).digest('hex')
  const agent = ctx.get('agents')?.get?.(session), stored = ctx.get('sessions')?.get?.(session), cwd = agent?.session?.header?.cwd ?? stored?.header?.cwd
  const profile = ctx.get('profileContext')?.dir
  if ((cwd && existsSync(path.join(cwd, '.dsh-rp-policy', 'v1', key + '.json'))) || (profile && existsSync(path.join(profile, '.dsh-rp', 'v1', 'host', key + '.json')))) return false
  const service = ctx.get('sessionMemoryPolicy') as SessionMemoryPolicy | undefined
  if (service === undefined) return true
  if (service.protocol !== SESSION_MEMORY_POLICY) return false
  const mode = service.status(session).mode; return mode === 'off' || mode === 'engineering'
}
/** Kept root-owned even at zero plugin leases so closed RP bindings cannot fall through. */
export function acquireSessionPolicy(context: Root, kind: string) {
  const root = context.root ?? context, evidence = root.get('ultraEvidenceSupport')
  if (evidence !== undefined && evidence.protocol !== EVIDENCE_POLICY_PROTOCOL) throw new Error('Incompatible old evidence writer; align all companion bundles')
  let policy = root.get('sessionMemoryPolicy') as SessionMemoryPolicy | undefined
  if (policy && (policy.protocol !== SESSION_MEMORY_POLICY || typeof policy.request !== 'function')) throw new Error('Incompatible session memory policy')
  if (!policy) {
    policy = new SessionMemoryPolicy(); if (!root.provide) throw new Error('Root policy provider unavailable'); root.provide('sessionMemoryPolicy', policy)
    const shared = policy
    // Root-owned recovery reader outlives plugin leases and never scans. A
    // disabled/unloaded RP owner must not silently fall back to raw sending.
    root.on?.('llm/stream', async function* (options: { sessionId?: string }, next: () => AsyncIterable<unknown>) { if (options.sessionId && !engineeringAllowed(root, options.sessionId) && shared.status(options.sessionId).mode !== 'rp') throw new Error('RP recovery admission blocked; restore its owner or use a clean root session'); yield* next() })
  }
  policy.bindRoot(root, kind)
  const releaseWriter = policy.registerWriter(kind, { drain: async () => {} })
  return { policy, release: releaseWriter }
}
