import test from 'node:test'
import assert from 'node:assert/strict'
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {host as nativeHost} from './fixtures/rp/native-host.mjs'
import {pathToFileURL} from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
const bundle=process.env.RP_PERSON_BUNDLE?await import(pathToFileURL(path.resolve(process.env.RP_PERSON_BUNDLE))):undefined
const host=c=>nativeHost(c,bundle?{install:bundle.installRpPlugin}:{})
const ok=r=>{assert.equal(r.kind,'success',r.text);return r.text},value=r=>JSON.parse(ok(r))
async function setup(f){const a=await f.create();ok(await f.command(a,'start'));const p=value(await f.command(a,'person preview '+JSON.stringify({schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'},{fieldId:'past',kind:'background',value:'钟楼旁长大',policy:'stable'}],relationships:[],goals:[]})));ok(await f.command(a,'person confirm '+p.previewId));ok(await f.command(a,'person use erin'));ok(await f.command(a,'injection set {}'));return a}
async function input(f,a,text){ok(await f.command(a,'input '+text));await a.whenIdle();await f.rp.ready(a.id);for(const id of f.rp.status(a.id).candidateIds)ok(await f.command(a,'accept '+id))}
const packetMessages=r=>r.messages.filter(m=>m.source?.kind==='runtime-context'&&m.content.some(c=>c.text?.includes('"rpPacketId":')))
test('native follow-up carries one latest memory packet while all original snapshots and conversation stay auditable',async()=>{
 const f=await host({entityIds:['erin']}),seen=[]
 class Terminal extends LlmAdapter{async *stream(options){seen.push(options);yield {type:'text-delta',index:0,text:'离线回复'};yield {type:'finish',reason:{kind:'stop'}}}}
 try{const a=await setup(f);a.options.provider='cost-test';f.ctx.llm.registerAdapter(['cost-test'],new Terminal());await input(f,a,'钟楼');await input(f,a,'今天天气');await input(f,a,'继续聊聊');assert.equal(seen.length,3)
  if(process.env.RP_COST_METRICS_PATH)await fs.writeFile(process.env.RP_COST_METRICS_PATH,JSON.stringify({requests:seen.map(r=>({requestUtf8Bytes:Buffer.byteLength(JSON.stringify(r)),runtimeContextUtf8Bytes:Buffer.byteLength(JSON.stringify(r.messages.filter(m=>m.source?.kind==='runtime-context'))),packets:packetMessages(r).length})),paidModelCalls:0},null,2))
  for(const req of seen)assert.equal(packetMessages(req).length,1,'old memory packets must not be repeatedly sent')
  assert.equal(a.session.snapshotEvents().filter(e=>e.type==='user/message'&&e.surfaceOp==='append'&&e.data.source?.kind==='runtime-context').length,3,'original memory snapshots must remain in append-only log')
  assert.equal(seen[2].messages.filter(m=>m.source?.kind==='user').length,3);assert.equal(seen[2].messages.filter(m=>m.role==='assistant').length,2)
  const last=packetMessages(seen[2])[0].source.sections.find(s=>s.name==='rp-memory');assert.deepEqual(JSON.parse(last.text).recentAcceptedOriginals,[],'host already carries originals; memory packet must not duplicate them')
 }finally{await f.dispose()}
})
test('preview discloses first-load then follow-up optional allowance without consuming a model call',async()=>{
 const f=await host({entityIds:['erin']});try{const a=await setup(f);ok(await f.command(a,'budget set {}'));const first=value(await f.command(a,'injection preview 钟楼'));assert.equal(first.delivery.phase,'initial');assert.equal(first.delivery.optionalLimit,32768);assert.equal(f.calls(),0)
 await input(f,a,'你好');const later=value(await f.command(a,'injection preview 钟楼'));assert.equal(later.delivery.phase,'followup');assert.equal(later.delivery.optionalLimit,2048);assert.equal(f.calls(),1)
 }finally{await f.dispose()}
})

test('retirement preserves foreign context sections byte-for-byte and does not hide a stale original proof',async()=>{
 const f=await host({entityIds:['erin']}),seen=[]
 class Terminal extends LlmAdapter{async *stream(options){seen.push(options);yield {type:'text-delta',index:0,text:'已记录'};yield {type:'finish',reason:{kind:'stop'}}}}
 try{f.ctx.systemPrompt.context({name:'foreign-test',order:10,text:'FOREIGN_CONTEXT_DO_NOT_DROP',interpolate:false});const a=await setup(f);a.options.provider='foreign-test';f.ctx.llm.registerAdapter(['foreign-test'],new Terminal());await input(f,a,'钟楼');await input(f,a,'天气')
  assert.equal(seen.length,2);const old=seen[1].messages.find(m=>m.id.startsWith('retired_'));assert.ok(old);assert.equal(old.source.sections[0].text,'FOREIGN_CONTEXT_DO_NOT_DROP');assert.match(old.content[0].text,/FOREIGN_CONTEXT_DO_NOT_DROP/);assert.doesNotMatch(old.content[0].text,/钟楼旁长大/)
  const p=value(await f.command(a,'person show erin')),field=p.fields.find(x=>x.fieldId==='past');ok(await f.command(a,'person edit '+JSON.stringify({personId:'erin',fieldId:'past',previousEventId:field.eventId,value:'海港旁长大',note:'更正'})))
  const preview=value(await f.command(a,'injection preview 天气'));assert.ok(preview.history.some(h=>h.messageId===old.id&&h.status==='blocked'))
  ok(await f.command(a,'input 不能绕过历史失效'));await a.whenIdle();await f.rp.ready(a.id).catch(()=>{});assert.equal(seen.length,2)
 }finally{await f.dispose()}
})
test('retired context survives a genuine cold restore and forged replacement references are rejected',async()=>{
 const f=await host({entityIds:['erin']});let cold,disposed=false
 try{const a=await setup(f);await input(f,a,'钟楼');await input(f,a,'你好');await f.drop(a);await f.dispose();disposed=true
  cold=await nativeHost({entityIds:['erin']},{directory:path.dirname(f.profile),...(bundle?{install:bundle.installRpPlugin}:{})});const resumed=await cold.resume(a)
  const preview=value(await cold.command(resumed,'injection preview 天气'));assert.equal(preview.delivery.phase,'followup');assert.ok(preview.history.some(h=>h.status==='retired'));assert.equal(preview.history.filter(h=>h.messageId.startsWith('retired_')).some(h=>h.status==='blocked'),false)
  await input(cold,resumed,'再聊一轮');assert.equal(cold.calls(),1)
  const event=resumed.session.snapshotEvents().find(e=>e.type==='user/message'&&e.data.id.startsWith('retired_')),forged=structuredClone(event.data);forged.id+='x';forged.content[0].text+=' UNAUTHORIZED_EXTRA';const seq=resumed.session.surface.nodes.find(s=>resumed.session.eventAt(s)?.data?.id===event.data.id)
  resumed.session.append('user/message',forged,{surfaceOp:{op:'replace',startSeq:seq,endSeq:seq},sourceEventSeqs:[seq]});await cold.rp.ready(resumed.id).catch(()=>{})
  assert.equal(cold.rp.status(resumed.id).blocked,true);assert.equal((await cold.command(resumed,'input 不可发送')).kind,'error');assert.equal(cold.calls(),1)
 }finally{if(!disposed)await f.dispose();await cold?.dispose()}
})

test('persistence failure after committing a retirement blocks the next provider request without deleting the original log',async()=>{
 const f=await host({entityIds:['erin']});let undo
 try{const a=await setup(f);await input(f,a,'钟楼');const originalAppend=a.session.append.bind(a.session),originalRename=fs.rename;let retiring=false
  a.session.append=(type,data,options)=>{if(type==='user/message'&&options?.surfaceOp?.op==='replace')retiring=true;return originalAppend(type,data,options)}
  fs.rename=async(from,to)=>{if(retiring&&String(to).includes(path.join('v1','host')))throw Object.assign(Error('RETIREMENT_SAVE_FAILURE'),{code:'EIO'});return originalRename(from,to)};undo=()=>{fs.rename=originalRename;a.session.append=originalAppend}
  await f.command(a,'input 再聊一次');await a.whenIdle();await f.rp.ready(a.id).catch(()=>{});assert.equal(retiring,true);assert.equal(f.calls(),1);assert.ok(a.session.snapshotEvents().some(e=>e.type==='user/message'&&e.surfaceOp==='append'&&e.data.source?.kind==='runtime-context'));undo();undo=undefined
  const status=value(await f.command(a,'status'));assert.equal(status.blocked,true);assert.equal((await f.command(a,'continue-clean')).kind,'success')
 }finally{undo?.();await f.dispose()}
})

test('reused same-packet tool context cannot certify a request with the current full packet removed',async()=>{
 const f=await host({entityIds:['erin']}),seen=[];let calls=0
 class Terminal extends LlmAdapter{async *stream(options){seen.push(options);if(++calls===1){yield {type:'tool-call-delta',index:0,id:'cost_status',name:'rp_memory_status',argumentsDelta:'{}'};yield {type:'finish',reason:{kind:'tool-calls'}}}else{yield {type:'text-delta',index:0,text:'已核对'};yield {type:'finish',reason:{kind:'stop'}}}}}
 try{const a=await setup(f);a.options.provider='cost-loop';f.ctx.llm.registerAdapter(['cost-loop'],new Terminal());ok(await f.command(a,'input 你好'));await a.whenIdle();await f.rp.ready(a.id);assert.equal(calls,2)
  const request=seen[1],messages=request.messages.filter(m=>!packetMessages(request).includes(m));assert.equal(messages.some(m=>m.id.startsWith('retired_')),false)
  await assert.rejects(f.stream(a,{...request,messages}),/injection.static request envelope absent or changed/);assert.equal(calls,2)
 }finally{await f.dispose()}
})
test('next-request preview includes the pending retired marker in actual memory accounting',async()=>{
 const f=await host({entityIds:['erin']});try{const a=await setup(f);ok(await f.command(a,'budget set {}'));await input(f,a,'你好');const preview=value(await f.command(a,'injection preview 钟楼'));assert.ok(preview.memoryBudget.usage.parts.some(p=>p.kind==='retired-context'&&p.count>0),'planned but uncommitted retirement must be counted')}
 finally{await f.dispose()}
})

test('a different pre-step middleware cannot drop queued input that was omitted from the memory duplicate',async()=>{
 const f=await host({entityIds:['erin']});let dispose
 try{const a=await setup(f);dispose=f.ctx.on('agent/pre-step',async(payload,next)=>{const decision=await next();return decision.kind==='enter'?{...decision,messages:decision.messages.filter(m=>m.source.kind!=='user')}:decision})
  ok(await f.command(a,'input 必须真的收到这句话'));await a.whenIdle();await f.rp.ready(a.id).catch(()=>{});assert.equal(f.calls(),0,'source receipt alone cannot prove its text was sent');assert.equal(f.rp.status(a.id).requestAdmission.state,'rejected')
 }finally{dispose?.();await f.dispose()}
})
