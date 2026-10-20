import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { build, stop } from 'esbuild'
const base = path.resolve('work/rp-retrieval-tests')
await fs.mkdir(base, { recursive: true })
let api = {}
try {
  await fs.access('src/rp/memory.ts')
  const file = path.join(base, 'runtime.mjs')
  await build({ entryPoints: ['src/rp/memory.ts'], outfile: file, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
  api = await import(pathToFileURL(file).href + '?' + randomUUID())
} catch (e) { if (e.code !== 'ENOENT') throw e }
stop()
const must = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value }
const deny = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.code, code) }
const sha = s => createHash('sha256').update(s).digest('hex')
const visibility = { policyId: 'policy_story', revision: 0, audienceSetId: 'public' }
async function setup(options = {}) {
  assert.equal(typeof api.openRpMemory, 'function', 'P3 must provide an independent global store, authorized retrieval and prepared packets')
  const directory = path.join(base, randomUUID()); await fs.mkdir(path.join(directory, 'project'), { recursive: true })
  const f = await api.openRpMemory({ profileRoot: path.join(directory, 'profile'), entityIds: ['erin', 'king', 'key'], ...options })
  const workspace = must(await f.control.createWorkspace(path.join(directory, 'project')))
  const branch = must(await f.control.createBranch(workspace.workspaceId, 'campaign'))
  const request = { workspaceId: workspace.workspaceId, campaignId: 'campaign', branchId: branch.id, sessionId: 'session_story', sceneId: 'scene_story', viewpoint: { kind: 'narrator' }, visibility, audienceSetIds: ['public', 'secret'], permissions: ['read', 'observe', 'commit', 'control'] }
  const authority = must(await f.control.authorize(request))
  const global = must(await f.global.control.authorize({ scope: { kind: 'world', profileId: workspace.profileId, worldId: 'world_one' }, visibility, audienceSetIds: ['public'], write: true }))
  return { ...f, directory, workspace, branch, request, authority, globalAuthority: global }
}
async function source(f, body, key, role = 'assistant', turn = key) {
  return must(await f.store.observeSource(f.authority, { idempotencyKey: key, origin: 'host_public', publicText: body, role, turnId: 'turn_' + turn, host: { sessionId: 'session_story', eventSeq: 1, messageId: 'message_' + key, messageRevision: 'revision_' + key } }))
}
async function ctl(f, key) { return must(await f.store.observeSource(f.authority, { idempotencyKey: 'ctl_' + key, origin: 'user_control', publicText: 'CONTROL_' + key, role: 'user_control', turnId: 'ctl_' + key })) }
async function accept(f, src, key) { return must(await f.canonical.applyControl(f.authority, await ctl(f, key), { kind: 'accept', idempotencyKey: key, expected: must(await f.store.readFence(f.authority)), sourceRevisionIds: [src.id], events: [] })) }
const span = s => ({ sourceRevisionId: s.id, publicTextSha256: s.publicTextSha256, startUtf16: 0, endUtf16: s.publicTextLengthUtf16, quoteSha256: s.publicTextSha256 })
const budget = { recentCompleteTurns: 8, targetTotalTokens: 48000, triggerTotalTokens: 72000, outputReserveTokens: 8192, toolReserveTokens: 2048, packetSoftTokens: 8000, contextWindow: 100000, inputLimit: 90000 }

