/** RP authority store. Only the trusted host retains `control`; tools/generators
 * receive neither it nor write handles. No production hooks are registered. */
import fs from 'node:fs/promises'
import {assertPublicationAllowed} from './publication-guard.js'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { Branch, BranchScope, BranchSourceBinding, CommitBatch, HostAuthority, InputFence, Job, LedgerSnapshot, Result, Scope, SemanticEvent, SourceObservation, SourceRevision, SourceSpan, StoredDerived, Summary, Visibility, Viewpoint, WorkspaceBinding, AuthorityChange, CanonBinding, ForkManifest, PayloadCopy, PrivacyDeletion, ProjectionResult } from './types.js'
import { RpError, batch as validateBatch, binding as validateBinding, branch as validateBranch, checkedRpJson, cloneInput, denied, failure, fence as validateFence, hash, id, hostId, integer, invalid, job as validateJob, object, observation as validateObservation, parseRecord, scope as validateScope, sourceSpan as validateSpan, text, visibility as validateVisibility, authorityChange as validateChange, wellFormed } from './schema.js'
import { reduceEvents, eventsForView } from './reducer.js'
import { checkGrowthTransition, growthValue, inheritGrowthMarks, markGrowthEvent } from './growth-format.js'
import { hasPersonOwner, markerProtocol, markSemantic, requiresPerson, semanticProtocol } from './semantic-registry.js'
import { checkPersonTransition, personValue } from './person/format.js'
export { parseRecord } from './schema.js'
/** Trusted storage adapters reuse the same verified lock/read protocol. */
export { lock as withRpWriterLock, recoverLock as recoverRpWriterLock, readJson as readRpJson }
export type * from './types.js'

const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex')
/** Order-independent object keys, order-preserving arrays; used for effects and chains. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}'
}
const digest = (v: unknown) => sha(canonical(v))
const newId = (prefix: string) => prefix + '_' + randomUUID().replaceAll('-', '')
const ok = <T>(value: T): Result<T> => { const copy = structuredClone(value); inheritGrowthMarks(value, copy); return { ok: true, value: copy } }
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)
function eventDependencies(event: SemanticEvent): string[] {
  const payload = event.payload
  const base = payload.kind === 'knowledge_change' ? [payload.claimId] : payload.kind === 'relationship_change' ? [...payload.triggerEventIds] : payload.kind === 'correction' ? [...payload.replacementEventIds] : []
  const growth = growthValue(event)
  const semantic = growth ?? personValue(event)
  return semantic ? [...new Set([...base, ...semantic.causeEventIds, ...(semantic.previousEventId ? [semantic.previousEventId] : [])])] : base
}
function authenticateEvent(event: SemanticEvent, changes: readonly AuthorityChange[]) {
  const protocol = markerProtocol(changes, event)
  if (!protocol) return
  markSemantic(event, protocol)
  if (protocol === 'agent-memory/v1') markGrowthEvent(event)
  else if (protocol === 'person-core/v1') personValue(event)
  else if (event.payload.kind !== 'occurrence' || event.epistemic !== 'world' || !['user_canon', 'explicit_ooc'].includes(event.authority) || event.supersedes.length) denied('person origin must be explicit initial definition')
}
function error(code: import('./types.js').ErrorCode, message: string): never { throw new RpError(code, message) }
const ZERO = '0'.repeat(64)
type Permission = 'read' | 'observe' | 'commit' | 'control'
export type FaultStage = 'profile_locked' | 'metadata_listed' | 'blob_written' | 'blob_synced' | 'blob_published' | 'transaction_written' | 'transaction_synced' | 'transaction_published' | 'seal_written' | 'seal_synced' | 'seal_published' | 'directory_synced'
export interface StoreOptions {
  readonly profileRoot: string
  /** Trusted filesystem fault seam; never supplied by model/tool input. */
  readonly fault?: (stage: FaultStage) => void | Promise<void>
  readonly onBlobRead?: () => void
  /** Later global-store adapter validates exact approved publication bindings. */
  readonly verifyCanonBinding?: (record: CanonBinding) => Promise<boolean>
  /** Trusted fault/diagnostic seams. Called only after the tombstone is sealed. */
  readonly beforePurge?: () => void | Promise<void>
  readonly onPurge?: (blobId: string) => void
}
export interface AuthorityRequest {
  readonly workspaceId: string; readonly campaignId: string; readonly branchId: string; readonly sessionId?: string; readonly sceneId?: string
  readonly viewpoint: Viewpoint; readonly visibility: Visibility; readonly audienceSetIds: readonly string[]; readonly permissions: readonly Permission[]
}
/** Operation-local data; readSource closes when the callback settles. */
export interface RpReadView {
  readonly context: {readonly sceneId?:string;readonly acceptedSeq:number}
  readonly fence: InputFence
  readonly events: readonly SemanticEvent[]
  readonly summaries: readonly Summary[]
  readonly projection: ProjectionResult
  readonly sources: readonly SourceRevision[]
  readonly ledger: LedgerSnapshot | null
  readSource(span: SourceSpan): Promise<string>
}
interface DirectoryIdentity { readonly dev: string; readonly ino: string; readonly birthtime: string }
interface RootBinding extends WorkspaceBinding { readonly root: string; readonly directoryIdentity: DirectoryIdentity; readonly markerNonce: string }
interface Grant { readonly request: AuthorityRequest; readonly migrationRevision: number }
type Derived = StoredDerived & { readonly metadata: Record<string, unknown> }
interface BranchState {
  branch: Branch; fence: InputFence; bindings: Map<string, BranchSourceBinding>; records: Map<string, Derived>; jobs: Map<string, Job>
  changes: AuthorityChange[]; invalidated: Set<string>
}
type Operation = { readonly kind: 'branch'; readonly branch: Branch; readonly fence: InputFence }
  | { readonly kind: 'job'; readonly branchId: string; readonly expected: Job | null; readonly next: Job }
  | { readonly kind: 'fork'; readonly branch: Branch; readonly fence: InputFence; readonly parentBranchId: string; readonly parentRevision: number }
  | { readonly kind: 'source'; readonly source: SourceRevision }
  | { readonly kind: 'copy'; readonly copy: PayloadCopy }
  | { readonly kind: 'privacy'; readonly deletion: PrivacyDeletion; readonly controlSourceId: string; readonly initiatorBranchId: string; readonly heads: readonly { readonly branchId: string; readonly expected: InputFence; readonly result: InputFence; readonly sourceBindings: readonly BranchSourceBinding[] }[] }
  | { readonly kind: 'purged'; readonly operationId: string }
  | { readonly kind: 'commit'; readonly branchId: string; readonly expected: InputFence; readonly result: InputFence
    readonly sourceBindings: readonly BranchSourceBinding[]; readonly records: readonly Derived[]; readonly jobs: readonly Job[]
    readonly invalidatedIds: readonly string[]; readonly authorityChanges: readonly AuthorityChange[]; readonly expectedJobs?: readonly Job[] }
interface Transaction {
  readonly schemaVersion: 1; readonly workspaceId: string; readonly sequence: number; readonly previousHash: string
  readonly idempotencyKey: string; readonly effectHash: string; readonly operation: Operation
  readonly requiredCapabilities?: readonly string[]
}
interface WorkspaceState { sources: Map<string, SourceRevision>; branches: Map<string, BranchState>; transactions: Transaction[]; hashes: string[]; copies: Map<string, PayloadCopy>; privacy: Map<string, PrivacyDeletion>; requiredCapabilities: string[] }
const emptyState = (): WorkspaceState => ({ sources: new Map(), branches: new Map(), transactions: [], hashes: [], copies: new Map(), privacy: new Map(), requiredCapabilities: [] })
const queues = new Map<string, Promise<unknown>>()
async function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
  const prior = queues.get(key) ?? Promise.resolve()
  const run = prior.catch(() => {}).then(work)
  queues.set(key, run)
  try { return await run } finally { if (queues.get(key) === run) queues.delete(key) }
}
async function directoryIdentity(root: string): Promise<DirectoryIdentity> {
  const stat = await fs.lstat(root, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino === 0n) denied('directory identity unavailable')
  return { dev: String(stat.dev), ino: String(stat.ino), birthtime: String(stat.birthtimeNs) }
}
async function realDirectory(root: string): Promise<string> {
  text(root, 32768)
  const absolute = path.resolve(root), real = await fs.realpath(absolute)
  // Junctions and aliases cannot silently introduce a second authority root.
  if (path.normalize(real).toLowerCase() !== path.normalize(absolute).toLowerCase()) denied('root alias')
  await directoryIdentity(real)
  return real
}
async function readJson(file: string, max = 8388608): Promise<unknown> {
  const stat = await fs.lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max) error('store_corrupt', 'RP invalid metadata file')
  try { return cloneInput(JSON.parse(await fs.readFile(file, 'utf8'))) } catch (cause) { error('store_corrupt', 'RP corrupt metadata: ' + (cause instanceof Error ? cause.message : 'JSON')) }
}
async function lock<T>(directory: string, work: () => Promise<T>): Promise<T> {
  return serial(directory, async () => {
    const lockPath = path.join(directory, 'write.lock')
    try { await fs.mkdir(lockPath) } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') error('store_locked', 'RP writer lock exists; stale-lock recovery requires explicit verified coordination')
      throw cause
    }
    const token = randomUUID()
    try {
      await fs.writeFile(path.join(lockPath, 'owner.json'), canonical({ token, pid: process.pid, createdAt: new Date().toISOString() }), { flag: 'wx' })
      return await work()
    } finally {
      // Never remove another owner's lock, and never steal by PID/age/timeout.
      try { const owner = JSON.parse(await fs.readFile(path.join(lockPath, 'owner.json'), 'utf8')); if (owner.token === token) { await fs.unlink(path.join(lockPath, 'owner.json')); await fs.rmdir(lockPath) } } catch { /* leave ambiguous ownership blocked */ }
    }
  })
}
/** Caller is a trusted host control. Never accept paths from model tools. */
async function recoverLock(directory: string): Promise<'recovered' | 'unlocked'> {
  const lockPath = path.join(directory, 'write.lock')
  let owner: Record<string, any>
  try { owner = object(await readJson(path.join(lockPath, 'owner.json')), ['token', 'pid', 'createdAt']) }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      try { await fs.lstat(lockPath); error('store_locked', 'RP lock owner evidence is incomplete') }
      catch (missing) { if ((missing as NodeJS.ErrnoException).code === 'ENOENT') return 'unlocked'; throw missing }
    }
    throw cause
  }
  text(owner.token, 64); integer(owner.pid, 1); text(owner.createdAt, 64)
  if (!/^[a-f0-9-]{36}$/u.test(owner.token) || !Number.isFinite(Date.parse(owner.createdAt))) error('store_locked', 'RP lock evidence invalid')
  try { process.kill(owner.pid, 0); error('store_locked', 'RP writer process still exists') }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') { if (cause instanceof RpError) throw cause; error('store_locked', 'RP writer death cannot be verified') } }
  if (!same(await readJson(path.join(lockPath, 'owner.json')), owner)) error('store_locked', 'RP lock changed during recovery')
  await fs.rename(lockPath, path.join(directory, 'recovered-lock-' + owner.token))
  return 'recovered'
}

