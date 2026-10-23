import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { host } from './fixtures/rp/native-host.mjs'

test('failed command grant is durable before retry uses it and survives cold start', async () => {
  const f = await host(), rename = fs.rename
  const target = path.join(f.profile, '.dsh-rp/v1/global-command-grants.json')
  try {
    const a = await f.create()
    fs.rename = async (from, to) => { if (to === target) throw Object.assign(new Error('GRANT_EIO'), { code: 'EIO' }); return rename(from, to) }
    assert.equal((await f.command(a, 'global preference {"key":"language","body":"Chinese"}')).kind, 'error')
    fs.rename = rename
    assert.equal((await f.command(a, 'global preference {"key":"language","body":"Chinese"}')).kind, 'success')
    const saved = JSON.parse(await fs.readFile(target, 'utf8'))
    assert.equal(saved.grants.length, 1)
    assert.equal((await fs.readdir(path.dirname(target))).filter(n => n.startsWith('global-command-grants.json.tmp-')).length, 0)
  } finally { fs.rename = rename; await f.dispose() }
  const cold = await host({}, { directory: path.dirname(f.profile) })
  try {
    const a = await cold.create(), listed = await cold.command(a, 'global list {}')
    assert.equal(listed.kind, 'success'); assert.match(listed.text, /publication_.*@1/)
    assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).grants.length, 1)
  } finally { await cold.dispose() }
})
