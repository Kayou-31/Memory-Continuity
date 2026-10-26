import test from 'node:test'
import assert from 'node:assert/strict'
import {setup,must,deny} from './fixtures/rp/growth.mjs'
const batch=(expected,ids,key)=>({schemaVersion:1,idempotencyKey:key,expected,nextContextRevision:expected.contextRevision+1,sourceBindings:[],events:[],summaries:[],jobs:[],invalidatedIds:ids,authorityChanges:[]})
async function secretEvent(f){
 const request={...f.request,visibility:{...f.request.visibility,audienceSetId:'secret'},audienceSetIds:['public','secret']},authority=must(await f.control.authorize(request)),s=must(await f.store.observeSource(authority,{idempotencyKey:'secret_ctl',origin:'user_control',role:'user_control',publicText:'PRIVATE_ORIGINAL',turnId:'secret_turn'}))
 must(await f.canonical.applyControl(authority,s,{kind:'accept',sourceRevisionIds:[s.id],events:[{id:'secret_event',epistemic:'world',payload:{kind:'occurrence',actorIds:['erin'],description:'PRIVATE_EVENT'}}],idempotencyKey:'secret_event',expected:must(await f.store.readFence(authority))}))
 return {request,authority,source:s}
}
test('public read/commit cannot explicitly invalidate a known secret event; no fence or data change',async()=>{
 const f=await setup();try{const secret=await secretEvent(f),narrow=must(await f.control.authorize({...f.request,permissions:['read','commit']})),before=await f.fence()
  deny(await f.store.commit(narrow,batch(before,['secret_event'],'attack')),'scope_denied');assert.deepEqual(await f.fence(),before);assert.equal(must(await f.store.readEvents(secret.authority))[0].id,'secret_event')
 }finally{await f.close()}
})
test('control still needs the target audience and current branch; unknown and source IDs cannot be smuggled into invalidatedIds',async()=>{
 const f=await setup();try{const secret=await secretEvent(f),broad=must(await f.control.authorize({...f.request,audienceSetIds:['public','secret']}))
  for(const [authority,ids,key]of [[f.authority,['secret_event'],'narrow_control'],[broad,['secret_event'],'public_partition'],[secret.authority,['missing_event'],'unknown'],[secret.authority,[secret.source.id],'source']])deny(await f.store.commit(authority,batch(await f.fence(),ids,key)),'scope_denied')
  const other=must(await f.control.createBranch(f.request.workspaceId,f.request.campaignId)),oa=must(await f.control.authorize({...secret.request,branchId:other.id}));deny(await f.store.commit(oa,batch(must(await f.store.readFence(oa)),['secret_event'],'other_branch')),'scope_denied')
 }finally{await f.close()}
})
test('authorized direct event invalidation preserves source evidence and an independent fixed child',async()=>{
 const f=await setup();try{const event=await f.experience('event','保留的原始经历'),manifest=must(await f.canonical.forkManifest(f.authority,(await f.fence()).contextRevision)),child=must(await f.canonical.forkBranch(f.authority,{...manifest,idempotencyKey:'child'})),ca=must(await f.control.authorize({...f.request,branchId:child.id})),before=must(await f.store.readAcceptedSources(f.authority))
  must(await f.store.commit(f.authority,batch(await f.fence(),[event],'authorized')));assert.ok(!must(await f.store.readEvents(f.authority)).some(e=>e.id===event));assert.ok(must(await f.store.readEvents(ca)).some(e=>e.id===event));assert.deepEqual(must(await f.store.readAcceptedSources(f.authority)),before)
 }finally{await f.close()}
})

test('broad read visibility cannot retract a different audience source through dependency invalidation',async()=>{
 const f=await setup();try{
  const secret=await secretEvent(f),broad=must(await f.control.authorize({...f.request,audienceSetIds:['public','secret']}))
  const before=await f.fence(),ledger=must(await f.store.readLedger(secret.authority)),binding=ledger.sourceBindings.find(b=>b.sourceRevisionId===secret.source.id)
  assert.ok(binding);const input=batch(before,[],'cross_audience_retraction');input.sourceBindings=[{...binding,disposition:'retracted'}]
  deny(await f.store.commit(broad,input),'scope_denied')
  assert.deepEqual(await f.fence(),before);assert.ok(must(await f.store.readEvents(secret.authority)).some(e=>e.id==='secret_event'))
  assert.deepEqual(must(await f.store.readLedger(secret.authority)).sourceBindings,ledger.sourceBindings)
  const authorized=batch(before,[],'own_audience_retraction');authorized.sourceBindings=[{...binding,disposition:'retracted'}]
  must(await f.store.commit(secret.authority,authorized));assert.ok(!must(await f.store.readEvents(secret.authority)).some(e=>e.id==='secret_event'))
 }finally{await f.close()}
})

