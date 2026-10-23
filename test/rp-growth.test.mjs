import test from 'node:test'
import assert from 'node:assert/strict'
import { setup, must, deny } from './fixtures/rp/growth.mjs'

test('sourced relationship and identity grow without erasing their previous experiences', async () => {
  const f = await setup()
  try {
    assert.equal(typeof f.agentMemory?.apply, 'function')
    const met = await f.experience('first_meeting', '艾琳与贝雅初次相遇'), saved = await f.experience('rescue', '艾琳在钟楼救下贝雅')
    const relation = { kind: 'relationship', fromId: 'bea', toId: 'erin', relation: 'trust', value: 'cautious', previousEventId: null, causeEventIds: [met], note: '第一次相遇' }
    const first = must(await f.apply('trust_first', relation))
    must(await f.apply('trust_grows', { ...relation, value: 'trusted', previousEventId: first.eventId, causeEventIds: [saved], note: '救援后建立信任' }))
    const projection = must(await f.store.replayProjection(f.authority))
    assert.equal(projection.relationships[0].value, 'trusted')
    assert.equal(projection.relationships[0].resolution, 'known')
    assert.equal(must(await f.store.readEvents(f.authority)).length, 4)
    const identity = { kind: 'state', entityId: 'erin', key: 'identity', value: 'traveler', previousEventId: null, causeEventIds: [met], note: '初次自我介绍' }
    const born = must(await f.apply('identity_first', identity))
    must(await f.apply('identity_grows', { ...identity, value: 'rescuer', previousEventId: born.eventId, causeEventIds: [saved], note: '共同经历带来的身份变化' }))
    assert.equal(must(await f.store.replayProjection(f.authority)).state.find(s => s.key === 'identity').value, 'rescuer')
    const cold = await setup(f.directory, f.request)
    try { assert.equal(must(await cold.store.replayProjection(cold.authority)).relationships[0].value, 'trusted') } finally { await cold.close() }
  } finally { await f.close() }
})

test('growth rejects stale predecessors, missing causes and non-current branch evidence', async () => {
  const f = await setup()
  try {
    const met = await f.experience('met', 'Meeting'), input = { kind: 'state', entityId: 'erin', key: 'identity', value: 'novice', previousEventId: null, causeEventIds: [met], note: 'start' }
    const first = must(await f.apply('initial', input))
    deny(await f.apply('stale', { ...input, value: 'expert' }), 'stale_input')
    deny(await f.apply('missing_cause', { ...input, previousEventId: first.eventId, causeEventIds: ['event_missing'] }))
    const branch = must(await f.control.createBranch(f.request.workspaceId, 'campaign'))
    const other = must(await f.control.authorize({ ...f.request, branchId: branch.id }))
    deny(await f.agentMemory.apply(other, await f.controlSource('cross'), { ...input, idempotencyKey: 'cross', expected: must(await f.store.readFence(other)) }))
    const ctl = await f.controlSource('retry'), fixed = { ...input, previousEventId: first.eventId, value: 'learner', idempotencyKey: 'retry', expected: await f.fence() }
    const once = must(await f.agentMemory.apply(f.authority, ctl, fixed))
    assert.deepEqual(must(await f.agentMemory.apply(f.authority, ctl, fixed)), once)
    deny(await f.agentMemory.apply(f.authority, ctl, { ...fixed, value: 'changed' }), 'idempotency_conflict')
  } finally { await f.close() }
})

test('retcon removes dependent growth but keeps initial history and a fork fixed at its prefix', async () => {
  const f = await setup()
  try {
    const met = await f.experience('met', 'Meeting'), first = must(await f.apply('initial', { kind: 'relationship', fromId: 'bea', toId: 'erin', relation: 'trust', value: 'cautious', previousEventId: null, causeEventIds: [met], note: 'start' }))
    const saved = await f.experience('rescue', 'Rescue')
    const grown = must(await f.apply('changed', { kind: 'relationship', fromId: 'bea', toId: 'erin', relation: 'trust', value: 'trusted', previousEventId: first.eventId, causeEventIds: [saved], note: 'earned' }))
    const manifest = must(await f.canonical.forkManifest(f.authority, (await f.fence()).contextRevision))
    const fork = must(await f.canonical.forkBranch(f.authority, { ...manifest, idempotencyKey: 'fork' })), other = must(await f.control.authorize({ ...f.request, branchId: fork.id }))
    must(await f.canonical.applyControl(f.authority, await f.controlSource('retcon'), { kind: 'retcon', idempotencyKey: 'retcon', expected: await f.fence(), targetEventIds: [saved], events: [] }))
    assert.equal(must(await f.store.replayProjection(f.authority)).relationships[0].value, 'cautious')
    assert.equal(must(await f.store.replayProjection(other)).relationships[0].value, 'trusted')
    assert.ok(!must(await f.store.readEvents(f.authority)).some(e => e.id === grown.eventId))
  } finally { await f.close() }
})

