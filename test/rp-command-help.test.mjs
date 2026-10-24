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
  for(const topic of ['person','injection','recovery','memory','modules','storage'])assert.match(ok(await f.command(a,'help '+topic)),/\/rp /)
  assert.match((await f.command(a,'help unknown')).text,/invalid_record/)
  ok(await f.command(a,'start'));const rename=fs.rename
  try{fs.rename=async(from,to)=>{if(to.includes(path.join('v1','host')))throw Object.assign(new Error('HELP_TEST_EIO'),{code:'EIO'});return rename(from,to)};assert.equal((await f.command(a,'input 保存失败')).kind,'error')}finally{fs.rename=rename}
  assert.equal(f.rp.status(a.id).blocked,true);assert.match(ok(await f.command(a,'help recovery')),/ambiguous/);assert.equal(f.rp.status(a.id).blocked,true);assert.equal(f.calls(),0)
 }finally{await f.dispose()}
})

for(const input of ['constraints set {','modules run {'])test('malformed runtime JSON is non-mutating invalid_record: '+input,async()=>{
 const f=await host();try{const a=await f.create();ok(await f.command(a,'start'));const before=f.rp.status(a.id).purpose
  assert.match((await f.command(a,input)).text,/invalid_record/);assert.equal(f.rp.status(a.id).blocked,false);assert.deepEqual(f.rp.status(a.id).purpose,before)
  ok(await f.command(a,'input 参数纠正后继续'));await a.whenIdle();await f.rp.ready(a.id);assert.equal(f.calls(),1)
 }finally{await f.dispose()}
})
