import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {setup,must,deny,api} from './fixtures/rp/growth.mjs'
import {createHash} from 'node:crypto'
async function person(f){const p=must(await f.person.preview(f.authority,{schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]},'person'));must(await f.person.confirm(f.authority,p.handle,await f.controlSource('person')))}
const service=f=>{assert.equal(typeof f.diary?.configure,'function','shared diary service must exist');return f.diary}
async function configure(f,enabled,key='enable',previousEventId){return must(await service(f).configure(f.authority,await f.controlSource(key),{boardId:'shared',personId:'erin',humanId:'local_user',allowAgentWrite:enabled,audiences:[{kind:'local'}],...(previousEventId?{previousEventId}:{}),expected:await f.fence(),idempotencyKey:key}))}
const draft=(body,previousEventId)=>({entryId:'today',title:'今天',body,...(previousEventId?{previousEventId}:{})})
async function execution(f,key){const e=await f.experience('input_'+key,'今天聊过星空'),event=must(await f.store.readEvents(f.authority)).find(x=>x.id===e);return {sessionId:f.request.sessionId,callId:'call_'+key,sourceRevisionIds:event.sources.map(s=>s.sourceRevisionId),key}}
test('AI diary writer is disabled by default, explicit enable allows a write without per-entry human control, disable revokes it',async()=>{
 const f=await setup();try{
  const d=service(f);await person(f)
  deny(await d.writer(f.authority,{personId:'erin',boardId:'shared'}),'scope_denied')
  const enabled=await configure(f,true),writer=must(await d.writer(f.authority,{personId:'erin',boardId:'shared'})),exec=await execution(f,'first'),before=must(await f.store.readLedger(f.authority)).sources.filter(s=>s.origin==='user_control').length
  const made=must(await writer.write(draft('我今天很喜欢这段讨论。'),exec)),read=must(await d.read(f.authority,{personId:'erin',boardId:'shared',entryId:'today'}))
  assert.equal(read.author,'agent');assert.equal(read.editor,'agent');assert.equal(read.draft.body,'我今天很喜欢这段讨论。');assert.equal(read.eventId,made.eventId)
  assert.equal(must(await f.store.readLedger(f.authority)).sources.filter(s=>s.origin==='user_control').length,before)
  assert.ok(must(await f.store.readLedger(f.authority)).sources.some(s=>s.origin==='agent_diary'))
  const disabled=await configure(f,false,'disable',enabled.eventId)
  deny(await writer.write({...draft('不允许'),entryId:'later'},exec),'scope_denied')
  assert.equal(must(await d.read(f.authority,{personId:'erin',boardId:'shared',entryId:'today'})).eventId,made.eventId)
  await configure(f,true,'reenable',disabled.eventId)
  deny(await writer.write({...draft('旧权限不能复活'),entryId:'later'},await execution(f,'old_grant')),'scope_denied')
 }finally{await f.close()}
})
test('AI cannot forge an author or rewrite human entries; human edits preserve AI authorship and originals',async()=>{
 const f=await setup();try{
  const d=service(f);await person(f);await configure(f,true);const writer=must(await d.writer(f.authority,{personId:'erin',boardId:'shared'})),exec=await execution(f,'actor')
  deny(await writer.write({...draft('伪造'),author:'human'},exec))
  const human=must(await d.writeHuman(f.authority,await f.controlSource('human'),{personId:'erin',boardId:'shared',draft:draft('今天和AI的相处很开心'),expected:await f.fence(),idempotencyKey:'human'}))
  deny(await writer.write(draft('覆盖用户',human.eventId),exec),'scope_denied')
  const ai=must(await writer.write({...draft('AI原稿'),entryId:'ai_page'},exec))
  const edited=must(await d.writeHuman(f.authority,await f.controlSource('edit'),{personId:'erin',boardId:'shared',draft:{...draft('人类修订',ai.eventId),entryId:'ai_page'},expected:await f.fence(),idempotencyKey:'edit'}))
  const read=must(await d.read(f.authority,{personId:'erin',boardId:'shared',entryId:'ai_page'}));assert.equal(read.author,'agent');assert.equal(read.editor,'human');assert.equal(read.eventId,edited.eventId)
  const history=must(await d.history(f.authority,{personId:'erin',boardId:'shared',entryId:'ai_page'}));assert.equal(history.length,2);assert.equal(history[0].draft.body,'AI原稿')
 }finally{await f.close()}
})
test('live owner revocation, stale revisions and repeated writes fail safely; cold retry does not create duplicates',async()=>{
 const f=await setup();let cold,live=true
 try{
  const d=service(f);await person(f);await configure(f,true);const exec=await execution(f,'retry'),writer=must(await d.writer(f.authority,{personId:'erin',boardId:'shared'},()=>live)),first=must(await writer.write(draft('最初'),exec)),before=await f.fence()
  assert.deepEqual(must(await writer.write(draft('最初'),exec)),first);assert.deepEqual(await f.fence(),before)
  deny(await writer.write(draft('不同'),exec),'idempotency_conflict')
  live=false;deny(await writer.write({...draft('撤权后'),entryId:'later'},exec),'ownership_lost');live=true
  const second=must(await writer.write(draft('修订',first.eventId),await execution(f,'revision')))
  deny(await writer.write(draft('旧预览',first.eventId),await execution(f,'stale')),'stale_input')
  await f.close();cold=await setup(f.directory,f.request)
  const retry=must(await cold.diary.writer(cold.authority,{personId:'erin',boardId:'shared'}));assert.deepEqual(must(await retry.write(draft('最初'),exec)),first)
  assert.equal(must(await cold.diary.read(cold.authority,{personId:'erin',boardId:'shared',entryId:'today'})).eventId,second.eventId)
 }finally{await cold?.close();await f.close()}
})
test('optional reflection authenticates exact event revision and quote; unrelated people and groups cannot read the shared diary',async()=>{
 const f=await setup();try{
  const d=service(f);await person(f);await configure(f,true);const exec=await execution(f,'evidence'),writer=must(await d.writer(f.authority,{personId:'erin',boardId:'shared'}))
  const e=must(await f.store.readEvents(f.authority)).find(e=>e.sources.some(s=>exec.sourceRevisionIds.includes(s.sourceRevisionId))&&e.payload.kind==='occurrence')
  const {createHash}=await import('node:crypto'),hash=v=>createHash('sha256').update(v).digest('hex'),revision=hash((await import('./fixtures/rp/growth.mjs')).api.canonical(e))
  const input={...draft('我当时猜她喜欢星空。'),reflection:{understanding:'可能喜欢星空',uncertainty:'还需要询问',evidence:[{eventId:e.id,revision,span:e.sources[0]}]}}
  const made=must(await writer.write(input,exec))
  deny(await writer.write({...input,entryId:'bad',reflection:{evidence:[{eventId:e.id,revision:'0'.repeat(64),span:e.sources[0]}]}},{...exec,key:'bad',callId:'call_bad'}),'source_unavailable')
  deny(await writer.write({...input,entryId:'bad_quote',reflection:{evidence:[{eventId:e.id,revision,span:{...e.sources[0],publicTextSha256:'0'.repeat(64)}}]}},{...exec,key:'bad_quote',callId:'call_bad_quote'}))
  const group=f.audiences.create(f.authority,{platform:'qq',accountId:'bot',kind:'group',groupId:'group',senderId:'user'})
  deny(await d.read(f.authority,{personId:'erin',boardId:'shared',entryId:'today'},group.context()),'scope_denied')
  deny(await d.read(f.authority,{personId:'bea',boardId:'shared',entryId:'today'}),'scope_denied')
  assert.equal(must(await d.read(f.authority,{personId:'erin',boardId:'shared',entryId:'today'})).eventId,made.eventId)
  const projection=must(await f.store.replayProjection(f.authority));assert.ok(!JSON.stringify(projection).includes('可能喜欢星空'))
 }finally{await f.close()}
})

