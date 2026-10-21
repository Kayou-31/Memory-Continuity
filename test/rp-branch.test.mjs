import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { build, stop } from 'esbuild'

const base = path.resolve('work/rp-branch-tests')
await fs.mkdir(base, { recursive: true })
const runtime = path.join(base, 'runtime.mjs')
await build({ entryPoints: ['src/rp/store.ts'], outfile: runtime, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
const storeApi = await import(pathToFileURL(runtime).href + '?' + randomUUID())
let api = {}
try {
  await fs.access('src/rp/canonical.ts')
  const file = path.join(base, 'canonical.mjs')
  // Keep one store/authority realm: canonical imports no second store instance.
  await build({ entryPoints: ['src/rp/canonical.ts'], outfile: file, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
  api = await import(pathToFileURL(file).href + '?' + randomUUID())
} catch (e) { if (e.code !== 'ENOENT') throw e }
stop()
const must = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value }
const deny = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.code, code) }
const sha = s => createHash('sha256').update(s).digest('hex')
const visibility = { policyId: 'policy_story', revision: 0, audienceSetId: 'audience_public' }
const entities = ['king', 'erin', 'bea', 'key']
const evidence = { schemaVersion: 1, fixtureOnly: true, runtime: process.version, completed: [], limits: ['P3 final request/POV not run', 'P4 paused asynchronous summary not run', 'P5 host log deletion not run'] }
test.after(async () => fs.writeFile(path.join(base, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n'))
async function setup(options = {}) {
  assert.equal(typeof api.createCanonicalService, 'function', 'P2 requires real manual canonical controls and deterministic reconstruction')
  const directory = path.join(base, randomUUID())
  await fs.mkdir(path.join(directory, 'project'), { recursive: true })
  const opened = await storeApi.openRpStore({ profileRoot: path.join(directory, 'profile'), ...options })
  const workspace = must(await opened.control.createWorkspace(path.join(directory, 'project')))
  const branch = must(await opened.control.createBranch(workspace.workspaceId, 'campaign_story'))
  const request = { workspaceId: workspace.workspaceId, campaignId: 'campaign_story', branchId: branch.id, sessionId: 'session_story', sceneId: 'scene_room', viewpoint: { kind: 'narrator' }, visibility, audienceSetIds: ['audience_public', 'audience_secret'], permissions: ['read', 'observe', 'commit', 'control'] }
  const authority = must(await opened.control.authorize(request))
  return { ...opened, directory, workspace, branch, request, authority, canonical: api.createCanonicalService(opened.store, opened.control, { entityIds: entities }) }
}
async function observe(f, body, key, role = 'assistant') {
  return must(await f.store.observeSource(f.authority, { idempotencyKey: key, origin: 'host_public', role, publicText: body, turnId: 'turn_' + key, host: { sessionId: 'session_story', eventSeq: 1, messageId: 'message_' + key, messageRevision: 'revision_' + key } }))
}
async function control(f, key, body = 'USER_CONTROL_' + key) {
  return must(await f.store.observeSource(f.authority, { idempotencyKey: 'control_' + key, origin: 'user_control', role: 'user_control', turnId: 'control_turn_' + key, publicText: body }))
}
async function apply(f, op, key, ctl) {
  return f.canonical.applyControl(f.authority, ctl ?? await control(f, key), { ...op, idempotencyKey: key, expected: must(await f.store.readFence(f.authority)) })
}
async function accept(f, source, key, events = []) { return must(await apply(f, { kind: 'accept', sourceRevisionIds: [source.id], events }, key)) }
const stateEvent = (id, value, extra = {}) => ({ id, payload: { kind: 'state_change', subjectId: 'key', key: 'color', after: value }, epistemic: 'world', ...extra })

test('R33 R34 R35 batch retract uses one original snapshot and explicit targets dominate suffix replay', async () => {
  const f = await setup(), sources = []
  for (const [index, color] of ['blue', 'gold', 'red'].entries()) { const s = await observe(f, color, 'batch_' + index); await accept(f, s, 'accept_' + index, [stateEvent('event_batch_' + index, color)]); sources.push(s) }
  const left = await child(f, 'left'), right = await child(f, 'right')
  const operation = async (branch, order) => {
    const ctl = await control(branch, 'retract'), expected = must(await branch.store.readFence(branch.authority)), input = { kind: 'retract', sourceRevisionIds: order.map(i => sources[i].id), idempotencyKey: 'retract_batch', expected }
    const bad = await branch.canonical.applyControl(branch.authority, ctl, { ...input, sourceRevisionIds: [sources[0].id, 'source_missing'] }); assert.equal(bad.ok, false); assert.deepEqual(must(await branch.store.readFence(branch.authority)), expected)
    must(await branch.canonical.applyControl(branch.authority, ctl, input)); must(await branch.canonical.applyControl(branch.authority, ctl, input))
    const ledger = must(await branch.store.readLedger(branch.authority))
    return sources.map(s => ledger.sourceBindings.find(b => b.sourceRevisionId === s.id).disposition)
  }
  assert.deepEqual(await operation(left, [0, 1]), ['retracted', 'retracted', 'pending_replay'])
  assert.deepEqual(await operation(right, [1, 0]), ['retracted', 'retracted', 'pending_replay'])
  assert.equal(must(await f.store.readEvents(f.authority)).length, 3)
})
async function project(f) { return must(await f.store.replayProjection(f.authority)) }
async function child(f, key, manifest) {
  const fixed = manifest ?? must(await f.canonical.forkManifest(f.authority, must(await f.store.readFence(f.authority)).contextRevision))
  const branch = must(await f.canonical.forkBranch(f.authority, { idempotencyKey: key, ...fixed }))
  const request = { ...f.request, branchId: branch.id }
  return { ...f, branch, request, authority: must(await f.control.authorize(request)) }
}
function color(p) { return p.state.find(x => x.subjectId === 'key' && x.key === 'color' && x.epistemic === 'world') }

test('A05/P2 only explicit user selection accepts; rejected, completed and aborted alternatives never project', async () => {
  const f = await setup(), a = await observe(f, 'RED', 'red'), rejected = await observe(f, 'REJECTED', 'reject')
  assert.equal((await project(f)).state.length, 0)
  must(await apply(f, { kind: 'reject', sourceRevisionIds: [rejected.id] }, 'reject'))
  assert.equal((await project(f)).state.length, 0)
  await accept(f, a, 'accept_red', [stateEvent('event_red', 'red')])
  assert.equal(color(await project(f)).value, 'red')
  deny(await apply(f, { kind: 'accept', sourceRevisionIds: [rejected.id], events: [] }, 'forged', a), 'scope_denied')
  assert.equal((await project(f)).state.length, 1)
})

test('A12/A13 fixed fork includes validity metadata and ignores parent future and sibling-only death after reload', async () => {
  const f = await setup(), red = await observe(f, 'KEY_RED', 'red'); await accept(f, red, 'red', [stateEvent('event_red', 'red')])
  const manifest = must(await f.canonical.forkManifest(f.authority, must(await f.store.readFence(f.authority)).contextRevision))
  const c1 = await child(f, 'fork_one', manifest), c2 = await child(f, 'fork_two', manifest)
  const dead = await observe(c1, 'KING_DEAD', 'dead'); await accept(c1, dead, 'dead', [{ id: 'event_dead', payload: { kind: 'state_change', subjectId: 'king', key: 'alive', after: false }, epistemic: 'world' }])
  const later = await observe(f, 'PARENT_FUTURE', 'future'); await accept(f, later, 'future', [stateEvent('event_future', 'gold')])
  const resumed = await storeApi.openRpStore({ profileRoot: path.join(f.directory, 'profile') }), a = must(await resumed.control.authorize(c2.request))
  const result = must(await resumed.store.replayProjection(a))
  assert.equal(color(result).value, 'red')
  assert.equal(JSON.stringify(result).includes('event_dead'), false)
  assert.equal(JSON.stringify(result).includes('event_future'), false)
  const ledger = must(await resumed.store.readLedger(a))
  assert.equal(ledger.branch.parent.contextRevision, manifest.parentRevision)
  assert.equal(ledger.branch.parent.validityManifestHash, manifest.validityManifestHash)
  assert.equal(ledger.records.find(r => r.id === 'event_red').active, true)
  const cold = spawnSync(process.execPath, ['--input-type=module', '-e', `import {openRpStore} from ${JSON.stringify(pathToFileURL(runtime).href)}; const f=await openRpStore({profileRoot:process.argv[1]});const a=await f.control.authorize(JSON.parse(process.argv[2]));console.log(JSON.stringify(await f.store.replayProjection(a.value)));`, path.join(f.directory, 'profile'), JSON.stringify(c2.request)], { encoding: 'utf8', timeout: 10000 })
  assert.equal(cold.status, 0, cold.stderr)
  assert.deepEqual(must(JSON.parse(cold.stdout)), result)
  assert.deepEqual(must(await f.canonical.forkBranch(f.authority, { idempotencyKey: 'fork_two', ...manifest })), c2.branch)
  deny(await f.canonical.forkBranch(f.authority, { idempotencyKey: 'bad_fork', ...manifest, validityManifestHash: '0'.repeat(64) }), 'stale_input')
  evidence.completed.push('A12/A13 domain fixed prefix reload and sibling isolation')
})

test('A14 child retcon leaves parent, sibling, existing descendant and original source bytes unchanged', async () => {
  const f = await setup(), red = await observe(f, 'ORIGINAL_RED', 'red'); await accept(f, red, 'red', [stateEvent('event_red', 'red')])
  const c = await child(f, 'fork_c'), sibling = await child(f, 'fork_s'), d = await child(c, 'fork_d')
  const blue = await observe(c, 'LOCAL_BLUE', 'blue')
  must(await apply(c, { kind: 'replace', sourceRevisionId: red.id, replacementSourceRevisionId: blue.id, events: [stateEvent('event_blue', 'blue')] }, 'retcon'))
  assert.equal(color(await project(c)).value, 'blue')
  for (const other of [f, sibling, d]) assert.equal(color(await project(other)).value, 'red')
  assert.equal(await fs.readFile(path.join(f.directory, 'profile', '.dsh-rp/v1/workspaces', f.workspace.workspaceId, 'blobs', red.blobId + '.blob'), 'utf8'), 'ORIGINAL_RED')
  evidence.completed.push('A14 local overlay')
})

test('A06/A15 edited suffix waits for explicit replay and dependency chain is inactive before the next query', async () => {
  const f = await setup(), red = await observe(f, 'RED', 'red'); await accept(f, red, 'red', [stateEvent('event_red', 'red')])
  const later = await observe(f, 'LATER_CAUSAL', 'later'); await accept(f, later, 'later', [{ id: 'event_later', payload: { kind: 'occurrence', actorIds: ['erin'], description: 'LATER_CAUSAL' }, epistemic: 'world' }])
  for (const [kind, id, deps] of [['projection', 'copy_projection', ['event_red']], ['scene', 'copy_scene', ['copy_projection']], ['chapter', 'copy_chapter', ['copy_scene']], ['cache', 'copy_cache', ['copy_chapter']]])
    must(await f.store.savePayloadCopy(f.authority, { idempotencyKey: id, id, kind, sourceRevisionIds: [red.id], dependencyIds: deps, body: 'DERIVED_' + id }))
  const blue = await observe(f, 'BLUE', 'blue')
  must(await apply(f, { kind: 'replace', sourceRevisionId: red.id, replacementSourceRevisionId: blue.id, events: [stateEvent('event_blue', 'blue')] }, 'replace'))
  assert.equal(must(await f.store.readLedger(f.authority)).sourceBindings.find(b => b.sourceRevisionId === later.id).disposition, 'pending_replay')
  assert.equal(JSON.stringify(await project(f)).includes('event_later'), false)
  assert.equal(must(await f.store.readPayloadCopies(f.authority)).length, 0)
  must(await apply(f, { kind: 'confirm_replay', sourceRevisionIds: [later.id], events: [{ id: 'event_replayed', payload: { kind: 'occurrence', actorIds: ['erin'], description: 'CONFIRMED_NEW_CAUSE' }, epistemic: 'world' }] }, 'replay'))
  assert.equal(must(await f.store.readEvents(f.authority)).some(e => e.id === 'event_later'), false)
  assert.equal(must(await f.store.readEvents(f.authority)).some(e => e.id === 'event_replayed'), true)
  evidence.completed.push('A06/A15 domain suffix + full registered copy DAG')
})

test('A16 deterministic world/belief/utterance/uncertain and three truth values retain sources and story time', async () => {
  const f = await setup(), s = await observe(f, 'KING_ALIVE_BUT_ERIN_SAYS_DEAD', 'king')
  await accept(f, s, 'king', [
    { id: 'event_alive', payload: { kind: 'state_change', subjectId: 'king', key: 'alive', after: true }, epistemic: 'world', fictionalTime: 'day_1' },
    { id: 'event_belief', payload: { kind: 'state_change', subjectId: 'king', key: 'alive', after: false }, epistemic: 'belief', beliefHolderId: 'erin' },
    { id: 'event_utterance', payload: { kind: 'state_change', subjectId: 'king', key: 'alive', after: false }, epistemic: 'utterance' },
    { id: 'event_uncertain', payload: { kind: 'state_change', subjectId: 'king', key: 'location', after: 'tower' }, epistemic: 'uncertain' }])
  const p = await project(f)
  assert.equal(p.state.find(x => x.epistemic === 'world').value, true)
  assert.equal(p.state.find(x => x.epistemic === 'belief').beliefHolderId, 'erin')
  assert.deepEqual(await project(f), p)
  assert.equal(api.assessClaim(p, { subjectId: 'king', key: 'alive', value: false, epistemic: 'world' }).truth, 'false')
  assert.equal(api.assessClaim(p, { subjectId: 'king', key: 'injury', value: true, epistemic: 'world' }).truth, 'unknown')
  assert.equal(api.assessClaim(p, { subjectId: 'king', key: 'location', value: 'tower', epistemic: 'world' }).truth, 'unknown')
  const events = must(await f.store.readEvents(f.authority))
  assert.equal(events[0].fictionalTime, 'day_1'); assert.equal(events[1].fictionalTime, null)
  assert.deepEqual(p.state.find(x => x.epistemic === 'world').sources.map(x => x.sourceRevisionId), [s.id])
  deny(await apply(f, { kind: 'accept', sourceRevisionIds: [s.id], events: [{ id: 'event_fake_holder', payload: { kind: 'occurrence', actorIds: ['king'], description: 'x' }, epistemic: 'belief', beliefHolderId: 'unregistered' }] }, 'fake_holder'), 'scope_denied')
  evidence.completed.push('A16 deterministic epistemic state + explicit truth evidence')
})

test('A17 conflicting locations remain unresolved until targeted correction; old records remain privileged audit history', async () => {
  const f = await setup(), s = await observe(f, 'TWO_LOCATIONS', 'locations')
  await accept(f, s, 'locations', [
    { id: 'event_tower', payload: { kind: 'state_change', subjectId: 'key', key: 'location', after: 'tower' }, epistemic: 'world', fictionalTime: 'later' },
    { id: 'event_cellar', payload: { kind: 'state_change', subjectId: 'key', key: 'location', after: 'cellar' }, epistemic: 'world', fictionalTime: 'earlier' }])
  const p = await project(f), claim = api.assessClaim(p, { subjectId: 'key', key: 'location', value: 'tower', epistemic: 'world' })
  assert.equal(claim.truth, 'unknown'); assert.equal(claim.conflict, 'unresolved')
  const ctl = await control(f, 'correct', 'KEY_AT_GATE')
  must(await apply(f, { kind: 'retcon', targetEventIds: ['event_tower', 'event_cellar'], events: [{ id: 'event_gate', payload: { kind: 'state_change', subjectId: 'key', key: 'location', after: 'gate' }, epistemic: 'world' }] }, 'correct', ctl))
  const current = (await project(f)).state.find(s => s.key === 'location')
  assert.equal(current.value, 'gate'); assert.equal(current.resolution, 'known')
  assert.equal(must(await f.store.readLedger(f.authority)).records.filter(r => r.id === 'event_tower' || r.id === 'event_cellar').every(r => !r.active), true)
  evidence.completed.push('A17 unresolved then explicit correction')
})

test('A18/A19 knowledge needs a learn source; co-presence grants nothing and forget preserves narrator history without purge', async () => {
  let purges = 0
  const f = await setup({ onPurge: () => purges++ }), s = await observe(f, 'SECRET_AUTHOR_IS_ERIN', 'secret')
  await accept(f, s, 'secret', [{ id: 'event_secret', payload: { kind: 'state_change', subjectId: 'king', key: 'identity', after: 'SECRET_AUTHOR_IS_ERIN' }, epistemic: 'world' }])
  const together = await observe(f, 'same room', 'together')
  await accept(f, together, 'together', [{ id: 'event_together', payload: { kind: 'occurrence', actorIds: ['erin', 'bea'], description: 'same room' }, epistemic: 'world' }])
  const bea = must(await f.control.authorize({ ...f.request, viewpoint: { kind: 'character', entityId: 'bea' }, permissions: ['read'] }))
  assert.equal(must(await f.store.readEvents(bea)).length, 0)
  const secretSpan = must(await f.store.sourceSpan(f.authority, s.id, 0, s.publicTextLengthUtf16))
  deny(await f.store.readSource(bea, secretSpan), 'source_unavailable')
  const learn = await observe(f, 'ERIN_TELLS_BEA', 'learn')
  await accept(f, learn, 'learn', [{ id: 'event_learn', payload: { kind: 'knowledge_change', knowerId: 'bea', claimId: 'event_secret', action: 'learn' }, epistemic: 'world' }])
  assert.equal(must(await f.store.readEvents(bea)).some(e => e.id === 'event_secret'), true)
  assert.equal(must(await f.store.readSource(bea, secretSpan)), 'SECRET_AUTHOR_IS_ERIN')
  must(await apply(f, { kind: 'character_forget', knowerId: 'bea', claimId: 'event_secret' }, 'forget'))
  assert.equal(must(await f.store.readEvents(bea)).some(e => e.id === 'event_secret'), false)
  deny(await f.store.readSource(bea, secretSpan), 'source_unavailable')
  const history = must(await f.store.readEvents(f.authority))
  assert.equal(history.some(e => e.id === 'event_secret'), true)
  assert.equal(history.some(e => e.payload.action === 'learn'), true)
  assert.equal(history.some(e => e.payload.action === 'forget'), true)
  assert.equal((await project(f)).knowledge.find(k => k.claimId === 'event_secret').known, false)
  assert.equal(purges, 0)
  deny(await f.store.readLedger(bea), 'scope_denied')
  evidence.completed.push('A18/A19 store POV and knowledge; P3 complete request pending')
})

test('directional relationships, promises and causes remain source-backed without reverse inference', async () => {
  const f = await setup(), s = await observe(f, 'ERIN_RESCUES_BEA', 'rescue')
  await accept(f, s, 'rescue', [{ id: 'event_rescue', payload: { kind: 'occurrence', actorIds: ['erin', 'bea'], description: 'rescue' }, epistemic: 'world' }, { id: 'event_relation', payload: { kind: 'relationship_change', fromId: 'bea', toId: 'erin', relation: 'trust', value: 'growing', triggerEventIds: ['event_rescue'], unresolvedTension: 'old debt' }, epistemic: 'world' }, { id: 'event_promise', payload: { kind: 'state_change', subjectId: 'bea', key: 'promise', after: 'return the key' }, epistemic: 'world' }])
  const p = await project(f)
  assert.equal(p.relationships.length, 1)
  assert.deepEqual(p.relationships[0].triggerEventIds, ['event_rescue'])
  assert.equal(p.relationships[0].fromId, 'bea'); assert.equal(p.relationships[0].toId, 'erin')
  assert.equal(p.relationships[0].unresolvedTension, 'old debt')
  assert.equal(p.relationships[0].sources[0].sourceRevisionId, s.id)
  assert.equal(p.state.find(x => x.key === 'promise').value, 'return the key')
})

test('story retraction is branch-local and keeps shared source bytes', async () => {
  const f = await setup(), s = await observe(f, 'RED', 'red'); await accept(f, s, 'red', [stateEvent('event_red', 'red')])
  const c = await child(f, 'fork')
  must(await apply(c, { kind: 'retract', sourceRevisionIds: [s.id] }, 'retract'))
  assert.equal((await project(c)).state.length, 0)
  assert.equal(color(await project(f)).value, 'red')
  assert.equal(await fs.readFile(path.join(f.directory, 'profile', '.dsh-rp/v1/workspaces', f.workspace.workspaceId, 'blobs', s.blobId + '.blob'), 'utf8'), 'RED')
})

test('A20 privacy first tombstones every authorized shared-source branch, purges declared payload copies, rejects old jobs and survives restart', async () => {
  let interrupt = true, checks = 0
  const f = await setup({ beforePurge: async () => { checks++; if (interrupt) throw new Error('PURGE_PAUSED') } }), s = await observe(f, 'DELETE_SECRET', 'secret')
  await accept(f, s, 'secret', [stateEvent('event_secret', 'DELETE_SECRET')])
  const c = await child(f, 'fork')
  for (const kind of ['projection', 'scene', 'chapter', 'cache', 'job_input', 'archive', 'snapshot', 'index'])
    must(await f.store.savePayloadCopy(f.authority, { idempotencyKey: 'copy_' + kind, id: 'copy_' + kind, kind, sourceRevisionIds: [s.id], dependencyIds: ['event_secret'], body: 'DELETE_SECRET_' + kind }))
  const old = must(await f.store.readFence(f.authority)), span = must(await f.store.sourceSpan(f.authority, s.id, 0, s.publicTextLengthUtf16))
  const ctl = await control(f, 'privacy', 'DELETE_SELECTED_SOURCE')
  const op = { kind: 'privacy_delete', idempotencyKey: 'privacy', expected: old, sourceRevisionIds: [s.id], affectedBranchIds: [f.branch.id, c.branch.id] }
  deny(await f.canonical.applyControl(f.authority, ctl, op), 'scope_denied')
  const blocked = must(await f.canonical.applyControl(f.authority, ctl, op, [f.authority, c.authority]))
  assert.equal(blocked.purgeState, 'blocked')
  assert.equal(checks, 1)
  deny(await f.store.readSource(f.authority, span), 'source_unavailable')
  deny(await c.store.readSource(c.authority, span), 'source_unavailable')
  assert.equal(must(await f.store.readPayloadCopies(f.authority)).length, 0)
  deny(await f.store.commit(f.authority, { schemaVersion: 1, idempotencyKey: 'old_job', expected: old, sourceBindings: [], events: [], summaries: [], jobs: [], invalidatedIds: [], authorityChanges: [], nextContextRevision: old.contextRevision + 1 }), 'stale_input')
  interrupt = false
  const done = must(await f.canonical.resumePrivacyDelete(f.authority, 'privacy', [f.authority, c.authority]))
  assert.equal(done.purgeState, 'complete')
  const resumed = await storeApi.openRpStore({ profileRoot: path.join(f.directory, 'profile') }), ra = must(await resumed.control.authorize(f.request))
  assert.equal(must(await resumed.store.readEvents(ra)).length, 0)
  assert.equal(must(await resumed.store.readPayloadCopies(ra)).length, 0)
  const root = path.join(f.directory, 'profile', '.dsh-rp/v1/workspaces', f.workspace.workspaceId)
  for (const file of await fs.readdir(path.join(root, 'blobs'))) assert.equal((await fs.readFile(path.join(root, 'blobs', file), 'utf8')).includes('DELETE_SECRET'), false)
  const commits = await Promise.all((await fs.readdir(path.join(root, 'commits'))).map(n => fs.readFile(path.join(root, 'commits', n), 'utf8')))
  assert.equal(commits.join('').includes('DELETE_SECRET'), false)
  deny(await observeResult(f, 'DELETE_SECRET', 'resurrection'), 'source_unavailable')
  evidence.completed.push('A20 workspace-scope authorized tombstone/purge/restart/stale commit; P3/P4/P5 pending')
})
async function observeResult(f, body, key) { return f.store.observeSource(f.authority, { idempotencyKey: key, origin: 'host_public', role: 'assistant', publicText: body, turnId: 'turn_' + key, host: { sessionId: 'session_story', eventSeq: 1, messageId: 'message_' + key, messageRevision: 'revision_' + key } }) }

test('unsupported native selection/edit/fork return exact capability errors without invented SDK calls', async () => {
  const f = await setup()
  for (const kind of ['selection', 'edit', 'fork']) {
    const r = await api.applyNativeCanonicalEvent(f.canonical, f.authority, { kind })
    deny(r, 'capability_missing')
    assert.match(r.message, new RegExp(kind))
  }
  assert.equal((await project(f)).state.length, 0)
})

test('manual control receipts are idempotent across restart and reject a reused key with changed effects', async () => {
  const f = await setup(), s = await observe(f, 'RED', 'red'), ctl = await control(f, 'once')
  const input = { kind: 'accept', idempotencyKey: 'once', expected: must(await f.store.readFence(f.authority)), sourceRevisionIds: [s.id], events: [stateEvent('event_red', 'red')] }
  const first = must(await f.canonical.applyControl(f.authority, ctl, input))
  const opened = await storeApi.openRpStore({ profileRoot: path.join(f.directory, 'profile') }), auth = must(await opened.control.authorize(f.request)), service = api.createCanonicalService(opened.store, opened.control, { entityIds: entities })
  assert.deepEqual(must(await service.applyControl(auth, ctl, input)), first)
  deny(await service.applyControl(auth, ctl, { ...input, events: [stateEvent('event_blue', 'blue')] }), 'idempotency_conflict')
})

test('event retcon also suspends later host suffix and never grants old derived caches new life', async () => {
  const f = await setup(), s = await observe(f, 'RED', 'red'); await accept(f, s, 'red', [stateEvent('event_red', 'red')])
  const later = await observe(f, 'dependent continuation', 'later'); await accept(f, later, 'later', [{ id: 'event_later', payload: { kind: 'occurrence', actorIds: ['erin'], description: 'later' }, epistemic: 'world' }])
  must(await apply(f, { kind: 'retcon', targetEventIds: ['event_red'], events: [stateEvent('event_blue', 'blue')] }, 'retcon'))
  assert.equal(must(await f.store.readLedger(f.authority)).sourceBindings.find(b => b.sourceRevisionId === later.id).disposition, 'pending_replay')
  assert.equal(must(await f.store.readEvents(f.authority)).some(e => e.id === 'event_later'), false)
})

test('whole-source character reads exclude mixed unlearned claims and occurrences', async () => {
  const f = await setup(), s = await observe(f, 'KNOWN_FACT PLUS HIDDEN_OCCURRENCE', 'mixed')
  await accept(f, s, 'mixed', [stateEvent('event_known', 'red'), { id: 'event_hidden', payload: { kind: 'occurrence', actorIds: ['erin'], description: 'HIDDEN_OCCURRENCE' }, epistemic: 'world' }])
  const learn = await observe(f, 'Bea learns the key color', 'learn')
  await accept(f, learn, 'learn', [{ id: 'event_learn', payload: { kind: 'knowledge_change', knowerId: 'bea', claimId: 'event_known', action: 'learn' }, epistemic: 'world' }])
  const bea = must(await f.control.authorize({ ...f.request, viewpoint: { kind: 'character', entityId: 'bea' }, permissions: ['read'] }))
  const span = must(await f.store.sourceSpan(f.authority, s.id, 0, s.publicTextLengthUtf16))
  deny(await f.store.readSource(bea, span), 'source_unavailable')
  const p = must(await f.store.replayProjection(bea))
  assert.equal(JSON.stringify(p).includes('event_hidden'), false)
})

test('direct correction invalidates target DAG, forged acceptedSeq and world character statements are rejected', async () => {
  const f = await setup(), s = await observe(f, 'RED', 'red'); await accept(f, s, 'red', [stateEvent('event_red', 'red')])
  must(await f.store.savePayloadCopy(f.authority, { idempotencyKey: 'cache', id: 'cache_one', kind: 'cache', sourceRevisionIds: [s.id], dependencyIds: ['event_red'], body: 'CACHE_RED' }))
  const ctl = await control(f, 'correction'); await accept(f, ctl, 'accept_ctl')
  const current = must(await f.store.readFence(f.authority)), span = must(await f.store.sourceSpan(f.authority, ctl.id, 0, ctl.publicTextLengthUtf16)), seq = must(await f.store.readLedger(f.authority)).sourceBindings.find(b => b.sourceRevisionId === ctl.id).acceptedSeq
  const event = { schemaVersion: 1, id: 'event_correction', scope: f.authority.scope, acceptedSeq: seq, fictionalTime: null, payload: { kind: 'correction', targetEventIds: ['event_red'], replacementEventIds: [], reason: 'explicit correction' }, epistemic: 'world', authority: 'explicit_ooc', sources: [span], visibility, supersedes: [], policyVersion: 'rp.v1' }
  const batch = e => ({ schemaVersion: 1, idempotencyKey: e.id, expected: current, sourceBindings: [], events: [e], summaries: [], jobs: [], invalidatedIds: [], authorityChanges: [], nextContextRevision: current.contextRevision + 1 })
  deny(await f.store.commit(f.authority, batch({ ...event, id: 'event_fake_seq', acceptedSeq: 9999 })), 'invalid_record')
  deny(await f.store.commit(f.authority, batch({ ...event, id: 'event_fake_world', authority: 'character_statement' })), 'scope_denied')
  must(await f.store.commit(f.authority, batch(event)))
  assert.equal(must(await f.store.readEvents(f.authority)).some(e => e.id === 'event_red'), false)
  assert.equal(must(await f.store.readPayloadCopies(f.authority)).length, 0)
})

test('privacy sweep removes unpublished orphan payloads and includes content-address aliases in affected scope', async () => {
  const f = await setup(), s = await observe(f, 'DELETE_ORPHAN_SECRET', 'secret'); await accept(f, s, 'secret', [stateEvent('event_secret', 'red')])
  const c = await child(f, 'fork'), other = await observe(c, 'OTHER_SOURCE', 'other'); await accept(c, other, 'other')
  // An unrelated provenance copy with identical bytes is another physical alias.
  must(await f.store.savePayloadCopy(c.authority, { idempotencyKey: 'alias', id: 'copy_alias', kind: 'cache', sourceRevisionIds: [other.id], dependencyIds: [], body: 'DELETE_ORPHAN_SECRET' }))
  const broken = await storeApi.openRpStore({ profileRoot: path.join(f.directory, 'profile'), fault: stage => { if (stage === 'transaction_written') throw new Error('FAIL_BEFORE_METADATA_PUBLICATION') } }), auth = must(await broken.control.authorize(f.request))
  deny(await broken.store.savePayloadCopy(auth, { idempotencyKey: 'orphan', id: 'copy_orphan', kind: 'job_input', sourceRevisionIds: [s.id], dependencyIds: [], body: 'ORPHAN_DELETE_ORPHAN_SECRET' }), 'persistence_failed')
  const result = must(await f.canonical.applyControl(f.authority, await control(f, 'privacy'), { kind: 'privacy_delete', idempotencyKey: 'privacy', expected: must(await f.store.readFence(f.authority)), sourceRevisionIds: [s.id], affectedBranchIds: [f.branch.id, c.branch.id] }, [f.authority, c.authority]))
  assert.equal(result.purgeState, 'complete')
  assert.equal(must(await f.store.readPayloadCopies(c.authority)).length, 0)
  const directory = path.join(f.directory, 'profile', '.dsh-rp/v1/workspaces', f.workspace.workspaceId, 'blobs')
  for (const file of await fs.readdir(directory)) assert.equal((await fs.readFile(path.join(directory, file), 'utf8')).includes('DELETE_ORPHAN_SECRET'), false)
})

test('A18 secret audience learn changes knowledge without expanding the host audience grant', async () => {
  const f = await setup(), secretRequest = { ...f.request, visibility: { ...visibility, audienceSetId: 'audience_secret' } }, secret = { ...f, request: secretRequest, authority: must(await f.control.authorize(secretRequest)) }
  const s = await observe(secret, 'SECRET_REAL_AUTHOR', 'secret')
  await accept(secret, s, 'secret', [{ id: 'event_secret', payload: { kind: 'state_change', subjectId: 'king', key: 'identity', after: 'SECRET_REAL_AUTHOR' }, epistemic: 'world' }])
  const wide = must(await f.control.authorize({ ...f.request, viewpoint: { kind: 'character', entityId: 'bea' }, permissions: ['read'] })), narrow = must(await f.control.authorize({ ...f.request, viewpoint: { kind: 'character', entityId: 'bea' }, audienceSetIds: ['audience_public'], permissions: ['read'] }))
  assert.equal(must(await f.store.readEvents(wide)).length, 0)
  const learn = await observe(secret, 'SECRET_TOLD_TO_BEA', 'learn')
  await accept(secret, learn, 'learn', [{ id: 'event_learn', payload: { kind: 'knowledge_change', knowerId: 'bea', claimId: 'event_secret', action: 'learn' }, epistemic: 'world' }])
  assert.equal(must(await f.store.readEvents(wide)).some(e => e.id === 'event_secret'), true)
  assert.equal(must(await f.store.readEvents(narrow)).length, 0)
  assert.deepEqual(must(await f.store.replayProjection(narrow)), { state: [], claims: [], conflicts: [], knowledge: [], relationships: [] })
  const span = must(await f.store.sourceSpan(secret.authority, s.id, 0, s.publicTextLengthUtf16))
  deny(await f.store.readSource(narrow, span), 'source_unavailable')
  assert.equal(must(await f.store.readSource(wide, span)), 'SECRET_REAL_AUTHOR')
  const publicLearn = await observe(f, 'PUBLIC_LEARN', 'public_learn')
  deny(await apply(f, { kind: 'accept', sourceRevisionIds: [publicLearn.id], events: [{ id: 'event_public_learn', payload: { kind: 'knowledge_change', knowerId: 'bea', claimId: 'event_secret', action: 'learn' }, epistemic: 'world' }] }, 'public_learn'), 'scope_denied')
  deny(await apply(f, { kind: 'accept', sourceRevisionIds: [publicLearn.id], events: [{ id: 'event_public_relation', payload: { kind: 'relationship_change', fromId: 'bea', toId: 'erin', relation: 'trust', value: 'growing', triggerEventIds: ['event_secret'] }, epistemic: 'world' }] }, 'public_relation'), 'scope_denied')
  assert.equal(must(await f.store.readEvents(narrow)).length, 0)
})

test('A15 real scene/chapter summaries and mixed audience dependency laundering obey the same DAG', async () => {
  const f = await setup(), s = await observe(f, 'RED', 'red'); await accept(f, s, 'red', [stateEvent('event_red', 'red')])
  for (const [id, level, deps] of [['summary_scene', 'scene', []], ['summary_chapter', 'chapter', ['summary_scene']]]) {
    const current = must(await f.store.readFence(f.authority))
    must(await f.store.commit(f.authority, { schemaVersion: 1, idempotencyKey: id, expected: current, sourceBindings: [], events: [], summaries: [{ schemaVersion: 1, id, scope: f.authority.scope, level, createdFrom: current, sourceRevisionIds: [s.id], dependencySummaryIds: deps, supportEventIds: ['event_red'], exactAnchors: [], text: 'SUMMARY_RED', visibility, policyVersion: 'rp.v1', measuredTokens: 4, tokenMeasurement: 'estimated' }], jobs: [], invalidatedIds: [], authorityChanges: [], nextContextRevision: current.contextRevision + 1 }))
  }
  assert.equal(must(await f.store.readSummaries(f.authority)).length, 2)
  must(await apply(f, { kind: 'retcon', targetEventIds: ['event_red'], events: [stateEvent('event_blue', 'blue')] }, 'retcon'))
  assert.equal(must(await f.store.readSummaries(f.authority)).length, 0)
  const secret = { ...f, authority: must(await f.control.authorize({ ...f.request, visibility: { ...visibility, audienceSetId: 'audience_secret' } })) }
  const hidden = await observe(secret, 'SECRET', 'secret'); await accept(secret, hidden, 'secret', [stateEvent('event_secret', 'secret')])
  const current = must(await f.store.readFence(f.authority))
  deny(await f.store.commit(f.authority, { schemaVersion: 1, idempotencyKey: 'launder', expected: current, sourceBindings: [], events: [], summaries: [{ schemaVersion: 1, id: 'summary_launder', scope: f.authority.scope, level: 'scene', createdFrom: current, sourceRevisionIds: [s.id], dependencySummaryIds: [], supportEventIds: ['event_secret'], exactAnchors: [], text: 'SECRET', visibility, policyVersion: 'rp.v1', measuredTokens: 1, tokenMeasurement: 'estimated' }], jobs: [], invalidatedIds: [], authorityChanges: [], nextContextRevision: current.contextRevision + 1 }), 'scope_denied')
})

test('privacy must explicitly include raw-source aliases of a derived blob before any purge', async () => {
  const f = await setup(), s = await observe(f, 'S_PRIVATE', 'private'); await accept(f, s, 'private')
  const qBranch = must(await f.control.createBranch(f.workspace.workspaceId, 'campaign_story')), qRequest = { ...f.request, branchId: qBranch.id }, q = { ...f, branch: qBranch, request: qRequest, authority: must(await f.control.authorize(qRequest)) }
  const t = await observe(q, 'COMMON_BODY', 'common'); await accept(q, t, 'common')
  must(await f.store.savePayloadCopy(f.authority, { idempotencyKey: 'copy', id: 'copy_private', kind: 'cache', sourceRevisionIds: [s.id], dependencyIds: [], body: 'COMMON_BODY' }))
  const ctl = await control(f, 'privacy'), expected = must(await f.store.readFence(f.authority)), qspan = must(await q.store.sourceSpan(q.authority, t.id, 0, t.publicTextLengthUtf16))
  deny(await f.canonical.applyControl(f.authority, ctl, { kind: 'privacy_delete', idempotencyKey: 'privacy', expected, sourceRevisionIds: [s.id], affectedBranchIds: [f.branch.id] }), 'scope_denied')
  assert.equal(must(await q.store.readSource(q.authority, qspan)), 'COMMON_BODY')
  // Naming the branch alone does not authorize deleting an unrelated raw source.
  deny(await f.canonical.applyControl(f.authority, ctl, { kind: 'privacy_delete', idempotencyKey: 'privacy', expected, sourceRevisionIds: [s.id], affectedBranchIds: [f.branch.id, q.branch.id] }, [f.authority, q.authority]), 'scope_denied')
  const result = must(await f.canonical.applyControl(f.authority, ctl, { kind: 'privacy_delete', idempotencyKey: 'privacy', expected, sourceRevisionIds: [s.id, t.id], affectedBranchIds: [f.branch.id, q.branch.id] }, [f.authority, q.authority]))
  assert.equal(result.purgeState, 'complete')
  deny(await q.store.readSource(q.authority, qspan), 'source_unavailable')
  assert.equal(must(await q.store.readLedger(q.authority)).fence.deletionGeneration, 1)
})

test('state before metadata does not resolve a conflict; explicit supersedes performs a sourced transition', async () => {
  const f = await setup(), s = await observe(f, 'KEY_MOVES', 'moves')
  await accept(f, s, 'moves', [{ id: 'event_tower', payload: { kind: 'state_change', subjectId: 'key', key: 'location', after: 'tower' }, epistemic: 'world' }, { id: 'event_gate', payload: { kind: 'state_change', subjectId: 'key', key: 'location', before: 'tower', after: 'gate' }, epistemic: 'world' }])
  assert.equal((await project(f)).state.find(s => s.key === 'location').resolution, 'conflict')
  must(await apply(f, { kind: 'retcon', targetEventIds: ['event_tower', 'event_gate'], events: [{ id: 'event_cellar', payload: { kind: 'state_change', subjectId: 'key', key: 'location', before: 'gate', after: 'cellar' }, epistemic: 'world' }] }, 'move'))
  assert.equal((await project(f)).state.find(s => s.key === 'location').value, 'cellar')
})

test('narrow narrator control cannot read secret control receipts or their source/event counts', async () => {
  const f = await setup(), secret = { ...f, authority: must(await f.control.authorize({ ...f.request, visibility: { ...visibility, audienceSetId: 'audience_secret' } })) }, s = await observe(secret, 'SECRET', 'secret')
  await accept(secret, s, 'secret', [stateEvent('event_secret', 'secret')])
  const narrow = must(await f.control.authorize({ ...f.request, audienceSetIds: ['audience_public'] }))
  deny(await f.store.readControlCommit(narrow, 'secret'), 'scope_denied')
  deny(await f.store.readLedger(narrow), 'scope_denied')
  assert.equal(must(await f.store.readEvents(narrow)).length, 0)
  must(await apply(secret, { kind: 'privacy_delete', sourceRevisionIds: [s.id], affectedBranchIds: [f.branch.id] }, 'privacy_secret'))
  deny(await f.canonical.resumePrivacyDelete(narrow, 'privacy_secret'), 'scope_denied')
})

test('blocked privacy tombstones reject new exact-byte copies through unrelated source provenance', async () => {
  const f = await setup({ beforePurge: () => { throw new Error('PAUSED') } }), s = await observe(f, 'DELETED_BODY', 'secret'); await accept(f, s, 'secret')
  const other = await observe(f, 'UNRELATED', 'other'); await accept(f, other, 'other')
  const deletion = must(await apply(f, { kind: 'privacy_delete', sourceRevisionIds: [s.id], affectedBranchIds: [f.branch.id] }, 'privacy'))
  assert.equal(deletion.purgeState, 'blocked')
  deny(await f.store.savePayloadCopy(f.authority, { idempotencyKey: 'new_alias', id: 'copy_alias', kind: 'cache', sourceRevisionIds: [other.id], dependencyIds: [], body: 'DELETED_BODY' }), 'source_unavailable')
  assert.equal(must(await f.store.readPayloadCopies(f.authority)).length, 0)
})

test('fixed fork preserves invalidations, canon and visibility even when a later parent revision keeps the same source manifest', async () => {
  const f = await setup({ verifyCanonBinding: async () => true }), s = await observe(f, 'RED', 'red'); await accept(f, s, 'red', [stateEvent('event_red', 'red')])
  must(await apply(f, { kind: 'retcon', targetEventIds: ['event_red'], events: [stateEvent('event_blue', 'blue')] }, 'retcon'))
  const before = must(await f.store.readFence(f.authority))
  must(await f.store.commit(f.authority, { schemaVersion: 1, idempotencyKey: 'canon_visibility', expected: before, sourceBindings: [], events: [], summaries: [], jobs: [], invalidatedIds: [], authorityChanges: [
    { kind: 'canon_binding', recordId: 'binding_world', record: { worldId: 'world_story', publicationId: 'publication_one', revision: 3, bodySha256: sha('CANON') } },
    { kind: 'visibility', recordId: visibility.policyId, record: { ...visibility, revision: 1 } }], nextContextRevision: before.contextRevision + 1 }))
  f.request = { ...f.request, visibility: { ...visibility, revision: 1 } }; f.authority = must(await f.control.authorize(f.request))
  const head = must(await f.store.readFence(f.authority)), fixed = must(await f.canonical.forkManifest(f.authority, head.contextRevision)), c = await child(f, 'fork', fixed)
  const cfence = must(await c.store.readFence(c.authority)), ledger = must(await c.store.readLedger(c.authority))
  assert.equal(cfence.canonBindingsHash, head.canonBindingsHash); assert.equal(cfence.visibilityRevision, 1)
  assert.equal(ledger.records.find(r => r.id === 'event_red').active, false); assert.equal(color(await project(c)).value, 'blue')
  must(await f.store.commit(f.authority, { schemaVersion: 1, idempotencyKey: 'invalidate_blue', expected: head, sourceBindings: [], events: [], summaries: [], jobs: [], invalidatedIds: ['event_blue'], authorityChanges: [], nextContextRevision: head.contextRevision + 1 }))
  const changed = must(await f.canonical.forkManifest(f.authority, head.contextRevision + 1))
  assert.equal(changed.prefixManifestHash, fixed.prefixManifestHash)
  assert.notEqual(changed.validityManifestHash, fixed.validityManifestHash)
  assert.equal((await project(f)).state.length, 0); assert.equal(color(await project(c)).value, 'blue')
})

test('accepted narration cannot supersede locked canon; explicit user correction can', async () => {
  const f = await setup(), ctl = await control(f, 'canon', 'LOCKED_RED')
  must(await apply(f, { kind: 'accept', sourceRevisionIds: [ctl.id], events: [{ id: 'event_locked', payload: { kind: 'canon_assertion', subjectId: 'key', key: 'color', value: 'red', locked: true }, epistemic: 'world' }] }, 'canon', ctl))
  const s = await observe(f, 'NARRATION_BLUE', 'blue')
  deny(await apply(f, { kind: 'accept', sourceRevisionIds: [s.id], events: [stateEvent('event_narrative_override', 'blue', { supersedes: ['event_locked'] })] }, 'override'), 'scope_denied')
  must(await apply(f, { kind: 'retcon', targetEventIds: ['event_locked'], events: [stateEvent('event_explicit_blue', 'blue')] }, 'explicit'))
  assert.equal(color(await project(f)).value, 'blue')
})

test('privacy retries require fresh authority for a secret copy alias in an independent branch', async () => {
  const f = await setup({ beforePurge: () => { throw new Error('PAUSE_PURGE') } }), s = await observe(f, 'PRIVATE_S', 's'); await accept(f, s, 's')
  must(await f.store.savePayloadCopy(f.authority, { idempotencyKey: 'copy_p', id: 'copy_p', kind: 'cache', sourceRevisionIds: [s.id], dependencyIds: [], body: 'COMMON' }))
  const branch = must(await f.control.createBranch(f.workspace.workspaceId, 'campaign_story')), request = { ...f.request, branchId: branch.id, visibility: { ...visibility, audienceSetId: 'audience_secret' } }, q = { ...f, branch, request, authority: must(await f.control.authorize(request)) }
  const t = await observe(q, 'UNDELETED_SECRET_T', 't'); await accept(q, t, 't')
  must(await f.store.savePayloadCopy(q.authority, { idempotencyKey: 'copy_q', id: 'copy_secret_q', kind: 'cache', sourceRevisionIds: [t.id], dependencyIds: [], body: 'COMMON' }))
  const ctl = await control(f, 'privacy'), operation = { kind: 'privacy_delete', idempotencyKey: 'privacy', expected: must(await f.store.readFence(f.authority)), sourceRevisionIds: [s.id], affectedBranchIds: [f.branch.id, q.branch.id] }
  const first = must(await f.canonical.applyControl(f.authority, ctl, operation, [f.authority, q.authority]))
  assert.equal(first.purgeState, 'blocked'); assert.equal(first.blockedDerivedIds.includes('copy_secret_q'), true)
  const narrow = must(await f.control.authorize({ ...f.request, audienceSetIds: ['audience_public'] }))
  assert.equal(JSON.stringify(must(await f.store.readLedger(narrow))).includes('copy_secret_q'), false)
  deny(await f.canonical.resumePrivacyDelete(narrow, 'privacy'), 'scope_denied')
  deny(await f.canonical.applyControl(narrow, ctl, operation), 'scope_denied')
  const narrowQ = must(await f.control.authorize({ ...q.request, visibility, audienceSetIds: ['audience_public'] }))
  deny(await f.canonical.resumePrivacyDelete(f.authority, 'privacy', [f.authority, narrowQ]), 'scope_denied')
  assert.equal(must(await f.canonical.resumePrivacyDelete(f.authority, 'privacy', [f.authority, q.authority])).purgeState, 'blocked')
  assert.equal(must(await q.store.readSource(q.authority, must(await q.store.sourceSpan(q.authority, t.id, 0, t.publicTextLengthUtf16)))), 'UNDELETED_SECRET_T')
})
