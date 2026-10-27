import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {build,stop} from 'esbuild'
import {setup,must,deny} from './fixtures/rp/growth.mjs'
const dir=path.resolve('work/iteration-2026-10-27/person-injection-compat',randomUUID());await fs.mkdir(dir,{recursive:true})
execFileSync('git',['archive','--format=tar','--output='+path.join(dir,'baseline.tar'),'63d29ff148abb186e56970f8dcb9f4d09901fe90','src']);execFileSync('tar',['-xf','baseline.tar'],{cwd:dir})
await build({entryPoints:[path.join(dir,'src/rp/memory.ts')],outfile:path.join(dir,'old.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});stop()
const old=await import(pathToFileURL(path.join(dir,'old.mjs')).href),sha=b=>createHash('sha256').update(b).digest('hex')
test('v0.3 reader refuses explicit core capability; verified pre-upgrade workspace remains recoverable',async()=>{
 const f=await setup();let reader
 try{
  const p=must(await f.person.preview(f.authority,{schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'},{fieldId:'trait',kind:'trait',value:'保持好奇',policy:'growable'}],relationships:[],goals:[]},'create'));must(await f.person.confirm(f.authority,p.handle,await f.controlSource('create')))
  reader=await old.openRpMemory({profileRoot:path.join(f.directory,'profile'),entityIds:['erin','bea','key']});const a=must(await reader.control.authorize(f.request));must(await reader.person.read(a,'erin'))
  const ctl=await f.controlSource('core'),trait=must(await f.person.read(f.authority,'erin')).fields.find(f=>f.fieldId==='trait')
  must(await f.person.apply(f.authority,ctl,{operation:'set-injection',personId:'erin',fieldId:'trait',previousEventId:trait.eventId,injection:'core',note:'常驻',expected:await f.fence(),idempotencyKey:'core'}));deny(await reader.store.readFence(a),'capability_missing')
  const root=path.join(f.directory,'profile/.dsh-rp/v1'),backups=path.join(root,'backups',f.request.workspaceId);let before
  for(const name of await fs.readdir(backups)){const backup=path.join(backups,name),manifest=JSON.parse(await fs.readFile(path.join(backup,'manifest.json'),'utf8'));for(const file of manifest.files)assert.equal(sha(await fs.readFile(path.join(backup,file.path))),file.sha256);if(manifest.requiredCapabilities.includes('rp.person-core/v1')&&!manifest.requiredCapabilities.includes('rp.person-injection/v1'))before=backup}
  assert.ok(before,'full backup was created before the new reader barrier')
  const workspace=path.join(root,'workspaces',f.request.workspaceId);await fs.rename(workspace,path.join(f.directory,'core-upgrade-quarantine'));await fs.cp(path.join(before,'workspace'),workspace,{recursive:true,errorOnExist:true,force:false})
  assert.equal(must(await reader.person.read(a,'erin')).fields.find(f=>f.fieldId==='trait').injection,undefined)
 }finally{reader?.retrieval.dispose();await reader?.jobs.close();await f.close()}
})
