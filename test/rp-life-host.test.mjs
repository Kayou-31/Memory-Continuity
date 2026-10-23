import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {host} from './fixtures/rp/native-host.mjs'
const ok=r=>{assert.equal(r.kind,'success',r.text);return r.text}
test('M4 native story keeps original identity through twelve clean roots and cold resume; revoked root never dispatches',async()=>{
 const f=await host({entityIds:['erin']}),requests=[];let cold,disposed=false
 class Terminal extends LlmAdapter{async *stream(options){requests.push(options);yield {type:'text-delta',index:0,text:'离线管线验证，不代表模型表现'};yield {type:'finish',reason:{kind:'stop'}}}}
 try{
  f.ctx.llm.registerAdapter(['life'],new Terminal());let a=await f.create();a.options.provider='life';ok(await f.command(a,'start'))
  const draft={schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'},{fieldId:'boundary',kind:'boundaries',value:'不伪造经历',policy:'stable'}],relationships:[],goals:[]}
  const p=JSON.parse(ok(await f.command(a,'person preview '+JSON.stringify(draft))));ok(await f.command(a,'person confirm '+p.previewId));ok(await f.command(a,'person use erin'));ok(await f.command(a,'modules enable person-view'))
  for(let i=0;i<12;i++){
   if(i){const clean=ok(await f.command(a,'continue-clean'));a=f.ctx.agents.get(/created: (\w+)/.exec(clean)[1]);assert.equal(a.session.deriveMessages().length,0)}
   ok(await f.command(a,'input 旅程第'+i+'站'));await a.whenIdle();await f.rp.ready(a.id)
   assert.equal(requests.length,i+1);assert.match(JSON.stringify(requests[i]),/林澈/);assert.match(JSON.stringify(requests[i]),/不伪造经历/)
  }
  for(const id of f.rp.status(a.id).candidateIds)ok(await f.command(a,'accept '+id))
  assert.equal(await f.ctx.sessions.flush(a.session),true);await f.dispose();disposed=true
  cold=await host({entityIds:['erin']},{directory:path.dirname(f.profile)});cold.ctx.llm.registerAdapter(['life'],new Terminal())
  const resumed=await cold.resume(a);assert.equal(cold.rp.status(resumed.id).personId,'erin')
  const clean=ok(await cold.command(resumed,'continue-clean')),next=cold.ctx.agents.get(/created: (\w+)/.exec(clean)[1])
  ok(await cold.command(next,'input 继续旅途'));await next.whenIdle();await cold.rp.ready(next.id);assert.equal(requests.length,13)
  ok(await cold.command(next,'modules disable person-view'));assert.equal((await cold.command(next,'input 撤权后不得发送')).kind,'error');assert.equal(requests.length,13)
 }finally{if(!disposed)await f.dispose();await cold?.dispose()}
})
