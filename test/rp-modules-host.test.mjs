import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {host as nativeHost,latch} from './fixtures/rp/native-host.mjs'
const bundle=process.env.RP_PERSON_BUNDLE?await import(pathToFileURL(path.resolve(process.env.RP_PERSON_BUNDLE)).href):undefined
const host=(config,hooks={})=>nativeHost(config,{...hooks,...(bundle?{install:bundle.installRpPlugin}:{})})
const ok=r=>{assert.equal(r.kind,'success',r.text);return r}
const sha=s=>createHash('sha256').update(s).digest('hex')
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}'
async function clean(f,a){const r=ok(await f.command(a,'continue-clean'));return f.ctx.agents.get(/created: (\w+)/.exec(r.text)[1])}
test('native M3 modes and constraints reach terminal; switching history fails and module disable blocks old requests',async()=>{
 const f=await host({entityIds:['erin']}),requests=[]
 class Terminal extends LlmAdapter{async *stream(o){requests.push(o);yield {type:'text-delta',index:0,text:'Offline answer'};yield {type:'finish',reason:{kind:'stop'}}}}
 try{f.ctx.llm.registerAdapter(['modules-test'],new Terminal());const a=await f.create();a.options.provider='modules-test';ok(await f.command(a,'start'))
  ok(await f.command(a,'mode set companion'));ok(await f.command(a,'modules enable recall'))
  ok(await f.command(a,'constraints set '+JSON.stringify({maxReadRecords:2,guidance:[{id:'boundary',text:'尊重个人边界，不把推测当事实'}]})))
  ok(await f.command(a,'input 开始'));await a.whenIdle();await f.rp.ready(a.id);assert.equal(requests.length,1)
  assert.match(JSON.stringify(requests[0]),/companion/);assert.match(JSON.stringify(requests[0]),/尊重个人边界/);assert.match(JSON.stringify(requests[0]),/automaticAdoption/)
  assert.equal((await f.command(a,'mode set project')).kind,'error')
  ok(await f.command(a,'modules disable recall'));assert.equal(f.rp.status(a.id).blocked,true)
  assert.equal((await f.command(a,'input 不能进入模型')).kind,'error');assert.equal(requests.length,1)
  const next=await clean(f,a);assert.equal(next.session.deriveMessages().length,0);assert.equal(f.rp.status(next.id).purpose.mode,'companion');assert.deepEqual(f.rp.status(next.id).purpose.enabledModules,[])
  ok(await f.command(next,'mode set project'));ok(await f.command(next,'input 继续'));await next.whenIdle();await f.rp.ready(next.id);assert.equal(requests.length,2)
 }finally{await f.dispose()}
})
test('native M3 journal restores exact binding and missing proof enters recovery-only',async()=>{
 const f=await host();try{const a=await f.create();ok(await f.command(a,'start'));ok(await f.command(a,'mode set creation'));ok(await f.command(a,'modules enable recall'))
  ok(await f.command(a,'input Begin'));await a.whenIdle();await f.rp.ready(a.id);await f.drop(a)
  const resumed=await f.resume(a);assert.equal(f.rp.status(resumed.id).blocked,false);assert.equal(f.rp.status(resumed.id).purpose.mode,'creation');await f.drop(resumed)
  const file=path.join(f.profile,'.dsh-rp/v1/host',sha(a.id)+'.json'),env=JSON.parse(await fs.readFile(file,'utf8'));delete env.data.runtimeBinding
  for(const s of [...Object.values(env.data.snapshots),...Object.values(env.data.frames),...Object.values(env.data.pending)])delete s.runtimeBinding
  env.sha256=sha(canonical(env.data));await fs.writeFile(file,JSON.stringify(env))
  const damaged=await f.resume(resumed);assert.equal(f.rp.status(damaged.id).blocked,true);assert.equal((await f.command(damaged,'input blocked')).kind,'error');assert.equal(f.calls(),1)
  const next=await clean(f,damaged);assert.equal(next.session.deriveMessages().length,0);assert.equal(f.rp.status(next.id).purpose.mode,'rp')
 }finally{await f.dispose()}
})
test('failed module revocation journal cannot revive enabled capabilities from the old journal after cold restart',async()=>{
 const f=await host(),rename=fs.rename;let cold,disposed=false
 try{const a=await f.create();ok(await f.command(a,'start'));ok(await f.command(a,'modules enable recall'));ok(await f.command(a,'input Before failure'));await a.whenIdle();await f.rp.ready(a.id)
  const file=path.join(f.profile,'.dsh-rp/v1/host',sha(a.id)+'.json'),old=await fs.readFile(file)
  fs.rename=async(from,to)=>{if(to===file)throw Object.assign(new Error('MODULE_JOURNAL_EIO'),{code:'EIO'});return rename(from,to)}
  assert.equal((await f.command(a,'modules disable recall')).kind,'error');assert.equal(f.rp.status(a.id).blocked,true)
  fs.rename=rename;await f.drop(a);await f.dispose();disposed=true
  // Disk state of a crash at the failed publication, without later graceful close saves.
  await fs.writeFile(file,old)
  cold=await host({}, {directory:path.dirname(f.profile)});const resumed=await cold.resume(a)
  assert.equal(cold.rp.status(resumed.id).blocked,true);assert.equal((await cold.command(resumed,'modules run '+JSON.stringify({moduleId:'recall',input:{query:'Before'}}))).kind,'error')
 }finally{fs.rename=rename;if(!disposed)await f.dispose();await cold?.dispose()}
})
test('module disable revokes new requests while an actual SDK stream is paused', {timeout:15000},async()=>{
 const f=await host(),gate=latch();f.gate(gate)
 try{const a=await f.create();ok(await f.command(a,'start'));ok(await f.command(a,'modules enable recall'));ok(await f.command(a,'input Paused'));await gate.entered
  const disable=f.command(a,'modules disable recall');await new Promise(r=>setImmediate(r));assert.equal(f.rp.status(a.id).blocked,true)
  await assert.rejects(f.stream(a));assert.equal(f.calls(),1);gate.release();ok(await disable)
 }finally{gate.release();await f.dispose()}
})
test('cold M3 resume after multiple empty-root configuration changes can send with original proofs',async()=>{
 const f=await host();let cold,disposed=false
 try{const a=await f.create();ok(await f.command(a,'start'));ok(await f.command(a,'mode set creation'));ok(await f.command(a,'modules enable recall'));ok(await f.command(a,'constraints set {}'))
  ok(await f.command(a,'input First'));await a.whenIdle();await f.rp.ready(a.id)
  for(const id of f.rp.status(a.id).candidateIds)ok(await f.command(a,'accept '+id))
  await f.drop(a);await f.dispose();disposed=true;cold=await host({}, {directory:path.dirname(f.profile)})
  const resumed=await cold.resume(a);assert.equal(cold.rp.status(resumed.id).blocked,false)
  ok(await cold.command(resumed,'input Second'));await resumed.whenIdle();await cold.rp.ready(resumed.id);assert.equal(cold.calls(),1,JSON.stringify(cold.rp.status(resumed.id)))
 }finally{if(!disposed)await f.dispose();await cold?.dispose()}
})
test('overlapping runtime configuration commands reject the second mutation before overwriting markers',async()=>{
 const f=await host(),gate=latch(),rename=fs.rename;let armed=true
 try{const a=await f.create();ok(await f.command(a,'start'));ok(await f.command(a,'modules enable recall'));ok(await f.command(a,'modules enable person-view'))
  fs.rename=async(from,to)=>{if(armed&&to.includes('.dsh-rp-policy')){armed=false;await gate.wait()}return rename(from,to)}
  const first=f.command(a,'modules disable recall');await gate.entered
  const second=await f.command(a,'modules disable person-view');gate.release();await first
  assert.equal(second.kind,'error');assert.match(second.text,/configuration.*progress/i)
 }finally{gate.release();fs.rename=rename;await f.dispose()}
})
test('failed revocation marker falls back to a blocked journal across cold restart',async()=>{
 const f=await host(),rename=fs.rename;let cold,disposed=false
 try{const a=await f.create();ok(await f.command(a,'start'));ok(await f.command(a,'modules enable recall'))
  const file=path.join(f.profile,'.dsh-rp/v1/host',sha(a.id)+'.json')
  fs.rename=async(from,to)=>{if(to.includes('.dsh-rp-policy'))throw Object.assign(new Error('MARKER_EIO'),{code:'EIO'});return rename(from,to)}
  assert.equal((await f.command(a,'modules disable recall')).kind,'error');const crashJournal=await fs.readFile(file)
  fs.rename=rename;await f.drop(a);await f.dispose();disposed=true;await fs.writeFile(file,crashJournal)
  cold=await host({}, {directory:path.dirname(f.profile)});const resumed=await cold.resume(a);assert.equal(cold.rp.status(resumed.id).blocked,true)
 }finally{fs.rename=rename;if(!disposed)await f.dispose();await cold?.dispose()}
})
