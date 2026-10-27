// Real independent core + production workbench, isolated offline demonstration data.
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {build,stop} from 'esbuild'
const directory=path.resolve('work/iteration-2026-10-27/core-browser-'+Date.now());await fs.mkdir(path.join(directory,'project'),{recursive:true})
const bundle=path.join(directory,'core.mjs');await build({entryPoints:['src/core/index.ts'],outfile:bundle,bundle:true,platform:'node',format:'esm',target:'node22',logLevel:'silent'});stop()
const {openMemoryCore,openCoreService}=await import(pathToFileURL(bundle).href),must=r=>{if(!r.ok)throw Error(JSON.stringify(r));return r.value}
const memory=await openMemoryCore({profileRoot:path.join(directory,'profile'),entityIds:['erin','bea']})
const workspace=must(await memory.control.createWorkspace(path.join(directory,'project'))),branch=must(await memory.control.createBranch(workspace.workspaceId,'demo'))
const request={workspaceId:workspace.workspaceId,campaignId:'demo',branchId:branch.id,viewpoint:{kind:'narrator'},visibility:{policyId:'demo_policy',revision:0,audienceSetId:'public'},audienceSetIds:['public'],permissions:['read','observe','commit','control']},authority=must(await memory.control.authorize(request))
for(const [personId,name]of [['erin','林澈'],['bea','小贝']]){
 const preview=must(await memory.person.preview(authority,{schemaVersion:1,kind:'person-draft',personId,fields:[{fieldId:'name',kind:'identity',value:name,policy:'stable'},{fieldId:'voice',kind:'voice',value:'温和、直接地表达。',policy:'stable'}],relationships:[],goals:[]},'demo_'+personId)),source=must(await memory.store.observeSource(authority,{idempotencyKey:'create_'+personId,origin:'user_control',role:'user_control',turnId:'create_'+personId,publicText:'离线演示人物创建'}));must(await memory.person.confirm(authority,preview.handle,source))
}
const server=await openCoreService({memory,bindings:[{id:'demo',request,personId:'erin'}]})
const call=async(route,body)=>must(await(await fetch(server.url+route,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+server.adminToken},body:JSON.stringify(body)})).json())
const session=await call('/v1/admin/session',{bindingId:'demo'}),opened=await call('/v1/admin/workbench',{sessionId:session.sessionId})
await fs.writeFile(path.resolve('work/iteration-2026-10-27/core-browser-session.json'),JSON.stringify({url:opened.url,directory},null,2));console.log(JSON.stringify({url:opened.url,directory,paidModelCalls:0,host:'independent-core'}))
let closing=false;const timer=setInterval(async()=>{try{await fs.access(path.join(directory,'stop'));await close()}catch{}},1000)
async function close(){if(closing)return;closing=true;clearInterval(timer);await server.close();console.log('Independent core closed; no model adapter configured.')}
process.on('SIGINT',()=>close());process.on('SIGTERM',()=>close())
