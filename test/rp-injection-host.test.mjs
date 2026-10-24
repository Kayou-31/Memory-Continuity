import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {pathToFileURL} from 'node:url'
import {host as nativeHost} from './fixtures/rp/native-host.mjs'
const bundle=process.env.RP_PERSON_BUNDLE?await import(pathToFileURL(path.resolve(process.env.RP_PERSON_BUNDLE)).href):undefined
const host=(config,hooks={})=>nativeHost(config,{...hooks,...(bundle?{install:bundle.installRpPlugin}:{})})
const ok=r=>{assert.equal(r.kind,'success',r.text);return r}
const value=r=>JSON.parse(ok(r).text)
const sha=s=>createHash('sha256').update(s).digest('hex')
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}'
async function setup(f){const a=await f.create();ok(await f.command(a,'start'));const p=value(await f.command(a,'person preview '+JSON.stringify({schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'},{fieldId:'past',kind:'background',value:'钟楼旁长大',policy:'stable'}],relationships:[],goals:[]})));ok(await f.command(a,'person confirm '+p.previewId));ok(await f.command(a,'person use erin'));ok(await f.command(a,'injection set {}'));return a}
test('native M5 preview and real request share selections without a model call for preview; history is disclosed and clean continuation retains config',async()=>{
 const f=await host({entityIds:['erin']}),requests=[]
 class Terminal extends LlmAdapter{async *stream(options){requests.push(options);yield {type:'text-delta',index:0,text:'一段回复'};yield {type:'finish',reason:{kind:'stop'}}}}
 try{f.ctx.llm.registerAdapter(['m5'],new Terminal());const a=await setup(f);a.options.provider='m5'
 ok(await f.command(a,'global preference {"key":"language","body":"请用中文交流"}'))
 const preview=value(await f.command(a,'injection preview 钟楼'));assert.equal(requests.length,0);assert.match(preview.current.text,/钟楼旁长大/);assert.equal(preview.history.length,0)
 ok(await f.command(a,'input 钟楼'));await a.whenIdle();await f.rp.ready(a.id);assert.equal(requests.length,1);assert.match(JSON.stringify(requests[0]),/personContinuity/);assert.match(JSON.stringify(requests[0]),/请用中文交流/)
 const after=value(await f.command(a,'injection preview 天气'));assert.doesNotMatch(after.current.text,/钟楼旁长大/);assert.ok(after.history.some(h=>h.status==='carried'&&h.snapshotId));assert.equal(requests.length,1)
 assert.equal((await f.command(a,'injection set {"depth":"overview"}')).kind,'error')
 const clean=ok(await f.command(a,'continue-clean')),next=f.ctx.agents.get(/created: (\w+)/.exec(clean.text)[1]);assert.equal(next.session.deriveMessages().length,0);assert.ok(value(await f.command(next,'injection show')).binding)
 const fresh=value(await f.command(next,'injection preview 天气'));assert.equal(fresh.history.length,0)
 }finally{await f.dispose()}
})
test('native M5 binding resumes; stripped journal configuration cannot downgrade a marked root',async()=>{
 const f=await host({entityIds:['erin']});try{const a=await setup(f);ok(await f.command(a,'input 你好'));await a.whenIdle();await f.rp.ready(a.id);await f.drop(a);const resumed=await f.resume(a);assert.equal(f.rp.status(a.id).blocked,false);await f.drop(resumed)
 const file=path.join(f.profile,'.dsh-rp/v1/host',sha(a.id)+'.json'),env=JSON.parse(await fs.readFile(file,'utf8'));delete env.data.injectionBinding;for(const s of [...Object.values(env.data.snapshots),...Object.values(env.data.pending),...Object.values(env.data.frames)]){delete s.injectionBinding;delete s.injection}
 env.sha256=sha(canonical(env.data));await fs.writeFile(file,JSON.stringify(env));const broken=await f.resume(resumed);assert.equal(f.rp.status(a.id).blocked,true);assert.equal((await f.command(broken,'input must block')).kind,'error');assert.equal(f.calls(),1)
 }finally{await f.dispose()}
})
test('native M5 stale historical proof is visible in diagnostics and never reaches terminal',async()=>{
 const f=await host({entityIds:['erin']});try{const a=await setup(f);ok(await f.command(a,'input 你好'));await a.whenIdle();await f.rp.ready(a.id)
 const person=value(await f.command(a,'person show erin')),field=person.fields.find(x=>x.fieldId==='name')
 ok(await f.command(a,'person set-policy '+JSON.stringify({personId:'erin',fieldId:'name',previousEventId:field.eventId,policy:'growable',note:'人工修改'})))
 const p=value(await f.command(a,'injection preview 你好'));assert.ok(p.history.some(h=>h.status==='blocked'))
 ok(await f.command(a,'input 继续'));await a.whenIdle();await f.rp.ready(a.id).catch(()=>{});assert.equal(f.calls(),1)
 }finally{await f.dispose()}
})

test('M5 actual native tool loop retains original binding through tool-call frames and cold resume',async()=>{
 const f=await host({entityIds:['erin']});let calls=0,cold,disposed=false
 class Terminal extends LlmAdapter{async *stream(){if(++calls===1){yield {type:'tool-call-delta',index:0,id:'m5_search',name:'rp_memory_search',argumentsDelta:'{"query":"林澈"}'};yield {type:'finish',reason:{kind:'tool-calls'}}}else{yield {type:'text-delta',index:0,text:'核对完成'};yield {type:'finish',reason:{kind:'stop'}}}}}
 try{f.ctx.llm.registerAdapter(['m5-tools'],new Terminal());const a=await setup(f);a.options.provider='m5-tools';ok(await f.command(a,'input 我是谁'));await a.whenIdle();await f.rp.ready(a.id);assert.equal(calls,2,JSON.stringify(f.rp.status(a.id)))
  for(const id of f.rp.status(a.id).candidateIds)ok(await f.command(a,'accept '+id))
  await f.drop(a);await f.dispose();disposed=true;cold=await host({entityIds:['erin']},{directory:path.dirname(f.profile)});cold.ctx.llm.registerAdapter(['m5-tools'],new Terminal());const a2=await cold.resume(a);assert.equal(cold.rp.status(a2.id).blocked,false);ok(await cold.command(a2,'input 继续'));await a2.whenIdle();await cold.rp.ready(a2.id);assert.equal(calls,3)
 }finally{if(!disposed)await f.dispose();await cold?.dispose()}
})

test('invalid injection JSON is a parameter error and cannot revoke a healthy session',async()=>{
 const f=await host({entityIds:['erin']});try{const a=await setup(f),before=value(await f.command(a,'injection show'))
 assert.match((await f.command(a,'injection set {')).text,/invalid_record/);assert.equal(f.rp.status(a.id).blocked,false)
 assert.deepEqual(value(await f.command(a,'injection show')),before);ok(await f.command(a,'injection set {"depth":"overview"}'));ok(await f.command(a,'input 你好'));await a.whenIdle();await f.rp.ready(a.id);assert.equal(f.calls(),1)
 }finally{await f.dispose()}
})

test('changed historical trace cannot be authenticated by unchanged native packet text',async()=>{
 const f=await host({entityIds:['erin']});try{const a=await setup(f);ok(await f.command(a,'input 钟楼'));await a.whenIdle();await f.rp.ready(a.id);await f.drop(a)
 const file=path.join(f.profile,'.dsh-rp/v1/host',sha(a.id)+'.json'),env=JSON.parse(await fs.readFile(file,'utf8'));for(const s of Object.values(env.data.snapshots)){if(!s.injection)continue;s.injection.query='不是当时的话题';s.injection.querySha256=sha(canonical(s.injection.query));const {sha256,...data}=s.injection;s.injection.sha256=sha(canonical(data))}
 env.sha256=sha(canonical(env.data));await fs.writeFile(file,JSON.stringify(env));const resumed=await f.resume(a);assert.equal(f.rp.status(a.id).blocked,true);assert.equal((await f.command(resumed,'input 拒绝发送')).kind,'error');assert.equal(f.calls(),1)
 }finally{await f.dispose()}
})
