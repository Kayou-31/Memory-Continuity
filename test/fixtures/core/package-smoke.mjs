import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import * as api from '@memory-continuity/core'
const req=createRequire(import.meta.url)
for(const name of ['@deepseek-ai/dsh-agent','@deepseek-ai/cordis'])assert.throws(()=>req.resolve(name),{code:'MODULE_NOT_FOUND'})
assert.equal(api.installRpPlugin,undefined)
const target={provider:'offline',model:'deepseek-ai/DeepSeek-V3.2'},budget=api.createMemoryBudget(target)
if(process.argv[2]==='corrupt'){await assert.rejects(api.openMemoryMeter(budget,target),/integrity mismatch/);process.exit(0)}
const must=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value}
const profileRoot=path.resolve('profile'),project=path.resolve('project');await fs.mkdir(project,{recursive:true})
const core=await api.openMemoryCore({profileRoot,entityIds:['erin']}),writing=process.argv[2]==='write'
if(process.argv[2]==='owner-crash')process.exit(0)
let request,service
if(writing){const ws=must(await core.control.createWorkspace(project)),branch=must(await core.control.createBranch(ws.workspaceId,'life'));request={workspaceId:ws.workspaceId,campaignId:'life',branchId:branch.id,sessionId:'core_test',sceneId:'scene',viewpoint:{kind:'narrator'},visibility:{policyId:'policy',revision:0,audienceSetId:'public'},audienceSetIds:['public'],permissions:['read','observe','commit','control']};await fs.writeFile('request.json',JSON.stringify(request))}
else {request=JSON.parse(await fs.readFile('request.json','utf8'));must(await core.control.openWorkspace(project))}
const authority=must(await core.control.authorize(request)),ctl=async key=>must(await core.store.observeSource(authority,{idempotencyKey:key,origin:'user_control',role:'user_control',turnId:key,publicText:'明确确认 '+key})),fence=async()=>must(await core.store.readFence(authority))
const original='\ufeff# 语气\r\n'+'温和地表达自己的看法。😀\r\n'.repeat(1000)
try{
 if(writing){
  const p=must(await core.person.preview(authority,{schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]},'person'))
  must(await core.person.confirm(authority,p.handle,await ctl('person')))
  const d=must(await core.documents.preview(authority,{draft:api.importPersonDocument({personId:'erin',documentId:'voice',title:'语气',format:'markdown',text:original})},'document'))
  must(await core.documents.confirm(authority,d.handle,await ctl('document')))
  must(await core.diary.configure(authority,await ctl('diary_policy'),{personId:'erin',boardId:'shared',humanId:'local_user',allowAgentWrite:false,audiences:[{kind:'local'}],expected:await fence(),idempotencyKey:'diary_policy'}))
  must(await core.diary.writeHuman(authority,await ctl('diary_entry'),{personId:'erin',boardId:'shared',draft:{entryId:'today',title:'今天',body:'今天修好了钟楼。'},expected:await fence(),idempotencyKey:'diary_entry'}))
 }
 const person=must(await core.person.read(authority,'erin')),doc=must(await core.documents.read(authority,'erin','voice')),diary=must(await core.diary.read(authority,{personId:'erin',boardId:'shared',entryId:'today'})),meter=await api.openMemoryMeter(budget,target)
 assert.equal(doc.draft.text,original);assert.ok(meter.count('你好，世界！')>0)
 const workbench=await api.openWorkbench(core.management.create(authority))
 try{const url=new URL(workbench.url),token=url.hash.slice(1);url.hash='';const response=await fetch(new URL('api/snapshot',url),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:'{}'}),body=await response.json();assert.equal(body.ok,true);assert.equal(body.value.persons[0].personId,'erin');const font=await fetch(new URL('assets/fonts/noto-serif-sc-000.woff2',url));assert.equal(font.status,200);assert.equal((await font.arrayBuffer()).byteLength>0,true)}finally{await workbench.close()}
 service=await api.openCoreService({memory:core,bindings:[{id:'local',request,personId:'erin'}]})
 const sessionResponse=await fetch(service.url+'/v1/admin/session',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+service.adminToken},body:JSON.stringify({bindingId:'local'})}),session=must(await sessionResponse.json())
 const searchResponse=await fetch(service.url+'/v1/tool/search',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+session.toolToken},body:JSON.stringify({query:'林澈'})})
 assert.ok(must(await searchResponse.json()).result.items.length>0)
 console.log(JSON.stringify({name:person.fields[0].value,documentSha:createHash('sha256').update(doc.draft.text).digest('hex'),diary:diary.draft.body,tokenMode:meter.identity.mode,fence:await fence()}))
}finally{await service?.close();await core.close()}
