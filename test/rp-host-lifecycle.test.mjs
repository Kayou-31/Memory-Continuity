import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { host, latch } from './fixtures/rp/native-host.mjs'

test('R01 R03 failed observation save cannot skip blocking any session on close', { timeout: 15000 }, async () => {
  const f = await host(); let restore
  try {
    const a = await f.create(), b = await f.create()
    assert.equal((await f.command(a, 'start')).kind, 'success'); assert.equal((await f.command(b, 'start')).kind, 'success')
    const rename = fs.rename; fs.rename = async (from, to) => { if (to.includes(path.join('v1', 'host'))) throw Object.assign(new Error('injected journal EIO'), { code: 'EIO' }); return rename(from, to) }; restore = () => fs.rename = rename
    a.session.append('user/message', { id: 'bad_observation', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'OBSERVATION' }] }, { surfaceOp: 'append' })
    await assert.rejects(f.rp.ready(a.id)); restore()
    const results = await Promise.allSettled([f.rp.close(), f.rp.close()])
    assert.equal(f.rp.policy.status(a.id).mode, 'blocked')
    assert.equal(f.rp.policy.status(b.id).mode, 'blocked')
    await assert.rejects(f.stream(a)); assert.equal(f.calls(), 0)
    assert.equal(results[0].status, 'rejected', 'close must report cleanup failure')
  } finally { restore?.(); await f.dispose() }
})

test('R05 mode RP alone and copied options cannot enter the real SDK terminal', { timeout: 15000 }, async () => {
  const f = await host()
  try {
    const a = await f.create(); await f.rp.policy.activate(a.id, 'rp', { idle: true, safe: true })
    await assert.rejects(f.stream(a)); assert.equal(f.calls(), 0)
  } finally { await f.dispose() }
})

test('R04 R05 opaque owners and exact options remain isolated across retirement and stamp changes', { timeout: 15000 }, async () => {
  const f = await host()
  try {
    const ad = f.ctx.get('rpSessionAdmission'), one = ad.createOwner(), two = ad.createOwner(), options = Object.freeze({}), otherOptions = Object.freeze({}); let generation = 1
    ad.bind(one, 'admission_one', () => ({ epoch: 1, generation, active: true })); ad.bind(two, 'admission_two', () => ({ epoch: 1, generation: 1, active: true }))
    ad.issue(one, 'admission_one', options, { epoch: 1, generation: 1, active: true }); ad.issue(two, 'admission_two', otherOptions, { epoch: 1, generation: 1, active: true })
    assert.equal(ad.permits('admission_one', options), true); assert.equal(ad.permits('admission_one', structuredClone(options)), false)
    generation++; assert.equal(ad.permits('admission_one', options), false); ad.retire(one)
    assert.equal(ad.permits('admission_two', otherOptions), true); assert.throws(() => ad.bind(two, 'admission_one', () => ({ epoch: 1, generation: 1, active: true })))
    ad.retire(two); assert.equal(ad.permits('admission_two', otherOptions), false)
  } finally { await f.dispose() }
})

test('R02 real SDK preserves admission identity; closing revokes before a paused stream ends', { timeout: 15000 }, async () => {
  const f = await host(), gate = latch(); f.gate(gate)
  try {
    const a = await f.create(); assert.equal((await f.command(a, 'start')).kind, 'success')
    assert.equal((await f.command(a, 'input 你好')).kind, 'success'); await gate.entered
    assert.equal(f.calls(), 1, 'authenticated native request reached terminal')
    const close = f.rp.close(); assert.equal(close, f.rp.close())
    await assert.rejects(f.stream(a)); assert.equal(f.calls(), 1)
    gate.release(); await close.catch(() => {}); assert.equal(f.rp.policy.status(a.id).mode, 'blocked')
  } finally { gate.release(); await f.dispose() }
})

