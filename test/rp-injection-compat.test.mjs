import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {build,stop} from 'esbuild'
import {pathToFileURL} from 'node:url'
import {host} from './fixtures/rp/native-host.mjs'
const dir=path.resolve('work/person-m5-2026-10-24/old-reader',randomUUID());await fs.mkdir(dir,{recursive:true})
execFileSync('git',['archive','--format=tar','--output='+path.join(dir,'baseline.tar'),'ee6b5a1898f128a0baf953ea192ba80795ac674d','src'])
execFileSync('tar',['-xf',path.join(dir,'baseline.tar'),'-C',dir])
await build({entryPoints:[path.join(dir,'src/rp/host-journal.ts')],outfile:path.join(dir,'old.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});stop()
const old=await import(pathToFileURL(path.join(dir,'old.mjs')))
const sha=s=>createHash('sha256').update(s).digest('hex'),ok=r=>{assert.equal(r.kind,'success',r.text);return r.text}
test('previous published journal reader rejects M5 while the exact pre-enable backup remains readable',async()=>{
 const f=await host({entityIds:['erin']});try{const a=await f.create();ok(await f.command(a,'start'));const p=JSON.parse(ok(await f.command(a,'person preview '+JSON.stringify({schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]}))));ok(await f.command(a,'person confirm '+p.previewId));ok(await f.command(a,'person use erin'))
 const file=path.join(f.profile,'.dsh-rp/v1/host',sha(a.id)+'.json'),before=await fs.readFile(file);old.validateJournal(JSON.parse(before).data)
 ok(await f.command(a,'injection set {}'));const after=JSON.parse(await fs.readFile(file,'utf8'));assert.throws(()=>old.validateJournal(after.data));assert.deepEqual(await fs.readFile(file+'.pre-m5-backup'),before);old.validateJournal(JSON.parse(await fs.readFile(file+'.pre-m5-backup','utf8')).data)
 }finally{await f.dispose()}
})
