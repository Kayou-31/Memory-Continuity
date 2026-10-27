import test from 'node:test'
import assert from 'node:assert/strict'
import {setup,must,deny} from './fixtures/rp/growth.mjs'
const person={schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]}
async function ready(){const f=await setup(),p=must(await f.person.preview(f.authority,person,'person'));must(await f.person.confirm(f.authority,p.handle,await f.controlSource('person')));return f}
async function input(f,key,body){const s=await f.controlSource(key); // trusted input bindings, not arbitrary controls
 const real=must(await f.store.observeSource(f.authority,{idempotencyKey:'input_'+key,origin:'user_control',role:'user_control',turnId:'input_'+key,publicText:body}));
 must(await f.canonical.applyControl(f.authority,s,{kind:'accept',idempotencyKey:'accept_'+key,expected:await f.fence(),sourceRevisionIds:[real.id],events:[]}));
 f.registerInputBindings(f.request.branchId,[{kind:'input',sourceId:real.id,turnId:real.turnId,messageId:key}]);return real
}
async function enable(f,on=true){return must(await f.experienceCandidates.configure(f.authority,await f.controlSource('cfg_'+String(on)),{personId:'erin',enabled:on,key:'cfg_'+String(on)}))}
const proposal={description:'林澈答应周末帮忙整理画稿。',epistemic:'world',reason:'明确约定',evidence:[{quote:'周末我来帮你整理画稿。'}]}
async function writer(f,s,extra={}){return must(await f.experienceCandidates.writer(f.authority,{personId:'erin',sessionId:f.request.sessionId,inputSourceId:s.id,sourceRevisionIds:[s.id],...extra}))}
test('experience proposal stays pending, survives unrelated append and cold retry, and needs explicit adoption',async()=>{
 const f=await ready();try{
  await enable(f);const s=await input(f,'one','周末我来帮你整理画稿。'),w=await writer(f,s),before=await f.fence(),r=must(await w.propose(proposal));
  assert.equal(r.state,'pending');assert.deepEqual(await f.fence(),before);assert.ok(!must(await f.store.readEvents(f.authority)).some(e=>e.payload.description===proposal.description));
  assert.deepEqual(must(await w.propose(proposal)),r);deny(await w.propose({...proposal,description:'另一件事'}),'idempotency_conflict');
  await f.experience('unrelated','无关的新经历');assert.equal(must(await f.experienceCandidates.get(f.authority,'erin',r.id)).evidence[0].quote,proposal.evidence[0].quote);
  const cold=await setup(f.directory,f.request);try{cold.registerInputBindings(f.request.branchId,[{kind:'input',sourceId:s.id,turnId:s.turnId,messageId:'one'}]);assert.deepEqual(must(await (await writer(cold,s)).propose(proposal)),r)}finally{await cold.close()}
  const ctl=await f.controlSource('adopt'),result=must(await f.experienceCandidates.decide(f.authority,ctl,{personId:'erin',candidateId:r.id,decision:'accepted',key:'adopt'}));
  assert.equal(result.state,'accepted');assert.equal(must(await f.store.readEvents(f.authority)).filter(e=>e.payload.description===proposal.description).length,1);
  assert.deepEqual(must(await f.experienceCandidates.decide(f.authority,ctl,{personId:'erin',candidateId:r.id,decision:'accepted',key:'adopt'})),result);
  assert.equal(must(await f.experienceCandidates.get(f.authority,'erin',r.id)).state,'accepted');
 }finally{await f.close()}
})
test('experience disabled, cooldown, changed policy, wrong person, untrusted input and forged evidence are denied',async()=>{
 const f=await ready();try{
  const s=await input(f,'one','周末我来帮你整理画稿。');deny(await f.experienceCandidates.writer(f.authority,{personId:'erin',sessionId:f.request.sessionId,inputSourceId:s.id,sourceRevisionIds:[s.id]}),'scope_denied');
  await enable(f);const w=await writer(f,s);deny(await w.propose({...proposal,evidence:[{quote:'从未说过'}]}),'invalid_candidate');
  const r=must(await w.propose(proposal)),next=await input(f,'two','另一个确定的事件');deny(await (await writer(f,next)).propose({...proposal,evidence:[{quote:'另一个确定的事件'}]}),'request_limit_exceeded');
  deny(await f.experienceCandidates.get(f.authority,'bea',r.id),'source_unavailable');
  const arbitrary=await f.controlSource('ordinary_control');deny(await f.experienceCandidates.writer(f.authority,{personId:'erin',sessionId:f.request.sessionId,inputSourceId:arbitrary.id,sourceRevisionIds:[arbitrary.id]}),'scope_denied');
  deny(await f.experienceCandidates.writer(f.authority,{personId:'erin',sessionId:'other_session',inputSourceId:s.id,sourceRevisionIds:[s.id]}),'scope_denied');
  await enable(f,false);deny(await w.propose(proposal),'scope_denied');
 }finally{await f.close()}
})
test('experience rejection deduplicates and source withdrawal hides candidates and invalidates receipts',async()=>{
 const f=await ready();try{
  await enable(f);const s=await input(f,'one','周末我来帮你整理画稿。'),w=await writer(f,s),r=must(await w.propose(proposal)),proof=must(await f.experienceCandidates.receipt(f.authority,'erin',r));
  await f.experienceCandidates.verify(f.authority,'erin',proof);await assert.rejects(f.experienceCandidates.verify(f.authority,'erin',{...proof,bodySha256:'0'.repeat(64)}));
  must(await f.experienceCandidates.decide(f.authority,await f.controlSource('reject'),{personId:'erin',candidateId:r.id,decision:'rejected',key:'reject'}));
  assert.equal(must(await w.propose(proposal)).state,'rejected');assert.equal(must(await f.experienceCandidates.list(f.authority,'erin')).items[0].state,'rejected');
  must(await f.canonical.applyControl(f.authority,await f.controlSource('withdraw'),{kind:'retract',idempotencyKey:'withdraw',expected:await f.fence(),sourceRevisionIds:[s.id]}));
  deny(await f.experienceCandidates.get(f.authority,'erin',r.id),'source_unavailable');assert.equal(must(await f.experienceCandidates.list(f.authority,'erin')).items.length,0);await assert.rejects(f.experienceCandidates.verify(f.authority,'erin',proof));
  assert.equal(must(await f.experienceCandidates.availability(f.authority,'erin')).reason,'cooldown','withdrawal must not refund a consumed proposal admission');
 }finally{await f.close()}
})
test('independent workbench controls AI proposals and reviews exact evidence before explicit adoption',async()=>{
 const f=await ready();try{
  const m=f.management.create(f.authority),prepare=async(action,payload)=>m.prepare({snapshotId:(await m.snapshot()).id,action,payload});
  const cfg=await prepare('experience-configure',{personId:'erin',enabled:true});await m.confirm(cfg.id);
  const s=await input(f,'ui','周末我来帮你整理画稿。'),made=must(await (await writer(f,s)).propose(proposal));
  assert.equal((await m.snapshot()).experienceCandidates[0].items[0].state,'pending');
  assert.equal((await m.read({kind:'experience-candidate',personId:'erin',id:made.id})).evidence[0].quote,proposal.evidence[0].quote);
  const accept=await prepare('experience-adopt',{personId:'erin',candidateId:made.id});assert.equal(accept.payload.candidate.description,proposal.description);
  await m.cancel(accept.id);await assert.rejects(m.confirm(accept.id));assert.equal(must(await f.experienceCandidates.get(f.authority,'erin',made.id)).state,'pending');
  const again=await prepare('experience-adopt',{personId:'erin',candidateId:made.id});await m.confirm(again.id);assert.equal((await m.snapshot()).experienceCandidates[0].items[0].state,'accepted');
 }finally{await f.close()}
})
test('a second session cannot claim an earlier session input and receipt content hashes are verified',async()=>{
 const f=await ready();try{
  await enable(f);const s=await input(f,'one','周末我来帮你整理画稿。'),r=must(await (await writer(f,s)).propose(proposal)),proof=must(await f.experienceCandidates.receipt(f.authority,'erin',r));
  const other=must(await f.control.authorize({...f.request,sessionId:'second_session'}));deny(await f.experienceCandidates.writer(other,{personId:'erin',sessionId:'second_session',inputSourceId:s.id,sourceRevisionIds:[s.id]}),'scope_denied');
  await assert.rejects(f.experienceCandidates.verify(f.authority,'erin',{...proof,resultSha256:'0'.repeat(64)}));
 }finally{await f.close()}
})
test('candidate list never releases a description withdrawn while a later item is being assembled',async()=>{
 const f=await ready();const clock=Date.now;try{
  await enable(f);const first=await input(f,'one','周末我来帮你整理画稿。'),a=must(await (await writer(f,first)).propose(proposal));
  Date.now=()=>clock()+300001;const second=await input(f,'two','周末我来帮你整理画稿。'),b=must(await (await writer(f,second)).propose(proposal));Date.now=clock;
  const read=f.store.readPayloadCopies,readFence=f.store.readFence;let signal,release,once=true,fences=0;const entered=new Promise(r=>signal=r),gate=new Promise(r=>release=r);
  f.store.readPayloadCopies=async(auth,ids)=>{const result=await read(auth,ids);if(once&&ids?.length>1){once=false;signal();await gate}return result};
  f.store.readFence=async(auth)=>{if(++fences===3&&once){once=false;signal();await gate}return readFence(auth)};
  const listing=f.experienceCandidates.list(f.authority,'erin');await entered;
  try{must(await f.canonical.applyControl(f.authority,await f.controlSource('withdraw_list'),{kind:'retract',idempotencyKey:'withdraw_list',expected:await f.fence(),sourceRevisionIds:[second.id]}))}finally{release()}
  deny(await listing,'stale_input');f.store.readPayloadCopies=read;f.store.readFence=readFence;
 }finally{Date.now=clock;await f.close()}
})
test('old pending experience stays reachable beyond 64 terminal candidate records',async()=>{
 const f=await ready();try{
  await enable(f);const s=await input(f,'one','周末我来帮你整理画稿。'),r=must(await (await writer(f,s)).propose(proposal)),copy=must(await f.store.readPayloadCopies(f.authority,[r.id]))[0],ctl=await f.controlSource('seed_terminals');
  must(await f.canonical.applyControl(f.authority,ctl,{kind:'accept',idempotencyKey:'seed_ctl',expected:await f.fence(),sourceRevisionIds:[ctl.id],events:[]}));const ids=[];
  for(let i=0;i<64;i++){const id=r.id.slice(0,r.id.lastIndexOf('_')+1)+'history_'+i;ids.push(id);must(await f.store.savePayloadCopy(f.authority,{idempotencyKey:id,id,kind:copy.kind,body:copy.body,sourceRevisionIds:copy.sourceRevisionIds,dependencyIds:copy.dependencyIds}))}
  const expected=await f.fence();must(await f.store.commit(f.authority,{schemaVersion:1,idempotencyKey:'seed_terminal_decisions',expected,sourceBindings:[],events:[],summaries:[],jobs:[],invalidatedIds:[],authorityChanges:ids.map((id,i)=>({kind:'candidate_adoption',recordId:'seed_decision_'+i,record:{candidateId:id,sourceRevisionIds:[],eventIds:[],summaryIds:[],decision:'rejected',controlSourceId:ctl.id}})),nextContextRevision:expected.contextRevision+1}));
  const listing=must(await f.experienceCandidates.list(f.authority,'erin'));assert.ok(listing.items.some(i=>i.id===r.id&&i.state==='pending'));assert.ok(listing.items.length<=64);
 }finally{await f.close()}
})

