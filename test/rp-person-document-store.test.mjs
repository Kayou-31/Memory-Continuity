import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {setup,must,deny,api} from './fixtures/rp/growth.mjs'

async function person(f){
 const p=must(await f.person.preview(f.authority,{schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]},'person'))
 must(await f.person.confirm(f.authority,p.handle,await f.controlSource('person')))
}
const draft=text=>api.importPersonDocument({documentId:'life_notes',personId:'erin',title:'完整人物',format:'markdown',text})
const service=f=>{assert.equal(typeof f.documents?.preview,'function','document persistence service must exist');return f.documents}
async function save(f,text,key='create',previousEventId){
 const d=service(f),p=must(await d.preview(f.authority,{draft:draft(text),...(previousEventId?{previousEventId}:{})},key))
 return must(await d.confirm(f.authority,p.handle,await f.controlSource(key)))
}

test('document publication stores exact original, declares the capability and preserves one accepted revision across reopen',async()=>{
 const f=await setup();let cold
 try{
  const d=service(f);await person(f)
  const text='\ufeff# 身份\r\n'+ '完整人物😀\r\n'.repeat(14000)
  const made=await save(f,text),actual=must(await d.read(f.authority,'erin','life_notes'))
  assert.equal(actual.draft.text,text);assert.equal(actual.eventId,made.eventId)
  const ws=path.join(f.directory,'profile/.dsh-rp/v1/workspaces',f.request.workspaceId)
  const names=(await fs.readdir(path.join(ws,'commits'))).sort(),last=JSON.parse(await fs.readFile(path.join(ws,'commits',names.at(-1)),'utf8'))
  assert.ok(last.transaction.requiredCapabilities.includes('rp.person-documents/v1'))
  const backups=await fs.readdir(path.join(f.directory,'profile/.dsh-rp/v1/backups',f.request.workspaceId));assert.equal(backups.length,2)
  await f.close();cold=await setup(f.directory,f.request)
  assert.equal(must(await cold.documents.read(cold.authority,'erin','life_notes')).draft.text,text)
 }finally{await cold?.close();await f.close()}
})

test('backup and transaction publication faults preserve the prior readable state and allow retry',async()=>{
 const f=await setup(),mkdir=fs.mkdir,rename=fs.rename
 try{
  await person(f)
  const d=service(f),p=must(await d.preview(f.authority,{draft:draft('保留的原文')},'backup')),ctl=await f.controlSource('backup'),before=await f.fence()
  fs.mkdir=async(...args)=>{if(String(args[0]).includes(path.sep+'backups'+path.sep))throw Object.assign(new Error('document backup fault'),{code:'EIO'});return mkdir(...args)}
  const failed=await d.confirm(f.authority,p.handle,ctl);fs.mkdir=mkdir
  deny(failed,'persistence_failed');assert.deepEqual(await f.fence(),before)
  deny(await d.read(f.authority,'erin','life_notes'),'source_unavailable')
  const first=must(await d.confirm(f.authority,p.handle,ctl))
  const next=must(await d.preview(f.authority,{draft:draft('尚未发布的修订'),previousEventId:first.eventId},'next')),nextCtl=await f.controlSource('next'),oldFence=await f.fence()
  fs.rename=async(...args)=>{if(String(args[1]).includes(path.sep+'commits'+path.sep)&&(await fs.readFile(args[0],'utf8')).includes('person_document'))throw Object.assign(new Error('document publish fault'),{code:'EIO'});return rename(...args)}
  const interrupted=await d.confirm(f.authority,next.handle,nextCtl);fs.rename=rename
  deny(interrupted,'persistence_failed');assert.deepEqual(await f.fence(),oldFence)
  assert.equal(must(await d.read(f.authority,'erin','life_notes')).draft.text,'保留的原文')
  must(await d.confirm(f.authority,next.handle,nextCtl))
  assert.equal(must(await d.read(f.authority,'erin','life_notes')).draft.text,'尚未发布的修订')
 }finally{fs.mkdir=mkdir;fs.rename=rename;await f.close()}
})

test('retcon never revives an old document, fixed child remains independent, privacy blocks both',async()=>{
 const f=await setup()
 try{
  await person(f);const first=await save(f,'第一版','first'),second=await save(f,'PRIVATE_LATEST','second',first.eventId)
  const original=must(await f.store.readEvents(f.authority)).find(e=>e.id===second.eventId),sourceId=original.payload.value.manifest.sourceRevisionId
  const prefix=must(await f.canonical.forkManifest(f.authority,(await f.fence()).contextRevision)),child=must(await f.canonical.forkBranch(f.authority,{...prefix,idempotencyKey:'child'})),other=must(await f.control.authorize({...f.request,branchId:child.id}))
  must(await f.canonical.applyControl(f.authority,await f.controlSource('retcon'),{kind:'retcon',idempotencyKey:'retcon',expected:await f.fence(),targetEventIds:[second.eventId],events:[]}))
  deny(await f.documents.read(f.authority,'erin','life_notes'),'source_unavailable')
  assert.ok(must(await f.store.readEvents(f.authority)).some(e=>e.id===first.eventId))
  assert.equal(must(await f.documents.read(other,'erin','life_notes')).draft.text,'PRIVATE_LATEST')
  must(await f.canonical.applyControl(f.authority,await f.controlSource('privacy'),{kind:'privacy_delete',idempotencyKey:'privacy',expected:await f.fence(),sourceRevisionIds:[sourceId],affectedBranchIds:[f.request.branchId,child.id]},[f.authority,other]))
  deny(await f.documents.read(f.authority,'erin','life_notes'),'source_unavailable');deny(await f.documents.read(other,'erin','life_notes'),'source_unavailable')
 }finally{await f.close()}
})

