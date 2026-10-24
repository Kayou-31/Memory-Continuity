import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import * as rp from '../lib/index.js'

test('Memory-Continuity has a consistent standalone entry and disabled defaults', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const lock = JSON.parse(await fs.readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))
  const patch = await fs.readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.equal(rp.name, '@dsh-external/dsh-memory-continuity')
  assert.equal(manifest.name, rp.name)
  assert.equal(lock.name, rp.name)
  assert.equal(lock.packages[''].name, rp.name)
  assert.ok(patch.includes("name: '" + rp.name + "'"))
  const dependencies = { ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies }
  assert.ok(Object.keys(dependencies).every(name => !name.startsWith('@dsh-external/')), 'standalone package does not require an Ultra companion')
  assert.equal(rp.Config({}).enabled, false)
  assert.equal(rp.Config({}).contextCompression, false)
  assert.equal(rp.Config({}).strictPov, false)
})
