import test from 'node:test'
import assert from 'node:assert/strict'
import {setup,must,deny} from './fixtures/rp/growth.mjs'
const budget={recentCompleteTurns:8,targetTotalTokens:48000,triggerTotalTokens:72000,outputReserveTokens:8192,toolReserveTokens:2048,packetSoftTokens:16000,contextWindow:100000,inputLimit:90000}
const draft=(injection)=>({schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'},{fieldId:'curiosity',kind:'trait',value:'CORE_CURIOUS 温柔而好奇，愿意自己提出不同看法。',policy:'growable',...(injection?{injection}:{})},{fieldId:'history',kind:'background',value:'UNRELATED_HISTORY 旧城的一场远行。',policy:'stable'}],relationships:[],goals:[]})
async function create(f,d){const p=must(await f.person.preview(f.authority,d,'create'));must(await f.person.confirm(f.authority,p.handle,await f.controlSource('create')))}
const prepare=(f,query,injection={})=>f.packets.prepare(f.authority,{budget,globalAuthorities:[],inputBindings:[],personId:'erin',injection,query})
test('explicit person core survives mundane topics without making all stable background mandatory',async()=>{
 const f=await setup();try{await create(f,draft('core'));const trait=must(await f.person.read(f.authority,'erin')).fields.find(f=>f.fieldId==='curiosity');for(const q of ['你好','天气怎么样','今天工作有点忙']){const p=must(await prepare(f,q));assert.match(p.text,/CORE_CURIOUS/);assert.doesNotMatch(p.text,/UNRELATED_HISTORY/);assert.equal(p.injection.entries.find(e=>e.id===trait.eventId).mandatory,true)}
 }finally{await f.close()}
})
test('old trait stays optional; explicit core is editable separately from growth policy and bounded',async()=>{
 const f=await setup();try{
  await create(f,draft());assert.doesNotMatch(must(await prepare(f,'你好')).text,/CORE_CURIOUS/)
  let trait=must(await f.person.read(f.authority,'erin')).fields.find(f=>f.fieldId==='curiosity')
  const edit=async(injection,key)=>{const ctl=await f.controlSource(key);return f.person.apply(f.authority,ctl,{operation:'set-injection',personId:'erin',fieldId:'curiosity',previousEventId:trait.eventId,injection,note:'明确选择核心',expected:await f.fence(),idempotencyKey:key})}
  must(await edit('core','core'));trait=must(await f.person.read(f.authority,'erin')).fields.find(f=>f.fieldId==='curiosity');assert.equal(trait.policy,'growable');assert.equal(trait.injection,'core');assert.match(must(await prepare(f,'天气')).text,/CORE_CURIOUS/)
  const over=await prepare(f,'你好',{coreBudget:32});deny(over,'context_budget_exceeded');assert.match(over.message,/核心|core/);assert.match(over.message,/人物档案|profile/)
  must(await edit('default','optional'));assert.doesNotMatch(must(await prepare(f,'你好')).text,/CORE_CURIOUS/)
 }finally{await f.close()}
})
test('management previews core selection without changing growth policy or applying until confirmation',async()=>{
 const f=await setup();try{await create(f,draft());const manager=f.management.create(f.authority),s=await manager.snapshot(),p=await manager.prepare({snapshotId:s.id,action:'set-injection',payload:{personId:'erin',fieldId:'curiosity',injection:'core',note:'普通聊天也保留这条性格'}})
 assert.equal(must(await f.person.read(f.authority,'erin')).fields.find(f=>f.fieldId==='curiosity').injection,undefined);await manager.confirm(p.id)
 const current=(await manager.snapshot()).persons[0].fields.find(f=>f.fieldId==='curiosity');assert.equal(current.injection,'core');assert.equal(current.policy,'growable')
 const cold=await setup(f.directory,f.request);try{assert.match(must(await prepare(cold,'你好')).text,/CORE_CURIOUS/)}finally{await cold.close()}
 }finally{await f.close()}
})
test('empty person revision reason is rejected before creating a misleading confirmation preview',async()=>{
 const f=await setup();try{await create(f,draft());const m=f.management.create(f.authority),s=await m.snapshot();await assert.rejects(m.prepare({snapshotId:s.id,action:'set-injection',payload:{personId:'erin',fieldId:'curiosity',injection:'core',note:''}}),e=>e.code==='invalid_record')}finally{await f.close()}
})
