import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {build,stop} from 'esbuild'
import {pathToFileURL} from 'node:url'
const dir=path.resolve('work/iteration-2026-10-27/confirmation-tests');await fs.mkdir(dir,{recursive:true})
const bundle=path.join(dir,'api.mjs');await build({entryPoints:['src/core/confirmations.ts'],outfile:bundle,bundle:true,platform:'node',format:'esm',logLevel:'silent'});stop();const {openConfirmations,durableManagement}=await import(pathToFileURL(bundle).href)
const id=()=>randomUUID().replaceAll('-',''),binding='a'.repeat(64),sha=v=>createHash('sha256').update(v).digest('hex')
async function setup(limit=4){const root=path.join(dir,id());await fs.mkdir(root);return {root,j:await openConfirmations(root,{maxActive:limit}),files:path.join(root,'.dsh-rp/v1/core-confirmations')}}
test('terminal confirmation archives free active capacity and survive cold idempotent retry',async()=>{
 const f=await setup();let first,receipt
 for(let n=0;n<12;n++){const key=id();await f.j.prepare(binding,key,'edit',{n});if(n%2){await f.j.cancelPrepared(binding,key);assert.equal((await f.j.inspect(binding,key)).status,'cancelled');await assert.rejects(f.j.attempt(binding,key),e=>e.code==='stale_input')}else{await f.j.attempt(binding,key);const result=await f.j.complete(binding,key,{n});if(!first){first=key;receipt=result}}}
 assert.equal((await f.j.status(binding)).active,0);const cold=await openConfirmations(f.root,{maxActive:4});assert.deepEqual(await cold.inspect(binding,first),receipt);assert.deepEqual(await cold.complete(binding,first,{n:0}),receipt)
 await assert.rejects(cold.complete(binding,first,{n:1}),e=>e.code==='idempotency_conflict');await assert.rejects(cold.inspect('b'.repeat(64),first),e=>e.code==='scope_denied')
})
test('unknown outcomes remain active at capacity, cannot be cancelled or replayed',async()=>{
 const f=await setup(2),keys=[id(),id()];for(const key of keys){await f.j.prepare(binding,key,'edit',{});await f.j.attempt(binding,key)}
 await assert.rejects(f.j.prepare(binding,id(),'edit',{}),e=>e.code==='capacity_exceeded');await assert.rejects(f.j.cancelPrepared(binding,keys[0]),e=>e.code==='persistence_uncertain')
 const cold=await openConfirmations(f.root,{maxActive:2});assert.equal((await cold.inspect(binding,keys[0])).status,'uncertain');assert.equal((await cold.status(binding)).uncertain,2)
})
for(const failAfter of [0,1,2])test('published archive tolerates interrupted active cleanup after '+failAfter+' deletions',async()=>{
 const f=await setup(),key=id();await f.j.prepare(binding,key,'edit',{});await f.j.attempt(binding,key)
 const unlink=fs.unlink;let removed=0;fs.unlink=async file=>{if(String(file).startsWith(f.files)&&/\.(prepared|attempted|committed)\.json$/.test(String(file))&&removed++>=failAfter)throw Object.assign(Error('cleanup EIO'),{code:'EIO'});return unlink(file)}
 let receipt;try{receipt=await f.j.complete(binding,key,{saved:true})}finally{fs.unlink=unlink}
 assert.equal(receipt.status,'committed');const cold=await openConfirmations(f.root);assert.deepEqual(await cold.inspect(binding,key),receipt);await cold.maintain(binding);assert.equal((await cold.status(binding)).active,0)
})
test('archive failure preserves active commit and inconsistent residue is rejected',async()=>{
 const f=await setup(),key=id();await f.j.prepare(binding,key,'edit',{});const original=await fs.readFile(path.join(f.files,key+'.prepared.json'),'utf8');await f.j.attempt(binding,key)
 const link=fs.link;fs.link=async(from,to)=>{if(String(to).includes(path.sep+'archive'+path.sep))throw Object.assign(Error('archive EIO'),{code:'EIO'});return link(from,to)}
 try{assert.equal((await f.j.complete(binding,key,{})).status,'committed')}finally{fs.link=link}
 assert.equal((await f.j.status(binding)).active,1);await f.j.maintain(binding);assert.equal((await f.j.status(binding)).active,0)
 await fs.writeFile(path.join(f.files,key+'.prepared.json'),original);assert.equal((await f.j.inspect(binding,key)).status,'committed')
 await fs.writeFile(path.join(f.files,key+'.prepared.json'),'{corrupt');await assert.rejects(f.j.inspect(binding,key),e=>e.code==='store_corrupt');assert.equal(await fs.readFile(path.join(f.files,key+'.prepared.json'),'utf8'),'{corrupt')
})
test('two journal instances serialize cancellation against an attempted operation',async()=>{
 const f=await setup(),other=await openConfirmations(f.root),key=id();await f.j.prepare(binding,key,'edit',{})
 const results=await Promise.allSettled([f.j.cancelPrepared(binding,key),other.attempt(binding,key)]);assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.equal((await other.inspect(binding,key)).status,'cancelled')
 await other.prepare(binding,key,'edit',{});assert.equal((await other.inspect(binding,key)).status,'cancelled');await assert.rejects(other.prepare(binding,key,'edit',{changed:true}),e=>e.code==='idempotency_conflict')
})
test('manager retirement waits for in-flight confirmation and cancels only unattempted reviews',async()=>{
 const f=await setup(40),ids=[],calls=[];let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r)
 const base={assertActive(){},revoke(){},prepare:async()=>{const key=id();ids.push(key);return{id:key,action:'edit',payload:{}}},confirm:async key=>{calls.push(key);entered();await gate;return{saved:true}},cancel:async()=>({cancelled:true}),snapshot:async()=>({})}
 const manager=durableManagement(base,f.j,binding,async()=>{});for(let n=0;n<35;n++)await manager.prepare({});assert.equal((await f.j.inspect(binding,ids[0])).status,'cancelled')
 const pending=manager.confirm(ids.at(-1));await started;manager.revoke();release();await pending;await manager.drain();assert.equal((await f.j.status(binding)).active,0)
 const cold=durableManagement(base,await openConfirmations(f.root),binding,async()=>{});assert.equal((await cold.confirm(ids.at(-1))).status,'committed');assert.equal(calls.length,1)
})

