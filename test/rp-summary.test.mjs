import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { build, stop } from 'esbuild'
import { spawnSync } from 'node:child_process'
const base = path.resolve('work/rp-summary-tests'); await fs.mkdir(base, { recursive: true })
const runtime = path.join(base, 'runtime.mjs')
await build({ entryPoints: ['src/rp/memory.ts'], outfile: runtime, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
const api = await import(pathToFileURL(runtime).href + '?' + randomUUID()); stop()
const storeRuntime = path.join(base, 'store.mjs')
await build({ entryPoints: ['src/rp/store.ts'], outfile: storeRuntime, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
const storeApi = await import(pathToFileURL(storeRuntime).href + '?' + randomUUID()); stop()
const must = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value }
const deny = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.code, code) }
const visibility = { policyId: 'policy_story', revision: 0, audienceSetId: 'public' }
async function setup(extra = {}) {
  const directory = path.join(base, randomUUID()); await fs.mkdir(path.join(directory, 'project'), { recursive: true })
  const f = await api.openRpMemory({ profileRoot: path.join(directory, 'profile'), entityIds: ['erin', 'king', 'key'], ...extra })
  const workspace = must(await f.control.createWorkspace(path.join(directory, 'project'))), branch = must(await f.control.createBranch(workspace.workspaceId, 'campaign'))
  const request = { workspaceId: workspace.workspaceId, campaignId: 'campaign', branchId: branch.id, sessionId: 'session_story', sceneId: 'scene_story', viewpoint: { kind: 'narrator' }, visibility, audienceSetIds: ['public', 'secret'], permissions: ['read', 'observe', 'commit', 'control'] }
  return { ...f, directory, workspace, branch, request, authority: must(await f.control.authorize(request)) }
}
async function ctl(f, key) { return must(await f.store.observeSource(f.authority, { idempotencyKey: 'ctl_' + key, origin: 'user_control', role: 'user_control', publicText: 'CONTROL_' + key, turnId: 'ctl_' + key })) }
async function source(f, key, text = 'PUBLIC_KEY_BLUE', events = [], accepted = true) {
  const s = must(await f.store.observeSource(f.authority, { idempotencyKey: key, origin: 'host_public', role: 'assistant', publicText: text, turnId: 'turn_' + key, host: { sessionId: 'session_story', eventSeq: 1, messageId: 'message_' + key, messageRevision: 'revision_' + key } }))
  if (accepted) must(await f.canonical.applyControl(f.authority, await ctl(f, key), { kind: 'accept', sourceRevisionIds: [s.id], events, idempotencyKey: key, expected: must(await f.store.readFence(f.authority)) })); return s
}
const span = s => ({ sourceRevisionId: s.id, publicTextSha256: s.publicTextSha256, startUtf16: 0, endUtf16: s.publicTextLengthUtf16, quoteSha256: s.publicTextSha256 })
const selection = (s, extra = {}) => ({ level: 'scene', sourceRevisionIds: [s.id], dependencySummaryIds: [], supportEventIds: [], ...extra })
const raw = (s, text = '蓝钥匙仍在。', level = 'scene') => ({ schemaVersion: 1, proposedEvents: [], proposedSummary: { level, text, sourceRevisionIds: [s.id], exactAnchors: [span(s)] } })
async function publish(f, s, key, options = {}) {
  const c = must(await f.summaries.propose(f.authority, raw(s), selection(s), options))
  return must(await f.summaries.adopt(f.authority, await ctl(f, key), c.id, { idempotencyKey: key, ...options }))
}
function barrier() { let enter, release; const entered = new Promise(r => enter = r), released = new Promise(r => release = r); return { entered, release, async wait() { enter(); await released } } }

test('A31 manual candidate is persisted without canon effect; explicit adoption derives event authority and holder', async () => {
  const f = await setup(), s = await source(f, 'blue')
  assert.equal(typeof f.summaries?.propose, 'function', 'P4 must expose trusted manual structured candidates')
  const value = raw(s); value.proposedEvents.push({ payload: { kind: 'state_change', subjectId: 'key', key: 'color', after: 'blue' }, epistemic: 'belief', beliefHolderId: 'erin', sources: [span(s)] })
  const c = must(await f.summaries.propose(f.authority, value, selection(s)))
  assert.equal(must(await f.store.readEvents(f.authority)).length, 0)
  const result = must(await f.summaries.adopt(f.authority, await ctl(f, 'adopt'), c.id, { idempotencyKey: 'adopt' }))
  assert.equal(result.summary.level, 'scene'); assert.equal(result.events[0].beliefHolderId, 'erin'); assert.equal(result.events[0].authority, 'character_statement')
  assert.equal(must(await f.store.replayProjection(f.authority)).state[0].beliefHolderId, 'erin')
  assert.equal(must(await f.summaries.adopt(f.authority, await ctl(f, 'other'), c.id, { idempotencyKey: 'again' })).alreadyDecided, true)
})

test('A31 rejects forged metadata, no-source relationships, wrong entity and unknown belief holder', async () => {
  const f = await setup(), s = await source(f, 'blue')
  for (const field of ['id', 'scope', 'visibility', 'accepted', 'authority', 'inputFence', 'dependencySummaryIds']) deny(await f.summaries.propose(f.authority, { ...raw(s), [field]: field === 'accepted' ? true : 'forged' }, selection(s)), 'invalid_candidate')
  for (const proposal of [
    { payload: { kind: 'relationship_change', fromId: 'erin', toId: 'king', relation: 'trust', value: true, triggerEventIds: [] }, epistemic: 'world', sources: [] },
    { payload: { kind: 'state_change', subjectId: 'unknown', key: 'color', after: 'blue' }, epistemic: 'world', sources: [span(s)] },
    { payload: { kind: 'state_change', subjectId: 'key', key: 'color', after: 'blue' }, epistemic: 'belief', beliefHolderId: 'unknown', sources: [span(s)] },
  ]) deny(await f.summaries.propose(f.authority, { ...raw(s), proposedEvents: [proposal] }, selection(s)), 'invalid_candidate')
  assert.equal(must(await f.store.readEvents(f.authority)).length, 0)
})

test('A26 generation releases writer gate; append invalidates paused result and leaves no summary', async () => {
  const f = await setup(), s = await source(f, 'blue'), gate = barrier(), expected = must(await f.store.readFence(f.authority))
  const job = must(await f.jobs.enqueue(f.authority, selection(s), { idempotencyKey: 'job' }))
  assert.deepEqual(must(await f.store.readFence(f.authority)), expected, 'job bookkeeping is not semantic input')
  const run = f.jobs.run(f.authority, job.id, { async generate(input, signal) { assert.equal('store' in input, false); assert.equal('authority' in input, false); assert.equal('control' in input, false); await gate.wait(); signal.throwIfAborted(); return raw(s) } }, { controlSource: await ctl(f, 'job') })
  await gate.entered; await source(f, 'later', 'NEW_APPEND'); gate.release(); const result = await run
  deny(result, 'stale_input'); assert.equal(must(await f.store.readSummaries(f.authority)).length, 0)
  assert.equal(must(await f.jobs.list(f.authority))[0].state, 'stale')
})

test('A27 publication rechecks independently changed branch fields, globals and policy epoch', async () => {
  for (const dimension of ['source', 'canon', 'visibility', 'deletion', 'policy', 'global']) {
    const f = await setup(), s = await source(f, 'blue'), gate = barrier(); let epoch = 1
    const ga = must(await f.global.control.authorize({ scope: { kind: 'world', profileId: f.workspace.profileId, worldId: 'world_one' }, visibility, audienceSetIds: ['public'], write: true }))
    const options = { globalAuthorities: [ga], policyEpoch: () => epoch }
    const job = must(await f.jobs.enqueue(f.authority, selection(s), { idempotencyKey: 'job', ...options }))
    const run = f.jobs.run(f.authority, job.id, { async generate() { await gate.wait(); return raw(s) } }, { controlSource: await ctl(f, 'job'), ...options })
    await gate.entered
    if (dimension === 'policy') epoch++
    else if (dimension === 'source') { const replacement = await source(f, 'revision', 'SOURCE_CHANGED', [], false); must(await f.canonical.applyControl(f.authority, await ctl(f, 'replace'), { kind: 'replace', sourceRevisionId: s.id, replacementSourceRevisionId: replacement.id, events: [], idempotencyKey: 'replace', expected: must(await f.store.readFence(f.authority)) })) }
    else if (dimension === 'global' || dimension === 'canon') {
      const approval = f.global.control.approval({ commandId: 'publish', sessionId: 'session_story' })
      const p = must(await f.global.control.publish(ga, approval, { idempotencyKey: 'publish', expected: must(await f.global.store.readFence(ga)), key: 'rule', body: 'changed', privateSourceIds: [] }))
      if (dimension === 'canon') must(await f.adoptCanon(f.authority, ga, approval, p.id, 'canon'))
    } else {
      const fence = must(await f.store.readFence(f.authority))
      if (dimension === 'deletion') must(await f.canonical.applyControl(f.authority, await ctl(f, 'delete'), { kind: 'privacy_delete', idempotencyKey: 'delete', expected: fence, sourceRevisionIds: [s.id], affectedBranchIds: [f.branch.id] }))
      else must(await f.store.commit(f.authority, { schemaVersion: 1, idempotencyKey: 'visibility', expected: fence, sourceBindings: [], events: [], summaries: [], jobs: [], invalidatedIds: [], authorityChanges: [{ kind: 'visibility', recordId: visibility.policyId, record: { ...visibility, revision: 1 } }], nextContextRevision: fence.contextRevision + 1 }))
    }
    gate.release(); assert.equal((await run).ok, false, dimension)
    if (dimension !== 'visibility') assert.equal(must(await f.store.readSummaries(f.authority)).length, 0, dimension)
  }
})

test('A28 stale retries stop exactly at three and shared profile slot spans memory instances/workspaces', async () => {
  const coordinator = new api.MemoryCoordinator(), f = await setup({ coordinator }), s = await source(f, 'blue')
  let calls = 0
  const job = must(await f.jobs.enqueue(f.authority, selection(s), { idempotencyKey: 'retry' }))
  const result = await f.jobs.run(f.authority, job.id, { async generate() { calls++; await source(f, 'stale' + calls); return raw(s) } }, { controlSource: await ctl(f, 'job'), retryStale: true })
  deny(result, 'stale_input'); assert.equal(calls, 3); assert.equal(must(await f.jobs.list(f.authority))[0].state, 'deferred')
  const other = await api.openRpMemory({ profileRoot: path.join(f.directory, 'profile'), entityIds: ['erin', 'king', 'key'], coordinator })
  await fs.mkdir(path.join(f.directory, 'other-project')); const w = must(await other.control.createWorkspace(path.join(f.directory, 'other-project'))), b = must(await other.control.createBranch(w.workspaceId, 'campaign'))
  const a = must(await other.control.authorize({ ...f.request, workspaceId: w.workspaceId, branchId: b.id })), otherFixture = { ...f, ...other, workspace: w, branch: b, authority: a }, s2 = await source(otherFixture, 'workspace_two')
  const gate = barrier(), j1 = must(await f.jobs.enqueue(f.authority, selection(s), { idempotencyKey: 'first' })), j2 = must(await other.jobs.enqueue(a, selection(s2), { idempotencyKey: 'second' }))
  const one = f.jobs.run(f.authority, j1.id, { async generate() { await gate.wait(); return raw(s) } }, { controlSource: await ctl(f, 'one') }); await gate.entered
  deny(await other.jobs.run(a, j2.id, { async generate() { throw new Error('profile bound bypassed') } }, { controlSource: await ctl(otherFixture, 'two') }), 'store_locked')
  gate.release(); must(await one)
})

test('A29 rejects mixed audience summary instead of trusting self-declared public', async () => {
  const f = await setup(), p = await source(f, 'public'), secretAuth = must(await f.control.authorize({ ...f.request, visibility: { ...visibility, audienceSetId: 'secret' } })), secret = { ...f, authority: secretAuth }
  const s = await source(secret, 'secret', 'SECRET_LETTER_AUTHOR')
  deny(await f.summaries.propose(f.authority, raw(p), selection(p, { sourceRevisionIds: [p.id, s.id] })), 'scope_denied')
  assert.equal(JSON.stringify(must(await f.store.readSummaries(f.authority))).includes('SECRET'), false)
})

test('A32 real source and valid schema permit blue-to-gold distortion; annotated scorer rejects it', async () => {
  const fixture = JSON.parse(await fs.readFile('test/fixtures/rp/semantic-candidates.json', 'utf8')), f = await setup(), s = await source(f, 'color', fixture.sourceText)
  const correct = must(await f.summaries.propose(f.authority, raw(s, fixture.correctSummary), selection(s))), incorrect = must(await f.summaries.propose(f.authority, raw(s, fixture.incorrectSummary), selection(s)))
  assert.ok(correct.id); assert.ok(incorrect.id)
  const good = api.scoreAnnotatedClaims(fixture.claims.map(c => ({ expected: c.expected, actual: c.correct, critical: c.critical }))), bad = api.scoreAnnotatedClaims(fixture.claims.map(c => ({ expected: c.expected, actual: c.incorrect, critical: c.critical })))
  assert.deepEqual([good.evaluated, good.supported, good.unsupported, good.passed], [1, 1, 0, true]); assert.deepEqual([bad.evaluated, bad.supported, bad.unsupported, bad.criticalErrors, bad.passed], [1, 0, 1, 1, false])
  await fs.writeFile(path.join(base, 'semantic-score.json'), JSON.stringify({ schemaVersion: 1, fixtureOnly: true, actualModelCalls: 0, policyVersion: fixture.policyVersion, correct: good, incorrect: bad, live: { state: 'not-run', samples: 0 } }, null, 2) + '\n')
})

test('A05 unaccepted and rejected alternatives cannot enter candidate source coverage', async () => {
  const f = await setup(), s = await source(f, 'accepted'), rejected = await source(f, 'rejected', 'REJECTED_SENTINEL', [], false)
  must(await f.canonical.applyControl(f.authority, await ctl(f, 'reject'), { kind: 'reject', sourceRevisionIds: [rejected.id], idempotencyKey: 'reject', expected: must(await f.store.readFence(f.authority)) }))
  deny(await f.summaries.propose(f.authority, raw(rejected, 'REJECTED_SENTINEL'), selection(rejected)), 'source_unavailable')
  await publish(f, s, 'valid'); assert.equal(JSON.stringify(must(await f.store.readSummaries(f.authority))).includes('REJECTED_SENTINEL'), false)
})

test('A30/A15 scene/chapter/arc retain original union and anchors; retcon invalidates only dependent closure', async () => {
  const f = await setup(), s1 = await source(f, 'one', 'SCENE_ONE', [{ id: 'event_one', payload: { kind: 'state_change', subjectId: 'key', key: 'color', after: 'blue' }, epistemic: 'world' }]), one = await publish(f, s1, 'one_summary')
  const s2 = await source(f, 'two', 'SCENE_TWO'), two = await publish(f, s2, 'two_summary')
  assert.equal(must(await f.store.readSummaries(f.authority)).some(s => s.id === one.summary.id), true, 'append must preserve earlier scene')
  const c = must(await f.summaries.propose(f.authority, { schemaVersion: 1, proposedEvents: [], proposedSummary: { level: 'chapter', text: 'Chapter', sourceRevisionIds: [s1.id, s2.id], exactAnchors: [] } }, { level: 'chapter', sourceRevisionIds: [s1.id], dependencySummaryIds: [one.summary.id, two.summary.id], supportEventIds: ['event_one'] }))
  const chapter = must(await f.summaries.adopt(f.authority, await ctl(f, 'chapter'), c.id, { idempotencyKey: 'chapter' })).summary
  assert.deepEqual(new Set(chapter.sourceRevisionIds), new Set([s1.id, s2.id])); assert.equal(chapter.exactAnchors.length, 2); assert.deepEqual(chapter.supportEventIds, ['event_one'])
  const arcCandidate = must(await f.summaries.propose(f.authority, { schemaVersion: 1, proposedEvents: [], proposedSummary: { level: 'arc', text: 'Arc', sourceRevisionIds: [s1.id, s2.id], exactAnchors: [] } }, { level: 'arc', sourceRevisionIds: [], dependencySummaryIds: [chapter.id], supportEventIds: [] }))
  const arc = must(await f.summaries.adopt(f.authority, await ctl(f, 'arc'), arcCandidate.id, { idempotencyKey: 'arc' })).summary
  must(await f.store.savePayloadCopy(f.authority, { idempotencyKey: 'cache', id: 'cache_chapter', kind: 'cache', sourceRevisionIds: [s1.id, s2.id], dependencyIds: [chapter.id], body: 'Chapter cache' }))
  const replacement = await source(f, 'replacement', 'SCENE_TWO_BLUE', [], false)
  must(await f.canonical.applyControl(f.authority, await ctl(f, 'replace'), { kind: 'replace', sourceRevisionId: s2.id, replacementSourceRevisionId: replacement.id, events: [], idempotencyKey: 'replace', expected: must(await f.store.readFence(f.authority)) }))
  const active = must(await f.store.readSummaries(f.authority)).map(s => s.id)
  assert.deepEqual(active, [one.summary.id]); assert.equal(active.includes(arc.id), false); assert.equal(must(await f.store.readPayloadCopies(f.authority)).some(c => c.id === 'cache_chapter'), false)
})

test('A20 deletion purges candidate/job input and old async output cannot resurrect after cold reopen', async () => {
  const f = await setup(), s = await source(f, 'secret', 'DELETED_SENTINEL'), candidate = must(await f.summaries.propose(f.authority, raw(s, 'DELETED_SENTINEL'), selection(s))), gate = barrier()
  const job = must(await f.jobs.enqueue(f.authority, selection(s), { idempotencyKey: 'job' })), run = f.jobs.run(f.authority, job.id, { async generate() { await gate.wait(); return raw(s, 'DELETED_SENTINEL') } }, { controlSource: await ctl(f, 'job') })
  await gate.entered; const before = must(await f.store.readPayloadCopies(f.authority)); assert.equal(before.some(c => c.id === candidate.id), true)
  must(await f.canonical.applyControl(f.authority, await ctl(f, 'delete'), { kind: 'privacy_delete', idempotencyKey: 'delete', expected: must(await f.store.readFence(f.authority)), sourceRevisionIds: [s.id], affectedBranchIds: [f.branch.id] }))
  gate.release(); assert.equal((await run).ok, false); assert.equal(must(await f.store.readSummaries(f.authority)).length, 0)
  const reopened = await api.openRpMemory({ profileRoot: path.join(f.directory, 'profile'), entityIds: ['erin', 'king', 'key'] }), a = must(await reopened.control.authorize(f.request))
  assert.equal(must(await reopened.store.readPayloadCopies(a)).length, 0); assert.equal(must(await reopened.store.readSummaries(a)).length, 0)
  const commits = path.join(f.directory, 'profile', '.dsh-rp/v1/workspaces', f.workspace.workspaceId, 'commits')
  for (const name of await fs.readdir(commits)) assert.equal((await fs.readFile(path.join(commits, name), 'utf8')).includes('DELETED_SENTINEL'), false)
})

test('job legal state CAS, cancellation, exception release and cold recovery do not invoke generator automatically', async () => {
  const f = await setup(), s = await source(f, 'blue'), j = must(await f.jobs.enqueue(f.authority, selection(s), { idempotencyKey: 'job' })), fence = must(await f.store.readFence(f.authority))
  const input = { idempotencyKey: 'start', expected: j, next: { ...j, state: 'running', attempts: 1 } }
  must(await f.store.transitionJob(f.authority, input)); deny(await f.store.transitionJob(f.authority, { ...input, idempotencyKey: 'stale' }), 'stale_input')
  deny(await f.store.transitionJob({}, input), 'scope_denied'); assert.deepEqual(must(await f.store.readFence(f.authority)), fence)
  const cold = spawnSync(process.execPath, ['--require', path.resolve('scripts/host-acceptance/network-guard.cjs'), '--input-type=module', '-e', 'import {openRpMemory} from ' + JSON.stringify(pathToFileURL(runtime).href) + ';const m=await openRpMemory({profileRoot:process.argv[1],entityIds:["erin","king","key"]});const a=(await m.control.authorize(JSON.parse(process.argv[2]))).value;console.log(JSON.stringify(await m.jobs.recover(a)));', path.join(f.directory, 'profile'), JSON.stringify(f.request)], { encoding: 'utf8', windowsHide: true, timeout: 10000, env: { ...process.env, ULTRA_ACCEPTANCE_NETWORK_LOG: path.join(base, 'cold-network.jsonl') } })
  assert.equal(cold.status, 0, cold.stderr); assert.equal(must(JSON.parse(cold.stdout))[0].state, 'deferred'); assert.equal(must(JSON.parse(cold.stdout))[0].attempts, 1)
  const abort = new AbortController(), gate = barrier(), next = must(await f.jobs.enqueue(f.authority, selection(s), { idempotencyKey: 'cancel' }))
  const work = f.jobs.run(f.authority, next.id, { async generate(_input, signal) { await gate.wait(); signal.throwIfAborted(); return raw(s) } }, { controlSource: await ctl(f, 'cancel'), signal: abort.signal })
  await gate.entered; abort.abort(); gate.release(); assert.equal((await work).ok, false); assert.equal(must(await f.jobs.list(f.authority)).find(j => j.id === next.id).state, 'cancelled')
  const failure = must(await f.jobs.enqueue(f.authority, selection(s), { idempotencyKey: 'throw' })); assert.equal((await f.jobs.run(f.authority, failure.id, { async generate() { throw new Error('unexpected') } }, { controlSource: await ctl(f, 'throw') })).ok, false)
  const good = must(await f.jobs.enqueue(f.authority, selection(s), { idempotencyKey: 'good' })); must(await f.jobs.run(f.authority, good.id, { async generate() { return raw(s) } }, { controlSource: await ctl(f, 'good') })); assert.equal(must(await f.jobs.list(f.authority)).find(j => j.id === good.id).state, 'committed')
})

test('job idempotent retry seals uncertain publication; losing acknowledged last transaction is store_corrupt', async () => {
  const f = await setup(); let armed = true
  const opened = await storeApi.openRpStore({ profileRoot: path.join(f.directory, 'profile'), fault(stage) { if (armed && stage === 'seal_written') { armed = false; throw new Error('JOB_SEAL_FAULT') } } }), a = must(await opened.control.authorize(f.request)), fence = must(await opened.store.readFence(a))
  const next = { id: 'job_seal', kind: 'summarize', inputFence: fence, attempts: 0, maxAttempts: 3, state: 'queued', idempotencyKey: 'logical_seal' }, operation = { idempotencyKey: 'job_operation', expected: null, next }
  deny(await opened.store.transitionJob(a, operation), 'persistence_uncertain')
  const seals = path.join(f.directory, 'profile', '.dsh-rp/v1/workspaces', f.workspace.workspaceId, 'seals'), commits = path.join(f.directory, 'profile', '.dsh-rp/v1/workspaces', f.workspace.workspaceId, 'commits'), before = (await fs.readdir(seals)).filter(n => n.endsWith('.json')).length
  must(await opened.store.transitionJob(a, operation))
  assert.equal((await fs.readdir(seals)).filter(n => n.endsWith('.json')).length, before + 1, 'idempotent success must durably seal the prior job transaction')
  const files = (await fs.readdir(commits)).filter(n => n.endsWith('.json')).sort(); await fs.rename(path.join(commits, files.at(-1)), path.join(base, randomUUID() + '.saved-job-transaction'))
  const cold = await storeApi.openRpStore({ profileRoot: path.join(f.directory, 'profile') }), ca = await cold.control.authorize(f.request)
  if (ca.ok) deny(await cold.store.readLedger(ca.value), 'store_corrupt'); else deny(ca, 'store_corrupt')
})

test('queued cancellation before running lease never calls generator; cancellation at adoption lease never publishes', async () => {
  class ObservedCoordinator extends api.MemoryCoordinator { observer; lock() { const pending = super.lock(); this.observer?.(); return pending } }
  for (const boundary of ['start', 'adopt', 'close']) {
    const coordinator = new ObservedCoordinator(), f = await setup({ coordinator }), s = await source(f, 'blue'), job = must(await f.jobs.enqueue(f.authority, selection(s), { idempotencyKey: 'cancel_' + boundary })), control = await ctl(f, 'job'), abort = new AbortController(); let calls = 0, release
    let reached; const queued = new Promise(r => reached = r)
    if (boundary !== 'adopt') { release = await coordinator.lock(); coordinator.observer = reached }
    else { let count = 0; coordinator.observer = () => { if (++count === 3) abort.abort() } }
    const run = f.jobs.run(f.authority, job.id, { async generate() { calls++; return raw(s) } }, { controlSource: control, signal: abort.signal })
    let closing
    if (boundary !== 'adopt') { await queued; if (boundary === 'close') closing = f.jobs.close(); else abort.abort(); coordinator.observer = undefined; release() }
    const result = await run; if (closing) await closing; assert.equal(result.ok, false, boundary); assert.equal(calls, boundary === 'adopt' ? 1 : 0, boundary)
    assert.equal(must(await f.store.readSummaries(f.authority)).length, 0, boundary)
    assert.equal(must(await f.jobs.list(f.authority))[0].state, 'cancelled', boundary)
  }
})
