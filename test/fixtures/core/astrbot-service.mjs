// A real standalone core process for the Python adapter tests. Synthetic data only.
import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {createInterface} from 'node:readline'
import {request as httpRequest} from 'node:http'
import {build,stop} from 'esbuild'
const root=path.resolve('work/task8-host/client-tests',randomUUID());await fs.mkdir(root,{recursive:true})
const runtime=path.join(root,'core.mjs');await build({entryPoints:['src/core/index.ts'],outfile:runtime,bundle:true,platform:'node',format:'esm',target:'node22',logLevel:'silent'});stop()
const {openMemoryCore,openCoreService}=await import(pathToFileURL(runtime).href)
const must=r=>{if(!r.ok)throw new Error(r.code+': '+r.message);return r.value}
const memory=await openMemoryCore({profileRoot:path.join(root,'profile'),entityIds:['erin']})
const project=path.join(root,'project');await fs.mkdir(project)
const ws=must(await memory.control.createWorkspace(project)),branch=must(await memory.control.createBranch(ws.workspaceId,'life'))
const request={workspaceId:ws.workspaceId,campaignId:'life',branchId:branch.id,viewpoint:{kind:'narrator'},visibility:{policyId:'policy',revision:0,audienceSetId:'public'},audienceSetIds:['public'],permissions:['read','observe','commit','control']}
const authority=must(await memory.control.authorize(request)),control=async key=>must(await memory.store.observeSource(authority,{idempotencyKey:key,origin:'user_control',role:'user_control',turnId:key,publicText:'用户明确确认 '+key}))
const p=must(await memory.person.preview(authority,{schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]},'person'))
must(await memory.person.confirm(authority,p.handle,await control('person')))
let clock=Date.now()
const server=await openCoreService({memory,bindings:[{id:'main',request,personId:'erin'}],now:()=>clock,maxRequests:4})
const held=[]
const release=async()=>{for(const {req}of held)req.end('{}');await Promise.all(held.map(({done})=>done));held.length=0}
const connectionFile=path.join(root,'connection.json')
await fs.writeFile(connectionFile,JSON.stringify({schemaVersion:1,instanceId:randomUUID(),pid:process.pid,url:server.url,adminToken:server.adminToken}),{flag:'wx',mode:0o600})
console.log(JSON.stringify({connectionFile}))
const lines=createInterface({input:process.stdin,terminal:false})
try{for await(const line of lines){
 if(line==='quit')break
 if(line==='expire'){clock+=600001;console.log(JSON.stringify({expired:true}))}
 if(line==='saturate'){
  for(let i=0;i<4;i++){
   const req=httpRequest(server.url+'/v1/admin/status',{method:'POST',headers:{authorization:'Bearer '+server.adminToken,'content-type':'application/json','content-length':2,expect:'100-continue'}})
   const done=new Promise((resolve,reject)=>{req.once('response',res=>{res.resume();res.once('end',resolve)});req.once('error',reject)})
   held.push({req,done});const ready=new Promise(resolve=>req.once('continue',resolve));req.flushHeaders();await ready
  }
  console.log(JSON.stringify({saturated:true}))
 }
 if(line==='release'){await release();console.log(JSON.stringify({released:true}))}
 if(line==='disconnect'){await server.close();console.log(JSON.stringify({disconnected:true}))}
 if(line==='rename'){
  const expected=must(await memory.store.readFence(authority)),previousEventId=must(await memory.person.read(authority,'erin')).fields.find(f=>f.fieldId==='name').eventId
  must(await memory.person.apply(authority,await control('rename'),{operation:'edit',personId:'erin',fieldId:'name',previousEventId,value:'林川',note:'明确改名',expected,idempotencyKey:'rename'}))
  console.log(JSON.stringify({renamed:true}))
 }
}}finally{lines.close();process.stdin.pause();await release();await server.close();await fs.unlink(connectionFile)}
