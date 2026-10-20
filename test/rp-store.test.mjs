import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { spawnSync, spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { build, stop } from 'esbuild'
import { observation, batch, ids, visibility } from './fixtures/rp/story-fixture.mjs'

const base = path.resolve('work/rp-store-tests')
await fs.mkdir(base, { recursive: true })
const runtime = path.join(base, 'runtime.mjs')
const api = existsSync('src/rp/store.ts') ? (await build({ entryPoints: ['src/rp/store.ts'], outfile: runtime, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' }), await import(pathToFileURL(runtime).href + '?run=' + randomUUID())) : {}
stop()
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex')
const must = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const deny = (result, code) => { assert.equal(result.ok, false); assert.equal(result.code, code) }
const evidence = { schemaVersion: 1, runtime: process.version, fixtureOnly: true, atomicBoundaries: [], actualCrash: null, durability: null }
test.after(async () => { await fs.writeFile(path.join(base, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n') })
async function setup(options = {}) {
  assert.equal(typeof api.openRpStore, 'function', 'RP must validate authority and persist immutable effective source bindings')
  const directory = path.join(base, randomUUID())
  await fs.mkdir(path.join(directory, 'project'), { recursive: true })
  const opened = await api.openRpStore({ profileRoot: path.join(directory, 'profile'), ...options })
  const workspace = must(await opened.control.createWorkspace(path.join(directory, 'project')))
  const branch = must(await opened.control.createBranch(workspace.workspaceId, ids.campaign))
  const request = { workspaceId: workspace.workspaceId, campaignId: ids.campaign, branchId: branch.id,
    sessionId: ids.session, sceneId: ids.scene, viewpoint: { kind: 'narrator' }, visibility, audienceSetIds: [visibility.audienceSetId],
    permissions: ['read', 'observe', 'commit', 'control'] }
  const authority = must(await opened.control.authorize(request))
  return { ...opened, directory, workspace, branch, request, authority }
}
async function source(f, text, revision, key) { return must(await f.store.observeSource(f.authority, observation(text, revision, key))) }
async function fence(f) { return must(await f.store.readFence(f.authority)) }
async function accept(f, s, key, changes = {}) { return must(await f.store.commit(f.authority, batch(await fence(f), s, key, changes))) }
async function span(f, s, start = 0, end = s.publicTextLengthUtf16) { return must(await f.store.sourceSpan(f.authority, s.id, start, end)) }

test('A05 P1 rejected alternatives remain unaccepted and cannot be read as effective sources', async () => {
  const f = await setup(), accepted = await source(f, 'PUBLIC_KEY_RED', 'revision_a')
  const rejected = await source(f, 'REJECTED_SENTINEL', 'revision_rejected')
  await accept(f, accepted)
  const ledger = must(await f.store.readLedger(f.authority))
  assert.deepEqual(ledger.sourceBindings.filter(x => x.disposition === 'accepted').map(x => x.sourceRevisionId), [accepted.id])
  deny(await f.store.sourceSpan(f.authority, rejected.id, 0, rejected.publicTextLengthUtf16), 'source_unavailable')
  assert.equal(must(await f.store.readSource(f.authority, await span(f, accepted))), 'PUBLIC_KEY_RED')
  // P2 now reconstructs the empty semantic view from accepted source bindings;
  // observing/accepting source text alone still cannot invent a world event.
  assert.deepEqual(must(await f.store.replayProjection(f.authority)).state, [])
})

test('A06 P1 replacement preserves raw A and atomically invalidates its dependency closure', async () => {
  const f = await setup(), a = await source(f, 'PUBLIC_KEY_RED', 'revision_a')
  await accept(f, a)
  const aSpan = await span(f, a)
  const event = { schemaVersion: 1, id: 'event_red', scope: f.authority.scope, acceptedSeq: 1, fictionalTime: null,
    payload: { kind: 'occurrence', actorIds: ['character_erin'], description: 'SENSITIVE_EVENT_RED' }, epistemic: 'world', authority: 'accepted_narration',
    sources: [aSpan], visibility, supersedes: [], policyVersion: 'rp.v1' }
  const before = await fence(f)
  must(await f.store.commit(f.authority, batch(before, a, 'derive_red', { sourceBindings: [], events: [event] })))
  const b = await source(f, 'PUBLIC_KEY_BLUE', 'revision_b')
  const next = batch(await fence(f), b, 'replace_a', { sourceBindings: [
    { sourceRevisionId: a.id, branchId: f.branch.id, turnId: ids.turn, disposition: 'superseded', acceptedSeq: 1 },
    { sourceRevisionId: b.id, branchId: f.branch.id, turnId: ids.turn, disposition: 'accepted', acceptedSeq: 1, supersedes: a.id }] })
  must(await f.store.commit(f.authority, next))
  const ledger = must(await f.store.readLedger(f.authority))
  assert.deepEqual(ledger.sourceBindings.filter(x => x.disposition === 'accepted').map(x => x.sourceRevisionId), [b.id])
  assert.equal(ledger.sources.find(x => x.id === a.id).publicTextSha256, sha('PUBLIC_KEY_RED'))
  assert.equal(ledger.records.find(x => x.id === 'event_red').active, false)
  deny(await f.store.readSource(f.authority, aSpan), 'source_unavailable')
  assert.equal(must(await f.store.readSource(f.authority, await span(f, b))), 'PUBLIC_KEY_BLUE')
  const files = await fs.readdir(path.join(f.directory, 'profile', '.dsh-rp/v1/workspaces', f.workspace.workspaceId, 'commits'))
  const commits = await Promise.all(files.filter(x => x.endsWith('.json')).map(x => fs.readFile(path.join(f.directory, 'profile', '.dsh-rp/v1/workspaces', f.workspace.workspaceId, 'commits', x), 'utf8')))
  assert.equal(commits.join('').includes('SENSITIVE_EVENT_RED'), false)
})

test('A07 crash after publish and before acknowledgement replays one effect and rejects key conflicts', async () => {
  const f = await setup(), s = await source(f, 'PUBLIC_KEY_RED', 'revision_a')
  const input = batch(await fence(f), s, 'once')
  const first = must(await f.store.commit(f.authority, input))
  for (let i = 0; i < 3; i++) {
    const restarted = await api.openRpStore({ profileRoot: path.join(f.directory, 'profile') })
    const auth = must(await restarted.control.authorize(f.request))
    assert.deepEqual(must(await restarted.store.commit(auth, input)), first)
    deny(await restarted.store.commit(f.authority, input), 'scope_denied')
  }
  const conflicting = structuredClone(input); conflicting.invalidatedIds = ['event_other']
  deny(await f.store.commit(f.authority, conflicting), 'idempotency_conflict')
  const ledger = must(await f.store.readLedger(f.authority))
  assert.equal(ledger.fence.contextRevision, 1)
  assert.equal(ledger.sourceBindings.filter(x => x.disposition === 'accepted').length, 1)
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {openRpStore} from ${JSON.stringify(new URL('file:///' + runtime.replaceAll('\\', '/')).href)}; const f=await openRpStore({profileRoot:process.argv[1]}); const a=await f.control.authorize(JSON.parse(process.argv[2])); const r=await f.store.commit(a.value,JSON.parse(process.argv[3])); console.log(JSON.stringify(r));` , path.join(f.directory, 'profile'), JSON.stringify(f.request), JSON.stringify(input)], { encoding: 'utf8', timeout: 15000 })
  assert.equal(child.status, 0, child.stderr)
  assert.deepEqual(JSON.parse(child.stdout.trim()), { ok: true, value: first })
})

test('A08 each durable boundary recovers only an old or complete branch and queued-job relationship', async () => {
  for (const point of ['blob_written', 'blob_synced', 'blob_published', 'transaction_written', 'transaction_synced', 'seal_written', 'seal_synced', 'seal_published', 'transaction_published', 'directory_synced']) {
    const f = await setup(), s = await source(f, 'PUBLIC_KEY_RED', 'revision_a'), input = batch(await fence(f), s, 'atomic')
    input.jobs = [{ id: 'job_extract', kind: 'extract', inputFence: input.expected, attempts: 0, maxAttempts: 3, state: 'queued', idempotencyKey: 'job_once' }]
    input.events = [{ schemaVersion: 1, id: 'event_atomic', scope: f.authority.scope, acceptedSeq: 1, fictionalTime: null,
      payload: { kind: 'occurrence', actorIds: ['character_erin'], description: 'EVENT_ATOMIC' }, epistemic: 'world', authority: 'accepted_narration',
      sources: [{ sourceRevisionId: s.id, publicTextSha256: s.publicTextSha256, startUtf16: 0, endUtf16: s.publicTextLengthUtf16, quoteSha256: sha('PUBLIC_KEY_RED') }], visibility, supersedes: [], policyVersion: 'rp.v1' }]
    const broken = await api.openRpStore({ profileRoot: path.join(f.directory, 'profile'), fault: stage => { if (stage === point) throw new Error('FAULT_' + point) } })
    const auth = must(await broken.control.authorize(f.request))
    const result = await broken.store.commit(auth, input)
    deny(result, point.startsWith('seal_') || point === 'transaction_published' || point === 'directory_synced' ? 'persistence_uncertain' : 'persistence_failed')
    assert.match(result.message, new RegExp('FAULT_' + point))
    const resumed = await api.openRpStore({ profileRoot: path.join(f.directory, 'profile') }), ra = must(await resumed.control.authorize(f.request))
    const ledger = must(await resumed.store.readLedger(ra)), isNew = ledger.fence.contextRevision === 1
    assert.equal(ledger.sourceBindings.some(x => x.disposition === 'accepted'), isNew, point)
    assert.equal(ledger.jobs.length === 1, isNew, point)
    assert.equal(ledger.records.length === 1, isNew, point)
    must(await resumed.store.commit(ra, input))
    assert.equal(must(await resumed.store.readLedger(ra)).jobs.length, 1, point)
    evidence.atomicBoundaries.push({ stage: point, initialResult: result.code, recoveredBeforeRetry: isNew ? 'complete_new' : 'old', revisionAfterRetry: 1, acceptedBindingsAfterRetry: 1, jobsAfterRetry: 1 })
  }
})

test('A09 same-directory migration preserves identity; copies, replacements and old authority are denied', async () => {
  const f = await setup(), s = await source(f, 'PUBLIC_KEY_RED', 'revision_a'); await accept(f, s)
  const savedSpan = await span(f, s), old = path.join(f.directory, 'project'), moved = path.join(f.directory, 'moved')
  await fs.cp(old, path.join(f.directory, 'copy'), { recursive: true })
  deny(await f.control.openWorkspace(path.join(f.directory, 'copy')), 'scope_denied')
  await fs.rename(old, moved)
  deny(await f.control.openWorkspace(moved), 'scope_denied')
  const migrated = must(await f.control.migrateWorkspace(f.authority, moved))
  assert.equal(migrated.workspaceId, f.workspace.workspaceId)
  deny(await f.store.readSource(f.authority, savedSpan), 'scope_denied')
  const auth = must(await f.control.authorize(f.request))
  assert.equal(must(await f.store.readSource(auth, savedSpan)), 'PUBLIC_KEY_RED')
  await fs.mkdir(old)
  deny(await f.control.openWorkspace(old), 'scope_denied')
  const fresh = must(await f.control.createWorkspace(old)); assert.notEqual(fresh.workspaceId, f.workspace.workspaceId)
  deny(await f.control.migrateWorkspace({}, moved), 'scope_denied')
})

test('A10 source bytes are UTF8 hashed, UTF16 spans preserve surrogate pairs, corruption never recovers summary text', async () => {
  const f = await setup(), text = 'e\u0301😀蓝钥匙', s = await source(f, text, 'revision_unicode'); await accept(f, s)
  assert.equal(s.publicTextSha256, '72627288f360404f2a764ca6125efb1028f823e6432b0fdaefe4e4eb7d237fbe')
  assert.equal(must(await f.store.readSource(f.authority, await span(f, s, 2, 4))), '😀')
  deny(await f.store.sourceSpan(f.authority, s.id, 3, 4), 'invalid_record')
  deny(await f.store.readSource(f.authority, { ...await span(f, s), quoteSha256: '0'.repeat(64) }), 'source_unavailable')
  const location = path.join(f.directory, 'profile', '.dsh-rp/v1/workspaces', f.workspace.workspaceId, 'blobs', s.blobId + '.blob')
  const validSpan = await span(f, s)
  await fs.writeFile(location, 'CORRUPT')
  deny(await f.store.readSource(f.authority, validSpan), 'source_unavailable')
  await fs.unlink(location)
  deny(await f.store.readSource(f.authority, validSpan), 'source_unavailable')
})

test('A11 cloned/forged authority and cross-scope mutations are denied before source blob I/O', async () => {
  let reads = 0
  const f = await setup({ onBlobRead: () => reads++ }), s = await source(f, 'SECRET_LETTER_AUTHOR', 'revision_a'); await accept(f, s)
  const validSpan = await span(f, s); reads = 0
  for (const fake of [{}, { ...f.authority }, { ...f.authority, viewpoint: { kind: 'narrator' } }, { scope: { kind: 'profile', profileId: 'profile_fake' }, approved: true, owner: true }]) {
    deny(await f.store.readSource(fake, validSpan), 'scope_denied')
  }
  assert.equal(reads, 0)
  const other = await setup(), otherSource = await source(other, 'OTHER_SECRET', 'revision_a'); await accept(other, otherSource)
  deny(await f.store.readSource(f.authority, { ...validSpan, sourceRevisionId: otherSource.id }), 'source_unavailable')
  assert.equal(reads, 0)
  const input = batch(await fence(f), s, 'forged', { sourceBindings: [] }); input.approved = true
  deny(await f.store.commit(f.authority, input), 'scope_denied')
  input.approved = undefined; delete input.approved; input.authorityChanges = [{ kind: 'visibility', recordId: 'policy_fake', record: { approved: true } }]
  deny(await f.store.commit(f.authority, input), 'scope_denied')
})

test('runtime schema rejects unknown fields, unsafe revisions, paths, malformed event kinds and deep JSON', async () => {
  const f = await setup(), s = await source(f, 'PUBLIC', 'revision_a'), good = batch(await fence(f), s)
  for (const mutate of [v => v.expected.contextRevision = Infinity, v => v.nextContextRevision = Number.MAX_SAFE_INTEGER + 1,
    v => v.expected.sourceManifestHash = 'bad', v => v.sourceBindings[0].sourceRevisionId = '../escape',
    v => v.authorityChanges = [{ kind: 'branch_parent', recordId: 'parent_a', record: { branchId: 'parent_a', contextRevision: 1 } }],
    v => v.sourceBindings[0].acceptedSeq = -1]) {
    const input = structuredClone(good); mutate(input); assert.equal((await f.store.commit(f.authority, input)).ok, false)
  }
  deny(await f.store.observeSource(f.authority, { ...observation(), reasoning: 'PRIVATE_REASONING' }), 'scope_denied')
  const parsed = api.parseRecord({ kind: 'event', record: { arbitrary: true } }); assert.equal(parsed.ok, false)
  let deep = {}; for (let i = 0; i < 40; i++) deep = { next: deep }
  assert.equal(api.parseRecord(deep).ok, false)
})

test('P1 deletion tombstones immediately block raw and derived reads while immutable metadata stays replayable', async () => {
  const f = await setup(), s = await source(f, 'DELETED_SENTINEL', 'revision_a'); await accept(f, s)
  const savedSpan = await span(f, s), input = batch(await fence(f), s, 'delete', { sourceBindings: [],
    authorityChanges: [{ kind: 'deletion', recordId: 'deletion_one', record: { id: 'deletion_one', generation: 1, scope: f.authority.scope,
      sourceRevisionIds: [s.id], blockedDerivedIds: [], purgeState: 'blocked', externalLimitations: ['host-log-not-managed'] } }] })
  must(await f.store.commit(f.authority, input))
  deny(await f.store.readSource(f.authority, savedSpan), 'source_unavailable')
  const ledger = must(await f.store.readLedger(f.authority)); assert.equal(ledger.fence.deletionGeneration, 1)
  assert.equal(ledger.deletions.length, 1)
  // P1 intentionally exposes no falsely complete purge API; P2 owns managed-copy cleanup.
  const location = path.join(f.directory, 'profile', '.dsh-rp/v1/workspaces', f.workspace.workspaceId, 'blobs', s.blobId + '.blob')
  await fs.unlink(location)
  const resumed = await api.openRpStore({ profileRoot: path.join(f.directory, 'profile') }), auth = must(await resumed.control.authorize(f.request))
  assert.equal(must(await resumed.store.readLedger(auth)).deletions.length, 1)
  deny(await resumed.store.readSource(auth, savedSpan), 'source_unavailable')
})

test('real independent processes serialize commits and refuse abandoned locks without timeout stealing', async () => {
  const f = await setup(), s = await source(f, 'PUBLIC', 'revision_a'), input = batch(await fence(f), s, 'multiprocess')
  const childScript = `import {openRpStore} from ${JSON.stringify(pathToFileURL(runtime).href)}; const f=await openRpStore({profileRoot:process.argv[1],fault:async p=>{if(p==='transaction_synced'){console.log('LOCK_HELD');await new Promise(()=>{setInterval(()=>{},1000)})}}});const a=await f.control.authorize(JSON.parse(process.argv[2]));await f.store.commit(a.value,JSON.parse(process.argv[3]));`
  const child = spawn(process.execPath, ['--input-type=module', '-e', childScript, path.join(f.directory, 'profile'), JSON.stringify(f.request), JSON.stringify(input)], { stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('lock child did not reach durable barrier')), 10000); child.stdout.on('data', x => { if (x.toString().includes('LOCK_HELD')) { clearTimeout(timer); resolve() } }); child.once('exit', code => { if(code) reject(new Error('lock child exit ' + code)) }) })
    deny(await f.store.commit(f.authority, input), 'store_locked')
    deny(await f.control.recoverWriterLock(f.authority), 'store_locked')
  } finally { if (child.exitCode === null && child.signalCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited } }
  deny(await f.store.commit(f.authority, input), 'store_locked')
  must(await f.control.recoverWriterLock(f.authority))
  must(await f.store.commit(f.authority, input))
})

test('A07 actual process exit after transaction publication is recovered explicitly and consumed once', async () => {
  const f = await setup(), s = await source(f, 'PUBLIC', 'revision_a'), input = batch(await fence(f), s, 'actual_crash')
  const script = `import {openRpStore} from ${JSON.stringify(pathToFileURL(runtime).href)};const f=await openRpStore({profileRoot:process.argv[1],fault:p=>{if(p==='transaction_published')process.exit(73)}});const a=await f.control.authorize(JSON.parse(process.argv[2]));await f.store.commit(a.value,JSON.parse(process.argv[3]));`
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, path.join(f.directory, 'profile'), JSON.stringify(f.request), JSON.stringify(input)], { encoding: 'utf8', timeout: 15000 })
  assert.equal(child.status, 73, child.stderr)
  const resumed = await api.openRpStore({ profileRoot: path.join(f.directory, 'profile') }), authority = must(await resumed.control.authorize(f.request))
  assert.equal(must(await resumed.store.readFence(authority)).contextRevision, 1)
  deny(await resumed.store.commit(authority, input), 'store_locked')
  must(await resumed.control.recoverWriterLock(authority))
  for (let i = 0; i < 3; i++) assert.equal(must(await resumed.store.commit(authority, input)).contextRevision, 1)
  assert.equal(must(await resumed.store.readLedger(authority)).sourceBindings.length, 1)
  evidence.actualCrash = { childExitCode: child.status, recovery: 'explicit_dead_pid_and_exact_owner', repeatedDeliveries: 3, finalContextRevision: 1, acceptedBindings: 1 }
  evidence.durability = resumed.store.durability()
})

test('source page snapshots are opaque, hash-stable, UTF16 safe and reauthorized on every page', async () => {
  const f = await setup(), s = await source(f, 'AB😀CD', 'revision_a'); await accept(f, s)
  const snapshot = must(await f.store.openSourceSnapshot(f.authority, await span(f, s)))
  const first = must(await f.store.readSourcePage(f.authority, snapshot, 0, 3))
  const second = must(await f.store.readSourcePage(f.authority, snapshot, first.nextOffset, 4))
  assert.equal(first.text + second.text, 'AB😀CD')
  assert.equal(first.bodySha256, sha('AB😀CD')); assert.equal(second.bodySha256, first.bodySha256)
  deny(await f.store.readSourcePage(f.authority, {}, 0, 3), 'scope_denied')
  const other = must(await f.control.authorize(f.request))
  deny(await f.store.readSourcePage(other, snapshot, 0, 3), 'scope_denied')
})

test('source adapter captures public blocks without reasoning or automatic accepted bindings', async () => {
  const f = await setup()
  const adapterFile = path.join(base, 'adapter.mjs')
  assert.equal(existsSync('src/rp/source-adapter.ts'), true, 'public host observation requires an explicit RP adapter')
  await build({ entryPoints: ['src/rp/source-adapter.ts'], outfile: adapterFile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
  stop()
  const { observePublicHostSource } = await import(pathToFileURL(adapterFile).href)
  const s = must(await observePublicHostSource(f.store, f.authority, { idempotencyKey: 'adapter_source', host: observation(undefined, 'revision_adapter').host, turnId: ids.turn,
    event: { seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'thinking', text: 'PRIVATE_REASONING' }, { type: 'text', text: 'PUBLIC_A' }, { type: 'reasoning', text: 'PRIVATE_OTHER' }, { type: 'text', text: 'PUBLIC_B' }] } } } }))
  assert.equal(s.publicTextSha256, sha('PUBLIC_A\nPUBLIC_B'))
  assert.equal(must(await f.store.readLedger(f.authority)).sourceBindings.length, 0)
  assert.deepEqual(await fs.readdir(path.join(f.directory, 'profile')), ['.dsh-rp'])
})

test('A11 raw ledger metadata requires narrator control; low permission and character handles reveal no IDs or counts', async () => {
  const f = await setup(), s = await source(f, 'SECRET_LETTER_AUTHOR', 'revision_a'); await accept(f, s)
  for (const overrides of [{ permissions: ['read'] }, { viewpoint: { kind: 'character', entityId: 'character_erin' } }]) {
    const authority = must(await f.control.authorize({ ...f.request, ...overrides }))
    const result = await f.store.readLedger(authority)
    deny(result, 'scope_denied')
    assert.equal(JSON.stringify(result).includes(s.id), false)
    assert.equal('value' in result, false)
  }
})

test('A11 narrator control with public audience cannot inspect secret binding or task metadata', async () => {
  const f = await setup(), secretVisibility = { ...visibility, audienceSetId: 'audience_secret' }
  const secretAuth = must(await f.control.authorize({ ...f.request, visibility: secretVisibility, audienceSetIds: ['audience_public', 'audience_secret'] }))
  const s = must(await f.store.observeSource(secretAuth, observation('SECRET_LETTER_AUTHOR', 'revision_secret')))
  must(await f.store.commit(secretAuth, batch(must(await f.store.readFence(secretAuth)), s, 'secret_accept')))
  const result = await f.store.readLedger(f.authority)
  deny(result, 'scope_denied'); assert.equal(JSON.stringify(result).includes(s.id), false)
})

test('bootstrap root writer death has a trusted explicit recovery path before control can be acquired', async () => {
  const f = await setup()
  const script = `import {openRpStore} from ${JSON.stringify(pathToFileURL(runtime).href)};await openRpStore({profileRoot:process.argv[1],fault:p=>{if(p==='profile_locked')process.exit(74)}});`
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, path.join(f.directory, 'profile')], { encoding: 'utf8', timeout: 15000 })
  assert.equal(child.status, 74, child.stderr)
  await assert.rejects(() => api.openRpStore({ profileRoot: path.join(f.directory, 'profile') }), e => e.code === 'store_locked')
  must(await api.recoverRpProfileLock({ profileRoot: path.join(f.directory, 'profile') }))
  const resumed = await api.openRpStore({ profileRoot: path.join(f.directory, 'profile') })
  assert.equal(must(await resumed.control.openWorkspace(path.join(f.directory, 'project'))).workspaceId, f.workspace.workspaceId)
})

test('losing a published tail transaction fails closed instead of reviving the source it tombstoned', async () => {
  const f = await setup(), s = await source(f, 'DELETED_SENTINEL', 'revision_a'); await accept(f, s)
  const savedSpan = await span(f, s)
  must(await f.store.commit(f.authority, batch(await fence(f), s, 'tail_tombstone', { sourceBindings: [], authorityChanges: [{ kind: 'deletion', recordId: 'deletion_tail', record: { id: 'deletion_tail', generation: 1, scope: f.authority.scope, sourceRevisionIds: [s.id], blockedDerivedIds: [], purgeState: 'blocked', externalLimitations: ['host-log-not-managed'] } }] })))
  const directory = path.join(f.directory, 'profile', '.dsh-rp/v1/workspaces', f.workspace.workspaceId, 'commits')
  const files = (await fs.readdir(directory)).filter(file => file.endsWith('.json')).sort()
  await fs.unlink(path.join(directory, files.at(-1)))
  deny(await f.store.readSource(f.authority, savedSpan), 'store_corrupt')
})

test('read overlapping a new transaction seal reports stale rather than corrupt and can retry', async () => {
  const f = await setup(), s = await source(f, 'PUBLIC', 'revision_a'); await accept(f, s)
  const savedSpan = await span(f, s), next = batch(await fence(f), s, 'concurrent_advance', { sourceBindings: [] })
  let armed = false
  const reader = await api.openRpStore({ profileRoot: path.join(f.directory, 'profile'), fault: async stage => {
    if (armed && stage === 'metadata_listed') { armed = false; must(await f.store.commit(f.authority, next)) }
  } })
  const authority = must(await reader.control.authorize(f.request)); armed = true
  deny(await reader.store.readSource(authority, savedSpan), 'stale_input')
  assert.equal(must(await reader.store.readSource(authority, savedSpan)), 'PUBLIC')
})

test('deleting an unseen candidate source is scope denied and secret deletion metadata stays out of public audit', async () => {
  const f = await setup(), secretAuth = must(await f.control.authorize({ ...f.request, visibility: { ...visibility, audienceSetId: 'audience_secret' }, audienceSetIds: ['audience_public', 'audience_secret'] }))
  const s = must(await f.store.observeSource(secretAuth, observation('SECRET_LETTER_AUTHOR', 'revision_secret')))
  const input = batch(await fence(f), s, 'delete_secret', { sourceBindings: [], authorityChanges: [{ kind: 'deletion', recordId: 'deletion_secret', record: { id: 'deletion_secret', generation: 1, scope: f.authority.scope, sourceRevisionIds: [s.id], blockedDerivedIds: [], purgeState: 'blocked', externalLimitations: ['host-log-not-managed'] } }] })
  deny(await f.store.commit(f.authority, input), 'scope_denied')
  must(await f.store.commit(secretAuth, input))
  deny(await f.store.readLedger(f.authority), 'scope_denied')
})

test('fixed parent prefix metadata is exact and replayable without following later parent commits', async () => {
  const f = await setup(), s = await source(f, 'PUBLIC', 'revision_a'); await accept(f, s)
  const prefix = await fence(f), child = must(await f.control.createBranch(f.workspace.workspaceId, ids.campaign))
  const childRequest = { ...f.request, branchId: child.id }, authority = must(await f.control.authorize(childRequest))
  const bindings = [{ sourceRevisionId: s.id, branchId: child.id, turnId: ids.turn, disposition: 'accepted', acceptedSeq: 1 }]
  const input = batch(must(await f.store.readFence(authority)), s, 'fixed_prefix', { sourceBindings: bindings, authorityChanges: [{ kind: 'branch_parent', recordId: 'parent_prefix', record: { branchId: f.branch.id, contextRevision: prefix.contextRevision, prefixManifestHash: prefix.sourceManifestHash, sourceBindings: bindings } }] })
  must(await f.store.commit(authority, input))
  must(await f.store.commit(f.authority, batch(await fence(f), s, 'parent_later', { sourceBindings: [] })))
  const resumed = await api.openRpStore({ profileRoot: path.join(f.directory, 'profile') }), ca = must(await resumed.control.authorize(childRequest))
  const ledger = must(await resumed.store.readLedger(ca))
  assert.equal(ledger.branch.parent.contextRevision, 1)
  assert.equal(ledger.branch.parent.prefixManifestHash, prefix.sourceManifestHash)
  assert.equal(ledger.sources.length, 1)
  assert.equal(must(await resumed.store.readSource(ca, await span(f, s))), 'PUBLIC')
})

test('canon binding requires a trusted publication verifier and visibility mutation revokes old read authority', async () => {
  const f = await setup(), canon = { worldId: 'world_story', publicationId: 'publication_approved', revision: 1, bodySha256: sha('APPROVED_CANON') }
  const input = { schemaVersion: 1, idempotencyKey: 'canon_bind', expected: await fence(f), sourceBindings: [], events: [], summaries: [], jobs: [], invalidatedIds: [], nextContextRevision: 1,
    authorityChanges: [{ kind: 'canon_binding', recordId: 'canon_one', record: canon }] }
  deny(await f.store.commit(f.authority, input), 'capability_missing')
  const verified = await api.openRpStore({ profileRoot: path.join(f.directory, 'profile'), verifyCanonBinding: async record => JSON.stringify(record) === JSON.stringify(canon) }), authority = must(await verified.control.authorize(f.request))
  const canonFence = must(await verified.store.commit(authority, input))
  assert.notEqual(canonFence.canonBindingsHash, input.expected.canonBindingsHash)
  const visibilityInput = { ...input, idempotencyKey: 'visibility_change', expected: canonFence, nextContextRevision: 2, authorityChanges: [{ kind: 'visibility', recordId: visibility.policyId, record: { ...visibility, revision: 1 } }] }
  must(await verified.store.commit(authority, visibilityInput))
  deny(await verified.store.readFence(authority), 'scope_denied')
  const fresh = must(await verified.control.authorize({ ...f.request, visibility: { ...visibility, revision: 1 } }))
  assert.equal(must(await verified.store.readLedger(fresh)).authorityChanges.length, 2)
})

test('active derived payload becomes unavailable when its original source bytes disappear', async () => {
  const f = await setup(), s = await source(f, 'PUBLIC', 'revision_a'); await accept(f, s)
  const event = { schemaVersion: 1, id: 'event_original', scope: f.authority.scope, acceptedSeq: 1, fictionalTime: null, payload: { kind: 'occurrence', actorIds: ['character_erin'], description: 'EVENT_PAYLOAD' }, epistemic: 'world', authority: 'accepted_narration', sources: [await span(f, s)], visibility, supersedes: [], policyVersion: 'rp.v1' }
  must(await f.store.commit(f.authority, batch(await fence(f), s, 'derived_original', { sourceBindings: [], events: [event] })))
  assert.equal(must(await f.store.readEvents(f.authority)).length, 1)
  await fs.unlink(path.join(f.directory, 'profile', '.dsh-rp/v1/workspaces', f.workspace.workspaceId, 'blobs', s.blobId + '.blob'))
  deny(await f.store.readEvents(f.authority), 'source_unavailable')
})

test('host read access to two audiences cannot widen a secret source into a public derived record', async () => {
  const f = await setup(), secretAuth = must(await f.control.authorize({ ...f.request, visibility: { ...visibility, audienceSetId: 'audience_secret' }, audienceSetIds: ['audience_public', 'audience_secret'] }))
  const s = must(await f.store.observeSource(secretAuth, observation('SECRET_LETTER_AUTHOR', 'revision_secret')))
  must(await f.store.commit(secretAuth, batch(must(await f.store.readFence(secretAuth)), s, 'accept_secret')))
  const wideRead = must(await f.control.authorize({ ...f.request, audienceSetIds: ['audience_public', 'audience_secret'] }))
  const event = { schemaVersion: 1, id: 'event_public_from_secret', scope: wideRead.scope, acceptedSeq: 1, fictionalTime: null, payload: { kind: 'occurrence', actorIds: ['character_erin'], description: 'SECRET_LETTER_AUTHOR' }, epistemic: 'world', authority: 'accepted_narration', sources: [must(await f.store.sourceSpan(wideRead, s.id, 0, s.publicTextLengthUtf16))], visibility, supersedes: [], policyVersion: 'rp.v1' }
  deny(await f.store.commit(wideRead, batch(must(await f.store.readFence(wideRead)), s, 'widen', { sourceBindings: [], events: [event] })), 'scope_denied')
})

test('semantic dependency IDs and supersession remain authoritative while payloads live only in blobs', async () => {
  const f = await setup(), s = await source(f, 'PUBLIC', 'revision_a'); await accept(f, s)
  const common = { schemaVersion: 1, scope: f.authority.scope, acceptedSeq: 1, fictionalTime: null, epistemic: 'world', authority: 'accepted_narration', sources: [await span(f, s)], visibility, supersedes: [], policyVersion: 'rp.v1' }
  const occurrence = { ...common, id: 'event_trigger', payload: { kind: 'occurrence', actorIds: ['character_erin'], description: 'ORIGINAL_TRIGGER' } }
  const relationship = { ...common, id: 'event_relationship', payload: { kind: 'relationship_change', fromId: 'character_erin', toId: 'character_other', relation: 'trust', value: 'uneasy', triggerEventIds: ['event_trigger'], unresolvedTension: 'SENSITIVE_TENSION' } }
  must(await f.store.commit(f.authority, batch(await fence(f), s, 'relations', { sourceBindings: [], events: [occurrence, relationship] })))
  const revised = { ...common, id: 'event_revised', payload: { kind: 'occurrence', actorIds: ['character_erin'], description: 'REVISED_TRIGGER' }, supersedes: ['event_trigger'] }
  must(await f.store.commit(f.authority, batch(await fence(f), s, 'revise_trigger', { sourceBindings: [], events: [revised] })))
  assert.deepEqual(must(await f.store.readEvents(f.authority)).map(x => x.id), ['event_revised'])
  const ledger = must(await f.store.readLedger(f.authority))
  assert.deepEqual(ledger.records.find(x => x.id === 'event_relationship').dependencyIds, ['event_trigger'])
})
