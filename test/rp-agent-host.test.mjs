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
  } finally { await f.dispose() }
})
