import test from 'node:test'
import assert from 'node:assert/strict'
import { host } from './fixtures/rp/native-host.mjs'

test('status distinguishes unbound, healthy, and closed sessions', async () => {
  const f = await host()
  try {
    const a = await f.create()
    assert.equal(f.rp.status(a.id).blocked, true)
    await f.command(a, 'start'); await f.rp.ready(a.id)
    assert.equal(f.rp.status(a.id).blocked, false)
    assert.equal(JSON.parse((await f.command(a, 'status')).text).blocked, false)
    await f.rp.close()
    assert.equal(f.rp.status(a.id).blocked, true)
    await assert.rejects(f.rp.ready(a.id))
  } finally { await f.dispose() }
})
