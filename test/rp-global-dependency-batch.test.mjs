import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {build,stop} from 'esbuild'
import {pathToFileURL} from 'node:url'
import {setup,must} from './fixtures/rp/growth.mjs'
test('history global dependencies validate each publication once while preserving head and scope checks',async()=>{
 const file=path.resolve('work/iteration-2026-10-27/global-dependency-batch.mjs');await build({entryPoints:['src/rp/global-dependencies.ts'],outfile:file,bundle:true,platform:'node',format:'esm',logLevel:'silent'});stop()
 const {checkGlobalDependencies,globalDependencyKey}=await import(pathToFileURL(file).href),f=await setup(),read=fs.readFile
 try{
  const identity=JSON.parse(await fs.readFile(path.join(f.directory,'profile/.dsh-rp/v1/identity.json'),'utf8'))
  const grant=must(await f.global.control.authorize({scope:{kind:'profile',profileId:identity.profileId},visibility:{policyId:'policy',revision:0,audienceSetId:'public'},audienceSetIds:['public'],write:true})),approval=f.global.control.approval({commandId:'cmd',sessionId:'session'})
  const pub=must(await f.global.control.publish(grant,approval,{idempotencyKey:'original',expected:must(await f.global.store.readFence(grant)),key:'language',body:'BODY',privateSourceIds:[]}))
  const dep={publicationId:pub.id,sourceId:pub.source.id,bodySha256:pub.bodySha256,scope:pub.scope,key:pub.key}
  let blobs=0,commits=0
  fs.readFile=async(file,...args)=>{if(String(file).includes(path.sep+'blobs'+path.sep))blobs++;if(String(file).includes(path.sep+'commits'+path.sep))commits++;return read(file,...args)}
  const result=await checkGlobalDependencies(f.global.store,[grant],Array.from({length:256},()=>dep));assert.equal(result.valid.has(globalDependencyKey(dep)),true);assert.equal(blobs,1);assert.ok(commits<=2,'dependency count must not multiply history reads');fs.readFile=read
  await result.assertCurrent()
  assert.equal((await checkGlobalDependencies(f.global.store,[grant],[{...dep,key:'forged'}])).valid.size,0)
  const next=must(await f.global.control.publish(grant,approval,{idempotencyKey:'new',expected:must(await f.global.store.readFence(grant)),key:'language',body:'NEW',privateSourceIds:[],supersedes:pub.id}))
  await assert.rejects(()=>result.assertCurrent(),/changed/)
  assert.equal((await checkGlobalDependencies(f.global.store,[grant],[dep])).valid.size,0,'superseded profile publication is not current')
  must(await f.global.control.revoke(grant,approval,{idempotencyKey:'revoke',expected:must(await f.global.store.readFence(grant)),publicationId:next.id}))
  assert.equal((await checkGlobalDependencies(f.global.store,[grant],[dep])).valid.size,0,'revoking head cannot resurrect prior profile version')
 }finally{fs.readFile=read;await f.close()}
})
