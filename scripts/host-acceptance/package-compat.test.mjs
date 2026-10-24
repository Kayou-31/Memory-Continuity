// Run against an extracted release TGZ, never a source substitute.
// RP_PERSON_BUNDLE=<absolute lib/index.js> node --test --test-concurrency=1 scripts/host-acceptance/package-compat.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { host as nativeHost } from '../../test/fixtures/rp/native-host.mjs'

assert.ok(process.env.RP_PERSON_BUNDLE, 'the extracted release bundle is required')
const bundle = await import(pathToFileURL(path.resolve(process.env.RP_PERSON_BUNDLE)).href)
assert.equal(typeof bundle.installRpPlugin, 'function', 'the TGZ must export its native installer; source fallback is forbidden')
const host = () => nativeHost({}, { install: bundle.installRpPlugin })
const ok = result => { assert.equal(result.kind, 'success', result.text); return result }
function failJournal() {
  const rename = fs.rename
  fs.rename = async (from, to) => {
    if (to.includes(path.join('v1', 'host'))) throw Object.assign(new Error('packaged journal EIO'), { code: 'EIO' })
    return rename(from, to)
  }
  return () => { fs.rename = rename }
}
function observe(agent) {
  agent.session.append('user/message', { id: 'packaged_observation', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'PRIVATE_PACKAGED_OBSERVATION' }] }, { surfaceOp: 'append' })
}

test('actual TGZ blocks every native session after an observation persistence failure and failed close', { timeout: 15000 }, async () => {
  const f = await host(); let restore
  try {
    const a = await f.create(), b = await f.create()
    ok(await f.command(a, 'start')); ok(await f.command(b, 'start'))
    restore = failJournal(); observe(a); await assert.rejects(f.rp.ready(a.id)); restore()
    await assert.rejects(f.rp.close())
    for (const agent of [a, b]) { assert.equal(f.rp.policy.status(agent.id).mode, 'blocked'); await assert.rejects(f.stream(agent)) }
    assert.equal(f.calls(), 0)
  } finally { restore?.(); await f.dispose() }
})

test('actual TGZ permits diagnosis and clean continuation after journal failure without carrying old messages', { timeout: 15000 }, async () => {
  const f = await host(); let restore
  try {
    const a = await f.create(); ok(await f.command(a, 'start'))
    const branchId = f.rp.status(a.id).branchId
    restore = failJournal(); observe(a); await assert.rejects(f.rp.ready(a.id)); restore()
    assert.doesNotMatch(ok(await f.command(a, 'status')).text, /PRIVATE_PACKAGED_OBSERVATION/)
    assert.equal((await f.command(a, 'input forbidden')).kind, 'error')
    const nextId = /created: (\w+)/.exec(ok(await f.command(a, 'continue-clean')).text)[1]
    const next = f.ctx.agents.get(nextId)
    assert.equal(f.rp.status(nextId).branchId, branchId); assert.equal(next.session.deriveMessages().length, 0)
    await assert.rejects(f.stream(a)); assert.equal(f.calls(), 0)
    ok(await f.command(next, 'input continue safely')); await next.whenIdle(); await f.rp.ready(nextId)
    assert.equal(f.calls(), 1)
  } finally { restore?.(); await f.dispose() }
})
