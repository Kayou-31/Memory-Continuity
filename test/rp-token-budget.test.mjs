import test from 'node:test'
import assert from 'node:assert/strict'
import {api,setup,must,deny} from './fixtures/rp/growth.mjs'
import fs from 'node:fs/promises'
const target={provider:'local-verified',model:'deepseek-ai/DeepSeek-V3.2'}
const ready=()=>{assert.equal(typeof api.createMemoryBudget,'function','new explicit token budget protocol must exist');assert.equal(typeof api.openMemoryMeter,'function')}
test('32768 actual tokenizer tokens fit; 32769 fail without clipping or treating UTF-8 as tokens',async()=>{
 ready();const budget=api.createMemoryBudget(target),meter=await api.openMemoryMeter(budget,target)
 assert.equal(budget.protocol,'memcont.memory-budget/v2');assert.equal(budget.unit,'tokens');assert.equal(budget.limitTokens,32768);assert.equal(meter.identity.mode,'tokenizer-text')
 const text=' hello'.repeat(32768);assert.ok(Buffer.byteLength(text)>32768);assert.equal(api.measureMemoryParts([{kind:'packet',text}],meter).total,32768)
 assert.throws(()=>api.measureMemoryParts([{kind:'packet',text:text+' hello'}],meter),e=>e.code==='context_budget_exceeded')
})
test('every retained packet, tool result and repeated wrapping consumes the same memory budget',async()=>{
 ready();const meter=await api.openMemoryMeter(api.createMemoryBudget(target),target),part=' hello'.repeat(16384)
 assert.equal(api.measureMemoryParts([{kind:'packet',text:part},{kind:'tool',text:part}],meter).total,32768)
 assert.throws(()=>api.measureMemoryParts([{kind:'packet',text:part},{kind:'tool',text:part},{kind:'wrapper',text:' hello'}],meter),e=>e.code==='context_budget_exceeded')
})
test('unknown model is explicitly conservative and changing the actual model cannot reuse the old meter',async()=>{
 ready();const unknown={provider:'test',model:'unverified-model'},budget=api.createMemoryBudget(unknown),meter=await api.openMemoryMeter(budget,unknown)
 assert.equal(meter.identity.mode,'conservative-utf8');assert.equal(meter.count('你好🐉'),Buffer.byteLength('你好🐉'))
 await assert.rejects(()=>api.openMemoryMeter(budget,{...unknown,model:'another'}),e=>e.code==='stale_input')
 assert.throws(()=>api.createMemoryBudget(unknown,{tokenizer:'deepseek-v3.2'}),e=>e.code==='capability_missing')
 assert.throws(()=>api.createMemoryBudget(target,{limitTokens:32769}),e=>e.code==='invalid_record')
})
test('token budget configuration is authenticated, includes layer units and cannot be downgraded by a changed receipt',async()=>{
 ready();const budget=api.createMemoryBudget(target,{layers:{self:4000,recollection:12000}})
 assert.equal(budget.layers.self,4000);assert.equal(budget.layers.recollection,12000)
 assert.throws(()=>api.validateMemoryBudget({...budget,unit:'bytes'}))
 assert.throws(()=>api.validateMemoryBudget({...budget,limitTokens:1}))
})
test('packaged tokenizer counts match independently generated Hugging Face Rust reference vectors',async()=>{
 const vectors=JSON.parse(await fs.readFile('test/fixtures/tokenizers/deepseek-v3.2.json','utf8')),meter=await api.openMemoryMeter(api.createMemoryBudget(target),target)
 assert.equal(vectors.version,'0.22.2');for(const v of vectors.vectors)assert.equal(meter.count(v.text),v.ids.length,JSON.stringify(v.text.slice(0,30)))
})

