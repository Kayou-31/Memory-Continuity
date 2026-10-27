import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {request as httpRequest} from 'node:http'
import {build,stop} from 'esbuild'
const base=path.resolve('work/core-service-tests/'+Date.now());await fs.mkdir(base,{recursive:true})
const runtime=path.join(base,'core.mjs');await build({entryPoints:['src/core/index.ts'],outfile:runtime,bundle:true,platform:'node',format:'esm',target:'node22'});stop()
const api=await import(pathToFileURL(runtime).href),must=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value}
async function fixture(t,options={}){
 assert.equal(typeof api.openCoreService,'function','core HTTP service must exist')
 const directory=await fs.mkdtemp(path.join(base,'case-')),profileRoot=path.join(directory,'profile'),project=path.join(directory,'project');await fs.mkdir(project)
 const memory=await api.openMemoryCore({profileRoot,entityIds:['erin']});let server
 t.after(async()=>{await server?.close();await memory.close()})
 const ws=must(await memory.control.createWorkspace(project)),branch=must(await memory.control.createBranch(ws.workspaceId,'life'))
 const request={workspaceId:ws.workspaceId,campaignId:'life',branchId:branch.id,viewpoint:{kind:'narrator'},visibility:{policyId:'policy',revision:0,audienceSetId:'public'},audienceSetIds:['public'],permissions:['read','observe','commit','control']}
 const authority=must(await memory.control.authorize(request))
 const ctl=async key=>must(await memory.store.observeSource(authority,{idempotencyKey:key,origin:'user_control',role:'user_control',turnId:key,publicText:'用户明确确认 '+key}))
 const draft={schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]}
 const p=must(await memory.person.preview(authority,draft,'person'));must(await memory.person.confirm(authority,p.handle,await ctl('person')))
 let now=Date.now();server=await api.openCoreService({memory,bindings:[{id:'main',request,personId:'erin'}],now:()=>now,...options})
 const call=async(route,body={},token=server.adminToken,headers={})=>{const response=await fetch(server.url+route,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});return{status:response.status,body:await response.json()}}
 const session=async()=>must((await call('/v1/admin/session',{bindingId:'main',ttlMs:1000})).body)
 return{profileRoot,memory,server,authority,ctl,request,call,session,advance:ms=>now+=ms}
}

