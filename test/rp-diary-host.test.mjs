import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {host} from './fixtures/rp/native-host.mjs'
const ok=r=>{assert.equal(r.kind,'success',r.text);return r.text},value=r=>JSON.parse(ok(r))
async function setup(f){const a=await f.create();ok(await f.command(a,'start'));const p=value(await f.command(a,'person preview '+JSON.stringify({schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]})));ok(await f.command(a,'person confirm '+p.previewId));ok(await f.command(a,'person use erin'));ok(await f.command(a,'injection set {}'));return a}
test('actual DSH tool writes an AI diary after explicit enable and certifies the returned revision across a native tool loop',async()=>{
 const f=await host({entityIds:['erin']});let calls=0
 class Terminal extends LlmAdapter{async *stream(options){calls++;if(calls===1){assert.ok(options.tools.some(t=>t.name==='memcont_diary_write'));yield {type:'tool-call-delta',index:0,id:'diary_call_one',name:'memcont_diary_write',argumentsDelta:JSON.stringify({entry:JSON.stringify({entryId:'day_one',title:'今天的星空',body:'今天我们谈到星空，我想把这一刻留下。',reflection:{understanding:'她可能喜欢天文学',uncertainty:'这仍然只是猜测'}})})};yield {type:'finish',reason:{kind:'tool-calls'}}}else{yield {type:'text-delta',index:0,text:'日记已经写好。'};yield {type:'finish',reason:{kind:'stop'}}}}}
 try{
  const a=await setup(f);ok(await f.command(a,'diary enable'));f.ctx.llm.registerAdapter(['diary-test'],new Terminal());a.options.provider='diary-test'
  ok(await f.command(a,'input 今天一起看星空吧'));await a.whenIdle();await f.rp.ready(a.id);assert.equal(calls,2,JSON.stringify(f.rp.status(a.id)))
  const diary=value(await f.command(a,'diary show day_one'));assert.equal(diary.author,'agent');assert.match(diary.draft.body,/星空/)
  const file=path.join(f.profile,'.dsh-rp/v1/host',createHash('sha256').update(a.id).digest('hex')+'.json'),journal=JSON.parse(await fs.readFile(file,'utf8'))
  const receipt=journal.data.receipts.diary_call_one.snapshot;assert.equal(receipt.provenance,'diary-result');assert.equal(receipt.diary.personId,'erin');assert.ok(receipt.records.some(r=>r.id===diary.eventId&&r.revision.length===64))
  ok(await f.command(a,'diary write '+JSON.stringify({entryId:'human_day',title:'我的一天',body:'和你聊星空很开心。'})))
  const preview=value(await f.command(a,'injection preview 星空'));assert.match(preview.current.text,/主观日记/);assert.match(preview.current.text,/和你聊星空很开心/)
  assert.ok(preview.history.filter(h=>h.kind!=='original').every(h=>h.status==='carried'),JSON.stringify(preview.history))
  ok(await f.command(a,'diary write '+JSON.stringify({entryId:'day_one',previousEventId:diary.eventId,title:'今天的星空',body:'我补充了这篇日记。'})))
  const revised=value(await f.command(a,'injection preview 星空'));assert.ok(revised.history.some(h=>h.kind==='diary-result'&&h.status==='blocked'))
  ok(await f.command(a,'input 继续聊星空'));await a.whenIdle();await f.rp.ready(a.id).catch(()=>{});assert.equal(calls,2,'old tool result cannot enter the next model call')
  const clean=ok(await f.command(a,'continue-clean')),next=f.ctx.agents.get(/created: (\w+)/.exec(clean)[1])
  assert.match(value(await f.command(next,'injection preview 日记')).current.text,/我补充了/)
  ok(await f.command(next,'diary disable'));assert.equal(value(await f.command(next,'diary settings')).allowAgentWrite,false)
 }finally{await f.dispose()}
})

