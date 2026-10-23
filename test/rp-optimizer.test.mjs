import test from 'node:test'
import assert from 'node:assert/strict'
import { setup, api, must, deny } from './fixtures/rp/growth.mjs'
const budget = { recentCompleteTurns: 8, targetTotalTokens: 48000, triggerTotalTokens: 72000, outputReserveTokens: 8192, toolReserveTokens: 2048, packetSoftTokens: 8000, contextWindow: 100000, inputLimit: 90000 }
test('optional optimizer uses bounded diverse authorized records while standalone remains usable', async () => {
  const f = await setup()
  try {
    await f.experience('a', '钟楼 救援 贝雅'); await f.experience('b', '钟楼 救援 贝雅'); await f.experience('c', '钟楼 医术 学习')
    assert.equal(typeof api.createUltraRpOptimizer, 'function')
    const optimizer = api.createUltraRpOptimizer(), raw = { query: '钟楼', maxRecords: 2, candidates: [
      { id: 'a', text: '钟楼 救援 贝雅', kind: 'experience', sequence: 3 },
      { id: 'b', text: '钟楼 救援 贝雅', kind: 'experience', sequence: 2 },
      { id: 'c', text: '钟楼 医术 学习', kind: 'experience', sequence: 1 },
    ] }
    assert.deepEqual(optimizer.rank(raw), ['a', 'c'])
    const packets = api.createPacketService(f.store, f.global, { optimizer: () => optimizer })
    const input = { budget, globalAuthorities: [], inputBindings: [] }
    assert.equal(must(await f.packets.prepare(f.authority, input)).optimizer, 'standalone')
    const packet = must(await packets.prepare(f.authority, input))
    assert.equal(packet.optimizer, 'ultra-rp/v1')
    assert.equal(must(await packets.prepare(f.authority, { ...input, optionalTokens: 0 })).droppedOptionalIds.length, 3)
    assert.equal(JSON.parse(must(await packets.prepare(f.authority, { ...input, optionalTokens: 0 })).text).experiences.length, 0)
  } finally { await f.close() }
})
test('optimizer cannot inject foreign IDs or override hard request capacity', async () => {
  const f = await setup()
  try {
    await f.experience('a', 'Only authorized history')
    const packets = api.createPacketService(f.store, f.global, { optimizer: () => ({ protocol: 'ultra-rp/v1', rank: () => ['foreign_record'] }) })
    deny(await packets.prepare(f.authority, { budget, globalAuthorities: [], inputBindings: [] }), 'scope_denied')
    const standalone = must(await f.packets.prepare(f.authority, { budget, globalAuthorities: [], inputBindings: [] }))
    deny(await f.packets.admit(f.authority, standalone, { text: 'X'.repeat(100001) }), 'context_budget_exceeded')
  } finally { await f.close() }
})
