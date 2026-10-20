#!/usr/bin/env node
/** Exact annotated fixture scoring, not a general language judge or model evaluation. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const fields = ['subject', 'predicate', 'object', 'epistemic', 'speaker', 'time']
const same = (a, b) => fields.every(k => (a[k] ?? null) === (b[k] ?? null))
const metric = (numerator, denominator) => ({ numerator, denominator, rate: denominator ? numerator / denominator : null })
export function evaluateCorpus(rows) {
  const results = []
  for (const row of rows) {
    if (!row.id || !Array.isArray(row.facts) || !Array.isArray(row.outputs)) throw Error('Malformed annotated fixture')
    for (const output of row.outputs) {
      const claims = output.claims, matched = new Set(); let supported = 0, attributed = 0, povErrors = 0, citations = 0, goodCitations = 0
      const dimensions = Object.fromEntries(['subject', 'speaker', 'object', 'predicate', 'epistemic', 'time'].map(k => [k, 0]))
      for (const claim of claims) {
        const target = row.facts.find(f => f.id === claim.factId)
        const exact = row.facts.find(f => same(f, claim))
        if (target) for (const k of Object.keys(dimensions)) if ((target[k] ?? null) === (claim[k] ?? null)) dimensions[k]++
        if (target && ['subject', 'speaker', 'object', 'predicate'].every(k => (target[k] ?? null) === (claim[k] ?? null))) attributed++
        const evidence = claim.citations ?? []
        let claimSupported = false
        for (const cite of evidence) {
          citations++
          const source = row.sources.find(s => s.id === cite.sourceId)
          if (exact && exact.sourceIds.includes(cite.sourceId) && source && cite.quote && source.text.includes(cite.quote)) { goodCitations++; claimSupported = true }
        }
        if (claimSupported) { supported++; matched.add(exact.id) }
        if (exact && !exact.viewpoints.includes(output.viewpoint)) povErrors++
      }
      const critical = row.facts.filter(f => f.critical), ordinary = row.facts.filter(f => !f.critical)
      const criticalRecall = metric(critical.filter(f => matched.has(f.id)).length, critical.length)
      const otherRecall = metric(ordinary.filter(f => matched.has(f.id)).length, ordinary.length)
      const unsupported = metric(claims.length - supported, claims.length), sourceSupport = metric(goodCitations, citations)
      results.push({ sampleId: row.id, tags: row.tags, variant: output.variant, viewpoint: output.viewpoint,
        criticalRecall, otherRecall, unsupported, attribution: metric(attributed, claims.length),
        dimensions: Object.fromEntries(Object.entries(dimensions).map(([k, v]) => [k, metric(v, claims.length)])),
        povErrors, sourceSupport, gatePassed: criticalRecall.numerator === criticalRecall.denominator &&
          (otherRecall.rate === null || otherRecall.rate >= .95) && (unsupported.rate === null || unsupported.rate <= .01) && povErrors === 0 })
    }
  }
  return { schemaVersion: 1, policyVersion: 'rp-exact-annotation-fixture/v1', corpusVersion: 'zh-rp-fixed/v1',
    toy: { status: 'separate-mechanism-evidence', path: 'acceptance-matrix.json' },
    offline: { status: 'fixed-annotated-fixtures', annotationAuthor: 'implementation agent; human-reviewable; no user adjudication claimed', modelGenerated: false,
      samples: rows.length, outputs: results.length, results, realModelCalls: 0, networkCalls: 0,
      boundary: 'Exact tuple and source annotations test the scorer. This is not general natural-language fidelity, tokenizer compression ratio or model quality.' },
    live: { status: 'not-run', samples: 0, model: null, metrics: null } }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const value = flag => process.argv[process.argv.indexOf(flag) + 1]
  if (value('--mode') !== 'fixture' || !process.argv.includes('--corpus') || !process.argv.includes('--output')) throw Error('Only --mode fixture --corpus <jsonl> --output <json> is implemented. Model generation requires separate authorization.')
  const rows = (await fs.readFile(value('--corpus'), 'utf8')).trim().split(/\r?\n/u).map(JSON.parse)
  await fs.writeFile(value('--output'), JSON.stringify(evaluateCorpus(rows), null, 2) + '\n')
}