test('token and legacy byte budgets select authenticated excerpts while the 48 KiB original remains intact',async()=>{
 const f=await setup();try{
  const p=must(await f.person.preview(f.authority,{schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]},'person'));must(await f.person.confirm(f.authority,p.handle,await f.controlSource('person')))
  const original=' hello'.repeat(8192),draft=api.importPersonDocument({documentId:'long',personId:'erin',title:'完整资料',format:'text',text:original}),policies=draft.sections.map(s=>({sectionId:s.sectionId,category:'knowledge',label:'资料',tags:[],enabled:true,when:{kind:'all'}}))
  const preview=must(await f.documents.preview(f.authority,{draft,policies},'doc'));must(await f.documents.confirm(f.authority,preview.handle,await f.controlSource('doc')))
  const budget={recentCompleteTurns:8,targetTotalTokens:48000,triggerTotalTokens:72000,outputReserveTokens:8192,toolReserveTokens:2048,packetSoftTokens:8000,contextWindow:100000,inputLimit:90000},input={budget,globalAuthorities:[],inputBindings:[],personId:'erin',injection:{},query:'hello'}
  const old=must(await f.packets.prepare(f.authority,input)),legacy=old.injection.entries.filter(e=>e.kind==='document'&&e.selected);assert.ok(legacy.length>0,'legacy byte budget can now select bounded original excerpts');assert.ok(legacy.reduce((n,e)=>n+e.bytes,0)<=input.budget.packetSoftTokens);assert.ok(legacy.every(e=>e.sourceSpan&&e.sourceSpan.endUtf16>e.sourceSpan.startUtf16))
  const meter=await api.openMemoryMeter(api.createMemoryBudget(target),target),next=must(await f.packets.prepare(f.authority,{...input,memoryMeter:meter}))
  const entries=next.injection.entries.filter(e=>e.kind==='document'&&e.selected);assert.equal(entries.length,draft.chunks.length);assert.ok(entries.reduce((n,e)=>n+e.bytes,0)<Buffer.byteLength(original));assert.equal(must(await f.documents.read(f.authority,'erin','long')).draft.text,original);assert.ok(entries.every(e=>e.sourceSpan&&e.tokens<e.bytes));assert.ok(entries.reduce((n,e)=>n+e.tokens,0)<12288);assert.equal(next.injection.memoryBudgetSha256,meter.budget.sha256)
  const usage=api.measureMemoryParts([{kind:'packet',text:next.text}],meter);assert.ok(usage.total<32768)
 }finally{await f.close()}
})

test('independent core admission enforces the bound meter even without the DSH send gate',async()=>{
 const f=await setup();try{
  const budget={recentCompleteTurns:8,targetTotalTokens:48000,triggerTotalTokens:72000,outputReserveTokens:8192,toolReserveTokens:2048,packetSoftTokens:8000,contextWindow:100000,inputLimit:90000}
  const tiny=await api.openMemoryMeter(api.createMemoryBudget(target,{limitTokens:1}),target),small=must(await f.packets.prepare(f.authority,{budget,globalAuthorities:[],inputBindings:[],memoryMeter:tiny}))
  deny(await f.packets.admit(f.authority,small,{...target,messages:[]}),'context_budget_exceeded')
  const meter=await api.openMemoryMeter(api.createMemoryBudget(target),target),packet=must(await f.packets.prepare(f.authority,{budget,globalAuthorities:[],inputBindings:[],memoryMeter:meter}))
  deny(await f.packets.admit(f.authority,packet,{...target,model:'changed',messages:[]}),'stale_input')
  must(await f.packets.admit(f.authority,packet,{...target,messages:[{role:'user',content:packet.text}]}))
 }finally{await f.close()}
})

test('independent core refuses a caller-mutated request across asynchronous admission',async()=>{
 const f=await setup();try{
  const budget={recentCompleteTurns:8,targetTotalTokens:48000,triggerTotalTokens:72000,outputReserveTokens:8192,toolReserveTokens:2048,packetSoftTokens:8000,contextWindow:100000,inputLimit:90000},request={...target,messages:[],maxTokens:128}
  const wrapped=new Proxy(f.store,{get(obj,key){if(key==='readFence')return async(...args)=>{const result=await obj.readFence(...args);request.maxTokens=256;return result};return obj[key]}})
  const packets=api.createPacketService(wrapped,f.global),meter=await api.openMemoryMeter(api.createMemoryBudget(target),target),packet=must(await packets.prepare(f.authority,{budget,globalAuthorities:[],inputBindings:[],memoryMeter:meter}))
  deny(await packets.admit(f.authority,packet,request),'stale_input')
 }finally{await f.close()}
})
