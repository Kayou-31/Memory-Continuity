import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
import {build,stop} from 'esbuild'
import {setup,must,deny,api} from './fixtures/rp/growth.mjs'
const dir=path.resolve('work/person-document-compat',randomUUID());await fs.mkdir(dir,{recursive:true})
// Published 0.2.1 source, not a mock that merely rejects the new marker.
execFileSync('git',['archive','--format=tar','--output='+path.join(dir,'baseline.tar'),'1d997516a3cb0621163a94a2bb16b1a7bd28243c','src'])
execFileSync('tar',['-xf','baseline.tar'],{cwd:dir})
await build({entryPoints:[path.join(dir,'src/rp/memory.ts')],outfile:path.join(dir,'old.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});stop()
const old=await import(pathToFileURL(path.join(dir,'old.mjs')).href),hash=v=>createHash('sha256').update(v).digest('hex')
test('actual 0.2.1 reader refuses the document capability; verified full backup restores readability',async()=>{
 const f=await setup();let reader
 try{
  const p=must(await f.person.preview(f.authority,{schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]},'person'))
  must(await f.person.confirm(f.authority,p.handle,await f.controlSource('person')))
  reader=await old.openRpMemory({profileRoot:path.join(f.directory,'profile'),entityIds:['erin','bea','key']})
  must(await reader.control.openWorkspace(path.join(f.directory,'project')))
  const grant=must(await reader.control.authorize(f.request));assert.equal(must(await reader.person.read(grant,'erin')).fields[0].value,'林澈')
  const dp=must(await f.documents.preview(f.authority,{draft:api.importPersonDocument({documentId:'life_notes',personId:'erin',title:'资料',format:'text',text:'完整资料'})},'document'))
  must(await f.documents.confirm(f.authority,dp.handle,await f.controlSource('document')))
  deny(await reader.store.readFence(grant),'capability_missing')
  const base=path.join(f.directory,'profile/.dsh-rp/v1'),backupRoot=path.join(base,'backups',f.request.workspaceId)
  let selected
  for(const name of await fs.readdir(backupRoot)){
   const backup=path.join(backupRoot,name),manifest=JSON.parse(await fs.readFile(path.join(backup,'manifest.json'),'utf8'))
   if(manifest.requiredCapabilities.includes('rp.person-core/v1'))selected={backup,manifest}
  }
  assert.ok(selected)
  for(const file of selected.manifest.files){const bytes=await fs.readFile(path.join(selected.backup,file.path));assert.equal(hash(bytes),file.sha256);assert.equal(bytes.length,file.bytes)}
  const workspace=path.join(base,'workspaces',f.request.workspaceId)
  // All paths belong to this generated fixture; retain the upgraded tree.
  assert.ok(path.resolve(workspace).startsWith(path.resolve(f.directory)+path.sep))
  await fs.rename(workspace,path.join(f.directory,'upgraded-quarantine'))
  await fs.cp(path.join(selected.backup,'workspace'),workspace,{recursive:true,errorOnExist:true,force:false})
  assert.equal(must(await reader.person.read(grant,'erin')).fields[0].value,'林澈')
  deny(await f.documents.read(f.authority,'erin','life_notes'),'source_unavailable')
 }finally{reader?.retrieval.dispose();await reader?.jobs.close();await f.close()}
})

test('actual 0.2.1 reader refuses a shared diary workspace and the pre-upgrade backup retains its readable person',async()=>{
 const f=await setup();let reader
 try{
  const p=must(await f.person.preview(f.authority,{schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]},'person'))
  must(await f.person.confirm(f.authority,p.handle,await f.controlSource('person')))
  reader=await old.openRpMemory({profileRoot:path.join(f.directory,'profile'),entityIds:['erin','bea','key']});must(await reader.control.openWorkspace(path.join(f.directory,'project')))
  const grant=must(await reader.control.authorize(f.request));must(await reader.person.read(grant,'erin'))
  must(await f.diary.configure(f.authority,await f.controlSource('diary'),{boardId:'shared',personId:'erin',humanId:'local_user',allowAgentWrite:true,audiences:[{kind:'local'}],expected:await f.fence(),idempotencyKey:'diary'}))
  deny(await reader.store.readFence(grant),'capability_missing')
  const base=path.join(f.directory,'profile/.dsh-rp/v1'),backupRoot=path.join(base,'backups',f.request.workspaceId);let selected
  for(const name of await fs.readdir(backupRoot)){const backup=path.join(backupRoot,name),manifest=JSON.parse(await fs.readFile(path.join(backup,'manifest.json'),'utf8'));if(manifest.requiredCapabilities.includes('rp.person-core/v1')&&!manifest.requiredCapabilities.includes('rp.shared-diary/v1'))selected={backup,manifest}}
  assert.ok(selected);for(const file of selected.manifest.files){const bytes=await fs.readFile(path.join(selected.backup,file.path));assert.equal(hash(bytes),file.sha256);assert.equal(bytes.length,file.bytes)}
  const workspace=path.join(base,'workspaces',f.request.workspaceId);assert.ok(path.resolve(workspace).startsWith(path.resolve(f.directory)+path.sep));await fs.rename(workspace,path.join(f.directory,'upgraded-diary-quarantine'))
  await fs.cp(path.join(selected.backup,'workspace'),workspace,{recursive:true,errorOnExist:true,force:false});assert.equal(must(await reader.person.read(grant,'erin')).fields[0].value,'林澈')
 }finally{reader?.retrieval.dispose();await reader?.jobs.close();await f.close()}
})
