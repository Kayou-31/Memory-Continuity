import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {host} from './fixtures/rp/native-host.mjs'
const ok=r=>{assert.equal(r.kind,'success',r.text);return r.text},value=r=>JSON.parse(ok(r))
async function setup(f){const a=await f.create();ok(await f.command(a,'start'));const p=value(await f.command(a,'person preview '+JSON.stringify({schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]})));ok(await f.command(a,'person confirm '+p.previewId));ok(await f.command(a,'person use erin'));ok(await f.command(a,'injection set {}'));return a}
test('native explicit token budget is visible, checks actual model identity, and blocks mandatory over-budget requests before the provider',async()=>{
 const f=await host({entityIds:['erin']});try{
  const a=await setup(f);ok(await f.command(a,'budget set {}'));const b=value(await f.command(a,'budget show'));assert.equal(b.binding.limitTokens,32768);assert.equal(b.binding.meter.mode,'conservative-utf8')
  const preview=value(await f.command(a,'injection preview 你好'));assert.equal(preview.memoryBudget.binding.limitTokens,32768);assert.ok(preview.memoryBudget.usage.total>0)
  a.options.model='changed';ok(await f.command(a,'input 不可沿用旧计数'));await a.whenIdle();await f.rp.ready(a.id).catch(()=>{});assert.equal(f.calls(),0)
  const rejected=value(await f.command(a,'status'));assert.equal(rejected.bindingHealth,'healthy');assert.equal(rejected.requestAdmission.state,'rejected');assert.equal(rejected.requestAdmission.code,'stale_input');assert.equal(rejected.recovery.action,'continue-clean');assert.match(rejected.recovery.detail,/budget set/)
  const clean=ok(await f.command(a,'continue-clean')),next=f.ctx.agents.get(/created: (\w+)/.exec(clean)[1]);ok(await f.command(next,'budget set {"limitTokens":32}'))
  ok(await f.command(next,'input 必需记忆不能偷偷截断'));await next.whenIdle();await f.rp.ready(next.id).catch(()=>{});assert.equal(f.calls(),0)
 }finally{await f.dispose()}
})

