import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {host} from './fixtures/rp/native-host.mjs'
const {api,must}=await import('./fixtures/rp/growth.mjs')
const ok=r=>{assert.equal(r.kind,'success',r.text);return r.text},value=r=>JSON.parse(ok(r))
test('native model document search/get binds returned source ranges and refuses revised history before the next call',async()=>{
 const f=await host({entityIds:['erin']});let calls=0,found
 class Terminal extends LlmAdapter{async *stream(options){
  calls++;assert.ok(options.tools.some(t=>t.name==='memcont_document_search'));assert.ok(options.tools.some(t=>t.name==='memcont_document_get'))
  if(calls===2){const tool=options.messages.findLast(m=>m.role==='tool');const result=JSON.parse(tool.content.find(c=>c.type==='text').text);assert.match(JSON.stringify(result),/中段秘密/);found=result.value.items[0]}
  if(calls<=2){yield {type:'tool-call-delta',index:0,id:'document_call_'+calls,name:calls===1?'memcont_document_search':'memcont_document_get',argumentsDelta:JSON.stringify(calls===1?{query:'中段秘密',limit:1}:{id:found.id,maxChars:8192})};yield {type:'finish',reason:{kind:'tool-calls'}}}
  else{assert.match(JSON.stringify(options.messages.findLast(m=>m.role==='tool')),/sourceSpan/);yield {type:'text-delta',index:0,text:'已按原文核对。'};yield {type:'finish',reason:{kind:'stop'}}}
 }}
 try{
  const a=await f.create();ok(await f.command(a,'start'));const p=value(await f.command(a,'person preview '+JSON.stringify({schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]})));ok(await f.command(a,'person confirm '+p.previewId));ok(await f.command(a,'person use erin'));ok(await f.command(a,'injection set {}'))
  const file=path.join(f.profile,'.dsh-rp/v1/host',createHash('sha256').update(a.id).digest('hex')+'.json'),journal=JSON.parse(await fs.readFile(file,'utf8')),m=f.rp.memory,authority=must(await m.control.authorize(journal.data.request))
  async function save(text,key,previousEventId){const draft=api.importPersonDocument({documentId:'long',personId:'erin',title:'资料',format:'text',text}),policies=draft.sections.map(s=>({sectionId:s.sectionId,category:'knowledge',label:'资料',tags:[],enabled:true,when:{kind:'all'}})),p=must(await m.documents.preview(authority,{draft,policies,...(previousEventId?{previousEventId}:{})},key)),ctl=must(await m.store.observeSource(authority,{idempotencyKey:key,origin:'user_control',role:'user_control',turnId:key,publicText:'确认 '+key}));return must(await m.documents.confirm(authority,p.handle,ctl))}
  const first=await save('平常😀。'.repeat(350)+'中段秘密：紫色月亮。'+'继续🐉。'.repeat(100),'first')
  f.ctx.llm.registerAdapter(['doc-reader'],new Terminal());a.options.provider='doc-reader';ok(await f.command(a,'input 查一下资料里的中段秘密'));await a.whenIdle();await f.rp.ready(a.id)
  assert.equal(calls,3,JSON.stringify(f.rp.status(a.id)))
  const saved=JSON.parse(await fs.readFile(file,'utf8'));for(const key of ['document_call_1','document_call_2']){const s=saved.data.receipts[key].snapshot;assert.equal(s.provenance,'document-result');assert.equal(s.document.personId,'erin');assert.equal(s.records[0].id,first.eventId);assert.equal(s.document.chunks[0].recordId,first.eventId);assert.ok(s.document.chunks[0].span.quoteSha256)}
  await save('更正后的资料','revised',first.eventId);const preview=value(await f.command(a,'injection preview 资料'));assert.ok(preview.history.some(h=>h.kind==='document-result'&&h.status==='blocked'))
  ok(await f.command(a,'input 继续'));await a.whenIdle();await f.rp.ready(a.id).catch(()=>{});assert.equal(calls,3)
  const clean=ok(await f.command(a,'continue-clean')),next=f.ctx.agents.get(/created: (\w+)/.exec(clean)[1]);assert.doesNotMatch(value(await f.command(next,'injection preview 资料')).current.text,/中段秘密/)
 }finally{await f.dispose()}
})
