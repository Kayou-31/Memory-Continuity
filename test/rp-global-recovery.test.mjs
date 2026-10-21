import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { build, stop } from 'esbuild'
const base = path.resolve('work/dev3-global'); await fs.mkdir(base, { recursive: true })
const runtime = path.join(base, 'runtime.mjs'); await build({ entryPoints: ['src/rp/memory.ts'], outfile: runtime, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' }); stop()
const api = await import(pathToFileURL(runtime).href + '?' + randomUUID())
const sha = s => createHash('sha256').update(s).digest('hex'), must = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value }, deny = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.code, code, JSON.stringify(r)) }
async function setup() {
  const directory = path.join(base, randomUUID()), profileRoot = path.join(directory, 'profile'), f = await api.openRpMemory({ profileRoot, entityIds: [] })
  const identity = JSON.parse(await fs.readFile(path.join(profileRoot, '.dsh-rp/v1/identity.json'), 'utf8')), scope = { kind: 'world', profileId: identity.profileId, worldId: 'dev3' }, spec = { scope, visibility: { policyId: 'policy', revision: 0, audienceSetId: 'public' }, audienceSetIds: ['public'], write: true }
  const a = must(await f.global.control.authorize(spec)), approval = f.global.control.approval({ commandId: 'cmd_test', sessionId: 'session_test' }), dir = path.join(profileRoot, '.dsh-rp/v1/global', sha(api.canonical(scope)))
  const pub = async (key, extra = {}) => f.global.control.publish(a, approval, { idempotencyKey: key, expected: must(await f.global.store.readFence(a)), key, body: '正文😀', privateSourceIds: [], ...extra })
  return { ...f, profileRoot, a, approval, dir, pub, spec }
}
async function seed(f, limit) {
  const file = path.join(f.dir, 'commits/0000000000000001.json'), envelope = JSON.parse(await fs.readFile(file, 'utf8')), original = structuredClone(envelope.state.publications[0]); let n = 0
  while (Buffer.byteLength(api.canonical(envelope)) < limit) {
    const p = structuredClone(original); p.id = 'publication_seed_' + n; p.source.id = 'approved_seed_' + n++; p.privateSourceIds = Array.from({ length: 256 }, (_, i) => 'source_' + String(i).padStart(120, 'x')); envelope.state.publications.push(p)
  }
  envelope.sha256 = sha(api.canonical(envelope.state)); await fs.writeFile(file, api.canonical(envelope)); await fs.writeFile(path.join(f.dir, 'seal.json'), api.canonical({ seq: 1, hash: envelope.sha256 }))
  return envelope
}
test('R22 R23 R24 R25 complete UTF-8 envelope limits reject before blobs and preserve cold-readable state', async () => {
  const f = await setup(), p = must(await f.pub('first')); await seed(f, 3 * 1024 * 1024)
  const old = must(await f.global.store.readFence(f.a)), blobs = await fs.readdir(path.join(f.dir, 'blobs'))
  deny(await f.pub('overflow'), 'capacity_exceeded')
  assert.deepEqual(await fs.readdir(path.join(f.dir, 'blobs')), blobs); assert.deepEqual(must(await f.global.store.readFence(f.a)), old)
  must(await f.global.control.revoke(f.a, f.approval, { idempotencyKey: 'revoke', expected: old, publicationId: p.id }))
  const cold = await api.openRpMemory({ profileRoot: f.profileRoot, entityIds: [] }), ca = must(await cold.global.control.authorize(f.spec)); must(await cold.global.store.readFence(ca))
})
test('R26 R27 R28 consecutive seal EIO cannot publish a second unsealed commit; same input recovers', async () => {
  const f = await setup(), rename = fs.rename; let failures = 2
  const input = { idempotencyKey: 'first', expected: must(await f.global.store.readFence(f.a)), key: 'first', body: 'BODY', privateSourceIds: [] }
  fs.rename = async (from, to) => { if (to === path.join(f.dir, 'seal.json') && failures-- > 0) throw Object.assign(new Error('SEAL_EIO'), { code: 'EIO' }); return rename(from, to) }
  try {
    deny(await f.global.control.publish(f.a, f.approval, input), 'persistence_uncertain')
    deny(await f.pub('second'), 'persistence_failed')
    assert.equal((await fs.readdir(path.join(f.dir, 'commits'))).filter(x => x.endsWith('.json')).length, 1)
  } finally { fs.rename = rename }
  const cold = await api.openRpMemory({ profileRoot: f.profileRoot, entityIds: [] }), ca = must(await cold.global.control.authorize(f.spec)), approval = cold.global.control.approval({ commandId: 'cmd_cold', sessionId: 'session_cold' })
  must(await cold.global.control.publish(ca, approval, input)); deny(await cold.global.control.publish(ca, approval, { ...input, body: 'CHANGED' }), 'idempotency_conflict')
  assert.equal((await fs.readdir(path.join(f.dir, 'commits'))).filter(x => x.endsWith('.json')).length, 1)
})

