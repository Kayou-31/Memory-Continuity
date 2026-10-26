import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {fork} from 'node:child_process'
import {once} from 'node:events'
import {pathToFileURL} from 'node:url'
import {host as nativeHost,inspectProfileOwner,recoverProfileOwner} from './fixtures/rp/native-host.mjs'
const bundle=process.env.RP_PERSON_BUNDLE?await import(pathToFileURL(path.resolve(process.env.RP_PERSON_BUNDLE)).href):undefined
const host=(config,hooks={})=>nativeHost(config,{...hooks,...(bundle?{install:bundle.installRpPlugin}:{})})
const sha=v=>createHash('sha256').update(v).digest('hex')
const ok=r=>{assert.equal(r.kind,'success',r.text);return r.text}
async function interrupt(operation,checkpoint){
 const directory=path.resolve('work/m5-crash-tests',randomUUID());await fs.mkdir(directory,{recursive:true})
 const child=fork(path.resolve('test/fixtures/rp/injection-crash-child.mjs'),[directory,operation,String(checkpoint)],{silent:true,execArgv:[]});let stderr='',timer
 child.stderr.on('data',b=>{stderr=(stderr+b).slice(-8192)});child.stdout.resume()
 const exited=once(child,'exit')
 try{const evidence=await Promise.race([once(child,'message').then(([m])=>m),exited.then(([code,signal])=>{throw new Error('Child exited before checkpoint: '+code+'/'+signal+' '+stderr)}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Child checkpoint timeout: '+stderr)),15000)})]);child.kill('SIGKILL');await exited;
  // An administrator verifies the dead profile owner before restarting. This
  // does not restore a host journal or grant admission to the interrupted input.
  const profile=path.join(directory,'profile'),owner=await inspectProfileOwner(profile)
  if(owner){assert.equal(owner.owner.pid,child.pid);assert.equal(owner.process,'dead');assert.equal(await recoverProfileOwner(profile,owner.sha256),'recovered')}
  return {directory,evidence}}
 finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited}}
}

for(const checkpoint of ['marker-failure','failure-2','failure-3','failure-4'])test('failed injection revocation '+checkpoint+' stays blocked across actual process termination',async()=>{
 const {directory,evidence}=await interrupt('disable',checkpoint),f=await host({entityIds:['erin']},{directory})
 try{const a=await f.resume({id:evidence.sessionId,options:{provider:'rp-dev3',model:'offline'}})
  assert.equal(f.rp.status(a.id).blocked,true,'failed revocation must not revive the previous ready journal')
  assert.equal((await f.command(a,'input blocked')).kind,'error');assert.equal(f.calls(),0);assert.match(ok(await f.command(a,'status')),/blocked/)
  const r=ok(await f.command(a,'continue-clean')),clean=f.ctx.agents.get(/created: (\w+)/.exec(r)[1]);assert.equal(clean.session.deriveMessages().length,0)
  ok(await f.command(clean,'input 恢复后继续'));await clean.whenIdle();await f.rp.ready(clean.id);assert.equal(f.calls(),1)
 }finally{await f.dispose()}
})

for(const operation of ['enable','disable'])for(const checkpoint of [1,2,3,4])test('actual process interruption '+operation+' after durable transition '+checkpoint,{timeout:30000},async()=>{
 const {directory,evidence}=await interrupt(operation,checkpoint),f=await host({entityIds:['erin']},{directory})
 try{const a=await f.resume({id:evidence.sessionId,options:{provider:'rp-dev3',model:'offline'}}),blocked=checkpoint<4
  assert.equal(f.rp.status(a.id).blocked,blocked);assert.equal(f.calls(),0)
  const backup=path.join(f.profile,'.dsh-rp/v1/host',sha(a.id)+'.json.pre-m5-backup');assert.equal(sha(await fs.readFile(backup)),evidence.originalSha256)
  let active=a
  if(blocked){assert.equal((await f.command(a,'input 不得重发')).kind,'error');await assert.rejects(f.stream(a));assert.equal(f.calls(),0);ok(await f.command(a,'status'));const r=ok(await f.command(a,'continue-clean'));active=f.ctx.agents.get(/created: (\w+)/.exec(r)[1]);assert.equal(active.session.deriveMessages().length,0)}
  else assert.equal(!!f.rp.status(a.id).injection,operation==='enable')
  ok(await f.command(active,'input 继续人生'));await active.whenIdle();await f.rp.ready(active.id);assert.equal(f.calls(),1)
 }finally{await f.dispose()}
})
