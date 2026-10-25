import test from 'node:test'
import assert from 'node:assert/strict'
import {setup,must} from './fixtures/rp/growth.mjs'
const person={schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]}
async function ready(){const f=await setup(),p=must(await f.person.preview(f.authority,person,'person'));must(await f.person.confirm(f.authority,p.handle,await f.controlSource('person')));return f}
async function review(m,action,payload){return m.prepare({snapshotId:(await m.snapshot()).id,action,payload})}
const upload=(m,text,extra={})=>m.upload({personId:'erin',documentId:'notes',title:'人物原文',mime:'text/markdown',encoding:'utf8',base64:Buffer.from(text).toString('base64'),...extra})

test('large document upload is ephemeral, preserves unknown sections, and confirms/reopens exactly',async()=>{
 const f=await ready();try{const m=f.management.create(f.authority),text='# 未知分类\n'+'完整资料🐉。'.repeat(7000),before=await f.fence(),u=await upload(m,text)
  assert.equal(u.draft.text,text);assert.equal(u.draft.sections[0].category,'unclassified');assert.deepEqual(await f.fence(),before)
  const cancelled=await upload(m,'取消的原文');await m.discardUpload(cancelled.id);await assert.rejects(review(m,'document-import',{uploadId:cancelled.id}))
  const p=await review(m,'document-import',{uploadId:u.id});assert.match(p.impact.title,/资料/);assert.equal((await m.snapshot()).documents.length,0)
  await m.confirm(p.id);await m.confirm(p.id);const saved=await m.read({kind:'document',personId:'erin',id:'notes'});assert.equal(saved.draft.text,text)
  const changed=text.slice(0,-1)+'！',u2=await upload(m,changed,{previousEventId:saved.eventId}),p2=await review(m,'document-import',{uploadId:u2.id})
  assert.notEqual(p2.payload.sha256,saved.draft.sha256);assert.equal(p2.payload.text,changed);await m.confirm(p2.id)
  const cold=await setup(f.directory,f.request);try{assert.equal((await cold.management.create(cold.authority).read({kind:'document',personId:'erin',id:'notes'})).draft.text,changed)}finally{await cold.close()}
 }finally{await f.close()}
})

test('uploads reject bad encoding/type/size, stale or cross-controller handles and expire',async()=>{
 const f=await ready();try{const m=f.management.create(f.authority)
  await assert.rejects(upload(m,'abc',{mime:'text/html'}));await assert.rejects(upload(m,'abc',{base64:'/w=='}));await assert.rejects(upload(m,'x'.repeat(1048577)))
  const u=await upload(m,'original');await assert.rejects(review(f.management.create(f.authority),'document-import',{uploadId:u.id}))
  const now=Date.now;try{Date.now=()=>now()+600001;await assert.rejects(review(m,'document-import',{uploadId:u.id}),/expired|过期/)}finally{Date.now=now}
  const stale=await upload(m,'stale');await f.experience('advance','并发变化');await assert.rejects(review(m,'document-import',{uploadId:stale.id}),/changed|stale/)
 }finally{await f.close()}
})

test('influence preference defaults on, changes only on explicit save, persists and never weakens authorization',async()=>{
 const f=await ready();try{const m=f.management.create(f.authority);assert.equal((await m.snapshot()).preferences.impactConfirmation,true)
  const r=await review(m,'settings',{impactConfirmation:false});assert.equal((await m.snapshot()).preferences.impactConfirmation,true);await m.confirm(r.id)
  const other=await setup(f.directory,f.request);try{assert.equal((await other.management.create(other.authority).snapshot()).preferences.impactConfirmation,false)}finally{await other.close()}
  const edit=await review(m,'edit',{personId:'erin',fieldId:'name',value:'新的名字',note:'明确修改'});assert.equal(edit.showImpactDialog,false);assert.ok(edit.impact.changes.length);assert.equal(must(await f.person.read(f.authority,'erin')).fields[0].value,'林澈')
  await f.experience('race','校验仍然有效');await assert.rejects(m.confirm(edit.id),/changed|stale/)
  const narrow=must(await f.control.authorize({...f.request,permissions:['read','commit']}));await assert.rejects(f.management.create(narrow).snapshot(),e=>e.code==='scope_denied')
 }finally{await f.close()}
})

test('human diary management keeps authors/revisions and produces impacts for policy, edits and deletion',async()=>{
 const f=await ready();try{const m=f.management.create(f.authority),access={personId:'erin',boardId:'shared'}
  const policy=await review(m,'diary-configure',{personId:'erin',allowAgentWrite:true});assert.match(policy.impact.title,/日记/);await m.confirm(policy.id)
  const cause=await f.experience('chat','今天聊了星空'),sources=must(await f.store.readEvents(f.authority)).find(e=>e.id===cause).sources.map(s=>s.sourceRevisionId)
  const writer=must(await f.diary.writer(f.authority,access));must(await writer.write({entryId:'ai_day',title:'星空',body:'AI原稿'},{sessionId:f.request.sessionId,callId:'call_one',key:'one',sourceRevisionIds:sources}))
  const saved=await m.read({kind:'diary',personId:'erin',id:'ai_day'}),edit=await review(m,'diary-write',{personId:'erin',draft:{entryId:'ai_day',title:'星空',body:'人类补充',previousEventId:saved.eventId}})
  assert.match(edit.impact.history,/AI|作者/);await m.confirm(edit.id);const next=await m.read({kind:'diary',personId:'erin',id:'ai_day'});assert.equal(next.author,'agent');assert.equal(next.editor,'human')
  const history=await m.read({kind:'diary-history',personId:'erin',id:'ai_day'});assert.equal(history.length,2);assert.equal(history[0].draft.body,'AI原稿')
  const del=await review(m,'diary-delete',{personId:'erin',entryId:'ai_day'});assert.equal(del.impact.mandatory,true);await m.confirm(del.id);await assert.rejects(m.read({kind:'diary',personId:'erin',id:'ai_day'}))
 }finally{await f.close()}
})
