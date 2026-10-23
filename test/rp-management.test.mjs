import test from 'node:test'
import assert from 'node:assert/strict'
import {setup,must} from './fixtures/rp/growth.mjs'
const draft={schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'},{fieldId:'care',kind:'trait',value:'谨慎',policy:'growable'}],relationships:[],goals:[]}
async function perform(m,action,payload){const snapshot=await m.snapshot(),p=await m.prepare({snapshotId:snapshot.id,action,payload});return m.confirm(p.id)}
test('management requires original review, uses explicit writes, and shares person growth history',async()=>{
 const f=await setup();try{
  assert.ok(f.management,'management service missing');const m=f.management.create(f.authority)
  await perform(m,'create',draft);const s=await m.snapshot();assert.equal(s.persons[0].fields.find(f=>f.fieldId==='name').value,'林澈')
  const p=await m.prepare({snapshotId:s.id,action:'edit',payload:{personId:'erin',fieldId:'name',value:'林川',note:'改名'}})
  assert.equal(must(await f.person.read(f.authority,'erin')).fields.find(f=>f.fieldId==='name').value,'林澈')
  await assert.rejects(m.confirm('invented'));await m.confirm(p.id);await m.confirm(p.id)
  assert.equal((await m.snapshot()).persons[0].fields.find(f=>f.fieldId==='name').value,'林川')
  const cause=await f.experience('rescue','救援'),current=must(await f.person.read(f.authority,'erin')).fields.find(f=>f.fieldId==='care')
  await perform(m,'propose',{changes:[{changeId:'care',personId:'erin',fieldId:'care',previousEventId:current.eventId,value:'信任',causeEventIds:[cause],note:'经历'}]})
  const candidate=(await m.snapshot()).candidates[0];await perform(m,'adopt',{candidateIds:[candidate.id]})
  assert.equal((await m.snapshot()).persons[0].fields.find(f=>f.fieldId==='care').value,'信任')
 }finally{await f.close()}
})
test('management refuses stale snapshots, request mutation, forged actions and revoked capabilities',async()=>{
 const f=await setup();try{
  assert.ok(f.management);let active=true;const m=f.management.create(f.authority,()=>active)
  await perform(m,'create',draft);const s=await m.snapshot(),input={snapshotId:s.id,action:'edit',payload:{personId:'erin',fieldId:'name',value:'原提案',note:'明确修改'}}
  const p=await m.prepare(input);input.payload.value='篡改';await m.confirm(p.id);assert.equal((await m.snapshot()).persons[0].fields.find(f=>f.fieldId==='name').value,'原提案')
  await assert.rejects(m.prepare({...input,action:'input'}));await assert.rejects(m.prepare({...input,action:'edit'}),/changed|stale/i)
  const current=await m.snapshot(),review=await m.prepare({snapshotId:current.id,action:'edit',payload:{personId:'erin',fieldId:'name',value:'迟到',note:'旧视图'}})
  await f.experience('other','另一条经历');await assert.rejects(m.confirm(review.id),/changed|stale/i)
  active=false;await assert.rejects(m.snapshot(),/revoked/i);m.revoke();await assert.rejects(m.confirm(p.id),/revoked/i)
 }finally{await f.close()}
})
test('management snapshots cannot be rewritten by their caller',async()=>{
 const f=await setup();try{const m=f.management.create(f.authority);await perform(m,'create',draft);const s=await m.snapshot();await f.experience('advance','变化');Object.assign(s.fence,await f.fence());await assert.rejects(m.prepare({snapshotId:s.id,action:'edit',payload:{personId:'erin',fieldId:'name',value:'旧页面',note:'旧'}}),/changed|stale/i)}finally{await f.close()}
})
test('revocation during commit preparation prevents publication',async()=>{
 const f=await setup(),proto=Object.getPrototypeOf(f.store),original=proto.commit;let release,enter;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r)
 try{
  const m=f.management.create(f.authority);await perform(m,'create',draft);const s=await m.snapshot(),p=await m.prepare({snapshotId:s.id,action:'edit',payload:{personId:'erin',fieldId:'name',value:'撤权后',note:'测试'}})
  let pause=true;proto.commit=async function(...args){if(pause){pause=false;enter();await gate}return original.apply(this,args)}
  const result=m.confirm(p.id);await entered;m.revoke();release();await assert.rejects(result)
  assert.equal(must(await f.person.read(f.authority,'erin')).fields.find(f=>f.fieldId==='name').value,'林澈')
 }finally{release?.();proto.commit=original;await f.close()}
})
test('a lost receipt can recover its original management review key',async()=>{
 const f=await setup(),proto=Object.getPrototypeOf(f.store),original=proto.commit
 try{const n=f.management.create(f.authority);await perform(n,'create',draft);const sn=await n.snapshot(),pn=await n.prepare({snapshotId:sn.id,action:'edit',payload:{personId:'erin',fieldId:'name',value:'恢复',note:'测试'}})
  let lose=true;proto.commit=async function(...args){const r=await original.apply(this,args);if(lose&&r.ok){lose=false;return {ok:false,code:'persistence_uncertain',message:'receipt lost'}}return r}
  await assert.rejects(n.confirm(pn.id));await n.confirm(pn.id);assert.equal(must(await f.person.read(f.authority,'erin')).fields.find(f=>f.fieldId==='name').value,'恢复')
 }finally{proto.commit=original;await f.close()}
})
test('a second writer cannot rebase an old management proposal during control observation',async()=>{
 const f=await setup(),other=await setup(f.directory,f.request),proto=Object.getPrototypeOf(f.store),original=proto.observeSource
 try{const m=f.management.create(f.authority);await perform(m,'create',draft);const cause=await f.experience('cause','经历'),s=await m.snapshot(),field=s.persons[0].fields.find(f=>f.fieldId==='care')
  const p=await m.prepare({snapshotId:s.id,action:'propose',payload:{changes:[{changeId:'care',personId:'erin',fieldId:'care',previousEventId:field.eventId,value:'信任',causeEventIds:[cause],note:'原因'}]}})
  let once=true;proto.observeSource=async function(...args){const r=await original.apply(this,args);if(once){once=false;await other.experience('concurrent','并发新经历')}return r}
  await assert.rejects(m.confirm(p.id),/changed|stale/i);assert.equal(must(await f.person.list(f.authority)).length,0)
 }finally{proto.observeSource=original;await other.close();await f.close()}
})