test('loopback service rejects missing credentials, foreign origin/host and caller-invented authority',async t=>{
 const f=await fixture(t)
 assert.equal((await f.call('/v1/admin/status',{},null)).status,403)
 assert.equal((await f.call('/v1/admin/status',{},undefined,{origin:'https://attacker.invalid'})).status,403)
 const badHost=await new Promise((resolve,reject)=>{const req=httpRequest(f.server.url+'/v1/admin/status',{method:'POST',headers:{host:'attacker.invalid',authorization:'Bearer '+f.server.adminToken,'content-type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.on('error',reject);req.end('{}')});assert.equal(badHost,403)
 const forged=await f.call('/v1/admin/session',{bindingId:'main',owner:true,scope:{kind:'profile'}});assert.equal(forged.body.ok,false)
 assert.equal((await f.call('/v1/admin/session',{bindingId:'unknown'})).status,403)
 const session=await f.session();assert.notEqual(session.toolToken,f.server.adminToken)
 assert.equal((await f.call('/v1/admin/workbench',{sessionId:session.sessionId},session.toolToken)).status,403)
 assert.equal((await f.call('/v1/tool/exec',{command:'person edit'},session.toolToken)).status,403)
})

test('tool replies retain actual retrieval provenance and cannot borrow another session receipt',async t=>{
 const f=await fixture(t),one=await f.session(),two=await f.session()
 const reply=must((await f.call('/v1/tool/search',{query:'林澈'},one.toolToken)).body)
 assert.ok(reply.result.items.length>0);assert.match(reply.receiptId,/^[a-f0-9]{48}$/)
 assert.equal((await f.call('/v1/admin/verify',{sessionId:two.sessionId,receiptId:reply.receiptId})).status,403)
 must((await f.call('/v1/admin/verify',{sessionId:one.sessionId,receiptId:reply.receiptId})).body)
 const expected=must(await f.memory.store.readFence(f.authority))
 const previousEventId=must(await f.memory.person.read(f.authority,'erin')).fields.find(field=>field.fieldId==='name').eventId
 must(await f.memory.person.apply(f.authority,await f.ctl('rename'),{operation:'edit',personId:'erin',fieldId:'name',previousEventId,value:'林川',note:'用户明确改名',expected,idempotencyKey:'rename'}))
 const stale=await f.call('/v1/admin/verify',{sessionId:one.sessionId,receiptId:reply.receiptId});assert.equal(stale.body.ok,false);assert.equal(stale.body.code,'stale_input')
})

test('revocation and expiration retire tool and workbench capabilities together',async t=>{
 const f=await fixture(t),one=await f.session()
 const workbench=must((await f.call('/v1/admin/workbench',{sessionId:one.sessionId})).body),url=new URL(workbench.url),token=url.hash.slice(1);url.hash=''
 const snapshot=async()=>{const response=await fetch(new URL('api/snapshot',url),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:'{}'});return response.json()}
 assert.equal((await snapshot()).ok,true)
 must((await f.call('/v1/admin/revoke',{sessionId:one.sessionId})).body)
 assert.equal((await f.call('/v1/tool/search',{},one.toolToken)).status,403);await assert.rejects(snapshot,'revocation closes the management listener as well as its credential')
 const two=await f.session();f.advance(1001)
 assert.equal((await f.call('/v1/tool/search',{},two.toolToken)).status,403)
 await f.server.close();assert.equal(await api.inspectProfileOwner(f.profileRoot),null)
})

test('JSON, size and operation bounds fail closed without affecting the next valid read',async t=>{
 const f=await fixture(t),one=await f.session()
 assert.equal((await f.call('/v1/tool/search',{query:'x'.repeat(140000)},one.toolToken)).status,413)
 assert.equal((await f.call('/v1/tool/get',{id:'unknown',authority:'invented'},one.toolToken)).body.ok,false)
 assert.equal((await f.call('/v1/tool/search',{query:'林澈'},one.toolToken)).body.ok,true)
 const status=must((await f.call('/v1/admin/status')).body)
 assert.equal(status.modelDispatch,false);assert.equal(JSON.stringify(status).includes(one.toolToken),false);assert.equal(JSON.stringify(status).includes(f.server.adminToken),false)
})

test('concurrent workbench openings reuse one listener and shutdown closes every returned address',async t=>{
 const f=await fixture(t),one=await f.session()
 const opened=await Promise.all([f.call('/v1/admin/workbench',{sessionId:one.sessionId}),f.call('/v1/admin/workbench',{sessionId:one.sessionId})])
 const urls=opened.map(r=>must(r.body).url)
 try{assert.equal(urls[0],urls[1])}finally{
  await f.server.close()
  // A failing implementation must not strand its leaked listener in the runner.
  for(const value of urls){const url=new URL(value),token=url.hash.slice(1);url.hash='';await fetch(new URL('api/close',url),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:'{}',signal:AbortSignal.timeout(1000)}).catch(()=>{})}
 }
 for(const url of urls)await assert.rejects(fetch(url),'no untracked workbench listener may survive shutdown')
})

test('concurrent capability creation reserves the last slot before awaiting authorization',async t=>{
 const f=await fixture(t);for(let n=0;n<63;n++)await f.session()
 const authorize=f.memory.control.authorize;let firstEnter,secondEnter,release,count=0
 const firstEntered=new Promise(r=>firstEnter=r),secondEntered=new Promise(r=>secondEnter=r),gate=new Promise(r=>release=r)
 f.memory.control.authorize=async(...args)=>{if(args[0].sessionId?.startsWith('core_')){if(++count===1)firstEnter();else secondEnter();await gate}return authorize(...args)}
 try{
  const one=f.call('/v1/admin/session',{bindingId:'main'});await firstEntered
  const two=f.call('/v1/admin/session',{bindingId:'main'});await Promise.race([secondEntered,two]);release()
  const results=await Promise.all([one,two]);assert.equal(results.filter(r=>r.body.ok).length,1);assert.equal(results.find(r=>!r.body.ok).body.code,'capacity_exceeded')
 }finally{release();f.memory.control.authorize=authorize}
})

test('revocation during a real source read prevents a late tool reply from releasing that memory',async t=>{
 const f=await fixture(t),one=await f.session(),read=fs.readFile;let enter,release,paused=false
 const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r)
 fs.readFile=async(file,...args)=>{const data=await read(file,...args);if(!paused&&String(file).includes(path.sep+'blobs'+path.sep)){paused=true;enter();await gate}return data}
 let reading
 try{reading=f.call('/v1/tool/search',{query:'林澈'},one.toolToken);await entered;must((await f.call('/v1/admin/revoke',{sessionId:one.sessionId})).body);release();assert.equal((await reading).status,403)}
 finally{release();fs.readFile=read;await reading}
})

test('a cold service restart rejects old administrator, tool and receipt capabilities',async t=>{
 const f=await fixture(t),one=await f.session(),reply=must((await f.call('/v1/tool/search',{query:'林澈'},one.toolToken)).body)
 await f.server.close()
 const memory=await api.openMemoryCore({profileRoot:f.profileRoot,entityIds:['erin']}),next=await api.openCoreService({memory,bindings:[{id:'main',request:f.request,personId:'erin'}]});t.after(()=>next.close())
 for(const [route,token,body]of [['/v1/admin/status',f.server.adminToken,{}],['/v1/tool/search',one.toolToken,{}],['/v1/admin/verify',next.adminToken,{sessionId:one.sessionId,receiptId:reply.receiptId}]]){
  const response=await fetch(next.url+route,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body)});assert.equal(response.status,403)
 }
})

