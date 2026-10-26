import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {host as nativeHost} from './fixtures/rp/native-host.mjs'
const bundle=process.env.RP_PERSON_BUNDLE?await import(pathToFileURL(path.resolve(process.env.RP_PERSON_BUNDLE))):undefined
const host=(config={},hooks={})=>nativeHost(config,{...hooks,...(bundle?{install:bundle.installRpPlugin}:{})})
const ok=r=>{assert.equal(r.kind,'success',r.text);return r.text}
async function input(f,a,text){ok(await f.command(a,'input '+text));await a.whenIdle();await f.rp.ready(a.id).catch(()=>{})}
const retired=a=>a.session.snapshotEvents().filter(e=>e.type==='user/message'&&e.data.id.startsWith('retired_'))

test('unchanged tool steps reuse their current certified memory context',async()=>{
 const f=await host(),seen=[]
 class Terminal extends LlmAdapter{async *stream(options){seen.push(options);if(seen.length<4){yield {type:'tool-call-delta',index:0,id:'status_'+seen.length,name:'rp_memory_status',argumentsDelta:'{}'};yield {type:'finish',reason:{kind:'tool-calls'}}}else{yield {type:'text-delta',index:0,text:'离线核对结束'};yield {type:'finish',reason:{kind:'stop'}}}}}
 try{const a=await f.create();ok(await f.command(a,'start'));a.options.provider='cost-loop';f.ctx.llm.registerAdapter(['cost-loop'],new Terminal());await input(f,a,'核对记忆状态')
 assert.equal(seen.length,4);assert.equal(retired(a).length,0,'unchanged tool steps must not accumulate retired context placeholders')
 assert.equal(new Set(seen.map(r=>r.messages.find(m=>m.source?.kind==='runtime-context').id)).size,1)
 }finally{await f.dispose()}
})

test('empty first-step decisions do not retire a context or manufacture a later request',async()=>{
 const f=await host();let remove
 try{const a=await f.create();ok(await f.command(a,'start'));await input(f,a,'你好')
 remove=f.ctx.on('agent/pre-step',async(payload,next)=>{const d=await next();return d.kind==='enter'?{...d,messages:[]}:d})
 await input(f,a,'被宿主取消的输入');assert.equal(f.calls(),1);assert.equal(retired(a).length,0,'an empty step must not change the model surface')
 }finally{remove?.();await f.dispose()}
})

test('request policy bounds a tool loop without deleting the completed tool history',async()=>{
 const f=await host({requestLimits:{maxRequestsPerInput:3,maxRetriesPerStep:1}}),seen=[]
 class Terminal extends LlmAdapter{async *stream(options){seen.push(options);if(seen.length<6){yield {type:'tool-call-delta',index:0,id:'loop_'+seen.length,name:'rp_memory_status',argumentsDelta:'{}'};yield {type:'finish',reason:{kind:'tool-calls'}}}else yield {type:'finish',reason:{kind:'stop'}}}}
 try{const a=await f.create();ok(await f.command(a,'start'));a.options.provider='cost-bound';f.ctx.llm.registerAdapter(['cost-bound'],new Terminal());await input(f,a,'核对状态')
 assert.equal(seen.length,3,'the fourth request must stop before reaching the adapter');assert.equal(a.session.deriveMessages().filter(m=>m.role==='tool').length,3)
 assert.equal(f.rp.status(a.id).requestCost.stopReason,'request_limit');assert.equal(f.rp.status(a.id).requestCost.requests,3)
 }finally{await f.dispose()}
})

test('a host retry handler cannot retry a failing step past the configured limit',async()=>{
 const f=await host({requestLimits:{maxRequestsPerInput:6,maxRetriesPerStep:1}});let calls=0,remove
 class Terminal extends LlmAdapter{async *stream(){calls++;if(calls<5)yield {type:'finish',reason:{kind:'error',failure:{code:'offline_failure',message:'scripted transient failure',retryable:true}}};else yield {type:'finish',reason:{kind:'stop'}}}}
 try{const a=await f.create();ok(await f.command(a,'start'));a.options.provider='cost-retry';f.ctx.llm.registerAdapter(['cost-retry'],new Terminal());remove=f.ctx.on('agent/request-error',async()=>({kind:'retry'}));await input(f,a,'测试错误恢复')
 assert.equal(calls,2,'one initial request plus at most one retry');assert.equal(f.rp.status(a.id).requestCost.stopReason,'retry_limit')
 }finally{remove?.();await f.dispose()}
})