test('raw callers cannot forge AI diary sources or semantic publication without live writer admission',async()=>{
 const f=await setup();try{
  await person(f);await configure(f,true);const writer=must(await f.diary.writer(f.authority,{personId:'erin',boardId:'shared'})),exec=await execution(f,'forgery')
  const made=must(await writer.write(draft('有授权的原稿'),exec)),event=must(await f.store.readEvents(f.authority)).find(e=>e.id===made.eventId)
  deny(await f.store.observeSource(f.authority,{idempotencyKey:'forged_source',origin:'agent_diary',role:'assistant',publicText:'FORGED',turnId:'forged',host:{sessionId:exec.sessionId,messageId:'fake_call',messageRevision:'fake_revision',eventSeq:0}}),'scope_denied')
  const raw={id:'forged_diary_event',diaryProtocol:'shared-diary/v1',epistemic:'utterance',payload:structuredClone(event.payload)};raw.payload.value.entryId='forged'
  deny(await f.canonical.applyControl(f.authority,await f.controlSource('forged'),{kind:'accept',idempotencyKey:'forged_event',expected:await f.fence(),sourceRevisionIds:event.sources.map(s=>s.sourceRevisionId),events:[raw]}))
  assert.equal(must(await f.diary.list(f.authority,{personId:'erin',boardId:'shared'})).items.length,1)
 }finally{await f.close()}
})

