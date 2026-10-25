import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createRequire} from 'node:module'
import {fork,spawnSync} from 'node:child_process'
import {once} from 'node:events'
import {createInterface} from 'node:readline'
import {inspectProfileOwner} from '@memory-continuity/core'
const req=createRequire(import.meta.url),cli=path.join(path.dirname(req.resolve('@memory-continuity/core/package.json')),'lib/cli.js'),profileRoot=path.resolve('profile'),config=path.resolve('service-config.json')
const request=JSON.parse(await fs.readFile('request.json','utf8'))
await fs.writeFile(config,JSON.stringify({schemaVersion:1,profileRoot,entityIds:['erin'],bindings:[{id:'main',request,personId:'erin'}]}))
const children=[]
async function start(number){
 const connection=path.resolve('connection-'+number+'.json'),child=fork(cli,['serve','--config',config,'--connection',connection],{stdio:['pipe','pipe','pipe','ipc'],windowsHide:true});children.push(child)
 let stderr='';child.stderr.on('data',b=>stderr+=b)
 const lines=createInterface({input:child.stdout});let timer
 try{const line=await Promise.race([once(lines,'line').then(([s])=>s),once(child,'exit').then(([code])=>{throw new Error('service exited '+code+': '+stderr)}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('service startup timed out')),15000)})]);assert.equal(JSON.parse(line).ok,true);const info=JSON.parse(await fs.readFile(connection,'utf8'));assert.equal(line.includes(info.adminToken),false);return{child,connection,info}}
 finally{clearTimeout(timer);lines.close();child.stdout.resume()}
}
const call=async(service,route,body={},token=service.info.adminToken)=>{const r=await fetch(service.info.url+route,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});return{status:r.status,body:await r.json()}}
const must=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value}
const ownerCommand=(...args)=>{const r=spawnSync(process.execPath,[cli,'owner',...args,'--profile',profileRoot],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout)}
try{
 const first=await start(1),session=must((await call(first,'/v1/admin/session',{bindingId:'main'})).body)
 const snapshot=must((await call(first,'/v1/admin/snapshot',{sessionId:session.sessionId})).body)
 const review=must((await call(first,'/v1/admin/prepare',{sessionId:session.sessionId,snapshotId:snapshot.id,action:'edit',payload:{personId:'erin',fieldId:'name',value:'林川',note:'明确修改人物名'}})).body)
 const receipt=must((await call(first,'/v1/admin/confirm',{sessionId:session.sessionId,id:review.id})).body);assert.equal(receipt.status,'committed')
 const after=must((await call(first,'/v1/admin/snapshot',{sessionId:session.sessionId})).body)
 const died=once(first.child,'exit');first.child.kill('SIGKILL');await died
 const denied=spawnSync(process.execPath,[cli,'serve','--config',config,'--connection',path.resolve('must-not-exist.json')],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(denied.status,1);assert.equal(JSON.parse(denied.stderr).code,'store_locked');await assert.rejects(fs.stat('must-not-exist.json'),{code:'ENOENT'})
 const owner=ownerCommand('inspect').value;assert.equal(owner.process,'dead')
 const recovered=spawnSync(process.execPath,[cli,'owner','recover','--profile',profileRoot,'--expected',owner.sha256],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(recovered.status,0,recovered.stderr)
 const next=await start(2);assert.equal((await call(next,'/v1/admin/status',{},first.info.adminToken)).status,403)
 const fresh=must((await call(next,'/v1/admin/session',{bindingId:'main'})).body)
 assert.deepEqual(must((await call(next,'/v1/admin/confirm',{sessionId:fresh.sessionId,id:review.id})).body),receipt)
 const current=must((await call(next,'/v1/admin/snapshot',{sessionId:fresh.sessionId})).body);assert.deepEqual(current.fence,after.fence);assert.equal(current.persons[0].fields.find(f=>f.fieldId==='name').value,'林川')
 const exited=once(next.child,'exit');next.child.stdin.write('quit\n');assert.equal((await exited)[0],0);await assert.rejects(fs.stat(next.connection),{code:'ENOENT'});assert.equal(await inspectProfileOwner(profileRoot),null)
 console.log(JSON.stringify({confirmed:true,coldReceiptSame:true,contextRevision:after.fence.contextRevision,ownerBlocked:true,automaticReplay:false}))
}finally{for(const child of children)if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill('SIGKILL');await ended}}
