import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {host as nativeHost} from './fixtures/rp/native-host.mjs'
const bundle=process.env.RP_PERSON_BUNDLE?await import(pathToFileURL(path.resolve(process.env.RP_PERSON_BUNDLE)).href):undefined
const host=()=>nativeHost({},bundle?{install:bundle.installRpPlugin}:{})
const ok=r=>{assert.equal(r.kind,'success',r.text);return r.text}

test('Chinese command help works before start and on blocked sessions without state writes or model calls',async()=>{
 const f=await host();try{const a=await f.create(),dir=path.join(f.profile,'.dsh-rp/v1/host'),before=await fs.readdir(dir)
  const help=ok(await f.command(a,'help'));assert.match(help,/Memory-Continuity/);assert.match(help,/人物/);assert.match(help,/injection/);assert.match(help,/storage/)
  assert.deepEqual(await fs.readdir(dir),before);assert.equal(a.session.deriveMessages().length,0)
  for(const topic of ['person','document','diary','budget','injection','recovery','memory','modules','storage'])assert.match(ok(await f.command(a,'help '+topic)),/\/memcont /)
  const document=ok(await f.command(a,'help document'));assert.match(help,/help document/);assert.match(document,/document preview/);assert.match(document,/document confirm/);assert.match(document,/document discard/);assert.match(document,/1 MiB/);assert.match(document,/10 分钟/)
  assert.match((await f.command(a,'help unknown')).text,/invalid_record/)
  ok(await f.command(a,'start'));const rename=fs.rename
  try{fs.rename=async(from,to)=>{if(to.includes(path.join('v1','host')))throw Object.assign(new Error('HELP_TEST_EIO'),{code:'EIO'});return rename(from,to)};assert.equal((await f.command(a,'input 保存失败')).kind,'error')}finally{fs.rename=rename}
  assert.equal(f.rp.status(a.id).blocked,true);assert.match(ok(await f.command(a,'help recovery')),/ambiguous/);assert.equal(f.rp.status(a.id).blocked,true);assert.equal(f.calls(),0)
 }finally{await f.dispose()}
})

test('memcont is discoverable and shares one live session with the legacy rp alias; disposal removes both',async()=>{
 const f=await host();try{const a=await f.create(),run=async text=>(await f.ctx.commands.execute(a,text,[],new AbortController().signal)).result
  assert.ok(f.ctx.commands.list(a).some(c=>c.name==='memcont'));assert.ok(!f.ctx.commands.list(a).some(c=>c.name==='mc'))
  const help=ok(await run('/memcont help'));assert.match(help,/\/memcont start/);assert.equal(ok(await run('/rp help')),help);assert.equal(f.calls(),0)
  ok(await run('/memcont start'));const first=JSON.parse(ok(await run('/memcont status')));ok(await run('/rp start'));assert.equal(JSON.parse(ok(await run('/rp status'))).branchId,first.branchId)
  ok(await run('/memcont input 新指令发送一次'));await a.whenIdle();await f.rp.ready(a.id);assert.equal(f.calls(),1)
  for(const id of f.rp.status(a.id).candidateIds)ok(await run('/rp accept '+id))
  ok(await run('/rp input 旧指令仍兼容'));await a.whenIdle();await f.rp.ready(a.id);assert.equal(f.calls(),2)
  await f.rp.close();assert.ok(f.ctx.commands.list(a).every(c=>!['memcont','rp'].includes(c.name)))
 }finally{await f.dispose()}
})

for(const input of ['constraints set {','modules run {'])test('malformed runtime JSON is non-mutating invalid_record: '+input,async()=>{
 const f=await host();try{const a=await f.create();ok(await f.command(a,'start'));const before=f.rp.status(a.id).purpose
  assert.match((await f.command(a,input)).text,/invalid_record/);assert.equal(f.rp.status(a.id).blocked,false);assert.deepEqual(f.rp.status(a.id).purpose,before)
  ok(await f.command(a,'input 参数纠正后继续'));await a.whenIdle();await f.rp.ready(a.id);assert.equal(f.calls(),1)
 }finally{await f.dispose()}
})
