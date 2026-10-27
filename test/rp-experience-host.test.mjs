import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {host as nativeHost} from './fixtures/rp/native-host.mjs'
const bundle=process.env.RP_PERSON_BUNDLE?await import(pathToFileURL(path.resolve(process.env.RP_PERSON_BUNDLE)).href):null
const host=(config)=>nativeHost(config,bundle?{install:bundle.installRpPlugin}:{})
const ok=r=>{assert.equal(r.kind,'success',r.text);return r.text},value=r=>JSON.parse(ok(r))
async function setup(f){const a=await f.create();ok(await f.command(a,'start'));const p=value(await f.command(a,'person preview '+JSON.stringify({schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]})));ok(await f.command(a,'person confirm '+p.previewId));ok(await f.command(a,'person use erin'));ok(await f.command(a,'injection set {}'));return a}
const args={description:'林澈答应周末帮忙整理画稿。',epistemic:'world',reason:'明确约定',evidence:[{quote:'周末我来帮你整理画稿。'}]}
test('native chat proposes evidence-backed experiences without extra generation and workbench adopts explicitly',async()=>{
 const f=await host({entityIds:['erin']});let calls=0,proposalResult;
 class Terminal extends LlmAdapter{async *stream(o){calls++;if(calls===1){assert.ok(o.tools.some(t=>t.name==='memcont_experience_propose'));yield {type:'tool-call-delta',index:0,id:'experience_one',name:'memcont_experience_propose',argumentsDelta:JSON.stringify({proposal:JSON.stringify(args)})};yield {type:'finish',reason:{kind:'tool-calls'}}}else{proposalResult=o.messages.findLast(m=>m.role==='tool');yield {type:'text-delta',index:0,text:'我把这个约定记成了待审阅的片段。'};yield {type:'finish',reason:{kind:'stop'}}}}}
 try{const a=await setup(f);ok(await f.command(a,'experience enable'));f.ctx.llm.registerAdapter(['experience-test'],new Terminal());a.options.provider='experience-test';ok(await f.command(a,'input 周末我来帮你整理画稿。'));await a.whenIdle();await f.rp.ready(a.id);assert.equal(calls,2,JSON.stringify(f.rp.status(a.id)));assert.match(JSON.stringify(proposalResult),/pending/);
  const items=value(await f.command(a,'experience list')).items;assert.equal(items.length,1);assert.equal(items[0].state,'pending');
  const file=path.join(f.profile,'.dsh-rp/v1/host',createHash('sha256').update(a.id).digest('hex')+'.json'),journal=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(journal.data.receipts.experience_one.snapshot.provenance,'experience-result');
  const auth=await f.rp.memory.control.authorize(journal.data.request);assert.equal(auth.ok,true);assert.ok(!(await f.rp.memory.store.readEvents(auth.value)).value.some(e=>e.payload.description===args.description));
  ok(await f.command(a,'experience adopt '+items[0].id));assert.equal(value(await f.command(a,'experience show '+items[0].id)).state,'accepted');assert.equal(calls,2,'review commands do not call the model');
 }finally{await f.dispose()}
})
test('malformed experience JSON is a certified refusal and does not disable conversation',async()=>{
 const f=await host({entityIds:['erin']});let calls=0,received;
 class Terminal extends LlmAdapter{async *stream(o){calls++;if(calls===1){yield {type:'tool-call-delta',index:0,id:'bad_experience',name:'memcont_experience_propose',argumentsDelta:JSON.stringify({proposal:'{broken'})};yield {type:'finish',reason:{kind:'tool-calls'}}}else{received=o.messages.findLast(m=>m.role==='tool');yield {type:'text-delta',index:0,text:'这次没有保存候选。'};yield {type:'finish',reason:{kind:'stop'}}}}}
 try{const a=await setup(f);ok(await f.command(a,'experience enable'));f.ctx.llm.registerAdapter(['experience-bad'],new Terminal());a.options.provider='experience-bad';ok(await f.command(a,'input 周末我来帮你整理画稿。'));await a.whenIdle();await f.rp.ready(a.id).catch(()=>{});assert.equal(calls,2,JSON.stringify(f.rp.status(a.id)));assert.match(JSON.stringify(received),/invalid_candidate/);assert.equal(value(await f.command(a,'experience list')).items.length,0)}finally{await f.dispose()}
})
test('failed experience receipt blocks continuation and clean recovery keeps one pending candidate without replay',async()=>{
 const f=await host({entityIds:['erin']});let calls=0,failed=false;const rename=fs.rename;
 class Terminal extends LlmAdapter{async *stream(){calls++;yield {type:'tool-call-delta',index:0,id:'uncertain_experience',name:'memcont_experience_propose',argumentsDelta:JSON.stringify({proposal:JSON.stringify(args)})};yield {type:'finish',reason:{kind:'tool-calls'}}}}
 try{const a=await setup(f);ok(await f.command(a,'experience enable'));f.ctx.llm.registerAdapter(['experience-fault'],new Terminal());a.options.provider='experience-fault';
  fs.rename=async(...args)=>{if(!failed&&String(args[1]).includes(path.sep+'host'+path.sep)&&(await fs.readFile(args[0],'utf8')).includes('"provenance":"experience-result"')){failed=true;throw Object.assign(new Error('experience receipt disk fault'),{code:'EIO'})}return rename(...args)};
  ok(await f.command(a,'input 周末我来帮你整理画稿。'));await a.whenIdle();await f.rp.ready(a.id).catch(()=>{});assert.equal(failed,true);assert.equal(calls,1);assert.equal(value(await f.command(a,'status')).blocked,true);fs.rename=rename;
  const next=f.ctx.agents.get(/created: (\w+)/.exec(ok(await f.command(a,'continue-clean')))[1]);const list=value(await f.command(next,'experience list'));assert.equal(list.items.length,1);assert.equal(list.items[0].state,'pending');assert.equal(calls,1,'ambiguous input is not sent again');
 }finally{fs.rename=rename;await f.dispose()}
})
test('clean continuation can propose current evidence even when earlier accepted assistant history exists',async()=>{
 const f=await host({entityIds:['erin']});let calls=0,received;
 class Terminal extends LlmAdapter{async *stream(o){calls++;if(calls===2){yield {type:'tool-call-delta',index:0,id:'clean_experience',name:'memcont_experience_propose',argumentsDelta:JSON.stringify({proposal:JSON.stringify(args)})};yield {type:'finish',reason:{kind:'tool-calls'}}}else{received=o.messages.findLast(m=>m.role==='tool');yield {type:'text-delta',index:0,text:'我们慢慢来。'};yield {type:'finish',reason:{kind:'stop'}}}}}
 try{const a=await setup(f);ok(await f.command(a,'experience enable'));f.ctx.llm.registerAdapter(['experience-clean'],new Terminal());a.options.provider='experience-clean';ok(await f.command(a,'input 今天先聊聊'));await a.whenIdle();await f.rp.ready(a.id);for(const id of f.rp.status(a.id).candidateIds)ok(await f.command(a,'accept '+id));
  const next=f.ctx.agents.get(/created: (\w+)/.exec(ok(await f.command(a,'continue-clean')))[1]);ok(await f.command(next,'input 周末我来帮你整理画稿。'));await next.whenIdle();await f.rp.ready(next.id);assert.equal(calls,3);assert.match(JSON.stringify(received),/pending/);assert.equal(value(await f.command(next,'experience list')).items.length,1);
 }finally{await f.dispose()}
})