test('A21 independent approved publication, whitelist, pinned adoption and explicit retained/deleted copies', async () => {
  const f = await setup(), privateSource = await source(f, 'PRIVATE_ROMANCE', 'private'); await accept(f, privateSource, 'private')
  const approval = f.global.control.approval({ commandId: 'command_publish', sessionId: 'session_story' })
  const expected = must(await f.global.store.readFence(f.globalAuthority))
  const p1 = must(await f.global.control.publish(f.globalAuthority, approval, { idempotencyKey: 'publish_one', expected, key: 'character_background', body: 'APPROVED_BACKGROUND', privateSourceIds: [privateSource.id] }))
  assert.equal(p1.source.origin, 'approved_publication'); assert.notEqual(p1.source.id, privateSource.id)
  assert.equal(JSON.stringify(p1).includes('PRIVATE_ROMANCE'), false)
  const fixed = await f.global.store.readPublication(f.globalAuthority, p1.id)
  assert.equal(must(fixed).body, 'APPROVED_BACKGROUND')
  deny(await f.global.control.publish(f.globalAuthority, {}, { idempotencyKey: 'forged', expected, key: 'x', body: 'forged', privateSourceIds: [] }), 'scope_denied')
  await f.adoptCanon(f.authority, f.globalAuthority, approval, p1.id, 'adopt_one')
  const fence1 = must(await f.store.readFence(f.authority))
  const p2 = must(await f.global.control.publish(f.globalAuthority, approval, { idempotencyKey: 'publish_two', expected: must(await f.global.store.readFence(f.globalAuthority)), key: p1.key, body: 'NEW_BACKGROUND', supersedes: p1.id, privateSourceIds: [] }))
  assert.equal(must(await f.store.readFence(f.authority)).canonBindingsHash, fence1.canonBindingsHash)
  assert.equal(must(await f.global.store.readPublication(f.globalAuthority, p1.id)).body, 'APPROVED_BACKGROUND')
  must(await f.adoptCanon(f.authority, f.globalAuthority, approval, p2.id, 'adopt_two'))
  assert.notEqual(must(await f.store.readFence(f.authority)).canonBindingsHash, fence1.canonBindingsHash)
  const pref = must(await f.global.control.authorize({ scope: { kind: 'profile', profileId: f.workspace.profileId }, visibility, audienceSetIds: ['public'], write: true }))
  deny(await f.global.control.publish(pref, approval, { idempotencyKey: 'bad_pref', expected: must(await f.global.store.readFence(pref)), key: 'romance', body: 'PRIVATE_ROMANCE', privateSourceIds: [] }), 'scope_denied')
  must(await f.global.control.publish(pref, approval, { idempotencyKey: 'language', expected: must(await f.global.store.readFence(pref)), key: 'language', body: '中文', privateSourceIds: [] }))
  must(await f.global.control.privateDeletion(f.globalAuthority, approval, { idempotencyKey: 'retain', expected: must(await f.global.store.readFence(f.globalAuthority)), privateSourceIds: [privateSource.id], publicationDisposition: 'retain' }))
  assert.equal(must(await f.global.store.readPublication(f.globalAuthority, p1.id)).verification, 'private-source-deleted')
  must(await f.global.control.privateDeletion(f.globalAuthority, approval, { idempotencyKey: 'remove', expected: must(await f.global.store.readFence(f.globalAuthority)), privateSourceIds: [privateSource.id], publicationDisposition: 'delete' }))
  deny(await f.global.store.readPublication(f.globalAuthority, p1.id), 'source_unavailable')
})

test('A22 authorizes before ranking; fixed search pages 23/7 survive insert and reject crossed or revoked cursors', async () => {
  const f = await setup()
  for (let i = 0; i < 23; i++) { const s = await source(f, 'MATCH_' + String(i).padStart(2, '0'), 's' + i); await accept(f, s, 'a' + i) }
  const first = must(await f.retrieval.search(f.authority, { query: 'MATCH', limit: 7 }))
  const seen = [...first.items.map(x => x.id)]
  const added = await source(f, 'MATCH_NEW', 'new'); await accept(f, added, 'new')
  let cursor = first.nextCursor
  while (cursor) { const page = must(await f.retrieval.search(f.authority, { cursor, limit: 7 })); seen.push(...page.items.map(x => x.id)); cursor = page.nextCursor }
  assert.equal(seen.length, 23); assert.equal(new Set(seen).size, 23); assert.equal(seen.includes(added.id), false)
  const other = must(await f.control.authorize({ ...f.request, viewpoint: { kind: 'character', entityId: 'erin' } }))
  deny(await f.retrieval.search(other, { cursor: first.nextCursor, limit: 7 }), 'scope_denied')
  const chosen = first.items[0], body = must(await f.retrieval.get(f.authority, { id: chosen.id, maxChars: 2 }))
  let text = body.text, bc = body.nextCursor
  while (bc) { const p = must(await f.retrieval.get(f.authority, { cursor: bc, maxChars: 2 })); assert.equal(p.bodySha256, body.bodySha256); text += p.text; bc = p.nextCursor }
  assert.equal(sha(text), body.bodySha256)
  const ledger = must(await f.store.readLedger(f.authority)), src = ledger.sources.find(x => x.id === chosen.id)
  must(await f.canonical.applyControl(f.authority, await ctl(f, 'retract'), { kind: 'retract', idempotencyKey: 'retract', expected: must(await f.store.readFence(f.authority)), sourceRevisionIds: [src.id] }))
  deny(await f.retrieval.search(f.authority, { cursor: first.nextCursor, limit: 7 }), 'snapshot_changed')
  deny(await f.retrieval.get(f.authority, { cursor: body.nextCursor, maxChars: 2 }), 'snapshot_changed')
})

