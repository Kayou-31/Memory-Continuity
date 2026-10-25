import test from 'node:test'
import assert from 'node:assert/strict'
import {build,stop} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:"export * from './src/rp/person/manager-ui.ts'",resolveDir:process.cwd(),loader:'ts'},write:false,bundle:true,charset:'utf8',platform:'node',format:'esm',logLevel:'silent'});stop()
const ui=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const factory=()=>{assert.equal(typeof ui.createManagementClient,'function','workbench must expose its production transport');return ui.createManagementClient}
const token='a'.repeat(64)
const response=value=>new Response(JSON.stringify({ok:true,value}),{headers:{'content-type':'application/json'}})
test('workbench ships document, diary, budget and settings pages with one inline review container',()=>{
 const html=ui.managerPage('nonce');for(const label of ['完整人物资料','共同日记','记忆预算','工作台设置','修改前提示对后续对话的影响'])assert.ok(html.includes(label),label)
 assert.match(html,/id="inline-review"/);assert.match(html,/id="review-panel"/)
})

test('workbench transport limits bearer requests to management routes and rejects missing credentials',async()=>{
 const create=factory(),sent=[];const send=async(url,init)=>{sent.push({url,init});return response({id:'snapshot'})}
 const c=create(send,token);assert.equal((await c.request('snapshot')).id,'snapshot');assert.equal(sent[0].url,'/api/snapshot');assert.equal(sent[0].init.headers.Authorization,'Bearer '+token)
 await assert.rejects(c.request('https://elsewhere.example'),/管理接口/);assert.equal(sent.length,1)
 await assert.rejects(create(send,'').request('snapshot'),/重新打开/);assert.equal(sent.length,1)
})

test('revocation rejects an older successful response and does not restore its private snapshot',async()=>{
 const create=factory();let release;const late=new Promise(r=>release=r);let calls=0,revoked=0
 const c=create(async()=>++calls===1?late:new Response(JSON.stringify({ok:false,code:'ownership_lost',message:'expired'}),{status:403}),token,()=>revoked++)
 const old=c.request('snapshot');await assert.rejects(c.request('snapshot'),/重新打开/);release(response({secret:'old private data'}))
 await assert.rejects(old,/重新打开/);assert.equal(revoked,1);await assert.rejects(c.request('snapshot'));assert.equal(calls,2)
})

test('uncertain confirmation reports uncertainty without retry and can reuse the same review id explicitly',async()=>{
 const create=factory(),sent=[];let fail=true
 const c=create(async(url,init)=>{sent.push(JSON.parse(init.body));if(fail){fail=false;throw new TypeError('connection lost')}return response({saved:true})},token)
 await assert.rejects(c.request('confirm',{id:'review_1'}),/可能已写入/);assert.equal(sent.length,1)
 assert.equal((await c.request('confirm',{id:'review_1'})).saved,true);assert.deepEqual(sent,[{id:'review_1'},{id:'review_1'}])
})

test('real close revokes local requests and ignores late success while persistence uncertainty stays visible',async()=>{
 const create=factory();let calls=0
 const c=create(async()=>{calls++;return response({closed:true})},token);await c.request('close');await assert.rejects(c.request('snapshot'));assert.equal(calls,1)
 const uncertain=create(async()=>new Response(JSON.stringify({ok:false,code:'persistence_uncertain',message:'native flush unconfirmed'}),{status:409}),token)
 await assert.rejects(uncertain.request('confirm',{id:'review_2'}),/可能已写入/)
})

test('disabled influence dialog uses an explicit inline review; mandatory confirmations remain dialogs',()=>{
 const client=factory()(async()=>{throw Error('presentation must not send requests')},token)
 assert.equal(client.reviewPresentation({showImpactDialog:false,impact:{mandatory:false}}),'inline')
 assert.equal(client.reviewPresentation({showImpactDialog:true,impact:{mandatory:false}}),'dialog')
 assert.equal(client.reviewPresentation({showImpactDialog:false,impact:{mandatory:true}}),'dialog')
 assert.throws(()=>client.reviewPresentation({}),/预览/)
})