test('raw tombstones require narrator control, source write audience and a real dependency closure',async()=>{
 const f=await setup();try{
  const target=await f.experience('public','保留公开经历'),event=must(await f.store.readEvents(f.authority)).find(e=>e.id===target),sourceId=event.sources[0].sourceRevisionId
  const secret=await secretEvent(f),broad=must(await f.control.authorize({...f.request,audienceSetIds:['public','secret']})),character=must(await f.control.authorize({...f.request,viewpoint:{kind:'character',entityId:'erin'}})),before=await f.fence()
  const marker=(authority,sources,blocked,key)=>({...batch(before,[],key),authorityChanges:[{kind:'deletion',recordId:key,record:{id:key,generation:before.deletionGeneration+1,scope:authority.scope,sourceRevisionIds:sources,blockedDerivedIds:blocked,purgeState:'blocked',externalLimitations:['host-log-not-managed']}}]})
  for(const [a,sources,blocked,key]of [[character,[],[target],'character_bare'],[broad,[],['secret_event'],'public_bare'],[character,[sourceId],[],'character_source'],[broad,[secret.source.id],[],'public_secret'],[broad,[sourceId],['secret_event'],'unrelated_derived']]){
   deny(await f.store.commit(a,marker(a,sources,blocked,key)),'scope_denied');assert.deepEqual(await f.fence(),before)
  }
  must(await f.store.commit(f.authority,marker(f.authority,[sourceId],[target],'own_source_tombstone')))
  assert.ok(!must(await f.store.readEvents(f.authority)).some(e=>e.id===target));assert.ok(must(await f.store.readEvents(secret.authority)).some(e=>e.id==='secret_event'))
 }finally{await f.close()}
})
test('bare invalidation cannot bypass locked canon correction provenance, while explicit retcon with no replacement is valid',async()=>{
 const f=await setup();try{const ctl=await f.controlSource('canon');must(await f.canonical.applyControl(f.authority,ctl,{kind:'accept',sourceRevisionIds:[ctl.id],events:[{id:'locked',epistemic:'world',payload:{kind:'canon_assertion',subjectId:'erin',key:'rule',value:'LOCKED',locked:true}}],idempotencyKey:'canon',expected:await f.fence()}))
  deny(await f.store.commit(f.authority,batch(await f.fence(),['locked'],'bare')),'scope_denied')
  must(await f.canonical.applyControl(f.authority,await f.controlSource('retcon'),{kind:'retcon',targetEventIds:['locked'],events:[],idempotencyKey:'retcon',expected:await f.fence()}));assert.equal(must(await f.store.readEvents(f.authority)).length,0)
 }finally{await f.close()}
})

for(const route of ['supersedes','correction','source_retraction'])test(`read/commit and character control cannot invalidate through ${route}`,async()=>{
 const f=await setup();try{
  const target=await f.experience('original','仍然有效的经历'),original=must(await f.store.readEvents(f.authority)).find(e=>e.id===target),before=await f.fence(),ledger=must(await f.store.readLedger(f.authority)),binding=ledger.sourceBindings.find(b=>b.sourceRevisionId===original.sources[0].sourceRevisionId)
  for(const overrides of [{permissions:['read','commit']},{viewpoint:{kind:'character',entityId:'erin'}}]){
   const authority=must(await f.control.authorize({...f.request,...overrides})),input=batch(before,[],route)
   if(route==='source_retraction')input.sourceBindings=[{...binding,disposition:'retracted'}]
   else input.events=[{schemaVersion:1,id:'attempt_'+route,scope:f.authority.scope,acceptedSeq:original.acceptedSeq,fictionalTime:null,epistemic:'world',authority:'explicit_ooc',sources:original.sources,visibility:f.authority.visibility,policyVersion:before.policyVersion,supersedes:route==='supersedes'?[target]:[],payload:route==='correction'?{kind:'correction',targetEventIds:[target],replacementEventIds:[],reason:'unauthorized correction'}:{kind:'occurrence',actorIds:['erin'],description:'unauthorized replacement'}}]
   deny(await f.store.commit(authority,input),'scope_denied');assert.deepEqual(await f.fence(),before);assert.ok(must(await f.store.readEvents(f.authority)).some(e=>e.id===target));assert.deepEqual(must(await f.store.readLedger(f.authority)).sourceBindings,ledger.sourceBindings)
  }
 }finally{await f.close()}
})
