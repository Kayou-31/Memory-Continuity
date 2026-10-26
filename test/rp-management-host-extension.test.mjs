import test from 'node:test'
import assert from 'node:assert/strict'
process.env.RP_ACCEPTANCE_LOOPBACK='1'
const {host:nativeHost}=await import('./fixtures/rp/native-host.mjs')
const {pathToFileURL}=await import('node:url'),{resolve}=await import('node:path')
const bundle=process.env.RP_PERSON_BUNDLE?await import(pathToFileURL(resolve(process.env.RP_PERSON_BUNDLE))):undefined
const host=(config={},hooks={})=>nativeHost(config,{...hooks,...(bundle?{install:bundle.installRpPlugin}:{})})
const ok=r=>{assert.equal(r.kind,'success',r.text);return JSON.parse(r.text)}
test('summary candidates interoperate between native commands and workbench with the same policy epoch',async()=>{
 const f=await host({entityIds:['erin']});try{
  const a=await f.create();await f.command(a,'start');
  assert.equal((await f.command(a,'input 周五一起去看星星。')).kind,'success')
  for(let i=0;i<250&&a.status!=='idle';i++)await new Promise(resolve=>setTimeout(resolve,20));assert.equal(a.status,'idle')
  const url=new URL(ok(await f.command(a,'person manage')).url),token=url.hash.slice(1);url.hash=''
  const call=async(route,input={})=>{const r=await fetch(new URL('api/'+route,url),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)}),body=await r.json();assert.equal(body.ok,true,JSON.stringify(body));return body.value}
  const candidate=ok(await f.command(a,'organize summary')),s=await call('snapshot')
  assert.equal((await call('organize',{snapshotId:s.id,operation:'candidate',candidateId:candidate.id})).id,candidate.id)
  const web=await call('organize',{snapshotId:s.id,operation:'summary'});assert.equal((await f.command(a,'candidate '+web.id)).kind,'success')
  const p=await call('prepare',{snapshotId:s.id,action:'summary-adopt',payload:{candidateId:candidate.id}});await call('confirm',{id:p.id})
  assert.equal(f.calls(),1)
 }finally{await f.dispose()}
})
test('native workbench previews and commits actual budget/binding settings without nested locks or provider calls',async()=>{
 const f=await host({entityIds:['erin']});try{
  const a=await f.create();await f.command(a,'start');const p=ok(await f.command(a,'person preview '+JSON.stringify({schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]})));await f.command(a,'person confirm '+p.previewId)
  const url=new URL(ok(await f.command(a,'person manage')).url),token=url.hash.slice(1);url.hash=''
  const call=async(route,input={})=>{const r=await fetch(new URL('api/'+route,url),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)}),body=await r.json();assert.equal(body.ok,true,JSON.stringify(body));return body.value}
  for(const [action,payload]of [['host-person',{personId:'erin'}],['host-injection',{config:{}}],['host-budget',{config:{limitTokens:12000}}],['host-mode',{mode:'companion'}],['host-module',{moduleId:'recall',enabled:true}],['host-module',{moduleId:'person-view',enabled:true}],['host-module',{moduleId:'recall',enabled:false}],['host-constraints',{constraints:{guidance:[{id:'gentle',text:'提出建议之前，先听对方说完。'}]}}]]){
   const s=await call('snapshot'),p=await call('prepare',{snapshotId:s.id,action,payload});assert.ok(p.impact.changes.length);const saved=await call('confirm',{id:p.id});assert.deepEqual(await call('confirm',{id:p.id}),saved)
  }
  const s=await call('snapshot');assert.equal(s.context.personId,'erin');assert.equal(s.context.memoryBudget.limitTokens,12000);assert.equal(s.context.memoryBudget.meter.mode,'conservative-utf8');assert.equal(f.calls(),0)
  assert.equal(s.context.mode,'companion');assert.deepEqual(s.context.config.enabledModules,['person-view']);assert.equal(s.context.config.constraints.guidance[0].text,'提出建议之前，先听对方说完。')
  const u=await call('upload',{personId:'erin',documentId:'notes',title:'原文',mime:'text/plain',encoding:'utf8',base64:Buffer.from('通过短句柄确认').toString('base64')})
  const preview=ok(await f.command(a,'document preview '+u.id));await f.command(a,'document confirm '+preview.id);assert.equal((await call('read',{kind:'document',personId:'erin',id:'notes'})).draft.text,'通过短句柄确认')
 }finally{await f.dispose()}
})

test('native workbench refuses a stale budget review after person edits and preserves the old binding',async()=>{
 const f=await host({entityIds:['erin']});try{
  const a=await f.create();await f.command(a,'start');const p=ok(await f.command(a,'person preview '+JSON.stringify({schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]})));await f.command(a,'person confirm '+p.previewId)
  const url=new URL(ok(await f.command(a,'person manage')).url),token=url.hash.slice(1);url.hash=''
  const call=async(route,input={})=>(await fetch(new URL('api/'+route,url),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)})).json()
  const s=(await call('snapshot')).value,budget=(await call('prepare',{snapshotId:s.id,action:'host-budget',payload:{config:{limitTokens:9000}}})).value
  const module=(await call('prepare',{snapshotId:s.id,action:'host-module',payload:{moduleId:'growth-review',enabled:true}})).value
  const change=(await call('prepare',{snapshotId:s.id,action:'edit',payload:{personId:'erin',fieldId:'name',value:'林川',note:'明确改名'}})).value;assert.equal((await call('confirm',{id:change.id})).ok,true)
  const stale=await call('confirm',{id:budget.id});assert.equal(stale.ok,false);assert.equal(stale.code,'stale_input');assert.equal((await call('snapshot')).value.context.memoryBudget,null);assert.equal(f.calls(),0)
  assert.equal((await call('confirm',{id:module.id})).code,'stale_input');assert.equal(f.rp.status(a.id).purpose?.enabledModules?.length??0,0)
  const fresh=(await call('snapshot')).value,late=(await call('prepare',{snapshotId:fresh.id,action:'host-module',payload:{moduleId:'recall',enabled:true}})).value
  assert.equal((await f.command(a,'input 新聊天已经开始。')).kind,'success');await a.whenIdle()
  assert.equal((await call('confirm',{id:late.id})).ok,false);assert.equal(f.rp.status(a.id).purpose?.enabledModules?.length??0,0)
 }finally{await f.dispose()}
})
