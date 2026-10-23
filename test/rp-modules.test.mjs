import test from 'node:test'
import assert from 'node:assert/strict'
import {setup,must} from './fixtures/rp/growth.mjs'
const config=(extra={})=>({mode:'rp',enabledModules:['person-view','recall','growth-review'],constraints:{},...extra})
async function person(f){const p=must(await f.person.preview(f.authority,{schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'},{fieldId:'care',kind:'trait',value:'谨慎',policy:'growable'}],relationships:[],goals:[]},'init'));must(await f.person.confirm(f.authority,p.handle,await f.controlSource('init')))}
test('module registry and dual-layer constraints reject unknown grants; core survives revoke',async()=>{
 const f=await setup();try{await person(f);assert.ok(f.modules,'M3 module runtime missing')
  assert.throws(()=>f.modules.create(f.authority,config({enabledModules:['shell']})))
  assert.throws(()=>f.modules.create(f.authority,config({constraints:{autoAdopt:true}})))
  assert.throws(()=>f.modules.create(f.authority,config({constraints:{maxReadRecords:33}})))
  const rt=f.modules.create(f.authority,config({constraints:{deniedCapabilities:['read-person']}}))
  await assert.rejects(rt.run('person-view',{personId:'erin'}),/capability/i)
  rt.revoke();await assert.rejects(rt.run('recall',{query:'林澈'}),/revoked/i)
  assert.equal(must(await f.person.read(f.authority,'erin')).fields.find(x=>x.fieldId==='name').value,'林澈')
 }finally{await f.close()}
})
test('module evidence binds actual result, module version, fence and identity; mutation cannot be certified',async()=>{
 const f=await setup();try{await person(f);const rt=f.modules.create(f.authority,config()),other=f.modules.create(f.authority,config())
  const r=await rt.run('person-view',{personId:'erin'}),p=await rt.verify(r)
  assert.equal(p.moduleId,'person-view');assert.equal(p.moduleVersion,'1.0.0');assert.ok(p.records.length);assert.equal(p.execution,'core-only')
  await assert.rejects(other.verify(r));await assert.rejects(rt.verify(structuredClone(r)))
  r.value.fields[0].value='tampered';await assert.rejects(rt.verify(r))
  const search=await rt.run('recall',{query:'林澈'});assert.ok(search.value.items.length);assert.equal((await rt.verify(search)).records.length,search.value.items.length)
  await f.experience('later','后来');await assert.rejects(rt.verify(search),/changed/i)
 }finally{await f.close()}
})
test('module invocation revokes while queued',async()=>{
 const f=await setup();try{await person(f);const rt=f.modules.create(f.authority,config()),release=await f.coordinator.lock()
  const p=rt.run('person-view',{personId:'erin'});rt.revoke();release();await assert.rejects(p,/revoked/i)
 }finally{await f.close()}
})
test('module context is an exact capability and revocation invalidates prepared packets',async()=>{
 const f=await setup();try{
  const rt=f.modules.create(f.authority,config()),budget={recentCompleteTurns:8,targetTotalTokens:48000,triggerTotalTokens:72000,outputReserveTokens:8192,toolReserveTokens:2048,packetSoftTokens:8000,contextWindow:100000,inputLimit:90000}
  const args={budget,globalAuthorities:[],inputBindings:[],runtime:rt.context()}
  assert.equal((await f.packets.prepare(f.authority,{...args,runtime:structuredClone(args.runtime)})).ok,false)
  const packet=must(await f.packets.prepare(f.authority,args));rt.revoke()
  assert.equal((await f.packets.admit(f.authority,packet,{})).ok,false)
 }finally{await f.close()}
})
test('in-flight module verification and packet admission recheck capabilities and actual contents',async()=>{
 const f=await setup();try{await person(f);const rt=f.modules.create(f.authority,config())
  const result=await rt.run('person-view',{personId:'erin'}),verify=rt.verify(result);result.value.fields[0].value='changed during await';await assert.rejects(verify)
  const budget={recentCompleteTurns:8,targetTotalTokens:48000,triggerTotalTokens:72000,outputReserveTokens:8192,toolReserveTokens:2048,packetSoftTokens:8000,contextWindow:100000,inputLimit:90000}
  const packet=must(await f.packets.prepare(f.authority,{budget,globalAuthorities:[],inputBindings:[],runtime:rt.context()})),admit=f.packets.admit(f.authority,packet,{})
  rt.revoke();assert.equal((await admit).ok,false)
 }finally{await f.close()}
})
test('packet preparation captures the original runtime capability before awaiting the read view',async()=>{
 const f=await setup();try{const a=f.modules.create(f.authority,config()),b=f.modules.create(f.authority,config({mode:'creation'})),budget={recentCompleteTurns:8,targetTotalTokens:48000,triggerTotalTokens:72000,outputReserveTokens:8192,toolReserveTokens:2048,packetSoftTokens:8000,contextWindow:100000,inputLimit:90000}
  const args={budget,globalAuthorities:[],inputBindings:[],runtime:a.context()},pending=f.packets.prepare(f.authority,args);args.runtime=b.context();a.revoke()
  assert.equal((await pending).ok,false)
 }finally{await f.close()}
})
test('module rejects data invalidated by a second writer while assembling a person view',async()=>{
 const f=await setup();let cold;try{await person(f);cold=await setup(f.directory,f.request)
  const rt=f.modules.create(f.authority,config()),original=f.store.withReadView;let once=true
  f.store.withReadView=(a,work,options)=>original(a,async view=>{const value=await work(view);if(once){once=false;await cold.experience('concurrent','另一进程的新事实')}return value},options)
  await assert.rejects(rt.run('person-view',{personId:'erin'}),/changed/i)
 }finally{await cold?.close();await f.close()}
})
test('growth module only creates review candidates; protected fields and output budgets reject before publication',async()=>{
 const f=await setup();try{await person(f);const cause=await f.experience('cause','独立完成远行'),head=must(await f.person.read(f.authority,'erin')).fields.find(x=>x.fieldId==='care')
  const proposal={changes:[{changeId:'care',personId:'erin',fieldId:'care',previousEventId:head.eventId,value:'敢于探索',causeEventIds:[cause],note:'有依据的候选'}]}
  const guarded=f.modules.create(f.authority,config({constraints:{protectedFieldIds:['care']}}))
  await assert.rejects(guarded.run('growth-review',proposal,'blocked'));assert.equal(must(await f.person.list(f.authority)).length,0)
  const rt=f.modules.create(f.authority,config());const r=await rt.run('growth-review',proposal,'candidate');assert.ok(r.value.id.startsWith('person_candidate_'));await rt.verify(r)
  const payloadBytes=Buffer.byteLength(JSON.stringify({value:r.value})),limited=f.modules.create(f.authority,config({constraints:{maxOutputBytes:Math.max(1024,payloadBytes)}}))
  await assert.rejects(limited.run('growth-review',proposal,'receipt_budget'));assert.equal(must(await f.person.list(f.authority)).length,1)
  assert.equal(must(await f.person.read(f.authority,'erin')).fields.find(x=>x.fieldId==='care').value,'谨慎')
  const small=f.modules.create(f.authority,config({constraints:{maxOutputBytes:1024}})),large=structuredClone(proposal);large.changes[0].note='证据'.repeat(600)
  await assert.rejects(small.run('growth-review',large,'large'));assert.equal(must(await f.person.list(f.authority)).length,1)
  rt.revoke();assert.equal(must(await f.person.list(f.authority)).length,1)
 }finally{await f.close()}
})
