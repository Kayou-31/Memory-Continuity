import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { build, stop } from 'esbuild'
import { observation, batch, visibility, ids } from './fixtures/rp/story-fixture.mjs'

const base = path.resolve('work/rp-replay-tests'); await fs.mkdir(base, { recursive: true })
const runtime = path.join(base, 'runtime.mjs')
// Observe the real algorithm's work without replacing its behavior or using a
// timing threshold dependent on the test machine's load.
const marker = '#apply(state: WorkspaceState, operation: Operation): void {'
await build({ entryPoints: ['src/rp/store.ts'], outfile: runtime, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{ name: 'count-replays', setup(b) {
  b.onLoad({ filter: /[\\/]rp[\\/]store\.ts$/ }, async args => {
    const source = await fs.readFile(args.path, 'utf8'); assert.ok(source.includes(marker), 'replay instrumentation anchor')
    return { contents: source.replace(marker, marker + ' globalThis.__rpReplayCount = (globalThis.__rpReplayCount ?? 0) + 1;'), loader: 'ts' }
  })
} }] }); stop()
const api = await import(pathToFileURL(runtime).href + '?' + randomUUID())
const must = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value }
async function setup(options = {}) {
  const directory = path.join(base, randomUUID()), profileRoot = path.join(directory, 'profile'), project = path.join(directory, 'project'); await fs.mkdir(project, { recursive: true })
  const opened = await api.openRpStore({ profileRoot, ...options }), workspace = must(await opened.control.createWorkspace(project)), branch = must(await opened.control.createBranch(workspace.workspaceId, ids.campaign))
  const request = { workspaceId: workspace.workspaceId, campaignId: ids.campaign, branchId: branch.id, sessionId: ids.session, sceneId: ids.scene, viewpoint: { kind: 'narrator' }, visibility, audienceSetIds: [visibility.audienceSetId], permissions: ['read', 'observe', 'commit', 'control'] }
  const authority = must(await opened.control.authorize(request))
  return { ...opened, profileRoot, project, workspace, request, authority, workspacePath: path.join(profileRoot, '.dsh-rp/v1/workspaces', workspace.workspaceId) }
}

test('nested forks reuse validated prefixes with polynomial replay work', async () => {
  const f = await setup(); let a = f.authority
  for (let i = 0; i < 12; i++) {
    const manifest = must(await f.store.forkManifest(a, 0)), child = must(await f.control.forkBranch(a, { ...manifest, idempotencyKey: 'fork_' + i }))
    a = must(await f.control.authorize({ ...f.request, branchId: child.id }))
  }
  globalThis.__rpReplayCount = 0
  const fence = must(await f.store.readFence(a)), calls = globalThis.__rpReplayCount
  assert.equal(fence.contextRevision, 0)
  assert.ok(calls > 0, 'instrumentation actually measured replay')
  assert.ok(calls <= 2 * 13 * 13, '13 transactions must not require exponential prefix replay; actual=' + calls)
})

test('oversized derived transaction is rejected before any blob and leaves the workspace cold-readable', async () => {
  const f = await setup(), s = must(await f.store.observeSource(f.authority, observation('X')))
  must(await f.store.commit(f.authority, batch(must(await f.store.readFence(f.authority)), s)))
  const expected = must(await f.store.readFence(f.authority)), span = must(await f.store.sourceSpan(f.authority, s.id, 0, 1))
  let input
  for (let n = 100; n > 0; n--) {
    input = batch(expected, s, 'capacity', { sourceBindings: [], events: Array.from({ length: 256 }, (_, i) => ({ schemaVersion: 1, id: 'event_' + i, scope: f.authority.scope, acceptedSeq: 1, fictionalTime: null, payload: { kind: 'occurrence', actorIds: ['key'], description: 'x' }, epistemic: 'world', authority: 'accepted_narration', sources: Array.from({ length: n }, () => span), visibility, supersedes: [], policyVersion: 'rp.v1' })) })
    if (Buffer.byteLength(JSON.stringify(input)) < 4194304) break
  }
  const before = { commits: await fs.readdir(path.join(f.workspacePath, 'commits')), blobs: await fs.readdir(path.join(f.workspacePath, 'blobs')) }
  const result = await f.store.commit(f.authority, input)
  assert.equal(result.ok, false); assert.equal(result.code, 'capacity_exceeded')
  assert.deepEqual(await fs.readdir(path.join(f.workspacePath, 'commits')), before.commits)
  assert.deepEqual(await fs.readdir(path.join(f.workspacePath, 'blobs')), before.blobs)
  assert.deepEqual(must(await f.store.readFence(f.authority)), expected)
  const cold = await api.openRpStore({ profileRoot: f.profileRoot }), ca = must(await cold.control.authorize(f.request))
  assert.deepEqual(must(await cold.store.readFence(ca)), expected)
  // A smaller valid batch remains accepted and cold-readable after refusal.
  must(await f.store.commit(f.authority, { ...input, events: input.events.slice(0, 128) }))
  assert.equal(must(await cold.store.readFence(ca)).contextRevision, expected.contextRevision + 1)
})

