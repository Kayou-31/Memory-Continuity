import {createOrganizer} from './organizer.js'
export {reconcileDocumentRevision} from './person/documents/reconcile.js'
export {createMemoryBudget,validateMemoryBudget,openMemoryMeter,measureMemoryParts} from './token-budget.js'
/** Trusted application bootstrap. Tools receive only bounded read methods. */
import { openRpStore, canonical } from './store.js'
import { openRpGlobalStore } from './global.js'
import { createCanonicalService } from './canonical.js'
import { createRetrieval, unwrap } from './retrieval.js'
import { createPacketService,type PacketServiceOptions } from './packet.js'
import { MemoryCoordinator } from './session-policy.js'
import type { HostAuthority, CanonBinding, CommitBatch } from './types.js'
import { RpError } from './schema.js'
import fs from 'node:fs/promises'
import { createSummaryService } from './summarizer.js'
import { createJobService } from './jobs.js'
import { createAgentMemory } from './agent-memory.js'
import { createPersonService } from './person/service.js'
import {createDocumentService} from './person/documents/service.js'
import {createDocumentRetrieval} from './person/documents/retrieval.js'
export {createDocumentRetrieval} from './person/documents/retrieval.js'
import {createAudienceService} from './person/documents/audience.js'
import {createDiaryService} from './diary/service.js'
import { createModuleService } from './modules/runtime.js'
import { createManagementService } from './person/management.js'
export { createRuntimeBinding, validateRuntimeBinding, MODULES, MODES, HARD_CONSTRAINTS } from './modules/contract.js'
import type { RecallOptimizer } from './memory-optimizer.js'
export { createUltraRpOptimizer } from './memory-optimizer.js'
export type { AgentMemoryControl } from './agent-memory.js'
export { scoreAnnotatedClaims, validateCandidate } from './candidates.js'
export { importPersonDocument } from './person/documents/import.js'
export { validatePersonDocument } from './person/documents/schema.js'
export {validateDiaryDraft} from './diary/schema.js'
export type {DiaryDraft,DiaryReflection,DiaryEvidence} from './diary/types.js'
export type { PersonDocumentDraft, PersonDocumentInput, DocumentSection, DocumentChunk } from './person/documents/types.js'
export * from './session-policy.js'
export * from './packet.js'
export * from './retrieval.js'
export { canonical } from './store.js'
export async function openRpMemory(input: { profileRoot: string; entityIds: readonly string[]; active?:()=>void; coordinator?: MemoryCoordinator; memoryParts?:PacketServiceOptions['memoryParts']; optimizer?: () => RecallOptimizer | undefined; verification?: (recordId: string) => Promise<'source-match' | 'unavailable' | 'hash-mismatch'> }) {
  const coordinator = input.coordinator ?? new MemoryCoordinator()
  let global: Awaited<ReturnType<typeof openRpGlobalStore>>
  type Adoption = { authority: object; approval: object; binding: CanonBinding }
  const adoptions = new WeakMap<object, Adoption>(); let consumingAdoption: Adoption | undefined
  const opened = await openRpStore({ profileRoot: input.profileRoot, active:input.active, verifyCanonBinding: async binding => {
    const current = consumingAdoption; if (!current || canonical(current.binding) !== canonical(binding)) return false; if (!global.control.isApproval(current.approval)) throw new RpError('scope_denied', 'Canon adoption approval revoked before commit'); return global.store.verifyBinding(current.authority, binding)
  } })
  global = await openRpGlobalStore(input.profileRoot, coordinator,input.active)
  // Every known writer, including later P4 job publication, shares this gate.
  const writes = new Set(['observeSource', 'commit', 'savePayloadCopy', 'transitionJob'])
  const store = new Proxy(opened.store, { get(target, key) { const value = Reflect.get(target, key, target); if (typeof value !== 'function') return value; return (...args: unknown[]) => writes.has(String(key)) ? coordinator.mutate(async () => { const previous = consumingAdoption; if (key === 'commit') consumingAdoption = adoptions.get(args[1] as object); try { return await value.apply(target, args) } finally { consumingAdoption = previous } }) : value.apply(target, args) } })
  const control = new Proxy({ ...opened.control }, { get(target, key) { const value = Reflect.get(target, key); if (typeof value !== 'function') return value; return (...args: unknown[]) => ['createWorkspace', 'createBranch', 'forkBranch', 'privacyDelete', 'purgePrivacy', 'migrateWorkspace', 'recoverWriterLock'].includes(String(key)) ? coordinator.mutate(() => value.apply(target, args)) : value.apply(target, args) } })
  const service = createCanonicalService(store, control, { entityIds: input.entityIds })
  const summaries = createSummaryService({ store: opened.store, global, coordinator, entityIds: input.entityIds })
  const profilePath = await fs.realpath(input.profileRoot), jobs = createJobService({ store: opened.store, summaries, coordinator, profileKey: process.platform === 'win32' ? profilePath.toLowerCase() : profilePath })
  const inputs = new Map<string, Set<string>>()
  const organizer=createOrganizer(store,summaries,a=>inputs.get(a.scope.branchId)??new Set())
  return { organizer,store, control, global, canonical: service, person: createPersonService(store, service, input.entityIds), agentMemory: createAgentMemory(store, service, input.entityIds), summaries, jobs, retrieval: createRetrieval(store, { entityIds: input.entityIds, inputSourceIds: authority => inputs.get(authority.scope.branchId) ?? new Set(), verification: input.verification }), packets: createPacketService(store, global, { optimizer: input.optimizer,memoryParts:input.memoryParts }), coordinator,
    documents: createDocumentService(store,service,input.entityIds),
    documentRetrieval:createDocumentRetrieval(store),
    audiences: createAudienceService(),
    diary:createDiaryService(store,service,input.entityIds),
    registerInputBindings(branchId: string, bindings: readonly import('./packet.js').InputBinding[]) { const set = inputs.get(branchId) ?? new Set<string>(); bindings.filter(b => b.kind === 'input').forEach(b => set.add(b.sourceId)); inputs.set(branchId, set) },
    modules: createModuleService(opened.store, coordinator, input.entityIds, authority => inputs.get(authority.scope.branchId) ?? new Set()),
    management: createManagementService(opened.store, opened.control, input.entityIds, coordinator, profilePath,{organizer,summaries}),
    async adoptCanon(authority: HostAuthority, globalAuthority: object, approval: object, publicationId: string, key: string) {
      // Approval validity is checked by a no-effect host operation, never by TS branding.
      const p = unwrap(await global.store.readPublication(globalAuthority, publicationId))
      if (!global.control.isApproval(approval)) return { ok: false as const, code: 'scope_denied' as const, message: 'Trusted canon adoption command required' }
      if (p.scope.kind !== 'world') return { ok: false as const, code: 'scope_denied' as const, message: 'Profile preferences are not world canon' }
      const binding: CanonBinding = { worldId: p.scope.worldId, ...(p.scope.entityId ? { entityId: p.scope.entityId } : {}), publicationId: p.id, revision: p.revision, bodySha256: p.bodySha256 }
      const expected = unwrap(await store.readFence(authority))
      const batch: CommitBatch = { schemaVersion: 1, idempotencyKey: key, expected, sourceBindings: [], events: [], summaries: [], jobs: [], invalidatedIds: [], authorityChanges: [{ kind: 'canon_binding', recordId: 'canon_' + p.id, record: binding }], nextContextRevision: expected.contextRevision + 1 }
      adoptions.set(batch, { authority: globalAuthority, approval, binding }); return store.commit(authority, batch)
    },
  }
}