test('experience receipt verifier rejects a changed result hash',async()=>{const f=await ready();try{await enable(f);const s=await input(f,'receipt','周末我来帮你整理画稿。'),r=must(await (await writer(f,s)).propose(proposal)),proof=must(await f.experienceCandidates.receipt(f.authority,'erin',r));await assert.rejects(f.experienceCandidates.verify(f.authority,'erin',{...proof,resultSha256:'0'.repeat(64)}))}finally{await f.close()}})

test('retirement after candidate publication reports uncertainty and never duplicates the saved candidate',async()=>{
 const f=await ready();try{await enable(f);const s=await input(f,'retired','周末我来帮你整理画稿。');let live=true;
 const w=must(await f.experienceCandidates.writer(f.authority,{personId:'erin',sessionId:f.request.sessionId,inputSourceId:s.id,sourceRevisionIds:[s.id]},()=>live)),save=Object.getPrototypeOf(f.store).savePayloadCopy;
 f.store.savePayloadCopy=async function(...args){const r=await save.apply(this,args);if(args[1].id.startsWith('experience_candidate_'))live=false;return r};deny(await w.propose(proposal),'persistence_uncertain');f.store.savePayloadCopy=save;
 assert.equal(must(await f.experienceCandidates.list(f.authority,'erin')).items.length,1);assert.equal(must(await (await writer(f,s)).propose(proposal)).state,'pending');
 }finally{await f.close()}
})

