import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fork} from 'node:child_process'
import {once} from 'node:events'
import {build,stop} from 'esbuild'
const {host}=await import('./fixtures/rp/native-host.mjs')
const base=path.resolve('work/core-native-owner/'+Date.now());await fs.mkdir(base,{recursive:true})
const bundle=path.join(base,'core.mjs')
await build({entryPoints:['src/core/index.ts'],outfile:bundle,bundle:true,format:'esm',platform:'node',target:'node22'});stop()
test('embedded DSH excludes a real independent core writer and releases ownership on normal shutdown',async()=>{
 const f=await host();let child
 try{
  child=fork('test/fixtures/core/owner-process.mjs',[],{env:{...process.env,OWNER_TEST_INPUT:JSON.stringify({bundle,root:f.profile,mode:'hold'})},windowsHide:true,stdio:['ignore','ignore','inherit','ipc']})
  const [answer]=await once(child,'message');assert.equal(answer.ok,false);assert.equal(answer.code,'store_locked')
  assert.equal(f.calls(),0);await f.rp.close()
  const {acquireProfileOwner}=await import('file:///'+bundle.replaceAll('\\','/'))
  const next=await acquireProfileOwner({profileRoot:f.profile,kind:'service'});await next.release()
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended}await f.dispose()}
})
