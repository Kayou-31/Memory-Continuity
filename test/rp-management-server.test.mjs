import test from 'node:test'
import assert from 'node:assert/strict'
import {build,stop} from 'esbuild'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import fs from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
const file=path.resolve('work/rp-growth-tests/management-server.mjs')
await build({stdin:{contents:"export {openManagementServer} from './src/rp/person/management-server.ts'; export {openRpMemory} from './src/rp/memory.ts'",resolveDir:process.cwd(),loader:'ts'},outfile:file,bundle:true,platform:'node',format:'esm',logLevel:'silent'});stop()
const {openManagementServer,openRpMemory}=await import(pathToFileURL(file))
const must=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value}
async function setup(){
 const directory=path.resolve('work/rp-growth-tests',randomUUID()),project=path.join(directory,'project');await fs.mkdir(project,{recursive:true})
 const memory=await openRpMemory({profileRoot:path.join(directory,'profile'),entityIds:['erin']}),workspace=must(await memory.control.createWorkspace(project)),branch=must(await memory.control.createBranch(workspace.workspaceId,'campaign'))
 const authority=must(await memory.control.authorize({workspaceId:workspace.workspaceId,campaignId:'campaign',branchId:branch.id,sessionId:'management',sceneId:'scene',viewpoint:{kind:'narrator'},visibility:{policyId:'policy',revision:0,audienceSetId:'public'},audienceSetIds:['public'],permissions:['read','observe','commit','control']}))
 return {...memory,authority,async close(){memory.retrieval.dispose();await memory.jobs.close()}}
}

for(const revocation of ['endpoint','owner'])test('revoking '+revocation+' while a snapshot response waits cannot release old person data',async()=>{
 const f=await setup();let server,release,enter,active=true
 const gate=new Promise(r=>release=r),entered=new Promise(r=>enter=r)
 try{const controller=f.management.create(f.authority,()=>active)
  server=await openManagementServer({...controller,async snapshot(){const result=await controller.snapshot();enter();await gate;return result}})
  const url=new URL(server.url),token=url.hash.slice(1);url.hash=''
  const pending=fetch(new URL('api/snapshot',url),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:'{}'})
  await entered;if(revocation==='endpoint')server.revoke();else active=false;release();const result=await pending,body=await result.json()
  assert.equal(result.status,403);assert.equal(body.ok,false);assert.equal(body.code,'ownership_lost');assert.equal(body.value,undefined)
 }finally{release();await server?.close();await f.close()}
})
test('manual management server binds loopback, rejects foreign callers and never exposes its token in HTML',async()=>{
 const f=await setup();let server
 try{
  server=await openManagementServer(f.management.create(f.authority));const url=new URL(server.url),token=url.hash.slice(1);url.hash=''
  const html=await fetch(url);assert.equal(html.status,200);const body=await html.text();assert.match(body,/Memory-Continuity/);assert.ok(!body.includes(token));assert.match(html.headers.get('content-security-policy'),/default-src 'none'/)
  const call=(headers={},data={})=>fetch(new URL('api/snapshot',url),{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)})
  assert.equal((await call()).status,403);assert.equal((await call({authorization:'Bearer '+token,origin:'https://untrusted.example'})).status,403)
  assert.equal((await call({authorization:'Bearer '+token,origin:'null'})).status,403)
  assert.equal((await call({authorization:'Bearer '+token,origin:url.origin})).status,200)
  server.revoke();assert.equal((await call({authorization:'Bearer '+token})).status,403)
 }finally{await server?.close();await f.close()}
})
