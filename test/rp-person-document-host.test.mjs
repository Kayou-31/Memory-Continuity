import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {host} from './fixtures/rp/native-host.mjs'
// Fixtures each own an esbuild service lifecycle; load them serially.
const {api,must}=await import('./fixtures/rp/growth.mjs')
const ok=r=>{assert.equal(r.kind,'success',r.text);return r.text},value=r=>JSON.parse(ok(r))
test('actual DSH SDK carries authenticated document spans, refuses superseded history, and continues cleanly',async()=>{
 const f=await host({entityIds:['erin']});let disposed=false,cold
 try{
  const a=await f.create();ok(await f.command(a,'start'))
  const p=value(await f.command(a,'person preview '+JSON.stringify({schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]})))
  ok(await f.command(a,'person confirm '+p.previewId));ok(await f.command(a,'person use erin'));ok(await f.command(a,'injection set {}'))
  const file=path.join(f.profile,'.dsh-rp/v1/host',createHash('sha256').update(a.id).digest('hex')+'.json'),env=JSON.parse(await fs.readFile(file,'utf8')),memory=f.rp.memory,authority=must(await memory.control.authorize(env.data.request))
  async function save(text,key,previousEventId){
   const draft=api.importPersonDocument({documentId:'voice',personId:'erin',title:'语气',format:'text',text}),policies=[{sectionId:draft.sections[0].sectionId,category:'persona',label:'语气样例',tags:[],enabled:true,when:{kind:'all'}}]
   const p=must(await memory.documents.preview(authority,{draft,policies,...(previousEventId?{previousEventId}:{})},key)),ctl=must(await memory.store.observeSource(authority,{idempotencyKey:key,origin:'user_control',role:'user_control',turnId:'turn_'+key,publicText:'明确确认 '+key}))
   return must(await memory.documents.confirm(authority,p.handle,ctl))
  }
  const first=await save('FIRST_VOICE 温和表达','first')
  ok(await f.command(a,'input 你好'));await a.whenIdle();await f.rp.ready(a.id)
  assert.equal(f.calls(),1,JSON.stringify(f.rp.status(a.id)))
  const journal=JSON.parse(await fs.readFile(file,'utf8'));assert.ok(Object.values(journal.data.snapshots).some(s=>s.injection?.entries.some(e=>e.kind==='document'&&e.selected&&e.sourceSpan)))
  await save('SECOND_VOICE 新的表达','second',first.eventId)
  const preview=value(await f.command(a,'injection preview 你好'));assert.ok(preview.history.some(h=>h.status==='blocked'),'superseded document history must be rejected')
  ok(await f.command(a,'input 不得带上旧资料'));await a.whenIdle();await f.rp.ready(a.id).catch(()=>{});assert.equal(f.calls(),1)
  const clean=ok(await f.command(a,'continue-clean')),next=f.ctx.agents.get(/created: (\w+)/.exec(clean)[1])
  const fresh=value(await f.command(next,'injection preview 你好'));assert.match(fresh.current.text,/SECOND_VOICE/);assert.doesNotMatch(fresh.current.text,/FIRST_VOICE/)
  ok(await f.command(next,'input 你好'));await next.whenIdle();await f.rp.ready(next.id);assert.equal(f.calls(),2)
  await f.ctx.sessions.flush(next.session);await f.dispose();disposed=true
  cold=await host({entityIds:['erin']},{directory:path.dirname(f.profile)});const resumed=await cold.resume(next)
  // Closing an active plugin intentionally retires its owner; do not weaken that contract.
  assert.equal(cold.rp.status(resumed.id).blocked,true)
  const again=ok(await cold.command(resumed,'continue-clean')),freshAgent=cold.ctx.agents.get(/created: (\w+)/.exec(again)[1])
  assert.match(value(await cold.command(freshAgent,'injection preview 你好')).current.text,/SECOND_VOICE/)
  ok(await cold.command(freshAgent,'input 冷启动后继续'));await freshAgent.whenIdle();await cold.rp.ready(freshAgent.id);assert.equal(cold.calls(),1)
 }finally{if(!disposed)await f.dispose();await cold?.dispose()}
})
