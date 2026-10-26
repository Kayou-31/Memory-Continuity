/** Real pinned SDK, deterministic offline adapter. No model or billing claims. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {host} from '../../test/fixtures/rp/native-host.mjs'
const output=path.resolve(process.env.RP_LONG_REPORT??'work/task10-injection-cost/long-conversation.json')
const ok=r=>{assert.equal(r.kind,'success',r.text);return r.text},value=r=>JSON.parse(ok(r))
const bytes=x=>Buffer.byteLength(JSON.stringify(x))
test('64 explicit inputs, tool steps, cold resume and clean continuation through the native SDK',async()=>{
 let f=await host({entityIds:['erin']}),a,round=0,toolRound=-1,calls=0
 const accepted=new Set()
 const report={kind:'offline-native-adapter',paidModelCalls:0,billingVerified:false,requests:[],checkpoints:[],recoveries:[],completedInputs:0}
 const save=()=>fs.writeFile(output,JSON.stringify(report,null,2))
 class Terminal extends LlmAdapter{async *stream(options){
  calls++;const contexts=options.messages.filter(m=>m.source?.kind==='runtime-context'),packets=contexts.filter(m=>m.content.some(c=>c.text?.includes('"rpPacketId":')))
  assert.equal(packets.length,1);const textBlocks=options.messages.flatMap(m=>m.content.filter(c=>c.type==='text').map(c=>c.text))
  report.requests.push({round,call:calls,messages:options.messages.length,packets:packets.length,retired:contexts.filter(m=>m.id.startsWith('retired_')).length,requestObjectUtf8Bytes:bytes(options),messageTextUtf8Bytes:Buffer.byteLength(textBlocks.join('\n')),runtimeContextTextUtf8Bytes:Buffer.byteLength(contexts.flatMap(m=>m.content.filter(c=>c.type==='text').map(c=>c.text)).join('\n')),toolResultCount:options.messages.filter(m=>m.role==='tool').length})
  if(round%8===0&&toolRound!==round){toolRound=round;yield {type:'tool-call-delta',index:0,id:'long_status_'+round,name:'rp_memory_status',argumentsDelta:'{}'};yield {type:'finish',reason:{kind:'tool-calls'}}}
  else{yield {type:'text-delta',index:0,text:`离线脚本回复 ${round}：记得核对今天的约定。`};yield {type:'finish',reason:{kind:'stop'}}}
 }}
 const install=()=>f.ctx.llm.registerAdapter(['long-offline'],new Terminal())
 const send=async text=>{ok(await f.command(a,'input '+text));await a.whenIdle();await f.rp.ready(a.id).catch(()=>{})}
 try{
  a=await f.create();a.options.provider='long-offline';install();ok(await f.command(a,'start'))
  const p=value(await f.command(a,'person preview '+JSON.stringify({schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'},{fieldId:'past',kind:'background',value:'钟楼旁长大，约定每周一起看星星。',policy:'stable'}],relationships:[],goals:[]})))
  ok(await f.command(a,'person confirm '+p.previewId));ok(await f.command(a,'person use erin'));ok(await f.command(a,'injection set {}'));ok(await f.command(a,'budget set {}'))
  for(round=1;round<=64;round++){
   if(round===25){const directory=path.dirname(f.profile),old=a;await f.drop(a);await f.dispose();f=await host({entityIds:['erin']},{directory});install();a=await f.resume(old);report.recoveries.push({round,kind:'cold-resume',callsBefore:calls,callsAfter:calls})}
   if(round===41){const prior=f.rp.status(a.id),r=ok(await f.command(a,'continue-clean')),id=/created: ([^.]+)\./u.exec(r)?.[1];assert.ok(id);a=f.ctx.agents.get(id);assert.ok(a);assert.equal(f.rp.status(a.id).branchId,prior.branchId);assert.equal(a.session.deriveMessages().length,0);report.recoveries.push({round,kind:'explicit-clean-continuation',branchId:prior.branchId})}
   const before=calls,started=performance.now();await send(`第 ${round} 天，我的原话是：今天继续记录我们一起看星星的约定；不要把别人的经历算给我。`)
   if(calls===before||f.rp.status(a.id).blocked||f.rp.status(a.id).requestAdmission.state==='rejected'){report.stopped={round,status:f.rp.status(a.id)};await save();assert.fail('input was blocked; see long-conversation.json')}
   const candidates=f.rp.status(a.id).candidateIds;for(const id of candidates)if(!accepted.has(id)){ok(await f.command(a,'accept '+id));accepted.add(id)}
   report.completedInputs=round;await save()
   if(round%16===0){report.checkpoints.push({round,durationMs:performance.now()-started,status:f.rp.status(a.id)});await save();console.log('completed inputs',round,'adapter calls',calls)}
  }
  report.adapterCalls=calls;report.lastStatus=f.rp.status(a.id);await save()
 }finally{await save();await f.dispose()}
})
