import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { host, latch } from './fixtures/rp/native-host.mjs'
const sha = s => createHash('sha256').update(s).digest('hex')
const canonical = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'
const must = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value }
const journalPath = (f, a) => path.join(f.profile, '.dsh-rp/v1/host', sha(a.id) + '.json')
const journal = async (f, agent) => JSON.parse(await fs.readFile(path.join(f.profile, '.dsh-rp/v1/host', sha(agent.id) + '.json'), 'utf8'))
const execute = (f, agent, name, args = {}, callId = 'tool_test') => f.ctx.tools.execute({ agent, name, arguments: args, callId, signal: new AbortController().signal })
async function prepared(f) { const a = await f.create(); assert.equal((await f.command(a, 'start')).kind, 'success'); assert.equal((await f.command(a, 'input MEMORY_FACT')).kind, 'success'); await a.whenIdle(); await f.rp.ready(a.id); return a }

test('R19 R20 proofs bind Result identity and authority; summary/state refs survive append but fail retcon', { timeout: 15000 }, async () => {
  const f = await host()
  try {
    const a = await prepared(f), m = f.rp.memory, j = await journal(f, a), authority = must(await m.control.authorize(j.data.request)), sid = j.data.inputs[0].sourceId
    const ctl = async key => must(await m.store.observeSource(authority, { idempotencyKey: key, origin: 'user_control', role: 'user_control', publicText: key, turnId: key }))
    must(await m.canonical.applyControl(authority, await ctl('control_event'), { kind: 'accept', sourceRevisionIds: [sid], events: [{ id: 'event_proof', epistemic: 'world', payload: { kind: 'state_change', subjectId: 'key', key: 'color', after: 'blue' } }], idempotencyKey: 'event', expected: must(await m.store.readFence(authority)) }))
    const candidate = must(await m.summaries.propose(authority, { schemaVersion: 1, proposedEvents: [], proposedSummary: { level: 'scene', text: 'summary', sourceRevisionIds: [sid], exactAnchors: [] } }, { level: 'scene', sourceRevisionIds: [sid], dependencySummaryIds: [], supportEventIds: [] }))
    must(await m.summaries.adopt(authority, await ctl('control_adopt'), candidate.id, { idempotencyKey: 'adopt' }))
    const results = await Promise.all(['state', 'summary'].map(kind => m.retrieval.search(authority, { query: '', kind }))), proofs = results.map(r => f.retrievalEvidence(r, authority)), inputs = new Set([sid])
    assert.ok(proofs.every(p => p.records.length === 1)); assert.throws(() => f.retrievalEvidence(structuredClone(results[0]), authority), /identity/)
    assert.throws(() => f.retrievalEvidence(results[0], {}), /identity/)
    const other = await ctl('other'); must(await m.canonical.applyControl(authority, await ctl('control_other'), { kind: 'accept', sourceRevisionIds: [other.id], events: [], idempotencyKey: 'other', expected: must(await m.store.readFence(authority)) }))
    for (const proof of proofs) await f.verifyRetrievalEvidence(m.store, authority, proof, inputs)
    must(await m.canonical.applyControl(authority, await ctl('control_retcon'), { kind: 'retcon', targetEventIds: ['event_proof'], events: [], idempotencyKey: 'retcon', expected: must(await m.store.readFence(authority)) }))
    for (const proof of proofs) await assert.rejects(f.verifyRetrievalEvidence(m.store, authority, proof, inputs), /invalidated/)
  } finally { await f.dispose() }
})

test('R18 R20 retrieval receipt persists actual records and v2 provenance through real SDK rendering', { timeout: 15000 }, async () => {
  const f = await host()
  try {
    const a = await prepared(f), result = await execute(f, a, 'rp_memory_search', { query: 'MEMORY_FACT' })
    assert.equal(result.isError, false, JSON.stringify(result))
    const j = await journal(f, a), rec = j.data.receipts.tool_test, value = JSON.parse(result.content[0].text)
    assert.equal(j.data.schemaVersion, 2); assert.equal(rec.snapshot.provenance, 'retrieval-result')
    assert.deepEqual(rec.snapshot.records.map(r => r.id), value.value.items.map(r => r.id))
    assert.equal(rec.snapshot.resultSha256, sha(result.content[0].text))
  } finally { await f.dispose() }
})