test('raw canonical and store routes cannot bypass document markers, hashes or current version',async()=>{
 const f=await setup()
 try{
  await person(f);const made=await save(f,'原文','first'),e=must(await f.store.readEvents(f.authority)).find(e=>e.id===made.eventId)
  const control=await f.controlSource('bypass'),expected=await f.fence()
  const raw={...e,id:'document_forged'}
  deny(await f.store.commit(f.authority,{schemaVersion:1,idempotencyKey:'raw',expected,nextContextRevision:expected.contextRevision+1,sourceBindings:[],events:[raw],summaries:[],jobs:[],invalidatedIds:[],authorityChanges:[]}),'scope_denied')
  for(const mode of ['unmarked','hash','predecessor','world']){
   const value=structuredClone(e.payload.value);value.operation='revise';value.previousEventId=e.id
   if(mode==='hash')value.manifest.chunks[0].sha256='0'.repeat(64)
   if(mode==='predecessor')value.previousEventId='missing'
   const result=await f.canonical.applyControl(f.authority,control,{kind:'accept',idempotencyKey:mode,expected,sourceRevisionIds:[value.manifest.sourceRevisionId],events:[{id:'bypass_'+mode,...(mode==='unmarked'?{}:{personProtocol:'person-document/v1'}),epistemic:mode==='world'?'world':'utterance',payload:{kind:'person_document',value}}]})
   deny(result,mode==='unmarked'?'scope_denied':'invalid_record')
  }
  assert.deepEqual(await f.fence(),expected);assert.equal(must(await f.documents.read(f.authority,'erin','life_notes')).draft.text,'原文')
 }finally{await f.close()}
})

test('document preview rejects forged, cross-authority, unknown owner and stale confirmations',async()=>{
 const f=await setup();try{
  const d=service(f);await person(f)
  const first=must(await d.preview(f.authority,{draft:draft('初始原文')},'first'))
  deny(await d.confirm(f.authority,{},await f.controlSource('forged')),'scope_denied')
  const other=must(await f.control.authorize(f.request))
  deny(await d.confirm(other,first.handle,await f.controlSource('cross')),'scope_denied')
  const bad=draft('文本');bad.chunks[0].sha256='0'.repeat(64)
  deny(await d.preview(f.authority,{draft:bad},'bad'),'invalid_record')
  const unknown={...draft('未注册'),personId:'unknown'}
  deny(await d.preview(f.authority,{draft:unknown},'unknown'),'scope_denied')
  await f.experience('changed','剧情已变化')
  deny(await d.confirm(f.authority,first.handle,await f.controlSource('stale')),'stale_input')
  assert.equal(must(await f.store.readEvents(f.authority)).filter(e=>e.payload.kind==='person_document').length,0)
 }finally{await f.close()}
})

test('revision and explicit withdrawal preserve original evidence without reviving old document text',async()=>{
 const f=await setup();try{
  const d=service(f);await person(f)
  const first=await save(f,'# 语气\n最初说法','first'),second=await save(f,'# 语气\n新的表达','second',first.eventId)
  assert.equal(must(await d.read(f.authority,'erin','life_notes')).draft.text,'# 语气\n新的表达')
  const events=must(await f.store.readEvents(f.authority));assert.ok(events.some(e=>e.id===first.eventId))
  const withdrawn=must(await d.retract(f.authority,await f.controlSource('withdraw'),{personId:'erin',documentId:'life_notes',previousEventId:second.eventId,expected:await f.fence(),idempotencyKey:'withdraw'}))
  const read=must(await d.read(f.authority,'erin','life_notes'));assert.equal(read.status,'withdrawn');assert.equal(read.draft,null);assert.equal(read.eventId,withdrawn.eventId)
  assert.ok(must(await f.store.readEvents(f.authority)).some(e=>e.id===first.eventId))
 }finally{await f.close()}
})

test('repeated confirmation and a fresh service retry return the original publication without another version',async()=>{
 const f=await setup();let cold
 try{
  const d=service(f);await person(f)
  const p=must(await d.preview(f.authority,{draft:draft('同一个原文')},'once')),ctl=await f.controlSource('once')
  const made=must(await d.confirm(f.authority,p.handle,ctl)),before=await f.fence()
  assert.deepEqual(must(await d.confirm(f.authority,p.handle,ctl)),made)
  await f.close();cold=await setup(f.directory,f.request)
  const retry=must(await cold.documents.preview(cold.authority,{draft:draft('同一个原文')},'once'))
  assert.deepEqual(must(await cold.documents.confirm(cold.authority,retry.handle,ctl)),made)
  assert.deepEqual(await cold.fence(),before)
  deny(await cold.documents.preview(cold.authority,{draft:draft('另一个原文')},'once'),'idempotency_conflict')
 }finally{await cold?.close();await f.close()}
})
