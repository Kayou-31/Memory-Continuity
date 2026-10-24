import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build, stop } from 'esbuild'

const runtime = path.resolve('work/sdk-version-test/runtime.mjs')
await fs.mkdir(path.dirname(runtime), { recursive: true })
await build({ entryPoints: ['src/rp/native-sdk.ts'], outfile: runtime, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
stop()
const { validateNativeSdkVersions } = await import(pathToFileURL(runtime).href)
const families = ['0.2.1-rc.2', '0.2.1-rc.3']
const peers = ['dsh-agent', 'dsh-llm', 'dsh-session', 'dsh-system-prompt', 'dsh-tools']
const versions = family => ({ cordis: '4.0.5', schemastery: '3.18.5', ...Object.fromEntries(peers.map(name => [name, family])) })
const denied = value => assert.throws(() => validateNativeSdkVersions(value), error => error.code === 'capability_missing')

test('native gate permits both exact coherent SDK families without altering evidence', () => {
  for (const family of families) {
    const value = Object.freeze(versions(family))
    assert.doesNotThrow(() => validateNativeSdkVersions(value))
    assert.deepEqual(value, versions(family))
  }
})

test('each direct native DSH peer rejects the opposite family, even when both versions are supported', () => {
  for (const family of families) for (const peer of peers) {
    denied({ ...versions(family), [peer]: families.find(version => version !== family) })
  }
})

test('old, future, missing and malformed native versions remain fail-closed', () => {
  for (const family of families) for (const peer of peers) {
    for (const version of ['0.2.0-rc.2', '0.2.1-rc.1', '0.2.1-rc.4', '0.2.1', '0.2.1-rc.3+unverified', '', undefined, null, 3]) {
      denied({ ...versions(family), [peer]: version })
    }
    const value = versions(family); delete value[peer]; denied(value)
  }
})

test('Cordis and Schemastery remain exactly pinned for both SDK families', () => {
  for (const family of families) {
    for (const [peer, version] of [['cordis', '4.0.4'], ['cordis', '4.0.6'], ['schemastery', '3.18.4'], ['schemastery', '3.18.6']]) {
      denied({ ...versions(family), [peer]: version })
    }
    for (const peer of ['cordis', 'schemastery']) { const value = versions(family); delete value[peer]; denied(value) }
  }
})
