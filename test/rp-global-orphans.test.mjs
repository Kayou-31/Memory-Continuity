import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {build,stop} from 'esbuild'
const base=path.resolve('work/agent-memory-2026-10-22/global-orphans')
await fs.mkdir(base,{recursive:true}); const runtime=path.join(base,'memory.mjs')
await build({entryPoints:['src/rp/memory.ts'],outfile:runtime,bundle:true,platform:'node',format:'esm',logLevel:'silent'});stop()
const api=await import(pathToFileURL(runtime))
const must=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value}
const sha=s=>createHash('sha256').update(s).digest('hex')
for(const stage of ['blob','commit_before']) for (const retry of [false, true]) test('privacy deletion erases failed publication at '+stage+' retry='+retry,async()=>{
  const profileRoot=path.join(base,'global-'+stage+'-'+randomUUID()),f=await api.openRpMemory({profileRoot,entityIds:[]})
  const identity=JSON.parse(await fs.readFile(path.join(profileRoot,'.dsh-rp/v1/identity.json'),'utf8'))
  const scope={kind:'world',profileId:identity.profileId,worldId:'review'}
  const spec={scope,visibility:{policyId:'policy',revision:0,audienceSetId:'public'},audienceSetIds:['public'],write:true}
  const a=must(await f.global.control.authorize(spec)),approval=f.global.control.approval({commandId:'cmd_review',sessionId:'session_review'})
  const dir=path.join(profileRoot,'.dsh-rp/v1/global',sha(api.canonical(scope))),sentinel='REVIEW_ERASE_THIS_APPROVED_SNAPSHOT'
  const retained = must(await f.global.control.publish(a,approval,{idempotencyKey:'retained',expected:must(await f.global.store.readFence(a)),key:'independent',body:sentinel,privateSourceIds:[]}))
  const input={idempotencyKey:'publication',expected:must(await f.global.store.readFence(a)),key:'world_rule',body:sentinel,privateSourceIds:['source_private']}
  const rename=fs.rename;let armed=true,failed
  fs.rename=async(from,to)=>{if(armed && to.includes(path.join(dir,stage==='blob'?'blobs':'commits'))){armed=false;throw Object.assign(new Error('REVIEW_EIO'),{code:'EIO'})};return rename(from,to)}
  try{failed=await f.global.control.publish(a,approval,input);assert.equal(failed.ok,false)}finally{fs.rename=rename}
  const cold = await api.openRpMemory({profileRoot,entityIds:[]}), ca = must(await cold.global.control.authorize(spec)), cap = cold.global.control.approval({commandId:'cmd_cold',sessionId:'session_cold'})
  if (retry) must(await cold.global.control.publish(ca,cap,input))
  const deletion=await cold.global.control.privateDeletion(ca,cap,{idempotencyKey:'deletion',expected:must(await cold.global.store.readFence(ca)),privateSourceIds:['source_private'],publicationDisposition:'delete'});must(deletion)
  assert.equal(must(await cold.global.store.readPublication(ca,retained.id)).body,sentinel)
  const remaining=[]
  async function walk(d){for(const e of await fs.readdir(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())await walk(p);else if((await fs.readFile(p,'utf8')).includes(sentinel))remaining.push(path.relative(dir,p))}}
  await walk(dir)
  console.log('OBSERVATION '+JSON.stringify({stage,failed,deletion,remaining,profileRoot}))
  assert.deepEqual(remaining,[path.join('blobs',retained.source.id,retained.source.blobId+'.txt')],'only the independent retained publication may remain')
})