test('A23 complete accepted turn3–10 plus current input; rejected alternatives and controls never count', async () => {
  const f = await setup(), expected = [], all = []
  for (let i = 1; i <= 10; i++) {
    for (const role of ['user', 'assistant']) { const s = await source(f, role + i, role + i, role, String(i)); await accept(f, s, role + i); all.push(s.id); if (i >= 3) expected.push(s.id) }
  }
  const reject = await source(f, 'REJECTED', 'rejected', 'assistant', '10')
  const input = await source(f, 'CURRENT', 'current', 'user', '11'); await accept(f, input, 'current'); expected.push(input.id)
  const packet = must(await f.packets.prepare(f.authority, { budget, globalAuthorities: [], inputBindings: [] }))
  assert.deepEqual(packet.recentSourceIds, expected); assert.equal(JSON.stringify(packet).includes(reject.id), false)
})

test('A24 full final request includes system/tools/metadata; dynamic output reserve never drops mandatory turns', async () => {
  const f = await setup(), s = await source(f, 'PUBLIC', 'one', 'user'); await accept(f, s, 'one')
  const p = must(await f.packets.prepare(f.authority, { budget, globalAuthorities: [], inputBindings: [] }))
  const req = { messages: [{ role: 'system', content: 'SYSTEM'.repeat(200) }], tools: [{ name: 'tool', description: 'SCHEMA'.repeat(200) }], metadata: 'META'.repeat(200), maxTokens: 12000 }
  const result = must(await f.packets.admit(f.authority, p, req))
  assert.equal(result.reserve, 14048); assert.ok(result.inputTokens > 1000); assert.equal(result.mode, 'estimated')
  deny(await f.packets.admit(f.authority, p, { ...req, maxTokens: 100000 }), 'context_budget_exceeded')
  deny(await f.packets.prepare(f.authority, { budget: { ...budget, contextWindow: undefined }, globalAuthorities: [], inputBindings: [] }), 'capability_missing')
})

test('A25 prepared input and separate global fences are rechecked at actual consumption', async () => {
  const f = await setup(), s = await source(f, 'PUBLIC', 'one', 'user'); await accept(f, s, 'one')
  const p = must(await f.packets.prepare(f.authority, { budget, globalAuthorities: [f.globalAuthority], inputBindings: [] }))
  const approval = f.global.control.approval({ commandId: 'global_command', sessionId: 'session_story' })
  must(await f.global.control.publish(f.globalAuthority, approval, { idempotencyKey: 'global_change', expected: must(await f.global.store.readFence(f.globalAuthority)), key: 'rule', body: 'GLOBAL_CHANGE', privateSourceIds: [] }))
  deny(await f.packets.admit(f.authority, p, { messages: [], tools: [], maxTokens: 128 }), 'stale_input')
  deny(await f.packets.admit(f.authority, structuredClone(p), { messages: [], tools: [] }), 'scope_denied')
})

test('A40 root policy shared across bundles; drain, epochs, request read locks and incompatible old owners', async () => {
  assert.equal(typeof api.acquireSessionPolicy, 'function', 'P3 requires a root shared policy')
  const services = new Map(), root = { get: k => services.get(k), provide: (k, v) => { assert.equal(services.has(k), false); services.set(k, v); return () => services.delete(k) } }
  const a = api.acquireSessionPolicy(root, 'engineering'), b = api.acquireSessionPolicy(root, 'rp')
  assert.equal(a.policy, b.policy)
  const owner = b.policy.registerWriter('rp', { drain: async () => {} })
  const active = await b.policy.activate('session_one', 'rp', { idle: true, safe: true })
  assert.equal(api.engineeringAllowed({ get: k => services.get(k) }, 'session_one'), false)
  const unlock = await b.policy.request('session_one', active.epoch)
  let changed = false
  const mutation = b.policy.mutate('session_one', async () => { changed = true })
  await Promise.resolve(); assert.equal(changed, false)
  unlock(); await mutation; assert.equal(changed, true)
  assert.notEqual(b.policy.status('session_one').epoch, active.epoch)
  await owner(); await a.release(); await b.release()
  services.set('ultraEvidenceSupport', { protocol: 'dsh-ultra-evidence/v1' })
  assert.throws(() => api.acquireSessionPolicy(root, 'rp'), /[Ii]ncompatible|[Oo]ld/)
})