test('R04 duplicate installation is rejected before acquiring sessions and preserves first owner', { timeout: 15000 }, async () => {
  const f = await host()
  try {
    await assert.rejects(f.installRpPlugin(f.ctx, f.settings), /duplicate installation/)
    const a = await f.create(); assert.equal((await f.command(a, 'start')).kind, 'success')
  } finally { await f.dispose() }
})

test('R04 failed installation releases its reservation so corrected configuration can be installed', { timeout: 15000 }, async () => {
  const f = await host(); let replacement
  try {
    await f.rp.close()
    await assert.rejects(f.installRpPlugin(f.ctx, { ...f.settings, workspaceRoot: path.join(f.project, 'missing') }))
    replacement = await f.installRpPlugin(f.ctx, f.settings)
    assert.equal(replacement.enabled, true)
  } finally { await replacement?.close(); await f.dispose() }
})

test('R06 R07 failed queue permits diagnostics and clean root on the same verified branch', { timeout: 15000 }, async () => {
  const f = await host(); let restore
  try {
    const a = await f.create(); await f.command(a, 'start'); const branchId = f.rp.status(a.id).branchId
    const rename = fs.rename; fs.rename = async (from, to) => { if (to.includes(path.join('v1', 'host'))) throw Object.assign(new Error('EIO'), { code: 'EIO' }); return rename(from, to) }; restore = () => fs.rename = rename
    a.session.append('user/message', { id: 'failed_input', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'PRIVATE_DIAGNOSTIC' }] }, { surfaceOp: 'append' })
    await assert.rejects(f.rp.ready(a.id)); restore()
    const status = await f.command(a, 'status'); assert.equal(status.kind, 'success', status.text); assert.ok(!status.text.includes('PRIVATE_DIAGNOSTIC'))
    assert.equal((await f.command(a, 'input forbidden')).kind, 'error')
    const clean = await f.command(a, 'continue-clean'); assert.equal(clean.kind, 'success', clean.text)
    const newId = /created: (\w+)/.exec(clean.text)[1], next = f.ctx.agents.get(newId)
    assert.equal(next.session.deriveMessages().length, 0); assert.equal(f.rp.status(newId).branchId, branchId)
    assert.equal(f.rp.policy.status(a.id).mode, 'blocked'); await assert.rejects(f.stream(a)); assert.equal(f.calls(), 0)
  } finally { restore?.(); await f.dispose() }
})

test('R08 failed clean journal publication leaves old root blocked and no new live owner', { timeout: 15000 }, async () => {
  const f = await host(); let restore
  try {
    const a = await f.create(); await f.command(a, 'start')
    const rename = fs.rename; fs.rename = async (from, to) => { if (to.includes(path.join('v1', 'host'))) throw Object.assign(new Error('CLEAN_EIO'), { code: 'EIO' }); return rename(from, to) }; restore = () => fs.rename = rename
    const result = await f.command(a, 'continue-clean'); assert.equal(result.kind, 'error'); restore()
    assert.equal(f.rp.policy.status(a.id).mode, 'blocked'); await assert.rejects(f.stream(a)); assert.equal(f.calls(), 0)
  } finally { restore?.(); await f.dispose() }
})

test('R09 dispatch-marked input is diagnosed as ambiguous and never automatically resent in a clean root', { timeout: 15000 }, async () => {
  const f = await host({ inputFault: async stage => { if (stage === 'dispatch_marked') throw new Error('CRASH_GAP') } })
  try {
    const a = await f.create(); await f.command(a, 'start'); assert.equal((await f.command(a, 'input ambiguous')).kind, 'error')
    const ids = f.rp.status(a.id).ambiguousInputIds; assert.equal(ids.length, 1); assert.equal(f.calls(), 0)
    const clean = await f.command(a, 'continue-clean'); assert.equal(clean.kind, 'success', clean.text)
    const next = f.ctx.agents.get(/created: (\w+)/.exec(clean.text)[1]); assert.equal(next.session.deriveMessages().length, 0)
    assert.equal((await f.command(next, 'resume-input ' + ids[0])).kind, 'error'); assert.equal(f.calls(), 0)
  } finally { await f.dispose() }
})