test('an incomplete HTTP body times out without holding the next request or shutdown',async t=>{
 const f=await fixture(t,{requestTimeoutMs:100}),one=await f.session()
 const start=Date.now()
 const response=await new Promise((resolve,reject)=>{
  const req=httpRequest(f.server.url+'/v1/tool/search',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+one.toolToken}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body}))})
  req.on('error',reject);req.setTimeout(1500,()=>req.destroy(new Error('service deadline failed')));req.write('{')
 })
 assert.equal(response.status,408);assert.ok(Date.now()-start<1500)
 assert.equal((await f.call('/v1/tool/search',{query:'林澈'},one.toolToken)).body.ok,true)
 await f.server.close();assert.equal(await api.inspectProfileOwner(f.profileRoot),null)
})

test('in-flight RPC limit rejects excess work before allocating another read',async t=>{
 const f=await fixture(t,{maxRequests:2}),one=await f.session(),read=fs.readFile;let enter,release,paused=0
 const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r)
 fs.readFile=async(file,...args)=>{if(String(file).includes(path.sep+'blobs'+path.sep)){if(++paused===2)enter();await gate}return read(file,...args)}
 let first,second
 try{
  first=f.call('/v1/tool/search',{query:'林澈'},one.toolToken);second=f.call('/v1/tool/search',{query:'林澈'},one.toolToken);await entered
  // A third status request is cheap, but it must respect the same transport bound.
  const excess=await f.call('/v1/admin/status');assert.equal(excess.status,429);assert.equal(excess.body.code,'capacity_exceeded')
 }finally{release();fs.readFile=read;await Promise.all([first,second])}
 assert.equal((await f.call('/v1/tool/search',{query:'林澈'},one.toolToken)).body.ok,true)
})

async function editReview(f,session){
 const snapshot=must((await f.call('/v1/admin/snapshot',{sessionId:session.sessionId})).body)
 return must((await f.call('/v1/admin/prepare',{sessionId:session.sessionId,snapshotId:snapshot.id,action:'edit',payload:{personId:'erin',fieldId:'name',value:'林川',note:'用户明确改名'}})).body)
}
async function coldService(t,f){
 await f.server.close();const memory=await api.openMemoryCore({profileRoot:f.profileRoot,entityIds:['erin']})
 const server=await api.openCoreService({memory,bindings:[{id:'main',request:f.request,personId:'erin'},{id:'separate',request:f.request,personId:'erin'}]});t.after(()=>server.close())
 const call=async(route,body)=>{const response=await fetch(server.url+route,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+server.adminToken},body:JSON.stringify(body)});return response.json()}
 const session=must(await call('/v1/admin/session',{bindingId:'main'})),authority=must(await memory.control.authorize(f.request))
 return{memory,server,call,session,authority}
}

test('explicit confirmation returns a durable outcome and cold duplicate confirmation does not reapply it',async t=>{
 const f=await fixture(t),session=await f.session(),review=await editReview(f,session)
 assert.equal(must(await f.memory.person.read(f.authority,'erin')).fields[0].value,'林澈')
 const receipt=must((await f.call('/v1/admin/confirm',{sessionId:session.sessionId,id:review.id})).body);assert.equal(receipt.status,'committed')
 assert.deepEqual(must((await f.call('/v1/admin/confirm',{sessionId:session.sessionId,id:review.id})).body),receipt)
 const expected=must(await f.memory.store.readFence(f.authority)),next=await coldService(t,f)
 assert.deepEqual(must(await next.call('/v1/admin/confirm',{sessionId:next.session.sessionId,id:review.id})),receipt)
 assert.deepEqual(must(await next.memory.store.readFence(next.authority)),expected)
 const separate=must(await next.call('/v1/admin/session',{bindingId:'separate'}))
 assert.equal((await next.call('/v1/admin/confirm',{sessionId:separate.sessionId,id:review.id})).code,'scope_denied')
})

