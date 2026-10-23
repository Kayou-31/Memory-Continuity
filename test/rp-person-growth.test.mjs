import test from 'node:test'
import assert from 'node:assert/strict'
import {setup,must,deny} from './fixtures/rp/growth.mjs'
async function create(f,extra=[]) {
  const p=must(await f.person.preview(f.authority,{schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'},{fieldId:'care',kind:'values',value:'谨慎信任',policy:'growable'},...extra],relationships:[],goals:[]},'create'))
  must(await f.person.confirm(f.authority,p.handle,await f.controlSource('create')))
}
const read=async f=>must(await f.person.read(f.authority,'erin'))
const head=async(f,key)=>(await read(f)).fields.find(v=>v.fieldId===key)
const apply=async(f,key,op)=>f.person.apply(f.authority,await f.controlSource(key),{personId:'erin',...op,expected:await f.fence(),idempotencyKey:key})
test('person edit keeps history, grow needs growable policy and real experience; policy change stales candidates',async()=>{
 const f=await setup()
 try {
  await create(f);const name=await head(f,'name'),care=await head(f,'care'), cause=await f.experience('rescue','共同救援')
  deny(await f.person.propose(f.authority,{changes:[{changeId:'locked',personId:'erin',fieldId:'name',previousEventId:name.eventId,value:'Changed',causeEventIds:[cause],note:'原因'}]},'locked'),'scope_denied')
  deny(await f.person.propose(f.authority,{changes:[{changeId:'empty',personId:'erin',fieldId:'care',previousEventId:care.eventId,value:'Trust',causeEventIds:[],note:'原因'}]},'empty'))
  const candidate=must(await f.person.propose(f.authority,{changes:[{changeId:'care',personId:'erin',fieldId:'care',previousEventId:care.eventId,value:'愿意托付',causeEventIds:[cause],note:'一起承担风险'}]},'care'))
  must(await apply(f,'policy',{operation:'set-policy',fieldId:'care',previousEventId:care.eventId,policy:'stable',note:'保持稳定'}))
  assert.equal((await head(f,'care')).value,care.value)
  deny(await f.person.adopt(f.authority,await f.controlSource('adopt'),[candidate.id],'adopt'),'stale_input')
  must(await apply(f,'rename',{operation:'edit',fieldId:'name',previousEventId:name.eventId,value:'林川',note:'从今天开始使用新名字'}))
  assert.equal((await head(f,'name')).value,'林川');assert.ok(must(await f.store.readEvents(f.authority)).some(e=>e.id===name.eventId))
  assert.equal((await read(f)).fields.filter(v=>v.fieldId==='name').length,1)
  assert.ok(must(await f.person.timeline(f.authority,'erin')).changes.some(v=>v.eventId===name.eventId))
 }finally{await f.close()}
})
test('situational person fields expire by accepted sequence or scene without deleting history or reviving predecessors',async()=>{
 const f=await setup()
 try {
  await create(f,[{fieldId:'mood',kind:'feeling',value:'安心',policy:'situational',validity:{kind:'sequence',from:1,through:2}},{fieldId:'stage',kind:'stage',value:'钟楼篇',policy:'situational',validity:{kind:'scene',sceneId:'scene'}}])
  const mood=await head(f,'mood');assert.ok(mood)
  await f.experience('one','第一幕');await f.experience('two','第二幕')
  assert.equal(await head(f,'mood'),undefined); assert.ok(must(await f.store.readEvents(f.authority)).some(e=>e.id===mood.eventId))
  assert.ok(!must(await f.store.replayProjection(f.authority)).state.some(s=>s.key==='person:mood'))
  const elsewhere=must(await f.control.authorize({...f.request,sceneId:'other'}))
  assert.ok(!must(await f.person.read(elsewhere,'erin')).fields.some(v=>v.fieldId==='stage'))
 }finally{await f.close()}
})
test('growth batch is deterministic, supports explicit predecessor chains, rejects conflicts atomically and restores cold',async()=>{
 for(const reverse of [false,true]){
  const f=await setup()
  try {
   await create(f,[{fieldId:'curiosity',kind:'trait',value:'观望',policy:'growable'}]);const care=await head(f,'care'),curious=await head(f,'curiosity'),cause=await f.experience('journey','一起探索旧城')
   const a={changeId:'a',personId:'erin',fieldId:'care',previousEventId:care.eventId,value:'信任',causeEventIds:[cause],note:'共同经历'},b={...a,changeId:'b',fieldId:'curiosity',previousEventId:curious.eventId,value:'主动探索'}
   const first=must(await f.person.propose(f.authority,{changes:[a]},'first')),second=must(await f.person.propose(f.authority,{changes:[b]},'second')),conflict=must(await f.person.propose(f.authority,{changes:[{...a,changeId:'conflict',value:'不信任'}]},'conflict'))
   const before=await f.fence();deny(await f.person.adopt(f.authority,await f.controlSource('conflict'),[first.id,conflict.id],'conflict'),'stale_input');assert.deepEqual(await f.fence(),before)
   const selected=reverse?[second.id,first.id]:[first.id,second.id],ctl=await f.controlSource('adopt'),result=must(await f.person.adopt(f.authority,ctl,selected,'adopt'))
   assert.equal((await head(f,'care')).value,'信任');assert.equal((await head(f,'curiosity')).value,'主动探索')
   assert.deepEqual(must(await f.person.adopt(f.authority,ctl,[...selected].reverse(),'adopt')),result)
   const c={...a,changeId:'c',previousEventId:(await head(f,'care')).eventId,value:'依赖'},d={...a,changeId:'d',previousEventId:null,previousChangeId:'c',value:'互相托付'}
   const chain=must(await f.person.propose(f.authority,{changes:reverse?[d,c]:[c,d]},'chain'));must(await f.person.adopt(f.authority,await f.controlSource('chain'),[chain.id],'chain'))
   assert.equal((await head(f,'care')).value,'互相托付')
   const cold=await setup(f.directory,f.request);try{assert.deepEqual((await read(cold)).fields,(await read(f)).fields)}finally{await cold.close()}
  }finally{await f.close()}
 }
})
test('Retcon invalidates dependent person growth without changing a fixed child; privacy removes growth candidates too',async()=>{
 const f=await setup()
 try{
  await create(f);const care=await head(f,'care'),cause=await f.experience('rescue','PRIVATE_RESCUE')
  const candidate=must(await f.person.propose(f.authority,{changes:[{changeId:'care',personId:'erin',fieldId:'care',previousEventId:care.eventId,value:'信任',causeEventIds:[cause],note:'PRIVATE_REASON'}]},'care'))
  must(await f.person.adopt(f.authority,await f.controlSource('adopt'),[candidate.id],'adopt'))
  const manifest=must(await f.canonical.forkManifest(f.authority,(await f.fence()).contextRevision)),child=must(await f.canonical.forkBranch(f.authority,{...manifest,idempotencyKey:'fork'}))
  const childAuthority=must(await f.control.authorize({...f.request,branchId:child.id}))
  must(await f.canonical.applyControl(f.authority,await f.controlSource('retcon'),{kind:'retcon',idempotencyKey:'retcon',expected:await f.fence(),targetEventIds:[cause],events:[]}))
  assert.equal((await head(f,'care')).value,care.value);assert.equal(must(await f.person.read(childAuthority,'erin')).fields.find(f=>f.fieldId==='care').value,'信任')
  assert.equal(must(await f.person.list(f.authority)).length,0)
  const causeSourceId=must(await f.store.readEvents(childAuthority)).find(e=>e.id===cause).sources[0].sourceRevisionId, source=must(await f.store.readLedger(f.authority)).sources.find(s=>s.id===causeSourceId)
  must(await f.canonical.applyControl(f.authority,await f.controlSource('delete'),{kind:'privacy_delete',idempotencyKey:'delete',expected:await f.fence(),sourceRevisionIds:[source.id],affectedBranchIds:[f.request.branchId,child.id]},[f.authority,childAuthority]))
  assert.equal(must(await f.store.readPayloadCopies(f.authority)).filter(c=>c.id===candidate.id).length,0)
  assert.equal(must(await f.person.read(childAuthority,'erin')).fields.find(f=>f.fieldId==='care').value,care.value)
 }finally{await f.close()}
})
test('growth cannot borrow another field predecessor or carry policy edits in a candidate',async()=>{
 const f=await setup()
 try{
  await create(f);const care=await head(f,'care'),cause=await f.experience('cause','经历')
  const change={changeId:'wrong',personId:'erin',fieldId:'missing',previousEventId:care.eventId,value:'Unrelated',causeEventIds:[cause],note:'原因'}
  deny(await f.person.propose(f.authority,{changes:[change]},'wrong'),'stale_input')
  deny(await f.person.propose(f.authority,{changes:[{...change,fieldId:'care',policy:'stable'}]},'policy'))
 }finally{await f.close()}
})
test('reject retry is durable and immutable, sixteen changes fit and seventeen reject without publication',async()=>{
 const f=await setup()
 try{
  await create(f);const care=await head(f,'care'),cause=await f.experience('cause','经历'),change={changeId:'c0',personId:'erin',fieldId:'care',previousEventId:care.eventId,value:'信任',causeEventIds:[cause],note:'原因'}
  const p=must(await f.person.propose(f.authority,{changes:[change]},'rejected')),ctl=await f.controlSource('reject'),once=must(await f.person.reject(f.authority,ctl,p.id,'reject'))
  assert.deepEqual(must(await f.person.reject(f.authority,ctl,p.id,'reject')),once)
  deny(await f.person.adopt(f.authority,await f.controlSource('adopt'),[p.id],'adopt'))
  const changes=Array.from({length:16},(_,i)=>({...change,changeId:'c'+i,previousEventId:i?null:care.eventId,...(i?{previousChangeId:'c'+(i-1)}:{}),value:'成长'+i}))
  const valid=must(await f.person.propose(f.authority,{changes},'sixteen'))
  deny(await f.person.propose(f.authority,{changes:[...changes,{...changes[0],changeId:'c16'}]},'seventeen'))
  must(await f.person.adopt(f.authority,await f.controlSource('sixteen'),[valid.id],'sixteen'));assert.equal((await head(f,'care')).value,'成长15')
  const events=must(await f.store.readEvents(f.authority)).filter(e=>valid.changes.some(c=>c.eventId===e.id));assert.ok(events.every(e=>e.sources.length===2),'direct cause and control only')
 }finally{await f.close()}
})
test('timeline invalidation IDs are scoped to that person and expired heads never revive earlier values',async()=>{
 const f=await setup()
 try{
  await create(f,[{fieldId:'mood',kind:'feeling',value:'之前',policy:'situational',validity:{kind:'sequence',from:1,through:99}}]);const mood=await head(f,'mood')
  must(await apply(f,'mood',{operation:'edit',fieldId:'mood',previousEventId:mood.eventId,value:'短暂安心',validity:{kind:'sequence',from:1,through:2},note:'短暂感受'}));await f.experience('advance','下一幕')
  assert.equal(await head(f,'mood'),undefined);assert.ok(!must(await f.store.replayProjection(f.authority)).state.some(s=>s.key==='person:mood'))
  const p=must(await f.person.preview(f.authority,{schemaVersion:1,kind:'person-draft',personId:'bea',fields:[{fieldId:'name',kind:'identity',value:'阿岚',policy:'stable'}],relationships:[],goals:[]},'bea'))
  const made=must(await f.person.confirm(f.authority,p.handle,await f.controlSource('bea')))
  must(await f.canonical.applyControl(f.authority,await f.controlSource('retcon_bea'),{kind:'retcon',targetEventIds:[made.originEventId],events:[],expected:await f.fence(),idempotencyKey:'retcon_bea'}))
  assert.deepEqual(must(await f.person.timeline(f.authority,'erin')).invalidatedEventIds,[])
 }finally{await f.close()}
})
