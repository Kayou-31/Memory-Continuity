import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

test('R36 a gray-coat quote cannot support blue eyes in the same source', async () => {
  const { evaluateCorpus } = await import('../scripts/benchmarks/rp-memory.mjs'), rows = (await fs.readFile('benchmarks/rp/golden.jsonl', 'utf8')).trim().split('\n').map(JSON.parse), row = structuredClone(rows[0])
  row.facts[0].allowedCitations = [{ sourceId: 'source_fact', quote: '艾琳的眼睛是蓝色。' }]
  for (const quote of ['艾琳穿着灰色外套。', '', '不存在的句子', '艾琳的眼睛是蓝色。']) {
    const output = structuredClone(row.outputs.find(o => o.variant === 'correct')); output.claims = [output.claims[0]]; output.claims[0].citations = [{ sourceId: 'source_fact', quote }]; row.outputs = [output]
    assert.equal(evaluateCorpus([row]).offline.results[0].sourceSupport.numerator, quote === '艾琳的眼睛是蓝色。' ? 1 : 0)
  }
})

test('P6 annotated Chinese fixtures score support, attribution, POV and critical loss independently', async () => {
  assert.equal(await fs.stat('scripts/benchmarks/rp-memory.mjs').then(() => true, () => false), true, 'fixture evaluator is required')
  const { evaluateCorpus } = await import('../scripts/benchmarks/rp-memory.mjs')
  const rows = (await fs.readFile('benchmarks/rp/golden.jsonl', 'utf8')).trim().split('\n').map(JSON.parse)
  const report = evaluateCorpus(rows)
  assert.equal(report.offline.samples, rows.length); assert.ok(rows.length >= 10)
  for (const tag of ['fact', 'lie', 'misunderstanding', 'prop', 'promise', 'relationship', 'secret', 'flashback', 'retcon', 'fork']) assert.ok(rows.some(r => r.tags.includes(tag)), tag)
  assert.equal(report.live.status, 'not-run'); assert.equal(report.live.metrics, null)
  assert.equal(report.offline.modelGenerated, false)
  const correct = report.offline.results.filter(r => r.variant === 'correct')
  assert.ok(correct.every(r => r.gatePassed))
  const wrong = report.offline.results.find(r => r.variant === 'false-sourced')
  assert.equal(wrong.gatePassed, false); assert.ok(wrong.unsupported.numerator > 0)
  assert.ok(wrong.sourceSupport.numerator < wrong.sourceSupport.denominator)
  assert.ok(report.offline.results.filter(r => r.variant === 'critical-loss').every(r => !r.gatePassed))
  assert.equal(evaluateCorpus([rows[0]]).offline.results.length, rows[0].outputs.length)
})
