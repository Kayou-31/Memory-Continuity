import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { host } from '../../test/fixtures/rp/native-host.mjs'
const [directory, sessionId, branchId, mode] = process.argv.slice(2)
const bundles = path.resolve(process.env.RP_BUNDLES_ROOT ?? 'work/host-followup')
const { installRpPlugin } = await import(pathToFileURL(path.join(bundles, 'rp/package/lib/index.js')).href)
const memory = await import(pathToFileURL(path.join(bundles, 'memory/package/lib/index.js')).href)
const f = await host({ enabled: mode === 'enabled' }, { directory, install: installRpPlugin, before: async ({ ctx }) => { await ctx.plugin(memory, {}).await() } })
try {
  const a = await f.resume({ id: sessionId, options: { provider: 'rp-dev3', model: 'offline', maxTokens: 128 } })
  assert.equal(await f.ctx.get('ultraEvidenceSupport').memory.begin(a, 'COLD_ENGINEERING_DENIED'), undefined)
  assert.equal(f.calls(), 0)
  if (mode === 'disabled') await assert.rejects(f.stream(a))
  else {
    // Closed/ambiguous history is deliberately business-blocked. Diagnostics and
    // clean continuation must not go through the healthy-business ready gate.
    const status = await f.command(a, 'status'); assert.equal(status.kind, 'success')
    assert.equal(f.rp.status(a.id).ambiguousInputIds.length, 1)
    const clean = await f.command(a, 'continue-clean'); assert.equal(clean.kind, 'success', clean.text)
    const next = f.ctx.agents.get(/created: (\w+)/u.exec(clean.text)[1])
    assert.equal(next.session.deriveMessages().length, 0); assert.equal(f.rp.status(next.id).branchId, branchId)
    await assert.rejects(f.stream(a)); assert.equal(f.calls(), 0)
  }
  console.log(JSON.stringify({ mode, node: process.version, calls: f.calls(), cold: true, passed: true }))
} finally { await f.dispose() }