test('snapshot cannot release person data after capability revocation during confirmation diagnostics',async()=>{
 const f=await setup(),key=id(),base={assertActive(){},revoke(){},prepare:async()=>({id:key,action:'edit',payload:{}}),snapshot:async()=>({persons:['PRIVATE_PERSON']}),cancel:async()=>({cancelled:true})},m=durableManagement(base,f.j,binding,async()=>{})
 await m.prepare({});const read=fs.readFile;let revoked=false
 fs.readFile=async(file,...args)=>{const value=await read(file,...args);if(!revoked&&String(file).endsWith(key+'.prepared.json')){revoked=true;m.revoke()}return value}
 try{await assert.rejects(m.snapshot(),e=>e.code==='ownership_lost');assert.equal(revoked,true)}finally{fs.readFile=read;await m.drain()}
})

test('preview eviction cannot return a new draft after the manager is revoked during archival',async()=>{
 const f=await setup(40),base={assertActive(){},revoke(){},prepare:async()=>({id:id(),action:'edit',payload:{private:'draft'}}),cancel:async()=>({cancelled:true})},m=durableManagement(base,f.j,binding,async()=>{})
 for(let n=0;n<32;n++)await m.prepare({});const link=fs.link;let revoked=false
 fs.link=async(from,to)=>{const value=await link(from,to);if(!revoked&&String(to).includes(path.sep+'archive'+path.sep)){revoked=true;m.revoke()}return value}
 try{await assert.rejects(m.prepare({}),e=>e.code==='ownership_lost');assert.equal(revoked,true)}finally{fs.link=link;await m.drain()}
})

for(const target of ['attempted','archive'])test('JSON null in '+target+' evidence is corruption, never an absent record',async()=>{
 const f=await setup(),key=id();await f.j.prepare(binding,key,'edit',{});await f.j.attempt(binding,key)
 if(target==='archive')await f.j.complete(binding,key,{saved:true})
 const file=target==='archive'?path.join(f.files,'archive',key.slice(0,2),key+'.json'):path.join(f.files,key+'.attempted.json');await fs.writeFile(file,'null')
 await assert.rejects(f.j.inspect(binding,key),e=>e.code==='store_corrupt');await assert.rejects(f.j.cancelPrepared(binding,key),e=>e.code==='store_corrupt');assert.equal(await fs.readFile(file,'utf8'),'null')
})
