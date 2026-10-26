import test from 'node:test'
import assert from 'node:assert/strict'
import {setup,must,deny,api} from './fixtures/rp/growth.mjs'
async function source(f,key,body,role='user',accepted=true){
 const s=must(await f.store.observeSource(f.authority,{idempotencyKey:key,origin:'host_public',role,publicText:body,turnId:'turn_'+key,host:{sessionId:f.request.sessionId,eventSeq:1,messageId:'msg_'+key,messageRevision:'rev_'+key}}))
 if(accepted){const ctl=must(await f.store.observeSource(f.authority,{idempotencyKey:'ctl_'+key,origin:'user_control',role:'user_control',publicText:'确认',turnId:'ctl_'+key}));must(await f.canonical.applyControl(f.authority,ctl,{kind:'accept',sourceRevisionIds:[s.id],events:[],idempotencyKey:'accept_'+key,expected:await f.fence()}))}return s
}

test('on-demand extractive candidates reuse the same authenticated selection and never adopt themselves',async()=>{
 const f=await setup();try{
 const s=await source(f,'one','我说的是：下周五一起去看星星。😀'),before=await f.fence()
 assert.ok(f.organizer,'organizer capability is required')
 const a=must(await f.organizer.summarize(f.authority,{sourceRevisionIds:[s.id]})),b=must(await f.organizer.summarize(f.authority,{sourceRevisionIds:[s.id]}))
 assert.equal(a.id,b.id);assert.deepEqual(await f.fence(),before);assert.equal(must(await f.store.readSummaries(f.authority)).length,0)
 const c=must(await f.summaries.get(f.authority,a.id));assert.match(c.proposedSummary.text,/下周五/);assert.equal(c.proposedSummary.exactAnchors[0].sourceRevisionId,s.id);assert.equal(c.proposedEvents.length,0)
 const untrusted=await source(f,'untrusted','未确认的模型故事','assistant',false)
 deny(await f.organizer.summarize(f.authority,{sourceRevisionIds:[untrusted.id]}),'source_unavailable')
 }finally{await f.close()}
})

test('review only suggests duplicates and age checks; handoff quotes remain verbatim and bounded',async()=>{
 const f=await setup();try{
 const s=await source(f,'one','这是我的原话，不是另一个人的经历。'),t=await source(f,'two','这是我的原话，不是另一个人的经历。')
 await source(f,'untrusted','未经确认不能交接','assistant',false);const before=await f.fence();assert.ok(f.organizer)
 const review=must(await f.organizer.review(f.authority,{asOf:'2100-01-01T00:00:00.000Z'}));assert.deepEqual(review.duplicates[0].sourceRevisionIds.sort(),[s.id,t.id].sort());assert.ok(review.ageReview.some(x=>x.sourceRevisionId===s.id));assert.deepEqual(await f.fence(),before)
 const h=must(await f.organizer.handoff(f.authority,{}));assert.equal(h.userQuotes.length,2);assert.equal(h.userQuotes[0].text,'这是我的原话，不是另一个人的经历。');assert.equal(h.userQuotes[0].span.quoteSha256,s.publicTextSha256);assert.ok(!JSON.stringify(h).includes('未经确认不能交接'))
 }finally{await f.close()}
})

test('retrieval alternatives find an alias/paraphrase across history with fixed pagination and exact evidence',async()=>{
 const f=await setup();try{
 const s=await source(f,'old','林澈在钟楼把蓝色钥匙交给了贝雅。'),t=await source(f,'new','林澈后来约定陪贝雅观星。')
 const empty=must(await f.retrieval.search(f.authority,{query:'阿澈 看星星',kind:'source'}));assert.equal(empty.items.length,0)
 const alternativeOnly=must(await f.retrieval.search(f.authority,{queryAlternatives:['观星'],kind:'source'}));assert.deepEqual(alternativeOnly.items.map(x=>x.id),[t.id],'an omitted base query must not turn an alternatives search into match-all')
 const page=must(await f.retrieval.search(f.authority,{query:'阿澈 看星星',queryAlternatives:['林澈 观星','林澈 钥匙'],kind:'source',limit:1}));assert.equal(page.items.length,1);assert.ok(page.nextCursor)
 const first=page.items[0];assert.ok([s.id,t.id].includes(first.id));await source(f,'later','林澈 观星的新资料')
 const next=must(await f.retrieval.search(f.authority,{cursor:page.nextCursor}));assert.equal(next.items.length,1);assert.notEqual(next.items[0].id,first.id);assert.equal(next.nextCursor,null)
 }finally{await f.close()}
})

test('document revision suggests old classification and conditions only for unique matches',()=>{
 assert.equal(typeof api.reconcileDocumentRevision,'function')
 const input=text=>({documentId:'doc',personId:'erin',title:'人物',format:'markdown',text})
 const old=api.importPersonDocument(input('# 语气\n温柔。\n# 边界\n保留边界。\n')),next=api.importPersonDocument(input('# 新章\n新内容。\n# 语气\n温柔，也直接。\n# 边界\n保留边界。\n'))
 const policies=[{sectionId:old.sections[0].sectionId,category:'persona',label:'语气',tags:['例子'],enabled:false,when:{kind:'direct'}}]
 const r=api.reconcileDocumentRevision(old,next,policies);assert.equal(r.matches.length,2);const voice=r.matches.find(x=>x.nextSectionId===next.sections[1].sectionId);assert.equal(voice.reason,'unique-title');assert.equal(voice.suggestedPolicy.enabled,false);assert.equal(voice.suggestedPolicy.when.kind,'direct');assert.equal(r.requiresConfirmation,true)
 const dup=api.importPersonDocument(input('# 语气\n一。\n# 语气\n二。\n'));assert.equal(api.reconcileDocumentRevision(old,dup,policies).matches.length,0)
 assert.equal(next.sections[1].sectionId===old.sections[0].sectionId,false,'revision keeps new original identities')
})

test('handoff preserves commitment ownership and relationship direction, and drops corrected experiences',async()=>{
 const f=await setup();try{
 const met=await f.experience('meeting','林澈答应和贝雅周五看星星')
 const goal=must(await f.apply('promise',{kind:'goal',ownerId:'erin',goalId:'stars',category:'promise',targetEntityId:'bea',objective:'周五一起观星',status:'active',progress:0,nextAction:'确认天气',previousEventId:null,causeEventIds:[met],note:'共同约定'}))
 must(await f.apply('trust',{kind:'relationship',fromId:'bea',toId:'erin',relation:'trust',value:'谨慎信任',previousEventId:null,causeEventIds:[met],note:'约定之后'}))
 const h=must(await f.organizer.handoff(f.authority,{}));assert.equal(h.openCommitments[0].subjectId,'erin');assert.equal(h.openCommitments[0].value.targetEntityId,'bea');assert.equal(h.relationships[0].fromId,'bea');assert.equal(h.relationships[0].toId,'erin')
 const branch=must(await f.control.createBranch(f.request.workspaceId,'campaign')),other=must(await f.control.authorize({...f.request,branchId:branch.id}));assert.equal(must(await f.organizer.handoff(other,{})).confirmedExperiences.length,0)
 must(await f.canonical.applyControl(f.authority,await f.controlSource('retcon'),{kind:'retcon',targetEventIds:[met],events:[],idempotencyKey:'retcon',expected:await f.fence()}))
 const after=must(await f.organizer.handoff(f.authority,{}));assert.equal(after.confirmedExperiences.length,0);assert.equal(after.openCommitments.length,0);assert.equal(after.relationships.length,0);assert.ok(goal.eventId)
 }finally{await f.close()}
})
