import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {setup,must,deny,api} from './fixtures/rp/growth.mjs'
const hash=s=>createHash('sha256').update(s).digest('hex')
const budget={recentCompleteTurns:8,targetTotalTokens:48000,triggerTotalTokens:72000,outputReserveTokens:8192,toolReserveTokens:2048,packetSoftTokens:16000,contextWindow:100000,inputLimit:90000}
async function fixture(){
 const f=await setup(),p=must(await f.person.preview(f.authority,{schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]},'person'));must(await f.person.confirm(f.authority,p.handle,await f.controlSource('person')))
 f.save=async(text,key,previousEventId,when={kind:'all'})=>{const draft=api.importPersonDocument({documentId:'long',personId:'erin',title:'长资料',format:'markdown',text}),policies=draft.sections.map(s=>({sectionId:s.sectionId,category:'knowledge',label:s.title,tags:[],enabled:true,when})),preview=must(await f.documents.preview(f.authority,{draft,policies,...(previousEventId?{previousEventId}:{})},key));return {draft,...must(await f.documents.confirm(f.authority,preview.handle,await f.controlSource(key)))}}
 f.original='# 开端\n起点秘密 青铜钥匙。'+('平常的一天😀。'.repeat(380))+'\n# 中段\n'+('小镇平静💫。'.repeat(180))+'中段秘密 紫色月亮。'+('继续走过🐉。'.repeat(210))+'\n# 末端\n'+('海浪慢慢🌊。'.repeat(380))+'末端秘密 银色灯塔。'
 f.doc=await f.save(f.original,'first');f.access={personId:'erin'};return f
}
test('long Chinese document beginning, middle and end fit follow-up injection as exact bounded evidence',async()=>{
 const f=await fixture();try{for(const query of ['青铜钥匙','紫色月亮','银色灯塔']){
  const packet=must(await f.packets.prepare(f.authority,{budget,globalAuthorities:[],inputBindings:[],personId:'erin',injection:{depth:'evidence',budgets:{recollection:1100}},query}));assert.match(packet.text,new RegExp(query))
  const entries=packet.injection.entries.filter(e=>e.kind==='document'&&e.selected);assert.ok(entries.length);assert.ok(entries.reduce((s,e)=>s+e.bytes,0)<=1100)
  for(const entry of entries){const span=entry.sourceSpan,text=must(await f.store.readSource(f.authority,span));assert.equal(hash(text),span.quoteSha256);assert.equal(text,f.original.slice(span.startUtf16,span.endUtf16));assert.ok(text.isWellFormed());assert.ok(text.length<512)}
 }assert.equal(must(await f.documents.read(f.authority,'erin','long')).draft.text,f.original)}finally{await f.close()}
})
test('document search and paged get bind exact spans; fixed result set survives unrelated append',async()=>{
 const f=await fixture();try{
  assert.ok(f.documentRetrieval,'dedicated model document retrieval must exist')
  const first=must(await f.documentRetrieval.search(f.authority,f.access,{query:'',limit:1}));assert.ok(first.nextCursor);const originalManifest=first.resultManifestHash
  await f.experience('unrelated','UNRELATED_APPEND')
  const next=must(await f.documentRetrieval.search(f.authority,f.access,{cursor:first.nextCursor}));assert.equal(next.resultManifestHash,originalManifest);assert.notEqual(next.items[0].id,first.items[0].id)
  const found=must(await f.documentRetrieval.search(f.authority,f.access,{query:'紫色月亮'}));assert.ok(found.items.length);assert.match(found.items[0].excerpt,/紫色月亮/)
  const item=found.items[0];let cursor,text='',pages=0
  do{const page=must(await f.documentRetrieval.get(f.authority,f.access,cursor?{cursor,maxChars:47}:{id:item.id,maxChars:47}));assert.equal(page.recordId,item.recordId);assert.equal(hash(page.text),page.sourceSpan.quoteSha256);assert.equal(page.text,f.original.slice(page.sourceSpan.startUtf16,page.sourceSpan.endUtf16));assert.ok(page.text.isWellFormed());text+=page.text;cursor=page.nextCursor;assert.ok(++pages<200)}while(cursor)
  assert.match(text,/紫色月亮/);deny(await f.retrieval.get(f.authority,{id:item.recordId}),'scope_denied')
  const small=must(await f.documentRetrieval.get(f.authority,f.access,{id:item.id,maxChars:4096},{fits:r=>Buffer.byteLength(JSON.stringify(r))<1200}));assert.ok(small.nextCursor);assert.ok(Buffer.byteLength(JSON.stringify({ok:true,value:small}))<1200)
  deny(await f.documentRetrieval.get(f.authority,f.access,{id:item.id},{fits:()=>false}),'context_budget_exceeded')
 }finally{await f.close()}
})
test('document receipts and cursors reject revised, withdrawn, wrong-person or revoked audience reads',async()=>{
 const f=await fixture();try{
  assert.ok(f.documentRetrieval)
  const a=f.audiences.create(f.authority,{platform:'qq',accountId:'bot',kind:'direct',senderId:'user'}),access={personId:'erin',audience:a.context()}
  const revised=await f.save(f.original,'private',f.doc.eventId,{kind:'direct',platform:'qq',accountId:'bot',senderIds:['user']})
  assert.deepEqual(must(await f.documentRetrieval.search(f.authority,f.access,{query:''})).items,[])
  const result=await f.documentRetrieval.search(f.authority,access,{query:'',limit:1}),found=must(result),proof=f.documentRetrieval.evidence(result,f.authority)
  deny(await f.documentRetrieval.get(f.authority,{personId:'bea'},{id:found.items[0].id}),'source_unavailable')
  a.revoke();deny(await f.documentRetrieval.search(f.authority,access,{cursor:found.nextCursor}),'ownership_lost')
  const a2=f.audiences.create(f.authority,{platform:'qq',accountId:'bot',kind:'direct',senderId:'user'}),access2={personId:'erin',audience:a2.context()}
  const prior=must(await f.documentRetrieval.search(f.authority,access2,{query:'',limit:1}));await f.save('REVISED_DOCUMENT','revised',revised.eventId)
  deny(await f.documentRetrieval.search(f.authority,access2,{cursor:prior.nextCursor}),'stale_input')
  await assert.rejects(()=>f.documentRetrieval.verify(f.authority,proof,access2),/changed|unavailable|revised/)
 }finally{await f.close()}
})
for(const mutation of ['withdraw','privacy'])test('document '+mutation+' during assembly prevents releasing the old excerpt',async()=>{
 const f=await fixture();try{
  const control=await f.controlSource(mutation),item=must(await f.documentRetrieval.search(f.authority,f.access,{query:'紫色月亮'})).items[0]
  let changed=false
  const wrapped=new Proxy(f.store,{get(target,key){if(key==='withReadView')return(a,work,options)=>target.withReadView(a,async view=>{const old=await work(view);if(!changed){changed=true
   if(mutation==='withdraw')must(await f.documents.retract(f.authority,control,{personId:'erin',documentId:'long',previousEventId:f.doc.eventId,expected:await f.fence(),idempotencyKey:'withdraw'}))
   else must(await f.canonical.applyControl(f.authority,control,{kind:'privacy_delete',idempotencyKey:'privacy',expected:await f.fence(),sourceRevisionIds:[item.span.sourceRevisionId],affectedBranchIds:[f.request.branchId]}))
  }return old},options);return target[key]}})
  const reader=api.createDocumentRetrieval(wrapped);deny(await reader.get(f.authority,f.access,{id:item.id}),'stale_input');assert.equal(changed,true);assert.deepEqual(must(await f.documentRetrieval.search(f.authority,f.access,{query:''})).items,[])
 }finally{await f.close()}
})
test('document proof is tied to exact returned content and cannot be rebound after mutation',async()=>{
 const f=await fixture();try{
  const result=await f.documentRetrieval.search(f.authority,f.access,{query:'紫色月亮'});must(result);const proof=f.documentRetrieval.evidence(result,f.authority)
  await f.documentRetrieval.verify(f.authority,proof,f.access)
  result.value.items[0].excerpt='伪造原文';assert.throws(()=>f.documentRetrieval.evidence(result,f.authority),/Uncertified/)
  proof.document.chunks[0].span.quoteSha256='0'.repeat(64);await assert.rejects(()=>f.documentRetrieval.verify(f.authority,proof,f.access),/unavailable/)
 }finally{await f.close()}
})
test('caller mutation cannot remove the original audience handle from the final revocation check',async()=>{
 const f=await fixture();try{
  await f.save('PRIVATE_BODY','private',f.doc.eventId,{kind:'direct',platform:'qq',accountId:'bot',senderIds:['user']})
  const audience=f.audiences.create(f.authority,{platform:'qq',accountId:'bot',kind:'direct',senderId:'user'}),access={personId:'erin',audience:audience.context()}
  const wrapped=new Proxy(f.store,{get(target,key){if(key==='withReadView')return(a,work,options)=>target.withReadView(a,async view=>{const old=await work(view);audience.revoke();delete access.audience;return old},options);return target[key]}})
  deny(await api.createDocumentRetrieval(wrapped).search(f.authority,access,{query:'PRIVATE_BODY'}),'ownership_lost')
 }finally{await f.close()}
})
test('sizing callbacks cannot rewrite the exact document content that is certified',async()=>{
 const f=await fixture();try{
  const result=await f.documentRetrieval.search(f.authority,f.access,{query:'紫色月亮'},{fits:r=>{r.value.items[0].excerpt='FORGED';return true}});assert.match(must(result).items[0].excerpt,/紫色月亮/)
  await f.documentRetrieval.verify(f.authority,f.documentRetrieval.evidence(result,f.authority),f.access)
 }finally{await f.close()}
})