const journalPath=(f,a)=>path.join(f.profile,'.dsh-rp/v1/host',createHash('sha256').update(a.id).digest('hex')+'.json')
const readJournal=async(f,a)=>JSON.parse(await fs.readFile(journalPath(f,a),'utf8'))
const must=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value}
test('actual tokenizer budget admits a native request and repeated memory tool pages remain certified within one shared limit',async()=>{
 const f=await host({entityIds:['erin']}),seen=[];let calls=0,id,cursor
 class Terminal extends LlmAdapter{async *stream(options){calls++;seen.push(options);const tool=options.messages.findLast(m=>m.role==='tool');if(tool){const r=JSON.parse(tool.content[0].text);assert.equal(r.ok,true,JSON.stringify(r));cursor=r.value.nextCursor;assert.ok(r.value.text.length<60000);assert.ok(cursor)}
  if(calls<3){yield {type:'tool-call-delta',index:0,id:'budget_get_'+calls,name:'rp_memory_get',argumentsDelta:JSON.stringify(cursor?{cursor,maxChars:65536}:{id,maxChars:65536})};yield {type:'finish',reason:{kind:'tool-calls'}}}
  else{yield {type:'text-delta',text:'离线工具预算验证'};yield {type:'finish',reason:{kind:'stop'}}}
 }}
 try{
  const a=await setup(f);a.options.provider='budget-loop';a.options.model='deepseek-ai/DeepSeek-V3.2';f.ctx.llm.registerAdapter(['budget-loop'],new Terminal())
  ok(await f.command(a,'budget set {"limitTokens":8000}'))
  const j=await readJournal(f,a),auth=must(await f.rp.memory.control.authorize(j.data.request)),ctl=must(await f.rp.memory.store.observeSource(auth,{idempotencyKey:'big_event',origin:'user_control',role:'user_control',publicText:'Approved offline test event',turnId:'big_turn'}))
  id=must(await f.rp.memory.agentMemory.apply(auth,ctl,{kind:'experience',actorIds:['erin'],description:' hello'.repeat(10000),fictionalTime:'test',sourceRevisionIds:[],idempotencyKey:'big_event',expected:must(await f.rp.memory.store.readFence(auth))})).eventId
  ok(await f.command(a,'input 查阅原文'));await a.whenIdle();await f.rp.ready(a.id);assert.equal(calls,3,JSON.stringify(f.rp.status(a.id)))
  const status=value(await f.command(a,'status'));assert.equal(status.memoryUsage.mode,'tokenizer-text');assert.ok(status.memoryUsage.total<=8000);assert.equal(status.memoryUsage.parts.filter(p=>p.kind==='retained-memory').length,5)
  const final=await readJournal(f,a);for(const key of ['budget_get_1','budget_get_2']){const receipt=final.data.receipts[key].snapshot;assert.equal(receipt.records[0].id,id);assert.equal(receipt.memoryBudget.sha256,status.memoryBudget.sha256)}
  // Reconstruct each actual memory envelope independently with the packaged meter.
  const {api}=await import('./fixtures/rp/growth.mjs'),meter=await api.openMemoryMeter(status.memoryBudget,status.memoryBudget.target)
  for(const req of seen){const parts=req.messages.filter(m=>final.data.snapshots[m.id]||final.data.frames[m.id]).map(m=>({kind:'actual',text:api.canonical(m)}));parts.push({kind:'tools',text:api.canonical(req.tools)},{kind:'toolHistory',text:api.canonical(req.toolHistory)});assert.ok(api.measureMemoryParts(parts,meter).total<=8000)}
 }finally{await f.dispose()}
})
test('dynamic output reserve blocks even an otherwise valid token-budget memory packet',async()=>{
 const f=await host({entityIds:['erin']});try{const a=await setup(f);ok(await f.command(a,'budget set {}'));a.options.maxTokens=100000;ok(await f.command(a,'input 输出预留超过模型容量'));await a.whenIdle();await f.rp.ready(a.id).catch(()=>{});assert.equal(f.calls(),0)}finally{await f.dispose()}
})
test('explicit budget upgrades back up the original journal and a stripped binding cannot silently downgrade after resume',async()=>{
 const f=await host({entityIds:['erin']});try{
  const a=await setup(f);const original=await fs.readFile(journalPath(f,a));ok(await f.command(a,'budget set {}'));assert.deepEqual(await fs.readFile(journalPath(f,a)+'.pre-budget-v2-backup'),original)
  await f.drop(a);const j=await readJournal(f,a);delete j.data.memoryBudget
  const {api}=await import('./fixtures/rp/growth.mjs');j.sha256=createHash('sha256').update(api.canonical(j.data)).digest('hex');await fs.writeFile(journalPath(f,a),JSON.stringify(j))
  const restored=await f.resume(a);assert.equal(value(await f.command(restored,'status')).blocked,true);assert.equal(value(await f.command(restored,'status')).lastError,'memory_budget_recovery_only');assert.equal(f.calls(),0)
 }finally{await f.dispose()}
})

