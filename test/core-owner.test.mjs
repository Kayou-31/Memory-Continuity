import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {fork} from 'node:child_process'
import {once} from 'node:events'
import {build,stop} from 'esbuild'

const directory=path.resolve('work/core-owner-tests/'+Date.now())
await fs.mkdir(directory,{recursive:true})
const bundle=path.join(directory,'core.mjs')
await build({entryPoints:['src/core/index.ts'],outfile:bundle,bundle:true,platform:'node',format:'esm',target:'node22'})
stop()
const core=await import(pathToFileURL(bundle).href)
async function fixture(t){const root=await fs.mkdtemp(path.join(directory,'profile-'));const children=[]
 t.after(async()=>{for(const c of children)if(c.exitCode===null&&c.signalCode===null){const ended=once(c,'exit');c.kill('SIGKILL');await ended}})
 const start=async(mode,extra={})=>{const child=fork('test/fixtures/core/owner-process.mjs',[],{env:{...process.env,OWNER_TEST_INPUT:JSON.stringify({bundle,root,mode,...extra})},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});children.push(child);let errors='';child.stderr.on('data',b=>errors+=b)
  const answer=await Promise.race([once(child,'message').then(([value])=>value),once(child,'exit').then(()=>{throw new Error('owner child exited early: '+errors)}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('owner child timed out: '+errors)),15000);timer.unref()})]);return{child,answer}}
 return{root,start}
}
const hasOwner=()=>assert.equal(typeof core.acquireProfileOwner,'function','profile owner API must exist before any store is opened')

test('a real second process cannot acquire an occupied profile; explicit release allows the next writer',async t=>{
 hasOwner();const f=await fixture(t),held=await f.start('hold');assert.equal(held.answer.ok,true)
 const denied=await f.start('hold');assert.equal(denied.answer.code,'store_locked')
 const info=await core.inspectProfileOwner(f.root);assert.equal(info.owner.pid,held.child.pid);assert.equal(info.process,'alive')
 await assert.rejects(core.recoverProfileOwner(f.root,info.sha256),{code:'store_locked'})
 const released=once(held.child,'message');held.child.send('release');assert.equal((await released)[0].ok,true)
 const next=await core.acquireProfileOwner({profileRoot:f.root,kind:'embedded-dsh'});await next.release();await next.release()
 assert.equal(await core.inspectProfileOwner(f.root),null)
})

test('a killed process stays locked until verified recovery; stale recovery cannot remove a new owner',async t=>{
 hasOwner();const f=await fixture(t),held=await f.start('hold'),before=await core.inspectProfileOwner(f.root)
 const ended=once(held.child,'exit');held.child.kill('SIGKILL');await ended
 await assert.rejects(core.acquireProfileOwner({profileRoot:f.root,kind:'service'}),{code:'store_locked'})
 assert.equal((await core.inspectProfileOwner(f.root)).process,'dead')
 assert.equal(await core.recoverProfileOwner(f.root,before.sha256),'recovered')
 const next=await core.acquireProfileOwner({profileRoot:f.root,kind:'service'})
 await assert.rejects(core.recoverProfileOwner(f.root,before.sha256),{code:'stale_input'})
 assert.notEqual((await core.inspectProfileOwner(f.root)).sha256,before.sha256);await next.release()
})

test('interrupted recovery can resume without stealing from a concurrent recovery process',async t=>{
 hasOwner();const f=await fixture(t),held=await f.start('hold'),before=await core.inspectProfileOwner(f.root)
 const ended=once(held.child,'exit');held.child.kill('SIGKILL');await ended
 const paused=await f.start('recover',{expected:before.sha256,pauseRecovery:true});assert.equal(paused.answer.phase,'before-unlink')
 await assert.rejects(core.recoverProfileOwner(f.root,before.sha256),{code:'store_locked'})
 const crashed=once(paused.child,'exit');paused.child.kill('SIGKILL');await crashed
 assert.equal(await core.recoverProfileOwner(f.root,before.sha256),'recovered')
 const next=await core.acquireProfileOwner({profileRoot:f.root,kind:'service'});await next.release()
})

