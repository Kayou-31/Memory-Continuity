import test from 'node:test'
import assert from 'node:assert/strict'
import { host } from './fixtures/rp/native-host.mjs'

for (const command of ['retcon', 'delete', 'publish', 'adopt-canon', 'summary', 'propose', 'global preference']) {
  test('invalid '+command+' JSON is a recoverable input error', async () => {
    const f = await host()
    try {
      const a = await f.create(); await f.command(a, 'start')
      for (const input of ['{', 'null', '[]', '"text"', '{}']) {
        const result = await f.command(a, command+' '+input)
        assert.equal(result.kind, 'error')
        assert.match(result.text, /^(invalid_record|scope_denied):/, input)
        await f.rp.ready(a.id)
      }
      assert.equal((await f.command(a, 'input Still usable')).kind, 'success')
      await a.whenIdle(); await f.rp.ready(a.id)
    } finally { await f.dispose() }
  })
}
