import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {api,must,deny} from './fixtures/rp/growth.mjs'
const sha=s=>createHash('sha256').update(s).digest('hex')
async function setup(){
 const profileRoot=path.resolve('work/global-segments',randomUUID()),f=await api.openRpMemory({profileRoot,entityIds:[]}),identity=JSON.parse(await fs.readFile(path.join(profileRoot,'.dsh-rp/v1/identity.json'),'utf8')),scope={kind:'world',profileId:identity.profileId,worldId:'large'},spec={scope,visibility:{policyId:'policy',revision:0,audienceSetId:'public'},audienceSetIds:['public'],write:true},a=must(await f.global.control.authorize(spec)),approval=f.global.control.approval({commandId:'cmd_segments',sessionId:'session_segments'}),dir=path.join(profileRoot,'.dsh-rp/v1/global',sha(api.canonical(scope)))
 const fence=async()=>must(await f.global.store.readFence(a)),pub=async(key,extra={})=>f.global.control.publish(a,approval,{idempotencyKey:key,expected:await fence(),key,body:'保留历史正文',privateSourceIds:[],...extra})
 return {...f,profileRoot,spec,a,approval,dir,fence,pub,enable:async(key='enable')=>f.global.control.enableSegments(a,approval,{idempotencyKey:key,expected:await fence()})}
}
test('segmented global upgrade backs up verified v1, reuses pages, survives cold read and rejects corruption/downgrade',async()=>{
 const f=await setup(),p=must(await f.pub('first')),old=await fs.readFile(path.join(f.dir,'commits/0000000000000001.json'))
 const input={idempotencyKey:'upgrade',expected:await f.fence()};must(await f.global.control.enableSegments(f.a,f.approval,input));must(await f.global.control.enableSegments(f.a,f.approval,input))
 const status=must(await f.global.store.storageStatus(f.a));assert.equal(status.format,'rp.global-segments/v1')
 const backup=path.join(f.profileRoot,'.dsh-rp/v1/backups/global',status.backupId),manifest=JSON.parse(await fs.readFile(path.join(backup,'manifest.json'),'utf8'))
 for(const item of manifest.files)assert.equal(sha(await fs.readFile(path.join(backup,item.path))),item.sha256)
 assert.equal(sha(await fs.readFile(path.join(backup,'commits/0000000000000001.json'))),sha(old));assert.deepEqual(await fs.readFile(path.join(f.dir,'commits/0000000000000001.json')),old)
 const two=JSON.parse(await fs.readFile(path.join(f.dir,'commits/0000000000000002.json'),'utf8'));assert.equal(two.format,'rp.global-segments/v1');assert.equal(two.state,undefined)
 must(await f.global.control.revoke(f.a,f.approval,{idempotencyKey:'revoke',expected:await f.fence(),publicationId:p.id}))
 const three=JSON.parse(await fs.readFile(path.join(f.dir,'commits/0000000000000003.json'),'utf8'));assert.notDeepEqual(three.publications,two.publications)
 const cold=await api.openRpMemory({profileRoot:f.profileRoot,entityIds:[]}),ca=must(await cold.global.control.authorize(f.spec));must(await cold.global.store.readFence(ca));deny(await cold.global.store.readPublication(ca,p.id),'source_unavailable')
 const part=path.join(f.dir,'segments',three.publications[0]+'.json'),bytes=await fs.readFile(part);await fs.writeFile(part,'[]');deny(await cold.global.store.readFence(ca),'store_corrupt');await fs.writeFile(part,bytes)
 await fs.unlink(part);deny(await cold.global.store.readFence(ca),'store_corrupt');await fs.writeFile(part,bytes)
 const third=path.join(f.dir,'commits/0000000000000003.json');await fs.writeFile(third,old);deny(await cold.global.store.readFence(ca),'store_corrupt')
})
test('segmented capacity allows cumulative metadata beyond legacy publish limit; cold controls preserve history',async()=>{
 const f=await setup(),p=must(await f.pub('first')),file=path.join(f.dir,'commits/0000000000000001.json'),env=JSON.parse(await fs.readFile(file,'utf8')),original=env.state.publications[0]
 // Seed a fully hash-validated legal v1 boundary fixture once, avoiding quadratic setup writes.
 for(let i=0;i<98;i++){const x=structuredClone(original);x.id='publication_seed_'+i;x.source.id='approved_seed_'+i;x.deleted=true;x.privateSourceIds=Array.from({length:256},(_,j)=>'source_'+String(j).padStart(120,'x'));env.state.publications.push(x)}
 env.sha256=sha(api.canonical(env.state));const bytes=api.canonical(env);assert.ok(Buffer.byteLength(bytes)>3*1024*1024&&Buffer.byteLength(bytes)<4*1024*1024);await fs.writeFile(file,bytes);await fs.writeFile(path.join(f.dir,'seal.json'),api.canonical({seq:1,hash:env.sha256}))
 deny(await f.pub('legacy-overflow'),'capacity_exceeded');const start=performance.now();must(await f.enable());const first=await fs.readdir(path.join(f.dir,'segments'));must(await f.pub('expanded'));const second=await fs.readdir(path.join(f.dir,'segments'));assert.ok(second.length-first.length<6,'unchanged pages are reused')
 assert.ok(must(await f.global.store.storageStatus(f.a)).logicalBytes>3*1024*1024);must(await f.global.control.revoke(f.a,f.approval,{idempotencyKey:'revoke',expected:await f.fence(),publicationId:p.id}));assert.equal((await fs.readdir(path.join(f.dir,'commits'))).length,4)
 console.log('SEGMENT_SAMPLE',JSON.stringify({ms:performance.now()-start,maxRSSKiB:process.resourceUsage().maxRSS,pages:second.length,legacyBytes:Buffer.byteLength(bytes)}))
})
test('backup failure cannot activate segments; consecutive seal failures recover idempotently after cold restart',async()=>{
 const f=await setup();must(await f.pub('first'));const original=fs.rename;let stage='backup',failures=2
 const input={idempotencyKey:'enable',expected:await f.fence()}
 fs.rename=async(from,to)=>{if(stage==='backup'&&to.includes(path.join('backups','global')))throw Object.assign(Error('BACKUP_EIO'),{code:'EIO'});if(stage==='seal'&&to===path.join(f.dir,'seal.json')&&failures-->0)throw Object.assign(Error('SEAL_EIO'),{code:'EIO'});return original(from,to)}
 try{deny(await f.global.control.enableSegments(f.a,f.approval,input),'persistence_failed');assert.equal(must(await f.global.store.storageStatus(f.a)).format,'v1');stage='seal';deny(await f.global.control.enableSegments(f.a,f.approval,input),'persistence_uncertain');deny(await f.pub('blocked'),'persistence_failed');assert.equal((await fs.readdir(path.join(f.dir,'commits'))).length,2)}finally{fs.rename=original}
 const cold=await api.openRpMemory({profileRoot:f.profileRoot,entityIds:[]}),ca=must(await cold.global.control.authorize(f.spec)),ap=cold.global.control.approval({commandId:'cold',sessionId:'cold'});must(await cold.global.control.enableSegments(ca,ap,input));assert.equal((await fs.readdir(path.join(f.dir,'commits'))).length,2)
})
test('a source disappearing during backup cannot produce a completed migration',async()=>{
 const f=await setup(),p=must(await f.pub('first')),original=fs.readFile,file=path.join(f.dir,'blobs',p.source.id,p.source.blobId+'.txt')
 fs.readFile=async function(target,...args){if(target===file)throw Object.assign(Error('gone during backup'),{code:'ENOENT'});return original.call(this,target,...args)}
 try{deny(await f.enable(),'store_corrupt');assert.equal(must(await f.global.store.storageStatus(f.a)).format,'v1')}finally{fs.readFile=original}
})
test('upgrade refuses missing or altered approved bodies instead of certifying an unusable backup',async()=>{
 const f=await setup(),p=must(await f.pub('first')),file=path.join(f.dir,'blobs',p.source.id,p.source.blobId+'.txt'),original=await fs.readFile(file)
 await fs.writeFile(file,'错误正文');deny(await f.enable(),'store_corrupt');await fs.unlink(file);deny(await f.enable(),'store_corrupt');await fs.writeFile(file,original);must(await f.enable())
})
async function seedSegmentBoundary(f,limit){
 const file=path.join(f.dir,'commits/0000000000000002.json'),d=JSON.parse(await fs.readFile(file,'utf8')),read=async refs=>(await Promise.all(refs.map(ref=>fs.readFile(path.join(f.dir,'segments',ref+'.json'),'utf8').then(JSON.parse)))).flat(),s={...d.header,publications:await read(d.publications),keys:Object.fromEntries(await read(d.keys))},p=structuredClone(s.publications[0]);p.deleted=true;p.privateSourceIds=Array.from({length:256},(_,i)=>'source_'+String(i).padStart(120,'x'))
 const estimate=Buffer.byteLength(api.canonical(p))+80,count=Math.floor((limit-2000)/estimate)
 for(let i=0;i<count;i++)s.publications.push({...p,id:'publication_boundary_'+i,source:{...p.source,id:'approved_boundary_'+i}})
 let size=()=>Buffer.byteLength(api.canonical({state:s,sha256:'a'.repeat(64)})),i=0
 while(size()<limit-250)s.keys[sha('boundary_'+i++)]={effect:sha('effect'),result:''}
 const gap=limit-20-size();if(gap>0){s.publications.at(-1).key+='x'.repeat(Math.min(gap,100));if(gap>100)s.publications.at(-2).key+='x'.repeat(gap-100)}
 assert.ok(size()<limit&&size()>limit-180)
 const pack=async values=>{const refs=[];for(let i=0;i<values.length;i+=6){const bytes=api.canonical(values.slice(i,i+6));assert.ok(Buffer.byteLength(bytes)<256*1024);const ref=sha(bytes);await fs.writeFile(path.join(f.dir,'segments',ref+'.json'),bytes);refs.push(ref)}return refs}
 d.publications=await pack(s.publications);d.keys=await pack(Object.entries(s.keys));assert.ok(d.publications.length<=128&&d.keys.length<=128);d.sha256=sha(api.canonical(s));await fs.writeFile(file,api.canonical(d));await fs.writeFile(path.join(f.dir,'seal.json'),api.canonical({seq:2,hash:d.sha256}));return size()
}
test('segmented full logical envelope reserves control capacity and hard cap preserves cold reads and idempotent retry',async()=>{
 for(const limit of [8*1024*1024,12*1024*1024]){
  const f=await setup(),p=must(await f.pub('first')),upgrade={idempotencyKey:'upgrade',expected:await f.fence()};must(await f.global.control.enableSegments(f.a,f.approval,upgrade));await seedSegmentBoundary(f,limit);const old=await f.fence(),count=(await fs.readdir(path.join(f.dir,'commits'))).length
  deny(await f.pub('overflow'),'capacity_exceeded');assert.equal((await fs.readdir(path.join(f.dir,'commits'))).length,count)
  const revoke=await f.global.control.revoke(f.a,f.approval,{idempotencyKey:'revoke',expected:old,publicationId:p.id});if(limit===12*1024*1024)deny(revoke,'capacity_exceeded');else must(revoke)
  const cold=await api.openRpMemory({profileRoot:f.profileRoot,entityIds:[]}),ca=must(await cold.global.control.authorize(f.spec)),ap=cold.global.control.approval({commandId:'cold',sessionId:'cold'});must(await cold.global.store.readFence(ca));must(await cold.global.control.enableSegments(ca,ap,upgrade))
 }
})
test('segmented 4097th short publication is writable and cold readable without widening legacy input arrays',async()=>{
 const f=await setup();must(await f.pub('first'));must(await f.enable());const file=path.join(f.dir,'commits/0000000000000002.json'),d=JSON.parse(await fs.readFile(file,'utf8')),first=JSON.parse(await fs.readFile(path.join(f.dir,'segments',d.publications[0]+'.json'),'utf8'))[0],publications=[first]
 for(let i=1;i<4096;i++)publications.push({...first,id:'publication_'+i,source:{...first.source,id:'approved_'+i},deleted:true})
 d.publications=[];for(let i=0;i<publications.length;i+=100){const bytes=api.canonical(publications.slice(i,i+100)),ref=sha(bytes);await fs.writeFile(path.join(f.dir,'segments',ref+'.json'),bytes);d.publications.push(ref)}
 const keys=Object.fromEntries((await Promise.all(d.keys.map(ref=>fs.readFile(path.join(f.dir,'segments',ref+'.json'),'utf8').then(JSON.parse)))).flat()),state={...d.header,publications,keys};d.sha256=sha(api.canonical(state));await fs.writeFile(file,api.canonical(d));await fs.writeFile(path.join(f.dir,'seal.json'),api.canonical({seq:2,hash:d.sha256}))
 must(await f.pub('4097'));const cold=await api.openRpMemory({profileRoot:f.profileRoot,entityIds:[]}),ca=must(await cold.global.control.authorize(f.spec));must(await cold.global.store.readFence(ca))
 deny(await f.pub('oversized-input',{privateSourceIds:Array(4097).fill('source')}),'invalid_record')
})
