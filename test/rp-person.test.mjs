import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { setup, must, deny } from './fixtures/rp/growth.mjs'
const draft = () => ({ schemaVersion: 1, kind: 'person-draft', personId: 'erin', fields: [
  { fieldId: 'name', kind: 'identity', value: '林澈', policy: 'stable' },
  { fieldId: 'origin', kind: 'background', value: '钟楼旁长大', policy: 'stable' },
  { fieldId: 'care', kind: 'values', value: '守护同行者', policy: 'growable' },
], relationships: [{ targetId: 'bea', relation: 'trust', value: '初识' }], goals: [{ goalId: 'explore', category: 'task', objective: '寻找故乡', nextAction: '询问线索' }] })
async function create(f, key = 'create', value = draft()) {
  const p = must(await f.person.preview(f.authority, value, key))
  return must(await f.person.confirm(f.authority, p.handle, await f.controlSource(key)))
}
test('person preview confirms one atomic origin, fields, relationship and goal with durable retry', async () => {
  const f = await setup()
  try {
    const p = must(await f.person.preview(f.authority, draft(), 'create')), before = await f.fence(), ctl = await f.controlSource('create')
    assert.equal(p.personId, 'erin'); assert.equal(p.backupRequired, true)
    assert.equal(must(await f.store.readEvents(f.authority)).length, 0)
    const once = must(await f.person.confirm(f.authority, p.handle, ctl))
    assert.equal(once.fence.contextRevision, before.contextRevision + 1)
    const person = must(await f.person.read(f.authority, 'erin'))
    assert.equal(person.fields.find(f => f.fieldId === 'name').value, '林澈')
    assert.equal(person.relationships[0].value, '初识')
    assert.equal(person.goals[0].value.progress, 0)
    assert.equal(must(await f.store.readEvents(f.authority)).length, 6)
    assert.deepEqual(must(await f.person.confirm(f.authority, p.handle, ctl)), once)
    const cold = await setup(f.directory, f.request)
    try {
      assert.deepEqual(must(await cold.person.read(cold.authority, 'erin')).fields, person.fields)
      const retry = must(await cold.person.preview(cold.authority, draft(), 'create'))
      assert.deepEqual(must(await cold.person.confirm(cold.authority, retry.handle, ctl)), once)
      deny(await cold.person.preview(cold.authority, draft(), 'different'))
    } finally { await cold.close() }
    const ws = path.join(f.directory, 'profile/.dsh-rp/v1/workspaces', f.request.workspaceId)
    const files = (await fs.readdir(path.join(ws, 'commits'))).sort()
    const tail = JSON.parse(await fs.readFile(path.join(ws, 'commits', files.at(-1)), 'utf8'))
    assert.deepEqual(tail.transaction.requiredCapabilities, ['rp.person-core/v1'])
    const backups = await fs.readdir(path.join(f.directory, 'profile/.dsh-rp/v1/backups', f.request.workspaceId))
    assert.equal(backups.length, 1)
    const manifest = JSON.parse(await fs.readFile(path.join(f.directory, 'profile/.dsh-rp/v1/backups', f.request.workspaceId, backups[0], 'manifest.json'), 'utf8'))
    assert.equal(manifest.sequence, tail.transaction.sequence - 1)
    assert.ok(manifest.files.some(x => x.path === 'profile/identity.json'))
  } finally { await f.close() }
})
test('person import rejects unknown entities, untrusted fields, excessive text and stale or forged previews', async () => {
  const f = await setup()
  try {
    deny(await f.person.preview(f.authority, { ...draft(), personId: 'unknown' }, 'unknown'), 'scope_denied')
    deny(await f.person.preview(f.authority, { ...draft(), trusted: true }, 'forged'), 'scope_denied')
    deny(await f.person.preview(f.authority, { ...draft(), fields: [{ ...draft().fields[0], value: 'x'.repeat(2049) }] }, 'large'), 'invalid_record')
    deny(await f.person.confirm(f.authority, {}, await f.controlSource('forged')), 'scope_denied')
    const p = must(await f.person.preview(f.authority, draft(), 'stale'))
    await f.experience('later', 'An intervening event')
    deny(await f.person.confirm(f.authority, p.handle, await f.controlSource('stale')), 'stale_input')
    const other = must(await f.control.authorize(f.request))
    deny(await f.person.confirm(other, p.handle, await f.controlSource('other')), 'scope_denied')
  } finally { await f.close() }
})
test('legacy identity conflicts are explicit and all canonical routes reject unmarked person fields', async () => {
  const f = await setup()
  try {
    const ctl = await f.controlSource('legacy')
    must(await f.canonical.applyControl(f.authority, ctl, { kind: 'accept', idempotencyKey: 'legacy', expected: await f.fence(), sourceRevisionIds: [ctl.id], events: [{ id: 'legacy_name', epistemic: 'world', payload: { kind: 'state_change', subjectId: 'erin', key: 'identity', after: 'Old identity' } }] }))
    const rejected = await f.person.preview(f.authority, draft(), 'conflict'); deny(rejected); assert.match(rejected.message, /legacy_name/)
    await create(f, 'bea', { ...draft(), personId: 'bea', relationships: [], goals: [] })
    const overwrite = await f.controlSource('overwrite')
    deny(await f.canonical.applyControl(f.authority, overwrite, { kind: 'accept', idempotencyKey: 'overwrite', expected: await f.fence(), sourceRevisionIds: [overwrite.id], events: [{ id: 'unmarked', epistemic: 'world', payload: { kind: 'state_change', subjectId: 'bea', key: 'identity', after: 'Overwrite' } }] }), 'scope_denied')
    assert.equal(must(await f.person.read(f.authority, 'bea')).fields.find(f => f.fieldId === 'name').value, '林澈')
  } finally { await f.close() }
})

