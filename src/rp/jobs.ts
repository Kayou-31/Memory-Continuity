/** Bounded candidate jobs. Native background generation has no trusted route. */
import { createHash } from 'node:crypto'
import { canonical, type RpStore } from './store.js'
import { failure, RpError } from './schema.js'
import { unwrap } from './retrieval.js'
import type { HostAuthority, Job, Result, SourceRevision, Summary } from './types.js'
import type { SummarySelection } from './candidates.js'
import type { SummaryContext, SummaryService } from './summarizer.js'
import type { MemoryCoordinator } from './session-policy.js'
/** Trusted injected generators must cooperate with cancellation and close their
 * own streams before settling. A slot remains held until actual settlement. */
export interface CandidateGenerator { generate(input: ReturnType<SummaryService['generatorInput']>, signal: AbortSignal): Promise<unknown> }
export interface RunOptions extends SummaryContext {
  controlSource: SourceRevision; signal?: AbortSignal
  /** Requests abort; not a hard completion deadline for an uncooperative generator. */
  timeoutMs?: number; retryStale?: boolean
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
export function createJobService(input: { store: RpStore; summaries: SummaryService; coordinator: MemoryCoordinator; profileKey: string }) {
  const { store, summaries, coordinator } = input, running = new Set<AbortController>(), pending = new Set<Promise<unknown>>(); let closed = false
  const list = async (authority: HostAuthority) => (unwrap(await store.readLedger(authority))).jobs
  const transition = (authority: HostAuthority, expected: Job | null, next: Job, operation: string) => store.transitionJob(authority, { idempotencyKey: operation, expected, next })
  const nativeBlocked = (): Result<never> => ({ ok: false, code: 'capability_missing', message: 'No trusted native background candidate admission route; use manual proposal and adoption.' })
  const service = {
    nativeStatus: () => ({ enabled: false, status: 'blocked', code: 'capability_missing', actualModelCalls: 0 }),
    runNative: async () => nativeBlocked(),
    async list(authority: HostAuthority) { try { return { ok: true as const, value: await list(authority) } } catch (e) { return failure(e) } },
    async enqueue(authority: HostAuthority, selection: SummarySelection, options: SummaryContext & { idempotencyKey: string }) {
      try { return await coordinator.mutate(async () => {
        if (closed) throw new RpError('ownership_lost', 'Summary service closed')
        const id = 'job_' + sha(authority.scope.branchId + ':' + options.idempotencyKey), existing = (await list(authority)).find(j => j.id === id)
        if (existing) {
          const copy = unwrap(await store.readPayloadCopies(authority)).find(c => c.id === existing.inputCopyId)
          if (!copy || canonical(JSON.parse(copy.body).selection) !== canonical(selection)) throw new RpError('idempotency_conflict', 'Job selection changed')
          unwrap(await store.ensureDurable(authority, unwrap(await store.readFence(authority))))
          return { ok: true as const, value: existing }
        }
        const snapshot = await summaries.capture(authority, selection, options), inputCopyId = 'input_' + sha(id)
        unwrap(await store.savePayloadCopy(authority, { idempotencyKey: inputCopyId, id: inputCopyId, kind: 'job_input', sourceRevisionIds: snapshot.sources.map(s => s.source.id), dependencyIds: [...snapshot.dependencies.map(s => s.id), ...snapshot.supportEvents.map(e => e.id)], body: canonical({ schemaVersion: 1, selection }) }))
        const job: Job = { id, kind: 'summarize', inputFence: snapshot.inputFence, attempts: 0, maxAttempts: 3, state: 'queued', idempotencyKey: options.idempotencyKey, inputCopyId }
        return transition(authority, null, job, 'enqueue_' + sha(id))
      }) } catch (e) { return failure(e) }
    },
    async recover(authority: HostAuthority) {
      try { return await coordinator.mutate(async () => {
        for (const job of await list(authority)) if (['queued', 'running', 'prepared', 'stale'].includes(job.state)) unwrap(await transition(authority, job, { ...job, state: 'deferred', errorCode: 'ownership_lost' }, 'recover_' + sha(canonical(job))))
        return { ok: true as const, value: await list(authority) }
      }) } catch (e) { return failure(e) }
    },
    run(authority: HostAuthority, id: string, generator: CandidateGenerator, options: RunOptions): Promise<Result<Summary>> {
      const work = execute(authority, id, generator, options); pending.add(work); void work.finally(() => pending.delete(work)).catch(() => {}); return work
    },
    async close() { closed = true; for (const controller of running) controller.abort(new Error('Summary owner disposed')); await Promise.allSettled([...pending]) },
  }
  async function execute(authority: HostAuthority, id: string, generator: CandidateGenerator, options: RunOptions): Promise<Result<Summary>> {
    let release: (() => void) | null = null, job: Job | undefined
    const controller = new AbortController(); running.add(controller)
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal
    const timeout = options.timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(new Error('Summary timeout')), options.timeoutMs)
    try {
      if (closed) throw new RpError('ownership_lost', 'Summary service closed')
      signal.throwIfAborted()
      job = (await list(authority)).find(j => j.id === id)
      if (!job || !['queued', 'stale'].includes(job.state) || job.attempts >= 3) throw new RpError('invalid_record', 'Job is not runnable; recovery never resumes a model')
      release = coordinator.takeProfileJob(input.profileKey)
      if (!release) { unwrap(await coordinator.mutate(() => transition(authority, job!, { ...job!, state: 'deferred', errorCode: 'store_locked' }, 'busy_' + sha(canonical(job))))); throw new RpError('store_locked', 'One candidate model job per profile is already running') }
      const copies = unwrap(await store.readPayloadCopies(authority)), stored = copies.find(c => c.id === job!.inputCopyId)
      if (!stored) throw new RpError('source_unavailable', 'Summary job input was deleted or invalidated')
      const selection = JSON.parse(stored.body).selection as SummarySelection
      for (;;) {
        signal.throwIfAborted()
        const snapshot = await summaries.capture(authority, selection, options)
        job = unwrap(await coordinator.mutate(async () => {
          signal.throwIfAborted()
          await summaries.guard(authority, snapshot, options)
          signal.throwIfAborted()
          return transition(authority, job!, { ...job!, state: 'running', attempts: job!.attempts + 1, inputFence: snapshot.inputFence }, 'run_' + sha(canonical(job)))
        }))
        try {
          signal.throwIfAborted()
          const raw = await generator.generate(summaries.generatorInput(snapshot), signal)
          signal.throwIfAborted()
          const candidate = await summaries.fromGenerated(authority, raw, snapshot, options)
          signal.throwIfAborted()
          const result = unwrap(await summaries.adopt(authority, options.controlSource, candidate.id, { ...options, signal, job, idempotencyKey: 'commit_' + sha(job.id + ':' + job.attempts) }))
          if (!('summary' in result) || !result.summary) throw new RpError('invalid_candidate', 'Job did not produce a summary')
          return { ok: true, value: result.summary }
        } catch (cause) {
          const stale = cause instanceof RpError && cause.code === 'stale_input'
          const state: Job['state'] = signal.aborted ? 'cancelled' : stale ? 'stale' : 'failed'
          job = unwrap(await coordinator.mutate(() => transition(authority, job!, { ...job!, state, errorCode: stale ? 'stale_input' : signal.aborted ? 'ownership_lost' : 'invalid_candidate' }, 'finish_' + sha(job!.id + ':' + job!.attempts + ':' + state))))
          if (stale && options.retryStale && job.attempts < 3) continue
          if (stale && job.attempts >= 3) job = unwrap(await coordinator.mutate(() => transition(authority, job!, { ...job!, state: 'deferred' }, 'exhausted_' + sha(job!.id))))
          return { ok: false, code: stale ? 'stale_input' : signal.aborted ? 'ownership_lost' : 'invalid_candidate', message: stale ? 'Candidate generation input changed' : signal.aborted ? 'Candidate generation cancelled or timed out' : 'Candidate generation failed' }
        }
      }
    } catch (e) {
      if (signal.aborted && job && ['queued', 'running', 'prepared', 'stale'].includes(job.state)) {
        try { unwrap(await coordinator.mutate(() => transition(authority, job!, { ...job!, state: 'cancelled', errorCode: 'ownership_lost' }, 'cancel_' + sha(canonical(job))))) } catch { /* Revoked authorities cannot publish bookkeeping either; explicit recovery remains available. */ }
      }
      return signal.aborted ? { ok: false, code: 'ownership_lost', message: 'Candidate generation cancelled before execution' } : failure(e)
    }
    finally { if (timeout !== undefined) clearTimeout(timeout); running.delete(controller); release?.() }
  }
  return service
}