test('privacy deletion removes the causal growth closure; explicit null stays unknown', async () => {
  const f = await setup()
  try {
    const cause = await f.experience('cause', 'Private rescue')
    const first = must(await f.apply('identity', { kind: 'state', entityId: 'erin', key: 'identity', value: null, previousEventId: null, causeEventIds: [cause], note: 'identity not decided' }))
    assert.equal(must(await f.store.replayProjection(f.authority)).state[0].value, null)
    const sourceId = must(await f.store.readEvents(f.authority)).find(e => e.id === cause).sources[0].sourceRevisionId
    must(await f.canonical.applyControl(f.authority, await f.controlSource('erase'), { kind: 'privacy_delete', idempotencyKey: 'erase', expected: await f.fence(), sourceRevisionIds: [sourceId], affectedBranchIds: [f.request.branchId] }))
    assert.equal(must(await f.store.readEvents(f.authority)).some(e => e.id === first.eventId), false)
    assert.equal(must(await f.store.replayProjection(f.authority)).state.length, 0)
  } finally { await f.close() }
})

test('growth stores only direct provenance and ancestor-only deletion still erases descendants', async () => {
  const f = await setup()
  try {
    const ancestor = await f.experience('ancestor', 'Old private meeting'), newer = await f.experience('newer', 'New public experience')
    let previousEventId = null
    const ids = []
    for (let i = 0; i < Number(process.env.RP_GROWTH_STAGES ?? 4); i++) {
      const result = must(await f.apply('stage_'+i, { kind: 'state', entityId: 'erin', key: 'identity', value: 'stage_'+i, previousEventId, causeEventIds: [i ? newer : ancestor], note: 'Explicit evolution' }))
      previousEventId = result.eventId; ids.push(result.eventId)
      if (process.env.RP_GROWTH_STAGES && (i + 1) % 50 === 0) console.log('PERSISTED_GROWTH_STAGES '+(i + 1))
      assert.equal(must(await f.store.readEvents(f.authority)).find(e => e.id === result.eventId).sources.length, 2, 'provenance must not grow with chain length')
    }
    const sourceId = must(await f.store.readEvents(f.authority)).find(e => e.id === ancestor).sources[0].sourceRevisionId
    must(await f.canonical.applyControl(f.authority, await f.controlSource('erase_ancestor'), { kind: 'privacy_delete', idempotencyKey: 'erase_ancestor', expected: await f.fence(), sourceRevisionIds: [sourceId], affectedBranchIds: [f.request.branchId] }))
    assert.equal(must(await f.store.readEvents(f.authority)).some(e => ids.includes(e.id)), false)
    assert.equal(must(await f.store.readEvents(f.authority)).some(e => e.id === newer), true)
  } finally { await f.close() }
})

for (const value of [{ protocol: 'agent-memory/v0', value: 'ordinary old metadata' }, { protocol: 'agent-memory/v1', channel: 'state', value: 'ordinary old metadata', previousEventId: null, causeEventIds: ['legacy_id'], note: 'data' }]) test('ordinary v1 JSON stays ordinary without an explicit growth ledger marker: '+value.protocol, async () => {
  const f = await setup()
  try {
    const ctl = await f.controlSource('legacy')
    must(await f.canonical.applyControl(f.authority, ctl, { kind: 'accept', idempotencyKey: 'legacy', expected: await f.fence(), sourceRevisionIds: [ctl.id], events: [{ id: 'legacy_metadata', epistemic: 'world', payload: { kind: 'state_change', subjectId: 'erin', key: 'background', after: value } }] }))
    const cold = await setup(f.directory, f.request)
    try { assert.deepEqual(must(await cold.store.replayProjection(cold.authority)).state[0].value, value); assert.equal(must(await cold.store.readEvents(cold.authority)).length, 1) } finally { await cold.close() }
  } finally { await f.close() }
})