test('deletion between a native sized retrieval and receipt publication refuses the old data and the next provider request',async()=>{
 const f=await host({entityIds:['erin']});let calls=0,remove,deleted=false
 class Terminal extends LlmAdapter{async *stream(){calls++;yield {type:'tool-call-delta',index:0,id:'delete_budget_call',name:'rp_memory_search',argumentsDelta:JSON.stringify({query:'PRIVATE_BUDGET'})};yield {type:'finish',reason:{kind:'tool-calls'}}}}
 try{
  const a=await setup(f);a.options.provider='budget-deletion';f.ctx.llm.registerAdapter(['budget-deletion'],new Terminal());ok(await f.command(a,'budget set {}'))
  const j=await readJournal(f,a),m=f.rp.memory,auth=must(await m.control.authorize(j.data.request)),ctl=async key=>must(await m.store.observeSource(auth,{idempotencyKey:key,origin:'user_control',role:'user_control',publicText:key,turnId:key})),source=await ctl('private_budget_source')
  const made=must(await m.agentMemory.apply(auth,source,{kind:'experience',actorIds:['erin'],description:'PRIVATE_BUDGET',fictionalTime:'test',sourceRevisionIds:[],idempotencyKey:'private_budget_event',expected:must(await m.store.readFence(auth))})),del=await ctl('private_budget_delete')
  remove=f.ctx.on('tools/execute',async(exec,next)=>{const r=await next();if(exec.callId==='delete_budget_call'){assert.match(JSON.stringify(r),new RegExp(made.eventId));must(await m.canonical.applyControl(auth,del,{kind:'privacy_delete',sourceRevisionIds:[source.id],affectedBranchIds:[j.data.request.branchId],idempotencyKey:'delete_budget',expected:must(await m.store.readFence(auth))}));deleted=true}return r})
  ok(await f.command(a,'input 请检索'));await a.whenIdle();await f.rp.ready(a.id).catch(()=>{});assert.equal(deleted,true);assert.equal(calls,1);assert.equal((await readJournal(f,a)).data.receipts.delete_budget_call,undefined)
 }finally{remove?.();await f.dispose()}
})

test('two memory calls in one assistant turn share budget without concurrent over-allocation',async()=>{
 const f=await host({entityIds:['erin']});let calls=0,id,received=[]
 class Terminal extends LlmAdapter{async *stream(options){calls++;if(calls===1){for(let i=0;i<2;i++)yield {type:'tool-call-delta',index:i,id:'sibling_'+i,name:'rp_memory_get',argumentsDelta:JSON.stringify({id,maxChars:65536})};yield {type:'finish',reason:{kind:'tool-calls'}}}else{received=options.messages.filter(m=>m.role==='tool');yield {type:'text-delta',text:'本轮两个工具已完成'};yield {type:'finish',reason:{kind:'stop'}}}}}
 try{
  const a=await setup(f);a.options.provider='budget-siblings';a.options.model='deepseek-ai/DeepSeek-V3.2';f.ctx.llm.registerAdapter(['budget-siblings'],new Terminal());ok(await f.command(a,'budget set {"limitTokens":8000}'))
  const j=await readJournal(f,a),m=f.rp.memory,auth=must(await m.control.authorize(j.data.request)),source=must(await m.store.observeSource(auth,{idempotencyKey:'siblings',origin:'user_control',role:'user_control',publicText:'授权测试',turnId:'siblings'}))
  id=must(await m.agentMemory.apply(auth,source,{kind:'experience',actorIds:['erin'],description:' hello'.repeat(10000),fictionalTime:'test',sourceRevisionIds:[],idempotencyKey:'siblings',expected:must(await m.store.readFence(auth))})).eventId
  ok(await f.command(a,'input 两次核对原文'));await a.whenIdle();await f.rp.ready(a.id);assert.equal(calls,2,JSON.stringify(f.rp.status(a.id)));assert.equal(received.length,2)
  for(const msg of received)assert.equal(JSON.parse(msg.content[0].text).ok,true,JSON.stringify(msg))
  assert.ok(value(await f.command(a,'status')).memoryUsage.total<=8000)
 }finally{await f.dispose()}
})

test('downstream provider failure is not mislabeled as a memory admission rejection',async()=>{
 const f=await host({entityIds:['erin']});let calls=0
 class Terminal extends LlmAdapter{async *stream(){calls++;throw Error('OFFLINE_PROVIDER_FAILURE')}}
 try{const a=await setup(f);a.options.provider='failed-provider';f.ctx.llm.registerAdapter(['failed-provider'],new Terminal());ok(await f.command(a,'budget set {}'));ok(await f.command(a,'input 测试下游失败'));await a.whenIdle();await f.rp.ready(a.id);const s=value(await f.command(a,'status'));assert.equal(calls,1);assert.equal(s.bindingHealth,'healthy');assert.equal(s.requestAdmission.state,'admitted');assert.equal(s.requestAdmission.code,undefined)}finally{await f.dispose()}
})