test('draft payloads support corrections to an earlier event in the same batch', async () => {
  const f = await setup(), s = must(await f.store.observeSource(f.authority, observation('blue then gold')))
  must(await f.store.commit(f.authority, batch(must(await f.store.readFence(f.authority)), s)))
  const expected = must(await f.store.readFence(f.authority)), span = must(await f.store.sourceSpan(f.authority, s.id, 0, s.publicTextLengthUtf16))
  const event = { schemaVersion: 1, id: 'blue', scope: f.authority.scope, acceptedSeq: 1, fictionalTime: null, payload: { kind: 'state_change', subjectId: 'key', key: 'color', after: 'blue' }, epistemic: 'world', authority: 'accepted_narration', sources: [span], visibility, supersedes: [], policyVersion: 'rp.v1' }
  must(await f.store.commit(f.authority, batch(expected, s, 'same_batch', { sourceBindings: [], events: [event, { ...event, id: 'gold', payload: { ...event.payload, after: 'gold' }, supersedes: ['blue'] }] })))
  assert.deepEqual(must(await f.store.readEvents(f.authority)).map(e => e.id), ['gold'])
})

test('commit revalidates workspace authority after staged payload publication', async () => {
  let changeMarker
  const f = await setup({ fault: async stage => { if (stage === 'blob_published' && changeMarker) await changeMarker() } })
  const s = must(await f.store.observeSource(f.authority, observation('blue')))
  must(await f.store.commit(f.authority, batch(must(await f.store.readFence(f.authority)), s)))
  const expected = must(await f.store.readFence(f.authority)), span = must(await f.store.sourceSpan(f.authority, s.id, 0, s.publicTextLengthUtf16))
  const event = { schemaVersion: 1, id: 'event_blue', scope: f.authority.scope, acceptedSeq: 1, fictionalTime: null, payload: { kind: 'occurrence', actorIds: ['key'], description: 'blue' }, epistemic: 'world', authority: 'accepted_narration', sources: [span], visibility, supersedes: [], policyVersion: 'rp.v1' }
  const markerPath = path.join(f.project, '.dsh-rp-workspace.json'), originalMarker = await fs.readFile(markerPath, 'utf8')
  const before = await fs.readdir(path.join(f.workspacePath, 'commits')); let changed = false, result
  changeMarker = async () => {
    const marker = JSON.parse(originalMarker); marker.nonce = 'externally_changed_nonce'
    await fs.writeFile(markerPath, JSON.stringify(marker)); changed = true
  }
  try { result = await f.store.commit(f.authority, batch(expected, s, 'changed_authority', { sourceBindings: [], events: [event] })) }
  finally { changeMarker = undefined; await fs.writeFile(markerPath, originalMarker) }
  assert.equal(changed, true, 'authority changed during real blob publication')
  assert.equal(result.ok, false); assert.equal(result.code, 'scope_denied')
  assert.deepEqual(await fs.readdir(path.join(f.workspacePath, 'commits')), before)
  assert.deepEqual(must(await f.store.readFence(f.authority)), expected)
})

test('prefix reuse preserves fixed parent revisions and revalidates disk on later reads', async () => {
  const f = await setup(), s = must(await f.store.observeSource(f.authority, observation('first')))
  must(await f.store.commit(f.authority, batch(must(await f.store.readFence(f.authority)), s)))
  const first = must(await f.store.forkManifest(f.authority, 1))
  const second = observation('second', 'revision_b'); second.host.messageId = 'message_second'; second.host.eventSeq = 2; second.turnId = 'turn_second'
  const newer = must(await f.store.observeSource(f.authority, second))
  must(await f.store.commit(f.authority, batch(must(await f.store.readFence(f.authority)), newer, 'accept_second', { sourceBindings: [{ sourceRevisionId: newer.id, branchId: f.request.branchId, turnId: newer.turnId, disposition: 'accepted', acceptedSeq: 2 }] })))
  const child = must(await f.control.forkBranch(f.authority, { ...first, idempotencyKey: 'old_prefix' })), ca = must(await f.control.authorize({ ...f.request, branchId: child.id }))
  assert.deepEqual(must(await f.store.readAcceptedSources(ca)).map(x => x.id), [s.id])
  assert.equal(must(await f.store.readAcceptedSources(f.authority)).length, 2)
  const latest = (await fs.readdir(path.join(f.workspacePath, 'commits'))).filter(x => /^\d{16}\.json$/.test(x)).sort().at(-1)
  const file = path.join(f.workspacePath, 'commits', latest), raw = JSON.parse(await fs.readFile(file, 'utf8')); raw.sha256 = '0'.repeat(64); await fs.writeFile(file, JSON.stringify(raw))
  assert.equal((await f.store.readFence(ca)).code, 'store_corrupt')
})
