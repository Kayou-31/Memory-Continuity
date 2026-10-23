import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { setup, must, deny } from './fixtures/rp/growth.mjs'

test('one verified view shares event provenance and rejects use after its operation', async () => {
  const f = await setup()
  try {
    const cause = await f.experience('meet', 'A meeting')
    await f.apply('identity', { kind: 'state', entityId: 'erin', key: 'identity', value: 'traveler', previousEventId: null, causeEventIds: [cause], note: 'Starting identity' }).then(must)
    let loads = 0, escaped
    const readdir = fs.readdir
    fs.readdir = async (...args) => { if (String(args[0]).endsWith('commits')) loads++; return readdir(...args) }
    let result
    try {
      result = await f.store.withReadView(f.authority, async view => {
        escaped = view.readSource
        assert.equal(view.events.length, 2)
        assert.equal(view.projection.state[0].value, 'traveler')
        assert.equal(view.ledger.branch.id, f.request.branchId)
        const source = view.sources[0]
        const span = { sourceRevisionId: source.id, publicTextSha256: source.publicTextSha256, startUtf16: 0, endUtf16: source.publicTextLengthUtf16, quoteSha256: source.publicTextSha256 }
        assert.match(await view.readSource(span), /Explicit human control/)
        assert.match(await view.readSource(span), /Explicit human control/)
        return { events: view.events, projection: view.projection }
      }, { audit: true })
    } finally { fs.readdir = readdir }
    assert.equal(must(result).projection.state[0].value, 'traveler')
    assert.equal(loads, 2, 'one initial verified load plus one exit fence verification')
    await assert.rejects(() => escaped({}), /closed/i)
    deny(await f.store.withReadView({}, () => 'leaked'), 'scope_denied')
  } finally { await f.close() }
})

test('deletion during a shared view never releases the previously assembled event', async () => {
  const f = await setup()
  try {
    const eventId = await f.experience('private', 'Private memory')
    const event = must(await f.store.readEvents(f.authority)).find(e => e.id === eventId)
    const ctl = await f.controlSource('erase')
    const result = await f.store.withReadView(f.authority, async view => {
      assert.ok(view.events.some(e => e.id === eventId))
      must(await f.canonical.applyControl(f.authority, ctl, { kind: 'privacy_delete', idempotencyKey: 'erase', expected: await f.fence(), sourceRevisionIds: [event.sources[0].sourceRevisionId], affectedBranchIds: [f.request.branchId] }))
      return view.events
    })
    deny(result, 'stale_input')
    assert.equal(must(await f.store.withReadView(f.authority, view => view.events)).length, 0)
  } finally { await f.close() }
})
