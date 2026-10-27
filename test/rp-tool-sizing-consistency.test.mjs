import test from 'node:test'
import assert from 'node:assert/strict'
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {host} from './fixtures/rp/native-host.mjs'
const ok=r=>{assert.equal(r.kind,'success',r.text);return r.text}
const value=r=>JSON.parse(ok(r))

test('native tools can reuse a necessary context occupying about sixty percent without reserving it twice',async()=>{
 const f=await host({entityIds:['erin']}),requests=[],usages=[];let calls=0
 class Terminal extends LlmAdapter {async *stream(options){
  requests.push(options);usages.push(f.rp.status(options.sessionId).memoryUsage);calls++
  for(const result of options.messages.filter(m=>m.role==='tool'))assert.doesNotMatch(result.content[0].text,/budget_exceeded|receipt cannot fit/)
  if(calls<=3){yield {type:'tool-call-delta',index:0,id:'sizing_status_'+calls,name:'rp_memory_status',argumentsDelta:'{}'};yield {type:'finish',reason:{kind:'tool-calls'}}}
  else {yield {type:'text-delta',index:0,text:'必要人物内容和三个小工具均保留'};yield {type:'finish',reason:{kind:'stop'}}}
 }}
 try {
  const a=await f.create();ok(await f.command(a,'start'));a.options.provider='sizing-loop';f.ctx.llm.registerAdapter(['sizing-loop'],new Terminal())
  const fields=[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'},...Array.from({length:4},(_,i)=>({fieldId:'voice_'+i,kind:'voice',value:'Required voice '+i+' '+String.fromCharCode(65+i).repeat(1700),policy:'stable'}))]
  const p=value(await f.command(a,'person preview '+JSON.stringify({schemaVersion:1,kind:'person-draft',personId:'erin',fields,relationships:[],goals:[]})))
  ok(await f.command(a,'person confirm '+p.previewId));ok(await f.command(a,'person use erin'));ok(await f.command(a,'injection set {}'))
  ok(await f.command(a,'budget set '+JSON.stringify({limitTokens:32768,layers:{self:24000}})))
  const limit=32768
  ok(await f.command(a,'input 你好'));await a.whenIdle();await f.rp.ready(a.id).catch(()=>{})
  assert.equal(calls,4,JSON.stringify(f.rp.status(a.id)))
  assert.ok(usages[0].total/limit>.55&&usages[0].total/limit<.8,JSON.stringify(usages[0]))
  for(const [index,request] of requests.entries()){
   const full=request.messages.filter(m=>m.source?.kind==='runtime-context'&&m.content.some(c=>c.text?.includes('"rpPacketId":')))
   assert.equal(full.length,1);for(const f of fields)assert.ok(full[0].content[0].text.includes(f.value),'mandatory field omitted: '+f.fieldId)
   assert.ok(usages[index].total<=limit)
  }
 } finally {await f.dispose()}
})
