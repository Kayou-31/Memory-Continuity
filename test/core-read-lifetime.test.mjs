import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {build,stop} from 'esbuild'

const base=path.resolve('work/core-read-lifetime/'+Date.now());await fs.mkdir(base,{recursive:true})
const runtime=path.join(base,'core.mjs');await build({stdin:{contents:"export * from './src/core/index.ts'; export {openRpMemory as openRawMemory} from './src/rp/memory.ts'",resolveDir:process.cwd()},outfile:runtime,bundle:true,platform:'node',format:'esm',target:'node22',logLevel:'silent'});stop()
const api=await import(pathToFileURL(runtime).href),must=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value}
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(base,'case-')),profileRoot=path.join(directory,'profile'),project=path.join(directory,'project');await fs.mkdir(project)
 const memory=await api.openMemoryCore({profileRoot,entityIds:['erin']});t.after(()=>memory.close())
 const ws=must(await memory.control.createWorkspace(project)),branch=must(await memory.control.createBranch(ws.workspaceId,'life'))
 const request={workspaceId:ws.workspaceId,campaignId:'life',branchId:branch.id,sessionId:'read_session',sceneId:'scene',viewpoint:{kind:'narrator'},visibility:{policyId:'policy',revision:0,audienceSetId:'public'},audienceSetIds:['public'],permissions:['read','observe','commit','control']}
 const authority=must(await memory.control.authorize(request)),ctl=async key=>must(await memory.store.observeSource(authority,{idempotencyKey:key,origin:'user_control',role:'user_control',turnId:key,publicText:'SYNTHETIC_CONTROL '+key})),fence=async()=>must(await memory.store.readFence(authority))
 const accept=async(key,payload)=>{const s=await ctl(key);must(await memory.canonical.applyControl(authority,s,{kind:'accept',idempotencyKey:key,expected:await fence(),sourceRevisionIds:[s.id],events:[{id:'event_'+key,payload,epistemic:'world'}]}));return s}
 return {memory,profileRoot,project,request,authority,ctl,fence,accept}
}

test('source read snapshots its span before any await and keeps knowledge check and text aligned',async t=>{
 const f=await fixture(t),a=await f.accept('known_a',{kind:'occurrence',actorIds:['erin'],description:'Known event'}),b=await f.accept('unknown_b',{kind:'occurrence',actorIds:['erin'],description:'Unknown to this character'})
 await f.accept('learn_a',{kind:'knowledge_change',knowerId:'erin',claimId:'event_known_a',action:'learn'})
 const char=must(await f.memory.control.authorize({...f.request,viewpoint:{kind:'character',entityId:'erin'},permissions:['read']}))
 const sa=must(await f.memory.store.sourceSpan(f.authority,a.id,0,a.publicTextLengthUtf16)),sb=must(await f.memory.store.sourceSpan(f.authority,b.id,0,b.publicTextLengthUtf16))
 assert.equal((await f.memory.store.readSource(char,sb)).code,'source_unavailable')
 const mutable=structuredClone(sa),read=fs.readFile;let switched=false
 fs.readFile=async(file,...args)=>{const value=await read(file,...args);if(!switched&&String(file).includes(path.sep+'blobs'+path.sep)){Object.assign(mutable,sb);switched=true}return value}
 let result;try{result=await f.memory.store.readSource(char,mutable)}finally{fs.readFile=read}
 assert.equal(switched,true);assert.equal(must(result),'SYNTHETIC_CONTROL known_a')
 const immediate=structuredClone(sa),pending=f.memory.store.readSource(char,immediate);Object.assign(immediate,sb)
 assert.equal(must(await pending),'SYNTHETIC_CONTROL known_a')
 assert.equal((await f.memory.store.readSource(char,null)).ok,false)
})

test('core close during the final metadata load prevents an in-flight source result',async t=>{
 const f=await fixture(t),s=await f.accept('known',{kind:'occurrence',actorIds:['erin'],description:'Known event'}),span=must(await f.memory.store.sourceSpan(f.authority,s.id,0,s.publicTextLengthUtf16))
 const readdir=fs.readdir;let loads=0,closed=false
 fs.readdir=async(file,...args)=>{const value=await readdir(file,...args);if(String(file).endsWith(path.sep+'commits')&&++loads===2){await f.memory.close();closed=true}return value}
 let result;try{result=await f.memory.store.readSource(f.authority,span)}finally{fs.readdir=readdir}
 assert.equal(closed,true);assert.equal(result.ok,false);assert.equal(result.code,'ownership_lost')
})