test('R22 R24 hard control limit preserves the old envelope and permits an existing idempotent retry', async () => {
  const f = await setup(), expected = must(await f.global.store.readFence(f.a)), input = { idempotencyKey: 'first', expected, key: 'first', body: '正文😀', privateSourceIds: [] }; must(await f.global.control.publish(f.a, f.approval, input))
  const envelope = await seed(f, 4194304 - 35000); let i = 0
  while (Buffer.byteLength(api.canonical(envelope)) < 4194304 - 170) envelope.state.keys[sha('padding_' + i++)] = { effect: sha('effect'), result: '' }
  envelope.sha256 = sha(api.canonical(envelope.state)); const bytes = api.canonical(envelope); assert.ok(Buffer.byteLength(bytes) <= 4194304)
  const file = path.join(f.dir, 'commits/0000000000000001.json'); await fs.writeFile(file, bytes); await fs.writeFile(path.join(f.dir, 'seal.json'), api.canonical({ seq: 1, hash: envelope.sha256 }))
  const old = must(await f.global.store.readFence(f.a))
  deny(await f.global.control.privateDeletion(f.a, f.approval, { idempotencyKey: 'overflow_control', expected: old, privateSourceIds: [], publicationDisposition: 'retain' }), 'capacity_exceeded')
  assert.equal(await fs.readFile(file, 'utf8'), bytes); assert.deepEqual(must(await f.global.store.readFence(f.a)), old)
  must(await f.global.control.publish(f.a, f.approval, input))
})

test('R28 global I/O errors distinguish unpublished blobs from a commit rename already completed', async () => {
  for (const stage of ['blob', 'commit_before', 'commit_after']) {
    const f = await setup(), rename = fs.rename, input = { idempotencyKey: 'first', expected: must(await f.global.store.readFence(f.a)), key: 'first', body: 'BODY', privateSourceIds: [] }; let armed = true
    fs.rename = async (from, to) => {
      if (armed && ((stage === 'blob' && to.includes(path.join(f.dir, 'blobs'))) || (stage.startsWith('commit') && to.includes(path.join(f.dir, 'commits'))))) { armed = false; if (stage === 'commit_after') await rename(from, to); throw Object.assign(new Error(stage), { code: 'EIO' }) }
      return rename(from, to)
    }
    try { deny(await f.global.control.publish(f.a, f.approval, input), stage === 'commit_after' ? 'persistence_uncertain' : 'persistence_failed') } finally { fs.rename = rename }
    assert.equal(must(await f.global.store.readFence(f.a)).scopeRevision, stage === 'commit_after' ? 1 : 0)
    must(await f.global.control.publish(f.a, f.approval, input))
  }
})

test('R29 wrong sealed hash and two unsealed commits remain corrupt rather than repaired', async () => {
  const f = await setup(); must(await f.pub('one')); const file = path.join(f.dir, 'commits/0000000000000001.json'), first = JSON.parse(await fs.readFile(file, 'utf8'))
  await fs.writeFile(path.join(f.dir, 'seal.json'), api.canonical({ seq: 1, hash: 'a'.repeat(64) })); deny(await f.global.store.readFence(f.a), 'store_corrupt')
  await fs.rm(path.join(f.dir, 'seal.json')); const next = structuredClone(first); next.state.seq = 2; next.state.previousHash = first.sha256; next.state.fence.scopeRevision++; next.sha256 = sha(api.canonical(next.state)); await fs.writeFile(path.join(f.dir, 'commits/0000000000000002.json'), api.canonical(next))
  deny(await f.global.store.readFence(f.a), 'store_corrupt')
})