test('global narrow audience cannot overwrite/delete hidden publication; queued revoked approval loses authority', async () => {
  const f = await setup(), approval = f.global.control.approval({ commandId: 'publish_secret', sessionId: 'session_story' })
  const secret = must(await f.global.control.authorize({ scope: { kind: 'world', profileId: f.workspace.profileId, worldId: 'world_one' }, visibility: { ...visibility, audienceSetId: 'secret' }, audienceSetIds: ['secret'], write: true }))
  const published = must(await f.global.control.publish(secret, approval, { idempotencyKey: 'secret', expected: must(await f.global.store.readFence(secret)), key: 'hidden_key', body: 'SECRET', privateSourceIds: ['private_source'] }))
  deny(await f.global.control.privateDeletion(f.globalAuthority, approval, { idempotencyKey: 'bad_delete', expected: must(await f.global.store.readFence(f.globalAuthority)), privateSourceIds: ['private_source'], publicationDisposition: 'delete' }), 'scope_denied')
  deny(await f.global.control.publish(f.globalAuthority, approval, { idempotencyKey: 'bad_replace', expected: must(await f.global.store.readFence(f.globalAuthority)), key: 'hidden_key', supersedes: published.id, body: 'PUBLIC', privateSourceIds: [] }), 'scope_denied')
  assert.equal(must(await f.global.store.readPublication(secret, published.id)).body, 'SECRET')
  const release = await f.coordinator.lock(), expected = must(await f.global.store.readFence(secret))
  const pending = f.global.control.publish(secret, approval, { idempotencyKey: 'queued', expected, key: 'queued', body: 'TOO_LATE', privateSourceIds: [] })
  await new Promise(resolve => setTimeout(resolve, 5)); f.global.control.revokeApproval(approval); release()
  deny(await pending, 'scope_denied')
})

test('global corrupt disk schema fails closed and writer recovery never steals a live lock', async () => {
  const f = await setup(), approval = f.global.control.approval({ commandId: 'cmd_disk', sessionId: 'session_story' })
  must(await f.global.control.publish(f.globalAuthority, approval, { idempotencyKey: 'disk', expected: must(await f.global.store.readFence(f.globalAuthority)), key: 'key', body: 'BODY', privateSourceIds: [] }))
  const root = path.join(f.directory, 'profile/.dsh-rp/v1/global'), [scope] = await fs.readdir(root), scopeDir = path.join(root, scope)
  await fs.mkdir(path.join(scopeDir, 'write.lock')); await fs.writeFile(path.join(scopeDir, 'write.lock/owner.json'), JSON.stringify({ token: randomUUID(), pid: process.pid, createdAt: new Date().toISOString() }))
  deny(await f.global.control.recoverWriterLock(f.globalAuthority), 'store_locked')
  await fs.rm(path.join(scopeDir, 'write.lock'), { recursive: true })
  const commitPath = path.join(scopeDir, 'commits/0000000000000001.json'), env = JSON.parse(await fs.readFile(commitPath, 'utf8'))
  env.state.fence.forged = true; env.sha256 = sha(api.canonical(env.state)); await fs.writeFile(commitPath, JSON.stringify(env))
  deny(await f.global.store.readFence(f.globalAuthority), 'store_corrupt')
})

test('A22 fixed body survives changed external verification envelope without retaining a plaintext cursor copy', async () => {
  let verification = 'source-match'
  const f = await setup({ verification: async () => verification }), s = await source(f, 'FIXED_BODY_中文_😀', 'fixed'); await accept(f, s, 'fixed')
  const first = must(await f.retrieval.get(f.authority, { id: s.id, maxChars: 3 })); assert.equal(first.currentStatus.verification, 'source-match')
  verification = 'unavailable'; let text = first.text, cursor = first.nextCursor
  while (cursor) { const page = must(await f.retrieval.get(f.authority, { cursor, maxChars: 3 })); assert.equal(page.currentStatus.verification, 'unavailable'); assert.equal(page.bodySha256, first.bodySha256); text += page.text; cursor = page.nextCursor }
  assert.equal(sha(text), first.bodySha256); assert.equal(text, 'FIXED_BODY_中文_😀')
})

