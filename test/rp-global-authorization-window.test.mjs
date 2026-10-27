import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {setup,must,deny} from './fixtures/rp/growth.mjs'
async function globalFixture(){
 const f=await setup(),identity=JSON.parse(await fs.readFile(path.join(f.directory,'profile/.dsh-rp/v1/identity.json'),'utf8'))
 const spec={scope:{kind:'world',profileId:identity.profileId,worldId:'revocation'},visibility:{policyId:'policy',revision:0,audienceSetId:'public'},audienceSetIds:['public'],write:true}
 const a=must(await f.global.control.authorize(spec)),other=must(await f.global.control.authorize(spec)),approval=f.global.control.approval({commandId:'cmd',sessionId:'session'})
 const make=async key=>({idempotencyKey:key,expected:must(await f.global.store.readFence(other)),key,body:'PRIVATE_PROTECTED_BODY '+key,privateSourceIds:['private_source']})
 return {...f,a,other,approval,spec,make}
}
for(const stage of ['blobs','commits'])for(const target of ['approval','authority'])test('global '+target+' revoked at '+stage+' temp fsync prevents commit',async()=>{
 const f=await globalFixture(),input=await f.make('first'),open=fs.open;let triggered=false,revoke
 fs.open=async function(file,...args){const h=await open.call(fs,file,...args);if(String(file).includes(path.sep+stage+path.sep)&&String(file).includes('.tmp-')){
  const sync=h.sync.bind(h);h.sync=async()=>{await sync();if(!triggered){triggered=true;if(target==='approval')f.global.control.revokeApproval(f.approval);else revoke=f.global.control.revokeAuthority(f.a)}}
 }return h}
 try{deny(await f.global.control.publish(f.a,f.approval,input),'scope_denied');assert.equal(triggered,true);await revoke;assert.equal(must(await f.global.store.readFence(f.other)).scopeRevision,0)}finally{fs.open=open;await f.close()}
})
test('revocation after commit returns uncertainty and retry with another valid grant does not publish twice',async()=>{
 const f=await globalFixture(),input=await f.make('once'),rename=fs.rename;let revoke,triggered=false
 fs.rename=async(from,to)=>{await rename(from,to);if(!triggered&&String(to).includes(path.sep+'commits'+path.sep)){triggered=true;revoke=f.global.control.revokeAuthority(f.a)}}
 try{deny(await f.global.control.publish(f.a,f.approval,input),'persistence_uncertain');await revoke;assert.equal(must(await f.global.store.readFence(f.other)).scopeRevision,1)}finally{fs.rename=rename}
 try{must(await f.global.control.publish(f.other,f.approval,input));assert.equal(must(await f.global.store.readFence(f.other)).scopeRevision,1)}finally{await f.close()}
})
for(const operation of ['readPublication','list','listActive','readFence','storageStatus','purgeStatus'])test(operation+' does not release data after authority revoked during last metadata read',async()=>{
 const f=await globalFixture(),p=must(await f.global.control.publish(f.a,f.approval,await f.make('visible'))),read=fs.readFile;let seals=0,revoke,triggered=false,bodyRead=false
 const hasBody=['readPublication','list','listActive'].includes(operation)
 fs.readFile=async(file,...args)=>{const data=await read(file,...args);if(String(file).includes(path.sep+'blobs'+path.sep)){bodyRead=true;seals=0}if((!hasBody||bodyRead)&&String(file).endsWith(path.sep+'seal.json')&&++seals===2){triggered=true;revoke=f.global.control.revokeAuthority(f.a);await revoke}return data}
 try{deny(await (operation==='purgeStatus'?f.global.control:f.global.store)[operation](f.a,p.id),'scope_denied');assert.equal(triggered,true)}finally{fs.readFile=read;await f.close()}
})
test('queued global publication observes approval revocation before any commit',async()=>{
 const f=await globalFixture(),input=await f.make('queued'),release=await f.coordinator.lock(),mutate=f.coordinator.mutate.bind(f.coordinator);let entered
 const reached=new Promise(r=>{entered=r});f.coordinator.mutate=work=>{entered();return mutate(work)}
 try{const pending=f.global.control.publish(f.a,f.approval,input);await reached;f.global.control.revokeApproval(f.approval);release();deny(await pending,'scope_denied');assert.equal(must(await f.global.store.readFence(f.other)).scopeRevision,0)}finally{release();await f.close()}
})
