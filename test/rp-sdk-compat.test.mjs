import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { host } from './fixtures/rp/native-host.mjs'

const supported = ['0.2.1-rc.2', '0.2.1-rc.3']
const dshPeers = ['dsh-agent', 'dsh-llm', 'dsh-session', 'dsh-system-prompt', 'dsh-tools']

test('published metadata explicitly admits only rc.2 and rc.3', async () => {
  const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'))
  const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'))
  assert.deepEqual(manifest.engines.dsh.split(' || '), supported)
  for (const name of dshPeers) assert.deepEqual(manifest.peerDependencies['@deepseek-ai/' + name].split(' || '), supported)
  assert.deepEqual(lock.packages[''].peerDependencies, manifest.peerDependencies)
  assert.deepEqual(lock.packages[''].engines, manifest.engines)
  assert.equal(lock.version, manifest.version)
  assert.equal(lock.packages[''].version, manifest.version)
})

test('the installed coherent native SDK boots and dispatches through the actual offline terminal', async () => {
  const f = await host()
  try {
    const a = await f.create()
    assert.equal((await f.command(a, 'start')).kind, 'success')
    const versions = f.rp.status(a.id).nativeVersions
    assert.ok(supported.includes(versions['dsh-agent']))
    for (const name of dshPeers) assert.equal(versions[name], versions['dsh-agent'])
    assert.equal(versions.cordis, '4.0.5')
    assert.equal(versions.schemastery, '3.18.5')
    assert.equal((await f.command(a, 'input Offline SDK compatibility probe')).kind, 'success')
    await a.whenIdle(); await f.rp.ready(a.id)
    assert.equal(f.calls(), 1)
    assert.equal(f.rp.status(a.id).blocked, false)
  } finally { await f.dispose() }
})