test('R18 retcon between query and receipt cannot certify the earlier event', { timeout: 15000 }, async () => {
  const f = await host(); let remove
  try {
    const a = await prepared(f), m = f.rp.memory, j = await journal(f, a), authority = must(await m.control.authorize(j.data.request)), sid = j.data.inputs[0].sourceId
    const ctl = async key => must(await m.store.observeSource(authority, { idempotencyKey: key, origin: 'user_control', role: 'user_control', publicText: key, turnId: key }))
    must(await m.canonical.applyControl(authority, await ctl('control_event'), { kind: 'accept', sourceRevisionIds: [sid], events: [{ id: 'event_tool', epistemic: 'world', payload: { kind: 'state_change', subjectId: 'key', key: 'color', after: 'blue' } }], idempotencyKey: 'event', expected: must(await m.store.readFence(authority)) }))
    const control = await ctl('control_retcon')
    let mutated = false
    remove = f.ctx.on('tools/execute', async (_exec, next) => { const r = await next(); assert.equal(r.isError, false); assert.ok(r.content[0].text.includes('event_tool')); must(await m.canonical.applyControl(authority, control, { kind: 'retcon', targetEventIds: ['event_tool'], events: [], idempotencyKey: 'retcon', expected: must(await m.store.readFence(authority)) })); mutated = true; return r })
    const result = await execute(f, a, 'rp_memory_search', { query: 'blue' }); assert.equal(mutated, true)
    assert.equal((await journal(f, a)).data.receipts.tool_test, undefined, JSON.stringify(result))
  } finally { remove?.(); await f.dispose() }
})

test('R37 oversized v2 receipt is refused before replacing the readable journal; diagnosis and clean root survive', { timeout: 15000 }, async () => {
  const f = await host()
  try {
    const a = await prepared(f); await execute(f, a, 'rp_memory_search', { query: 'MEMORY_FACT' })
    const j = await journal(f, a); await f.drop(a)
    const base = structuredClone(j.data.receipts.tool_test), ref = base.snapshot.records[0]
    base.snapshot.records = Array.from({ length: 4096 }, () => ref)
    for (let i = 0; i < 10; i++) { j.data.receipts['seed_' + i] = base; j.sha256 = sha(canonical(j.data)); if (Buffer.byteLength(canonical(j)) > 4194304 - 4000) { delete j.data.receipts['seed_' + i]; break } }
    const tail = structuredClone(j.data.receipts.tool_test); j.data.receipts.seed_tail = tail; tail.snapshot.dependencyIds = []
    j.sha256 = sha(canonical(j.data)); const gap = 4194304 - 100 - Buffer.byteLength(canonical(j)), count = Math.floor(gap / 131)
    // Compute padding once; repeated serialization near 4 MiB is quadratic.
    assert.ok(count < 4096); tail.snapshot.dependencyIds = Array.from({ length: count }, () => 's'.repeat(128))
    j.sha256 = sha(canonical(j.data)); const bytes = canonical(j); assert.ok(Buffer.byteLength(bytes) < 4194304)
    await fs.writeFile(journalPath(f, a), bytes); const resumed = await f.resume(a)
    await f.ctx.systemPrompt.assemble({ agent: resumed, signal: new AbortController().signal })
    // Resume rewrites the same valid v2 envelope; capture those actual bytes.
    const before = await fs.readFile(journalPath(f, a), 'utf8'), result = await execute(f, resumed, 'rp_memory_status', {}, 'overflow_status')
    assert.equal(result.isError, true); assert.equal(await fs.readFile(journalPath(f, a), 'utf8'), before)
    assert.equal(f.rp.status(a.id).lastError, 'capacity_exceeded'); assert.equal((await f.command(resumed, 'status')).kind, 'success')
    assert.equal((await f.command(resumed, 'continue-clean')).kind, 'success')
  } finally { await f.dispose() }
})

test('R21 v1 with no tools upgrades with exact byte backup; tool history stays recovery-only', { timeout: 15000 }, async () => {
  for (const tools of [false, true]) {
    const f = await host()
    try {
      const a = tools ? await prepared(f) : await f.create(); if (!tools) await f.command(a, 'start'); else await execute(f, a, 'rp_memory_status')
      const j = await journal(f, a); await f.drop(a); j.data.schemaVersion = 1
      for (const s of [...Object.values(j.data.pending), ...Object.values(j.data.snapshots), ...Object.values(j.data.frames), ...Object.values(j.data.receipts).map(r => r.snapshot)]) { delete s.provenance; delete s.records; delete s.resultSha256 }
      j.sha256 = sha(canonical(j.data)); const bytes = canonical(j); await fs.writeFile(journalPath(f, a), bytes)
      const resumed = await f.resume(a)
      if (tools) {
        assert.equal(f.rp.status(a.id).blocked, true); assert.equal(f.rp.status(a.id).lastError, 'legacy_tools_recovery_only')
        assert.equal(await fs.readFile(journalPath(f, a), 'utf8'), bytes); await assert.rejects(f.stream(resumed))
        assert.equal((await f.command(resumed, 'continue-clean')).kind, 'success')
      } else { assert.equal((await journal(f, a)).data.schemaVersion, 2); assert.equal(await fs.readFile(journalPath(f, a) + '.v1-backup', 'utf8'), bytes) }
    } finally { await f.dispose() }
  }
})

