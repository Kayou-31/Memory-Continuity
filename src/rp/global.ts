/** Independent global transactions; approved bodies never alias private story blobs. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { canonical, withRpWriterLock, recoverRpWriterLock, readRpJson } from './store.js'
import { checkedRpJson, MAX_RP_JSON_BYTES, MAX_RP_PUBLISH_BYTES, cloneInput, denied, failure, id, hostId, hash, integer, invalid, object, parseRecord, RpError, scope as validateScope, text, visibility as validateVisibility } from './schema.js'
import type { CanonBinding, Result, Scope, SourceRevision, Visibility } from './types.js'
import { MemoryCoordinator } from './session-policy.js'
export type GlobalScope = Extract<Scope, { kind: 'profile' | 'world' }>
export interface GlobalFence { scope: GlobalScope; scopeRevision: number; visibilityRevision: number; deletionGeneration: number }
export interface GlobalPublication { id: string; key: string; scope: GlobalScope; revision: number; body: string; bodySha256: string; source: SourceRevision; supersedes: string | null; verification: 'source-match' | 'private-source-deleted' }
interface Meta extends Omit<GlobalPublication, 'body' | 'verification'> { privateSourceIds: string[]; revoked: boolean; deleted: boolean; privateDeleted: boolean }
interface State { fence: GlobalFence; publications: Meta[]; keys: Record<string, { effect: string; result: string }>; previousHash: string; seq: number }
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const uid = (prefix: string) => prefix + '_' + randomUUID().replaceAll('-', '')
const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)
export interface Grant { scope: GlobalScope; visibility: Visibility; audienceSetIds: string[]; write: boolean }
type Publish = { idempotencyKey: string; expected: GlobalFence; key: string; body: string; privateSourceIds: readonly string[]; supersedes?: string }
export async function openRpGlobalStore(profileRoot: string, coordinator = new MemoryCoordinator()) {
  const root = path.join(await fs.realpath(profileRoot), '.dsh-rp', 'v1'), identity = object(await readRpJson(path.join(root, 'identity.json')), ['schemaVersion', 'profileId', 'rootHash', 'directoryIdentity'])
  id(identity.profileId); hash(identity.rootHash); object(identity.directoryIdentity, ['dev', 'ino', 'birthtime']); if (identity.schemaVersion !== 1) invalid('global profile schema')
  const identityText = canonical(identity), globalRoot = path.join(root, 'global'), grants = new WeakMap<object, Grant>(), approvals = new WeakSet<object>()
  await fs.mkdir(globalRoot, { recursive: true })
  const check = async () => { if (canonical(await readRpJson(path.join(root, 'identity.json'))) !== identityText) denied('global profile identity changed') }
  const grant = async (authority: object, write = false) => { await check(); const g = grants.get(authority); if (!g || (write && !g.write)) denied('global authority'); return g! }
  const directory = (scope: GlobalScope) => path.join(globalRoot, sha(canonical(scope)))
  const atomic = async (file: string, body: string) => {
    await fs.mkdir(path.dirname(file), { recursive: true }); const tmp = file + '.tmp-' + uid('write'), h = await fs.open(tmp, 'wx', 0o600)
    try { await h.writeFile(body); await h.sync() } finally { await h.close() }
    await fs.rename(tmp, file)
  }
  const validateState = (input: unknown, g: Grant): State => {
        const r = object(input, ['fence', 'publications', 'keys', 'previousHash', 'seq']), f = object(r.fence, ['scope', 'scopeRevision', 'visibilityRevision', 'deletionGeneration'])
        validateScope(f.scope); if (!['world', 'profile'].includes(f.scope.kind)) invalid('global scope'); integer(f.scopeRevision); integer(f.visibilityRevision); integer(f.deletionGeneration); hash(r.previousHash); integer(r.seq, 1)
        if (!Array.isArray(r.publications) || r.publications.length > 4096) invalid('global publications')
        for (const item of r.publications) { const p = object(item, ['id', 'key', 'scope', 'revision', 'bodySha256', 'source', 'supersedes', 'privateSourceIds', 'revoked', 'deleted', 'privateDeleted']); id(p.id); text(p.key, 128); validateScope(p.scope); integer(p.revision, 1); hash(p.bodySha256); const parsed = parseRecord({ kind: 'source', record: p.source }); if (!parsed.ok || p.source.origin !== 'approved_publication' || !same(p.source.scope, g.scope) || !same(p.scope, g.scope) || p.source.publicTextSha256 !== p.bodySha256) invalid('approved global source'); if (p.supersedes !== null) id(p.supersedes); if (!Array.isArray(p.privateSourceIds) || p.privateSourceIds.length > 256) invalid('global private references'); p.privateSourceIds.forEach(id); for (const key of ['revoked', 'deleted', 'privateDeleted']) if (typeof p[key] !== 'boolean') invalid('publication status') }
        const keys = object(r.keys, [], Object.keys(r.keys)); if (Object.keys(keys).length > 4096) invalid('global keys'); for (const [key, val] of Object.entries(keys)) { hash(key); const k = object(val, ['effect', 'result']); hash(k.effect); if (k.result !== '') id(k.result) }
        return r as State
  }
  const load = async (g: Grant): Promise<State> => {
    const dir = directory(g.scope); let names: string[]
    const readSeal = async () => { try { const s = object(await readRpJson(path.join(dir, 'seal.json')), ['seq', 'hash']); integer(s.seq, 1); hash(s.hash); return s as { seq: number; hash: string } } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; return undefined } }
    const initialSeal = await readSeal()
    try { names = (await fs.readdir(path.join(dir, 'commits'))).filter(f => /^\d{16}\.json$/u.test(f)).sort() } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; names = [] }
    let state: State = { fence: { scope: g.scope, scopeRevision: 0, visibilityRevision: 0, deletionGeneration: 0 }, publications: [], keys: {}, previousHash: '0'.repeat(64), seq: 0 }
    const hashes = new Map<number, string>()
    for (const name of names) {
      let envelope: Record<string, any>, value: State
      try {
        envelope = object(await readRpJson(path.join(dir, 'commits', name)), ['state', 'sha256']); hash(envelope.sha256)
        value = validateState(envelope.state, g)
      } catch (e) { throw new RpError('store_corrupt', 'Global metadata schema corrupt: ' + (e instanceof Error ? e.message : 'invalid')) }
      if (sha(canonical(value)) !== envelope.sha256 || value.seq !== state.seq + 1 || value.previousHash !== sha(canonical(state)) || !same(value.fence.scope, g.scope)) throw new RpError('store_corrupt', 'Global transaction chain corrupt')
      state = value
      hashes.set(state.seq, envelope.sha256)
    }
    const seal = await readSeal()
    if (!same(initialSeal ?? null, seal ?? null)) throw new RpError('stale_input', 'Global publication changed during read')
    if (state.seq > (seal?.seq ?? 0) + 1) throw new RpError('store_corrupt', 'Global unsealed transaction chain')
    if (seal && (seal.seq > state.seq || hashes.get(seal.seq) !== seal.hash)) throw new RpError('store_corrupt', 'Global committed transaction missing')
    return state
  }
  const allowed = (g: Grant, p: Meta) => same(p.scope, g.scope) && p.source.visibility.policyId === g.visibility.policyId && p.source.visibility.revision === g.visibility.revision && g.audienceSetIds.includes(p.source.visibility.audienceSetId)
  const purge = async (state: State, g: Grant, value: any) => {
    const affected = state.publications.filter(p => p.deleted && (value.privateSourceIds ? p.privateSourceIds.some(x => value.privateSourceIds.includes(x)) : allowed(g, p)))
    if (affected.some(p => !allowed(g, p))) denied('approved purge audience')
    try { for (const p of affected) await fs.rm(path.join(directory(g.scope), 'blobs', p.source.id, p.source.blobId + '.txt'), { force: true }) }
    catch { throw new RpError('persistence_uncertain', 'Approved tombstone committed; physical purge incomplete, retry the same operation') }
  }
  const read = async (authority: object, publicationId: string): Promise<Result<GlobalPublication>> => {
    try {
      const g = await grant(authority); id(publicationId); const state = await load(g), p = state.publications.find(p => p.id === publicationId)
      if (!p || !allowed(g, p)) denied('global publication scope')
      if (p!.revoked || p!.deleted) throw new RpError('source_unavailable', 'Global publication is unavailable')
      let body: string
      try { body = await fs.readFile(path.join(directory(g.scope), 'blobs', p!.source.id, p!.source.blobId + '.txt'), 'utf8') } catch { throw new RpError('source_unavailable', 'Global approved source unavailable') }
      if (sha(body) !== p!.bodySha256) throw new RpError('source_unavailable', 'Global approved source hash mismatch')
      await grant(authority)
      const latest = await load(g); if (!same(latest.fence, state.fence)) throw new RpError('stale_input', 'Global read changed')
      const { privateSourceIds: _private, revoked: _revoked, deleted: _deleted, privateDeleted, ...publicMeta } = p!
      return ok({ ...publicMeta, body, verification: privateDeleted ? 'private-source-deleted' : 'source-match' })
    } catch (e) { return failure(e) }
  }
  const mutate = async (authority: object, approval: object, input: unknown, update: (s: State, g: Grant, v: any, blobs: { file: string; body: string }[]) => Promise<string>, publication = false): Promise<Result<GlobalPublication | GlobalFence>> => {
    let published = false
    try {
      const g = await grant(authority, true); if (!approvals.has(approval)) denied('trusted global command approval required')
      const value = cloneInput(input) as any; text(value.idempotencyKey, 256); const effect = sha(canonical(value))
      return await coordinator.mutate(async () => {
        await grant(authority, true); if (!approvals.has(approval)) denied('global command approval revoked'); const dir = directory(g.scope); await fs.mkdir(dir, { recursive: true })
        return withRpWriterLock(dir, async () => {
          const current = await load(g), commandKey = sha(value.idempotencyKey), prior = current.keys[commandKey]
          const sealHead = async () => {
            if (current.seq === 0) return
            const target = path.join(dir, 'seal.json'), expected = { seq: current.seq, hash: sha(canonical(current)) }
            let existing: unknown; try { existing = await readRpJson(target) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
            if (!same(existing ?? null, expected)) await atomic(target, canonical(expected))
          }
          if (prior) { if (prior.effect !== effect) throw new RpError('idempotency_conflict', 'Global command differs'); published = true; await sealHead(); await purge(current, g, value); return prior.result ? read(authority, prior.result) : ok(current.fence) }
          if (!same(current.fence, value.expected)) throw new RpError('stale_input', 'Global fence changed')
          await sealHead()
          const next = structuredClone(current), blobs: { file: string; body: string }[] = [], result = await update(next, g, value, blobs)
          next.fence.scopeRevision++; next.previousHash = sha(canonical(current)); next.seq++; next.keys[commandKey] = { effect, result }
          if (next.publications.length > 4096 || Object.keys(next.keys).length > (publication ? 3072 : 4096)) throw new RpError('capacity_exceeded', 'Global metadata count limit; old state preserved')
          validateState(next, g)
          const encoded = checkedRpJson({ state: next, sha256: sha(canonical(next)) }, canonical, publication ? MAX_RP_PUBLISH_BYTES : MAX_RP_JSON_BYTES)
          await grant(authority, true); if (!approvals.has(approval)) denied('global command approval revoked before publication')
          for (const blob of blobs) await atomic(blob.file, blob.body)
          const commitFile = path.join(dir, 'commits', String(next.seq).padStart(16, '0') + '.json')
          try { await atomic(commitFile, encoded); published = true } catch (e) {
            // A rename may have succeeded before an adapter reported an error.
            try { published = await fs.readFile(commitFile, 'utf8') === encoded } catch (readError) { if ((readError as NodeJS.ErrnoException).code !== 'ENOENT') published = true }
            throw e
          }
          await atomic(path.join(dir, 'seal.json'), canonical({ seq: next.seq, hash: sha(canonical(next)) }))
          // Tombstone is durable before any approved body is removed.
          await purge(next, g, value)
          return result ? read(authority, result) : ok(next.fence)
        })
      })
    } catch (e) { return failure(e instanceof RpError ? e : new RpError(published ? 'persistence_uncertain' : 'persistence_failed', e instanceof Error ? e.message : 'Global persistence failure')) }
  }
  const store = {
    async listActive(authority: object) { try { const g = await grant(authority), state = await load(g), heads = new Map<string, Meta>(); for (const p of state.publications) heads.set(p.key, p); const values: GlobalPublication[] = []; for (const p of heads.values()) if (allowed(g, p) && !p.revoked && !p.deleted) { const r = await read(authority, p.id); if (!r.ok) return r; values.push(r.value) }; return ok(values) } catch (e) { return failure(e) } },
    async readFence(authority: object): Promise<Result<GlobalFence>> { try { return ok((await load(await grant(authority))).fence) } catch (e) { return failure(e) } },
    readPublication: read,
    async list(authority: object) { try { const g = await grant(authority), state = await load(g); const values: GlobalPublication[] = []; for (const p of state.publications) if (allowed(g, p) && !p.revoked && !p.deleted) { const r = await read(authority, p.id); if (!r.ok) return r; values.push(r.value) } return ok(values) } catch (e) { return failure(e) } },
    async verifyBinding(authority: object, binding: CanonBinding) { const r = await read(authority, binding.publicationId); return r.ok && r.value.scope.kind === 'world' && r.value.scope.worldId === binding.worldId && r.value.scope.entityId === binding.entityId && r.value.revision === binding.revision && r.value.bodySha256 === binding.bodySha256 },
  }
  const control = {
    async purgeStatus(authority: object) { try { const g = await grant(authority), s = await load(g), values = []; for (const p of s.publications.filter(p => allowed(g, p) && p.deleted)) { let exists = true; try { await fs.lstat(path.join(directory(g.scope), 'blobs', p.source.id, p.source.blobId + '.txt')) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') exists = false; else throw e }; values.push({ publicationId: p.id, purgeState: exists ? 'blocked' : 'complete' }) }; return ok(values) } catch (e) { return failure(e) } },
    isApproval(handle: object) { return approvals.has(handle) },
    async authorize(input: Grant): Promise<Result<object>> { try { await check(); const g = cloneInput(input); object(g, ['scope', 'visibility', 'audienceSetIds', 'write']); validateScope(g.scope); validateVisibility(g.visibility); if (!['profile', 'world'].includes(g.scope.kind) || g.scope.profileId !== identity.profileId || typeof g.write !== 'boolean' || !Array.isArray(g.audienceSetIds) || !g.audienceSetIds.includes(g.visibility.audienceSetId)) denied('global profile/scope grant'); g.audienceSetIds.forEach(id); const handle = Object.freeze({}); grants.set(handle, g); return ok(handle) } catch (e) { return failure(e) } },
    async revokeAuthority(authority: object) { await coordinator.mutate(async () => { grants.delete(authority) }) },
    async recoverWriterLock(authority: object): Promise<Result<'unlocked' | 'recovered'>> { try { const g = await grant(authority, true); return ok(await coordinator.mutate(() => recoverRpWriterLock(directory(g.scope)))) } catch (e) { return failure(e) } },
    approval(input: { commandId: string; sessionId: string }) { id(input.commandId); hostId(input.sessionId); const handle = Object.freeze({}); approvals.add(handle); return handle },
    revokeApproval(handle: object) { approvals.delete(handle) },
    publish(authority: object, approval: object, input: Publish) {
      return mutate(authority, approval, input, async (s, g, v, blobs) => {
        object(v, ['idempotencyKey', 'expected', 'key', 'body', 'privateSourceIds'], ['supersedes']); text(v.key, 128); text(v.body, 1048576); if (!Array.isArray(v.privateSourceIds) || v.privateSourceIds.length > 256) invalid('private source IDs'); v.privateSourceIds.forEach(id)
        if (g.scope.kind === 'profile' && !['language', 'person', 'dialogue_format', 'prose_style'].includes(v.key)) denied('global preference whitelist')
        const chain = s.publications.filter(p => p.key === v.key), head = chain.at(-1)
        if (chain.some(p => !allowed(g, p))) denied('global publication chain audience')
        if ((head?.id ?? undefined) !== v.supersedes) throw new RpError('stale_input', 'Explicit publication revision adoption required')
        const bodySha256 = sha(v.body), publicationId = uid('publication'), source: SourceRevision = { schemaVersion: 1, id: uid('approved'), scope: g.scope, origin: 'approved_publication', role: 'user_control', publicTextSha256: bodySha256, publicTextLengthUtf16: v.body.length, blobId: 'blob_' + bodySha256, visibility: g.visibility, capturedAt: new Date().toISOString() }
        blobs.push({ file: path.join(directory(g.scope), 'blobs', source.id, source.blobId + '.txt'), body: v.body })
        s.publications.push({ id: publicationId, scope: g.scope, key: v.key, revision: (head?.revision ?? 0) + 1, bodySha256, source, supersedes: head?.id ?? null, privateSourceIds: [...v.privateSourceIds], privateDeleted: false, revoked: false, deleted: false }); return publicationId
      }, true) as Promise<Result<GlobalPublication>>
    },
    privateDeletion(authority: object, approval: object, input: { idempotencyKey: string; expected: GlobalFence; privateSourceIds: readonly string[]; publicationDisposition: 'retain' | 'delete' }) {
      return mutate(authority, approval, input, async (s, g, v) => { object(v, ['idempotencyKey', 'expected', 'privateSourceIds', 'publicationDisposition']); if (!Array.isArray(v.privateSourceIds) || !['retain', 'delete'].includes(v.publicationDisposition)) invalid('explicit approved publication deletion disposition'); v.privateSourceIds.forEach(id); const affected = s.publications.filter(p => p.privateSourceIds.some(x => v.privateSourceIds.includes(x))); if (affected.some(p => !allowed(g, p))) denied('global deletion affected audience'); for (const p of affected) { p.privateDeleted = true; if (v.publicationDisposition === 'delete') p.deleted = true } s.fence.deletionGeneration++; return '' }) as Promise<Result<GlobalFence>>
    },
    revoke(authority: object, approval: object, input: { idempotencyKey: string; expected: GlobalFence; publicationId: string }) { return mutate(authority, approval, input, async (s, g, v) => { object(v, ['idempotencyKey', 'expected', 'publicationId']); const p = s.publications.find(p => p.id === v.publicationId); if (!p || !allowed(g, p)) denied('publication revoke'); p!.revoked = true; s.fence.visibilityRevision++; return '' }) as Promise<Result<GlobalFence>> },
  }
  return { store, control }
}
