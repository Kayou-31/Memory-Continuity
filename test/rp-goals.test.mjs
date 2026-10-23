import test from 'node:test'
import assert from 'node:assert/strict'
import { setup, must, deny } from './fixtures/rp/growth.mjs'

const budget = { recentCompleteTurns: 8, targetTotalTokens: 48000, triggerTotalTokens: 72000, outputReserveTokens: 8192, toolReserveTokens: 2048, packetSoftTokens: 8000, contextWindow: 100000, inputLimit: 90000 }
test('independent goals and promises progress explicitly, survive restart, and enter the packet', async () => {
  const f = await setup()
  try {
    const cause = await f.experience('departure', '艾琳承诺归还贝雅的钥匙，然后启程学医')
    const goal = { kind: 'goal', ownerId: 'erin', goalId: 'learn_medicine', category: 'task', objective: '学习医术', status: 'active', progress: 0, nextAction: '寻找老师', previousEventId: null, causeEventIds: [cause], note: '启程的决定' }
    const first = must(await f.apply('goal_first', goal))
    must(await f.apply('promise_first', { ...goal, goalId: 'return_key', category: 'promise', targetEntityId: 'bea', objective: '归还钥匙', nextAction: '返回钟楼' }))
    const step = await f.experience('lesson', '艾琳完成医术课程')
    const changed = must(await f.apply('goal_progress', { ...goal, progress: 50, nextAction: '参加实践', previousEventId: first.eventId, causeEventIds: [step], note: '课程完成' }))
    const states = must(await f.store.replayProjection(f.authority)).state
    assert.equal(states.length, 2)
    assert.equal(states.find(s => s.key === 'task:learn_medicine').value.progress, 50)
    const packet = must(await f.packets.prepare(f.authority, { budget, globalAuthorities: [], inputBindings: [] }))
    assert.match(packet.text, /学习医术/); assert.match(packet.text, /归还钥匙/)
    const completed = must(await f.apply('goal_done', { ...goal, status: 'completed', progress: 100, nextAction: '', previousEventId: changed.eventId, causeEventIds: [step], note: '显式确认达成' }))
    deny(await f.apply('restart_terminal', { ...goal, previousEventId: completed.eventId, causeEventIds: [step] }), 'invalid_record')
    const cold = await setup(f.directory, f.request)
    try { assert.equal(must(await cold.store.replayProjection(cold.authority)).state.find(s => s.key === 'task:learn_medicine').value.status, 'completed') } finally { await cold.close() }
  } finally { await f.close() }
})

test('goal controls reject invented completion and stale progress, with no autonomous changes', async () => {
  const f = await setup()
  try {
    const cause = await f.experience('start', 'First agreement'), goal = { kind: 'goal', ownerId: 'erin', goalId: 'repair', category: 'task', objective: 'Repair the tower', status: 'active', progress: 0, nextAction: 'Inspect', previousEventId: null, causeEventIds: [cause], note: 'Agreed' }
    deny(await f.apply('already_done', { ...goal, status: 'completed', progress: 100 }), 'invalid_record')
    const first = must(await f.apply('new', goal))
    deny(await f.apply('fake_done', { ...goal, previousEventId: first.eventId, status: 'completed', progress: 50 }), 'invalid_record')
    const paused = must(await f.apply('pause', { ...goal, previousEventId: first.eventId, status: 'paused' }))
    deny(await f.apply('paused_progress', { ...goal, previousEventId: paused.eventId, status: 'paused', progress: 20 }), 'invalid_record')
    const projection = must(await f.store.replayProjection(f.authority)), fence = await f.fence()
    await f.store.readEvents(f.authority); await f.retrieval.search(f.authority, { query: 'Repair' })
    assert.deepEqual(await f.fence(), fence)
    assert.deepEqual(must(await f.store.replayProjection(f.authority)), projection)
  } finally { await f.close() }
})