test('revoking the writer while its commit is being prepared prevents publication',async()=>{
 const f=await setup(),open=fs.open;let revoked=false,writer
 try{
  await person(f);await configure(f,true);writer=must(await f.diary.writer(f.authority,{personId:'erin',boardId:'shared'}));const exec=await execution(f,'mid_commit'),before=await f.fence()
  fs.open=async(...args)=>{const h=await open(...args);if(String(args[0]).includes(path.sep+'commits'+path.sep)&&String(args[0]).includes('.tmp-')&&args[1]==='wx'){
    const write=h.writeFile.bind(h);h.writeFile=async(value,...rest)=>{const result=await write(value,...rest);if(String(value).includes('"recordId":"diary_entry_')){revoked=true;writer.revoke()}return result}
  }return h}
  deny(await writer.write(draft('MUST_NOT_PUBLISH'),exec),'ownership_lost');assert.equal(revoked,true)
  fs.open=open;assert.deepEqual(await f.fence(),before);assert.equal(must(await f.diary.list(f.authority,{personId:'erin',boardId:'shared'})).items.length,0)
 }finally{fs.open=open;await f.close()}
})

test('current diary listing excludes superseded text, and privacy deletion purges all versions without removing the source conversation',async()=>{
 const f=await setup();try{
  const d=service(f);await person(f);await configure(f,true);const writer=must(await d.writer(f.authority,{personId:'erin',boardId:'shared'})),exec=await execution(f,'privacy_first')
  const first=must(await writer.write(draft('PRIVATE_OLD_DIARY'),exec)),second=must(await writer.write(draft('PRIVATE_NEW_DIARY',first.eventId),await execution(f,'privacy_second')))
  assert.equal(typeof d.list,'function');const list=must(await d.list(f.authority,{personId:'erin',boardId:'shared',query:'PRIVATE'}));assert.equal(list.items.length,1);assert.equal(list.items[0].eventId,second.eventId);assert.doesNotMatch(JSON.stringify(list),/PRIVATE_OLD_DIARY/)
  const deletion=must(await d.privacyDelete(f.authority,await f.controlSource('privacy_delete'),{personId:'erin',boardId:'shared',entryId:'today',expected:await f.fence(),idempotencyKey:'privacy_delete',affectedBranchIds:[f.request.branchId]}))
  assert.equal(deletion.purgeState,'complete')
  deny(await d.read(f.authority,{personId:'erin',boardId:'shared',entryId:'today'}),'source_unavailable')
  assert.equal(must(await d.history(f.authority,{personId:'erin',boardId:'shared',entryId:'today'})).length,0)
  assert.equal(must(await d.list(f.authority,{personId:'erin',boardId:'shared',query:'PRIVATE'})).items.length,0)
  assert.ok(must(await f.store.readEvents(f.authority)).some(e=>e.sources.some(s=>exec.sourceRevisionIds.includes(s.sourceRevisionId))))
  assert.ok(deletion.externalLimitations.includes('backups_not_managed'))
 }finally{await f.close()}
})

test('memory injection includes current shared diary prose as subjective, and ordinary recall cannot expose archived diary sources',async()=>{
 const f=await setup();try{
  const d=service(f);await person(f);await configure(f,true);const writer=must(await d.writer(f.authority,{personId:'erin',boardId:'shared'})),first=must(await writer.write(draft('星空 OLD_GUESS'),await execution(f,'inject_first')))
  await writer.write({...draft('星空 NEW_GUESS',first.eventId),reflection:{understanding:'可能喜欢星空',uncertainty:'还未确认'}},await execution(f,'inject_second')).then(must)
  const budget={recentCompleteTurns:8,targetTotalTokens:48000,triggerTotalTokens:72000,outputReserveTokens:8192,toolReserveTokens:2048,packetSoftTokens:16000,contextWindow:100000,inputLimit:90000}
  const packet=must(await f.packets.prepare(f.authority,{budget,globalAuthorities:[],inputBindings:[],personId:'erin',injection:{depth:'evidence'},query:'星空'}))
  assert.match(packet.text,/NEW_GUESS/);assert.match(packet.text,/主观日记/);assert.match(packet.text,/还未确认/);assert.doesNotMatch(packet.text,/OLD_GUESS/)
  assert.ok(packet.injection.entries.some(e=>e.kind==='diary'&&e.selected))
  assert.equal(must(await f.retrieval.search(f.authority,{query:'OLD_GUESS'})).items.length,0)
 }finally{await f.close()}
})