test('R09 R21 a corrupt journal supplies no trusted branch; explicit branch still needs independent authority', { timeout: 15000 }, async () => {
  const f = await host()
  try {
    const a = await prepared(f), j = await journal(f, a); await f.drop(a); j.sha256 = '0'.repeat(64); await fs.writeFile(journalPath(f, a), canonical(j))
    const resumed = await f.resume(a); assert.equal(f.rp.status(a.id).branchId, undefined); assert.equal(f.rp.policy.status(a.id).mode, 'blocked')
    assert.equal((await f.command(resumed, 'continue-clean')).kind, 'error'); assert.equal((await f.command(resumed, 'continue-clean branch_not_authorized')).kind, 'error')
    assert.equal((await f.command(resumed, 'continue-clean ' + j.data.request.branchId)).kind, 'success')
  } finally { await f.dispose() }
})

test('R18 changed rendered text cannot acquire a receipt for an earlier result', { timeout: 15000 }, async () => {
  const f = await host(); let remove
  try {
    const a = await prepared(f)
    remove = f.ctx.on('tools/execute', async (_exec, next) => { const r = await next(); return { ...r, content: [{ type: 'text', text: 'REPLACED_PRIVATE_TEXT' }] } })
    const result = await execute(f, a, 'rp_memory_search', { query: 'MEMORY_FACT' })
    const j = await journal(f, a); assert.equal(j.data.receipts.tool_test, undefined, JSON.stringify(result))
  } finally { remove?.(); await f.dispose() }
})

test('R19 disposal while evidence validation awaits cannot publish the retired owner receipt', { timeout: 15000 }, async () => {
  const f = await host(), gate = latch(); let remove, restore
  try {
    const a = await prepared(f), original = f.rp.memory.store.readFence; let armed = false
    f.rp.memory.store.readFence = async (...args) => { const r = await original(...args); if (armed) { armed = false; await gate.wait() }; return r }; restore = () => f.rp.memory.store.readFence = original
    remove = f.ctx.on('tools/execute', async (_exec, next) => { const r = await next(); armed = true; return r })
    const running = execute(f, a, 'rp_memory_search', { query: 'MEMORY_FACT' }); await gate.entered
    let disposed; const observed = new Promise(r => disposed = r), off = f.ctx.on('agent/disposed', () => disposed())
    const dropping = f.drop(a); await observed; off(); gate.release(); await running; await dropping
    assert.equal((await journal(f, a)).data.receipts.tool_test, undefined)
  } finally { gate.release(); remove?.(); restore?.(); await f.dispose() }
})

test('R18 receipt validation cannot race a queue journal rename and lose a successful receipt', { timeout: 15000 }, async () => {
  const f = await host(), verifyGate = latch(), saveGate = latch(); let remove, restoreFence, restoreRename
  try {
    const a = await prepared(f), original = f.rp.memory.store.readFence; let armed = false, blockSave = false
    f.rp.memory.store.readFence = async (...args) => { const r = await original(...args); if (armed) { armed = false; await verifyGate.wait() }; return r }; restoreFence = () => f.rp.memory.store.readFence = original
    remove = f.ctx.on('tools/execute', async (_exec, next) => { const r = await next(); armed = true; return r })
    const rename = fs.rename; fs.rename = async (from, to) => { if (blockSave && to === journalPath(f, a)) { blockSave = false; await saveGate.wait() }; return rename(from, to) }; restoreRename = () => fs.rename = rename
    const running = execute(f, a, 'rp_memory_search', { query: 'MEMORY_FACT' }); await verifyGate.entered
    const context = structuredClone(a.session.deriveMessages().find(m => m.source.kind === 'runtime-context')); assert.ok(context); context.id = 'late_runtime_context'
    blockSave = true; a.session.append('user/message', context, { surfaceOp: 'append' })
    verifyGate.release(); const result = await running; saveGate.release(); await f.rp.ready(a.id).catch(() => {})
    assert.equal(result.isError, true, 'queue movement during verification must reject receipt publication')
    assert.equal((await journal(f, a)).data.receipts.tool_test, undefined)
  } finally { verifyGate.release(); saveGate.release(); remove?.(); restoreFence?.(); restoreRename?.(); await f.dispose() }
})
