/** Trusted summary publication. Generation remains outside the writer gate. */
import { createHash } from 'node:crypto'
import type { RpStore } from './store.js'
import { canonical } from './store.js'
import { cloneInput, failure, fence as validateFence, id, integer, object, RpError } from './schema.js'
import { fullSpan, unwrap } from './retrieval.js'
import { validateCandidate, type CandidateSnapshot, type MemoryCandidate, type SavedCandidate, type SummarySelection } from './candidates.js'
import type { HostAuthority, Job, SemanticEvent, SourceRevision, Summary, Result } from './types.js'
import type { openRpGlobalStore } from './global.js'
import { MemoryCoordinator } from './session-policy.js'
export interface SummaryContext { globalAuthorities?: readonly object[]; policyEpoch?: () => number }
export interface PublishContext extends SummaryContext { idempotencyKey: string; job?: Job; signal?: AbortSignal }
export interface AdoptionResult { alreadyDecided: boolean; events?: readonly SemanticEvent[]; summary?: Summary }
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
function fail(code: 'stale_input' | 'scope_denied' | 'invalid_candidate' | 'source_unavailable', message: string): never { throw new RpError(code, message) }
export function createSummaryService(input: { store: RpStore; global: Awaited<ReturnType<typeof openRpGlobalStore>>; coordinator: MemoryCoordinator; entityIds: readonly string[] }) {
  const { store, global, coordinator } = input
  const ids = (v: unknown): string[] => { if (!Array.isArray(v) || v.length > 2048 || new Set(v).size !== v.length) fail('invalid_candidate', 'Selection IDs'); v.forEach(id); return v }
  const epoch = (options: SummaryContext) => { const n = options.policyEpoch?.() ?? 0; integer(n); return n }
  async function capture(authority: HostAuthority, raw: SummarySelection, options: SummaryContext = {}): Promise<CandidateSnapshot> {
    const selection = cloneInput(raw); object(selection, ['level', 'sourceRevisionIds', 'dependencySummaryIds', 'supportEventIds'], ['exactAnchors', 'boundary'])
    if (!['scene', 'chapter', 'arc'].includes(selection.level) || (selection.boundary !== undefined && !['explicit', 'proposal'].includes(selection.boundary))) fail('invalid_candidate', 'Summary level/boundary')
    ids(selection.sourceRevisionIds); ids(selection.dependencySummaryIds); ids(selection.supportEventIds)
    const ledger = unwrap(await store.readLedger(authority)), availableSummaries = unwrap(await store.readSummaries(authority)), allEvents = unwrap(await store.readEvents(authority))
    const dependencies = selection.dependencySummaryIds.map(key => { const s = availableSummaries.find(s => s.id === key); if (!s) fail('source_unavailable', 'Summary dependency is inactive'); return s })
    if (selection.level === 'scene' && dependencies.length || selection.level !== 'scene' && !dependencies.length) fail('invalid_candidate', 'Hierarchy needs its explicit child summaries')
    if (dependencies.some(s => s.level !== (selection.level === 'chapter' ? 'scene' : 'chapter'))) fail('invalid_candidate', 'Summary hierarchy level')
    const supportIds = [...new Set([...selection.supportEventIds, ...dependencies.flatMap(s => s.supportEventIds)])]
    const supportEvents = supportIds.map(key => { const e = allEvents.find(e => e.id === key); if (!e) fail('source_unavailable', 'Support event is inactive'); return e })
    const sourceIds = [...new Set([...selection.sourceRevisionIds, ...dependencies.flatMap(s => s.sourceRevisionIds), ...supportEvents.flatMap(e => e.sources.map(s => s.sourceRevisionId))])].sort()
    if (!sourceIds.length) fail('invalid_candidate', 'Summary requires original sources')
    const sources = []
    for (const key of sourceIds) {
      const source = ledger.sources.find(s => s.id === key)
      if (!source || ledger.sourceBindings.find(b => b.sourceRevisionId === key)?.disposition !== 'accepted') fail('source_unavailable', 'Only effective accepted source revisions are candidates')
      if (source.visibility.audienceSetId !== authority.visibility.audienceSetId) fail('scope_denied', 'Summarize one source audience partition at a time')
      sources.push({ source, text: unwrap(await store.readSource(authority, fullSpan(source))) })
    }
    const globalFences = []
    for (const grant of options.globalAuthorities ?? []) globalFences.push(unwrap(await global.store.readFence(grant)))
    const snapshot: CandidateSnapshot = { inputFence: ledger.fence, globalFences, policyEpoch: epoch(options), selection, sources, dependencies, supportEvents, entityIds: input.entityIds }
    await guard(authority, snapshot, options); return snapshot
  }
  async function guard(authority: HostAuthority, snapshot: Pick<CandidateSnapshot, 'inputFence' | 'globalFences' | 'policyEpoch'>, options: SummaryContext) {
    if (canonical(unwrap(await store.readFence(authority))) !== canonical(snapshot.inputFence) || epoch(options) !== snapshot.policyEpoch) fail('stale_input', 'Summary branch/policy fence changed')
    if ((options.globalAuthorities ?? []).length !== snapshot.globalFences.length) fail('stale_input', 'Applicable global grants changed')
    for (let i = 0; i < snapshot.globalFences.length; i++) if (canonical(unwrap(await global.store.readFence(options.globalAuthorities![i]))) !== canonical(snapshot.globalFences[i])) fail('stale_input', 'Summary global fence changed')
  }
  async function persist(authority: HostAuthority, candidate: MemoryCandidate, snapshot: CandidateSnapshot) {
    const saved: SavedCandidate = { candidate, globalFences: snapshot.globalFences, policyEpoch: snapshot.policyEpoch, selection: snapshot.selection }
    unwrap(await store.savePayloadCopy(authority, { idempotencyKey: candidate.id, id: candidate.id, kind: 'job_input', sourceRevisionIds: snapshot.sources.map(s => s.source.id), dependencyIds: [...snapshot.dependencies.map(d => d.id), ...snapshot.supportEvents.map(e => e.id)], body: canonical(saved) }))
    return { id: candidate.id, state: 'pending' as const, inputFence: candidate.inputFence, hasSummary: !!candidate.proposedSummary, eventCount: candidate.proposedEvents.length }
  }
  async function read(authority: HostAuthority, candidateId: string, options: SummaryContext) {
    id(candidateId)
    const copy = unwrap(await store.readPayloadCopies(authority)).find(c => c.kind === 'job_input' && c.id === candidateId)
    if (!copy) fail('source_unavailable', 'Candidate is unavailable or invalidated')
    const saved = object(JSON.parse(copy.body), ['candidate', 'globalFences', 'policyEpoch', 'selection']), c = object(saved.candidate, ['schemaVersion', 'id', 'inputFence', 'proposedEvents'], ['proposedSummary', 'sceneBoundaryHint'])
    id(c.id); validateFence(c.inputFence); integer(saved.policyEpoch)
    if (c.id !== candidateId || !Array.isArray(saved.globalFences)) fail('invalid_candidate', 'Stored candidate identity')
    await guard(authority, { inputFence: c.inputFence, globalFences: saved.globalFences, policyEpoch: saved.policyEpoch }, options)
    const snapshot = await capture(authority, saved.selection, options), { id: _id, inputFence: _fence, ...proposal } = c
    const candidate = unwrap(validateCandidate(proposal, snapshot)); candidate.id = candidateId
    return { candidate, snapshot }
  }
  function generatorInput(snapshot: CandidateSnapshot) {
    return structuredClone({ schemaVersion: 1, level: snapshot.selection.level, inputFence: snapshot.inputFence,
      sources: snapshot.sources.map(s => ({ id: s.source.id, text: s.text, span: fullSpan(s.source) })), childSummaries: snapshot.dependencies, supportEvents: snapshot.supportEvents,
      entityIds: snapshot.entityIds, boundary: snapshot.selection.boundary ?? 'proposal', rules: 'Return only schemaVersion, proposedEvents and optional proposedSummary/sceneBoundaryHint. No identity, scope, authority, visibility or acceptance fields.' })
  }
  return {
    capture, guard, generatorInput,
    async propose(authority: HostAuthority, raw: unknown, selection: SummarySelection, options: SummaryContext = {}) {
      try { const snapshot = await capture(authority, selection, options), candidate = unwrap(validateCandidate(raw, snapshot)); return { ok: true as const, value: await coordinator.mutate(async () => { await guard(authority, snapshot, options); return persist(authority, candidate, snapshot) }) } }
      catch (e) { return failure(e) }
    },
    async fromGenerated(authority: HostAuthority, raw: unknown, snapshot: CandidateSnapshot, options: SummaryContext = {}) {
      const candidate = unwrap(validateCandidate(raw, snapshot))
      return coordinator.mutate(async () => { await guard(authority, snapshot, options); return persist(authority, candidate, snapshot) })
    },
    async list(authority: HostAuthority) {
      try { const ledger = unwrap(await store.readLedger(authority)), decisions = new Map(ledger.authorityChanges.filter(c => c.kind === 'candidate_adoption').map(c => [c.record.candidateId, c.record.decision]))
        return { ok: true as const, value: unwrap(await store.readPayloadCopies(authority)).filter(c => c.kind === 'job_input' && c.id.startsWith('candidate_')).map(c => { const raw = JSON.parse(c.body); return { id: c.id, state: decisions.get(c.id) ?? (canonical(raw.candidate.inputFence) === canonical(ledger.fence) ? 'pending' : 'stale'), eventCount: raw.candidate.proposedEvents.length, hasSummary: !!raw.candidate.proposedSummary } }) }
      } catch (e) { return failure(e) }
    },
    async get(authority: HostAuthority, candidateId: string, options: SummaryContext = {}) { try { return { ok: true as const, value: (await read(authority, candidateId, options)).candidate } } catch (e) { return failure(e) } },
    async adopt(authority: HostAuthority, controlSource: SourceRevision, candidateId: string, options: PublishContext): Promise<Result<AdoptionResult>> {
      try { return await coordinator.mutate(async () => {
        options.signal?.throwIfAborted()
        const ledger = unwrap(await store.readLedger(authority)), decided = ledger.authorityChanges.find(c => c.kind === 'candidate_adoption' && c.record.candidateId === candidateId)
        if (decided) return { ok: true as const, value: { alreadyDecided: true as const } }
        const { candidate, snapshot } = await read(authority, candidateId, options)
        const ctl = ledger.sources.find(s => s.id === controlSource.id)
        if (!ctl || ctl.origin !== 'user_control' || ctl.publicTextSha256 !== controlSource.publicTextSha256 || ctl.scope.kind !== 'session' && ctl.scope.kind !== 'branch' || ctl.scope.branchId !== ledger.branch.id) fail('scope_denied', 'Actual user adoption control required')
        const current = ledger.sourceBindings.find(b => b.sourceRevisionId === ctl.id), acceptedSeq = current?.acceptedSeq ?? Math.max(0, ...ledger.sourceBindings.map(b => b.acceptedSeq ?? 0)) + 1
        const bindings = current?.disposition === 'accepted' ? [] : [{ sourceRevisionId: ctl.id, branchId: ledger.branch.id, turnId: ctl.turnId!, disposition: 'accepted' as const, acceptedSeq }]
        const events: SemanticEvent[] = candidate.proposedEvents.map((p, i) => {
          const sourceMetadata = p.sources.map(span => snapshot.sources.find(s => s.source.id === span.sourceRevisionId)!.source), needsControl = p.epistemic === 'world' && !sourceMetadata.some(s => s.role === 'assistant' || s.origin === 'user_control')
          const sources = needsControl ? [...p.sources, fullSpan(ctl)] : p.sources
          const authorityClass = p.epistemic === 'belief' || p.epistemic === 'utterance' ? 'character_statement' : p.epistemic === 'uncertain' ? 'inference' : needsControl || sourceMetadata.some(s => s.origin === 'user_control') ? 'explicit_ooc' : 'accepted_narration'
          return { schemaVersion: 1, id: 'event_' + sha(candidate.id + ':' + i), scope: authority.scope, acceptedSeq: Math.max(...sources.map(s => s.sourceRevisionId === ctl.id ? acceptedSeq : ledger.sourceBindings.find(b => b.sourceRevisionId === s.sourceRevisionId)!.acceptedSeq!)), fictionalTime: null, payload: p.payload, epistemic: p.epistemic, authority: authorityClass, sources, ...(p.beliefHolderId ? { beliefHolderId: p.beliefHolderId } : {}), visibility: authority.visibility, supersedes: [], policyVersion: ledger.fence.policyVersion }
        })
        const s = candidate.proposedSummary, summary: Summary | undefined = s && { schemaVersion: 1, id: 'summary_' + sha(candidate.id), scope: authority.scope, level: s.level, createdFrom: ledger.fence,
          sourceRevisionIds: [...new Set([...s.sourceRevisionIds, ...events.flatMap(e => e.sources.map(s => s.sourceRevisionId))])].sort(), dependencySummaryIds: snapshot.dependencies.map(s => s.id), supportEventIds: [...new Set([...snapshot.supportEvents.map(e => e.id), ...events.map(e => e.id)])], exactAnchors: s.exactAnchors, text: s.text, visibility: authority.visibility, policyVersion: ledger.fence.policyVersion, measuredTokens: Buffer.byteLength(s.text, 'utf8'), tokenMeasurement: 'estimated' }
        if (options.job && !summary) fail('invalid_candidate', 'Summary job must propose a summary')
        await guard(authority, snapshot, options)
        options.signal?.throwIfAborted()
        const committed: Job | undefined = options.job && { ...options.job, state: 'committed', summaryId: summary!.id }
        unwrap(await store.commit(authority, { schemaVersion: 1, idempotencyKey: options.idempotencyKey, expected: ledger.fence, sourceBindings: bindings, events, summaries: summary ? [summary] : [], jobs: committed ? [committed] : [], ...(options.job ? { expectedJobs: [options.job] } : {}), invalidatedIds: [], authorityChanges: [{ kind: 'candidate_adoption', recordId: 'adoption_' + sha(candidate.id), record: { candidateId: candidate.id, sourceRevisionIds: snapshot.sources.map(s => s.source.id), eventIds: events.map(e => e.id), summaryIds: summary ? [summary.id] : [], decision: 'accepted', controlSourceId: ctl.id } }], nextContextRevision: ledger.fence.contextRevision + 1 }))
        return { ok: true as const, value: { alreadyDecided: false as const, events, summary } }
      }) } catch (e) { return failure(e) }
    },
    async reject(authority: HostAuthority, controlSource: SourceRevision, candidateId: string, key: string): Promise<Result<{ alreadyDecided: boolean }>> {
      try { return await coordinator.mutate(async () => {
        const ledger = unwrap(await store.readLedger(authority)), ctl = ledger.sources.find(s => s.id === controlSource.id)
        if (!ctl || ctl.origin !== 'user_control' || ctl.publicTextSha256 !== controlSource.publicTextSha256) fail('scope_denied', 'Actual user rejection control required')
        if (!unwrap(await store.readPayloadCopies(authority)).some(c => c.id === candidateId && c.kind === 'job_input')) fail('source_unavailable', 'Unknown candidate')
        if (ledger.authorityChanges.some(c => c.kind === 'candidate_adoption' && c.record.candidateId === candidateId)) return { ok: true as const, value: { alreadyDecided: true } }
        const old = ledger.sourceBindings.find(b => b.sourceRevisionId === ctl.id), seq = Math.max(0, ...ledger.sourceBindings.map(b => b.acceptedSeq ?? 0)) + 1
        unwrap(await store.commit(authority, { schemaVersion: 1, idempotencyKey: key, expected: ledger.fence, sourceBindings: old?.disposition === 'accepted' ? [] : [{ sourceRevisionId: ctl.id, branchId: ledger.branch.id, turnId: ctl.turnId!, disposition: 'accepted', acceptedSeq: seq }], events: [], summaries: [], jobs: [], invalidatedIds: [], authorityChanges: [{ kind: 'candidate_adoption', recordId: 'adoption_' + sha(candidateId), record: { candidateId, sourceRevisionIds: [], eventIds: [], summaryIds: [], decision: 'rejected', controlSourceId: ctl.id } }], nextContextRevision: ledger.fence.contextRevision + 1 }))
        return { ok: true as const, value: { alreadyDecided: false } }
      }) } catch (e) { return failure(e) }
    },
  }
}
export type SummaryService = ReturnType<typeof createSummaryService>
