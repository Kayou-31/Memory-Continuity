/** Explicit, trusted user controls. This service is not a model tool and never
 * subscribes to completion events. All state changes use the P1 store ledger. */
import { createHash } from 'node:crypto'
import type { RpStore } from './store.js'
import type { AuthorityChange, BranchSourceBinding, EventPayload, ForkManifest, HostAuthority, InputFence, Result, SemanticEvent, SourceRevision } from './types.js'
import { cloneInput, event as validateEvent, failure, fence as validateFence, id, invalid, object, denied, text } from './schema.js'
export { assessClaim, reduceEvents } from './reducer.js'
export { applyNativeCanonicalEvent } from './host-adapter.js'

export interface EventProposal {
  readonly id: string; readonly payload: EventPayload; readonly epistemic: SemanticEvent['epistemic']; readonly beliefHolderId?: string
  readonly fictionalTime?: string | null; readonly sourceRevisionIds?: readonly string[]; readonly supersedes?: readonly string[]
  readonly growthProtocol?: 'agent-memory/v1'
}
type BaseControl = { readonly idempotencyKey: string; readonly expected: InputFence }
export type CanonicalControl = BaseControl & (
  | { readonly kind: 'accept' | 'confirm_replay'; readonly sourceRevisionIds: readonly string[]; readonly events: readonly EventProposal[] }
  | { readonly kind: 'reject' | 'retract'; readonly sourceRevisionIds: readonly string[] }
  | { readonly kind: 'replace'; readonly sourceRevisionId: string; readonly replacementSourceRevisionId: string; readonly events: readonly EventProposal[] }
  | { readonly kind: 'retcon'; readonly targetEventIds: readonly string[]; readonly events: readonly EventProposal[] }
  | { readonly kind: 'character_forget'; readonly knowerId: string; readonly claimId: string }
  | { readonly kind: 'privacy_delete'; readonly sourceRevisionIds: readonly string[]; readonly affectedBranchIds: readonly string[] })
const encode = (v: unknown): string => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(encode).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + encode((v as Record<string, unknown>)[k])).join(',') + '}'
const digest = (v: unknown) => createHash('sha256').update(encode(v)).digest('hex')
function list(v: unknown, nonempty = true): asserts v is readonly string[] { if (!Array.isArray(v) || (nonempty && !v.length) || v.length > 256 || new Set(v).size !== v.length) invalid('control IDs'); v.forEach(id) }
const unwrap = <T>(result: Result<T>): T => { if (!result.ok) throw Object.assign(new Error(result.message), { rpResult: result }); return result.value }
const caught = (cause: unknown) => cause && typeof cause === 'object' && 'rpResult' in cause ? (cause as { rpResult: Exclude<Result<never>, { ok: true }> }).rpResult : failure(cause)