test('daily and pending experience limits survive reopening and require review rather than automatic deletion',async()=>{
 const f=await ready(),clock=Date.now;let now=clock();try{Date.now=()=>now;await enable(f);
 for(let i=0;i<8;i++){const s=await input(f,'quota_'+i,'周末我来帮你整理画稿。');must(await (await writer(f,s)).propose(proposal));now+=300001;
  if(i===7){const next=await input(f,'daily_denied','周末我来帮你整理画稿。');deny(await (await writer(f,next)).propose(proposal),'request_limit_exceeded');assert.equal(must(await f.experienceCandidates.availability(f.authority,'erin')).reason,'daily_limit')}
 }
 const first=must(await f.experienceCandidates.list(f.authority,'erin')).items[0],copy=must(await f.store.readPayloadCopies(f.authority,[first.id]))[0];
 for(let i=0;i<24;i++){const id=copy.id.slice(0,copy.id.lastIndexOf('_')+1)+'seed_pending_'+i;must(await f.store.savePayloadCopy(f.authority,{idempotencyKey:id,id,kind:copy.kind,body:copy.body,sourceRevisionIds:copy.sourceRevisionIds,dependencyIds:copy.dependencyIds}))}
 const cold=await setup(f.directory,f.request);try{const state=must(await cold.experienceCandidates.availability(cold.authority,'erin'));assert.equal(state.reason,'pending_limit');assert.equal(state.pending,32)}finally{await cold.close()}
 now+=86400001;const blocked=await input(f,'pending_denied','周末我来帮你整理画稿。');deny(await (await writer(f,blocked)).propose(proposal),'request_limit_exceeded');assert.equal(must(await f.experienceCandidates.list(f.authority,'erin')).items.length,32);
 }finally{Date.now=clock;await f.close()}
})