export class RpStore {
  readonly #grants = new WeakMap<object, Grant>()
  readonly #snapshots = new WeakMap<object, { authority: HostAuthority; span: SourceSpan; bodySha256: string; snapshotId: string }>()
  readonly #options: StoreOptions
  // Scoped to one verified load, never reused across disk reads or authorities.
  // Sequence bounds prevent a nested prefix replay from borrowing a future state.
  readonly #history = new WeakMap<WorkspaceState, Map<string, { sequence: number; branch: BranchState }>>()
  readonly #root: string
  readonly #profileRoot: string
  readonly #profileId: string
  readonly #profileIdentity: DirectoryIdentity
  #directorySync: 'supported' | 'unsupported' | 'unverified' = 'unverified'
  constructor(options: StoreOptions, root: string, profileRoot: string, profileId: string, profileIdentity: DirectoryIdentity) {
    this.#options = options; this.#root = root; this.#profileRoot = profileRoot; this.#profileId = profileId; this.#profileIdentity = profileIdentity
  }
  /** Only platform-level durability evidence; a successful file fsync is not a power-loss guarantee. */
  durability(): { fileSync: 'required'; directorySync: 'supported' | 'unsupported' | 'unverified'; powerLossVerified: false } {
    return { fileSync: 'required', directorySync: this.#directorySync, powerLossVerified: false }
  }
  #workspacePath(workspaceId: string): string { id(workspaceId); return path.join(this.#root, 'workspaces', workspaceId) }
  async #profileCheck(): Promise<void> {
    if (!same(await directoryIdentity(this.#profileRoot), this.#profileIdentity)) denied('profile directory changed')
    const p = object(await readJson(path.join(this.#root, 'identity.json')), ['schemaVersion', 'profileId', 'rootHash', 'directoryIdentity'])
    if (p.schemaVersion !== 1 || p.profileId !== this.#profileId || p.rootHash !== sha(this.#profileRoot) || !same(p.directoryIdentity, this.#profileIdentity)) denied('profile identity changed')
  }
  async #syncDirectory(directory: string): Promise<void> {
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined
    try { handle = await fs.open(directory, 'r'); await handle.sync(); this.#directorySync = 'supported' }
    catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code
      if (process.platform === 'win32' && ['EPERM', 'EACCES', 'EISDIR', 'EINVAL', 'ENOTSUP'].includes(code ?? '')) this.#directorySync = 'unsupported'
      else throw cause
    } finally { await handle?.close() }
  }
  async #publish(file: string, body: string | Buffer, kind: 'blob' | 'transaction' | 'seal', useFault = true, seal?: () => Promise<void>): Promise<void> {
    const temporary = file + '.tmp-' + randomUUID()
    let published = false, handle: Awaited<ReturnType<typeof fs.open>> | undefined
    try {
      if(kind!=='seal')assertPublicationAllowed()
      handle = await fs.open(temporary, 'wx')
      await handle.writeFile(body)
      if (useFault) await this.#options.fault?.(kind === 'blob' ? 'blob_written' : kind === 'seal' ? 'seal_written' : 'transaction_written')
      await handle.sync()
      if (useFault) await this.#options.fault?.(kind === 'blob' ? 'blob_synced' : kind === 'seal' ? 'seal_synced' : 'transaction_synced')
      await handle.close(); handle = undefined
      // The workspace lock serializes destination assignment. Never overwrite an
      // existing immutable commit even on POSIX where rename permits it.
      try { await fs.lstat(file); error('store_corrupt', 'RP immutable destination already exists') } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause }
      if(kind!=='seal')assertPublicationAllowed()
      await fs.rename(temporary, file); published = true
      // An independent immutable receipt detects single-file tail loss. A crash
      // before the receipt still leaves a valid, unacknowledged transaction;
      // subsequent writers seal it before appending any further effect.
      await seal?.()
      if (useFault) await this.#options.fault?.(kind === 'blob' ? 'blob_published' : kind === 'seal' ? 'seal_published' : 'transaction_published')
      await this.#syncDirectory(path.dirname(file))
      if (useFault && kind === 'transaction') await this.#options.fault?.('directory_synced')
    } catch (cause) {
      // Preserve the first exception and publication ambiguity in the result.
      if (published && kind === 'transaction') error('persistence_uncertain', cause instanceof Error ? cause.message : String(cause))
      if (cause instanceof RpError) throw cause
      error(published && kind === 'transaction' ? 'persistence_uncertain' : 'persistence_failed', (cause instanceof Error ? cause.message : String(cause)))
    } finally { try { await handle?.close() } catch { /* keep original error */ } }
  }
  async #rootBinding(workspaceId: string, checkLocation = true): Promise<RootBinding> {
    const directory = path.join(this.#workspacePath(workspaceId), 'bindings')
    const files = (await fs.readdir(directory)).filter(name => /^\d{16}\.json$/u.test(name)).sort()
    if (!files.length) denied('unknown workspace')
    let previous = ZERO, latest: RootBinding | undefined
    for (let i = 0; i < files.length; i++) {
      if (files[i] !== String(i).padStart(16, '0') + '.json') error('store_corrupt', 'RP missing root-binding revision')
      const envelope = object(await readJson(path.join(directory, files[i])), ['binding', 'previousHash', 'sha256'])
      if (envelope.previousHash !== previous || envelope.sha256 !== digest(envelope.binding)) error('store_corrupt', 'RP root-binding checksum')
      const b = object(envelope.binding, ['workspaceId', 'profileId', 'canonicalRootHash', 'migrationRevision', 'root', 'directoryIdentity', 'markerNonce'])
      id(b.workspaceId); id(b.profileId); hash(b.canonicalRootHash); integer(b.migrationRevision); text(b.root, 32768); id(b.markerNonce)
      const d = object(b.directoryIdentity, ['dev', 'ino', 'birthtime']); for (const value of Object.values(d)) if (typeof value !== 'string' || !/^\d+$/u.test(value)) invalid('directory fingerprint')
      if (b.workspaceId !== workspaceId || b.profileId !== this.#profileId || b.migrationRevision !== i || b.canonicalRootHash !== sha(b.root)) error('store_corrupt', 'RP root binding identity')
      if (latest && (!same(latest.directoryIdentity, b.directoryIdentity) || latest.markerNonce !== b.markerNonce)) error('store_corrupt', 'RP migration identity changed')
      latest = b as RootBinding; previous = envelope.sha256
    }
    if (checkLocation) await this.#checkLocation(latest!)
    return latest!
  }
  async #checkLocation(binding: RootBinding): Promise<void> {
    try {
      const real = await realDirectory(binding.root)
      if (real !== binding.root || !same(await directoryIdentity(real), binding.directoryIdentity)) denied('workspace directory replaced')
      const marker = object(await readJson(path.join(real, '.dsh-rp-workspace.json')), ['schemaVersion', 'profileId', 'workspaceId', 'nonce'])
      if (marker.schemaVersion !== 1 || marker.profileId !== this.#profileId || marker.workspaceId !== binding.workspaceId || marker.nonce !== binding.markerNonce) denied('workspace marker changed')
    } catch (cause) { if (cause instanceof RpError && cause.code === 'scope_denied') throw cause; denied('workspace identity unavailable') }
  }
  async #authorize(authority: HostAuthority, permission: Permission, checkLocation = true): Promise<{ grant: Grant; root: RootBinding }> {
    const grant = authority && typeof authority === 'object' ? this.#grants.get(authority) : undefined
    if (!grant || !grant.request.permissions.includes(permission)) denied('unrecognized or insufficient host handle')
    await this.#profileCheck()
    const root = await this.#rootBinding(grant.request.workspaceId, checkLocation)
    if (root.migrationRevision !== grant.migrationRevision) denied('workspace authority revoked by migration')
    return { grant, root }
  }
  #scopeMatches(scope: Scope, request: AuthorityRequest): boolean {
    return (scope.kind === 'branch' || scope.kind === 'session') && scope.workspaceId === request.workspaceId && scope.campaignId === request.campaignId
  }
  #visible(value: Visibility, request: AuthorityRequest): boolean {
    return value.policyId === request.visibility.policyId && value.revision <= request.visibility.revision && request.audienceSetIds.includes(value.audienceSetId)
  }
  #branch(state: WorkspaceState, request: AuthorityRequest): BranchState {
    const branch = state.branches.get(request.branchId)
    if (!branch || branch.branch.workspaceId !== request.workspaceId || branch.branch.campaignId !== request.campaignId) denied('branch scope')
    if (branch.fence.visibilityRevision !== request.visibility.revision) denied('visibility authorization changed')
    return branch
  }
  #validateDerived(input: unknown): asserts input is Derived {
    const r = object(input, ['id', 'kind', 'blobId', 'bodySha256', 'scope', 'sourceRevisionIds', 'dependencyIds', 'visibility', 'policyVersion', 'active', 'metadata'])
    id(r.id); id(r.blobId); hash(r.bodySha256); validateScope(r.scope); validateVisibility(r.visibility); text(r.policyVersion, 128)
    for (const name of ['sourceRevisionIds', 'dependencyIds']) { if (!Array.isArray(r[name]) || r[name].length > 2048) invalid('derived references'); r[name].forEach(id); if (new Set(r[name]).size !== r[name].length) invalid('duplicate derived references') }
    if (typeof r.active !== 'boolean') invalid('derived validity')
    const fields = r.kind === 'event' ? ['schemaVersion', 'id', 'scope', 'acceptedSeq', 'epistemic', 'authority', 'sources', 'visibility', 'supersedes', 'policyVersion'] : r.kind === 'summary' ? ['schemaVersion', 'id', 'scope', 'level', 'createdFrom', 'sourceRevisionIds', 'dependencySummaryIds', 'supportEventIds', 'exactAnchors', 'visibility', 'policyVersion', 'measuredTokens', 'tokenMeasurement'] : invalid('derived kind')
    const metadata = object(r.metadata, fields, r.kind === 'event' ? ['beliefHolderId'] : [])
    const parsed = parseRecord({ kind: r.kind, record: r.kind === 'event' ? { ...metadata, payload: { kind: 'occurrence', actorIds: ['validation_actor'], description: '_' }, fictionalTime: null } : { ...metadata, text: '_' } })
    if (!parsed.ok) invalid('derived metadata schema')
    const sourceIds = r.kind === 'event' ? [...new Set((metadata.sources as SourceSpan[]).map(span => span.sourceRevisionId))] : metadata.sourceRevisionIds
    const deps = r.kind === 'summary' ? [...metadata.dependencySummaryIds, ...metadata.supportEventIds] : undefined
    if (metadata.id !== r.id || !same(metadata.scope, r.scope) || !same(metadata.visibility, r.visibility) || metadata.policyVersion !== r.policyVersion || !same(sourceIds, r.sourceRevisionIds) || (deps && !same(deps, r.dependencyIds))) invalid('derived metadata mismatch')
  }
  #validateOperation(input: unknown): asserts input is Operation {
    const kind = (input as any)?.kind
    if (kind === 'job') { const r = object(input, ['kind', 'branchId', 'expected', 'next']); id(r.branchId); if (r.expected !== null) validateJob(r.expected); validateJob(r.next) }
    else if (kind === 'branch') { const r = object(input, ['kind', 'branch', 'fence']); validateBranch(r.branch); validateFence(r.fence) }
    else if (kind === 'fork') { const r = object(input, ['kind', 'branch', 'fence', 'parentBranchId', 'parentRevision']); validateBranch(r.branch); validateFence(r.fence); id(r.parentBranchId); integer(r.parentRevision) }
    else if (kind === 'source') { const r = object(input, ['kind', 'source']); const result = parseRecord({ kind: 'source', record: r.source }); if (!result.ok) invalid('source disk record') }
    else if (kind === 'copy') {
      const r = object(input, ['kind', 'copy']), c = object(r.copy, ['id', 'kind', 'branchId', 'sourceRevisionIds', 'dependencyIds', 'visibility', 'blobId', 'bodySha256'])
      id(c.id); id(c.branchId); id(c.blobId); hash(c.bodySha256); validateVisibility(c.visibility)
      if (!['projection', 'scene', 'chapter', 'cache', 'job_input', 'archive', 'snapshot', 'index'].includes(c.kind) || c.blobId !== 'blob_' + c.bodySha256) invalid('managed copy')
      for (const list of [c.sourceRevisionIds, c.dependencyIds]) { if (!Array.isArray(list) || list.length > 2048 || new Set(list).size !== list.length) invalid('copy dependencies'); list.forEach(id) }
      if (!c.sourceRevisionIds.length) invalid('copy source coverage')
    } else if (kind === 'privacy') {
      const r = object(input, ['kind', 'deletion', 'controlSourceId', 'initiatorBranchId', 'heads']); id(r.controlSourceId); id(r.initiatorBranchId)
      const d = object(r.deletion, ['operationId', 'sourceRevisionIds', 'affectedBranchIds', 'blockedDerivedIds', 'blobIds', 'purgeState', 'externalLimitations']); text(d.operationId, 256)
      for (const list of [d.sourceRevisionIds, d.affectedBranchIds, d.blockedDerivedIds, d.blobIds]) { if (!Array.isArray(list) || list.length > 4096 || new Set(list).size !== list.length) invalid('privacy IDs'); list.forEach(id) }
      if (d.purgeState !== 'blocked' || !Array.isArray(d.externalLimitations)) invalid('privacy state'); d.externalLimitations.forEach((v: unknown) => text(v, 1024))
      if (!Array.isArray(r.heads) || r.heads.length !== d.affectedBranchIds.length) invalid('privacy heads')
      for (const head of r.heads) { const h = object(head, ['branchId', 'expected', 'result', 'sourceBindings']); id(h.branchId); validateFence(h.expected); validateFence(h.result); if (!Array.isArray(h.sourceBindings)) invalid('privacy bindings'); h.sourceBindings.forEach(validateBinding) }
    } else if (kind === 'purged') { const r = object(input, ['kind', 'operationId']); text(r.operationId, 256) }
    else if (kind === 'commit') {
      const r = object(input, ['kind', 'branchId', 'expected', 'result', 'sourceBindings', 'records', 'jobs', 'invalidatedIds', 'authorityChanges'], ['expectedJobs']); id(r.branchId); validateFence(r.expected); validateFence(r.result)
      if (r.expectedJobs !== undefined) { if (!Array.isArray(r.expectedJobs)) invalid('expected jobs'); r.expectedJobs.forEach(validateJob) }
      for (const [key, validator] of [['sourceBindings', validateBinding], ['records', (v: unknown) => this.#validateDerived(v)], ['jobs', validateJob], ['invalidatedIds', id], ['authorityChanges', validateChange]] as const) {
        if (!Array.isArray(r[key]) || r[key].length > 4096) invalid('operation list'); r[key].forEach(validator)
      }
    } else invalid('operation kind')
  }
  async #load(workspaceId: string): Promise<WorkspaceState> {
    const directory = path.join(this.#workspacePath(workspaceId), 'commits'), sealDirectory = path.join(this.#workspacePath(workspaceId), 'seals')
    const initialSeals = (await fs.readdir(sealDirectory)).filter(file => !file.includes('.tmp-')).sort()
    const files = await fs.readdir(directory)
    await this.#options.fault?.('metadata_listed')
    const state = emptyState(), effects = new Set<string>()
    for (const file of files.sort()) {
      if (file.includes('.tmp-')) continue
      if (!/^\d{16}\.json$/u.test(file) || file !== String(state.transactions.length + 1).padStart(16, '0') + '.json') error('store_corrupt', 'RP transaction sequence gap')
      try {
        const envelope = object(await readJson(path.join(directory, file)), ['transaction', 'sha256']); hash(envelope.sha256)
        const tx = object(envelope.transaction, ['schemaVersion', 'workspaceId', 'sequence', 'previousHash', 'idempotencyKey', 'effectHash', 'operation'], ['requiredCapabilities'])
        if (tx.schemaVersion !== 1 || tx.workspaceId !== workspaceId || tx.sequence !== state.transactions.length + 1 || tx.previousHash !== (state.hashes.at(-1) ?? ZERO) || envelope.sha256 !== digest(tx)) invalid('transaction chain')
        text(tx.idempotencyKey, 512); hash(tx.effectHash); this.#validateOperation(tx.operation)
        const caps = tx.requiredCapabilities ?? []
        if (!Array.isArray(caps) || caps.some(c => c !== 'rp.person-core/v1')) error('capability_missing', 'Unsupported workspace reader capability')
        if (!same(caps, [...new Set(caps)].sort()) || state.requiredCapabilities.some(c => !caps.includes(c)) || (tx.operation.kind === 'commit' && requiresPerson(tx.operation.authorityChanges) && !caps.includes('rp.person-core/v1'))) invalid('workspace capability regression or missing person barrier')
        state.requiredCapabilities = caps
        if (effects.has(tx.idempotencyKey)) invalid('duplicate transaction effect')
        this.#apply(state, tx.operation)
        effects.add(tx.idempotencyKey)
        state.transactions.push(tx as Transaction); state.hashes.push(envelope.sha256)
      } catch (cause) { if (cause instanceof RpError && cause.code === 'capability_missing') throw cause; error('store_corrupt', 'RP transaction corruption: ' + (cause instanceof Error ? cause.message : 'invalid record')) }
    }
    const seals = (await fs.readdir(sealDirectory)).filter(file => !file.includes('.tmp-')).sort()
    if (!same(initialSeals, seals)) error('stale_input', 'RP transaction snapshot changed during read')
    for (let i = 0; i < seals.length; i++) {
      if (seals[i] !== String(i + 1).padStart(16, '0') + '.json') error('store_corrupt', 'RP missing publication seal')
      const seal = object(await readJson(path.join(this.#workspacePath(workspaceId), 'seals', seals[i])), ['schemaVersion', 'sequence', 'transactionHash'])
      if (seal.schemaVersion !== 1 || seal.sequence !== i + 1 || seal.transactionHash !== state.hashes[i]) error('store_corrupt', 'RP published transaction missing or mismatched')
    }
    if (state.transactions.length > seals.length + 1) error('store_corrupt', 'RP unsealed transaction chain')
    return state
  }
  #apply(state: WorkspaceState, operation: Operation): void {
    if (operation.kind === 'branch') {
      if (state.branches.has(operation.branch.id) || operation.branch.contextRevision !== 0 || operation.fence.contextRevision !== 0 || operation.fence.branchId !== operation.branch.id) invalid('branch creation')
      state.branches.set(operation.branch.id, { branch: operation.branch, fence: operation.fence, bindings: new Map(), records: new Map(), jobs: new Map(), changes: [], invalidated: new Set() })
    } else if (operation.kind === 'fork') {
      if (state.branches.has(operation.branch.id)) invalid('fork identity')
      const parent = this.#historical(state, operation.parentBranchId, operation.parentRevision)
      if (operation.branch.parent?.prefixManifestHash !== this.#manifest(parent) || operation.branch.parent?.validityManifestHash !== this.#validityManifest(parent)) invalid('fork validity manifest')
      const fork: BranchState = { ...structuredClone(parent), branch: operation.branch, fence: operation.fence, jobs: new Map(), bindings: new Map([...parent.bindings].map(([id, b]) => [id, { ...b, branchId: operation.branch.id }])) }
      state.branches.set(operation.branch.id, fork)
    } else if (operation.kind === 'job') {
      const branch = state.branches.get(operation.branchId); if (!branch) invalid('job branch')
      this.#checkJobTransition(branch, operation.expected, operation.next)
      branch.jobs.set(operation.next.id, operation.next)
    } else if (operation.kind === 'source') {
      if (state.sources.has(operation.source.id)) invalid('source overwrite')
      state.sources.set(operation.source.id, operation.source)
    } else if (operation.kind === 'copy') {
      if (state.copies.has(operation.copy.id) || !state.branches.has(operation.copy.branchId)) invalid('copy identity')
      state.copies.set(operation.copy.id, operation.copy)
    } else if (operation.kind === 'privacy') {
      if (state.privacy.has(operation.deletion.operationId)) invalid('privacy identity')
      for (const head of operation.heads) {
        const branch = state.branches.get(head.branchId)
        if (!branch || !same(branch.fence, head.expected) || head.result.contextRevision !== head.expected.contextRevision + 1 || head.result.deletionGeneration !== head.expected.deletionGeneration + 1) invalid('privacy fence')
        head.sourceBindings.forEach(b => branch.bindings.set(b.sourceRevisionId, b))
        if (this.#manifest(branch) !== head.result.sourceManifestHash) invalid('privacy manifest')
        branch.changes.push({ kind: 'deletion', recordId: 'deletion_' + sha(operation.deletion.operationId).slice(0, 40), record: { id: 'deletion_' + sha(operation.deletion.operationId).slice(0, 40), generation: head.result.deletionGeneration,
          scope: { kind: 'branch', workspaceId: branch.branch.workspaceId, campaignId: branch.branch.campaignId, branchId: branch.branch.id },
          sourceRevisionIds: operation.deletion.sourceRevisionIds.filter(id => { const source = state.sources.get(id); return branch.bindings.has(id) || ((source?.scope.kind === 'branch' || source?.scope.kind === 'session') && source.scope.branchId === branch.branch.id) }),
          blockedDerivedIds: operation.deletion.blockedDerivedIds.filter(id => branch.records.has(id) || state.copies.get(id)?.branchId === branch.branch.id), purgeState: 'blocked', externalLimitations: operation.deletion.externalLimitations } })
        branch.fence = head.result; branch.branch = { ...branch.branch, contextRevision: head.result.contextRevision, activeSourceManifestHash: head.result.sourceManifestHash }
      }
      state.privacy.set(operation.deletion.operationId, operation.deletion)
    } else if (operation.kind === 'purged') {
      const deletion = state.privacy.get(operation.operationId)
      if (!deletion) invalid('purge without tombstone')
      state.privacy.set(operation.operationId, { ...deletion, purgeState: 'complete' })
    } else {
      const branch = state.branches.get(operation.branchId)
      if (!branch || !same(branch.fence, operation.expected) || operation.result.contextRevision !== branch.fence.contextRevision + 1) invalid('replay fence')
      for (const change of operation.authorityChanges) if (change.kind === 'branch_parent') {
        const parent = this.#historical(state, change.record.branchId, change.record.contextRevision)
        branch.bindings = new Map([...parent.bindings].map(([id, b]) => [id, { ...b, branchId: branch.branch.id }]))
        branch.records = structuredClone(parent.records); branch.invalidated = structuredClone(parent.invalidated); branch.changes = structuredClone(parent.changes)
      }
      for (const binding of operation.sourceBindings) { if (!state.sources.has(binding.sourceRevisionId) || binding.branchId !== branch.branch.id) invalid('dangling binding'); branch.bindings.set(binding.sourceRevisionId, binding); if (binding.disposition === 'accepted') branch.invalidated.delete(binding.sourceRevisionId) }
      for (const record of operation.records) { if (branch.records.has(record.id) || record.sourceRevisionIds.some(s => !state.sources.has(s))) invalid('derived identity/references'); branch.records.set(record.id, record) }
      for (const job of operation.jobs) {
        if (branch.jobs.has(job.id)) { const expected = operation.expectedJobs?.find(j => j.id === job.id); if (!expected) invalid('job expected state'); this.#checkJobTransition(branch, expected, job, true) }
        branch.jobs.set(job.id, job)
      }
      operation.invalidatedIds.forEach(id => branch.invalidated.add(id)); branch.changes.push(...operation.authorityChanges)
      for (const change of operation.authorityChanges) if (change.kind === 'branch_parent') branch.branch = { ...branch.branch, parent: { branchId: change.record.branchId, contextRevision: change.record.contextRevision, prefixManifestHash: change.record.prefixManifestHash, validityManifestHash: this.#validityManifest(this.#historical(state, change.record.branchId, change.record.contextRevision)) } }
      branch.fence = operation.result
      branch.branch = { ...branch.branch, contextRevision: operation.result.contextRevision, activeSourceManifestHash: operation.result.sourceManifestHash, canonBindingsHash: operation.result.canonBindingsHash }
      if (this.#manifest(branch) !== operation.result.sourceManifestHash) invalid('source manifest mismatch')
    }
  }
  #manifest(branch: BranchState): string { return digest([...branch.bindings.values()].filter(v => v.disposition === 'accepted').sort((a, b) => a.acceptedSeq! - b.acceptedSeq! || a.sourceRevisionId.localeCompare(b.sourceRevisionId))) }
  #validityManifest(branch: BranchState): string { return digest({ branch: branch.branch, fence: branch.fence, bindings: [...branch.bindings.values()], records: [...this.#activeRecords(branch).values()], invalidated: [...branch.invalidated].sort(), changes: branch.changes }) }
  #workspaceDeleted(state: WorkspaceState): Set<string> { return new Set([...state.privacy.values()].flatMap(d => d.sourceRevisionIds)) }
  #deletedHashes(state: WorkspaceState): Set<string> { return new Set([...this.#workspaceDeleted(state)].map(id => state.sources.get(id)?.publicTextSha256).filter((h): h is string => !!h)) }
  #assertPayloadAvailable(state: WorkspaceState, bodySha256: string): void { if ([...state.privacy.values()].some(d => d.blobIds.includes('blob_' + bodySha256))) error('source_unavailable', 'RP deleted payload cannot be published again') }
  #deleted(branch: BranchState): Set<string> { return new Set(branch.changes.flatMap(change => change.kind === 'deletion' ? [...change.record.sourceRevisionIds, ...change.record.blockedDerivedIds] : [])) }
  #activeRecords(branch: BranchState): Map<string, Derived> {
    const blocked = new Set([...branch.invalidated, ...this.#deleted(branch)])
    for (const binding of branch.bindings.values()) if (binding.disposition !== 'accepted') blocked.add(binding.sourceRevisionId)
    for (const r of branch.records.values()) if (r.kind === 'summary' && (r.policyVersion !== branch.fence.policyVersion || (r.metadata.createdFrom as InputFence).canonBindingsHash !== branch.fence.canonBindingsHash || (r.metadata.createdFrom as InputFence).visibilityRevision !== branch.fence.visibilityRevision)) blocked.add(r.id)
    let changed = true
    while (changed) { changed = false; for (const r of branch.records.values()) if (!blocked.has(r.id) && (!r.active || r.sourceRevisionIds.some(id => blocked.has(id) || branch.bindings.get(id)?.disposition !== 'accepted') || r.dependencyIds.some(id => blocked.has(id) || !branch.records.has(id)))) { blocked.add(r.id); changed = true } }
    return new Map([...branch.records].map(([id, r]) => [id, { ...r, active: !blocked.has(id) }]))
  }
  async #append(workspaceId: string, state: WorkspaceState, key: string, effectHash: string, operation: Operation, useFault = true, publishPayloads?: () => Promise<void>): Promise<void> {
    const caps = [...new Set([...state.requiredCapabilities, ...(operation.kind === 'commit' && requiresPerson(operation.authorityChanges) ? ['rp.person-core/v1'] : [])])].sort()
    const transaction: Transaction = { schemaVersion: 1, workspaceId, sequence: state.transactions.length + 1, previousHash: state.hashes.at(-1) ?? ZERO, idempotencyKey: key, effectHash, operation, ...(caps.length ? { requiredCapabilities: caps } : {}) }
    this.#validateOperation(operation)
    // Run the same metadata replay validator before publishing.
    const copy: WorkspaceState = structuredClone(state); this.#apply(copy, operation)
    const encoded = checkedRpJson({ transaction, sha256: digest(transaction) }, canonical)
    const file = path.join(this.#workspacePath(workspaceId), 'commits', String(transaction.sequence).padStart(16, '0') + '.json')
    // Complete the durable receipt for a prior interrupted publication first.
    if (state.transactions.length) await this.#seal(workspaceId, state.transactions.length, state.hashes.at(-1)!)
    if (caps.some(c => !state.requiredCapabilities.includes(c))) await this.#backupBeforeCapabilities(workspaceId, state)
    await publishPayloads?.()
    await this.#publish(file, encoded, 'transaction', useFault,
      () => this.#seal(workspaceId, transaction.sequence, digest(transaction), useFault))
  }
  /** Caller holds workspace writer lock. Backup payloads are deliberately outside
   * immutable audit metadata and are disclosed as separately managed copies. */
  async #backupBeforeCapabilities(workspaceId: string, state: WorkspaceState): Promise<void> {
    try {
      const binding = await this.#rootBinding(workspaceId), directory = path.join(this.#root, 'backups', workspaceId, newId('backup'))
      await fs.mkdir(directory, { recursive: true })
      const files: { path: string; sha256: string; bytes: number }[] = [], originals: { source: string; hash: string }[] = []
      const copy = async (source: string, relative: string) => {
        const stat = await fs.lstat(source); if (!stat.isFile() || stat.isSymbolicLink()) denied('backup requires regular source files')
        const bytes = await fs.readFile(source), target = path.join(directory, relative)
        await fs.mkdir(path.dirname(target), { recursive: true }); await this.#publish(target, bytes, 'blob', false)
        const checksum = sha(bytes); if (sha(await fs.readFile(target)) !== checksum) error('persistence_failed', 'Backup verification mismatch')
        files.push({ path: relative, sha256: checksum, bytes: bytes.length }); originals.push({ source, hash: checksum })
      }
      await copy(path.join(this.#root, 'identity.json'), 'profile/identity.json')
      await copy(path.join(binding.root, '.dsh-rp-workspace.json'), 'project/.dsh-rp-workspace.json')
      for (const folder of ['bindings', 'commits', 'seals', 'blobs']) {
        const from = path.join(this.#workspacePath(workspaceId), folder)
        for (const file of (await fs.readdir(from)).sort()) if (!file.includes('.tmp-')) await copy(path.join(from, file), 'workspace/'+folder+'/'+file)
      }
      const host = path.join(this.#root, 'host'), hostFiles = await fs.readdir(host).catch(e => { if (e.code === 'ENOENT') return []; throw e })
      for (const file of hostFiles) if (file.endsWith('.json')) {
        const source = path.join(host, file), body = await readJson(source)
        if ((body as { data?: { request?: { workspaceId?: string } } }).data?.request?.workspaceId === workspaceId) await copy(source, 'host/'+file)
      }
      // Host journal writes use a separate queue. Reject changing snapshots;
      // never label a best-effort mixed backup complete.
      for (const original of originals) if (sha(await fs.readFile(original.source)) !== original.hash) error('persistence_failed', 'Backup source changed; retry after host is idle')
      if (!same(hostFiles.sort(), (await fs.readdir(host).catch(e => { if (e.code === 'ENOENT') return []; throw e })).sort())) error('persistence_failed', 'Backup host journal set changed')
      await this.#publish(path.join(directory, 'manifest.json'), canonical({ schemaVersion: 1, workspaceId, profileId: this.#profileId, sequence: state.transactions.length, headHash: state.hashes.at(-1) ?? ZERO, requiredCapabilities: state.requiredCapabilities, files, restore: 'Stop all writers; restore the complete workspace plus matching host journal set at the original verified roots. Do not remove individual transactions to downgrade.' }), 'blob', false)
      await this.#syncDirectory(directory)
    } catch (cause) { if (cause instanceof RpError) throw cause; error('persistence_failed', 'Person pre-upgrade backup failed: ' + (cause instanceof Error ? cause.message : String(cause))) }
  }
  async #seal(workspaceId: string, sequence: number, transactionHash: string, useFault = false): Promise<void> {
    const file = path.join(this.#workspacePath(workspaceId), 'seals', String(sequence).padStart(16, '0') + '.json')
    const body = { schemaVersion: 1, sequence, transactionHash }
    try { if (!same(await readJson(file), body)) error('store_corrupt', 'RP publication seal mismatch') }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; await this.#publish(file, canonical(body), 'seal', useFault) }
  }
  async #confirmPublished(workspaceId: string, state: WorkspaceState): Promise<void> {
    if (!state.transactions.length) return
    try { await this.#seal(workspaceId, state.transactions.length, state.hashes.at(-1)!, true) }
    catch (cause) {
      if (cause instanceof RpError && !['persistence_failed', 'persistence_uncertain'].includes(cause.code)) throw cause
      error('persistence_uncertain', 'RP effect is published but its durable receipt is incomplete; retry the same operation')
    }
  }
  /** Upper-level idempotent acknowledgements must finish the same seal protocol. */
  async ensureDurable(authority: HostAuthority, expected: InputFence): Promise<Result<InputFence>> {
    try {
      const { grant } = await this.#authorize(authority, 'commit'), fence = cloneInput(expected); validateFence(fence)
      return await lock(this.#workspacePath(grant.request.workspaceId), async () => {
        await this.#authorize(authority, 'commit')
        const state = await this.#load(grant.request.workspaceId), branch = this.#branch(state, grant.request)
        this.#assertAuditAudience(state, branch, grant.request)
        if (!same(fence, branch.fence)) error('stale_input', 'RP branch changed before durable acknowledgement')
        await this.#confirmPublished(grant.request.workspaceId, state)
        return ok(branch.fence)
      })
    } catch (cause) { return failure(cause) }
  }
  async #blob(workspaceId: string, body: string): Promise<{ blobId: string; bodySha256: string }> {
    const bodySha256 = sha(Buffer.from(body, 'utf8')), blobId = 'blob_' + bodySha256
    const file = path.join(this.#workspacePath(workspaceId), 'blobs', blobId + '.blob')
    try {
      const bytes = await fs.readFile(file)
      if (sha(bytes) !== bodySha256) error('source_unavailable', 'RP existing content-addressed blob is corrupt')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
      await this.#publish(file, body, 'blob')
    }
    return { blobId, bodySha256 }
  }
  async #readBlob(workspaceId: string, blobId: string, expectedHash: string): Promise<string> {
    id(blobId); hash(expectedHash)
    if (blobId !== 'blob_' + expectedHash) error('source_unavailable', 'RP blob identity mismatch')
    try {
      const file = path.join(this.#workspacePath(workspaceId), 'blobs', blobId + '.blob'), stat = await fs.lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4194304) error('source_unavailable', 'RP invalid source blob')
      this.#options.onBlobRead?.()
      const bytes = await fs.readFile(file)
      if (sha(bytes) !== expectedHash) error('source_unavailable', 'RP source hash mismatch')
      const content = bytes.toString('utf8')
      if (!Buffer.from(content, 'utf8').equals(bytes) || !wellFormed(content)) error('source_unavailable', 'RP source encoding mismatch')
      return content
    } catch (cause) { if (cause instanceof RpError) throw cause; error('source_unavailable', 'RP original source unavailable') }
  }
  #source(state: WorkspaceState, branch: BranchState, request: AuthorityRequest, sourceId: string): SourceRevision {
    const source = state.sources.get(sourceId)
    if (!source || !this.#scopeMatches(source.scope, request) || branch.bindings.get(sourceId)?.disposition !== 'accepted' || this.#deleted(branch).has(sourceId) || this.#workspaceDeleted(state).has(sourceId) || !this.#visible(source.visibility, request)) error('source_unavailable', 'RP effective source unavailable')
    return source
  }
  async #sourceText(state: WorkspaceState, branch: BranchState, request: AuthorityRequest, sourceId: string): Promise<string> {
    const source = this.#source(state, branch, request, sourceId), content = await this.#readBlob(request.workspaceId, source.blobId, source.publicTextSha256)
    if (content.length !== source.publicTextLengthUtf16) error('source_unavailable', 'RP source length mismatch')
    return content
  }
  #boundary(content: string, offset: number): void {
    if (offset > content.length || (offset > 0 && offset < content.length && /[\uD800-\uDBFF]/u.test(content[offset - 1]) && /[\uDC00-\uDFFF]/u.test(content[offset]))) invalid('UTF16 source boundary')
  }
  async #verifySpan(state: WorkspaceState, branch: BranchState, request: AuthorityRequest, span: SourceSpan, sourceText = (id: string) => this.#sourceText(state, branch, request, id)): Promise<string> {
    validateSpan(span)
    const source = this.#source(state, branch, request, span.sourceRevisionId)
    if (source.publicTextSha256 !== span.publicTextSha256) error('source_unavailable', 'RP source revision mismatch')
    const content = await sourceText(source.id)
    this.#boundary(content, span.startUtf16); this.#boundary(content, span.endUtf16)
    const quote = content.slice(span.startUtf16, span.endUtf16)
    if (sha(quote) !== span.quoteSha256) error('source_unavailable', 'RP quote hash mismatch')
    return quote
  }
  async #read<T>(authority: HostAuthority, work: (state: WorkspaceState, branch: BranchState, request: AuthorityRequest) => Promise<T> | T): Promise<Result<T>> {
    try {
      const { grant } = await this.#authorize(authority, 'read'), state = await this.#load(grant.request.workspaceId), branch = this.#branch(state, grant.request)
      const result = await work(state, branch, grant.request)
      // Metadata/source reads may yield; revoked handles must not release data.
      await this.#authorize(authority, 'read')
      const latest = this.#branch(await this.#load(grant.request.workspaceId), grant.request)
      if (!same(latest.fence, branch.fence)) error('stale_input', 'RP read fence changed')
      return ok(result)
    } catch (cause) { return failure(cause) }
  }
  readBranch(authority: HostAuthority): Promise<Result<Branch>> { return this.#read(authority, (_state, branch) => branch.branch) }
  readFence(authority: HostAuthority): Promise<Result<InputFence>> { return this.#read(authority, (_state, branch) => branch.fence) }
  readControlCommit(authority: HostAuthority, inputKey: string): Promise<Result<{ readonly fence: InputFence; readonly authorityChanges: readonly AuthorityChange[] } | null>> {
    return this.#read(authority, (state, branch, request) => {
      this.#assertAuditAudience(state, branch, request)
      text(inputKey, 256)
      const tx = state.transactions.find(tx => tx.idempotencyKey === 'branch:' + request.branchId + ':' + sha(inputKey))
      return tx?.operation.kind === 'commit' ? { fence: tx.operation.result, authorityChanges: tx.operation.authorityChanges } : null
    })
  }
  #assertAuditAudience(state: WorkspaceState, branch: BranchState, request: AuthorityRequest): void {
    if (!request.permissions.includes('control') || request.viewpoint.kind !== 'narrator') denied('raw ledger requires narrator host control')
    const changeSources = branch.changes.flatMap(change => change.kind === 'deletion' ? [...change.record.sourceRevisionIds] : change.kind === 'candidate_adoption' ? [...change.record.sourceRevisionIds, change.record.controlSourceId] : [])
    const relevantSources = new Set([...changeSources, ...branch.bindings.keys(), ...branch.records.values()].flatMap(value => typeof value === 'string' ? [value] : [...value.sourceRevisionIds]))
    for (const sourceId of relevantSources) { const source = state.sources.get(sourceId); if (!source || !this.#scopeMatches(source.scope, request) || !this.#visible(source.visibility, request)) denied('audit ledger includes unavailable audience metadata') }
    if ([...branch.records.values()].some(record => !this.#visible(record.visibility, request))) denied('audit ledger includes unavailable derived metadata')
  }
  readLedger(authority: HostAuthority): Promise<Result<LedgerSnapshot>> {
    return this.#read(authority, (state, branch, request) => this.#ledger(state, branch, request))
  }
  #ledger(state: WorkspaceState, branch: BranchState, request: AuthorityRequest): LedgerSnapshot {
      // This is a trusted audit/reducer input, not a public tool projection.
      // Returning partially filtered binding/job/deletion counts would leak IDs.
      this.#assertAuditAudience(state, branch, request)
      return { branch: branch.branch, fence: branch.fence,
      sources: [...state.sources.values()].filter(source => this.#scopeMatches(source.scope, request) && (source.scope.kind === 'branch' || source.scope.kind === 'session') && (source.scope.branchId === branch.branch.id || branch.bindings.has(source.id)) && this.#visible(source.visibility, request)),
      sourceBindings: [...branch.bindings.values()], records: [...this.#activeRecords(branch).values()].filter(r => this.#visible(r.visibility, request)), jobs: [...branch.jobs.values()],
      authorityChanges: branch.changes, deletions: branch.changes.flatMap(change => change.kind === 'deletion' ? [change.record] : []) }
  }
  /** Two verified loads bracket the whole assembly, without retaining any view
   * across requests, authorities, revisions or privacy generations. */
  withReadView<T>(authority: HostAuthority, work: (view: RpReadView) => Promise<T> | T, options: { audit?: boolean } = {}): Promise<Result<T>> {
    return this.#read(authority, async (state, branch, request) => {
      const texts = new Map<string, Promise<string>>()
      const sourceText = (id: string) => {
        let pending = texts.get(id)
        if (!pending) { pending = this.#sourceText(state, branch, request, id); texts.set(id, pending) }
        return pending
      }
      const all = await this.#readEventBodies(state, branch, request, sourceText), events = eventsForView(all, branch.fence, request.viewpoint)
      const allowed = new Set(events.map(e => e.id)), sourceAllowed = (id: string) => request.viewpoint.kind === 'narrator' || (events.some(e => e.sources.some(s => s.sourceRevisionId === id)) && !all.some(e => !allowed.has(e.id) && e.sources.some(s => s.sourceRevisionId === id)))
      const sources: SourceRevision[] = []
      for (const b of [...branch.bindings.values()].sort((a, b) => (a.acceptedSeq ?? 0) - (b.acceptedSeq ?? 0))) {
        if (b.disposition !== 'accepted' || !sourceAllowed(b.sourceRevisionId)) continue
        try { sources.push(this.#source(state, branch, request, b.sourceRevisionId)) }
        catch (cause) { if (!(cause instanceof RpError) || !['scope_denied', 'source_unavailable'].includes(cause.code)) throw cause }
      }
      const context={sceneId:request.sceneId,acceptedSeq:Math.max(0,...[...branch.bindings.values()].filter(b=>b.disposition==='accepted').map(b=>b.acceptedSeq!))}
      const data = { context, fence: branch.fence, events, summaries: await this.#readSummaryBodies(state, branch, request, sourceText, request.viewpoint.kind === 'character' ? allowed : null), projection: reduceEvents(events, branch.fence, context), sources, ledger: options.audit ? this.#ledger(state, branch, request) : null }
      // Isolate callback mutation from the original fence and authority state.
      const copy = structuredClone(data); inheritGrowthMarks(data, copy)
      let open = true
      try { return await work({ ...copy, readSource: async span => {
        if (!open) denied('read view is closed')
        const value = cloneInput(span); validateSpan(value)
        if (!sourceAllowed(value.sourceRevisionId)) error('source_unavailable', 'RP mixed or unavailable source')
        const result = await this.#verifySpan(state, branch, request, value, sourceText)
        if (!open) denied('read view is closed')
        return result
      } }) } finally { open = false; texts.clear() }
    })
  }
  readSource(authority: HostAuthority, input: SourceSpan): Promise<Result<string>> {
    return this.#read(authority, async (state, branch, request) => { await this.#checkSourceView(state, branch, request, input.sourceRevisionId); return this.#verifySpan(state, branch, request, cloneInput(input)) })
  }
  /** Public discovery authorizes each source before returning IDs or counts.
   * Unlike readLedger, this does not expose hidden control/deletion metadata. */
  readAcceptedSources(authority: HostAuthority): Promise<Result<readonly SourceRevision[]>> {
    return this.#read(authority, async (state, branch, request) => {
      const visible: SourceRevision[] = []
      for (const b of [...branch.bindings.values()].sort((a, b) => (a.acceptedSeq ?? 0) - (b.acceptedSeq ?? 0))) {
        if (b.disposition !== 'accepted') continue
        try { await this.#checkSourceView(state, branch, request, b.sourceRevisionId); visible.push(this.#source(state, branch, request, b.sourceRevisionId)) }
        catch (cause) { if (!(cause instanceof RpError) || !['scope_denied', 'source_unavailable'].includes(cause.code)) throw cause }
      }
      return visible
    })
  }
  sourceSpan(authority: HostAuthority, sourceId: string, startUtf16: number, endUtf16: number): Promise<Result<SourceSpan>> {
    return this.#read(authority, async (state, branch, request) => {
      id(sourceId); integer(startUtf16); integer(endUtf16); if (endUtf16 < startUtf16) invalid('span order')
      await this.#checkSourceView(state, branch, request, sourceId)
      const source = this.#source(state, branch, request, sourceId), content = await this.#sourceText(state, branch, request, sourceId)
      this.#boundary(content, startUtf16); this.#boundary(content, endUtf16)
      return { sourceRevisionId: sourceId, publicTextSha256: source.publicTextSha256, startUtf16, endUtf16, quoteSha256: sha(content.slice(startUtf16, endUtf16)) }
    })
  }
  async openSourceSnapshot(authority: HostAuthority, span: SourceSpan): Promise<Result<object>> {
    const read = await this.readSource(authority, span)
    if (!read.ok) return read
    const handle = Object.freeze({})
    this.#snapshots.set(handle, { authority, span: structuredClone(span), bodySha256: sha(read.value), snapshotId: newId('snapshot') })
    return { ok: true, value: handle }
  }
  async readSourcePage(authority: HostAuthority, snapshot: object, offset: number, limit: number): Promise<Result<{ snapshotId: string; bodySha256: string; text: string; nextOffset: number | null }>> {
    try {
      const fixed = snapshot && typeof snapshot === 'object' ? this.#snapshots.get(snapshot) : undefined
      if (!fixed || fixed.authority !== authority) denied('unrecognized or cross-authority source snapshot')
      integer(offset); integer(limit, 1); if (limit > 65536) invalid('source page limit')
      const read = await this.readSource(authority, fixed.span)
      if (!read.ok) return read
      const body = read.value
      if (sha(body) !== fixed.bodySha256) error('source_unavailable', 'RP source snapshot changed')
      this.#boundary(body, offset)
      let end = Math.min(body.length, offset + limit)
      if (end < body.length && /[\uD800-\uDBFF]/u.test(body[end - 1]) && /[\uDC00-\uDFFF]/u.test(body[end])) end--
      if (end === offset && offset < body.length) end += 2 // one scalar must make progress
      return ok({ snapshotId: fixed.snapshotId, bodySha256: fixed.bodySha256, text: body.slice(offset, end), nextOffset: end < body.length ? end : null })
    } catch (cause) { return failure(cause) }
  }
  replayProjection(authority: HostAuthority): Promise<Result<ProjectionResult>> {
    return this.#read(authority, async (state, branch, request) => reduceEvents(eventsForView(await this.#readEventBodies(state, branch, request), branch.fence, request.viewpoint), branch.fence,{sceneId:request.sceneId,acceptedSeq:Math.max(0,...[...branch.bindings.values()].filter(b=>b.disposition==='accepted').map(b=>b.acceptedSeq!))}))
  }
  readEvents(authority: HostAuthority): Promise<Result<readonly SemanticEvent[]>> { return this.#derivedBodies(authority, 'event') as Promise<Result<SemanticEvent[]>> }
  readSummaries(authority: HostAuthority): Promise<Result<readonly Summary[]>> { return this.#derivedBodies(authority, 'summary') as Promise<Result<Summary[]>> }
  #derivedBodies(authority: HostAuthority, kind: 'event' | 'summary'): Promise<Result<(SemanticEvent | Summary)[]>> {
    return this.#read(authority, async (state, branch, request) => {
      if (kind === 'event') return [...eventsForView(await this.#readEventBodies(state, branch, request), branch.fence, request.viewpoint)]
      const allowed = request.viewpoint.kind === 'character' ? new Set(eventsForView(await this.#readEventBodies(state, branch, request), branch.fence, request.viewpoint).map(e => e.id)) : null
      return this.#readSummaryBodies(state, branch, request, id => this.#sourceText(state, branch, request, id), allowed)
    })
  }
  async #readSummaryBodies(state: WorkspaceState, branch: BranchState, request: AuthorityRequest, sourceText: (id: string) => Promise<string>, allowed: Set<string> | null): Promise<Summary[]> {
      const records: Summary[] = []
      for (const r of this.#activeRecords(branch).values()) {
        if (r.kind !== 'summary' || !r.active || !this.#visible(r.visibility, request)) continue
        if (allowed && (r.dependencyIds.some(id => !allowed.has(id)) || !r.dependencyIds.length)) continue
        for (const sourceId of r.sourceRevisionIds) await sourceText(sourceId)
        const body = await this.#readBlob(request.workspaceId, r.blobId, r.bodySha256), parsed = parseRecord({ kind: 'summary', record: JSON.parse(body) })
        if (!parsed.ok || parsed.value.kind !== 'summary' || parsed.value.record.id !== r.id) error('source_unavailable', 'RP derived payload unavailable')
        {
          const { text: _text, ...metadata } = parsed.value.record
          if (!same(metadata, r.metadata)) error('source_unavailable', 'RP summary authority metadata mismatch')
        }
        records.push(parsed.value.record)
      }
      return records
  }
  async #readEventBodies(state: WorkspaceState, branch: BranchState, request: AuthorityRequest, sourceText = (id: string) => this.#sourceText(state, branch, request, id)): Promise<SemanticEvent[]> {
    const records: SemanticEvent[] = []
    for (const r of this.#activeRecords(branch).values()) {
      if (r.kind !== 'event' || !r.active || !this.#visible(r.visibility, request)) continue
      // Check all source partitions before reading payloads. A multi-audience
      // host grant is still required even when knowledge is explicitly learned.
      if (r.sourceRevisionIds.some(id => { const s = state.sources.get(id); return !s || !this.#visible(s.visibility, request) })) continue
      for (const sourceId of r.sourceRevisionIds) await sourceText(sourceId)
      const body = await this.#readBlob(request.workspaceId, r.blobId, r.bodySha256), parsed = parseRecord({ kind: 'event', record: JSON.parse(body) })
      if (!parsed.ok || parsed.value.kind !== 'event') error('source_unavailable', 'RP event payload unavailable')
      authenticateEvent(parsed.value.record, branch.changes)
      const { payload: _payload, fictionalTime: _time, ...metadata } = parsed.value.record
      if (!same(metadata, r.metadata) || !same(eventDependencies(parsed.value.record), r.dependencyIds)) error('source_unavailable', 'RP event authority metadata mismatch')
      records.push(parsed.value.record)
    }
    return records.sort((a, b) => a.acceptedSeq - b.acceptedSeq || a.id.localeCompare(b.id))
  }
  async #checkSourceView(state: WorkspaceState, branch: BranchState, request: AuthorityRequest, sourceId: string): Promise<void> {
    if (request.viewpoint.kind === 'narrator') return
    const events = eventsForView(await this.#readEventBodies(state, branch, request), branch.fence, request.viewpoint)
    if (!events.some(e => e.sources.some(s => s.sourceRevisionId === sourceId))) error('source_unavailable', 'RP effective source unavailable')
    // A source block may contain several claims. Without a verified segment
    // policy all claims attached to that whole source must be allowed.
    const all = await this.#readEventBodies(state, branch, request), allowed = new Set(events.map(e => e.id))
    if (all.some(e => e.sources.some(s => s.sourceRevisionId === sourceId) && !allowed.has(e.id))) error('source_unavailable', 'RP mixed source requires verified visible spans')
  }
  #activeCopies(state: WorkspaceState, branch: BranchState): Map<string, PayloadCopy> {
    const events = this.#activeRecords(branch), blocked = new Set([...branch.invalidated, ...this.#deleted(branch), ...this.#workspaceDeleted(state)])
    const copies = [...state.copies.values()].filter(c => c.branchId === branch.branch.id)
    let changed = true
    while (changed) { changed = false; for (const c of copies) if (!blocked.has(c.id) && (c.sourceRevisionIds.some(id => blocked.has(id) || branch.bindings.get(id)?.disposition !== 'accepted') || c.dependencyIds.some(id => blocked.has(id) || (!events.get(id)?.active && !copies.some(other => other.id === id))))) { blocked.add(c.id); changed = true } }
    return new Map(copies.filter(c => !blocked.has(c.id)).map(c => [c.id, c]))
  }
  async savePayloadCopy(authority: HostAuthority, input: { readonly idempotencyKey: string; readonly id: string; readonly kind: PayloadCopy['kind']; readonly sourceRevisionIds: readonly string[]; readonly dependencyIds: readonly string[]; readonly body: string }): Promise<Result<PayloadCopy>> {
    try {
      const { grant } = await this.#authorize(authority, 'commit'), value = cloneInput(input)
      object(value, ['idempotencyKey', 'id', 'kind', 'sourceRevisionIds', 'dependencyIds', 'body']); text(value.idempotencyKey, 256); text(value.body, 1048576, true)
      if (grant.request.viewpoint.kind !== 'narrator' || !grant.request.permissions.includes('control')) denied('managed copy writer requires host control')
      return await lock(this.#workspacePath(grant.request.workspaceId), async () => {
        await this.#authorize(authority, 'commit')
        const state = await this.#load(grant.request.workspaceId), branch = this.#branch(state, grant.request), key = 'copy:' + grant.request.branchId + ':' + sha(value.idempotencyKey), effect = digest(value)
        const existing = state.transactions.find(tx => tx.idempotencyKey === key)
        if (existing) { if (existing.effectHash !== effect || existing.operation.kind !== 'copy') error('idempotency_conflict', 'RP copy idempotency conflict'); if (!this.#activeCopies(state, branch).has(existing.operation.copy.id)) error('source_unavailable', 'RP copy no longer active'); await this.#confirmPublished(grant.request.workspaceId, state); return ok(existing.operation.copy) }
        const copy: PayloadCopy = { id: value.id, kind: value.kind, branchId: branch.branch.id, sourceRevisionIds: value.sourceRevisionIds, dependencyIds: value.dependencyIds, visibility: authority.visibility, blobId: 'blob_' + sha(value.body), bodySha256: sha(value.body) }
        this.#validateOperation({ kind: 'copy', copy })
        this.#assertPayloadAvailable(state, copy.bodySha256)
        if (state.copies.has(copy.id) || [...state.branches.values()].some(b => b.records.has(copy.id))) invalid('copy identity')
        for (const sourceId of copy.sourceRevisionIds) { const source = this.#source(state, branch, grant.request, sourceId); if (source.visibility.audienceSetId !== copy.visibility.audienceSetId) denied('copy audience partition'); await this.#sourceText(state, branch, grant.request, sourceId) }
        const active = this.#activeRecords(branch), copies = this.#activeCopies(state, branch)
        for (const dep of copy.dependencyIds) if (!active.get(dep)?.active && !copies.has(dep)) invalid('copy dependency')
        // Copies carry the complete source union, so a dependency cannot launder
        // a hidden source out of deletion/permission checks.
        for (const dep of copy.dependencyIds) if ((active.get(dep) ?? copies.get(dep))!.sourceRevisionIds.some(id => !copy.sourceRevisionIds.includes(id))) invalid('copy dependency source coverage')
        await this.#blob(grant.request.workspaceId, value.body)
        await this.#append(grant.request.workspaceId, state, key, effect, { kind: 'copy', copy })
        return ok(copy)
      })
    } catch (cause) { return failure(cause) }
  }
  readPayloadCopies(authority: HostAuthority): Promise<Result<readonly (PayloadCopy & { readonly body: string })[]>> {
    return this.#read(authority, async (state, branch, request) => {
      const result: (PayloadCopy & { body: string })[] = []
      const known = request.viewpoint.kind === 'character' ? new Set(eventsForView(await this.#readEventBodies(state, branch, request), branch.fence, request.viewpoint).map(e => e.id)) : null
      for (const copy of this.#activeCopies(state, branch).values()) {
        if (!this.#visible(copy.visibility, request) || (known && (copy.dependencyIds.some(id => !known.has(id)) || !copy.dependencyIds.length))) continue
        if (copy.sourceRevisionIds.some(id => { const s = state.sources.get(id); return !s || !this.#visible(s.visibility, request) })) continue
        for (const source of copy.sourceRevisionIds) await this.#sourceText(state, branch, request, source)
        result.push({ ...copy, body: await this.#readBlob(request.workspaceId, copy.blobId, copy.bodySha256) })
      }
      return result
    })
  }
  async observeSource(authority: HostAuthority, input: SourceObservation): Promise<Result<SourceRevision>> {
    try {
      const { grant } = await this.#authorize(authority, 'observe'), observation = cloneInput(input); validateObservation(observation)
      if (observation.origin === 'user_control' && !grant.request.permissions.includes('control')) denied('control observation')
      if (observation.host && observation.host.sessionId !== grant.request.sessionId) denied('source session')
      return await lock(this.#workspacePath(grant.request.workspaceId), async () => {
        await this.#authorize(authority, 'observe')
        const state = await this.#load(grant.request.workspaceId); this.#branch(state, grant.request)
        if (this.#deletedHashes(state).has(sha(observation.publicText))) error('source_unavailable', 'RP deleted payload cannot be observed again')
        this.#assertPayloadAvailable(state, sha(observation.publicText))
        const key = 'source:' + grant.request.branchId + ':' + sha(observation.idempotencyKey), effect = digest({ observation, visibility: authority.visibility }), existing = state.transactions.find(tx => tx.idempotencyKey === key)
        if (existing) { if (existing.effectHash !== effect || existing.operation.kind !== 'source') error('idempotency_conflict', 'RP source idempotency key has different effects'); await this.#seal(grant.request.workspaceId, existing.sequence, digest(existing)); return ok(existing.operation.source) }
        const bytes = await this.#blob(grant.request.workspaceId, observation.publicText)
        const source: SourceRevision = { schemaVersion: 1, id: newId('source'), scope: authority.scope, origin: observation.origin,
          ...(observation.host ? { host: observation.host } : {}), turnId: observation.turnId, role: observation.role,
          publicTextSha256: bytes.bodySha256, publicTextLengthUtf16: observation.publicText.length, blobId: bytes.blobId, visibility: authority.visibility, capturedAt: new Date().toISOString() }
        const parsed = parseRecord({ kind: 'source', record: source }); if (!parsed.ok) invalid('generated source')
        await this.#authorize(authority, 'observe')
        await this.#append(grant.request.workspaceId, state, key, effect, { kind: 'source', source })
        return ok(source)
      })
    } catch (cause) { return failure(cause) }
  }
  #checkJobTransition(branch: BranchState, expected: Job | null, next: Job, atomicSummary = false): void {
    validateJob(next)
    const old = branch.jobs.get(next.id)
    if (!same(old ?? null, expected)) error('stale_input', 'RP job state/attempt changed')
    if (!expected) {
      if (next.state !== 'queued' || next.attempts !== 0 || next.summaryId || !same(next.inputFence, branch.fence)) invalid('new job state/fence')
      return
    }
    if (next.kind !== expected.kind || next.idempotencyKey !== expected.idempotencyKey || next.inputCopyId !== expected.inputCopyId || next.inputFence.branchId !== branch.branch.id) invalid('immutable job identity')
    const starts = ['queued', 'stale'].includes(expected.state) && next.state === 'running' && next.attempts === expected.attempts + 1 && next.attempts <= 3 && same(next.inputFence, branch.fence)
    const ends = (['running', 'prepared'].includes(expected.state) && next.state === 'stale' || ['queued', 'running', 'prepared', 'stale'].includes(expected.state) && ['failed', 'cancelled'].includes(next.state)) && next.attempts === expected.attempts
    const deferred = ['queued', 'running', 'prepared', 'stale'].includes(expected.state) && next.state === 'deferred' && next.attempts === expected.attempts
    const prepares = expected.state === 'running' && next.state === 'prepared' && next.attempts === expected.attempts
    const commits = atomicSummary && ['running', 'prepared'].includes(expected.state) && next.state === 'committed' && next.attempts === expected.attempts && !!next.summaryId
    if (!starts && !ends && !deferred && !prepares && !commits) invalid('illegal job transition')
    if (!starts && !same(next.inputFence, expected.inputFence)) invalid('job generation fence rewrite')
    if (!commits && next.summaryId) invalid('job result before atomic publication')
  }
  /** Job metadata belongs to this same sealed authority log, but is not story input. */
  async transitionJob(authority: HostAuthority, input: { readonly idempotencyKey: string; readonly expected: Job | null; readonly next: Job }): Promise<Result<Job>> {
    try {
      const { grant } = await this.#authorize(authority, 'control'), value = cloneInput(input)
      if (grant.request.viewpoint.kind !== 'narrator') denied('job writer requires narrator host control')
      object(value, ['idempotencyKey', 'expected', 'next']); text(value.idempotencyKey, 256); if (value.expected !== null) validateJob(value.expected); validateJob(value.next)
      return await lock(this.#workspacePath(grant.request.workspaceId), async () => {
        await this.#authorize(authority, 'control')
        const state = await this.#load(grant.request.workspaceId), branch = this.#branch(state, grant.request), key = 'job:' + grant.request.branchId + ':' + sha(value.idempotencyKey), effect = digest(value)
        const prior = state.transactions.find(tx => tx.idempotencyKey === key)
        if (prior) { if (prior.effectHash !== effect || prior.operation.kind !== 'job') error('idempotency_conflict', 'RP job operation ID reused'); await this.#seal(grant.request.workspaceId, prior.sequence, digest(prior)); return ok(prior.operation.next) }
        this.#checkJobTransition(branch, value.expected, value.next)
        if (!value.expected && value.next.inputCopyId && !this.#activeCopies(state, branch).has(value.next.inputCopyId)) invalid('job input copy unavailable')
        if (state.copies.has(value.next.id) || [...state.branches.values()].some(b => b.records.has(value.next.id))) invalid('job identity collision')
        await this.#append(grant.request.workspaceId, state, key, effect, { kind: 'job', branchId: branch.branch.id, expected: value.expected, next: value.next })
        return ok(value.next)
      })
    } catch (cause) { return failure(cause) }
  }
  async commit(authority: HostAuthority, input: CommitBatch): Promise<Result<InputFence>> {
    try {
      const { grant } = await this.#authorize(authority, 'commit'), batch = cloneInput(input); validateBatch(batch)
      if (batch.expected.branchId !== grant.request.branchId) denied('commit branch')
      return await lock(this.#workspacePath(grant.request.workspaceId), async () => {
        await this.#authorize(authority, 'commit')
        const state = await this.#load(grant.request.workspaceId), current = this.#branch(state, grant.request)
        const key = 'branch:' + grant.request.branchId + ':' + sha(batch.idempotencyKey), effect = requiresPerson(batch.authorityChanges) ? digest({ batch, requiredCapabilities: ['rp.person-core/v1'] }) : digest(batch), existing = state.transactions.find(tx => tx.idempotencyKey === key)
        if (existing) { if (existing.effectHash !== effect || existing.operation.kind !== 'commit') error('idempotency_conflict', 'RP commit idempotency key has different effects'); await this.#seal(grant.request.workspaceId, existing.sequence, digest(existing)); return ok(existing.operation.result) }
        if (!same(current.fence, batch.expected) || batch.nextContextRevision !== current.fence.contextRevision + 1) error('stale_input', 'RP input fence changed')
        const next: BranchState = structuredClone(current), touched = new Set<string>()
        const parentChanges = batch.authorityChanges.filter(change => change.kind === 'branch_parent'), inherited = new Set<string>()
        if (parentChanges.length > 1) invalid('duplicate branch parent')
        for (const change of parentChanges) {
          if (!grant.request.permissions.includes('control')) denied('parent requires host control')
          if (current.branch.parent || current.bindings.size || current.fence.contextRevision !== 0) invalid('parent can only be fixed on an empty branch')
          const parentState = this.#historical(state, change.record.branchId, change.record.contextRevision)
          if (parentState.branch.campaignId !== grant.request.campaignId || change.record.prefixManifestHash !== this.#manifest(parentState)) denied('fixed parent manifest')
          const expected = [...parentState.bindings.values()].filter(b => b.disposition === 'accepted').map(b => ({ ...b, branchId: grant.request.branchId }))
          if (!same(expected, change.record.sourceBindings) || !same(expected, batch.sourceBindings)) invalid('exact parent prefix')
          expected.forEach(b => inherited.add(b.sourceRevisionId))
          next.bindings = new Map([...parentState.bindings].map(([id, b]) => [id, { ...b, branchId: grant.request.branchId }]))
          next.records = structuredClone(parentState.records); next.invalidated = structuredClone(parentState.invalidated); next.changes = structuredClone(parentState.changes)
        }
        const inheritedBase: BranchState = structuredClone(next)
        for (const b of batch.sourceBindings) {
          if (touched.has(b.sourceRevisionId)) invalid('duplicate binding mutation'); touched.add(b.sourceRevisionId)
          const source = state.sources.get(b.sourceRevisionId)
          if (b.branchId !== grant.request.branchId || !source || !this.#scopeMatches(source.scope, grant.request) || source.turnId !== b.turnId || !this.#visible(source.visibility, grant.request)) denied('source binding scope')
          if ((source.scope.kind === 'branch' || source.scope.kind === 'session') && source.scope.branchId !== grant.request.branchId && !current.bindings.has(source.id) && !inherited.has(source.id)) denied('unproven inherited source')
          if ((this.#deleted(current).has(source.id) || this.#workspaceDeleted(state).has(source.id)) && b.disposition === 'accepted') error('source_unavailable', 'RP deleted source cannot be adopted')
          if (b.supersedes && !current.bindings.has(b.supersedes)) invalid('supersession target')
          next.bindings.set(b.sourceRevisionId, b)
        }
        const logicalMessages = new Set<string>()
        for (const b of next.bindings.values()) if (b.disposition === 'accepted') {
          const source = state.sources.get(b.sourceRevisionId)!
          const logical = source.host ? canonical([source.host.sessionId, source.host.messageId]) : source.id
          if (logicalMessages.has(logical)) invalid('multiple accepted message revisions'); logicalMessages.add(logical)
          const old = current.bindings.get(b.sourceRevisionId)
          if (old?.acceptedSeq != null && old.acceptedSeq !== b.acceptedSeq) invalid('accepted sequence rewrite')
          if (b.supersedes && current.bindings.get(b.supersedes)?.acceptedSeq !== b.acceptedSeq) invalid('replacement sequence')
        }
        const changes = batch.authorityChanges
        if (changes.length && !grant.request.permissions.includes('control')) denied('authority mutation requires host control')
        const fixedParent = parentChanges[0] ? this.#historical(state, parentChanges[0].record.branchId, parentChanges[0].record.contextRevision) : null
        let canonHash = fixedParent?.fence.canonBindingsHash ?? current.fence.canonBindingsHash, visibilityRevision = fixedParent?.fence.visibilityRevision ?? current.fence.visibilityRevision, deletionGeneration = fixedParent?.fence.deletionGeneration ?? current.fence.deletionGeneration
        for (const change of changes) {
          if (change.kind === 'visibility') {
            if (change.recordId !== change.record.policyId || change.record.policyId !== authority.visibility.policyId || change.record.revision !== visibilityRevision + 1 || !grant.request.audienceSetIds.includes(change.record.audienceSetId)) denied('visibility policy mutation')
            visibilityRevision = change.record.revision
          } else if (change.kind === 'deletion') {
            const d = change.record
            if (d.id !== change.recordId || !this.#scopeMatches(d.scope, grant.request) || (d.scope.kind !== 'branch' && d.scope.kind !== 'session') || d.scope.branchId !== grant.request.branchId || d.generation !== deletionGeneration + 1 || d.purgeState !== 'blocked') denied('deletion authority/state')
            for (const sourceId of d.sourceRevisionIds) { const s = state.sources.get(sourceId); if (!s || !this.#scopeMatches(s.scope, grant.request) || !this.#visible(s.visibility, grant.request) || ((s.scope.kind === 'branch' || s.scope.kind === 'session') && s.scope.branchId !== grant.request.branchId && !current.bindings.has(s.id))) denied('deletion scope/audience') }
            if (d.blockedDerivedIds.some(id => !next.records.has(id) || !this.#visible(next.records.get(id)!.visibility, grant.request))) denied('deletion dependency audience')
            deletionGeneration = d.generation
          } else if (change.kind === 'canon_binding') {
            if (!this.#options.verifyCanonBinding || !await this.#options.verifyCanonBinding(change.record)) error('capability_missing', 'RP approved global publication verifier is required')
            canonHash = digest([...next.changes.filter(c => c.kind === 'canon_binding'), change])
          } else if (change.kind === 'branch_parent') {
            // Exact fixed-prefix proof was checked before accepting inherited IDs.
          } else {
            const adoption = change.record, control = state.sources.get(adoption.controlSourceId)
            if (!control || control.origin !== 'user_control' || next.bindings.get(control.id)?.disposition !== 'accepted') denied('candidate requires actual user control source')
            for (const sourceId of adoption.sourceRevisionIds) this.#source(state, next, grant.request, sourceId)
            if (adoption.decision === 'rejected' && (adoption.eventIds.length || adoption.summaryIds.length)) denied('rejected candidate effects')
            if (adoption.eventIds.some(id => !batch.events.some(e => e.id === id)) || adoption.summaryIds.some(id => !batch.summaries.some(s => s.id === id))) invalid('adoption result references')
          }
          next.changes.push(change)
        }
        const result: InputFence = { ...current.fence, contextRevision: batch.nextContextRevision, sourceManifestHash: this.#manifest(next), canonBindingsHash: canonHash, visibilityRevision, deletionGeneration }
        validateFence(result)
        const records: Derived[] = [], payloads = new Map<string, string>(), identifiers = new Set([...next.records.keys(), ...next.jobs.keys()])
        let growthHistory: SemanticEvent[] | undefined
        batch.events.forEach(e => authenticateEvent(e, changes))
        const newPeople = new Set<string>()
        for (const event of batch.events) if (semanticProtocol(event) === 'person-origin/v1' && event.payload.kind === 'occurrence') {
          const personId = event.payload.actorIds[0]
          if (newPeople.has(personId) || hasPersonOwner(inheritedBase.changes, personId)) invalid('person already initialized in life branch')
          if (!batch.events.some(e => e.payload.kind === 'state_change' && e.payload.subjectId === personId && personValue(e)?.causeEventIds.includes(event.id))) invalid('person origin and initial fields require one atomic commit')
          growthHistory ??= await this.#readEventBodies(state, inheritedBase, grant.request)
          const conflicts = growthHistory.filter(e => (e.payload.kind === 'state_change' || e.payload.kind === 'canon_assertion') && e.payload.subjectId === personId && ['identity','background','voice','rule'].includes(e.payload.key))
          if (conflicts.length) denied('legacy person field conflicts: ' + conflicts.map(e => e.id).join(', '))
          newPeople.add(personId)
        }
        for (const record of [...batch.events, ...batch.summaries]) {
          if (identifiers.has(record.id)) invalid('immutable derived identity'); identifiers.add(record.id)
          if ([...state.branches.values()].some(branch => branch.records.has(record.id)) || state.copies.has(record.id)) invalid('workspace derived identity')
          if (!this.#scopeMatches(record.scope, grant.request) || (record.scope.kind !== 'branch' && record.scope.kind !== 'session') || record.scope.branchId !== grant.request.branchId || !same(record.visibility, authority.visibility) || record.policyVersion !== current.fence.policyVersion) denied('derived scope/visibility/policy')
          const isEvent = 'payload' in record
          if (isEvent && (record.payload.kind === 'state_change' || record.payload.kind === 'canon_assertion') && ['identity','background','voice','rule'].includes(record.payload.key) && (newPeople.has(record.payload.subjectId) || hasPersonOwner(inheritedBase.changes, record.payload.subjectId)) && !personValue(record)) denied('person fields require marked person controls')
          const sourceIds = isEvent ? [...new Set(record.sources.map(span => span.sourceRevisionId))] : [...record.sourceRevisionIds]
          for (const sourceId of sourceIds) {
            const original = this.#source(state, next, grant.request, sourceId)
            // P1 partitions derived records by a single audience. A grant to
            // read multiple audiences never authorizes a public publication.
            if (original.visibility.audienceSetId !== record.visibility.audienceSetId) denied('derived audience must match its source partition')
          }
          const spans = isEvent ? record.sources : record.exactAnchors
          for (const span of spans) { if (!sourceIds.includes(span.sourceRevisionId)) invalid('anchor coverage'); await this.#verifySpan(state, next, grant.request, span) }
          let dependencies: string[] = []
          let metadata: Record<string, unknown>
          if (isEvent) {
            if (record.acceptedSeq !== Math.max(...sourceIds.map(id => next.bindings.get(id)!.acceptedSeq!))) invalid('event accepted sequence provenance')
            if (record.epistemic === 'world' && ['character_statement', 'inference'].includes(record.authority)) denied('world event authority')
            if (record.payload.kind === 'correction' && !['explicit_ooc', 'user_canon'].includes(record.authority)) denied('correction requires explicit authority')
            if (['user_canon', 'explicit_ooc'].includes(record.authority) && !sourceIds.some(id => state.sources.get(id)?.origin === 'user_control')) denied('event authority provenance')
            if (record.authority === 'accepted_narration' && !sourceIds.some(id => state.sources.get(id)?.role === 'assistant')) denied('narration provenance')
            if (record.supersedes.some(id => !next.records.has(id))) invalid('event supersession target')
            for (const id of [...record.supersedes, ...(record.payload.kind === 'correction' ? record.payload.targetEventIds : [])]) {
              const target = next.records.get(id)
              if (!target || target.kind !== 'event') invalid('event correction target')
              if (!this.#visible(target.visibility, grant.request) || target.visibility.audienceSetId !== record.visibility.audienceSetId) denied('event correction target audience')
              const original = parseRecord({ kind: 'event', record: JSON.parse(payloads.get(target.blobId) ?? await this.#readBlob(grant.request.workspaceId, target.blobId, target.bodySha256)) })
              if (!original.ok || original.value.kind !== 'event') error('source_unavailable', 'RP correction target unavailable')
              if (original.value.record.payload.kind === 'canon_assertion' && original.value.record.payload.locked && !['explicit_ooc', 'user_canon'].includes(record.authority)) denied('locked canon requires explicit user correction')
            }
            dependencies = eventDependencies(record)
            const growth = growthValue(record), person = personValue(record)
            if (person?.operation === 'init' && !batch.events.some(e => e.id === person.causeEventIds[0] && semanticProtocol(e) === 'person-origin/v1')) invalid('initial person fields require the same origin transaction')
            if (growth || person) {
              if (batch.invalidatedIds.length || batch.events.some(e => e.supersedes.length || e.payload.kind === 'correction')) invalid('growth and retcon must be separate controls')
              growthHistory ??= await this.#readEventBodies(state, inheritedBase, grant.request)
              checkGrowthTransition(record, [...growthHistory, ...batch.events.slice(0, batch.events.indexOf(record))])
              checkPersonTransition(record, [...growthHistory, ...batch.events.slice(0, batch.events.indexOf(record))])
            }
            if (dependencies.some(id => !next.records.has(id) || !this.#activeRecords(next).get(id)?.active)) invalid('semantic event dependency')
            for (const id of dependencies) {
              const dependency = next.records.get(id)!
              if (!this.#visible(dependency.visibility, grant.request) || dependency.visibility.audienceSetId !== record.visibility.audienceSetId) denied('semantic event dependency audience')
              if ((growth ?? person)?.causeEventIds.includes(id) && dependency.sourceRevisionIds.some(id => !sourceIds.includes(id))) invalid('growth cause source coverage')
            }
            const { payload: _payload, fictionalTime: _time, ...rest } = record; metadata = rest
          } else {
            if (!same(record.createdFrom, current.fence)) error('stale_input', 'RP summary fence changed')
            dependencies = [...record.dependencySummaryIds, ...record.supportEventIds]
            if (dependencies.some(id => !next.records.has(id) || !this.#activeRecords(next).get(id)?.active)) invalid('summary dependencies')
            for (const id of dependencies) {
              const dependency = next.records.get(id)!
              if (dependency.visibility.audienceSetId !== record.visibility.audienceSetId || !this.#visible(dependency.visibility, grant.request)) denied('summary dependency audience')
              if (dependency.sourceRevisionIds.some(id => !sourceIds.includes(id))) invalid('summary dependency source coverage')
            }
            const { text: _text, ...rest } = record; metadata = rest
          }
          this.#assertPayloadAvailable(state, digest(record))
          const encoded = canonical(record), bodySha256 = sha(encoded), body = { blobId: 'blob_' + bodySha256, bodySha256 }
          payloads.set(body.blobId, encoded)
          const stored: Derived = { id: record.id, kind: isEvent ? 'event' : 'summary', blobId: body.blobId, bodySha256: body.bodySha256, scope: record.scope,
            sourceRevisionIds: sourceIds, dependencyIds: dependencies, visibility: record.visibility, policyVersion: record.policyVersion, active: true, metadata }
          records.push(stored); next.records.set(record.id, stored)
        }
        const jobs = batch.jobs.map(job => {
          if (current.jobs.has(job.id)) {
            if (!grant.request.permissions.includes('control')) denied('job completion requires host control')
            const expected = batch.expectedJobs?.find(j => j.id === job.id); if (!expected) invalid('job completion expected state')
            this.#checkJobTransition(current, expected, job, true)
            if (!job.summaryId || !batch.summaries.some(s => s.id === job.summaryId)) invalid('atomic job summary result')
            return job
          }
          if (identifiers.has(job.id) || job.state !== 'queued' || job.attempts !== 0 || !same(job.inputFence, current.fence)) invalid('new job identity/fence/state')
          identifiers.add(job.id)
          // An atomic enqueue supplied against expected input runs on the newly
          // accepted head, not on the old head that this commit superseded.
          return { ...job, inputFence: result }
        })
        const invalidated = new Set(batch.invalidatedIds)
        for (const event of batch.events) { event.supersedes.forEach(id => invalidated.add(id)); if (event.payload.kind === 'correction') event.payload.targetEventIds.forEach(id => { if (!current.records.has(id)) invalid('correction target'); invalidated.add(id) }) }
        for (const old of current.bindings.values()) if (old.disposition === 'accepted' && next.bindings.get(old.sourceRevisionId)?.disposition !== 'accepted') invalidated.add(old.sourceRevisionId)
        for (const change of changes) if (change.kind === 'deletion') { change.record.sourceRevisionIds.forEach(id => invalidated.add(id)); change.record.blockedDerivedIds.forEach(id => invalidated.add(id)) }
        // Old summaries can predate their supporting events. Invalidate their
        // shared provenance without retracting the original historical source.
        const affectedSources = new Set<string>(), activeBefore = this.#activeRecords(current)
        // Freeze the invalidated historical closure. Explicit replay can reuse
        // the source after confirmation, but never revive its old derived view.
        let grew = true
        while (grew) {
          grew = false
          for (const eventId of invalidated) { const old = activeBefore.get(eventId); if (old?.active && old.kind === 'event') old.sourceRevisionIds.forEach(sourceId => affectedSources.add(sourceId)) }
          for (const record of current.records.values()) if (!invalidated.has(record.id) && ([...record.sourceRevisionIds, ...record.dependencyIds].some(id => invalidated.has(id)) || (activeBefore.get(record.id)?.active && record.kind === 'summary' && record.sourceRevisionIds.some(id => affectedSources.has(id))))) { invalidated.add(record.id); grew = true }
        }
        await this.#authorize(authority, 'commit')
        const operation: Operation = { kind: 'commit', branchId: grant.request.branchId, expected: batch.expected, result, sourceBindings: batch.sourceBindings,
          records, jobs, invalidatedIds: [...invalidated], authorityChanges: changes, ...(batch.expectedJobs ? { expectedJobs: batch.expectedJobs } : {}) }
        await this.#append(grant.request.workspaceId, state, key, effect, operation, true, async () => {
          for (const body of payloads.values()) await this.#blob(grant.request.workspaceId, body)
          await this.#authorize(authority, 'commit')
        })
        return ok(result)
      })
    } catch (cause) { return failure(cause) }
  }
  #historical(state: WorkspaceState, branchId: string, revision: number): BranchState {
    let cache = this.#history.get(state)
    if (!cache) { cache = new Map(); this.#history.set(state, cache) }
    const key = branchId + ':' + revision, known = cache.get(key)
    if (known && known.sequence <= state.transactions.length) return structuredClone(known.branch)
    const historical = emptyState()
    this.#history.set(historical, cache)
    for (const transaction of state.transactions) {
      this.#apply(historical, transaction.operation)
      historical.transactions.push(transaction)
      const branch = historical.branches.get(branchId)
      if (branch?.fence.contextRevision === revision) {
        cache.set(key, { sequence: historical.transactions.length, branch: structuredClone(branch) })
        return branch
      }
    }
    return error('stale_input', 'RP parent revision unavailable')
  }
  forkManifest(authority: HostAuthority, revision: number): Promise<Result<ForkManifest>> {
    return this.#read(authority, (state, _branch, request) => {
      if (!request.permissions.includes('control') || request.viewpoint.kind !== 'narrator') denied('fork requires narrator host control')
      integer(revision)
      const parent = this.#historical(state, request.branchId, revision)
      for (const b of parent.bindings.values()) { const s = state.sources.get(b.sourceRevisionId); if (!s || !this.#visible(s.visibility, request)) denied('fork prefix audience') }
      if ([...parent.records.values()].some(r => !this.#visible(r.visibility, request))) denied('fork derived audience')
      return { parentRevision: revision, prefixManifestHash: this.#manifest(parent), validityManifestHash: this.#validityManifest(parent) }
    })
  }
  async #fork(authority: HostAuthority, input: ForkManifest & { readonly idempotencyKey: string }): Promise<Result<Branch>> {
    try {
      const { grant } = await this.#authorize(authority, 'control'), value = cloneInput(input)
      object(value, ['idempotencyKey', 'parentRevision', 'prefixManifestHash', 'validityManifestHash']); text(value.idempotencyKey, 256); integer(value.parentRevision); hash(value.prefixManifestHash); hash(value.validityManifestHash)
      if (grant.request.viewpoint.kind !== 'narrator') denied('fork requires narrator')
      return await lock(this.#workspacePath(grant.request.workspaceId), async () => {
        await this.#authorize(authority, 'control')
        const state = await this.#load(grant.request.workspaceId); this.#branch(state, grant.request)
        const key = 'fork:' + grant.request.branchId + ':' + sha(value.idempotencyKey), effect = digest(value), existing = state.transactions.find(tx => tx.idempotencyKey === key)
        if (existing) { if (existing.effectHash !== effect || existing.operation.kind !== 'fork') error('idempotency_conflict', 'RP fork idempotency conflict'); await this.#seal(grant.request.workspaceId, existing.sequence, digest(existing)); return ok(existing.operation.branch) }
        const parent = this.#historical(state, grant.request.branchId, value.parentRevision)
        if (value.prefixManifestHash !== this.#manifest(parent) || value.validityManifestHash !== this.#validityManifest(parent)) error('stale_input', 'RP fixed prefix validity changed')
        for (const b of parent.bindings.values()) {
          const source = state.sources.get(b.sourceRevisionId)
          if (!source || !this.#visible(source.visibility, grant.request)) denied('fork prefix audience')
          if (this.#workspaceDeleted(state).has(source.id)) error('source_unavailable', 'RP deleted prefix cannot be forked')
        }
        if ([...parent.records.values()].some(r => !this.#visible(r.visibility, grant.request))) denied('fork derived audience')
        const branchId = newId('branch'), bindings = new Map([...parent.bindings].map(([id, b]) => [id, { ...b, branchId }]))
        const sourceManifestHash = this.#manifest({ ...parent, bindings })
        const branch: Branch = { schemaVersion: 1, id: branchId, workspaceId: grant.request.workspaceId, campaignId: grant.request.campaignId, contextRevision: 0,
          parent: { branchId: parent.branch.id, contextRevision: value.parentRevision, prefixManifestHash: value.prefixManifestHash, validityManifestHash: value.validityManifestHash },
          activeSourceManifestHash: sourceManifestHash, canonBindingsHash: parent.fence.canonBindingsHash }
        const fence: InputFence = { ...parent.fence, branchId, contextRevision: 0, sourceManifestHash }
        await this.#append(grant.request.workspaceId, state, key, effect, { kind: 'fork', branch, fence, parentBranchId: parent.branch.id, parentRevision: value.parentRevision })
        return ok(branch)
      })
    } catch (cause) { return failure(cause) }
  }
  async #authorizePrivacyScope(state: WorkspaceState, workspaceId: string, deletion: PrivacyDeletion, authorities: readonly HostAuthority[]): Promise<void> {
    const grants = new Map<string, AuthorityRequest>()
    for (const handle of authorities) {
      const { grant } = await this.#authorize(handle, 'control')
      if (grant.request.workspaceId !== workspaceId || grant.request.viewpoint.kind !== 'narrator') denied('privacy affected authority')
      this.#branch(state, grant.request); grants.set(grant.request.branchId, grant.request)
    }
    const sources = deletion.sourceRevisionIds.map(id => state.sources.get(id)), blocked = new Set(deletion.blockedDerivedIds)
    for (const branchId of deletion.affectedBranchIds) {
      const branch = state.branches.get(branchId), request = grants.get(branchId)
      if (!branch || !request) denied('privacy affected authority is missing')
      if (sources.some(source => !source || ((branch.bindings.has(source.id) || ((source.scope.kind === 'branch' || source.scope.kind === 'session') && source.scope.branchId === branchId)) && !this.#visible(source.visibility, request)))
        || [...branch.records.values()].some(record => blocked.has(record.id) && !this.#visible(record.visibility, request))
        || [...state.copies.values()].some(copy => copy.branchId === branchId && blocked.has(copy.id) && !this.#visible(copy.visibility, request))) denied('privacy affected audience is missing')
    }
  }
  async #privacyDelete(authority: HostAuthority, controlSourceId: string, input: { readonly idempotencyKey: string; readonly expected: InputFence; readonly sourceRevisionIds: readonly string[]; readonly affectedBranchIds: readonly string[] }, authorities: readonly HostAuthority[]): Promise<Result<PrivacyDeletion>> {
    try {
      const { grant } = await this.#authorize(authority, 'control'), value = cloneInput(input)
      object(value, ['idempotencyKey', 'expected', 'sourceRevisionIds', 'affectedBranchIds']); text(value.idempotencyKey, 256); validateFence(value.expected); id(controlSourceId)
      for (const list of [value.sourceRevisionIds, value.affectedBranchIds]) { if (!Array.isArray(list) || !list.length || list.length > 2048 || new Set(list).size !== list.length) invalid('privacy scope'); list.forEach(id) }
      if (grant.request.viewpoint.kind !== 'narrator') denied('privacy requires narrator control')
      const directory = this.#workspacePath(grant.request.workspaceId)
      return await lock(directory, async () => {
        await this.#authorize(authority, 'control')
        const state = await this.#load(grant.request.workspaceId), branch = this.#branch(state, grant.request)
        const operationId = grant.request.branchId + ':' + value.idempotencyKey, key = 'privacy:' + sha(operationId), effect = digest({ value, controlSourceId })
        const existing = state.transactions.find(tx => tx.idempotencyKey === key)
        if (existing) { this.#assertAuditAudience(state, branch, grant.request); if (existing.effectHash !== effect || existing.operation.kind !== 'privacy') error('idempotency_conflict', 'RP privacy idempotency conflict'); const deletion = state.privacy.get(operationId)!; await this.#authorizePrivacyScope(state, grant.request.workspaceId, deletion, authorities); await this.#seal(grant.request.workspaceId, existing.sequence, digest(existing)); return ok(deletion) }
        if (!same(value.expected, branch.fence)) error('stale_input', 'RP privacy input changed')
        const control = state.sources.get(controlSourceId)
        if (!control || control.origin !== 'user_control' || (control.scope.kind !== 'branch' && control.scope.kind !== 'session') || control.scope.branchId !== branch.branch.id || !this.#visible(control.visibility, grant.request) || this.#workspaceDeleted(state).has(control.id)) denied('privacy requires actual user control source')
        const selected = value.sourceRevisionIds.map(id => state.sources.get(id))
        if (selected.some(s => !s || !this.#scopeMatches(s.scope, grant.request) || !this.#visible(s.visibility, grant.request))) denied('privacy source authority')
        if (selected.some(s => s!.origin === 'approved_publication')) error('capability_missing', 'RP approved publication deletion requires explicit global coordination')
        const sourceHashes = new Set(selected.map(s => s!.publicTextSha256)), allSources = [...state.sources.values()].filter(s => sourceHashes.has(s.publicTextSha256))
        const sourceIds = new Set(allSources.map(s => s.id)), blocked = new Set(sourceIds), blobIds = new Set(allSources.map(s => s.blobId))
        const allRecords = [...state.branches.values()].flatMap(b => [...b.records.values()]), allCopies = [...state.copies.values()]
        let grew = true
        while (grew) {
          grew = false
          for (const source of state.sources.values()) if (!sourceIds.has(source.id) && blobIds.has(source.blobId)) { sourceIds.add(source.id); blocked.add(source.id); allSources.push(source); grew = true }
          for (const r of [...allRecords, ...allCopies]) if (!blocked.has(r.id) && (blobIds.has(r.blobId) || [...r.sourceRevisionIds, ...r.dependencyIds].some(id => blocked.has(id)))) { blocked.add(r.id); blobIds.add(r.blobId); grew = true }
        }
        // Content-address aliases may be unrelated accepted originals. A branch
        // name alone is insufficient consent: require every affected original
        // source ID and every affected branch to be named by the user control.
        if (!same([...value.sourceRevisionIds].sort(), [...sourceIds].sort())) denied('privacy physical source aliases require explicit source scope')
        if (allSources.some(source => source.origin === 'approved_publication')) error('capability_missing', 'RP approved publication aliases require separate global coordination')
        // Failed pre-publication writes are unbound payloads, never accepted
        // history. Reclaim these store-owned orphans under the same write lock.
        const referenced = new Set([...state.sources.values(), ...allRecords, ...allCopies].map(r => r.blobId))
        for (const file of await fs.readdir(path.join(directory, 'blobs'))) {
          const match = /^(blob_[a-f0-9]{64})\.blob(?:\.tmp-[a-f0-9-]+)?$/u.exec(file)
          if (match && !referenced.has(match[1])) blobIds.add(match[1])
        }
        const affected = [...state.branches.values()].filter(b => allSources.some(s => (s.scope.kind === 'branch' || s.scope.kind === 'session') && s.scope.branchId === b.branch.id) || [...b.bindings.keys()].some(id => sourceIds.has(id)) || [...b.records.keys()].some(id => blocked.has(id)) || allCopies.some(c => c.branchId === b.branch.id && blocked.has(c.id)))
        const affectedIds = affected.map(b => b.branch.id).sort()
        if (!same([...value.affectedBranchIds].sort(), affectedIds)) denied('privacy affected scope must be explicitly authorized')
        const deletion: PrivacyDeletion = { operationId, sourceRevisionIds: [...sourceIds].sort(), affectedBranchIds: affectedIds, blockedDerivedIds: [...blocked].filter(id => !sourceIds.has(id)).sort(), blobIds: [...blobIds].sort(), purgeState: 'blocked',
          externalLimitations: ['host_log_not_managed', 'backups_not_managed', 'external_model_not_managed', 'approved_publications_require_separate_global_operation'] }
        await this.#authorizePrivacyScope(state, grant.request.workspaceId, deletion, authorities)
        const heads = affected.map(b => {
          const sourceBindings: BranchSourceBinding[] = []
          if (b.branch.id === branch.branch.id && b.bindings.get(control.id)?.disposition !== 'accepted') sourceBindings.push({ sourceRevisionId: control.id, branchId: b.branch.id, turnId: control.turnId!, disposition: 'accepted', acceptedSeq: Math.max(0, ...[...b.bindings.values()].map(v => v.acceptedSeq ?? 0)) + 1 })
          const next = structuredClone(b); sourceBindings.forEach(binding => next.bindings.set(binding.sourceRevisionId, binding))
          return { branchId: b.branch.id, expected: b.fence, result: { ...b.fence, contextRevision: b.fence.contextRevision + 1, deletionGeneration: b.fence.deletionGeneration + 1, sourceManifestHash: this.#manifest(next) }, sourceBindings }
        })
        for (const handle of authorities) await this.#authorize(handle, 'control')
        await this.#append(grant.request.workspaceId, state, key, effect, { kind: 'privacy', deletion, controlSourceId, initiatorBranchId: branch.branch.id, heads })
        return ok(deletion)
      })
    } catch (cause) { return failure(cause) }
  }
  async #purgePrivacy(authority: HostAuthority, inputKey: string, authorities: readonly HostAuthority[]): Promise<Result<PrivacyDeletion>> {
    try {
      const { grant } = await this.#authorize(authority, 'control'); text(inputKey, 256)
      if (grant.request.viewpoint.kind !== 'narrator') denied('purge requires narrator control')
      return await lock(this.#workspacePath(grant.request.workspaceId), async () => {
        await this.#authorize(authority, 'control')
        const state = await this.#load(grant.request.workspaceId), operationId = grant.request.branchId + ':' + inputKey, deletion = state.privacy.get(operationId)
        this.#assertAuditAudience(state, this.#branch(state, grant.request), grant.request)
        if (!deletion) error('source_unavailable', 'RP privacy operation unavailable')
        await this.#authorizePrivacyScope(state, grant.request.workspaceId, deletion, authorities)
        if (deletion.purgeState === 'complete') return ok(deletion)
        // Any failure leaves the already durable block authoritative. No purge
        // acknowledgement is returned until all declared blob copies are gone.
        let ready = true
        try { await this.#options.beforePurge?.() } catch { ready = false }
        // A paused purge may resume under newly narrowed/revoked authority.
        // Recheck the entire physical scope before data or receipt release.
        await this.#authorizePrivacyScope(state, grant.request.workspaceId, deletion, authorities)
        if (!ready) return ok(deletion)
        try {
          const directory = path.join(this.#workspacePath(grant.request.workspaceId), 'blobs'), files = await fs.readdir(directory)
          for (const blobId of deletion.blobIds) for (const file of files.filter(file => file === blobId + '.blob' || file.startsWith(blobId + '.blob.tmp-'))) {
            try { await fs.unlink(path.join(directory, file)); this.#options.onPurge?.(blobId) } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause }
          }
          await this.#syncDirectory(directory)
        } catch { return ok(deletion) }
        await this.#append(grant.request.workspaceId, state, 'purged:' + sha(operationId), digest({ operationId }), { kind: 'purged', operationId })
        return ok({ ...deletion, purgeState: 'complete' })
      })
    } catch (cause) { return failure(cause) }
  }
  /** Internal trusted-host API: never register these methods as model tools. */
  hostControl() {
    return Object.freeze({
      forkBranch: (authority: HostAuthority, input: ForkManifest & { readonly idempotencyKey: string }) => this.#fork(authority, input),
      privacyDelete: (authority: HostAuthority, controlSourceId: string, input: { readonly idempotencyKey: string; readonly expected: InputFence; readonly sourceRevisionIds: readonly string[]; readonly affectedBranchIds: readonly string[] }, authorities: readonly HostAuthority[]) => this.#privacyDelete(authority, controlSourceId, input, authorities),
      purgePrivacy: (authority: HostAuthority, key: string, authorities: readonly HostAuthority[] = [authority]) => this.#purgePrivacy(authority, key, authorities),
      createWorkspace: async (inputRoot: string): Promise<Result<WorkspaceBinding>> => {
        try {
          await this.#profileCheck()
          return await lock(this.#root, async () => {
            const root = await realDirectory(inputRoot), markerFile = path.join(root, '.dsh-rp-workspace.json')
            try { await fs.lstat(markerFile); return await this.#openWorkspace(root) } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause }
            const workspaceId = newId('workspace'), markerNonce = newId('marker'), directory = this.#workspacePath(workspaceId)
            await fs.mkdir(directory)
            for (const name of ['bindings', 'commits', 'seals', 'blobs', 'snapshots', 'indexes', 'jobs', 'archives']) await fs.mkdir(path.join(directory, name))
            const binding: RootBinding = { workspaceId, profileId: this.#profileId, canonicalRootHash: sha(root), migrationRevision: 0, root, directoryIdentity: await directoryIdentity(root), markerNonce }
            await this.#publish(markerFile, canonical({ schemaVersion: 1, profileId: this.#profileId, workspaceId, nonce: markerNonce }), 'transaction', false)
            await this.#writeBinding(binding, ZERO)
            return ok(this.#publicBinding(binding))
          })
        } catch (cause) { return failure(cause) }
      },
      openWorkspace: async (root: string): Promise<Result<WorkspaceBinding>> => { try { await this.#profileCheck(); return await this.#openWorkspace(root) } catch (cause) { return failure(cause) } },
      migrateWorkspace: async (authority: HostAuthority, inputRoot: string): Promise<Result<WorkspaceBinding>> => {
        try {
          const { grant } = await this.#authorize(authority, 'control', false)
          return await lock(this.#workspacePath(grant.request.workspaceId), async () => {
            const { root: old } = await this.#authorize(authority, 'control', false), root = await realDirectory(inputRoot)
            if (root === old.root || !same(await directoryIdentity(root), old.directoryIdentity)) denied('migration requires the same moved directory; copy/restore/cross-volume protocol unsupported')
            try { await fs.lstat(old.root); denied('old root still exists') } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause }
            const moved = { ...old, root, canonicalRootHash: sha(root), migrationRevision: old.migrationRevision + 1 }
            await this.#checkLocation(moved)
            await this.#writeBinding(moved, digest(old))
            return ok(this.#publicBinding(moved))
          })
        } catch (cause) { return failure(cause) }
      },
      createBranch: async (workspaceId: string, campaignId: string): Promise<Result<Branch>> => {
        try {
          await this.#profileCheck(); id(workspaceId); id(campaignId); await this.#rootBinding(workspaceId)
          return await lock(this.#workspacePath(workspaceId), async () => {
            await this.#rootBinding(workspaceId)
            const state = await this.#load(workspaceId), branchId = newId('branch')
            const branch: Branch = { schemaVersion: 1, id: branchId, workspaceId, campaignId, contextRevision: 0, parent: null, activeSourceManifestHash: digest([]), canonBindingsHash: digest([]) }
            const fence: InputFence = { branchId, contextRevision: 0, sourceManifestHash: digest([]), canonBindingsHash: digest([]), visibilityRevision: 0, deletionGeneration: 0, policyVersion: 'rp.v1' }
            await this.#append(workspaceId, state, 'create:' + branchId, digest(branch), { kind: 'branch', branch, fence }, false)
            return ok(branch)
          })
        } catch (cause) { return failure(cause) }
      },
      authorize: async (input: AuthorityRequest): Promise<Result<HostAuthority>> => {
        try {
          await this.#profileCheck()
          const r = cloneInput(input); object(r, ['workspaceId', 'campaignId', 'branchId', 'viewpoint', 'visibility', 'audienceSetIds', 'permissions'], ['sessionId', 'sceneId'])
          id(r.workspaceId); id(r.campaignId); id(r.branchId); validateVisibility(r.visibility)
          if ((r.sessionId === undefined) !== (r.sceneId === undefined)) invalid('session and scene')
          if (r.sessionId !== undefined) { hostId(r.sessionId); id(r.sceneId) }
          const v = object(r.viewpoint, ['kind'], r.viewpoint.kind === 'character' ? ['entityId'] : [])
          if (v.kind === 'character') id(v.entityId); else if (v.kind !== 'narrator') invalid('viewpoint')
          if (!Array.isArray(r.audienceSetIds) || r.audienceSetIds.length > 128 || !r.audienceSetIds.includes(r.visibility.audienceSetId)) invalid('audience grant')
          r.audienceSetIds.forEach(id)
          if (!Array.isArray(r.permissions) || !r.permissions.length || r.permissions.some(p => !['read', 'observe', 'commit', 'control'].includes(p))) invalid('permissions')
          const root = await this.#rootBinding(r.workspaceId), state = await this.#load(r.workspaceId); this.#branch(state, r)
          const scope: BranchScope = r.sessionId ? { kind: 'session', workspaceId: r.workspaceId, campaignId: r.campaignId, branchId: r.branchId, sessionId: r.sessionId, sceneId: r.sceneId! } : { kind: 'branch', workspaceId: r.workspaceId, campaignId: r.campaignId, branchId: r.branchId }
          const handle = Object.freeze({ scope: Object.freeze(scope), viewpoint: Object.freeze(r.viewpoint), visibility: Object.freeze(r.visibility) }) as HostAuthority
          this.#grants.set(handle, { request: r, migrationRevision: root.migrationRevision })
          // Opaque identity MUST survive; `ok` intentionally clones only data.
          return { ok: true, value: handle }
        } catch (cause) { return failure(cause) }
      },
      recoverWriterLock: async (authority: HostAuthority): Promise<Result<'recovered' | 'unlocked'>> => {
        try {
          const { grant } = await this.#authorize(authority, 'control'), directory = this.#workspacePath(grant.request.workspaceId)
          return await serial(directory, async () => {
            await this.#authorize(authority, 'control')
            const recovered = await recoverLock(directory)
            await this.#syncDirectory(directory)
            return ok(recovered)
          })
        } catch (cause) { return failure(cause) }
      },
    })
  }
  async #writeBinding(binding: RootBinding, previousHash: string): Promise<void> {
    const file = path.join(this.#workspacePath(binding.workspaceId), 'bindings', String(binding.migrationRevision).padStart(16, '0') + '.json')
    await this.#publish(file, canonical({ binding, previousHash, sha256: digest(binding) }), 'transaction', false)
  }
  #publicBinding(binding: RootBinding): WorkspaceBinding { const { workspaceId, profileId, canonicalRootHash, migrationRevision } = binding; return { workspaceId, profileId, canonicalRootHash, migrationRevision } }
  async #openWorkspace(inputRoot: string): Promise<Result<WorkspaceBinding>> {
    try {
      const root = await realDirectory(inputRoot), marker = object(await readJson(path.join(root, '.dsh-rp-workspace.json')), ['schemaVersion', 'profileId', 'workspaceId', 'nonce'])
      id(marker.workspaceId)
      if (marker.schemaVersion !== 1 || marker.profileId !== this.#profileId) denied('workspace belongs to another profile')
      const binding = await this.#rootBinding(marker.workspaceId)
      if (binding.root !== root) denied('workspace root requires explicit migration')
      return ok(this.#publicBinding(binding))
    } catch (cause) { if (cause instanceof RpError && cause.code === 'scope_denied') throw cause; denied('workspace root is unbound or replaced') }
  }
}

/** Trusted host bootstrap. profileRoot is resolved by the host, never by tools. */
export async function openRpStore(input: StoreOptions): Promise<{ store: RpStore; control: ReturnType<RpStore['hostControl']> }> {
  text(input.profileRoot, 32768)
  await fs.mkdir(input.profileRoot, { recursive: true })
  const profileRoot = await realDirectory(input.profileRoot), fingerprint = await directoryIdentity(profileRoot), root = path.join(profileRoot, '.dsh-rp', 'v1')
  await fs.mkdir(root, { recursive: true })
  await fs.mkdir(path.join(root, 'workspaces'), { recursive: true })
  const identityFile = path.join(root, 'identity.json')
  const identity = await lock(root, async () => {
    await input.fault?.('profile_locked')
    try { return await readJson(identityFile) } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
      const identity = { schemaVersion: 1, profileId: newId('profile'), rootHash: sha(profileRoot), directoryIdentity: fingerprint }
      const file = await fs.open(identityFile, 'wx'); try { await file.writeFile(canonical(identity)); await file.sync() } finally { await file.close() }
      return identity
    }
  })
  const p = object(identity, ['schemaVersion', 'profileId', 'rootHash', 'directoryIdentity']); id(p.profileId)
  if (p.schemaVersion !== 1 || p.rootHash !== sha(profileRoot) || !same(p.directoryIdentity, fingerprint)) denied('profile identity mismatch')
  const store = new RpStore(input, root, profileRoot, p.profileId, fingerprint)
  return { store, control: store.hostControl() }
}

/** Trusted bootstrap recovery for a profile-root lock, available before open.
 * Existing profile/directory identity must match; no timeout-based stealing. */
export async function recoverRpProfileLock(input: { readonly profileRoot: string }): Promise<Result<'recovered' | 'unlocked'>> {
  try {
    const r = object(input, ['profileRoot']), profileRoot = await realDirectory(r.profileRoot), root = path.join(profileRoot, '.dsh-rp', 'v1')
    try {
      const identity = object(await readJson(path.join(root, 'identity.json')), ['schemaVersion', 'profileId', 'rootHash', 'directoryIdentity'])
      id(identity.profileId)
      if (identity.schemaVersion !== 1 || identity.rootHash !== sha(profileRoot) || !same(identity.directoryIdentity, await directoryIdentity(profileRoot))) denied('profile recovery identity mismatch')
    } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause /* interrupted initial bootstrap, no prior identity */ }
    return await serial(root, async () => ok(await recoverLock(root)))
  } catch (cause) { return failure(cause) }
}
