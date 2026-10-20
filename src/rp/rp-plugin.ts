/** Narrator injection-only adapter for pinned SDK. No automatic canonical selection. */
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
import { observePublicHostSource } from './source-adapter.js'
import { fullSpan, unwrap } from './retrieval.js'
import { estimateFinalRequest, type GlobalDependency, type InputBinding, type MemoryPacket, type RuntimeBudget } from './packet.js'
import { cloneInput, fence as validateFence, hash, hostId, id, integer, object, RpError, scope as validateScope, text } from './schema.js'
import type { AuthorityRequest } from './store.js'
import type { HostAuthority, InputFence, SourceRevision } from './types.js'
import type { GlobalFence } from './global.js'
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const uid = (p: string) => p + '_' + randomUUID().replaceAll('-', '')
const body = (m: any) => (m.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
const normalizedMessage = (m: any) => canonical(m)
interface Snapshot { messageId?: string; bodyHash: string; packetId: string; fence: InputFence; globals: GlobalFence[]; globalDependencies: GlobalDependency[]; globalPolicyHash: string; dependencyIds: string[]; eventIds: string[]; modeEpoch: number }
interface Input extends InputBinding { dispatched: boolean; bodyHash: string; phase: 'observed' | 'accepted' | 'dispatching' | 'dispatched'; operationKey: string; expected: InputFence }
interface DurableSession { schemaVersion: 1; sessionId: string; request: AuthorityRequest; inputs: Input[]; hostSources: Record<string, string>; snapshots: Record<string, Snapshot>; frames: Record<string, Snapshot>; receipts: Record<string, { contentHash: string; snapshot: Snapshot }>; pending: Record<string, Snapshot>; messageHashes: Record<string, string>; currentTurnId?: string; blocked?: boolean }
interface Bound { agent: Agent; authority: HostAuthority; data: DurableSession; queue: Promise<unknown>; saveQueue: Promise<void>; packet?: MemoryPacket; staticSystem?: string; staticTools?: string; generation: number }
function validateJournal(input: unknown): DurableSession {
  const r = object(cloneInput(input), ['schemaVersion', 'sessionId', 'request', 'inputs', 'hostSources', 'snapshots', 'frames', 'receipts', 'pending', 'messageHashes'], ['currentTurnId', 'blocked'])
  if (r.schemaVersion !== 1 || (r.blocked !== undefined && typeof r.blocked !== 'boolean')) throw new RpError('store_corrupt', 'RP host journal schema')
  hostId(r.sessionId); if (r.currentTurnId !== undefined) id(r.currentTurnId)
  const ids = (v: unknown) => { if (!Array.isArray(v) || v.length > 4096) throw new RpError('store_corrupt', 'RP host dependency IDs'); v.forEach(id) }
  const snapshot = (v: unknown) => { const s = object(v, ['bodyHash', 'packetId', 'fence', 'globals', 'globalDependencies', 'globalPolicyHash', 'dependencyIds', 'eventIds', 'modeEpoch'], ['messageId']); hash(s.bodyHash); id(s.packetId); validateFence(s.fence); hash(s.globalPolicyHash); ids(s.dependencyIds); ids(s.eventIds); integer(s.modeEpoch); if (s.messageId) hostId(s.messageId); if (!Array.isArray(s.globals) || !Array.isArray(s.globalDependencies)) throw new RpError('store_corrupt', 'RP global snapshot list'); for (const g of s.globals) { object(g, ['scope', 'scopeRevision', 'visibilityRevision', 'deletionGeneration']); validateScope(g.scope); integer(g.scopeRevision); integer(g.visibilityRevision); integer(g.deletionGeneration) }; for (const d of s.globalDependencies) { object(d, ['publicationId', 'sourceId', 'bodySha256', 'scope', 'key']); id(d.publicationId); id(d.sourceId); hash(d.bodySha256); validateScope(d.scope); text(d.key, 128) } }
  if (!Array.isArray(r.inputs)) throw new RpError('store_corrupt', 'RP inputs')
  for (const i of r.inputs) { object(i, ['kind', 'sourceId', 'turnId', 'messageId', 'dispatched', 'bodyHash', 'phase', 'operationKey', 'expected']); if (i.kind !== 'input' || !['observed', 'accepted', 'dispatching', 'dispatched'].includes(i.phase) || typeof i.dispatched !== 'boolean') throw new RpError('store_corrupt', 'RP input stage'); id(i.sourceId); id(i.turnId); hostId(i.messageId); hash(i.bodyHash); text(i.operationKey, 256); validateFence(i.expected) }
  for (const field of ['hostSources', 'snapshots', 'frames', 'receipts', 'pending', 'messageHashes']) { const map = object(r[field], [], Object.keys(r[field])); if (Object.keys(map).length > 4096) throw new RpError('store_corrupt', 'RP host map size'); for (const [key, value] of Object.entries(map)) { if (field === 'pending') hash(key); else hostId(key); if (field === 'hostSources') id(value); else if (field === 'messageHashes') hash(value); else if (field === 'receipts') { const rec = object(value, ['contentHash', 'snapshot']); hash(rec.contentHash); snapshot(rec.snapshot) } else snapshot(value) } }
  return r as DurableSession
}
export interface RpPluginConfig {
  enabled?: boolean; profileRoot?: string; workspaceRoot?: string; campaignId?: string; entityIds?: readonly string[]; budget?: RuntimeBudget
  /** P5 remains gated. Both default false; true is rejected before bootstrap. */
  contextCompression?: boolean; strictPov?: boolean
  /** Trusted composition attestation. Not a claim about arbitrary installed plugins. */
  knownCooperatingWriters?: boolean
  globalGrants?: readonly { scope: any; visibility: any; audienceSetIds: string[]; write: boolean }[]
  /** Fault seam before dispatch, used to prove durable input recovery without a model. */
  beforeInputDispatch?: () => Promise<void>
  inputFault?: (stage: 'intent_saved' | 'acceptance_committed' | 'dispatch_marked') => Promise<void>
}
export async function installRpPlugin(context: Context, config: RpPluginConfig = {}) {
  if (config.enabled !== true) {
    // No bootstrap, directory scan or capture while disabled. Retain a lazy
    // recovery veto for already-owned RP sessions instead of abandoning them.
    const root = context.root ?? context, remove = root.on('llm/stream', (async function* (options: any, next: () => AsyncIterable<any>) { if (options.sessionId && !engineeringAllowed(root, options.sessionId) && (root.get('sessionMemoryPolicy') as any)?.status(options.sessionId).mode !== 'rp') throw new LlmError('RP recovery owner is unavailable', 'RP_ADMISSION'); yield* next() }) as never)
    return Object.freeze({ enabled: false, close: async () => { remove() }, status: () => ({ enabled: false, contextCompression: false, strictPov: false }) })
  }
  for (const key of ['contextCompression', 'strictPov'] as const) if (config[key] !== undefined && typeof config[key] !== 'boolean') throw new RpError('invalid_record', 'RP mode option must be boolean: ' + key)
  if (config.contextCompression === true || config.strictPov === true) throw new RpError('capability_missing', 'Native compaction CAS/lifecycle/ownership and complete strict POV filtering are not verified; both modes remain disabled')
  if (!config.profileRoot || !config.workspaceRoot || !config.budget) throw new Error('RP requires explicit profile/workspace and verified request capacity')
  if (config.knownCooperatingWriters !== true) throw new Error('RP requires a trusted known-writer composition; unknown/private compactors are unsupported')
  const root = context.root ?? context
  const req = createRequire(import.meta.url), nativeVersions: Record<string, string> = {}
  for (const name of ['dsh-agent', 'dsh-llm', 'dsh-session', 'dsh-system-prompt']) { const entry = req.resolve('@deepseek-ai/' + name), manifest = JSON.parse(await fs.readFile(path.resolve(path.dirname(entry), '../package.json'), 'utf8')); if (manifest.version !== '0.2.0-rc.2') throw new RpError('capability_missing', 'RP native Memory is only tested on SDK 0.2.0-rc.2'); nativeVersions[name] = manifest.version }
  const nativeServices = { agents: root.get('agents'), llm: root.get('llm'), prompt: root.get('systemPrompt'), sessions: root.get('sessions'), commands: root.get('commands') } as any
  const verifyNative = () => {
    // Cordis returns a fresh trace proxy on each get(); prototype identity is
    // stable while proxy reference equality is intentionally not.
    const checks = { agents: root.get('agents') instanceof AgentRegistry, llm: root.get('llm') instanceof LlmRuntime, prompt: root.get('systemPrompt') instanceof SystemPrompt, agentsIdentity: Object.getPrototypeOf(root.get('agents')) === Object.getPrototypeOf(nativeServices.agents), llmIdentity: Object.getPrototypeOf(root.get('llm')) === Object.getPrototypeOf(nativeServices.llm), promptIdentity: Object.getPrototypeOf(root.get('systemPrompt')) === Object.getPrototypeOf(nativeServices.prompt), sessionsIdentity: Object.getPrototypeOf(root.get('sessions')) === Object.getPrototypeOf(nativeServices.sessions), commandsIdentity: Object.getPrototypeOf(root.get('commands')) === Object.getPrototypeOf(nativeServices.commands), flush: typeof nativeServices.sessions?.flush === 'function', commands: typeof nativeServices.commands?.register === 'function', format: SESSION_FORMAT_VERSION === 4 }
    const missing = Object.entries(checks).filter(([, valid]) => !valid).map(([key]) => key); if (missing.length) throw new RpError('capability_missing', 'Live pinned native services changed or are unavailable: ' + missing.join(','))
  }
  verifyNative()
  const lease = acquireSessionPolicy(root as any, 'rp'), policy = lease.policy
  const memory = await openRpMemory({ profileRoot: config.profileRoot, entityIds: config.entityIds ?? [], coordinator: policy.coordinator })
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
  const commandGrant = async (worldId?: string, entityId?: string) => policy.coordinator.mutate(async () => {
    if (worldId !== undefined) id(worldId); if (entityId !== undefined) id(entityId)
    const scope = worldId ? { kind: 'world', profileId: binding.profileId, worldId, ...(entityId ? { entityId } : {}) } : { kind: 'profile', profileId: binding.profileId }
    const old = globalSpecs.findIndex(g => canonical(g.scope) === canonical(scope)); if (old >= 0) return globalAuthorities[old]
    if (config.globalGrants !== undefined) throw new RpError('scope_denied', 'Explicit configuration is the global scope allowlist; persisted commands cannot widen it')
    const spec = { scope, visibility, audienceSetIds: ['rp_user'], write: true }, authority = unwrap(await memory.global.control.authorize(spec as any)); globalSpecs.push(spec); globalAuthorities.push(authority)
    commandSpecs.push(spec)
    const tmp = grantFile + '.tmp-' + uid('write'), h = await fs.open(tmp, 'wx', 0o600); try { await h.writeFile(canonical({ schemaVersion: 1, grants: commandSpecs, sha256: sha(canonical(commandSpecs)) })); await h.sync() } finally { await h.close() }; await fs.rename(tmp, grantFile); return authority
  })
  let closed = false
  const inputHistory = new Map<string, Map<string, Input>>()
  for (const name of (await fs.readdir(hostRoot)).filter(n => /^[a-f0-9]{64}\.json$/u.test(n))) {
    const envelope = object(await readRpJson(path.join(hostRoot, name)), ['data', 'sha256']); if (sha(canonical(envelope.data)) !== envelope.sha256) throw new Error('RP input registry journal corrupt')
    const data = validateJournal(envelope.data)
    if (data.request.workspaceId !== binding.workspaceId || data.request.campaignId !== (config.campaignId ?? 'rp_campaign')) continue
    const map = inputHistory.get(data.request.branchId) ?? new Map<string, Input>(); data.inputs.forEach(i => map.set(i.sourceId, i)); inputHistory.set(data.request.branchId, map); memory.registerInputBindings(data.request.branchId, data.inputs)
  }
  const live = (agent: Agent) => !closed && (root.get('agents') as any)?.get(agent.id) === agent && agent.session.header.cwd && path.resolve(agent.session.header.cwd) === path.resolve(workspaceRoot)
  const file = (session: string) => path.join(hostRoot, sha(session) + '.json')
  const save = (b: Bound): Promise<void> => b.saveQueue = b.saveQueue.catch(() => {}).then(async () => {
    if (closed) throw new RpError('ownership_lost', 'RP owner disposed')
    const target = file(b.data.sessionId), tmp = target + '.tmp-' + uid('write'), h = await fs.open(tmp, 'wx', 0o600)
    const data = validateJournal(b.data)
    try { await h.writeFile(canonical({ data, sha256: sha(canonical(data)) })); await h.sync() } finally { await h.close() }
    if (closed) { await fs.rm(tmp, { force: true }); throw new RpError('ownership_lost', 'RP disposed before publication') }
    await fs.rename(tmp, target)
  })
  const queue = (b: Bound, work: () => Promise<void>) => { const p = b.queue.catch(() => {}).then(async () => { if (closed) return; await work() }); b.queue = p; void p.catch(() => { b.data.blocked = true }); return p }
  const drain = async (b: Bound) => { await b.queue; if (closed || !live(b.agent) || b.data.blocked) throw new RpError('ownership_lost', 'RP session is unavailable') }
  const assertIdle = (agent: Agent) => { if (!live(agent) || agent.status !== 'idle') throw new RpError('scope_denied', 'RP controls require the exact live idle root session') }
  const requestFor = (session: string, branchId: string): AuthorityRequest => ({ workspaceId: binding.workspaceId, campaignId: config.campaignId ?? 'rp_campaign', branchId, sessionId: session, sceneId: 'rp_scene', viewpoint: { kind: 'narrator' }, visibility, audienceSetIds: ['rp_user'], permissions: ['read', 'observe', 'commit', 'control'] })
  const safe = (agent: Agent) => agent.session.deriveMessages().length === 0 && !agent.session.header.parentSession && !agent.session.header.isSeeded && !(root.get('compaction')) && !(root.get('ultraEvidenceSupport') as any)?.memory?.hasActiveSession(agent.id)
  const installBound = async (agent: Agent, branchId?: string, existing?: DurableSession, beforePublication = false) => {
    verifyNative(); if (agent.session.header.version !== 4) throw new RpError('capability_missing', 'Untested native session format')
    if (!beforePublication) assertIdle(agent)
    if (!existing && !safe(agent)) throw new RpError('scope_denied', 'RP activation needs a fresh drained root session without engineering history or archive readers')
    const branch = branchId ?? unwrap(await memory.control.createBranch(binding.workspaceId, config.campaignId ?? 'rp_campaign')).id
    const data = existing ?? { schemaVersion: 1 as const, sessionId: agent.id, request: requestFor(agent.id, branch), inputs: [...(inputHistory.get(branch)?.values() ?? [])].map(i => ({ ...i, dispatched: true, phase: 'dispatched' as const })), hostSources: {}, snapshots: {}, frames: {}, receipts: {}, pending: {}, messageHashes: {} }
    const authority = unwrap(await memory.control.authorize(data.request))
    if (!existing) { const accepted = new Set(unwrap(await memory.store.readAcceptedSources(authority)).map(s => s.id)), inherited = new Map<string, Input>(); for (const map of inputHistory.values()) for (const i of map.values()) if (accepted.has(i.sourceId)) inherited.set(i.sourceId, { ...i, dispatched: true, phase: 'dispatched' }); data.inputs = [...inherited.values()] }
    const markerRoot = path.join(workspaceRoot, '.dsh-rp-policy', 'v1'); await fs.mkdir(markerRoot, { recursive: true })
    // Written before agent publication or activation; engineering only treats
    // this as a fail-closed ownership marker, never as authority to read RP.
    await fs.writeFile(path.join(markerRoot, sha(agent.id) + '.json'), canonical({ protocol: 'dsh.session-memory-policy/v1', sessionId: agent.id, workspaceId: binding.workspaceId }), { flag: 'w', mode: 0o600 })
    await policy.activate(agent.id, 'rp', { idle: beforePublication || agent.status === 'idle', safe: true })
    const b: Bound = { agent, authority, data, queue: Promise.resolve(), saveQueue: Promise.resolve(), generation: 0 }; bound.set(agent.id, b); memory.registerInputBindings(branch, data.inputs); await save(b); return b
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
      signal.throwIfAborted(); shutdown.signal.throwIfAborted(); assertIdle(agent)
      const match = /^\s*(\S+)?(?:\s+([\s\S]*))?$/u.exec(invocation.rawInput)!, action = match[1] ?? 'status', arg = match[2] ?? ''
      let b = bound.get(agent.id)
      if (action === 'global') {
        const parsed = /^(\S+)\s+([\s\S]+)$/u.exec(arg); if (!parsed) throw new RpError('invalid_record', 'Use /rp global preference|publish|list|adopt <JSON>')
        const op = JSON.parse(parsed[2]), sub = parsed[1]; object(op, [], ['worldId', 'entityId', 'key', 'body', 'privateSourceIds', 'supersedes', 'publicationId'])
        const ga = await commandGrant(sub === 'preference' ? undefined : op.worldId, op.entityId), approval = memory.global.control.approval({ commandId: 'command_' + sha(commandId), sessionId: agent.id })
        if (sub === 'publish' || sub === 'preference') { if (sub === 'publish' && !op.worldId) throw new RpError('invalid_record', 'Explicit worldId is required'); const publication = unwrap(await memory.global.control.publish(ga, approval, { idempotencyKey: commandId, expected: unwrap(await memory.global.store.readFence(ga)), key: op.key, body: op.body, privateSourceIds: op.privateSourceIds ?? [], ...(op.supersedes ? { supersedes: op.supersedes } : {}) })); return { kind: 'success', text: 'Approved publication ' + publication.id + ' revision ' + publication.revision } }
        if (sub === 'list') return { kind: 'success', text: 'Approved publication IDs: ' + unwrap(await memory.global.store.list(ga)).map(p => p.id + '@' + p.revision).join(', ') }
        if (sub === 'adopt') { if (!b) throw new RpError('scope_denied', 'Start the story branch before adopting canon'); unwrap(await memory.adoptCanon(b.authority, ga, approval, op.publicationId, commandId)); return { kind: 'success', text: 'Pinned canon revision adopted.' } }
        throw new RpError('invalid_record', 'Unknown global control')
      }
      if (action === 'start') { if (b) return { kind: 'success', text: 'RP already active.' }; b = await installBound(agent, arg || undefined) }
      if (!b) throw new RpError('scope_denied', 'Start or restore the RP session first')
      await drain(b); signal.throwIfAborted()
      const summaryOptions = { globalAuthorities, policyEpoch: () => { shutdown.signal.throwIfAborted(); if (closed || !live(agent) || policy.status(agent.id).mode !== 'rp') throw new RpError('ownership_lost', 'RP candidate owner changed'); return policy.status(agent.id).epoch } }
      if (action === 'summarize-auto') throw new RpError('capability_missing', 'No trusted background candidate route; use /rp summary then /rp adopt')
      if (action === 'propose' || action === 'summary') {
        const op = object(JSON.parse(arg), ['selection', 'proposal']), candidate = unwrap(await memory.summaries.propose(b.authority, op.proposal, op.selection, summaryOptions))
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
      else if (action === 'retcon') { const op = JSON.parse(arg); unwrap<unknown>(await canonicalControl(b, commandId, { kind: 'retcon', targetEventIds: op.targetEventIds, events: op.events })) }
      else if (action === 'delete') { const op = JSON.parse(arg); if (!['retain', 'delete'].includes(op.publicationDisposition)) throw new RpError('invalid_record', 'Choose publicationDisposition retain/delete explicitly'); for (const ga of globalAuthorities) unwrap(await memory.global.control.privateDeletion(ga, memory.global.control.approval({ commandId: 'command_' + sha(commandId), sessionId: agent.id }), { idempotencyKey: commandId, expected: unwrap(await memory.global.store.readFence(ga)), privateSourceIds: op.sourceRevisionIds, publicationDisposition: op.publicationDisposition })); unwrap<unknown>(await canonicalControl(b, commandId, { kind: 'privacy_delete', sourceRevisionIds: op.sourceRevisionIds, affectedBranchIds: [b.data.request.branchId] })) }
      else if (action === 'publish') { const op = JSON.parse(arg), ga = globalAuthorities[op.grantIndex]; if (!ga) throw new RpError('scope_denied', 'Unknown global grant'); const approval = memory.global.control.approval({ commandId: 'command_' + sha(commandId), sessionId: agent.id }); unwrap(await memory.global.control.publish(ga, approval, { idempotencyKey: commandId, expected: unwrap(await memory.global.store.readFence(ga)), key: op.key, body: op.body, privateSourceIds: op.privateSourceIds, ...(op.supersedes ? { supersedes: op.supersedes } : {}) })) }
      else if (action === 'adopt-canon') { const op = JSON.parse(arg), ga = globalAuthorities[op.grantIndex]; if (!ga) throw new RpError('scope_denied', 'Unknown global grant'); unwrap(await memory.adoptCanon(b.authority, ga, memory.global.control.approval({ commandId: 'command_' + sha(commandId), sessionId: agent.id }), op.publicationId, commandId)) }
      else if (action === 'continue-clean') {
        agent.cancel({ kind: 'hook', reason: 'RP clean continuation' }); await agent.whenIdle(); await drain(b)
        const branchId = arg || b.data.request.branchId, expected = unwrap(await memory.store.readFence(b.authority)), state = policy.status(agent.id), created = await (root.get('agents') as any).create({ sessionId: uid('rp_clean'), meta: { cwd: workspaceRoot }, agentOptions: { ...agent.options }, signal,
          setup: async (_agentCtx: Context, newAgent: Agent) => { await installBound(newAgent, branchId, undefined, true); return { commit() { signal.throwIfAborted(); if (closed || policy.status(agent.id).epoch !== state.epoch) throw new Error('Clean continuation policy changed') } } } })
        if (canonical(unwrap(await memory.store.readFence(b.authority))) !== canonical(expected)) { await created.dispose(); throw new RpError('stale_input', 'Branch changed during clean continuation') }
        handles.push(created); return { kind: 'success', text: 'Clean RP root session created: ' + created.agent.id + '. Select that session in the host; the UI tab was not switched.' }
      }
      else if (action !== 'accept' && action !== 'reject') throw new RpError('invalid_record', 'Use start/status/input/accept/reject/delete/retcon/publish/adopt-canon/continue-clean/resume-input')
      signal.throwIfAborted(); if (!await (root.get('sessions') as any).flush(agent.session)) throw new RpError('persistence_uncertain', 'Native session flush unconfirmed')
      return { kind: 'success', text: 'RP control committed. Historical native content may require continue-clean.' }
    } catch (e) { return { kind: 'error', text: e instanceof RpError ? e.code + ': ' + e.message : 'RP control failed; inspect status before retry.' } }
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
      if (!b.packet || !message.content.every((c: any) => c.type === 'tool-call' && ['rp_memory_search', 'rp_memory_get', 'rp_memory_status'].includes(c.name))) { b.data.blocked = true; return }
      b.data.frames[message.id] = { bodyHash: sha(body(message)), packetId: b.packet.id, fence: b.packet.inputFence, globals: [...b.packet.globalFences], globalDependencies: [...b.packet.globalDependencies], globalPolicyHash: globalPolicyHash(), dependencyIds: [...b.packet.dependencyIds], eventIds: [], modeEpoch: policy.status(session.id).modeEpoch }
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
    let packet = unwrap(await memory.packets.prepare(b.authority, { budget: config.budget!, globalAuthorities, inputBindings: b.data.inputs }))
    request.signal?.throwIfAborted(); if (closed || generation !== b.generation) throw new RpError('stale_input', 'Late RP assembly')
    const compose = (p: MemoryPacket) => ({ ...assembly, tools: assembly.tools.filter((t: any) => ['rp_memory_search', 'rp_memory_get', 'rp_memory_status'].includes(t.name)), contexts: [...assembly.contexts, { name: 'rp-memory', text: canonical({ rpPacketId: p.id, data: JSON.parse(p.text), recentAcceptedOriginals: p.recent }) }] })
    let completed = compose(packet)
    const envelope = () => ({ provider: agent!.options.provider, model: agent!.options.model, maxTokens: agent!.options.maxTokens, system: renderPrompt(completed), tools: completed.tools, toolHistory: { tools: completed.tools, updates: [] }, messages: [...agent!.session.deriveMessages(), { role: 'user', content: [{ type: 'text', text: joinContextSections(renderContextSections(completed)) }] }] })
    const reserve = Math.max(config.budget!.outputReserveTokens, agent!.options.maxTokens ?? 0) + config.budget!.toolReserveTokens
    if (estimateFinalRequest(envelope()) > Math.min(config.budget!.inputLimit, config.budget!.contextWindow - reserve)) { packet = unwrap(await memory.packets.prepare(b.authority, { budget: config.budget!, globalAuthorities, inputBindings: b.data.inputs, optionalTokens: 0 })); completed = compose(packet) }
    const fullContext = joinContextSections(renderContextSections(completed)), events = unwrap(await memory.store.readEvents(b.authority)), snapshot: Snapshot = { bodyHash: sha(fullContext), packetId: packet.id, fence: packet.inputFence, globals: [...packet.globalFences], globalDependencies: [...packet.globalDependencies], globalPolicyHash: globalPolicyHash(), dependencyIds: [...packet.dependencyIds], eventIds: events.map(e => e.id), modeEpoch: policy.status(b.agent.id).modeEpoch }
    b.packet = packet; b.staticSystem = sha(renderPrompt(completed)); b.staticTools = sha(canonical(completed.tools)); b.data.pending[snapshot.bodyHash] = snapshot
    await save(b); return completed
  }) as never))
  const certify = async (b: Bound, options: any) => {
    verifyNative()
    await drain(b)
    if (!b.packet || policy.status(b.agent.id).mode !== 'rp') throw new RpError('scope_denied', 'No prepared RP assembly')
    const sources = unwrap(await memory.store.readAcceptedSources(b.authority)), sourceMap = new Map(sources.map(s => [s.id, s])), fence = unwrap(await memory.store.readFence(b.authority)), events = new Set(unwrap(await memory.store.readEvents(b.authority)).map(e => e.id))
    let systemSeen = b.staticSystem === sha(''), packetSeen = false
    for (const message of options.messages ?? []) {
      if (message.role === 'system') { object(message, ['role', 'content', 'source', 'id']); object(message.source, ['kind']); if (message.source.kind !== 'system-prompt' || !Array.isArray(message.content) || !message.content.every((x: any) => { object(x, ['type', 'text']); return x.type === 'text' && typeof x.text === 'string' }) || sha(body(message)) !== b.staticSystem) throw new RpError('scope_denied', 'Uncertified system prompt/metadata'); systemSeen = true; continue }
      if (b.data.messageHashes[message.id] !== sha(normalizedMessage(message))) throw new RpError('scope_denied', 'Unknown or changed native history/metadata; use clean continuation')
      const snapshot = b.data.snapshots[message.id] ?? b.data.frames[message.id]
      if (snapshot) {
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
      if (policy.status(options.sessionId ?? '').mode === 'rp' || policy.status(options.sessionId ?? '').mode === 'blocked') throw new LlmError('RP session is unavailable', 'RP_ADMISSION')
      yield* next(); return
    }
    const state = policy.status(b.agent.id), release = await policy.request(b.agent.id, state.epoch)
    try { await certify(b, options); shutdown.signal.throwIfAborted(); yield* next() }
    catch (e) { throw new LlmError(e instanceof RpError ? e.code + ': ' + e.message : 'RP request blocked', 'RP_ADMISSION') }
    finally { release() }
  }) as never, { prepend: true }))
  effects.push(root.on('agent/created', (async ({ agent, source }: any) => {
    if (closed || bound.has(agent.id) || source !== 'resume') return
    try {
      const envelope = object(await readRpJson(file(agent.id)), ['data', 'sha256']); hash(envelope.sha256); if (sha(canonical(envelope.data)) !== envelope.sha256) throw new Error('RP host journal hash mismatch'); const raw = validateJournal(envelope.data)
      if (raw.schemaVersion !== 1 || raw.sessionId !== agent.id || raw.request.sessionId !== agent.id || raw.request.workspaceId !== binding.workspaceId) throw new Error('RP persisted binding identity mismatch')
      await installBound(agent, raw.request.branchId, raw, true)
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') { policy.block(agent.id); throw e } }
  }) as never))
  effects.push(root.on('agent/disposed', (({ agent }: any) => { const b = bound.get(agent.id); if (b) { b.generation++; policy.block(agent.id); bound.delete(agent.id) } }) as never))
  // Only read/status tools. They cannot reach commands, approvals, stores or grants.
  const tools: any = root.get('tools'), output = { schema: { type: 'object' as const, additionalProperties: false as const, properties: { text: { type: 'string' as const, required: true as const } } }, render: (_args: unknown, result: { text: string }) => [{ type: 'text' as const, text: result.text }] }
  effects.push(root.on('tools/execute', (async (exec: any, next: () => Promise<any>) => {
    const b = exec.agent && bound.get(exec.agent.id)
    if (!b || !['rp_memory_search', 'rp_memory_get', 'rp_memory_status'].includes(exec.name)) return next()
    const result = await next(); await drain(b)
    if (!b.packet || closed) throw new RpError('ownership_lost', 'RP tool owner disposed')
    const fence = unwrap(await memory.store.readFence(b.authority)), sources = unwrap(await memory.store.readAcceptedSources(b.authority)), events = unwrap(await memory.store.readEvents(b.authority)), globals = []
    for (const grant of globalAuthorities) globals.push(unwrap(await memory.global.store.readFence(grant)))
    const snapshot: Snapshot = { bodyHash: sha(result.content.filter((x: any) => x.type === 'text').map((x: any) => x.text).join('\n')), packetId: b.packet.id, fence, globals, globalDependencies: [...b.packet.globalDependencies], globalPolicyHash: globalPolicyHash(), dependencyIds: sources.map(s => s.id), eventIds: events.map(e => e.id), modeEpoch: policy.status(b.agent.id).modeEpoch }
    b.data.receipts[exec.callId] = { contentHash: sha(canonical(result.content)), snapshot }; await save(b); return result
  }) as never, { prepend: true }))
  for (const name of ['rp_memory_search', 'rp_memory_get', 'rp_memory_status']) {
    effects.push(tools.register(defineTool({ name, description: 'Read-only RP data. Cannot accept sources, execute commands, approve publications or grant authority.', parameters: name.endsWith('status') ? {} : name.endsWith('get') ? { id: { type: 'string' }, cursor: { type: 'string' }, maxChars: { type: 'integer' } } : { query: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer' } }, output, isConcurrencySafe: () => true,
      async execute(args: any, exec: any) { const b: Bound | undefined = exec.agent && bound.get(exec.agent.id); if (!b || !live(exec.agent) || policy.status(exec.agent.id).mode !== 'rp') throw new Error('RP read requires exact bound live caller'); await drain(b); const result = name.endsWith('status') ? { mode: 'memory', branchId: b.data.request.branchId, candidateIds: Object.values(b.data.hostSources).filter(s => !b.data.inputs.some(i => i.sourceId === s)), pendingInputIds: b.data.inputs.filter(i => !i.dispatched).map(i => i.sourceId) } : name.endsWith('get') ? await memory.retrieval.get(b.authority, args) : await memory.retrieval.search(b.authority, args); exec.signal.throwIfAborted(); return { text: canonical(result) } },
    } as any)))
  }
  return Object.freeze({ enabled: true, memory, policy,
    async ready(sessionId: string) { const b = bound.get(sessionId); if (b) await drain(b) },
    status(sessionId: string) { const b = bound.get(sessionId); return { enabled: !closed, contextCompression: false, strictPov: false, nativeVersions, policy: policy.status(sessionId), branchId: b?.data.request.branchId, candidateIds: b ? Object.values(b.data.hostSources).filter(s => !b.data.inputs.some(i => i.sourceId === s)) : [], pendingInputIds: b?.data.inputs.filter(i => i.phase === 'observed' || i.phase === 'accepted').map(i => i.sourceId), ambiguousInputIds: b?.data.inputs.filter(i => i.phase === 'dispatching').map(i => i.sourceId), snapshots: b ? Object.keys(b.data.snapshots).length : 0 } },
    async close() { if (closed) return; shutdown.abort(new Error('RP plugin disposed')); for (const b of bound.values()) { b.generation++; b.agent.cancel({ kind: 'hook', reason: 'RP owner disposed' }) }; await memory.jobs.close(); await Promise.allSettled([...bound.values()].map(async b => { await b.agent.whenIdle(); await b.queue; await policy.block(b.agent.id) })); closed = true; for (const dispose of effects.reverse()) if (typeof dispose === 'function') await dispose(); memory.retrieval.dispose(); for (const h of handles.reverse()) await h.dispose(); await lease.release() },
  })
}
export default installRpPlugin