test('a new explicit input receives its own allowance after a failed input',async()=>{
 const f=await host({requestLimits:{maxRequestsPerInput:1,maxRetriesPerStep:0}});let calls=0,remove
 class Terminal extends LlmAdapter{async *stream(){calls++;yield {type:'finish',reason:{kind:'error',failure:{code:'offline_failure',message:'offline',retryable:true}}}}}
 try{const a=await f.create();ok(await f.command(a,'start'));a.options.provider='new-input';f.ctx.llm.registerAdapter(['new-input'],new Terminal());remove=f.ctx.on('agent/request-error',async()=>({kind:'retry'}));await input(f,a,'第一次');await input(f,a,'我已检查，另发一个明确请求')
 assert.equal(calls,2);assert.equal(f.rp.status(a.id).requestCost.requests,1)
 }finally{remove?.();await f.dispose()}
})

test('cost allowance survives a genuine cold restore and resume alone sends nothing',async()=>{
 const f=await host({requestLimits:{maxRequestsPerInput:1,maxRetriesPerStep:0}});let cold,disposed=false
 try{const a=await f.create();ok(await f.command(a,'start'));await input(f,a,'一轮');const before=f.rp.status(a.id).requestCost;await f.drop(a);await f.dispose();disposed=true
 cold=await host({requestLimits:{maxRequestsPerInput:1,maxRetriesPerStep:0}},{directory:path.dirname(f.profile)});const resumed=await cold.resume(a);assert.equal(cold.calls(),0);assert.deepEqual(cold.rp.status(a.id).requestCost,before)
 await input(cold,resumed,'明确的新输入');assert.equal(cold.calls(),1);assert.equal(cold.rp.status(a.id).requestCost.requests,1)
 }finally{await cold?.dispose();if(!disposed)await f.dispose()}
})

test('failed reservation persistence does not reach the adapter and leaves diagnosis available',async()=>{
 const f=await host(),rename=fs.rename;let armed=false
 try{const a=await f.create();ok(await f.command(a,'start'))
 fs.rename=async(from,to)=>{if(String(to).includes(path.join('v1','host'))){const envelope=JSON.parse(await fs.readFile(from,'utf8'));if(envelope.data?.requestCost?.requests){armed=true;throw Object.assign(Error('COST_RESERVATION_WRITE_FAILED'),{code:'EIO'})}}return rename(from,to)}
 await input(f,a,'写入失败不能调用');assert.equal(armed,true);assert.equal(f.calls(),0);assert.equal(f.rp.status(a.id).blocked,true);ok(await f.command(a,'status'))
 }finally{fs.rename=rename;await f.dispose()}
})

test('organizer commands are explicit, reuse candidates, and consume no additional model requests',async()=>{
 const f=await host();try{const a=await f.create();ok(await f.command(a,'start'));await input(f,a,'请保留我的原话：下周五一起看星星。')
 const first=JSON.parse(ok(await f.command(a,'organize summary'))),again=JSON.parse(ok(await f.command(a,'organize summary')))
 assert.equal(first.id,again.id);assert.equal(first.modelCalls,0);assert.equal(first.requiresConfirmation,true)
 const h=JSON.parse(ok(await f.command(a,'organize handoff')));assert.match(h.userQuotes[0].text,/下周五/)
 ok(await f.command(a,'organize review'));assert.equal(f.calls(),1);assert.equal(f.rp.status(a.id).requestCost.requests,1)
 }finally{await f.dispose()}
})

test('a native history change during durable request reservation is checked before adapter admission',async()=>{
 const f=await host(),rename=fs.rename;let injected=false
 try{const a=await f.create();ok(await f.command(a,'start'))
 fs.rename=async(from,to)=>{if(!injected&&String(to).includes(path.join('v1','host'))){const envelope=JSON.parse(await fs.readFile(from,'utf8'));if(envelope.data?.requestCost?.requests){injected=true;a.session.append('user/message',{id:'racing_native_input',role:'user',source:{kind:'user'},content:[{type:'text',text:'arrival during reservation'}]},{surfaceOp:'append'})}}return rename(from,to)}
 await input(f,a,'只有这个明确请求获得授权');assert.equal(injected,true);assert.equal(f.calls(),0,'no request may use pre-reservation queue certification after its queue changed')
 }finally{fs.rename=rename;await f.dispose()}
})