export function createCanonicalService(store: RpStore, control: ReturnType<RpStore['hostControl']>, options: { readonly entityIds: readonly string[] }) {
  const entities = new Set(options.entityIds); options.entityIds.forEach(id)
  return Object.freeze({
    forkManifest: (authority: HostAuthority, revision: number) => store.forkManifest(authority, revision),
    forkBranch: (authority: HostAuthority, manifest: ForkManifest & { readonly idempotencyKey: string }) => control.forkBranch(authority, manifest),
    resumePrivacyDelete: (authority: HostAuthority, key: string, affectedAuthorities: readonly HostAuthority[] = [authority]) => control.purgePrivacy(authority, key, affectedAuthorities),
    async applyCanonicalChange(change: CanonicalControl, authority: HostAuthority, userControlSource: SourceRevision) { return this.applyControl(authority, userControlSource, change) },
    async applyControl(authority: HostAuthority, userControlSource: SourceRevision, input: CanonicalControl, affectedAuthorities: readonly HostAuthority[] = [authority]) {
      try {
        const value = cloneInput(input), ctl = cloneInput(userControlSource)
        // Authorization and provenance precede interpreting semantic proposals.
        const ledger = unwrap(await store.readLedger(authority))
        if (authority.viewpoint.kind !== 'narrator') denied('canonical control requires narrator host')
        const source = ledger.sources.find(s => s.id === ctl.id)
        if (!source || source.origin !== 'user_control' || source.publicTextSha256 !== ctl.publicTextSha256 || (source.scope.kind !== 'branch' && source.scope.kind !== 'session') || source.scope.branchId !== ledger.branch.id) denied('actual user control source required')
        text(value.idempotencyKey, 256); validateFence(value.expected)
        const fields: Record<string, string[]> = { accept: ['sourceRevisionIds', 'events'], confirm_replay: ['sourceRevisionIds', 'events'], reject: ['sourceRevisionIds'], retract: ['sourceRevisionIds'], replace: ['sourceRevisionId', 'replacementSourceRevisionId', 'events'], retcon: ['targetEventIds', 'events'], character_forget: ['knowerId', 'claimId'], privacy_delete: ['sourceRevisionIds', 'affectedBranchIds'] }
        if (!Object.hasOwn(fields, value.kind)) invalid('canonical operation')
        object(value, ['kind', 'idempotencyKey', 'expected', ...fields[value.kind]])
        if (value.kind === 'privacy_delete') {
          list(value.sourceRevisionIds); list(value.affectedBranchIds)
          const blocked = await control.privacyDelete(authority, source.id, { idempotencyKey: value.idempotencyKey, expected: value.expected, sourceRevisionIds: value.sourceRevisionIds, affectedBranchIds: value.affectedBranchIds }, affectedAuthorities)
          if (!blocked.ok) return blocked
          return control.purgePrivacy(authority, value.idempotencyKey, affectedAuthorities)
        }
        const commandId = 'control_' + digest(value.idempotencyKey).slice(0, 40), commandHash = 'command_' + digest({ value, controlSourceId: source.id })
        const prior = unwrap(await store.readControlCommit(authority, value.idempotencyKey))
        if (prior) {
          if (!prior.authorityChanges.some(c => c.kind === 'candidate_adoption' && c.recordId === commandId && c.record.candidateId === commandHash)) return { ok: false as const, code: 'idempotency_conflict' as const, message: 'RP control idempotency key has different effects' }
          unwrap(await store.ensureDurable(authority, ledger.fence))
          return { ok: true as const, value: prior.fence }
        }
        if (encode(ledger.fence) !== encode(value.expected)) return { ok: false as const, code: 'stale_input' as const, message: 'RP canonical input changed' }
        const bindings = new Map(ledger.sourceBindings.map(b => [b.sourceRevisionId, b])), mutations = new Map<string, BranchSourceBinding>()
        let nextSeq = Math.max(0, ...ledger.sourceBindings.map(b => b.acceptedSeq ?? 0)) + 1
        const get = (sourceId: string) => { id(sourceId); const s = ledger.sources.find(s => s.id === sourceId); if (!s) denied('control source scope'); return s }
        const bind = (s: SourceRevision, disposition: BranchSourceBinding['disposition'], seq?: number, supersedes?: string) => {
          const old = bindings.get(s.id), b: BranchSourceBinding = { sourceRevisionId: s.id, branchId: ledger.branch.id, turnId: s.turnId!, disposition, acceptedSeq: seq ?? old?.acceptedSeq ?? (disposition === 'accepted' ? nextSeq++ : null), ...(supersedes ? { supersedes } : old?.supersedes ? { supersedes: old.supersedes } : {}) }
          mutations.set(s.id, b); bindings.set(s.id, b)
        }
        let eventSources: SourceRevision[] = [], proposals: readonly EventProposal[] = [], targets: readonly string[] = []
        if (value.kind === 'accept' || value.kind === 'confirm_replay') {
          list(value.sourceRevisionIds)
          eventSources = value.sourceRevisionIds.map(get)
          for (const s of eventSources) {
            if (value.kind === 'confirm_replay' && bindings.get(s.id)?.disposition !== 'pending_replay') invalid('only pending suffix may be confirmed')
            if (value.kind === 'accept' && bindings.get(s.id)?.disposition === 'pending_replay') invalid('pending suffix needs explicit confirmation')
            bind(s, 'accepted')
          }
          proposals = value.events
        } else if (value.kind === 'replace') {
          const old = get(value.sourceRevisionId), replacement = get(value.replacementSourceRevisionId), binding = bindings.get(old.id)
          if (old.id === replacement.id || binding?.disposition !== 'accepted') invalid('active replacement target required')
          bind(old, 'superseded')
          for (const b of ledger.sourceBindings) if (b.disposition === 'accepted' && b.acceptedSeq! > binding.acceptedSeq! && get(b.sourceRevisionId).origin === 'host_public') bind(get(b.sourceRevisionId), 'pending_replay')
          bind(replacement, 'accepted', binding.acceptedSeq!, old.id); eventSources = [replacement]; proposals = value.events
        } else if (value.kind === 'reject' || value.kind === 'retract') {
          list(value.sourceRevisionIds)
          const targets = value.sourceRevisionIds.map(sourceId => { const s = get(sourceId), b = ledger.sourceBindings.find(b => b.sourceRevisionId === sourceId)
            if (value.kind === 'reject' && b?.disposition === 'accepted') invalid('accepted source needs explicit retraction')
            if (value.kind === 'retract' && b?.disposition !== 'accepted') invalid('active retraction target required')
            return { s, b }
          }), explicit = new Set(value.sourceRevisionIds)
          if (value.kind === 'retract') {
            const firstSeq = Math.min(...targets.map(t => t.b!.acceptedSeq!))
            for (const later of ledger.sourceBindings) if (!explicit.has(later.sourceRevisionId) && later.disposition === 'accepted' && later.acceptedSeq! > firstSeq && get(later.sourceRevisionId).origin === 'host_public') bind(get(later.sourceRevisionId), 'pending_replay')
          }
          for (const { s } of targets) bind(s, value.kind === 'reject' ? 'discarded' : 'retracted')
        } else if (value.kind === 'retcon') {
          list(value.targetEventIds)
          targets = value.targetEventIds
          if (targets.some(id => !ledger.records.some(r => r.id === id && r.kind === 'event' && r.active))) invalid('active retcon targets required')
          const editedSeq = Math.min(...targets.map(id => Math.max(...ledger.records.find(r => r.id === id)!.sourceRevisionIds.map(sourceId => bindings.get(sourceId)?.acceptedSeq ?? 0))))
          for (const b of ledger.sourceBindings) if (b.disposition === 'accepted' && b.acceptedSeq! > editedSeq && get(b.sourceRevisionId).origin === 'host_public') bind(get(b.sourceRevisionId), 'pending_replay')
          eventSources = [source]; proposals = value.events
        } else if (value.kind === 'character_forget') {
          id(value.knowerId); id(value.claimId)
          if (!entities.has(value.knowerId)) denied('unknown knowledge holder')
          eventSources = [source]; proposals = [{ id: 'event_' + digest({ key: value.idempotencyKey, branch: ledger.branch.id }).slice(0, 40), payload: { kind: 'knowledge_change', knowerId: value.knowerId, claimId: value.claimId, action: 'forget' }, epistemic: 'world' }]
        } else invalid('canonical operation')
        if (bindings.get(source.id)?.disposition !== 'accepted') bind(source, 'accepted')
        if (!Array.isArray(proposals) || proposals.length > 256) invalid('event proposals')
        const growthMarkers: AuthorityChange[] = []
        const events: SemanticEvent[] = proposals.map((proposal, i) => {
          object(proposal, ['id', 'payload', 'epistemic'], ['fictionalTime', 'beliefHolderId', 'sourceRevisionIds', 'supersedes', 'growthProtocol'])
          if (proposal.epistemic === 'belief' && (!proposal.beliefHolderId || !entities.has(proposal.beliefHolderId))) denied('unknown belief holder')
          if (proposal.payload.kind === 'knowledge_change' && !entities.has(proposal.payload.knowerId)) denied('unknown knowledge holder')
          const origins: SourceRevision[] = proposal.sourceRevisionIds ? (list(proposal.sourceRevisionIds), proposal.sourceRevisionIds.map(get)) : eventSources
          if (origins.some(s => bindings.get(s.id)?.disposition !== 'accepted')) invalid('event sources not accepted')
          const needsControl = proposal.epistemic === 'world' && !origins.some(s => s.role === 'assistant' || s.origin === 'user_control')
          const support = needsControl ? [...origins, source] : origins
          const authorityClass = proposal.epistemic === 'utterance' || proposal.epistemic === 'belief' ? 'character_statement' : proposal.epistemic === 'uncertain' ? 'inference' : support.some(s => s.origin === 'user_control') ? 'explicit_ooc' : 'accepted_narration'
          const event: SemanticEvent = { schemaVersion: 1, id: proposal.id, scope: authority.scope, acceptedSeq: Math.max(...support.map(s => bindings.get(s.id)!.acceptedSeq!)), fictionalTime: proposal.fictionalTime ?? null,
            payload: proposal.payload, epistemic: proposal.epistemic, authority: authorityClass, ...(proposal.beliefHolderId ? { beliefHolderId: proposal.beliefHolderId } : {}),
            sources: support.map(s => ({ sourceRevisionId: s.id, publicTextSha256: s.publicTextSha256, startUtf16: 0, endUtf16: s.publicTextLengthUtf16, quoteSha256: s.publicTextSha256 })),
            visibility: authority.visibility, supersedes: [...new Set([...(proposal.supersedes ?? []), ...(i === 0 ? targets : [])])], policyVersion: ledger.fence.policyVersion }
          validateEvent(event)
          if (proposal.growthProtocol !== undefined) {
            if (proposal.growthProtocol !== 'agent-memory/v1') invalid('growth protocol')
            growthMarkers.push({ kind: 'candidate_adoption', recordId: 'growth_' + event.id, record: { candidateId: 'agent_memory_v1', sourceRevisionIds: support.map(s => s.id), eventIds: [event.id], summaryIds: [], decision: 'accepted', controlSourceId: source.id } })
          }
          return event
        })
        return store.commit(authority, { schemaVersion: 1, idempotencyKey: value.idempotencyKey, expected: value.expected, sourceBindings: [...mutations.values()], events, summaries: [], jobs: [], invalidatedIds: [...targets], nextContextRevision: value.expected.contextRevision + 1,
          authorityChanges: [{ kind: 'candidate_adoption', recordId: commandId, record: { candidateId: commandHash, sourceRevisionIds: eventSources.map(s => s.id), eventIds: events.map(e => e.id), summaryIds: [], decision: value.kind === 'reject' ? 'rejected' : 'accepted', controlSourceId: source.id } }, ...growthMarkers] })
      } catch (cause) { return caught(cause) }
    },
  })
}
