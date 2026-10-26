import test from 'node:test'
import assert from 'node:assert/strict'
import {setup,must,deny} from './fixtures/rp/growth.mjs'
test('search sizes the fixed result before certification and preserves offsets across smaller pages and unrelated appends',async()=>{
 const f=await setup();try{
  for(let i=0;i<4;i++)await f.experience('memory_'+i,'海边散步 '+i)
  const first=must(await f.retrieval.search(f.authority,{query:'海边散步',limit:4},{fits:r=>r.value.items.length<=1}));assert.equal(first.items.length,1);assert.ok(first.nextCursor)
  await f.experience('later','海边散步 新增不能进入旧分页')
  const ids=first.items.map(i=>i.id);let cursor=first.nextCursor
  while(cursor){const r=must(await f.retrieval.search(f.authority,{cursor,limit:4},{fits:r=>r.value.items.length<=1}));assert.equal(r.resultManifestHash,first.resultManifestHash);ids.push(...r.items.map(i=>i.id));cursor=r.nextCursor}
  assert.equal(ids.length,4);assert.equal(new Set(ids).size,4)
  deny(await f.retrieval.search(f.authority,{query:'海边散步'},{fits:()=>false}),'context_budget_exceeded')
 }finally{await f.close()}
})
test('body pages fit before binding, retain whole emoji and reproduce exact original without clipping the certified result',async()=>{
 const f=await setup();try{
  const id=await f.experience('long','🐉你好'.repeat(300)),parts=[];let input={id,maxChars:4096},hash
  do{const r=must(await f.retrieval.get(f.authority,input,{fits:r=>Buffer.byteLength(r.value.text)<=100}));assert.ok(r.text.isWellFormed());assert.ok(Buffer.byteLength(r.text)<=100);if(hash)assert.equal(hash,r.bodySha256);hash=r.bodySha256;parts.push(r.text);input=r.nextCursor?{cursor:r.nextCursor,maxChars:4096}:null}while(input)
  const full=must(await f.retrieval.get(f.authority,{id}));assert.equal(parts.join(''),full.text)
  deny(await f.retrieval.get(f.authority,{id},{fits:()=>false}),'context_budget_exceeded')
 }finally{await f.close()}
})