test('raw canonical controls cannot create a fieldless person or append a second initialization later', async () => {
  const f=await setup()
  try {
    const empty=await f.controlSource('empty')
    deny(await f.canonical.applyControl(f.authority,empty,{kind:'accept',idempotencyKey:'empty',expected:await f.fence(),sourceRevisionIds:[empty.id],events:[{id:'empty_origin',personProtocol:'person-origin/v1',epistemic:'world',payload:{kind:'occurrence',actorIds:['bea'],description:'Initial definition'}}]}),'invalid_record')
    const made=await create(f), original=must(await f.store.readEvents(f.authority)).find(e=>e.id===made.originEventId), extra=await f.controlSource('extra')
    deny(await f.canonical.applyControl(f.authority,extra,{kind:'accept',idempotencyKey:'extra',expected:await f.fence(),sourceRevisionIds:[extra.id],events:[{id:'late_init',personProtocol:'person-core/v1',epistemic:'world',sourceRevisionIds:[extra.id,...original.sources.map(s=>s.sourceRevisionId)],payload:{kind:'state_change',subjectId:'erin',key:'voice',after:{protocol:'person-core/v1',operation:'init',fieldId:'late_voice',kind:'voice',value:'Late definition',policy:'stable',previousEventId:null,causeEventIds:[original.id],note:'Second initialization'}}}]}),'invalid_record')
  } finally {await f.close()}
})

test('raw canonical person protocols cannot introduce entities outside the configured registry', async () => {
  const f=await setup()
  try {
    for(const [key,actor,subject] of [['unknown_origin','outsider','outsider'],['unknown_field','erin','outsider']]) {
      const ctl=await f.controlSource(key),before=await f.fence(),originId=key+'_origin'
      const result=await f.canonical.applyControl(f.authority,ctl,{kind:'accept',idempotencyKey:key,expected:before,sourceRevisionIds:[ctl.id],events:[
        {id:originId,personProtocol:'person-origin/v1',epistemic:'world',payload:{kind:'occurrence',actorIds:[actor],description:'Explicit person origin'}},
        {id:key+'_field',personProtocol:'person-core/v1',epistemic:'world',payload:{kind:'state_change',subjectId:subject,key:'identity',after:{protocol:'person-core/v1',operation:'init',fieldId:'name',kind:'identity',value:'Unknown person',policy:'stable',previousEventId:null,causeEventIds:[originId],note:'Explicit initial field'}}}
      ]})
      deny(result,'scope_denied')
      assert.deepEqual(await f.fence(),before)
      assert.equal(must(await f.store.readEvents(f.authority)).length,0)
    }
    await create(f)
    assert.equal(must(await f.person.read(f.authority,'erin')).fields.find(field=>field.fieldId==='name').value,'林澈')
  } finally {await f.close()}
})
