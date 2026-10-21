import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreAnswers } from '../scripts/benchmarks/luna-score.mjs'

test('Luna pilot citation must support the particular answer, including direction', () => {
  const scene = { questions: [{ id: 'q1', values: ['林岚'], support: '铜钥匙由林岚保管' }, { id: 'q2', values: [null], support: null }] }
  const records = [{ id: 'source_one', text: '铜钥匙由林岚保管。周砚仍怀疑林岚。' }]
  const result = scoreAnswers(scene, records, { answers: [{ id: 'q1', value: '林岚', citations: [{ recordId: 'source_one', quote: '周砚仍怀疑林岚' }] }, { id: 'q2', value: null, citations: [] }] })
  assert.equal(result.correct, 2); assert.equal(result.supported, 1); assert.equal(result.rows[0].supported, false)
})
test('Luna pilot supports exact original evidence and refuses invented record IDs', () => {
  const scene = { questions: [{ id: 'q1', values: ['林岚'], support: '铜钥匙由林岚保管' }] }, records = [{ id: 'source_one', text: '铜钥匙由林岚保管。' }]
  const answer = { answers: [{ id: 'q1', value: '林岚', citations: [{ recordId: 'source_one', quote: '铜钥匙由林岚保管' }] }] }
  assert.equal(scoreAnswers(scene, records, answer).supported, 1)
  answer.answers[0].citations[0].recordId = 'invented'
  assert.equal(scoreAnswers(scene, records, answer).supported, 0)
  assert.throws(() => scoreAnswers(scene, records, { answers: [answer.answers[0], answer.answers[0]] }), /duplicate|schema/u)
})