test('corrupt owner evidence is retained and refused instead of guessed or silently repaired',async t=>{
 hasOwner();const f=await fixture(t),held=await f.start('hold'),info=await core.inspectProfileOwner(f.root)
 const ended=once(held.child,'exit');held.child.kill('SIGKILL');await ended
 const file=path.join(f.root,'.memory-continuity-owner','owner.lock');await fs.writeFile(file,'{broken')
 await assert.rejects(core.inspectProfileOwner(f.root),{code:'store_corrupt'})
 await assert.rejects(core.recoverProfileOwner(f.root,info.sha256),{code:'store_corrupt'})
 await assert.rejects(core.acquireProfileOwner({profileRoot:f.root,kind:'service'}),{code:'store_locked'})
 assert.equal(await fs.readFile(file,'utf8'),'{broken')
})

test('the public core owns its profile and revokes old writes before waiting for queued work to finish',async t=>{
 const f=await fixture(t),memory=await core.openMemoryCore({profileRoot:f.root,entityIds:[]})
 try{
  assert.ok(await core.inspectProfileOwner(f.root),'public bootstrap must acquire ownership')
  await assert.rejects(core.openMemoryCore({profileRoot:f.root,entityIds:[]}),{code:'store_locked'})
  let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r)
  const pending=memory.coordinator.mutate(async()=>{enter();await gate});await entered
  const close=memory.close()
  try{assert.ok(await core.inspectProfileOwner(f.root),'owner retained until in-flight work settles')}
  finally{release();await pending;await close}
  const project=path.join(f.root,'project');await fs.mkdir(project)
  const stale=await memory.control.createWorkspace(project);assert.equal(stale.ok,false);assert.equal(stale.code,'ownership_lost')
  assert.equal(await core.inspectProfileOwner(f.root),null)
  const reopened=await core.openMemoryCore({profileRoot:f.root,entityIds:[]});await reopened.close()
 }finally{await memory.close?.()}
})

test('closing an owner rejects an in-flight global commit before rename and retained global handles cannot write',async t=>{
 const f=await fixture(t),memory=await core.openMemoryCore({profileRoot:f.root,entityIds:[]}),must=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value}
 const identity=JSON.parse(await fs.readFile(path.join(f.root,'.dsh-rp/v1/identity.json'),'utf8'))
 const spec={scope:{kind:'world',profileId:identity.profileId,worldId:'world'},visibility:{policyId:'policy',revision:0,audienceSetId:'public'},audienceSetIds:['public'],write:true}
 const authority=must(await memory.global.control.authorize(spec)),approval=memory.global.control.approval({commandId:'publish',sessionId:'core'}),expected=must(await memory.global.store.readFence(authority))
 let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r),open=fs.open
 fs.open=async(file,...args)=>{const h=await open(file,...args);if(String(file).includes(path.sep+'global'+path.sep)&&String(file).includes(path.sep+'commits'+path.sep)){const sync=h.sync.bind(h);h.sync=async()=>{await sync();enter();await gate}}return h}
 let closing,publishing
 try{
  publishing=memory.global.control.publish(authority,approval,{idempotencyKey:'late',expected,key:'late',body:'不得在关闭后发布',privateSourceIds:[]})
  await entered;closing=memory.close();assert.ok(await core.inspectProfileOwner(f.root));release()
  const result=await publishing;assert.equal(result.ok,false);assert.equal(result.code,'ownership_lost');await closing
  const stale=await memory.global.control.publish(authority,approval,{idempotencyKey:'stale',expected,key:'stale',body:'旧句柄',privateSourceIds:[]});assert.equal(stale.ok,false);assert.equal(stale.code,'ownership_lost')
  const reopened=await core.openMemoryCore({profileRoot:f.root,entityIds:[]});try{const next=must(await reopened.global.control.authorize(spec));assert.deepEqual(must(await reopened.global.store.readFence(next)),expected)}finally{await reopened.close()}
 }finally{fs.open=open;release();await publishing;await(closing??memory.close())}
})
