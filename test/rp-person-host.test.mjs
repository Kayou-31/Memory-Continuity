import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { host as nativeHost } from './fixtures/rp/native-host.mjs'
const bundle = process.env.RP_PERSON_BUNDLE ? await import(pathToFileURL(path.resolve(process.env.RP_PERSON_BUNDLE)).href) : undefined
const host = (config, hooks = {}) => nativeHost(config, {...hooks,...(bundle ? { install: bundle.installRpPlugin } : {})})
const draft = personId => ({ schemaVersion:1, kind:'person-draft', personId, fields:[{fieldId:'name',kind:'identity',value:personId === 'erin' ? '林澈' : '阿岚',policy:'stable'}],relationships:[],goals:[] })
const success = r => { assert.equal(r.kind,'success',r.text); return r }
const sha = s => createHash('sha256').update(s).digest('hex')
const canonical = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '['+v.map(canonical).join(',')+']' : '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}'
async function create(f,a,id) { const p = JSON.parse(success(await f.command(a,'person preview '+JSON.stringify(draft(id)))).text); success(await f.command(a,'person confirm '+p.previewId)); return p }
test('native person preview, confirmation and binding reach actual offline terminal; clean root retains one primary person', async () => {
  const f = await host({entityIds:['erin','bea']}), requests=[]
  class Terminal extends LlmAdapter { async *stream(options) { requests.push(options); yield {type:'text-delta',index:0,text:'Offline reply'}; yield {type:'finish',reason:{kind:'stop'}} } }
  try {
    f.ctx.llm.registerAdapter(['person-test'],new Terminal())
    const a=await f.create(); a.options.provider='person-test'; success(await f.command(a,'start'))
    await create(f,a,'erin'); await create(f,a,'bea'); success(await f.command(a,'person use erin'))
    assert.equal(JSON.parse(success(await f.command(a,'person show erin')).text).fields[0].value,'林澈')
    success(await f.command(a,'input 你好')); await a.whenIdle(); await f.rp.ready(a.id)
    assert.equal(requests.length,1); assert.match(JSON.stringify(requests[0]), /primaryPerson/); assert.match(JSON.stringify(requests[0]), /erin/)
    assert.equal((await f.command(a,'person use bea')).kind,'error')
    const clean=success(await f.command(a,'continue-clean')), next=f.ctx.agents.get(/created: (\w+)/.exec(clean.text)[1])
    assert.equal(next.session.deriveMessages().length,0); assert.equal(f.rp.status(next.id).personId,'erin')
    success(await f.command(next,'person use bea'))
    success(await f.command(next,'input 新的开始')); await next.whenIdle(); await f.rp.ready(next.id)
    assert.equal(requests.length,2); assert.equal(f.rp.status(next.id).personId,'bea')
  } finally { await f.dispose() }
})
test('native journal resumes original person proof; removed proof is recovery-only with no backfill', async () => {
  const f = await host({entityIds:['erin']})
  try {
    const a=await f.create(); success(await f.command(a,'start')); await create(f,a,'erin'); success(await f.command(a,'person use erin'))
    success(await f.command(a,'input Start')); await a.whenIdle(); await f.rp.ready(a.id); await f.drop(a)
    const resumed=await f.resume(a); assert.equal(f.rp.status(resumed.id).personId,'erin'); assert.equal(f.rp.status(resumed.id).blocked,false); await f.drop(resumed)
    const file=path.join(f.profile,'.dsh-rp/v1/host',sha(a.id)+'.json'), env=JSON.parse(await fs.readFile(file,'utf8'))
    delete env.data.personBinding
    for (const s of [...Object.values(env.data.snapshots),...Object.values(env.data.pending),...Object.values(env.data.frames)]) delete s.personBinding
    env.sha256=sha(canonical(env.data)); await fs.writeFile(file,JSON.stringify(env))
    const damaged=await f.resume(resumed); assert.equal(f.rp.status(damaged.id).blocked,true)
    assert.equal((await f.command(damaged,'input must not send')).kind,'error'); assert.equal(f.calls(),1)
    const clean=success(await f.command(damaged,'continue-clean')), next=f.ctx.agents.get(/created: (\w+)/.exec(clean.text)[1])
    assert.equal(next.session.deriveMessages().length,0); success(await f.command(next,'person use erin'))
  } finally { await f.dispose() }
})
test('person binding survives actual SDK read-tool loop and cold resume', async () => {
  const f=await host({entityIds:['erin']}); let calls=0, cold, disposed=false
  class Terminal extends LlmAdapter { async *stream() {
    if (++calls===1) { yield {type:'tool-call-delta',index:0,id:'person_search',name:'rp_memory_search',argumentsDelta:'{"query":"林澈"}'}; yield {type:'finish',reason:{kind:'tool-calls'}} }
    else { yield {type:'text-delta',index:0,text:'Read complete'}; yield {type:'finish',reason:{kind:'stop'}} }
  } }
  try {
    f.ctx.llm.registerAdapter(['person-tools'],new Terminal())
    const a=await f.create(); a.options.provider='person-tools'; success(await f.command(a,'start')); await create(f,a,'erin'); success(await f.command(a,'person use erin'))
    success(await f.command(a,'input Who am I?')); await a.whenIdle(); await f.rp.ready(a.id)
    assert.equal(calls,2); assert.equal(f.rp.status(a.id).blocked,false)
    for (const id of f.rp.status(a.id).candidateIds) success(await f.command(a,'accept '+id))
    await f.drop(a); await f.dispose(); disposed=true
    cold=await host({entityIds:['erin']},{directory:path.dirname(f.profile)}); cold.ctx.llm.registerAdapter(['person-tools'],new Terminal())
    const resumed=await cold.resume(a); assert.equal(cold.rp.status(resumed.id).blocked,false)
    success(await cold.command(resumed,'input Continue')); await resumed.whenIdle(); await cold.rp.ready(resumed.id); assert.equal(calls,3,JSON.stringify(cold.rp.status(resumed.id)))
  } finally { if(!disposed)await f.dispose(); await cold?.dispose() }
})