test('a fork keeps its original diary revision, unrelated branches have no diary authority, and deletion requires all affected branches',async()=>{
 const f=await setup();try{
  await person(f);await configure(f,true);const d=f.diary,access={personId:'erin',boardId:'shared',entryId:'today'},writer=must(await d.writer(f.authority,access))
  const first=must(await writer.write(draft('FORK_ORIGINAL'),await execution(f,'fork_first')))
  const manifest=must(await f.canonical.forkManifest(f.authority,(await f.fence()).contextRevision)),child=must(await f.canonical.forkBranch(f.authority,{...manifest,idempotencyKey:'diary_child'})),childAuth=must(await f.control.authorize({...f.request,branchId:child.id}))
  const unrelated=must(await f.control.createBranch(f.request.workspaceId,f.request.campaignId)),unrelatedAuth=must(await f.control.authorize({...f.request,branchId:unrelated.id}))
  const second=must(await writer.write(draft('PARENT_REVISION',first.eventId),await execution(f,'fork_second')))
  assert.equal(must(await d.read(f.authority,access)).eventId,second.eventId);assert.equal(must(await d.read(childAuth,access)).eventId,first.eventId)
  deny(await d.read(unrelatedAuth,access),'scope_denied')
  const control=await f.controlSource('all_branch_delete'),input={...access,expected:await f.fence(),idempotencyKey:'diary_delete_forks',affectedBranchIds:[f.request.branchId]}
  deny(await d.privacyDelete(f.authority,control,input))
  assert.equal(must(await d.read(childAuth,access)).eventId,first.eventId)
  must(await d.privacyDelete(f.authority,control,{...input,affectedBranchIds:[f.request.branchId,child.id]},[f.authority,childAuth]))
  deny(await d.read(f.authority,access),'source_unavailable');deny(await d.read(childAuth,access),'source_unavailable')
 }finally{await f.close()}
})

test('correcting an interpretation evidence event invalidates its diary without deleting source history or unrelated diary entries',async()=>{
 const f=await setup();try{
  await person(f);await configure(f,true);const d=f.diary,writer=must(await d.writer(f.authority,{personId:'erin',boardId:'shared'})),exec=await execution(f,'retcon_diary')
  const evidence=must(await f.store.readEvents(f.authority)).find(e=>e.payload.kind==='occurrence'&&e.sources.some(s=>exec.sourceRevisionIds.includes(s.sourceRevisionId))),revision=createHash('sha256').update(api.canonical(evidence)).digest('hex')
  const dependent=must(await writer.write({...draft('RETRACTED_INTERPRETATION'),reflection:{understanding:'依据这次谈话得出的猜测',evidence:[{eventId:evidence.id,revision,span:evidence.sources[0]}]}},exec))
  const independent=must(await writer.write({...draft('INDEPENDENT_DIARY'),entryId:'unrelated'},await execution(f,'independent')))
  must(await f.canonical.applyControl(f.authority,await f.controlSource('retcon_interpretation'),{kind:'retcon',idempotencyKey:'retcon_interpretation',expected:await f.fence(),targetEventIds:[evidence.id],events:[]}))
  deny(await d.read(f.authority,{personId:'erin',boardId:'shared',entryId:'today'}),'source_unavailable')
  const list=must(await d.list(f.authority,{personId:'erin',boardId:'shared'}));assert.ok(!list.items.some(e=>e.eventId===dependent.eventId));assert.ok(list.items.some(e=>e.eventId===independent.eventId))
  assert.ok(must(await f.store.readAcceptedSources(f.authority)).some(s=>exec.sourceRevisionIds.includes(s.id)))
 }finally{await f.close()}
})
