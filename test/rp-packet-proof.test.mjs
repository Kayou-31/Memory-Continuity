import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {LlmAdapter} from '@deepseek-ai/dsh-llm'
import {host} from './fixtures/rp/native-host.mjs'
const must=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value}
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
const sha = value => createHash('sha256').update(value).digest('hex')
test('obsolete source-only summary in native history must not reach terminal',{timeout:20000},async()=>{
  const f=await host(),requests=[]
  class Terminal extends LlmAdapter{async *stream(options){requests.push(options);yield {type:'text-delta',index:0,text:'Offline narrative.'};yield {type:'finish',reason:{kind:'stop'}}}}
  try{
    f.ctx.llm.registerAdapter(['packet-review'],new Terminal())
    const agent=await f.create();agent.options.provider='packet-review';await f.command(agent,'start')
    const j=JSON.parse(await fs.readFile(path.join(f.profile,'.dsh-rp/v1/host',createHash('sha256').update(agent.id).digest('hex')+'.json'),'utf8'))
    const m=f.rp.memory,a=must(await m.control.authorize(j.data.request)),ctl=async key=>must(await m.store.observeSource(a,{idempotencyKey:key,origin:'user_control',role:'user_control',publicText:key,turnId:key}))
    const s=must(await m.store.observeSource(a,{idempotencyKey:'original',origin:'host_public',role:'assistant',publicText:'The key was blue.',turnId:'old_turn',host:{sessionId:agent.id,eventSeq:1,messageId:'original',messageRevision:'original_revision'}}))
    const apply=async(key,op,control)=>must(await m.canonical.applyControl(a,control??await ctl(key),{...op,idempotencyKey:key,expected:must(await m.store.readFence(a))}))
    await apply('accept_original',{kind:'accept',sourceRevisionIds:[s.id],events:[]})
    const sentinel='OBSOLETE_SUMMARY_REVIEW_ONLY'
    const candidate=must(await m.summaries.propose(a,{schemaVersion:1,proposedEvents:[],proposedSummary:{level:'scene',text:sentinel+' The key is blue.',sourceRevisionIds:[s.id],exactAnchors:[]}},{level:'scene',sourceRevisionIds:[s.id],dependencySummaryIds:[],supportEventIds:[]}))
    must(await m.summaries.adopt(a,await ctl('adopt_summary'),candidate.id,{idempotencyKey:'adopt_summary'}))
    await f.command(agent,'input First turn');await agent.whenIdle();await f.rp.ready(agent.id)
    assert.equal(requests.length,1)
    const reply=f.rp.status(agent.id).candidateIds.at(-1);assert.equal((await f.command(agent,'accept '+reply)).kind,'success')
    const control=await ctl('new_event')
    await apply('new_event',{kind:'accept',sourceRevisionIds:[s.id,control.id],events:[{id:'event_late',payload:{kind:'state_change',subjectId:'key',key:'color',after:'blue'},epistemic:'world'}]},control)
    await apply('retcon',{kind:'retcon',targetEventIds:['event_late'],events:[{id:'event_gold',payload:{kind:'state_change',subjectId:'key',key:'color',after:'gold'},epistemic:'world'}]})
    assert.equal(must(await m.store.readSummaries(a)).length,0)
    const second=await f.command(agent,'input Second turn');await agent.whenIdle();await f.rp.ready(agent.id).catch(()=>{})
    const sentObsolete=requests.slice(1).some(r=>JSON.stringify(r.messages).includes(sentinel))
    console.log('OBSERVATION '+JSON.stringify({second,calls:requests.length,sentObsolete,activeSummaries:must(await m.store.readSummaries(a)).length,latestHistory:requests.at(-1)?.messages.filter(m=>m.source?.kind==='runtime-context').map(m=>({id:m.id,obsolete:JSON.stringify(m).includes(sentinel)}))}))
    assert.equal(sentObsolete,false,'historical packet must verify actual summary dependencies')
  }finally{await f.dispose()}
})

test('v2 packets without original derived proof remain recovery-only without backfilling', async () => {
  const f = await host()
  try {
    const agent = await f.create(); await f.command(agent, 'start')
    await f.command(agent, 'input old packet'); await agent.whenIdle(); await f.rp.ready(agent.id)
    const target = path.join(f.profile, '.dsh-rp/v1/host', sha(agent.id) + '.json')
    await f.drop(agent)
    const j = JSON.parse(await fs.readFile(target, 'utf8'))
    assert.ok(Object.keys(j.data.snapshots).length)
    for (const s of [...Object.values(j.data.snapshots), ...Object.values(j.data.pending), ...Object.values(j.data.frames)]) delete s.packetProof
    j.sha256 = sha(canonical(j.data)); const original = canonical(j); await fs.writeFile(target, original)
    const resumed = await f.resume(agent)
    await assert.rejects(f.rp.ready(resumed.id))
    assert.equal(f.rp.status(resumed.id).lastError, 'legacy_packet_recovery_only')
    assert.equal(await fs.readFile(target, 'utf8'), original)
    assert.equal((await f.command(resumed, 'continue-clean')).kind, 'success')
  } finally { await f.dispose() }
})

test('malformed packet proof cannot supply a trusted branch during recovery', async () => {
  const f = await host()
  try {
    const agent = await f.create(); await f.command(agent, 'start')
    await f.command(agent, 'input proof'); await agent.whenIdle(); await f.rp.ready(agent.id)
    const target = path.join(f.profile, '.dsh-rp/v1/host', sha(agent.id) + '.json')
    await f.drop(agent)
    const j = JSON.parse(await fs.readFile(target, 'utf8')), proof = Object.values(j.data.snapshots)[0].packetProof
    assert.ok(proof); proof.projectionSha256 = 'invalid-hash'
    j.sha256 = sha(canonical(j.data)); await fs.writeFile(target, canonical(j))
    const resumed = await f.resume(agent)
    assert.equal(f.rp.status(agent.id).branchId, undefined)
    assert.equal((await f.command(resumed, 'continue-clean')).kind, 'error')
    assert.equal((await f.command(resumed, 'continue-clean ' + j.data.request.branchId)).kind, 'success')
  } finally { await f.dispose() }
})
