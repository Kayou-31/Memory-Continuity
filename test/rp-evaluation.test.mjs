import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

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
