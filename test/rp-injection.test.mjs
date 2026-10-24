import test from 'node:test'
import assert from 'node:assert/strict'
import {setup,must,deny} from './fixtures/rp/growth.mjs'
const budget={recentCompleteTurns:8,targetTotalTokens:48000,triggerTotalTokens:72000,outputReserveTokens:8192,toolReserveTokens:2048,packetSoftTokens:8000,contextWindow:100000,inputLimit:90000}
async function person(f){
 const p=must(await f.person.preview(f.authority,{schemaVersion:1,kind:'person-draft',personId:'erin',fields:[
  {fieldId:'name',kind:'identity',value:'林澈',policy:'stable'},
  {fieldId:'origin',kind:'background',value:'钟楼旁长大',policy:'stable'},
  {fieldId:'care',kind:'values',value:'尊重对方的选择',policy:'growable'},
  {fieldId:'mood',kind:'feeling',value:'对远行有些忐忑',policy:'situational',validity:{kind:'scene',sceneId:'scene'}}
 ],relationships:[{targetId:'bea',relation:'trust',value:'愿意向她倾诉'}],goals:[{goalId:'home',category:'promise',objective:'寻找家乡',nextAction:'查地图',targetEntityId:'bea'}]},'person'))
 must(await f.person.confirm(f.authority,p.handle,await f.controlSource('person')))
}
const prepare=(f,query,injection={})=>f.packets.prepare(f.authority,{budget,globalAuthorities:[],inputBindings:[],personId:'erin',injection,query})
test('layered packet excludes unrelated classified fields without leaking full person or projection; core and current feeling survive',async()=>{
 const f=await setup();try{await person(f);const p=must(await prepare(f,'天气如何'))
 assert.ok(p.injection,'layered selection must exist')
 assert.match(p.text,/林澈/);assert.match(p.text,/尊重对方的选择/);assert.match(p.text,/对远行有些忐忑/)
 assert.doesNotMatch(p.text,/钟楼旁长大/);assert.doesNotMatch(p.text,/愿意向她倾诉/)
 assert.ok(p.injection.entries.some(e=>e.layer==='self'&&!e.selected&&e.reasons.includes('condition_not_matched')))
 assert.equal(p.optimizer,'standalone');assert.equal(p.injection.context.sceneId,'scene')
 }finally{await f.close()}
})
test('recollection selects actual supported event at evidence depth and keeps explicit direction and source refs',async()=>{
 const f=await setup();try{await person(f);const eventId=await f.experience('tower','林澈与 bea 一起修好了钟楼')
 const p=must(await prepare(f,'回忆钟楼和 bea',{depth:'evidence'}))
 assert.ok(p.injection.entries.some(e=>e.id===eventId&&e.selected&&e.depth==='evidence'))
 assert.match(p.text,/钟楼旁长大/);assert.match(p.text,/愿意向她倾诉/);assert.match(p.text,/erin → bea/)
 assert.match(p.text,/事实/);assert.match(p.text,/来源/);assert.doesNotMatch(p.text,/bea → erin/)
 const silent=must(await prepare(f,'天气如何'));assert.ok(silent.injection.entries.some(e=>e.id===eventId&&!e.selected))
 }finally{await f.close()}
})
test('conditions combine mode scene terms and alias; explicit exclusions beat pins and cannot erase mandatory identity',async()=>{
 const f=await setup();try{await person(f);const eventId=await f.experience('star','一起观看星星')
 const p=must(await prepare(f,'回忆夜空',{pin:[eventId],exclude:[eventId]}));assert.ok(p.injection.entries.find(e=>e.id===eventId).reasons.includes('excluded'))
 const name=must(await f.person.read(f.authority,'erin')).fields.find(x=>x.fieldId==='name').eventId
 deny(await prepare(f,'hello',{exclude:[name]}),'scope_denied')
 const off=must(await prepare(f,'夜空',{rules:[{layer:'recollection',when:{modes:['project'],terms:['夜空']},depth:'evidence'}]}));assert.equal(off.injection.entries.find(e=>e.id===eventId).selected,false)
 const on=must(await prepare(f,'小贝',{aliases:{bea:['小贝']},rules:[{layer:'relationships',when:{scenes:['scene'],entities:['bea']},depth:'association'}]}));assert.match(on.text,/愿意向她倾诉/)
 deny(await prepare(f,'x',{rules:[{layer:'self',when:{script:'true'}}]}),'invalid_record')
 }finally{await f.close()}
})
test('optional budget drops with reasons; prepared proofs reject state changes and forged config; no person fails closed',async()=>{
 const f=await setup();try{await person(f);const eventId=await f.experience('star','一起观看星星')
 const p=must(await prepare(f,'回忆星星',{budgets:{recollection:0}}));assert.ok(p.injection.entries.find(e=>e.id===eventId).reasons.includes('budget_exceeded'))
 const old=must(await prepare(f,'星星'));await f.experience('later','另一天');deny(await f.packets.admit(f.authority,old,{messages:[]}), 'stale_input')
 deny(await f.packets.prepare(f.authority,{budget,globalAuthorities:[],inputBindings:[],injection:{},query:'hello'}),'scope_denied')
 deny(await prepare(f,'x',{budgets:{self:-1}}),'invalid_record')
 }finally{await f.close()}
})

test('Chinese keyword selection is independent of odd or even phrase offset',async()=>{
 const f=await setup();try{await person(f);for(const query of ['钟楼','我去钟楼','我想去钟楼'])assert.match(must(await prepare(f,query)).text,/钟楼旁长大/,query)}finally{await f.close()}
})

test('situational feelings are labeled as subjective and expired feelings cannot be revived by pins',async()=>{
 const f=await setup();try{await person(f);const p=must(await prepare(f,'你好'));assert.match(p.text,/感受记录/);assert.doesNotMatch(p.text,/事实 · 当时的感受/)
 const mood=must(await f.person.read(f.authority,'erin')).fields.find(x=>x.fieldId==='mood').eventId,other=must(await f.control.authorize({...f.request,sceneId:'another_scene'}))
 const next=must(await prepare({...f,authority:other},'远行',{pin:[mood]}));assert.doesNotMatch(next.text,/对远行有些忐忑/)
 }finally{await f.close()}
})
test('lexical truncation is disclosed rather than claimed as a complete relevance search',async()=>{
 const f=await setup();try{await person(f);const p=must(await prepare(f,Array.from({length:140},(_,i)=>'term'+i).join(' ')+' 钟楼'));assert.equal(p.injection.lexicalTermsTruncated,true)}finally{await f.close()}
})