test('disabled AI diary tools return a certified refusal; no source or entry is published',async()=>{
 const f=await host({entityIds:['erin']});let calls=0,received
 class Terminal extends LlmAdapter{async *stream(options){calls++;if(calls===1){yield {type:'tool-call-delta',index:0,id:'disabled_diary_call',name:'memcont_diary_write',argumentsDelta:JSON.stringify({entry:JSON.stringify({entryId:'denied',title:'不能写',body:'DISABLED_DIARY_TEXT'})})};yield {type:'finish',reason:{kind:'tool-calls'}}}else{received=options.messages.findLast(m=>m.role==='tool');yield {type:'text-delta',index:0,text:'日记写入未开启。'};yield {type:'finish',reason:{kind:'stop'}}}}}
 try{
  const a=await setup(f);ok(await f.command(a,'diary disable'));f.ctx.llm.registerAdapter(['diary-denied'],new Terminal());a.options.provider='diary-denied'
  ok(await f.command(a,'input 写日记'));await a.whenIdle();await f.rp.ready(a.id);assert.equal(calls,2,JSON.stringify(f.rp.status(a.id)))
  assert.match(JSON.stringify(received),/scope_denied/);assert.equal(value(await f.command(a,'diary list')).items.length,0)
  const file=path.join(f.profile,'.dsh-rp/v1/host',createHash('sha256').update(a.id).digest('hex')+'.json'),journal=JSON.parse(await fs.readFile(file,'utf8'))
  assert.equal(journal.data.receipts.disabled_diary_call.snapshot.provenance,'error')
  const auth=await f.rp.memory.control.authorize(journal.data.request);assert.equal(auth.ok,true)
  const ledger=await f.rp.memory.store.readLedger(auth.value);assert.equal(ledger.ok,true);assert.ok(!ledger.value.sources.some(s=>s.origin==='agent_diary'))
 }finally{await f.dispose()}
})

test('failed diary receipt persistence blocks tool continuation, diagnoses safely, and keeps the single committed entry for clean recovery',async()=>{
 const f=await host({entityIds:['erin']});let calls=0,failed=false;const rename=fs.rename
 class Terminal extends LlmAdapter{async *stream(){calls++;yield {type:'tool-call-delta',index:0,id:'uncertain_diary_call',name:'memcont_diary_write',argumentsDelta:JSON.stringify({entry:JSON.stringify({entryId:'uncertain',title:'已经写入',body:'ONE_COMMITTED_ENTRY'})})};yield {type:'finish',reason:{kind:'tool-calls'}}}}
 try{
  const a=await setup(f);ok(await f.command(a,'diary enable'));f.ctx.llm.registerAdapter(['diary-fault'],new Terminal());a.options.provider='diary-fault'
  fs.rename=async(...args)=>{if(!failed&&String(args[1]).includes(path.sep+'host'+path.sep)&&(await fs.readFile(args[0],'utf8')).includes('"provenance":"diary-result"')){failed=true;throw Object.assign(new Error('diary receipt disk fault'),{code:'EIO'})}return rename(...args)}
  ok(await f.command(a,'input 写下今天'));await a.whenIdle();await f.rp.ready(a.id).catch(()=>{});assert.equal(failed,true);assert.equal(calls,1);assert.equal(value(await f.command(a,'status')).blocked,true)
  fs.rename=rename
  const clean=ok(await f.command(a,'continue-clean')),next=f.ctx.agents.get(/created: (\w+)/.exec(clean)[1])
  const entry=value(await f.command(next,'diary show uncertain'));assert.equal(entry.draft.body,'ONE_COMMITTED_ENTRY')
  assert.equal(value(await f.command(next,'diary history uncertain')).length,1);assert.equal(calls,1,'ambiguous input must never be resent automatically')
 }finally{fs.rename=rename;await f.dispose()}
})

test('native diary search and read return the selected human entry with authenticated record receipts',async()=>{
 const f=await host({entityIds:['erin']});let calls=0;const results=[]
 class Terminal extends LlmAdapter{async *stream(options){calls++;const previous=options.messages.findLast(m=>m.role==='tool');if(previous)results.push(previous)
   if(calls<=2){yield {type:'tool-call-delta',index:0,id:'diary_read_'+calls,name:calls===1?'memcont_diary_search':'memcont_diary_read',argumentsDelta:JSON.stringify(calls===1?{query:'星空'}:{entryId:'human'})};yield {type:'finish',reason:{kind:'tool-calls'}}}
   else{yield {type:'text-delta',index:0,text:'我读到了你留下的日记。'};yield {type:'finish',reason:{kind:'stop'}}}
 }}
 try{
  const a=await setup(f);ok(await f.command(a,'diary enable'));ok(await f.command(a,'diary write '+JSON.stringify({entryId:'human',title:'星空',body:'一起看星空真好。'})))
  f.ctx.llm.registerAdapter(['diary-reader'],new Terminal());a.options.provider='diary-reader';ok(await f.command(a,'input 看看我的日记'));await a.whenIdle();await f.rp.ready(a.id)
  assert.equal(calls,3,JSON.stringify(f.rp.status(a.id)));assert.equal(results.length,2);for(const result of results)assert.match(JSON.stringify(result),/星空/)
  const file=path.join(f.profile,'.dsh-rp/v1/host',createHash('sha256').update(a.id).digest('hex')+'.json'),journal=JSON.parse(await fs.readFile(file,'utf8'))
  for(const key of ['diary_read_1','diary_read_2']){const receipt=journal.data.receipts[key].snapshot;assert.equal(receipt.provenance,'diary-result');assert.equal(receipt.records.length,1)}
 }finally{await f.dispose()}
})