test('human review racing a saved proposal receipt reports persistence uncertainty and never pretends the write failed',async()=>{
 const f=await host({entityIds:['erin']});let calls=0,reviewed=false;
 class Terminal extends LlmAdapter{async *stream(){calls++;if(calls===1){yield {type:'tool-call-delta',index:0,id:'review_race',name:'memcont_experience_propose',argumentsDelta:JSON.stringify({proposal:JSON.stringify(args)})};yield {type:'finish',reason:{kind:'tool-calls'}}}else{yield {type:'text-delta',index:0,text:'不应把已保存候选当作未写入。'};yield {type:'finish',reason:{kind:'stop'}}}}}
 try{
  const a=await setup(f);ok(await f.command(a,'experience enable'));const memory=f.rp.memory,service=memory.experienceCandidates;
  // A real human rejection commits between successful proposal publication and
  // receipt validation. Do not mock a passing receipt or use another model.
  memory.experienceCandidates={...service,async receipt(authority,personId,returned){
   const source=await memory.store.observeSource(authority,{idempotencyKey:'review_during_receipt',origin:'user_control',role:'user_control',turnId:'review_during_receipt',publicText:'用户明确拒绝这条候选'});assert.equal(source.ok,true);
   const decision=await service.decide(authority,source.value,{personId,candidateId:returned.id,decision:'rejected',key:'review_during_receipt'});assert.equal(decision.ok,true);reviewed=true;
   return service.receipt(authority,personId,returned)
  }};
  f.ctx.llm.registerAdapter(['experience-review-race'],new Terminal());a.options.provider='experience-review-race';ok(await f.command(a,'input 周末我来帮你整理画稿。'));await a.whenIdle();await f.rp.ready(a.id).catch(()=>{});
  assert.equal(reviewed,true);assert.equal(calls,1,'an already-published proposal cannot become a normal retryable refusal');const status=value(await f.command(a,'status'));assert.equal(status.blocked,true);assert.equal(status.lastError,'persistence_uncertain');
  memory.experienceCandidates=service;const next=f.ctx.agents.get(/created: (\w+)/.exec(ok(await f.command(a,'continue-clean')))[1]),list=value(await f.command(next,'experience list'));assert.equal(list.items.length,1);assert.equal(list.items[0].state,'rejected');assert.equal(calls,1,'unknown input is not automatically replayed');
 }finally{await f.dispose()}
})