test('global deletion tombstone survives physical purge failure and the same operation retries purge', async () => {
  const f = await setup(), approval = f.global.control.approval({ commandId: 'cmd_purge', sessionId: 'session_story' })
  const p = must(await f.global.control.publish(f.globalAuthority, approval, { idempotencyKey: 'purge_pub', expected: must(await f.global.store.readFence(f.globalAuthority)), key: 'purge', body: 'DELETE_BODY', privateSourceIds: ['private_original'] }))
  const scopes = await fs.readdir(path.join(f.directory, 'profile/.dsh-rp/v1/global')), bodyPath = path.join(f.directory, 'profile/.dsh-rp/v1/global', scopes[0], 'blobs', p.source.id, p.source.blobId + '.txt')
  await fs.unlink(bodyPath); await fs.mkdir(bodyPath)
  const operation = { idempotencyKey: 'purge_delete', expected: must(await f.global.store.readFence(f.globalAuthority)), privateSourceIds: ['private_original'], publicationDisposition: 'delete' }
  deny(await f.global.control.privateDeletion(f.globalAuthority, approval, operation), 'persistence_uncertain')
  deny(await f.global.store.readPublication(f.globalAuthority, p.id), 'source_unavailable')
  assert.equal(must(await f.global.control.purgeStatus(f.globalAuthority))[0].purgeState, 'blocked')
  await fs.rmdir(bodyPath); must(await f.global.control.privateDeletion(f.globalAuthority, approval, operation))
  assert.equal(must(await f.global.control.purgeStatus(f.globalAuthority))[0].purgeState, 'complete')
})

test('root RP-first barrier rejects original old-v1 acquisition semantics; old-first also rejects RP', async () => {
  const services = new Map(), root = { get: k => services.get(k), provide(k, v) { if (services.has(k)) throw Error('duplicate'); services.set(k, v); return () => services.delete(k) } }
  const originalOldAcquire = () => { const service = root.get('ultraEvidenceSupport'); if (service !== undefined) { if (!service || service.protocol !== 'dsh-ultra-evidence/v1' || typeof service.acquire !== 'function') throw Error('incompatible old writer'); return service.acquire() }; const old = { protocol: 'dsh-ultra-evidence/v1', acquire() {} }; root.provide('ultraEvidenceSupport', old); return old }
  const rp = api.acquireSessionPolicy(root, 'rp'); assert.throws(originalOldAcquire, /incompatible/); await rp.release()
  services.delete('ultraEvidenceSupport'); originalOldAcquire(); assert.throws(() => api.acquireSessionPolicy(root, 'rp'), /Incompatible/)
})

test('entity IDs scope source/event/summary/state retrieval, including trusted command input and same-name entities', async () => {
  const f = await setup(), a = await source(f, '艾琳在东门', 'entity_a'), b = await source(f, '艾琳在西门', 'entity_b')
  for (const [s, entity, value] of [[a, 'erin', '东门'], [b, 'king', '西门']]) must(await f.canonical.applyControl(f.authority, await ctl(f, entity), { kind: 'accept', idempotencyKey: entity, expected: must(await f.store.readFence(f.authority)), sourceRevisionIds: [s.id], events: [{ id: 'event_' + entity, payload: { kind: 'state_change', subjectId: entity, key: 'location', after: '艾琳_' + value }, epistemic: 'world' }] }))
  const expected = must(await f.store.readFence(f.authority))
  must(await f.store.commit(f.authority, { schemaVersion: 1, idempotencyKey: 'summary', expected, sourceBindings: [], events: [], jobs: [], invalidatedIds: [], authorityChanges: [], nextContextRevision: expected.contextRevision + 1, summaries: [{ schemaVersion: 1, id: 'summary_erin', scope: f.authority.scope, level: 'scene', createdFrom: expected, sourceRevisionIds: [a.id], dependencySummaryIds: [], supportEventIds: ['event_erin'], exactAnchors: [span(a)], text: '艾琳在东门的摘要', visibility, policyVersion: expected.policyVersion, measuredTokens: 12, tokenMeasurement: 'estimated' }] }))
  const page = must(await f.retrieval.search(f.authority, { query: '艾琳', entityId: 'erin', limit: 20 }))
  assert.deepEqual(new Set(page.items.map(i => i.kind)), new Set(['source', 'event', 'summary', 'state'])); assert.equal(JSON.stringify(page).includes(b.id), false); assert.equal(JSON.stringify(page).includes('event_king'), false)
  assert.equal(must(await f.retrieval.search(f.authority, { query: '艾琳', entityId: 'unknown_entity', limit: 20 })).items.length, 0)
  const input = await ctl(f, 'story_input'); f.registerInputBindings(f.branch.id, [{ kind: 'input', sourceId: input.id, turnId: 'turn_manual', messageId: 'manual_message' }]); await accept(f, input, 'manual_accept')
  assert.equal(must(await f.retrieval.search(f.authority, { query: 'CONTROL_story_input' })).items.some(i => i.id === input.id), true)
})

