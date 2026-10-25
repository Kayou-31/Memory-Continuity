import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'
import {setup,must,deny} from '../../test/fixtures/rp/growth.mjs'
import {scoreLifeEvidence} from './life-score.mjs'
const out=path.resolve(process.argv[2]??'work/person-m4-2026-10-23/life-report.json'),started=performance.now(),observations=[]
await fs.mkdir(path.dirname(out),{recursive:true})
const progress=async data=>{const entry={at:new Date().toISOString(),...data};await fs.appendFile(out+'.progress.jsonl',JSON.stringify(entry)+'\n');console.error(JSON.stringify(entry))}
const run=async(name,fn)=>{const start=performance.now();await progress({stage:name,state:'started'});try{await fn();observations.push({name,passed:true,ms:performance.now()-start});await progress({stage:name,state:'passed'})}catch(e){await progress({stage:name,state:'failed',error:String(e)});throw e}}
const f=await setup(),read=()=>f.person.read(f.authority,'erin').then(must),field=async id=>(await read()).fields.find(f=>f.fieldId===id)
let cold,comparison
try{
 const draft={schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'},{fieldId:'care',kind:'trait',value:'谨慎信任',policy:'growable'},{fieldId:'boundary',kind:'boundaries',value:'不伪造经历',policy:'stable'},{fieldId:'mood',kind:'feeling',value:'暂时紧张',policy:'situational',validity:{kind:'sequence',from:1,through:3}}],relationships:[],goals:[]}
 const preview=must(await f.person.preview(f.authority,draft,'create'));must(await f.person.confirm(f.authority,preview.handle,await f.controlSource('create')))
 const initial=must(await f.store.readEvents(f.authority)),cause=await f.experience('rescue','钟楼救援：林澈救出阿岚，并共同保管钥匙。'),care=await field('care')
 let growth
 await run('identity-growth-and-expiring-context',async()=>{
  const change={changeId:'care',personId:'erin',fieldId:'care',previousEventId:care.eventId,value:'愿意托付',causeEventIds:[cause],note:'一起经历钟楼救援'}
  deny(await f.person.propose(f.authority,{changes:[{...change,fieldId:'boundary',previousEventId:(await field('boundary')).eventId}]},'locked'),'scope_denied')
  growth=must(await f.person.propose(f.authority,{changes:[change]},'care'));assert.equal((await field('care')).value,'谨慎信任')
  must(await f.person.adopt(f.authority,await f.controlSource('adopt'),[growth.id],'adopt'));assert.equal((await field('care')).value,'愿意托付')
  for(let i=0;i<120;i++){await f.experience('day_'+i,'旅途第'+i+'站：整理行李，记录天气。');if((i+1)%30===0)await progress({stage:'history-growth',accepted:i+1})}
  assert.equal((await field('name')).value,'林澈');assert.equal(await field('mood'),undefined)
 })
 await run('directional-relationship-and-promise',async()=>{
  must(await f.apply('trust',{kind:'relationship',fromId:'erin',toId:'bea',relation:'trust',value:'愿意托付',previousEventId:null,causeEventIds:[cause],note:'救援之后'}))
  const goal={kind:'goal',ownerId:'erin',goalId:'return_key',category:'promise',targetEntityId:'bea',objective:'归还钥匙',status:'active',progress:0,nextAction:'前往钟楼',previousEventId:null,causeEventIds:[cause],note:'救援之后'}
  const first=must(await f.apply('promise',goal));must(await f.apply('pause',{...goal,status:'paused',previousEventId:first.eventId}))
  const projection=must(await f.store.replayProjection(f.authority));assert.ok(projection.relationships.some(r=>r.fromId==='erin'&&r.toId==='bea'));assert.ok(!projection.relationships.some(r=>r.fromId==='bea'&&r.toId==='erin'))
  const view=await read();assert.ok(JSON.stringify(view.goals).includes('paused'));assert.ok(JSON.stringify(view.goals).includes('归还钥匙'))
 })
 const beforeRetcon=must(await f.store.readEvents(f.authority)),branch=must(await f.canonical.forkBranch(f.authority,{...must(await f.canonical.forkManifest(f.authority,(await f.fence()).contextRevision)),idempotencyKey:'fork'})),child=must(await f.control.authorize({...f.request,branchId:branch.id}))
 await run('retcon-privacy-and-life-branch-isolation',async()=>{
  must(await f.canonical.applyControl(f.authority,await f.controlSource('retcon'),{kind:'retcon',idempotencyKey:'retcon',expected:await f.fence(),targetEventIds:[cause],events:[]}))
  assert.equal((await field('care')).value,'谨慎信任');assert.equal(must(await f.person.read(child,'erin')).fields.find(f=>f.fieldId==='care').value,'愿意托付')
  const source=beforeRetcon.find(e=>e.id===cause).sources[0].sourceRevisionId
  must(await f.canonical.applyControl(f.authority,await f.controlSource('delete'),{kind:'privacy_delete',idempotencyKey:'delete',expected:await f.fence(),sourceRevisionIds:[source],affectedBranchIds:[f.request.branchId,branch.id]},[f.authority,child]))
  assert.ok(!must(await f.retrieval.search(f.authority,{query:'钟楼救援'})).items.some(i=>i.id===cause));assert.equal(must(await f.person.read(child,'erin')).fields.find(f=>f.fieldId==='care').value,'谨慎信任')
 })
 await run('module-revocation-and-cold-reconstruction',async()=>{
  const runtime=f.modules.create(f.authority,{mode:'companion',enabledModules:['person-view'],constraints:{}}),result=await runtime.run('person-view',{personId:'erin'})
  assert.equal((await runtime.verify(result)).moduleId,'person-view');runtime.revoke();await assert.rejects(runtime.run('person-view',{personId:'erin'}),/revoked/i)
  cold=await setup(f.directory,f.request);assert.deepEqual(must(await cold.person.read(cold.authority,'erin')).fields,(await read()).fields)
 })
 // Fixed, synthetic corpus only: retain pre-delete observations solely for the deliberately
 // unsafe archive control. Never re-read deleted content through production interfaces.
 const events=must(await f.store.readEvents(f.authority)),row=e=>({id:e.id,revision:JSON.stringify(e),text:JSON.stringify(e)}),archive=[...new Map([...initial,...beforeRetcon].map(e=>[e.id,row(e)])).values()],valid=events.map(row)
 const facts=['name','boundary','care'].map(id=>{const e=initial.find(e=>e.payload.kind==='state_change'&&e.payload.after.fieldId===id),r=row(e);return {id,expected:e.payload.after.value,evidence:[{id:r.id,revision:r.revision,quote:e.payload.after.value}]}})
 const evaluate=rows=>{const claims=facts.flatMap(fact=>{const citation=fact.evidence.find(e=>rows.some(r=>r.id===e.id&&r.revision===e.revision&&r.text.includes(e.quote)));return citation?[{id:fact.id,value:fact.expected,citation}]:[]});return {...scoreLifeEvidence(facts,claims,rows),revokedEvidenceExposed:rows.some(r=>r.id===cause)}}
 comparison={label:'annotated evidence availability, not generated answers',sameInput:true,arms:{verifiedMemory:evaluate(valid),recentWindow:evaluate(valid.slice(-8)),unfilteredArchive:evaluate(archive)}}
 assert.equal(comparison.arms.verifiedMemory.supported,3);assert.equal(comparison.arms.verifiedMemory.revokedEvidenceExposed,false);assert.equal(comparison.arms.unfilteredArchive.revokedEvidenceExposed,true)
}finally{await cold?.close();await f.close()}
const report={schemaVersion:1,kind:'person-life-offline',created:new Date().toISOString(),node:process.version,scenarioCount:observations.length,historyDistractors:120,observations,comparison,durationMs:performance.now()-started,maxRssKiB:process.resourceUsage().maxRSS,paidCalls:0,modelQuality:'unverified',limits:['Single synthetic story, no statistical or production latency claims','No real model or multi-day run','Archive control retains synthetic benchmark observations only; not a production recovery path']}
await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
