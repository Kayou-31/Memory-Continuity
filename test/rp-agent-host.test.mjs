import test from 'node:test'
import assert from 'node:assert/strict'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { host } from './fixtures/rp/native-host.mjs'

test('native explicit Agent controls feed goals and sourced experiences into the actual request', async () => {
  const f = await host({ entityIds: ['erin', 'bea'] }); const requests = []
  class Capture extends LlmAdapter {
    async *stream(request) { requests.push(request); yield { type: 'text-delta', index: 0, text: 'I remember the promise.' }; yield { type: 'finish', reason: { kind: 'stop' } } }
  }
  try {
    const a = await f.create(); a.options.provider = 'growth-capture'; f.ctx.llm.registerAdapter(['growth-capture'], new Capture())
    await f.command(a, 'start')
    const experience = await f.command(a, 'agent '+JSON.stringify({ kind: 'experience', actorIds: ['erin', 'bea'], description: '艾琳答应归还钥匙', sourceRevisionIds: [], fictionalTime: 'childhood' }))
    assert.equal(experience.kind, 'success', experience.text)
    const eventId = JSON.parse(experience.text).eventId
    const goal = await f.command(a, 'agent '+JSON.stringify({ kind: 'goal', ownerId: 'erin', goalId: 'return_key', category: 'promise', targetEntityId: 'bea', objective: '归还贝雅的钥匙', status: 'active', progress: 0, nextAction: '去钟楼找贝雅', previousEventId: null, causeEventIds: [eventId], note: '承诺' }))
    assert.equal(goal.kind, 'success', goal.text)
    assert.match((await f.command(a, 'goals')).text, /return_key/)
    assert.equal((await f.command(a, 'input 钥匙的承诺')).kind, 'success'); await a.whenIdle(); await f.rp.ready(a.id)
    assert.equal(requests.length, 1)
    assert.match(JSON.stringify(requests[0]), /归还贝雅的钥匙/)
    assert.match(JSON.stringify(requests[0]), /艾琳答应归还钥匙/)
    const toolNames = requests[0].tools.map(t => t.name)
    assert.deepEqual(toolNames.sort(), ['rp_memory_get', 'rp_memory_search', 'rp_memory_status'])
    const progress = await f.command(a, 'agent '+JSON.stringify({ kind: 'experience', actorIds: ['erin', 'bea'], description: '艾琳已到达钟楼门口', sourceRevisionIds: [] }))
    assert.equal(progress.kind, 'success', progress.text)
    const advanced = await f.command(a, 'agent '+JSON.stringify({ kind: 'goal', ownerId: 'erin', goalId: 'return_key', category: 'promise', targetEntityId: 'bea', objective: '归还贝雅的钥匙', status: 'active', progress: 50, nextAction: '当面交还钥匙', previousEventId: JSON.parse(goal.text).eventId, causeEventIds: [JSON.parse(progress.text).eventId], note: '已到达' }))
    assert.equal(advanced.kind, 'success', advanced.text)
    const branchId = f.rp.status(a.id).branchId, clean = await f.command(a, 'continue-clean')
    assert.equal(clean.kind, 'success', clean.text)
    const next = f.ctx.agents.get(/created: (\w+)/u.exec(clean.text)[1])
    assert.equal(next.session.deriveMessages().length, 0)
    assert.equal(f.rp.status(next.id).branchId, branchId)
    assert.match((await f.command(next, 'goals')).text, /"progress":50/)
    assert.equal((await f.command(a, 'input old owner')).kind, 'error')
    assert.equal((await f.command(next, 'input 现在该做什么')).kind, 'success'); await next.whenIdle(); await f.rp.ready(next.id)
    assert.equal(requests.length, 2)
    assert.match(JSON.stringify(requests[1]), /当面交还钥匙/)
    assert.ok(!JSON.stringify(requests[1]).includes('去钟楼找贝雅'), 'clean continuation must use current goal state')
  } finally { await f.dispose() }
})