test('global write capacity validates the same state schema before publication and preserves the old committed state', async () => {
  const f = await setup(), approval = f.global.control.approval({ commandId: 'cmd_capacity', sessionId: 'session_story' })
  const p = must(await f.global.control.publish(f.globalAuthority, approval, { idempotencyKey: 'capacity', expected: must(await f.global.store.readFence(f.globalAuthority)), key: 'key', body: 'BODY', privateSourceIds: [] }))
  const globalRoot = path.join(f.directory, 'profile/.dsh-rp/v1/global'), [scope] = await fs.readdir(globalRoot), dir = path.join(globalRoot, scope), file = path.join(dir, 'commits/0000000000000001.json'), env = JSON.parse(await fs.readFile(file, 'utf8'))
  env.state.keys = Object.fromEntries(Array.from({ length: 4096 }, (_, i) => [sha('key_' + i), { effect: sha('effect_' + i), result: p.id }]))
  env.sha256 = sha(api.canonical(env.state)); await fs.writeFile(file, JSON.stringify(env)); await fs.writeFile(path.join(dir, 'seal.json'), JSON.stringify({ seq: 1, hash: env.sha256 }))
  const expected = must(await f.global.store.readFence(f.globalAuthority))
  deny(await f.global.control.publish(f.globalAuthority, approval, { idempotencyKey: 'overflow', expected, key: 'overflow', body: 'OVERFLOW', privateSourceIds: [] }), 'invalid_record')
  assert.deepEqual(must(await f.global.store.readFence(f.globalAuthority)), expected); assert.equal(await fs.stat(path.join(dir, 'commits/0000000000000002.json')).then(() => true, () => false), false)
})

test('profile superseded preference never reappears when its head is revoked; pinned world revisions stay explicit', async () => {
  const f = await setup(), approval = f.global.control.approval({ commandId: 'cmd_pref', sessionId: 'session_story' }), grant = must(await f.global.control.authorize({ scope: { kind: 'profile', profileId: f.workspace.profileId }, visibility, audienceSetIds: ['public'], write: true }))
  const p1 = must(await f.global.control.publish(grant, approval, { idempotencyKey: 'pref1', expected: must(await f.global.store.readFence(grant)), key: 'language', body: 'OLD', privateSourceIds: [] }))
  const p2 = must(await f.global.control.publish(grant, approval, { idempotencyKey: 'pref2', expected: must(await f.global.store.readFence(grant)), key: 'language', body: 'NEW', privateSourceIds: [], supersedes: p1.id }))
  must(await f.global.control.revoke(grant, approval, { idempotencyKey: 'revoke', expected: must(await f.global.store.readFence(grant)), publicationId: p2.id }))
  assert.deepEqual(must(await f.global.store.listActive(grant)), [])
  const packet = must(await f.packets.prepare(f.authority, { budget, globalAuthorities: [grant], inputBindings: [] })); assert.equal(packet.text.includes('OLD'), false); assert.equal(packet.text.includes('NEW'), false)
})

test('canon adoption rechecks revoked command approval inside the queued store commit', async () => {
  const f = await setup(), approval = f.global.control.approval({ commandId: 'cmd_adopt_queue', sessionId: 'session_story' })
  const p = must(await f.global.control.publish(f.globalAuthority, approval, { idempotencyKey: 'adopt_pub', expected: must(await f.global.store.readFence(f.globalAuthority)), key: 'rule', body: 'CANON', privateSourceIds: [] }))
  const before = must(await f.store.readFence(f.authority)), release = await f.coordinator.lock(), original = f.coordinator.mutate.bind(f.coordinator)
  let reached; const queued = new Promise(resolve => { reached = resolve })
  f.coordinator.mutate = work => { reached(); return original(work) }
  const adoption = f.adoptCanon(f.authority, f.globalAuthority, approval, p.id, 'adopt_queued')
  await queued; f.global.control.revokeApproval(approval); release()
  deny(await adoption, 'scope_denied'); assert.deepEqual(must(await f.store.readFence(f.authority)), before)
})