test('core HTTP cancellation retires a prepared review and exposes bounded activity in the workbench',async t=>{
 const f=await fixture(t),session=await f.session(),review=await editReview(f,session)
 const before=must(await f.memory.store.readFence(f.authority))
 assert.equal(must((await f.call('/v1/admin/cancel',{sessionId:session.sessionId,id:review.id})).body).status,'cancelled')
 assert.equal((await f.call('/v1/admin/confirm',{sessionId:session.sessionId,id:review.id})).body.code,'stale_input')
 assert.equal(must((await f.call('/v1/admin/snapshot',{sessionId:session.sessionId})).body).confirmationCapacity.active,0)
 assert.deepEqual(must(await f.memory.store.readFence(f.authority)),before)
})

for(const host of ['independent-core','astrbot'])test(host+' workbench describes its actual capabilities and reopening path',async t=>{
 const f=await fixture(t),session=await f.session(),opened=must((await f.call('/v1/admin/workbench',{sessionId:session.sessionId,...(host==='astrbot'?{host}:{})})).body),url=new URL(opened.url),token=url.hash.slice(1);url.hash=''
 const page=await(await fetch(url)).text(),snapshot=must(await(await fetch(new URL('api/snapshot',url),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:'{}'})).json())
 assert.equal(snapshot.capabilities.host,host);assert.equal(snapshot.capabilities.features.injectionPreview,false);assert.equal(snapshot.capabilities.features.chatBinding,false);assert.equal(snapshot.capabilities.features.continuation,false);assert.equal(snapshot.capabilities.features.documents,true)
 assert.ok(page.includes(snapshot.capabilities.reopen));assert.match(snapshot.capabilities.reopen,host==='astrbot'?/memcont open/:/核心服务/)
})

test('a lost completion receipt stays uncertain after restart and never repeats an already applied change',async t=>{
 const f=await fixture(t),session=await f.session(),review=await editReview(f,session),link=fs.link
 fs.link=async(from,to)=>{if(String(to).endsWith('.committed.json'))throw Object.assign(new Error('injected receipt EIO'),{code:'EIO'});return link(from,to)}
 try{const failed=await f.call('/v1/admin/confirm',{sessionId:session.sessionId,id:review.id});assert.equal(failed.body.code,'persistence_uncertain')}
 finally{fs.link=link}
 assert.equal(must(await f.memory.person.read(f.authority,'erin')).fields[0].value,'林川')
 const expected=must(await f.memory.store.readFence(f.authority)),next=await coldService(t,f)
 assert.equal((await next.call('/v1/admin/confirm',{sessionId:next.session.sessionId,id:review.id})).code,'persistence_uncertain')
 assert.equal(must(await next.call('/v1/admin/confirmation',{sessionId:next.session.sessionId,id:review.id})).status,'uncertain')
 assert.deepEqual(must(await next.memory.store.readFence(next.authority)),expected)
})

test('an unconfirmed old review cannot execute after restart and corrupt confirmation evidence is retained',async t=>{
 const f=await fixture(t),session=await f.session(),review=await editReview(f,session),expected=must(await f.memory.store.readFence(f.authority)),next=await coldService(t,f)
 assert.equal((await next.call('/v1/admin/confirm',{sessionId:next.session.sessionId,id:review.id})).code,'stale_input')
 assert.deepEqual(must(await next.memory.store.readFence(next.authority)),expected)
 const file=path.join(f.profileRoot,'.dsh-rp/v1/core-confirmations',review.id+'.prepared.json');await fs.writeFile(file,'{corrupt')
 assert.equal((await next.call('/v1/admin/confirmation',{sessionId:next.session.sessionId,id:review.id})).code,'store_corrupt')
 assert.equal(await fs.readFile(file,'utf8'),'{corrupt')
})

test('a confirmation receipt cannot conceal corruption of the underlying memory history',async t=>{
 const f=await fixture(t),session=await f.session(),review=await editReview(f,session)
 must((await f.call('/v1/admin/confirm',{sessionId:session.sessionId,id:review.id})).body)
 const commits=path.join(f.profileRoot,'.dsh-rp/v1/workspaces',f.request.workspaceId,'commits'),last=(await fs.readdir(commits)).filter(name=>name.endsWith('.json')).sort().at(-1)
 await fs.writeFile(path.join(commits,last),'{corrupt')
 const response=await f.call('/v1/admin/confirmation',{sessionId:session.sessionId,id:review.id});assert.equal(response.body.ok,false);assert.equal(response.body.code,'store_corrupt')
})
