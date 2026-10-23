/** Offline write with extracted 85d15e3 source, then cold-read with the current source. */
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { build, stop } from 'esbuild'
const baseline = process.argv[2]
assert.ok(baseline, 'Pass the extracted baseline source directory')
const root = path.resolve('work/agent-memory-2026-10-22/legacy-probe', randomUUID())
await fs.mkdir(path.join(root, 'project'), { recursive: true })
const modules = []
for (const [name, source] of [['old', path.join(baseline, 'src/rp/memory.ts')], ['current', 'src/rp/memory.ts']]) {
  const outfile = path.join(root, name+'.mjs')
  await build({ entryPoints: [source], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
  modules.push(await import(pathToFileURL(outfile).href))
}
stop()
const must = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value }
const settings = { profileRoot: path.join(root, 'profile'), entityIds: ['erin', 'bea'] }
const old = await modules[0].openRpMemory(settings)
const workspace = must(await old.control.createWorkspace(path.join(root, 'project')))
const branch = must(await old.control.createBranch(workspace.workspaceId, 'campaign'))
const request = { workspaceId: workspace.workspaceId, campaignId: 'campaign', branchId: branch.id, sessionId: 'legacy_session', sceneId: 'scene', viewpoint: { kind: 'narrator' }, visibility: { policyId: 'story', revision: 0, audienceSetId: 'public' }, audienceSetIds: ['public'], permissions: ['read', 'observe', 'commit', 'control'] }
const authority = must(await old.control.authorize(request))
const values = [{ protocol: 'agent-memory/v0', value: 'ordinary' }, { protocol: 'agent-memory/v1', channel: 'state', value: 'ordinary', previousEventId: null, causeEventIds: ['not_a_dependency'], note: 'old JSON data' }]
const control = must(await old.store.observeSource(authority, { idempotencyKey: 'old', origin: 'user_control', role: 'user_control', turnId: 'old', publicText: 'Original ordinary JSON' }))
must(await old.canonical.applyControl(authority, control, { kind: 'accept', idempotencyKey: 'old', expected: must(await old.store.readFence(authority)), sourceRevisionIds: [control.id], events: values.map((value, i) => ({ id: 'legacy_'+i, epistemic: 'world', payload: { kind: 'state_change', subjectId: 'erin', key: i ? 'identity' : 'background', after: value } })) }))
const before = must(await old.store.replayProjection(authority)), fence = must(await old.store.readFence(authority))
old.retrieval.dispose(); await old.jobs.close()
const current = await modules[1].openRpMemory(settings)
try {
  must(await current.control.openWorkspace(path.join(root, 'project')))
  const a = must(await current.control.authorize(request))
  assert.deepEqual(must(await current.store.replayProjection(a)), before)
  assert.deepEqual(must(await current.store.readFence(a)), fence)
  const injected = await current.store.commit(a, { schemaVersion: 1, idempotencyKey: 'retroactive_marker', expected: fence, nextContextRevision: fence.contextRevision + 1, sourceBindings: [], events: [], summaries: [], jobs: [], invalidatedIds: [], authorityChanges: [{ kind: 'candidate_adoption', recordId: 'growth_legacy_1', record: { candidateId: 'agent_memory_v1', decision: 'accepted', controlSourceId: control.id, sourceRevisionIds: [control.id], eventIds: ['legacy_1'], summaryIds: [] } }] })
  assert.equal(injected.ok, false); assert.equal(injected.code, 'invalid_record')
  assert.deepEqual(must(await current.store.readFence(a)), fence)
  assert.deepEqual(must(await current.store.replayProjection(a)), before)
  const growthControl = must(await current.store.observeSource(a, { idempotencyKey: 'new', origin: 'user_control', role: 'user_control', turnId: 'new', publicText: 'New explicit growth' }))
  const cause = must(await current.agentMemory.apply(a, growthControl, { kind: 'experience', idempotencyKey: 'new_experience', expected: must(await current.store.readFence(a)), actorIds: ['erin'], description: 'New supported experience', sourceRevisionIds: [] }))
  must(await current.agentMemory.apply(a, growthControl, { kind: 'relationship', idempotencyKey: 'new_relationship', expected: must(await current.store.readFence(a)), fromId: 'erin', toId: 'bea', relation: 'trust', value: 'trusted', previousEventId: null, causeEventIds: [cause.eventId], note: 'Explicit relationship' }))
  const relation = must(await current.store.replayProjection(a)).relationships[0]
  const nextControl = must(await current.store.observeSource(a, { idempotencyKey: 'next', origin: 'user_control', role: 'user_control', turnId: 'next', publicText: 'Next explicit growth' }))
  must(await current.agentMemory.apply(a, nextControl, { kind: 'relationship', idempotencyKey: 'next_relationship', expected: must(await current.store.readFence(a)), fromId: 'erin', toId: 'bea', relation: 'trust', value: 'close', previousEventId: relation.supportEventIds[0], causeEventIds: [cause.eventId], note: 'Later relationship' }))
  const downgrade = await modules[0].openRpMemory(settings)
  try {
    must(await downgrade.control.openWorkspace(path.join(root, 'project')))
    const oldAuthority = must(await downgrade.control.authorize(request))
    const oldRead = await downgrade.store.readEvents(oldAuthority)
    assert.equal(oldRead.ok, false); assert.equal(oldRead.code, 'source_unavailable')
  } finally { downgrade.retrieval.dispose(); await downgrade.jobs.close() }
  console.log(JSON.stringify({ baseline: '85d15e3d3d3b2c4a73a197178b937855d7d05030', oldWriter: true, newColdReader: true, ordinaryPayloads: values.length, projectionUnchanged: true, fenceUnchanged: true, retroactiveMarkerRejected: true, oldReaderRejectsNewGrowthDependencies: true, root }, null, 2))
} finally { current.retrieval.dispose(); await current.jobs.close() }
