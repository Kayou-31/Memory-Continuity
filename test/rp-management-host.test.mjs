import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {Server} from 'node:http'
process.env.RP_ACCEPTANCE_LOOPBACK='1'
const {host}=await import('./fixtures/rp/native-host.mjs')
const bundle=process.env.RP_PERSON_BUNDLE?await import(pathToFileURL(path.resolve(process.env.RP_PERSON_BUNDLE))):undefined
const ok=r=>{assert.equal(r.kind,'success',r.text);return r.text}
test('native manual manager creates and edits real person, explicit proposal/adoption survives and disposal revokes HTTP',async()=>{
 const f=await host({entityIds:['erin']},bundle?{install:bundle.installRpPlugin}:{});let url,token
 const call=async(route,data={})=>{const r=await fetch(new URL('api/'+route,url),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token,origin:url.origin},body:JSON.stringify(data)});const v=await r.json();assert.equal(v.ok,true,JSON.stringify(v));return v.value}
 const apply=async(action,payload)=>{const s=await call('snapshot'),p=await call('prepare',{snapshotId:s.id,action,payload});return call('confirm',{id:p.id})}
 try{
  const a=await f.create();ok(await f.command(a,'start'));url=new URL(JSON.parse(ok(await f.command(a,'person manage'))).url);token=url.hash.slice(1);url.hash=''
  await apply('create',{schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'},{fieldId:'care',kind:'trait',value:'谨慎',policy:'growable'}],relationships:[],goals:[]})
  await apply('edit',{personId:'erin',fieldId:'name',value:'林川',note:'新名字'})
  assert.equal(JSON.parse(ok(await f.command(a,'person show erin'))).fields.find(f=>f.fieldId==='name').value,'林川')
  const cause=await apply('agent',{kind:'experience',actorIds:['erin'],description:'共同远行',sourceRevisionIds:[]}),s=await call('snapshot'),field=s.persons[0].fields.find(f=>f.fieldId==='care')
  await apply('propose',{changes:[{changeId:'care',personId:'erin',fieldId:'care',previousEventId:field.eventId,value:'敢于探索',causeEventIds:[cause.eventId],note:'远行'}]})
  const p=(await call('snapshot')).candidates[0];await apply('adopt',{candidateIds:[p.id]});assert.equal((await call('snapshot')).persons[0].fields.find(f=>f.fieldId==='care').value,'敢于探索')
  ok(await f.command(a,'person manage-close'));await assert.rejects(call('snapshot'));assert.equal(f.calls(),0)
 }finally{await f.dispose()}
})
test('closing a manager while its listener opens prevents a late live endpoint',async()=>{
 const f=await host(),original=Server.prototype.listen;let release,enter;const gate=new Promise(r=>release=r),entered=new Promise(r=>enter=r)
 try{const a=await f.create();ok(await f.command(a,'start'));Server.prototype.listen=function(...args){const done=args.pop();args.push(async()=>{enter();await gate;done()});return original.apply(this,args)}
  const pending=f.command(a,'person manage');await entered;ok(await f.command(a,'person manage-close'));release();assert.equal((await pending).kind,'error')
 }finally{release?.();Server.prototype.listen=original;await f.dispose()}
})
