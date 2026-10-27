import test from 'node:test'
import assert from 'node:assert/strict'
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {host} from './fixtures/rp/native-host.mjs'
const ok=r=>{assert.equal(r.kind,'success',r.text);return r.text},value=r=>JSON.parse(ok(r))
test('native everyday requests carry explicit core, edits block stale history, clean continuation refreshes the core',async()=>{
 const f=await host({entityIds:['erin','bea']}),requests=[]
 class Terminal extends LlmAdapter{async *stream(options){requests.push(options);yield {type:'text-delta',index:0,text:'收到。'};yield {type:'finish',reason:{kind:'stop'}}}}
 try{
  const a=await f.create();ok(await f.command(a,'start'));const draft={schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'},{fieldId:'trait',kind:'trait',value:'CORE_CURIOSITY 温柔但有独立判断。',policy:'growable',injection:'core'},{fieldId:'past',kind:'background',value:'UNRELATED_BACKGROUND',policy:'stable'}],relationships:[],goals:[]}
  const p=value(await f.command(a,'person preview '+JSON.stringify(draft)));ok(await f.command(a,'person confirm '+p.previewId));const other=value(await f.command(a,'person preview '+JSON.stringify({...draft,personId:'bea',fields:[{fieldId:'name',kind:'identity',value:'OTHER_PERSON_ONLY',policy:'stable'}]})));ok(await f.command(a,'person confirm '+other.previewId))
  ok(await f.command(a,'person use erin'));ok(await f.command(a,'injection set {}'));f.ctx.llm.registerAdapter(['core-test'],new Terminal());a.options.provider='core-test'
  let expectedCalls=0
  for(const query of ['你好','天气怎么样','今天工作有点忙']){ok(await f.command(a,'input '+query));await a.whenIdle();await f.rp.ready(a.id);assert.equal(requests.length,++expectedCalls,JSON.stringify(f.rp.status(a.id)));const sent=JSON.stringify(requests.at(-1));assert.match(sent,/CORE_CURIOSITY/);assert.doesNotMatch(sent,/UNRELATED_BACKGROUND|OTHER_PERSON_ONLY/);for(const sourceId of f.rp.status(a.id).candidateIds)ok(await f.command(a,'accept '+sourceId))}
  assert.equal(requests.length,3)
  const person=value(await f.command(a,'person show erin')),field=person.fields.find(f=>f.fieldId==='trait');ok(await f.command(a,'person edit '+JSON.stringify({personId:'erin',fieldId:'trait',previousEventId:field.eventId,value:'CORE_REVISED 愿意主动表达自己的意见。',note:'确认的调整'})))
  ok(await f.command(a,'input 不得带入旧核心'));await a.whenIdle();await f.rp.ready(a.id).catch(()=>{});assert.equal(requests.length,3)
  const fresh=ok(await f.command(a,'continue-clean')),next=f.ctx.agents.get(/created: (\w+)/.exec(fresh)[1]);next.options.provider='core-test';ok(await f.command(next,'input 你好'));await next.whenIdle();await f.rp.ready(next.id);assert.equal(requests.length,4);assert.match(JSON.stringify(requests[3]),/CORE_REVISED/);assert.doesNotMatch(JSON.stringify(requests[3]),/CORE_CURIOSITY|UNRELATED_BACKGROUND/)
 }finally{await f.dispose()}
})
