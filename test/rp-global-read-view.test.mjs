import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {performance} from 'node:perf_hooks'
import {setup,must,deny} from './fixtures/rp/growth.mjs'
async function fixture(n){
 const f=await setup(),identity=JSON.parse(await fs.readFile(path.join(f.directory,'profile/.dsh-rp/v1/identity.json'),'utf8'))
 const spec={scope:{kind:'world',profileId:identity.profileId,worldId:'batch'},visibility:{policyId:'policy',revision:0,audienceSetId:'public'},audienceSetIds:['public'],write:true}
 const a=must(await f.global.control.authorize(spec)),other=must(await f.global.control.authorize(spec)),approval=f.global.control.approval({commandId:'cmd',sessionId:'session'}),publications=[]
 for(let i=0;i<n;i++)publications.push(must(await f.global.control.publish(a,approval,{idempotencyKey:'key_'+i,expected:must(await f.global.store.readFence(a)),key:'key_'+i,body:'BODY_'+i,privateSourceIds:['source_'+i]})))
 return {...f,a,other,approval,publications}
}
for(const n of [1,8,32])test('one global list loads a shared consistent view at '+n+' publications',async()=>{
 const f=await fixture(n),read=fs.readFile;let commits=0,blobs=0
 fs.readFile=async(file,...args)=>{if(String(file).includes(path.sep+'commits'+path.sep))commits++;if(String(file).includes(path.sep+'blobs'+path.sep))blobs++;return read(file,...args)}
 try{const start=performance.now(),values=must(await f.global.store.list(f.a)),ms=performance.now()-start;console.log('GLOBAL_READ_MEASUREMENT '+JSON.stringify({n,commits,blobs,ms,node:process.version,platform:process.platform}));assert.deepEqual(values,f.publications);assert.ok(commits<=2*n,'full history was reloaded per publication: '+commits);assert.equal(blobs,n)}finally{fs.readFile=read;await f.close()}
})
test('global read view caches selected bodies once and cannot escape its lifetime',async()=>{
 const f=await fixture(3);let leaked
 try{assert.equal(typeof f.global.store.withReadView,'function');const result=must(await f.global.store.withReadView(f.a,async view=>{
  leaked=view;const id=view.publications[0].id;const a=await view.readPublication(id),b=await view.readPublication(id);assert.deepEqual(a,b);view.fence.scopeRevision=999;return a
 }));assert.equal(result.body,'BODY_0');await assert.rejects(()=>leaked.readPublication(result.id),/closed|expired/);assert.equal(must(await f.global.store.readFence(f.a)).scopeRevision,3)}finally{await f.close()}
})
for(const change of ['revoke','delete','revise'])test('batch global view rejects '+change+' while loading bodies',async()=>{
 const f=await fixture(3),read=fs.readFile;let changed=false
 fs.readFile=async(file,...args)=>{const data=await read(file,...args);if(!changed&&String(file).includes(path.sep+'blobs'+path.sep)){changed=true;const expected=must(await f.global.store.readFence(f.other)),p=f.publications[0]
  if(change==='revoke')must(await f.global.control.revoke(f.other,f.approval,{idempotencyKey:'revoke',expected,publicationId:p.id}))
  else if(change==='delete')must(await f.global.control.privateDeletion(f.other,f.approval,{idempotencyKey:'delete',expected,privateSourceIds:['source_0'],publicationDisposition:'delete'}))
  else must(await f.global.control.publish(f.other,f.approval,{idempotencyKey:'revise',expected,key:p.key,body:'REVISED',privateSourceIds:[],supersedes:p.id}))
 }return data}
 try{const r=await f.global.store.list(f.a);assert.equal(changed,true);deny(r);assert.ok(['stale_input','source_unavailable'].includes(r.code))}finally{fs.readFile=read;await f.close()}
})
test('content revocation after the final metadata bytes were read cannot release the old body',async()=>{
 const f=await fixture(1),read=fs.readFile;let seals=0,changed=false
 fs.readFile=async(file,...args)=>{const data=await read(file,...args);if(!changed&&String(file).endsWith(path.sep+'seal.json')&&++seals===4){changed=true;must(await f.global.control.revoke(f.other,f.approval,{idempotencyKey:'late_revoke',expected:must(await f.global.store.readFence(f.other)),publicationId:f.publications[0].id}))}return data}
 try{deny(await f.global.store.readPublication(f.a,f.publications[0].id),'stale_input');assert.equal(changed,true)}finally{fs.readFile=read;await f.close()}
})
