/** Final tarballs in real pinned SDK. Run after extracting bundles under work/host-followup. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { host } from '../../test/fixtures/rp/native-host.mjs'

const base = path.resolve('work/host-followup')
const packageVersions = {}
for (const [name, expected] of [['cordis', '4.0.5'], ['schemastery', '3.18.5'], ...['dsh-agent', 'dsh-agent-loop', 'dsh-llm', 'dsh-session', 'dsh-system-prompt', 'dsh-tools', 'dsh-commands', 'dsh-session-projection', 'dsh-session-persistence-jsonl'].map(name => [name, '0.2.1-rc.2'])]) {
  const pkg = JSON.parse(await fs.readFile(path.join(path.resolve(process.env.RP_NATIVE_SDK ?? 'node_modules'), '@deepseek-ai', name, 'package.json'), 'utf8'))
  assert.equal(pkg.version, expected); packageVersions[name] = pkg.version
}
const manifests = JSON.parse(await fs.readFile(path.join(base, 'bundles.json'), 'utf8'))
const rpModule = await import(pathToFileURL(path.join(base, 'rp/package/lib/index.js')).href)
const modules = {}
for (const id of ['ultra', 'memory', 'decision']) modules[id] = await import(pathToFileURL(path.join(base, id, 'package/lib/index.js')).href)
const observations = []
test.after(async () => fs.writeFile(path.join(base, 'report.json'), JSON.stringify({ node: process.version, sdk: { packageVersions }, manifests, observations, scope: 'native SDK with local synthetic terminal; no real provider, desktop UI, or power-loss proof' }, null, 2)))

for (const companions of [['memory'], ['ultra', 'memory'], ['decision', 'memory']]) for (const order of ['engineering-first', 'rp-first']) {
  test('R40 final TGZ ' + companions.join('+') + ' ' + order, { timeout: 30000 }, async () => {
    let engineeringPolicy, evidence
    const load = async ({ ctx }) => {
      for (const id of companions) { const m = modules[id]; await ctx.plugin(m, { contextCompression: false, memoryMaxRequests: 0, memoryMaxTokens: 0 }).await() }
      evidence = ctx.get('ultraEvidenceSupport'); engineeringPolicy = ctx.get('sessionMemoryPolicy')
      assert.equal(engineeringPolicy.protocol, 'dsh.session-memory-policy/v1')
      assert.ok(evidence)
    }
    const f = await host({}, { install: rpModule.installRpPlugin, [order === 'engineering-first' ? 'before' : 'after']: load })
    try {
      const policy = f.ctx.get('sessionMemoryPolicy'); assert.equal(policy, engineeringPolicy); assert.equal(f.rp.policy, policy)
      const disabled = await rpModule.installRpPlugin(f.ctx, {}); assert.equal(disabled.enabled, false); await disabled.close()
      const a = await f.create(); assert.equal((await f.command(a, 'start')).kind, 'success')
      assert.equal(await evidence.memory.begin(a, 'RP_MUST_NOT_ENTER_ENGINEERING'), undefined)
      await assert.rejects(f.stream(a)); assert.equal(f.calls(), 0)
      assert.equal((await f.command(a, 'input 原生宿主补验')).kind, 'success'); await a.whenIdle(); await f.rp.ready(a.id)
      assert.equal(f.calls(), 1)
      const branchId = f.rp.status(a.id).branchId
      const clean = await f.command(a, 'continue-clean'); assert.equal(clean.kind, 'success', clean.text)
      const next = f.ctx.agents.get(/created: (\w+)/u.exec(clean.text)[1])
      assert.equal(next.session.deriveMessages().length, 0); assert.equal(f.rp.status(next.id).branchId, branchId)
      assert.equal(policy.status(a.id).mode, 'blocked'); await assert.rejects(f.stream(a)); assert.equal(f.calls(), 1)
      await f.rp.close(); await assert.rejects(f.stream(next)); assert.equal(f.calls(), 1)
      assert.equal(policy.status(next.id).mode, 'blocked')
      observations.push({ companions, order, policyShared: true, disabled: true, authenticRequests: 1, bypassRejected: true, cleanEmptyHistory: true, sameBranch: true, closedBlocked: true })
    } finally { await f.dispose() }
  })
}

test('R09 R40 cold process final bundles block disabled RP and recover ambiguous input without resend', { timeout: 30000 }, async () => {
  const f = await host({ inputFault: async stage => { if (stage === 'dispatch_marked') throw Error('COLD_DISPATCH_GAP') } }, { install: rpModule.installRpPlugin, before: async ({ ctx }) => { await ctx.plugin(modules.memory, {}).await() } })
  let directory, sessionId, branchId
  try {
    const a = await f.create(); await f.command(a, 'start'); assert.equal((await f.command(a, 'input 待定输入')).kind, 'error')
    assert.equal(f.rp.status(a.id).ambiguousInputIds.length, 1); assert.equal(f.calls(), 0)
    sessionId = a.id; branchId = f.rp.status(a.id).branchId; directory = path.dirname(f.profile)
    await f.ctx.sessions.flush(a.session)
  } finally { await f.dispose() }
  const results = []
  const childEnv = { ...process.env }; delete childEnv.NODE_TEST_CONTEXT
  for (const mode of ['disabled', 'enabled']) {
    const child = spawnSync(process.execPath, ['scripts/host-acceptance/dev3-cold.mjs', directory, sessionId, branchId, mode], { env: childEnv, encoding: 'utf8', windowsHide: true, timeout: 12000 })
    await fs.writeFile(path.join(base, 'cold-' + mode + '.log'), child.stdout + child.stderr)
    assert.equal(child.status, 0, child.stdout + child.stderr)
    results.push({ mode, exitCode: child.status })
  }
  observations.push({ coldProcess: true, persistedAmbiguous: true, automaticResends: 0, results })
})