test('privacy deletion completed during the final seal read prevents old source release',async t=>{
 const f=await fixture(t),s=await f.accept('known',{kind:'occurrence',actorIds:['erin'],description:'Known event'}),span=must(await f.memory.store.sourceSpan(f.authority,s.id,0,s.publicTextLengthUtf16)),control=await f.ctl('delete'),expected=await f.fence()
 const directory=path.join(f.profileRoot,'.dsh-rp/v1/workspaces',f.request.workspaceId,'seals'),last=(await fs.readdir(directory)).filter(n=>n.endsWith('.json')).sort().at(-1),target=path.join(directory,last)
 const read=fs.readFile;let count=0,deleted=false
 fs.readFile=async(file,...args)=>{const value=await read(file,...args);if(String(file)===target&&++count===2){must(await f.memory.canonical.applyControl(f.authority,control,{kind:'privacy_delete',idempotencyKey:'delete',expected,sourceRevisionIds:[s.id],affectedBranchIds:[f.request.branchId]}));deleted=true}return value}
 let result;try{result=await f.memory.store.readSource(f.authority,span)}finally{fs.readFile=read}
 assert.equal(deleted,true);assert.equal(result.ok,false);assert.equal(result.code,'stale_input')
 assert.equal((await f.memory.store.readSource(f.authority,span)).code,'source_unavailable')
})

test('a read begun while commit publication is pending cannot certify the older snapshot',async t=>{
 const f=await fixture(t),s=await f.accept('known',{kind:'occurrence',actorIds:['erin'],description:'Known event'}),span=must(await f.memory.store.sourceSpan(f.authority,s.id,0,s.publicTextLengthUtf16))
 const rename=fs.rename;let release,reached;const gate=new Promise(r=>release=r),entered=new Promise(r=>reached=r);let pending
 fs.rename=async(from,to)=>{if(String(to).includes(path.sep+'commits'+path.sep)){reached();await gate}return rename(from,to)}
 let timer,result;try{pending=f.ctl('concurrent');await Promise.race([entered,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('publication gate not reached')),5000)})]);result=await f.memory.store.readSource(f.authority,span)}finally{clearTimeout(timer);try{release();await pending}finally{fs.rename=rename}}
 assert.equal(result.ok,false);assert.equal(result.code,'stale_input')
 assert.equal(must(await f.memory.store.readSource(f.authority,span)),'SYNTHETIC_CONTROL known')
})

test('a second store instance cannot publish deletion unnoticed by a pending read',async t=>{
 const f=await fixture(t),s=await f.accept('known',{kind:'occurrence',actorIds:['erin'],description:'Known event'}),span=must(await f.memory.store.sourceSpan(f.authority,s.id,0,s.publicTextLengthUtf16)),control=await f.ctl('delete'),expected=await f.fence()
 const other=await api.openRawMemory({profileRoot:f.profileRoot,entityIds:['erin']});t.after(()=>other.jobs.close());const a=must(await other.control.authorize(f.request))
 const directory=path.join(f.profileRoot,'.dsh-rp/v1/workspaces',f.request.workspaceId,'seals'),target=path.join(directory,(await fs.readdir(directory)).filter(n=>n.endsWith('.json')).sort().at(-1))
 const read=fs.readFile;let count=0
 fs.readFile=async(file,...args)=>{const value=await read(file,...args);if(String(file)===target&&++count===2)must(await other.canonical.applyControl(a,control,{kind:'privacy_delete',idempotencyKey:'delete',expected,sourceRevisionIds:[s.id],affectedBranchIds:[f.request.branchId]}));return value}
 let result;try{result=await f.memory.store.readSource(f.authority,span)}finally{fs.readFile=read}
 assert.equal(result.ok,false);assert.equal(result.code,'stale_input')
})
