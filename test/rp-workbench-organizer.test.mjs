import test from 'node:test'
import assert from 'node:assert/strict'
import {setup,must} from './fixtures/rp/growth.mjs'

async function accepted(f,key,text){
 const s=must(await f.store.observeSource(f.authority,{idempotencyKey:key,origin:'host_public',role:'user',publicText:text,turnId:key,host:{sessionId:f.request.sessionId,eventSeq:1,messageId:'m_'+key,messageRevision:'r_'+key}}))
 must(await f.canonical.applyControl(f.authority,await f.controlSource('accept_'+key),{kind:'accept',sourceRevisionIds:[s.id],events:[],idempotencyKey:'accept_'+key,expected:await f.fence()}));return s
}
test('workbench organizer is explicit, snapshot-bound, idempotent and separate from summary adoption',async()=>{
 const f=await setup();try{
  await accepted(f,'promise','周五一起去看星星。');const c=f.management.create(f.authority),s=await c.snapshot(),before=await f.fence()
  assert.equal(typeof c.organize,'function')
  const input={snapshotId:s.id,operation:'summary'},a=await c.organize(input),b=await c.organize(input)
  assert.equal(a.id,b.id);assert.deepEqual(await f.fence(),before);assert.equal(must(await f.store.readSummaries(f.authority)).length,0)
  const candidate=await c.organize({snapshotId:s.id,operation:'candidate',candidateId:a.id});assert.match(candidate.proposedSummary.text,/周五一起去看星星/)
  const p=await c.prepare({snapshotId:s.id,action:'summary-adopt',payload:{candidateId:a.id}})
  assert.equal(must(await f.store.readSummaries(f.authority)).length,0)
  await Promise.race([c.confirm(p.id),new Promise((_,reject)=>setTimeout(()=>reject(Error('nested coordinator deadlock')),4000).unref())])
  assert.equal(must(await f.store.readSummaries(f.authority)).length,1);await c.confirm(p.id);assert.equal(must(await f.store.readSummaries(f.authority)).length,1)
  await assert.rejects(c.organize({snapshotId:s.id,operation:'handoff'}),e=>e.code==='stale_input')
  c.revoke();await assert.rejects(c.organize(input),e=>e.code==='ownership_lost')
 }finally{await f.close()}
})
test('workbench organizer refuses missing management authority and unknown operations',async()=>{
 const f=await setup();try{
  const a=must(await f.control.authorize({...f.request,permissions:['read','observe','commit']})),c=f.management.create(a)
  assert.equal(typeof c.organize,'function');await assert.rejects(c.organize({snapshotId:'forged',operation:'summary'}))
  const m=f.management.create(f.authority),s=await m.snapshot();await assert.rejects(m.organize({snapshotId:s.id,operation:'auto'}))
  const report=await m.organize({snapshotId:s.id,operation:'handoff'});assert.equal(report.modelCalls,0);assert.equal(report.kind,'continuity-handoff')
 }finally{await f.close()}
})
test('document reparsing offers previous conditions by unique section match without adopting them',async()=>{
 const f=await setup();try{
  const person=must(await f.person.preview(f.authority,{schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]},'person'));must(await f.person.confirm(f.authority,person.handle,await f.controlSource('person')))
  const c=f.management.create(f.authority),upload=text=>({personId:'erin',documentId:'life',title:'人生',mime:'text/markdown',encoding:'utf8',base64:Buffer.from(text).toString('base64')})
  const u=await c.upload(upload('# 语气\n温和而直接。')),s=await c.snapshot(),p=await c.prepare({snapshotId:s.id,action:'document-import',payload:{uploadId:u.id,policies:u.draft.sections.map(s=>({sectionId:s.sectionId,category:'persona',label:'语气',tags:[],enabled:true,when:{kind:'direct'}}))}})
  await c.confirm(p.id);const prior=await c.read({kind:'document',personId:'erin',id:'life'}),before=await f.fence()
  const next=await c.upload({...upload('# 语气\n温和而直接，也会开玩笑。'),previousEventId:prior.eventId})
  assert.ok(next.revisionReview);assert.equal(next.revisionReview.requiresConfirmation,true);assert.equal(next.revisionReview.matches[0].textChanged,true)
  assert.equal(next.revisionReview.matches[0].suggestedPolicy.when.kind,'direct');assert.deepEqual(await f.fence(),before)
  const again=await c.read({kind:'document',personId:'erin',id:'life'});assert.equal(again.draft.text,prior.draft.text)
 }finally{await f.close()}
})
