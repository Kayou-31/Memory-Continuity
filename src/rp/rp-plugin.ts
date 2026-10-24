import {createInjectionBinding,verifyInjectionText,injectionMarkerValid,writeInjectionMarker,type InjectionBinding} from './injection-binding.js'
/** Narrator injection-only adapter for pinned SDK. No automatic canonical selection. */
import { createRuntimeBinding, type RuntimeConfig } from './modules/contract.js'
import type { ModuleRuntime } from './modules/runtime.js'
import { runtimeCommand } from './modules/commands.js'
import { runtimeMarkerValid, writeRuntimeMarker } from './modules/marker.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { createUserMessage, LlmError, LlmRuntime } from '@deepseek-ai/dsh-llm'
import { renderPrompt, renderContextSections, joinContextSections, SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { canonical, readRpJson } from './store.js'
import { openRpMemory } from './memory.js'
import { acquireSessionPolicy, engineeringAllowed, type SessionMemoryPolicy } from './session-policy.js'
import { acquireRpAdmission } from './admission.js'
import { retrievalEvidence, verifyRetrievalEvidence, type RetrievalEvidence } from './retrieval-evidence.js'
import { verifyPacketProof } from './packet-proof.js'
import { createUltraRpOptimizer } from './memory-optimizer.js'
import { createPersonBinding, verifyPersonBinding } from './person/binding.js'
import { openManagementServer } from './person/management-server.js'
import { observePublicHostSource } from './source-adapter.js'
import { fullSpan, unwrap } from './retrieval.js'
import { estimateFinalRequest, type GlobalDependency, type InputBinding, type MemoryPacket, type RuntimeBudget } from './packet.js'
import { checkedRpJson, cloneInput, fence as validateFence, hash, hostId, id, integer, object, RpError, scope as validateScope, text } from './schema.js'
import type { AuthorityRequest } from './store.js'
import type { HostAuthority, InputFence, SourceRevision } from './types.js'
import type { GlobalFence } from './global.js'
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const uid = (p: string) => p + '_' + randomUUID().replaceAll('-', '')
const body = (m: any) => (m.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
const normalizedMessage = (m: any) => canonical(m)
const commandObject = (input: string, required: readonly string[], optional: readonly string[] = []) => {
  let value: unknown
  try { value = JSON.parse(input) } catch (e) { if (e instanceof SyntaxError) throw new RpError('invalid_record', 'Command requires valid JSON'); throw e }
  return object(value, required, optional)
}
const validReadToolContent = (content: unknown): boolean => {
  try {
    if (!Array.isArray(content)) return false
    const calls = new Set<string>()
    for (const block of content) {
      if (block?.type === 'text') { object(block, ['type', 'text']); if (typeof block.text !== 'string') return false }
      else {
        object(block, ['type', 'id', 'name', 'arguments']); hostId(block.id)
        if (block.type !== 'tool-call' || !['rp_memory_search', 'rp_memory_get', 'rp_memory_status'].includes(block.name) || typeof block.arguments !== 'string' || calls.has(block.id)) return false
        calls.add(block.id)
      }
    }
    return calls.size > 0
  } catch { return false }
}
import { validateJournal, type Snapshot, type Input, type DurableSession } from './host-journal.js'
interface Bound { runtime?: ModuleRuntime; agent: Agent; authority: HostAuthority; data: DurableSession; queue: Promise<unknown>; saveQueue: Promise<void>; packet?: MemoryPacket; staticSystem?: string; staticTools?: string; generation: number; lastError?: string; recoveryOnly?: boolean; personPreview?: { id: string; handle: object; draftHash: string } }
export interface RpPluginConfig {
  enabled?: boolean; profileRoot?: string; workspaceRoot?: string; campaignId?: string; entityIds?: readonly string[]; budget?: RuntimeBudget
  /** P5 remains gated. Both default false; true is rejected before bootstrap. */
  contextCompression?: boolean; strictPov?: boolean
  /** Trusted composition attestation. Not a claim about arbitrary installed plugins. */
  knownCooperatingWriters?: boolean
  /** Enable the local RP-safe optimizer when compatible Ultra evidence is live. */
  ultraMemoryOptimization?: boolean
  globalGrants?: readonly { scope: any; visibility: any; audienceSetIds: string[]; write: boolean }[]
  /** Fault seam before dispatch, used to prove durable input recovery without a model. */
  beforeInputDispatch?: () => Promise<void>
  inputFault?: (stage: 'intent_saved' | 'acceptance_committed' | 'dispatch_marked') => Promise<void>
}
export async function installRpPlugin(context: Context, config: RpPluginConfig = {}) {
  if (config.enabled !== true) {
    // No bootstrap, directory scan or capture while disabled. Retain a lazy
    // recovery veto for already-owned RP sessions instead of abandoning them.
    const root = context.root ?? context, remove = root.on('llm/stream', (async function* (options: any, next: () => AsyncIterable<any>) { if (options.sessionId && !engineeringAllowed(root, options.sessionId) && ((root.get('sessionMemoryPolicy') as any)?.status(options.sessionId).mode !== 'rp' || !(root.get('rpSessionAdmission') as any)?.permits(options.sessionId, options))) throw new LlmError('RP recovery owner is unavailable', 'RP_ADMISSION'); yield* next() }) as never)
    return Object.freeze({ enabled: false, close: async () => { remove() }, status: () => ({ enabled: false, contextCompression: false, strictPov: false }) })
  }
  for (const key of ['contextCompression', 'strictPov', 'ultraMemoryOptimization'] as const) if (config[key] !== undefined && typeof config[key] !== 'boolean') throw new RpError('invalid_record', 'RP mode option must be boolean: ' + key)
  if (config.contextCompression === true || config.strictPov === true) throw new RpError('capability_missing', 'Native compaction CAS/lifecycle/ownership and complete strict POV filtering are not verified; both modes remain disabled')
  if (!config.profileRoot || !config.workspaceRoot || !config.budget) throw new Error('RP requires explicit profile/workspace and verified request capacity')
  if (config.knownCooperatingWriters !== true) throw new Error('RP requires a trusted known-writer composition; unknown/private compactors are unsupported')
  const root = context.root ?? context
  const req = createRequire(import.meta.url), nativeVersions: Record<string, string> = {}
  for (const [name, expected] of Object.entries({ cordis: '4.0.5', 'dsh-agent': '0.2.1-rc.2', 'dsh-llm': '0.2.1-rc.2', 'dsh-session': '0.2.1-rc.2', 'dsh-system-prompt': '0.2.1-rc.2', 'dsh-tools': '0.2.1-rc.2', schemastery: '3.18.5' })) { const entry = req.resolve('@deepseek-ai/' + name), manifest = JSON.parse(await fs.readFile(path.resolve(path.dirname(entry), '../package.json'), 'utf8')); if (manifest.version !== expected) throw new RpError('capability_missing', 'RP native Memory requires @deepseek-ai/' + name + '@' + expected + '; found ' + manifest.version); nativeVersions[name] = manifest.version }
  const nativeServices = { agents: root.get('agents'), llm: root.get('llm'), prompt: root.get('systemPrompt'), sessions: root.get('sessions'), commands: root.get('commands') } as any
  const verifyNative = () => {
    // Cordis returns a fresh trace proxy on each get(); prototype identity is
    // stable while proxy reference equality is intentionally not.
    const checks = { agents: root.get('agents') instanceof AgentRegistry, llm: root.get('llm') instanceof LlmRuntime, prompt: root.get('systemPrompt') instanceof SystemPrompt, agentsIdentity: Object.getPrototypeOf(root.get('agents')) === Object.getPrototypeOf(nativeServices.agents), llmIdentity: Object.getPrototypeOf(root.get('llm')) === Object.getPrototypeOf(nativeServices.llm), promptIdentity: Object.getPrototypeOf(root.get('systemPrompt')) === Object.getPrototypeOf(nativeServices.prompt), sessionsIdentity: Object.getPrototypeOf(root.get('sessions')) === Object.getPrototypeOf(nativeServices.sessions), commandsIdentity: Object.getPrototypeOf(root.get('commands')) === Object.getPrototypeOf(nativeServices.commands), flush: typeof nativeServices.sessions?.flush === 'function', commands: typeof nativeServices.commands?.register === 'function', format: SESSION_FORMAT_VERSION === 4 }
    const missing = Object.entries(checks).filter(([, valid]) => !valid).map(([key]) => key); if (missing.length) throw new RpError('capability_missing', 'Live pinned native services changed or are unavailable: ' + missing.join(','))
  }
  verifyNative()
  const admission = acquireRpAdmission(root as any), owner = admission.createOwner(); admission.reserve(owner)
  const startupCleanups: (() => unknown)[] = []
  try {
  const lease = acquireSessionPolicy(root as any, 'rp'), policy = lease.policy
  startupCleanups.push(() => lease.release())
  const ultraOptimizer = createUltraRpOptimizer()
  const optimizer = () => {
    const support = root.get('ultraEvidenceSupport') as any
    return config.ultraMemoryOptimization !== false && support?.protocol === 'dsh-ultra-evidence/v2' && typeof support.memory?.hasActiveSession === 'function' && support.status?.().leases > 0 && !support.status?.().transitioning ? ultraOptimizer : undefined
  }
  const memory = await openRpMemory({ profileRoot: config.profileRoot, entityIds: config.entityIds ?? [], coordinator: policy.coordinator, optimizer })
  startupCleanups.push(() => memory.retrieval.dispose(), () => memory.jobs.close())
  const workspaceRoot = await fs.realpath(config.workspaceRoot), hostRoot = path.join(config.profileRoot, '.dsh-rp', 'v1', 'host')
  await fs.mkdir(hostRoot, { recursive: true })
  let workspace = await memory.control.openWorkspace(workspaceRoot)
  if (!workspace.ok) workspace = await memory.control.createWorkspace(workspaceRoot)
  const binding = unwrap(workspace), globalAuthorities: object[] = [], globalSpecs: any[] = [...(config.globalGrants ?? [])], commandSpecs: any[] = []
  const grantFile = path.join(config.profileRoot, '.dsh-rp', 'v1', 'global-command-grants.json')
  try { const saved = object(await readRpJson(grantFile), ['schemaVersion', 'grants', 'sha256']); if (saved.schemaVersion !== 1 || sha(canonical(saved.grants)) !== saved.sha256 || !Array.isArray(saved.grants)) throw new Error('Global grant journal corrupt'); commandSpecs.push(...saved.grants); if (config.globalGrants === undefined) for (const g of commandSpecs) if (!globalSpecs.some(x => canonical(x.scope) === canonical(g.scope))) globalSpecs.push(g) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  const globalPolicyHash = () => sha(canonical(globalSpecs))
  for (const grant of globalSpecs) globalAuthorities.push(unwrap(await memory.global.control.authorize(grant)))
  const visibility = { policyId: 'rp_user_policy', revision: 0, audienceSetId: 'rp_user' }, bound = new Map<string, Bound>(), handles: any[] = [], shutdown = new AbortController(), effects: (() => unknown)[] = []
  const pendingTools = new Map<symbol, { agent: Agent; callId: string; generation: number; packetId: string; text: string; proof: RetrievalEvidence; provenance: 'retrieval-result' | 'status' | 'error' }>()
  startupCleanups.push(async () => {
    shutdown.abort(new Error('RP installation failed')); pendingTools.clear()
    const errors: unknown[] = []
    for (const b of bound.values()) { b.runtime?.revoke(); b.generation++; b.packet = undefined; b.data.blocked = true; try { b.agent.cancel({ kind: 'hook', reason: 'RP installation failed' }); await b.agent.whenIdle(); await policy.block(b.agent.id); admission.release(owner, b.agent.id) } catch (e) { errors.push(e) } }
    for (const dispose of effects.reverse()) { try { await dispose() } catch (e) { errors.push(e) } }
    if (errors.length) throw new AggregateError(errors, 'RP startup cleanup failed')
  })
  const commandGrant = async (worldId?: string, entityId?: string) => policy.coordinator.mutate(async () => {
    if (worldId !== undefined) id(worldId); if (entityId !== undefined) id(entityId)
    const scope = worldId ? { kind: 'world', profileId: binding.profileId, worldId, ...(entityId ? { entityId } : {}) } : { kind: 'profile', profileId: binding.profileId }
    const old = globalSpecs.findIndex(g => canonical(g.scope) === canonical(scope)); if (old >= 0) return globalAuthorities[old]
    if (config.globalGrants !== undefined) throw new RpError('scope_denied', 'Explicit configuration is the global scope allowlist; persisted commands cannot widen it')
    const spec = { scope, visibility, audienceSetIds: ['rp_user'], write: true }, nextSpecs = [...commandSpecs, spec]
    const encoded = checkedRpJson({ schemaVersion: 1, grants: nextSpecs, sha256: sha(canonical(nextSpecs)) }, canonical)
    const tmp = grantFile + '.tmp-' + uid('write')
    try {
      const h = await fs.open(tmp, 'wx', 0o600)
      try { await h.writeFile(encoded); await h.sync() } finally { await h.close() }
      shutdown.signal.throwIfAborted(); await fs.rename(tmp, grantFile)
    } catch (e) { await fs.rm(tmp, { force: true }).catch(() => {}); throw e }
    // Only publish an in-memory capability after its recovery record is durable.
    // authorize itself does not acquire the coordinator; no nested mutation lock.
    shutdown.signal.throwIfAborted()
    const authority = unwrap(await memory.global.control.authorize(spec as any))
    commandSpecs.push(spec); globalSpecs.push(spec); globalAuthorities.push(authority)
    return authority
  })
  let closed = false, closePromise: Promise<void> | undefined
  const managers=new Map<string,Awaited<ReturnType<typeof openManagementServer>>>()
  const managerOpenings=new Map<string,object>()
  const closeManager=async(sessionId:string)=>{managerOpenings.delete(sessionId);const m=managers.get(sessionId);if(m){m.revoke();managers.delete(sessionId);await m.close()}}
  effects.push(async()=>{for(const id of [...managers.keys()])await closeManager(id)})
  const inputHistory = new Map<string, Map<string, Input>>()
  const runtimeChanges = new Set<Bound>()
  for (const name of (await fs.readdir(hostRoot)).filter(n => /^[a-f0-9]{64}\.json$/u.test(n))) {
    try {
    const envelope = object(await readRpJson(path.join(hostRoot, name)), ['data', 'sha256']); if (sha(canonical(envelope.data)) !== envelope.sha256) throw new Error('RP input registry journal corrupt')
    const data = validateJournal(envelope.data)
    if (data.request.workspaceId !== binding.workspaceId || data.request.campaignId !== (config.campaignId ?? 'rp_campaign')) continue
    const map = inputHistory.get(data.request.branchId) ?? new Map<string, Input>(); data.inputs.forEach(i => map.set(i.sourceId, i)); inputHistory.set(data.request.branchId, map); memory.registerInputBindings(data.request.branchId, data.inputs)
    } catch { /* An unverifiable journal supplies no branch or input authority. Resume stays blocked. */ }
  }
  const live = (agent: Agent): boolean => !closed && (root.get('agents') as any)?.get(agent.id) === agent && !!agent.session.header.cwd && path.resolve(agent.session.header.cwd) === path.resolve(workspaceRoot)
  const file = (session: string) => path.join(hostRoot, sha(session) + '.json')
  const writeJournal = async (b: Bound, final = false, nextData = b.data, beforeRename?: () => void): Promise<void> => {
    if (closed && !final) throw new RpError('ownership_lost', 'RP owner disposed')
    if (b.recoveryOnly) return
    const encoded = checkedRpJson({ data: nextData, sha256: sha(canonical(nextData)) }, canonical)
    validateJournal(nextData)
    const target = file(b.data.sessionId), tmp = target + '.tmp-' + uid('write'), h = await fs.open(tmp, 'wx', 0o600)
    try { await h.writeFile(encoded); await h.sync() } finally { await h.close() }
    try {
      if (closed && !final) throw new RpError('ownership_lost', 'RP disposed before publication')
      beforeRename?.(); await fs.rename(tmp, target)
    } catch (e) { await fs.rm(tmp, { force: true }).catch(() => {}); throw e }
  }
  const save = (b: Bound, final = false): Promise<void> => b.saveQueue = b.saveQueue.catch(() => {}).then(() => writeJournal(b, final)).catch(e => { b.data.blocked = true; b.lastError = e instanceof RpError ? e.code : 'persistence_failed'; throw e })
  const queue = (b: Bound, work: () => Promise<void>) => { const p = b.queue.catch(() => {}).then(async () => { if (closed) throw new RpError('ownership_lost', 'RP owner closing'); await work() }); b.queue = p; void p.catch(e => { b.data.blocked = true; b.lastError = e instanceof RpError ? e.code : 'persistence_failed' }); return p }
  const drain = async (b: Bound) => { const queueTail = b.queue; await queueTail; const saveTail = b.saveQueue; await saveTail; if (queueTail !== b.queue || saveTail !== b.saveQueue) throw new RpError('stale_input', 'RP queues changed while settling'); if (closed || !live(b.agent) || b.data.blocked) throw new RpError('ownership_lost', 'RP session is unavailable') }
  const settle = async (b: Bound) => { const results = await Promise.allSettled([b.queue, b.saveQueue]); if (results.some(r => r.status === 'rejected')) { b.data.blocked = true; b.lastError ??= 'persistence_failed' } }
  const diagnostic = (sessionId: string) => { const b = bound.get(sessionId); return { enabled: !closed, lifecycle: closed ? 'closing' : 'open', contextCompression: false, strictPov: false, nativeVersions, memoryOptimization: { available: optimizer()?.protocol ?? 'standalone', packet: b?.packet?.optimizer ?? null }, policy: policy.status(sessionId), branchId: b?.data.request.branchId, personId: b?.data.personBinding?.personId, injection: b?.data.injectionBinding ?? null, purpose: b?.data.runtimeBinding?.config ?? null, blocked: !b || closed || b.data.blocked === true || b.recoveryOnly === true, lastError: b?.lastError, candidateIds: b ? Object.values(b.data.hostSources).filter(s => !b.data.inputs.some(i => i.sourceId === s)) : [], pendingInputIds: b?.data.inputs.filter(i => i.phase === 'observed' || i.phase === 'accepted').map(i => i.sourceId) ?? [], ambiguousInputIds: b?.data.inputs.filter(i => i.phase === 'dispatching' || i.phase === 'dispatched').map(i => i.sourceId) ?? [], snapshots: b ? Object.keys(b.data.snapshots).length : 0 } }
  const assertIdle = (agent: Agent) => { if (!live(agent) || agent.status !== 'idle') throw new RpError('scope_denied', 'RP controls require the exact live idle root session') }
  const requestFor = (session: string, branchId: string): AuthorityRequest => ({ workspaceId: binding.workspaceId, campaignId: config.campaignId ?? 'rp_campaign', branchId, sessionId: session, sceneId: 'rp_scene', viewpoint: { kind: 'narrator' }, visibility, audienceSetIds: ['rp_user'], permissions: ['read', 'observe', 'commit', 'control'] })
  const safe = (agent: Agent) => agent.session.deriveMessages().length === 0 && !agent.session.header.parentSession && !agent.session.header.isSeeded && !(root.get('compaction')) && !(root.get('ultraEvidenceSupport') as any)?.memory?.hasActiveSession(agent.id)
  const installBound = async (agent: Agent, branchId?: string, existing?: DurableSession, beforePublication = false, freshPersonId?: string, freshRuntime?: RuntimeConfig, freshInjection?: InjectionBinding) => {
    verifyNative(); if (agent.session.header.version !== 4) throw new RpError('capability_missing', 'Untested native session format')
    if (!beforePublication) assertIdle(agent)
    if (!existing && !safe(agent)) throw new RpError('scope_denied', 'RP activation needs a fresh drained root session without engineering history or archive readers')
    const branch = branchId ?? unwrap(await memory.control.createBranch(binding.workspaceId, config.campaignId ?? 'rp_campaign')).id
    const data: DurableSession = existing ?? { schemaVersion: 2 as const, sessionId: agent.id, request: requestFor(agent.id, branch), inputs: [...(inputHistory.get(branch)?.values() ?? [])].map(i => ({ ...i, dispatched: true, phase: 'dispatched' as const })), hostSources: {}, snapshots: {}, frames: {}, receipts: {}, pending: {}, messageHashes: {} }
    const authority = unwrap(await memory.control.authorize(data.request))
    if (!existing && freshPersonId) data.personBinding = await createPersonBinding(memory.store, authority, freshPersonId)
    if (!existing) data.runtimeBinding = createRuntimeBinding(freshRuntime)
    if (!existing && freshInjection && data.personBinding) data.injectionBinding = createInjectionBinding(freshInjection.config)
    const legacy = existing?.schemaVersion === 1
    const legacyTools = legacy && (Object.keys(data.frames).length > 0 || Object.keys(data.receipts).length > 0 || agent.session.deriveMessages().some((m: any) => m.role === 'tool' || m.content?.some((c: any) => c.type === 'tool-call')))
    const missingPacketProof = [...Object.values(data.snapshots), ...Object.values(data.pending), ...Object.values(data.frames)].some(s => (legacy || s.provenance === 'packet' || s.provenance === 'tool-call') && !s.packetProof)
    const personSnapshots = [...Object.values(data.snapshots), ...Object.values(data.pending), ...Object.values(data.frames)]
    let missingPersonProof = !!existing && (personSnapshots.some(s => canonical(s.personBinding ?? null) !== canonical(data.personBinding ?? null)) || (!data.personBinding && agent.session.deriveMessages().some((m: any) => m.source?.kind === 'runtime-context' && /"primaryPerson"\s*:/u.test(body(m)))))
    if (data.personBinding) try { await verifyPersonBinding(memory.store, authority, data.personBinding) } catch { missingPersonProof = true }
    const missingRuntimeProof = !!existing && ((data.runtimeBinding && !await runtimeMarkerValid(workspaceRoot,agent.id,binding.workspaceId,data.runtimeBinding)) || personSnapshots.some(s => canonical(s.runtimeBinding ?? null) !== canonical(data.runtimeBinding ?? null)) || (!data.runtimeBinding && agent.session.deriveMessages().some((m: any) => m.source?.kind === 'runtime-context' && /"purposeRuntime"\s*:/u.test(body(m)))))
    const changedInjectionText=!!existing&&agent.session.deriveMessages().some((m:any)=>{const s=data.snapshots[m.id];if(!s?.injection)return false;try{verifyInjectionText(s.injection,body(m));return false}catch{return true}})
    const missingInjectionProof = !!existing && (changedInjectionText || !await injectionMarkerValid(hostRoot,agent.id,data.injectionBinding) || personSnapshots.some(s=>canonical(s.injectionBinding??null)!==canonical(data.injectionBinding??null)) || (!data.injectionBinding && agent.session.deriveMessages().some((m:any)=>m.source?.kind==='runtime-context'&&/"personContinuity"\s*:/u.test(body(m)))))
    const recoveryOnly = legacyTools || missingPacketProof || missingPersonProof || missingRuntimeProof || missingInjectionProof
    if (legacy && !recoveryOnly) {
      // Preserve exactly the checksum-verified original before the atomic upgrade.
      const original = await fs.readFile(file(agent.id)); const backup = file(agent.id) + '.v1-backup'
      try { await fs.writeFile(backup, original, { flag: 'wx', mode: 0o600 }) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || !original.equals(await fs.readFile(backup))) throw e }
      data.schemaVersion = 2; for (const s of [...Object.values(data.snapshots), ...Object.values(data.pending)]) s.provenance = 'packet'
    }
    if (!existing) { const accepted = new Set(unwrap(await memory.store.readAcceptedSources(authority)).map(s => s.id)), inherited = new Map<string, Input>(); for (const map of inputHistory.values()) for (const i of map.values()) if (accepted.has(i.sourceId)) inherited.set(i.sourceId, { ...i, dispatched: true, phase: 'dispatched' }); data.inputs = [...inherited.values()] }
    // Written before agent publication or activation; engineering only treats
    // this as a fail-closed ownership marker, never as authority to read RP.
    if(!existing || !data.runtimeBinding) await writeRuntimeMarker(workspaceRoot,agent.id,binding.workspaceId,data.runtimeBinding,false)
    if(!existing) await writeInjectionMarker(hostRoot,agent.id,data.injectionBinding,false)
    if (admission.has(agent.id)) throw new RpError('ownership_lost', 'Prior RP binding has not been released')
    if (recoveryOnly) await policy.block(agent.id); else await policy.activate(agent.id, 'rp', { idle: beforePublication || agent.status === 'idle', safe: true })
    const b: Bound = { agent, authority, data, queue: Promise.resolve(), saveQueue: Promise.resolve(), generation: 0, recoveryOnly, ...(recoveryOnly ? { lastError: missingInjectionProof ? 'injection_binding_recovery_only' : missingRuntimeProof ? 'runtime_binding_recovery_only' : missingPersonProof ? 'person_binding_recovery_only' : legacyTools ? 'legacy_tools_recovery_only' : 'legacy_packet_recovery_only' } : {}) }
    if (recoveryOnly) b.data.blocked = true
    if(data.runtimeBinding && !recoveryOnly) b.runtime = memory.modules.create(authority,data.runtimeBinding.config,()=>live(agent)&&!b.data.blocked)
    admission.bind(owner, agent.id, () => ({ epoch: policy.status(agent.id).epoch, generation: b.generation, active: live(agent) && !b.data.blocked }))
    bound.set(agent.id, b); memory.registerInputBindings(branch, data.inputs)
    try { await save(b); return b } catch (e) { b.data.blocked = true; admission.retireBinding(owner, agent.id); await policy.block(agent.id); admission.release(owner, agent.id); bound.delete(agent.id); throw e }
  }
  const continueClean = async (agent: Agent, b: Bound | undefined, arg: string, signal: AbortSignal) => {
    const branchId = arg || b?.data.request.branchId
    if (!branchId) throw new RpError('scope_denied', 'Unverified history requires an explicit independently authorized branchId')
    id(branchId)
    const authority = unwrap(await memory.control.authorize(requestFor(agent.id, branchId))), expected = unwrap(await memory.store.readFence(authority))
    const personId = branchId === b?.data.request.branchId ? b.data.personBinding?.personId : undefined
    if (personId) await verifyPersonBinding(memory.store, authority, b!.data.personBinding!)
    admission.retireBinding(owner, agent.id); if (b) { b.runtime?.revoke(); b.generation++; b.packet = undefined; b.data.blocked = true }
    agent.cancel({ kind: 'hook', reason: 'RP clean continuation' }); await agent.whenIdle(); if (b) await settle(b)
    await policy.block(agent.id); if (b) { try { await save(b) } catch { b.lastError = 'persistence_failed' } }
    const epoch = policy.status(agent.id).epoch
    let created: any, newAgent: Agent | undefined
    try {
      created = await (root.get('agents') as any).create({ sessionId: uid('rp_clean'), meta: { cwd: workspaceRoot }, agentOptions: { ...agent.options }, signal,
        setup: async (_ctx: Context, next: Agent) => { newAgent = next; await installBound(next, branchId, undefined, true, personId, b?.recoveryOnly ? undefined : b?.data.runtimeBinding?.config, b?.recoveryOnly ? undefined : b?.data.injectionBinding); return { commit() { signal.throwIfAborted(); if (closed || !live(agent) || policy.status(agent.id).epoch !== epoch) throw new RpError('stale_input', 'Clean continuation owner changed') } } } })
      signal.throwIfAborted()
      if (closed || !live(agent) || canonical(unwrap(await memory.store.readFence(authority))) !== canonical(expected)) throw new RpError('stale_input', 'Branch changed during clean continuation')
      handles.push(created); return { kind: 'success' as const, text: 'Clean RP root session created: ' + created.agent.id + '. Select that session in the host; the UI tab was not switched.' }
    } catch (e) {
      if (newAgent) { admission.retireBinding(owner, newAgent.id); const n = bound.get(newAgent.id); if (n) n.data.blocked = true; await policy.block(newAgent.id); admission.release(owner, newAgent.id); bound.delete(newAgent.id) }
      await created?.dispose(); throw e
    }
  }
  const injectionPreview = async (b:Bound, query:string) => {
    if(Buffer.byteLength(query,'utf8')>8192)throw new RpError('invalid_record','Preview query exceeds 8 KiB')
    await settle(b)
    const generation=b.generation,bindingHash=canonical(b.data.injectionBinding??null)
    const packet=b.data.injectionBinding?unwrap(await memory.packets.prepare(b.authority,{budget:config.budget!,globalAuthorities,inputBindings:b.data.inputs,personId:b.data.personBinding?.personId,injection:b.data.injectionBinding.config,runtime:b.runtime?.context(),query})):undefined
    const fence=packet?.inputFence??unwrap(await memory.store.readFence(b.authority)),sources=new Set(unwrap(await memory.store.readAcceptedSources(b.authority)).map(s=>s.id)),history=[]
    for(const message of b.agent.session.deriveMessages() as any[]){
      const s=b.data.snapshots[message.id]??b.data.frames[message.id]
      let status='carried',reason='旧宿主消息仍在上下文中；本轮未选中不会删除它。'
      try{
        if(b.data.messageHashes[message.id]!==sha(normalizedMessage(message)))throw new RpError('stale_input','未知或改动过的宿主消息')
        if(s){
          if(s.injection)verifyInjectionText(s.injection,body(message))
          if(canonical(s.injectionBinding??null)!==bindingHash||canonical(s.personBinding??null)!==canonical(b.data.personBinding??null)||canonical(s.runtimeBinding??null)!==canonical(b.data.runtimeBinding??null))throw new RpError('stale_input','历史配置绑定不匹配')
          if(s.provenance==='packet'||s.provenance==='tool-call')await verifyPacketProof(memory.store,b.authority,s.packetProof)
          if(s.records)await verifyRetrievalEvidence(memory.store,b.authority,{inputFence:s.fence,records:s.records,resultSha256:s.resultSha256!},new Set(b.data.inputs.map(i=>i.sourceId)))
          if(s.bodyHash!==sha(body(message))||s.modeEpoch!==policy.status(b.agent.id).modeEpoch||s.fence.branchId!==fence.branchId||s.fence.visibilityRevision!==fence.visibilityRevision||s.fence.deletionGeneration!==fence.deletionGeneration||s.fence.canonBindingsHash!==fence.canonBindingsHash||s.fence.policyVersion!==fence.policyVersion||s.dependencyIds.some(id=>!sources.has(id)))throw new RpError('stale_input','历史来源或权限已失效')
          if(s.globalPolicyHash!==globalPolicyHash()||s.globals.length!==globalAuthorities.length)throw new RpError('scope_denied','历史全局授权已改变')
          for(const dep of s.globalDependencies){let found=false;for(const g of globalAuthorities){const r=await memory.global.store.readPublication(g,dep.publicationId);if(r.ok&&r.value.source.id===dep.sourceId&&r.value.bodySha256===dep.bodySha256&&canonical(r.value.scope)===canonical(dep.scope)&&(r.value.scope.kind!=='profile'||unwrap(await memory.global.store.listActive(g)).some(x=>x.id===r.value.id)))found=true}if(!found)throw new RpError('scope_denied','历史全局来源已失效')}
        }else if(!sources.has(b.data.hostSources[message.id]))throw new RpError('scope_denied','宿主原文尚未采纳或已失效')
      }catch(e){status='blocked';reason=e instanceof Error?e.message:'历史验证失败'}
      history.push({messageId:message.id,status,reason,kind:s?.provenance??'original',snapshotId:s?.injection?.sha256??s?.packetId??null,selectedIds:s?.injection?.entries.filter(e=>e.selected).map(e=>e.id)??[]})
    }
    if(generation!==b.generation||bindingHash!==canonical(b.data.injectionBinding??null)||!live(b.agent)||canonical(fence)!==canonical(unwrap(await memory.store.readFence(b.authority))))throw new RpError('stale_input','预览期间状态改变，请重新预览')
    if(packet)for(let i=0;i<globalAuthorities.length;i++)if(canonical(packet.globalFences[i])!==canonical(unwrap(await memory.global.store.readFence(globalAuthorities[i]))))throw new RpError('stale_input','预览期间全局记忆改变')
    return {binding:b.data.injectionBinding??null,current:packet?{text:JSON.parse(packet.text).personContinuity.text,trace:packet.injection,packetId:packet.id}:null,history,blocked:b.data.blocked===true||b.recoveryOnly===true,notice:'只读预览，实际发送会重新组装与验证。当前未选入不等于从旧对话中移除；需要干净上下文请 continue-clean。预算为 UTF-8 字节保守估计，非实际 token。'}
  }
  const controlSource = (b: Bound, commandId: string, value: string) => memory.store.observeSource(b.authority, { idempotencyKey: 'command_' + sha(commandId), origin: 'user_control', role: 'user_control', publicText: value, turnId: uid('control') })
  const canonicalControl = async (b: Bound, commandId: string, operation: any) => {
    const source = unwrap(await controlSource(b, commandId, canonical(operation)))
    const result = await memory.canonical.applyControl(b.authority, source, { ...operation, idempotencyKey: 'command_' + sha(commandId), expected: unwrap(await memory.store.readFence(b.authority)) })
    if (result.ok) for (const session of bound.values()) if (session.data.request.branchId === b.data.request.branchId) session.packet = undefined
    return result
  }
  const dispatchInput = async (b: Bound, item: Input, signal: AbortSignal) => {
    if (item.phase === 'dispatching' || item.phase === 'dispatched' || item.dispatched) throw new RpError('scope_denied', 'Input dispatch is completed or ambiguous; never automatically resend it')
    if (item.phase === 'observed') {
      const ledger = unwrap(await memory.store.readLedger(b.authority)), source = ledger.sources.find(s => s.id === item.sourceId)
      if (!source || source.origin !== 'user_control') throw new RpError('source_unavailable', 'Pending input source unavailable')
      unwrap<unknown>(await memory.canonical.applyControl(b.authority, source, { kind: 'accept', idempotencyKey: item.operationKey, expected: item.expected, sourceRevisionIds: [source.id], events: [] }))
      await config.inputFault?.('acceptance_committed'); item.phase = 'accepted'; await save(b)
    }
    const source = unwrap(await memory.store.readAcceptedSources(b.authority)).find(s => s.id === item.sourceId)
    if (!source) throw new RpError('source_unavailable', 'Accepted input unavailable')
    const content = unwrap(await memory.store.readSource(b.authority, fullSpan(source)))
    await config.beforeInputDispatch?.(); signal.throwIfAborted(); shutdown.signal.throwIfAborted()
    // Durable at-most-once marker precedes wake. A crash in the following gap is
    // explicitly ambiguous and never automatically resends a model invocation.
    item.phase = 'dispatching'; await save(b); await config.inputFault?.('dispatch_marked'); signal.throwIfAborted(); b.data.currentTurnId = item.turnId
    const message = { ...createUserMessage({ content: [{ type: 'text', text: content }], source: { kind: 'user' } }), id: item.messageId } as any
    b.data.hostSources[message.id] = item.sourceId; b.data.messageHashes[message.id] = sha(normalizedMessage(message)); await save(b)
    b.agent.followup(message)
    item.dispatched = true; item.phase = 'dispatched'; await save(b)
  }
  const command = async (invocation: { commandId: string; agent: Agent; rawInput: string; signal: AbortSignal }) => {
    const { agent, commandId, signal } = invocation
    try {
      signal.throwIfAborted(); shutdown.signal.throwIfAborted()
      const match = /^\s*(\S+)?(?:\s+([\s\S]*))?$/u.exec(invocation.rawInput)!, action = match[1] ?? 'status', arg = match[2] ?? ''
      if(!live(agent))throw new RpError('ownership_lost','Exact live session required')
      if(!(action==='modules'&&/^disable\s/u.test(arg)))assertIdle(agent)
      let b = bound.get(agent.id)
      if (action === 'status') { if (b) await settle(b); return { kind: 'success', text: JSON.stringify(diagnostic(agent.id)) } }
      if(action==='person'&&arg==='manage-close'){await closeManager(agent.id);return {kind:'success',text:'Management endpoint closed.'}}
      if (action === 'continue-clean') return await continueClean(agent, b, arg, signal)
      if (action === 'global') {
        const parsed = /^(\S+)\s+([\s\S]+)$/u.exec(arg); if (!parsed) throw new RpError('invalid_record', 'Use /rp global preference|publish|list|adopt <JSON>')
        const sub = parsed[1]
        if (!['publish', 'preference', 'list', 'adopt', 'storage-status', 'storage-enable'].includes(sub)) throw new RpError('invalid_record', 'Unknown global control')
        const op = commandObject(parsed[2], sub === 'publish' || sub === 'preference' ? ['key', 'body'] : sub === 'adopt' ? ['publicationId'] : [], ['worldId', 'entityId', 'privateSourceIds', 'supersedes'])
        const ga = await commandGrant(sub === 'preference' ? undefined : op.worldId, op.entityId), approval = memory.global.control.approval({ commandId: 'command_' + sha(commandId), sessionId: agent.id })
        if (sub === 'storage-status') return { kind: 'success', text: JSON.stringify(unwrap(await memory.global.store.storageStatus(ga))) }
        if (sub === 'storage-enable') { unwrap(await memory.global.control.enableSegments(ga, approval, { idempotencyKey: commandId, expected: unwrap(await memory.global.store.readFence(ga)) })); return { kind: 'success', text: JSON.stringify(unwrap(await memory.global.store.storageStatus(ga))) } }
        if (sub === 'publish' || sub === 'preference') { if (sub === 'publish' && !op.worldId) throw new RpError('invalid_record', 'Explicit worldId is required'); const publication = unwrap(await memory.global.control.publish(ga, approval, { idempotencyKey: commandId, expected: unwrap(await memory.global.store.readFence(ga)), key: op.key, body: op.body, privateSourceIds: op.privateSourceIds ?? [], ...(op.supersedes ? { supersedes: op.supersedes } : {}) })); return { kind: 'success', text: 'Approved publication ' + publication.id + ' revision ' + publication.revision } }
        if (sub === 'list') return { kind: 'success', text: 'Approved publication IDs: ' + unwrap(await memory.global.store.list(ga)).map(p => p.id + '@' + p.revision).join(', ') }
        if (sub === 'adopt') { if (!b) throw new RpError('scope_denied', 'Start the story branch before adopting canon'); unwrap(await memory.adoptCanon(b.authority, ga, approval, op.publicationId, commandId)); return { kind: 'success', text: 'Pinned canon revision adopted.' } }
        throw new RpError('invalid_record', 'Unknown global control')
      }
      if (action === 'start') { if (b) return { kind: 'success', text: 'RP already active.' }; b = await installBound(agent, arg || undefined) }
      if (!b) throw new RpError('scope_denied', 'Start or restore the RP session first')
      if(action==='injection'){
        const m=/^(\S+)(?:\s+([\s\S]*))?$/u.exec(arg),op=m?.[1]??'show',value=m?.[2]??''
        if(op==='show')return {kind:'success',text:canonical({binding:b.data.injectionBinding??null,notice:'空白根会话绑定人物后 injection set {} 启用；预览不会发送模型。'})}
        if(op==='preview')return {kind:'success',text:canonical(await injectionPreview(b,value))}
        if(op!=='set')throw new RpError('invalid_record','Use injection show|set <JSON>|preview <query>')
        if(Buffer.byteLength(value,'utf8')>32768)throw new RpError('invalid_record','Injection config exceeds 32 KiB')
        const next=value.trim()==='null'?undefined:createInjectionBinding(commandObject(value,[],['depth','budgets','pin','exclude','aliases','rules']))
        if(runtimeChanges.has(b))throw new RpError('scope_denied','Configuration change in progress')
        runtimeChanges.add(b)
        try{
          await drain(b)
          if(!safe(agent)||!b.data.personBinding)throw new RpError('scope_denied','先绑定人物；有历史时先 continue-clean，再设置注入')
          await verifyPersonBinding(memory.store,b.authority,b.data.personBinding)
          if(next&&Object.keys(next.config.aliases).some(id=>!(config.entityIds??[]).includes(id)))throw new RpError('scope_denied','Alias entity is not authorized')
          const initialGeneration=b.generation
          if(next&&!b.data.injectionBinding){
            const original=await fs.readFile(file(agent.id)),backup=file(agent.id)+'.pre-m5-backup'
            try{const h=await fs.open(backup,'wx',0o600);try{await h.writeFile(original);await h.sync()}finally{await h.close()}}
            catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const saved=object(await readRpJson(backup),['data','sha256']);if(saved.sha256!==sha(canonical(saved.data))||validateJournal(saved.data).sessionId!==agent.id||saved.data.injectionBinding)throw new RpError('store_corrupt','Pre-M5 backup cannot be verified')}
          }
          if(b.generation!==initialGeneration||!live(agent)||!safe(agent)||agent.status!=='idle'||b.data.blocked)throw new RpError('stale_input','Session changed during injection preparation')
          b.generation++;b.packet=undefined;b.data.blocked=true
          const generation=b.generation
          await writeInjectionMarker(hostRoot,agent.id,next,true)
          if(next)b.data.injectionBinding=next;else delete b.data.injectionBinding
          await save(b);if(!live(agent)||b.generation!==generation)throw new RpError('ownership_lost','Injection owner changed')
          b.data.blocked=false
          try{await save(b);if(!live(agent)||b.generation!==generation)throw new RpError('ownership_lost','Injection owner changed');await writeInjectionMarker(hostRoot,agent.id,next,false);if(!live(agent)||b.generation!==generation)throw new RpError('ownership_lost','Injection owner changed')}catch(e){b.data.blocked=true;throw e}
          return {kind:'success',text:canonical({binding:next??null,notice:'已保存本会话的注入配置。未开启后台功能。'})}
        }finally{runtimeChanges.delete(b)}
      }
      if (['mode','modules','constraints'].includes(action)) return await runtimeCommand(action,arg,commandId,{
        config:b.data.runtimeBinding?.config ?? createRuntimeBinding().config,runtime:b.runtime,ready:()=>drain(b!),
        change:async(next,disable)=>{
          if(!b!.data.runtimeBinding)throw new RpError('capability_missing','Legacy session needs clean continuation before M3 configuration')
          if(runtimeChanges.has(b!))throw new RpError('scope_denied','Runtime configuration change in progress')
          runtimeChanges.add(b!)
          try {
          const empty=safe(agent)&&agent.status==='idle'&&!b!.data.blocked&&!b!.recoveryOnly
          if(!empty&&!disable)throw new RpError('scope_denied','Runtime changes require an empty root; use continue-clean')
          if(!disable)await drain(b!)
          b!.runtime?.revoke();b!.generation++;b!.packet=undefined;b!.data.blocked=true
          const generation=b!.generation
          b!.data.runtimeBinding=createRuntimeBinding(next)
          if(!empty)agent.cancel({kind:'hook',reason:'RP module revoked'})
          try{await writeRuntimeMarker(workspaceRoot,agent.id,binding.workspaceId,b!.data.runtimeBinding,true)}catch(e){await save(b!).catch(()=>{});throw e}
          if(!empty){await agent.whenIdle();await settle(b!);await policy.block(agent.id)}
          await save(b!)
          if(empty){
            if(b!.generation!==generation||!live(agent))throw new RpError('ownership_lost','Runtime configuration superseded')
            b!.data.blocked=false
            try{await save(b!);if(b!.generation!==generation||!live(agent))throw new RpError('ownership_lost','Runtime changed while saving');await writeRuntimeMarker(workspaceRoot,agent.id,binding.workspaceId,b!.data.runtimeBinding,false);if(b!.generation!==generation||!live(agent))throw new RpError('ownership_lost','Runtime changed while publishing');b!.runtime=memory.modules.create(b!.authority,next,()=>live(agent)&&!b!.data.blocked)}catch(e){b!.data.blocked=true;throw e}
          }
          } finally { runtimeChanges.delete(b!) }
        }
      })
      await drain(b); signal.throwIfAborted()
      if (action === 'person') {
        const parsed = /^(\S+)(?:\s+([\s\S]+))?$/u.exec(arg); if (!parsed) throw new RpError('invalid_record', 'Use person preview|confirm|show|use')
        const sub = parsed[1], value = parsed[2] ?? ''
        if(sub==='manage'){
          if(value)throw new RpError('invalid_record','Use person manage without arguments')
          await closeManager(agent.id);const generation=b.generation,opening={};managerOpenings.set(agent.id,opening)
          const controller=memory.management.create(b.authority,()=>live(agent)&&bound.get(agent.id)===b&&!b!.data.blocked&&!b!.recoveryOnly&&b!.generation===generation&&agent.status==='idle')
          const manager=await openManagementServer(controller,()=>({sessionId:agent.id,personId:b!.data.personBinding?.personId??null,mode:b!.data.runtimeBinding?.config.mode??'rp',config:b!.data.runtimeBinding?.config??null,injection:b!.data.injectionBinding??null}),async()=>{
            for(const session of bound.values())if(session.data.request.branchId===b!.data.request.branchId)session.packet=undefined
            if(!await (root.get('sessions') as any).flush(agent.session))throw new RpError('persistence_uncertain','Management committed; native flush unconfirmed. Inspect current state before another action.')
          },async query=>{if(!live(agent)||b!.generation!==generation||b!.data.blocked||agent.status!=='idle')throw new RpError('ownership_lost','工作台会话已变化，请重新打开');return injectionPreview(b!,query)})
          if(!live(agent)||b.generation!==generation||managerOpenings.get(agent.id)!==opening){await manager.close();throw new RpError('ownership_lost','Management owner changed while opening')}
          managerOpenings.delete(agent.id)
          managers.set(agent.id,manager);return {kind:'success',text:JSON.stringify({url:manager.url,notice:'仅本机、仅本会话，手动刷新和确认。关闭页面不会自动改人物；person manage-close 撤销入口。不要分享完整地址。'})}
        }
        if (sub === 'preview') {
          if (Buffer.byteLength(value, 'utf8') > 65536) throw new RpError('invalid_record', 'Person draft exceeds 64 KiB')
          const draft = commandObject(value, ['schemaVersion', 'kind', 'personId', 'fields', 'relationships', 'goals'])
          const preview = unwrap(await memory.person.preview(b.authority, draft, 'native_'+sha(canonical(draft)))), previewId = uid('person_preview')
          b.personPreview = { id: previewId, handle: preview.handle, draftHash: preview.draftHash }
          const { handle: _handle, ...display } = preview
          return { kind: 'success', text: canonical({ previewId, ...display, notice: '确认将创建人物；首次启用先备份，对应整个工作区需要新版读取。预览在重启或剧情变更后需重做。' }) }
        }
        if (sub === 'confirm') {
          const p = b.personPreview; if (!p || p.id !== value) throw new RpError('scope_denied', 'Unknown person preview; preview again')
          const key = 'person_confirm_'+sha(b.data.request.branchId+':'+p.draftHash)
          const ctl = unwrap(await memory.store.observeSource(b.authority, { idempotencyKey: key, origin: 'user_control', role: 'user_control', turnId: key, publicText: '用户确认人物定义 '+p.draftHash }))
          const result = unwrap(await memory.person.confirm(b.authority, p.handle, ctl))
          for (const session of bound.values()) if (session.data.request.branchId === b.data.request.branchId) session.packet = undefined
          if (!await (root.get('sessions') as any).flush(agent.session)) throw new RpError('persistence_uncertain', 'Person confirmation flush unconfirmed')
          return { kind: 'success', text: canonical(result) }
        }
        if (sub === 'show') return { kind: 'success', text: canonical(unwrap(await memory.person.read(b.authority, value || b.data.personBinding?.personId || ''))) }
        if (sub === 'timeline') return {kind:'success',text:canonical(unwrap(await memory.person.timeline(b.authority,value||b.data.personBinding?.personId||'')))}
        if (sub === 'candidates') return {kind:'success',text:canonical(unwrap(await memory.person.list(b.authority)))}
        if (sub === 'propose') {
          if(Buffer.byteLength(value,'utf8')>65536)throw new RpError('invalid_record','Growth proposal exceeds 64 KiB')
          const proposal=commandObject(value,['changes'])
          return {kind:'success',text:canonical(unwrap(await memory.person.propose(b.authority,proposal,commandId)))}
        }
        if(['edit','set-policy','adopt','reject'].includes(sub)) {
          if(Buffer.byteLength(value,'utf8')>65536)throw new RpError('invalid_record','Person control exceeds 64 KiB')
          const op= sub==='adopt'?commandObject(value,['candidateIds']):sub==='reject'?commandObject(value,['candidateId']):commandObject(value,['personId','fieldId','previousEventId','note',sub==='edit'?'value':'policy'],['validity'])
          const ctl=unwrap(await controlSource(b,commandId,value))
          const result=sub==='adopt'?unwrap(await memory.person.adopt(b.authority,ctl,op.candidateIds,commandId)):sub==='reject'?unwrap<any>(await memory.person.reject(b.authority,ctl,op.candidateId,commandId)):unwrap(await memory.person.apply(b.authority,ctl,{...op,operation:sub,expected:unwrap(await memory.store.readFence(b.authority)),idempotencyKey:commandId}))
          for(const session of bound.values())if(session.data.request.branchId===b.data.request.branchId)session.packet=undefined
          if(!await (root.get('sessions') as any).flush(agent.session))throw new RpError('persistence_uncertain','Person control flush unconfirmed')
          return {kind:'success',text:canonical(result)}
        }
        if (sub === 'use') {
          id(value); if (!safe(agent)) throw new RpError('scope_denied', 'Person switching requires an empty root; use continue-clean first')
          const binding = await createPersonBinding(memory.store, b.authority, value)
          b.generation++; b.packet = undefined; b.data.personBinding = binding; await save(b)
          return { kind: 'success', text: canonical({ personId: value, branchId: binding.boundAt.branchId }) }
        }
        throw new RpError('invalid_record', 'Use person preview|confirm|show|use|edit|set-policy|propose|candidates|adopt|reject|timeline')
      }
      if (action === 'agent') {
        const op = commandObject(arg, ['kind'], ['actorIds', 'description', 'sourceRevisionIds', 'fictionalTime', 'entityId', 'key', 'value', 'fromId', 'toId', 'relation', 'previousEventId', 'causeEventIds', 'note', 'ownerId', 'goalId', 'category', 'objective', 'status', 'progress', 'nextAction', 'targetEntityId'])
        const ctl = unwrap(await controlSource(b, commandId, arg)), result = unwrap(await memory.agentMemory.apply(b.authority, ctl, { ...op, idempotencyKey: commandId, expected: unwrap(await memory.store.readFence(b.authority)) } as any))
        for (const session of bound.values()) if (session.data.request.branchId === b.data.request.branchId) session.packet = undefined
        if (!await (root.get('sessions') as any).flush(agent.session)) throw new RpError('persistence_uncertain', 'Native Agent control flush unconfirmed')
        return { kind: 'success', text: canonical(result) }
      }
      if (action === 'goals' || action === 'relationships' || action === 'self') {
        const projection = unwrap(await memory.store.replayProjection(b.authority))
        const value = action === 'relationships' ? projection.relationships : projection.state.filter(s => action === 'goals' ? /^(task|promise):/u.test(s.key) : ['identity', 'voice', 'background'].includes(s.key))
        return { kind: 'success', text: canonical(value) }
      }
      const summaryOptions = { globalAuthorities, policyEpoch: () => { shutdown.signal.throwIfAborted(); if (closed || !live(agent) || policy.status(agent.id).mode !== 'rp') throw new RpError('ownership_lost', 'RP candidate owner changed'); return policy.status(agent.id).epoch } }
      if (action === 'summarize-auto') throw new RpError('capability_missing', 'No trusted background candidate route; use /rp summary then /rp adopt')
      if (action === 'propose' || action === 'summary') {
        const op = commandObject(arg, ['selection', 'proposal']), candidate = unwrap(await memory.summaries.propose(b.authority, op.proposal, op.selection, summaryOptions))
        return { kind: 'success', text: 'Structured candidate ' + candidate.id + ' pending. Use /rp candidate ID and /rp adopt ID or /rp reject-candidate ID. No story fact or summary was adopted.' }
      }
      if (action === 'candidates') return { kind: 'success', text: 'Structured candidate status: ' + canonical(unwrap(await memory.summaries.list(b.authority))) }
      if (action === 'candidate') { const candidate = unwrap(await memory.summaries.get(b.authority, arg, summaryOptions)); return { kind: 'success', text: 'Structured candidate ' + candidate.id + '; events ' + candidate.proposedEvents.length + '; summary ' + (candidate.proposedSummary?.level ?? 'none') + '; original source IDs ' + (candidate.proposedSummary?.sourceRevisionIds ?? candidate.proposedEvents.flatMap(e => e.sources.map(s => s.sourceRevisionId))).join(',') + '. Inspect original source IDs with rp_memory_get. Candidate prose stays in deletable storage; this receipt contains metadata only.' } }
      if (action === 'jobs') return { kind: 'success', text: 'Summary jobs: ' + canonical(unwrap(await memory.jobs.list(b.authority))) + '; native generation ' + canonical(memory.jobs.nativeStatus()) }
      if (action === 'recover-jobs') { unwrap(await memory.jobs.recover(b.authority)); return { kind: 'success', text: 'Interrupted summary jobs deferred. No generation resumed.' } }
      if (action === 'adopt' || action === 'reject-candidate') {
        id(arg); const ctl = unwrap(await controlSource(b, commandId, action + ' ' + arg))
        let summaryId: string | undefined
        if (action === 'adopt') summaryId = unwrap(await memory.summaries.adopt(b.authority, ctl, arg, { ...summaryOptions, idempotencyKey: 'candidate_' + sha(commandId) })).summary?.id
        else unwrap(await memory.summaries.reject(b.authority, ctl, arg, 'candidate_' + sha(commandId)))
        for (const session of bound.values()) if (session.data.request.branchId === b.data.request.branchId) session.packet = undefined
        signal.throwIfAborted(); if (!await (root.get('sessions') as any).flush(agent.session)) throw new RpError('persistence_uncertain', 'Native candidate control flush unconfirmed')
        return { kind: 'success', text: 'Candidate ' + arg + ' decision committed.' + (summaryId ? ' Summary ' + summaryId : '') }
      }
      if (action === 'status' || action === 'start') { const ledger = unwrap(await memory.store.readLedger(b.authority)), candidates = ledger.sources.filter(s => { const disposition = ledger.sourceBindings.find(x => x.sourceRevisionId === s.id)?.disposition; return s.role === 'assistant' && (disposition === undefined || disposition === 'candidate') }).map(s => s.id); return { kind: 'success', text: 'RP narrator Memory active; manual input/selection, injection only. Branch ' + b.data.request.branchId + '. Candidate source IDs: ' + candidates.join(',') + '. Pending inputs: ' + b.data.inputs.filter(i => i.phase === 'observed' || i.phase === 'accepted').map(i => i.sourceId).join(',') + '. Ambiguous dispatches (do not resend): ' + b.data.inputs.filter(i => i.phase === 'dispatching').map(i => i.sourceId).join(',') } }
      if (action === 'strict-pov' || action === 'compact') throw new RpError('capability_missing', 'Pinned SDK cannot safely filter full history or compact RP context')
      if (action === 'input') {
        text(arg, 1048576); const source = unwrap(await controlSource(b, commandId, arg)), accepted = unwrap(await memory.store.readAcceptedSources(b.authority)), latestInput = b.data.inputs.filter(i => accepted.some(s => s.id === i.sourceId)).at(-1), turnId = latestInput && !accepted.some(s => s.role === 'assistant' && s.turnId === latestInput.turnId) ? latestInput.turnId : uid('turn')
        const item: Input = { kind: 'input', sourceId: source.id, messageId: uid('rp_input'), turnId, bodyHash: source.publicTextSha256, dispatched: false, phase: 'observed', operationKey: 'input_' + sha(commandId), expected: unwrap(await memory.store.readFence(b.authority)) }
        b.data.inputs.push(item); const history = inputHistory.get(b.data.request.branchId) ?? new Map<string, Input>(); history.set(item.sourceId, item); inputHistory.set(b.data.request.branchId, history); memory.registerInputBindings(b.data.request.branchId, b.data.inputs); await save(b); await config.inputFault?.('intent_saved'); await dispatchInput(b, item, signal)
        return { kind: 'success', text: 'Accepted input queued. Generated replies require /rp accept.' }
      }
      if (action === 'resume-input') { const item = b.data.inputs.find(i => i.sourceId === arg); if (!item) throw new RpError('scope_denied', 'Unknown pending input'); await dispatchInput(b, item, signal); return { kind: 'success', text: 'Accepted pending input queued once.' } }
      if (action === 'fork') { const expected = unwrap(await memory.store.readFence(b.authority)), manifest = unwrap(await memory.canonical.forkManifest(b.authority, expected.contextRevision)); signal.throwIfAborted(); const branch = unwrap(await memory.canonical.forkBranch(b.authority, { ...manifest, idempotencyKey: 'fork_' + sha(commandId) })); return { kind: 'success', text: 'Fixed RP branch created: ' + branch.id } }
      if (action === 'accept' || action === 'reject') { id(arg); unwrap<unknown>(await canonicalControl(b, commandId, { kind: action, sourceRevisionIds: [arg], ...(action === 'accept' ? { events: [] } : {}) })) }
      else if (action === 'retcon') { const op = commandObject(arg, ['targetEventIds', 'events']); unwrap<unknown>(await canonicalControl(b, commandId, { kind: 'retcon', targetEventIds: op.targetEventIds, events: op.events })) }
      else if (action === 'delete') { const op = commandObject(arg, ['sourceRevisionIds', 'publicationDisposition']); if (!['retain', 'delete'].includes(op.publicationDisposition)) throw new RpError('invalid_record', 'Choose publicationDisposition retain/delete explicitly'); for (const ga of globalAuthorities) unwrap(await memory.global.control.privateDeletion(ga, memory.global.control.approval({ commandId: 'command_' + sha(commandId), sessionId: agent.id }), { idempotencyKey: commandId, expected: unwrap(await memory.global.store.readFence(ga)), privateSourceIds: op.sourceRevisionIds, publicationDisposition: op.publicationDisposition })); unwrap<unknown>(await canonicalControl(b, commandId, { kind: 'privacy_delete', sourceRevisionIds: op.sourceRevisionIds, affectedBranchIds: [b.data.request.branchId] })) }
      else if (action === 'publish') { const op = commandObject(arg, ['grantIndex', 'key', 'body', 'privateSourceIds'], ['supersedes']), ga = globalAuthorities[op.grantIndex]; if (!ga) throw new RpError('scope_denied', 'Unknown global grant'); const approval = memory.global.control.approval({ commandId: 'command_' + sha(commandId), sessionId: agent.id }); unwrap(await memory.global.control.publish(ga, approval, { idempotencyKey: commandId, expected: unwrap(await memory.global.store.readFence(ga)), key: op.key, body: op.body, privateSourceIds: op.privateSourceIds, ...(op.supersedes ? { supersedes: op.supersedes } : {}) })) }
      else if (action === 'adopt-canon') { const op = commandObject(arg, ['grantIndex', 'publicationId']), ga = globalAuthorities[op.grantIndex]; if (!ga) throw new RpError('scope_denied', 'Unknown global grant'); unwrap(await memory.adoptCanon(b.authority, ga, memory.global.control.approval({ commandId: 'command_' + sha(commandId), sessionId: agent.id }), op.publicationId, commandId)) }
      else if (action !== 'accept' && action !== 'reject') throw new RpError('invalid_record', 'Use start/status/input/agent/goals/relationships/self/accept/reject/delete/retcon/publish/adopt-canon/continue-clean/resume-input')
      signal.throwIfAborted(); if (!await (root.get('sessions') as any).flush(agent.session)) throw new RpError('persistence_uncertain', 'Native session flush unconfirmed')
      return { kind: 'success', text: 'RP control committed. Historical native content may require continue-clean.' }
    } catch (e) { const b = bound.get(agent.id); if (b && !(e instanceof RpError)) { b.data.blocked = true; b.lastError = 'persistence_failed' }; return { kind: 'error', text: e instanceof RpError ? e.code + ': ' + e.message : 'RP control failed; inspect status before retry.' } }
  }
  const commandsFiber = root.inject(['commands'], (owner: any) => { effects.push(owner.get('commands').register({ name: 'rp', description: 'Explicit narrator Memory controls; generated replies remain candidates.', input: { hint: 'start|status|input <text>|accept <sourceId>|summary <JSON>|candidates|adopt <candidateId>|jobs|continue-clean', attachments: false }, recordInput: false, handler: command })) })
  effects.push(() => commandsFiber.dispose())
  effects.push(root.on('session/event', ((session: any, event: any) => {
    const b = bound.get(session.id); if (closed || !b || b.agent.session !== session || policy.status(session.id).mode !== 'rp') return
    if (!['user/message', 'assistant/message', 'tool/result'].includes(event.type)) return
    const message = event.type === 'user/message' ? event.data : event.data.message
    if (event.type === 'tool/result') {
      const receipt = b.data.receipts[message?.toolCallId]
      if (!receipt || receipt.contentHash !== sha(canonical(message.content))) { b.data.blocked = true; return }
      b.data.frames[message.id] = receipt.snapshot; b.data.messageHashes[message.id] = sha(normalizedMessage(message)); void queue(b, () => save(b)); return
    }
    if (event.type === 'assistant/message' && message?.content?.some((c: any) => c.type === 'tool-call')) {
      if (!b.packet || !validReadToolContent(message.content)) { b.data.blocked = true; return }
      b.data.frames[message.id] = { ...(b.data.injectionBinding ? {injectionBinding:structuredClone(b.data.injectionBinding)} : {}), ...(b.data.runtimeBinding ? { runtimeBinding: structuredClone(b.data.runtimeBinding) } : {}), ...(b.data.personBinding ? { personBinding: structuredClone(b.data.personBinding) } : {}), provenance: 'tool-call', packetProof: b.packet.proof, bodyHash: sha(body(message)), packetId: b.packet.id, fence: b.packet.inputFence, globals: [...b.packet.globalFences], globalDependencies: [...b.packet.globalDependencies], globalPolicyHash: globalPolicyHash(), dependencyIds: [...b.packet.dependencyIds], eventIds: [], modeEpoch: policy.status(session.id).modeEpoch }
      b.data.messageHashes[message.id] = sha(normalizedMessage(message)); void queue(b, () => save(b)); return
    }
    if (message?.source?.kind === 'runtime-context') {
      const hash = sha(body(message)), pending = b.data.pending[hash]
      if (pending) { b.data.snapshots[message.id] = { ...pending, messageId: message.id }; b.data.messageHashes[message.id] = sha(normalizedMessage(message)); void queue(b, () => save(b)) }
      else b.data.blocked = true
      return
    }
    if (b.data.hostSources[message?.id]) return
    if (event.type === 'user/message' && message?.source?.kind !== 'user') { b.data.blocked = true; return }
    void queue(b, async () => {
      const source = unwrap(await observePublicHostSource(memory.store, b.authority, { idempotencyKey: 'native_' + sha(session.id + ':' + event.seq), host: { sessionId: session.id, eventSeq: event.seq, messageId: message.id, messageRevision: 'revision_' + sha(normalizedMessage(message)) }, turnId: b.data.currentTurnId ?? uid('unselected'), event }))
      b.data.hostSources[message.id] = source.id; b.data.messageHashes[message.id] = sha(normalizedMessage(message)); await save(b)
    })
  }) as never))
  effects.push(root.on('system-prompt/assemble', (async (_assembly: any, request: any, next: () => Promise<any>) => {
    const agent: Agent | undefined = request.agent ?? request.scope?.agent, b = agent && bound.get(agent.id)
    if (!b || policy.status(agent!.id).mode !== 'rp') { const assembled = await next(); return { ...assembled, tools: assembled.tools.filter((t: any) => !/^rp_memory_/u.test(t.name)) } }
    await drain(b); request.signal?.throwIfAborted(); const generation = ++b.generation, assembly = await next()
    let packet = unwrap(await memory.packets.prepare(b.authority, { budget: config.budget!, globalAuthorities, inputBindings: b.data.inputs, personId: b.data.personBinding?.personId, injection: b.data.injectionBinding?.config, runtime: b.runtime?.context() }))
    request.signal?.throwIfAborted(); if (closed || generation !== b.generation) throw new RpError('stale_input', 'Late RP assembly')
    const compose = (p: MemoryPacket) => ({ ...assembly, tools: assembly.tools.filter((t: any) => ['rp_memory_search', 'rp_memory_get', 'rp_memory_status'].includes(t.name)), contexts: [...assembly.contexts, { name: 'rp-memory', text: canonical({ rpPacketId: p.id, data: JSON.parse(p.text), recentAcceptedOriginals: p.recent }) }] })
    let completed = compose(packet)
    const envelope = () => ({ provider: agent!.options.provider, model: agent!.options.model, maxTokens: agent!.options.maxTokens, system: renderPrompt(completed), tools: completed.tools, toolHistory: { tools: completed.tools, updates: [] }, messages: [...agent!.session.deriveMessages(), { role: 'user', content: [{ type: 'text', text: joinContextSections(renderContextSections(completed)) }] }] })
    const reserve = Math.max(config.budget!.outputReserveTokens, agent!.options.maxTokens ?? 0) + config.budget!.toolReserveTokens
    if (estimateFinalRequest(envelope()) > Math.min(config.budget!.inputLimit, config.budget!.contextWindow - reserve)) { packet = unwrap(await memory.packets.prepare(b.authority, { budget: config.budget!, globalAuthorities, inputBindings: b.data.inputs, personId: b.data.personBinding?.personId, injection: b.data.injectionBinding?.config, runtime: b.runtime?.context(), optionalTokens: 0 })); completed = compose(packet) }
    const fullContext = joinContextSections(renderContextSections(completed)), snapshot: Snapshot = { ...(packet.injection ? {injection:packet.injection,injectionBinding:structuredClone(b.data.injectionBinding!)} : {}), ...(b.data.runtimeBinding ? { runtimeBinding: structuredClone(b.data.runtimeBinding) } : {}), ...(b.data.personBinding ? { personBinding: structuredClone(b.data.personBinding) } : {}), provenance: 'packet', packetProof: packet.proof, bodyHash: sha(fullContext), packetId: packet.id, fence: packet.inputFence, globals: [...packet.globalFences], globalDependencies: [...packet.globalDependencies], globalPolicyHash: globalPolicyHash(), dependencyIds: [...packet.dependencyIds], eventIds: packet.proof.records.filter(r => r.kind === 'event').map(e => e.id), modeEpoch: policy.status(b.agent.id).modeEpoch }
    b.packet = packet; b.staticSystem = sha(renderPrompt(completed)); b.staticTools = sha(canonical(completed.tools)); b.data.pending[snapshot.bodyHash] = snapshot
    await save(b); return completed
  }) as never))
  const certify = async (b: Bound, options: any) => {
    if(b.data.runtimeBinding){if(!b.runtime || canonical(b.runtime.binding())!==canonical(b.data.runtimeBinding))throw new RpError('stale_input','Runtime binding changed');b.runtime.context()}
    if (b.data.personBinding) await verifyPersonBinding(memory.store, b.authority, b.data.personBinding)
    if(!await injectionMarkerValid(hostRoot,b.agent.id,b.data.injectionBinding))throw new RpError('stale_input','Injection marker changed')
    verifyNative()
    if (!b.packet || policy.status(b.agent.id).mode !== 'rp') throw new RpError('scope_denied', 'No prepared RP assembly')
    const sources = unwrap(await memory.store.readAcceptedSources(b.authority)), sourceMap = new Map(sources.map(s => [s.id, s])), fence = unwrap(await memory.store.readFence(b.authority)), events = new Set(unwrap(await memory.store.readEvents(b.authority)).map(e => e.id))
    let systemSeen = b.staticSystem === sha(''), packetSeen = false
    for (const message of options.messages ?? []) {
      if (message.role === 'system') { object(message, ['role', 'content', 'source', 'id']); object(message.source, ['kind']); if (message.source.kind !== 'system-prompt' || !Array.isArray(message.content) || !message.content.every((x: any) => { object(x, ['type', 'text']); return x.type === 'text' && typeof x.text === 'string' }) || sha(body(message)) !== b.staticSystem) throw new RpError('scope_denied', 'Uncertified system prompt/metadata'); systemSeen = true; continue }
      if (b.data.messageHashes[message.id] !== sha(normalizedMessage(message))) throw new RpError('scope_denied', 'Unknown or changed native history/metadata; use clean continuation')
      const snapshot = b.data.snapshots[message.id] ?? b.data.frames[message.id]
      if (snapshot) {
        if(canonical(snapshot.injectionBinding??null)!==canonical(b.data.injectionBinding??null))throw new RpError('stale_input','Historical injection binding mismatch')
        if(snapshot.injection)verifyInjectionText(snapshot.injection,body(message))
        if(snapshot.injection && snapshot.injection.context.personId!==b.data.personBinding?.personId)throw new RpError('stale_input','Historical injection person mismatch')
        if(canonical(snapshot.runtimeBinding ?? null)!==canonical(b.data.runtimeBinding ?? null))throw new RpError('stale_input','Historical runtime binding proof mismatch')
        if (canonical(snapshot.personBinding ?? null) !== canonical(b.data.personBinding ?? null)) throw new RpError('stale_input', 'Historical person binding proof mismatch')
        if (snapshot.provenance === 'packet' || snapshot.provenance === 'tool-call') await verifyPacketProof(memory.store, b.authority, snapshot.packetProof)
        if (snapshot.records) await verifyRetrievalEvidence(memory.store, b.authority, { inputFence: snapshot.fence, records: snapshot.records, resultSha256: snapshot.resultSha256! }, new Set(b.data.inputs.map(i => i.sourceId)))
        if (snapshot.bodyHash !== sha(body(message)) || snapshot.modeEpoch !== policy.status(b.agent.id).modeEpoch || snapshot.fence.branchId !== fence.branchId || snapshot.fence.canonBindingsHash !== fence.canonBindingsHash || snapshot.fence.visibilityRevision !== fence.visibilityRevision || snapshot.fence.deletionGeneration !== fence.deletionGeneration || snapshot.fence.policyVersion !== fence.policyVersion || snapshot.dependencyIds.some(id => !sourceMap.has(id)) || snapshot.eventIds.some(id => !events.has(id))) throw new RpError('stale_input', 'Historical RP snapshot is invalid; use clean continuation')
        if (snapshot.globalPolicyHash !== globalPolicyHash() || snapshot.globals.length !== globalAuthorities.length) throw new RpError('scope_denied', 'Historical global grants changed')
        for (const dep of snapshot.globalDependencies) {
          let authorized = false
          for (const grant of globalAuthorities) { const result = await memory.global.store.readPublication(grant, dep.publicationId); if (!result.ok) continue; const p = result.value; if (p.source.id !== dep.sourceId || p.bodySha256 !== dep.bodySha256 || canonical(p.scope) !== canonical(dep.scope)) continue; if (p.scope.kind === 'profile' && !unwrap(await memory.global.store.listActive(grant)).some(x => x.id === p.id)) continue; authorized = true }
          if (!authorized) throw new RpError('scope_denied', 'Historical global source no longer authorized/applicable')
        }
        if (b.data.snapshots[message.id] && snapshot.packetId === b.packet.id) packetSeen = true
      } else {
        object(message, ['role', 'content', 'source', 'id']); object(message.source, message.role === 'assistant' ? ['kind', 'provider', 'model'] : ['kind'])
        if (!Array.isArray(message.content) || !message.content.every((block: any) => { object(block, ['type', 'text']); return block.type === 'text' && typeof block.text === 'string' })) throw new RpError('capability_missing', 'Uncertified raw rich/reasoning content requires a clean continuation')
        const sourceId = b.data.hostSources[message.id], source = sourceMap.get(sourceId)
        if (!source || source.publicTextSha256 !== sha(body(message))) throw new RpError('scope_denied', 'Native history contains rejected, unselected, revised, deleted or wrong-branch source')
        unwrap(await memory.store.readSource(b.authority, fullSpan(source)))
      }
    }
    if (!systemSeen || !packetSeen || options.system !== undefined || sha(canonical(options.tools ?? [])) !== b.staticTools) throw new RpError('scope_denied', 'RP injection/static request envelope absent or changed')
    // Direct unknown content channels are never an exemption from final gating.
    if (options.toolHistory && (sha(canonical(options.toolHistory.tools)) !== b.staticTools || options.toolHistory.updates?.length !== 0)) throw new RpError('scope_denied', 'Uncertified historical tool declarations')
    for (const key of Object.keys(options)) if (!['provider', 'model', 'messages', 'tools', 'toolHistory', 'sessionId', 'signal', 'maxTokens', 'temperature', 'reasoningEffort', 'stop'].includes(key)) throw new RpError('scope_denied', 'Uncertified final request channel: ' + key)
    const admission = unwrap(await memory.packets.admit(b.authority, b.packet, Object.fromEntries(Object.entries(options).filter(([k]) => k !== 'signal'))))
    // Equivalent live readiness gate: it is derived here from exact registry
    // identity, observed source bindings, every history frame, branch/canon
    // authorization, real request budget and the held consumption lease. No
    // serialized configuration boolean or report can supply this evidence.
    if (!live(b.agent) || options.sessionId !== b.agent.id || policy.status(b.agent.id).mode !== 'rp' || b.packet.inputFence.branchId !== b.data.request.branchId) throw new RpError('capability_missing', 'Live RP application readiness is unavailable')
    return admission
  }
  effects.push(root.on('llm/stream', (async function* (options: any, next: () => AsyncIterable<any>) {
    const b = options.sessionId && bound.get(options.sessionId)
    if (!b) {
      yield* next(); return
    }
    await drain(b)
    const queueTail = b.queue, saveTail = b.saveQueue, generation = b.generation
    const state = policy.status(b.agent.id), release = await policy.request(b.agent.id, state.epoch)
    let revoke: (() => void) | undefined
    try { if (queueTail !== b.queue || saveTail !== b.saveQueue || generation !== b.generation) throw new RpError('stale_input', 'RP queues changed before request'); await certify(b, options); shutdown.signal.throwIfAborted(); if (queueTail !== b.queue || saveTail !== b.saveQueue || generation !== b.generation) throw new RpError('stale_input', 'RP queues changed during request certification'); revoke = admission.issue(owner, b.agent.id, options, { epoch: state.epoch, generation, active: true }); yield* next() }
    catch (e) { throw new LlmError(e instanceof RpError ? e.code + ': ' + e.message : 'RP request blocked', 'RP_ADMISSION') }
    finally { revoke?.(); release() }
  }) as never, { prepend: true }))
  effects.push(root.on('agent/created', (async ({ agent, source }: any) => {
    if (closed || bound.has(agent.id) || source !== 'resume') return
    try {
      const envelope = object(await readRpJson(file(agent.id)), ['data', 'sha256']); hash(envelope.sha256); if (sha(canonical(envelope.data)) !== envelope.sha256) throw new Error('RP host journal hash mismatch'); const raw = validateJournal(envelope.data)
      if (raw.sessionId !== agent.id || raw.request.sessionId !== agent.id || raw.request.workspaceId !== binding.workspaceId) throw new Error('RP persisted binding identity mismatch')
      await installBound(agent, raw.request.branchId, raw, true)
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') { await policy.block(agent.id) } }
  }) as never))
  effects.push(root.on('agent/disposed', (({ agent }: any) => { void closeManager(agent.id).catch(()=>{}); const b = bound.get(agent.id); if (b) { b.runtime?.revoke(); b.generation++; admission.retireBinding(owner, agent.id); void policy.block(agent.id).then(() => { admission.release(owner, agent.id); bound.delete(agent.id) }).catch(() => { b.data.blocked = true }) } }) as never))
  // Only read/status tools. They cannot reach commands, approvals, stores or grants.
  const tools: any = root.get('tools'), output = { schema: { type: 'object' as const, additionalProperties: false as const, properties: { text: { type: 'string' as const, required: true as const } } }, render: (_args: unknown, result: { text: string }) => [{ type: 'text' as const, text: result.text }] }
  effects.push(root.on('tools/execute', (async (exec: any, next: () => Promise<any>) => {
    const b: Bound | undefined = exec.agent && bound.get(exec.agent.id)
    if (!b || !['rp_memory_search', 'rp_memory_get', 'rp_memory_status'].includes(exec.name)) return next()
    try {
      const result = await next(); await drain(b)
      const pending = pendingTools.get(exec.token), queueTail = b.queue
      if (!pending || pending.agent !== exec.agent || pending.agent !== b.agent || pending.callId !== exec.callId || pending.generation !== b.generation || pending.packetId !== b.packet?.id || canonical(result.content) !== canonical([{ type: 'text', text: pending.text }])) throw new RpError('scope_denied', 'Uncertified rendered tool result')
      // Reserve this session's journal tail before taking the coordinator. New
      // ordinary saves queue behind it; this critical section never awaits it.
      let finish!: () => void
      const publication = new Promise<void>(resolve => { finish = resolve }); b.saveQueue = publication
      const checkPublication = () => {
        exec.signal.throwIfAborted()
        if (closed || !live(b.agent) || b.data.blocked || policy.status(b.agent.id).mode !== 'rp' || pending.generation !== b.generation || queueTail !== b.queue || publication !== b.saveQueue || pending.packetId !== b.packet?.id) throw new RpError('ownership_lost', 'Tool receipt owner changed')
      }
      try { await policy.coordinator.mutate(async () => {
        checkPublication()
        await verifyRetrievalEvidence(memory.store, b.authority, pending.proof, new Set(b.data.inputs.map(i => i.sourceId)))
        checkPublication()
        const snapshot: Snapshot = { ...(b.data.injectionBinding ? {injectionBinding:structuredClone(b.data.injectionBinding)} : {}), ...(b.data.runtimeBinding ? { runtimeBinding: structuredClone(b.data.runtimeBinding) } : {}), ...(b.data.personBinding ? { personBinding: structuredClone(b.data.personBinding) } : {}), provenance: pending.provenance, records: pending.proof.records, resultSha256: pending.proof.resultSha256, bodyHash: sha(pending.text), packetId: pending.packetId, fence: pending.proof.inputFence, globals: [...b.packet!.globalFences], globalDependencies: [...b.packet!.globalDependencies], globalPolicyHash: globalPolicyHash(), dependencyIds: [], eventIds: [], modeEpoch: policy.status(b.agent.id).modeEpoch }
        const data = { ...b.data, receipts: { ...b.data.receipts, [exec.callId]: { contentHash: sha(canonical(result.content)), snapshot } } }
        try { await writeJournal(b, false, data, checkPublication); checkPublication(); b.data = data } catch (e) { b.data.blocked = true; b.lastError = e instanceof RpError ? e.code : 'persistence_failed'; throw e }
      }) } finally { finish() }; return result
    } finally { pendingTools.delete(exec.token) }
  }) as never, { prepend: true }))
  for (const name of ['rp_memory_search', 'rp_memory_get', 'rp_memory_status']) {
    effects.push(tools.register(defineTool({ name, description: 'Read-only RP data. Cannot accept sources, execute commands, approve publications or grant authority.', parameters: name.endsWith('status') ? {} : name.endsWith('get') ? { id: { type: 'string' }, cursor: { type: 'string' }, maxChars: { type: 'integer' } } : { query: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer' } }, output, isConcurrencySafe: () => true,
      async execute(args: any, exec: any) {
        const b: Bound | undefined = exec.agent && bound.get(exec.agent.id)
        if (!b || b.agent !== exec.agent || !live(exec.agent) || policy.status(exec.agent.id).mode !== 'rp') throw new Error('RP read requires exact bound live caller')
        await drain(b); const generation = b.generation, packetId = b.packet?.id
        if (!packetId || typeof exec.token !== 'symbol') throw new RpError('scope_denied', 'No native execution identity or packet')
        let result: any, proof: RetrievalEvidence, provenance: 'retrieval-result' | 'status' | 'error'
        if (name.endsWith('status')) { const inputFence = unwrap(await memory.store.readFence(b.authority)); result = { mode: 'memory', branchId: inputFence.branchId, pendingInputIds: b.data.inputs.filter(i => !i.dispatched).map(i => i.sourceId) }; proof = { inputFence, records: [], resultSha256: sha(canonical(result)) }; provenance = 'status' }
        else {
          result = name.endsWith('get') ? await memory.retrieval.get(b.authority, args) : await memory.retrieval.search(b.authority, args)
          if (result.ok) { proof = retrievalEvidence(result, b.authority); provenance = 'retrieval-result' }
          else { result = { ok: false, code: result.code }; proof = { inputFence: unwrap(await memory.store.readFence(b.authority)), records: [], resultSha256: sha(canonical(result)) }; provenance = 'error' }
        }
        exec.signal.throwIfAborted(); if (closed || b.generation !== generation) throw new RpError('ownership_lost', 'Late tool result')
        const text = canonical(result); pendingTools.set(exec.token, { agent: b.agent, callId: exec.callId, generation, packetId, text, proof, provenance }); return { text }
      },
    } as any)))
  }
  return Object.freeze({ enabled: true, memory, policy,
    async ready(sessionId: string) { const b = bound.get(sessionId); if (b) await drain(b) },
    status: diagnostic,
    close() {
      if (closePromise) return closePromise
      closed = true; admission.retire(owner); for(const m of managers.values())m.revoke(); for(const b of bound.values()) b.runtime?.revoke(); pendingTools.clear(); shutdown.abort(new Error('RP plugin disposed'))
      const errors: unknown[] = [], attempt = async (work: () => unknown) => { try { await work() } catch (e) { errors.push(e) } }
      for (const b of bound.values()) { b.generation++; b.packet = undefined; try { b.agent.cancel({ kind: 'hook', reason: 'RP owner disposed' }) } catch (e) { errors.push(e) } }
      closePromise = (async () => {
        await attempt(() => memory.jobs.close())
        for (const b of bound.values()) {
          await attempt(() => b.agent.whenIdle()); await attempt(() => b.queue); await attempt(() => b.saveQueue)
          await attempt(async () => { await policy.block(b.agent.id); admission.release(owner, b.agent.id) })
          b.data.blocked = true; await attempt(() => save(b, true))
        }
        for (const dispose of effects.reverse()) if (typeof dispose === 'function') await attempt(dispose)
        await attempt(() => memory.retrieval.dispose()); for (const h of handles.reverse()) await attempt(() => h.dispose()); await attempt(() => lease.release()); admission.unreserve(owner)
        if (errors.length) throw new AggregateError(errors, 'RP close failed; request ownership remains retired')
      })(); return closePromise
    },
  })
  } catch (cause) {
    admission.retire(owner)
    const failures: unknown[] = []
    for (const dispose of startupCleanups.reverse()) { try { await dispose() } catch (e) { failures.push(e) } }
    admission.unreserve(owner)
    if (failures.length) throw new AggregateError([cause, ...failures], 'RP initialization failed; ownership remains retired')
    throw cause
  }
}
export default installRpPlugin
