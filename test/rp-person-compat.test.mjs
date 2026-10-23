import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { build, stop } from 'esbuild'
import { setup, must, deny, api } from './fixtures/rp/growth.mjs'
const dir = path.resolve('work/person-core-2026-10-23/compat', randomUUID()); await fs.mkdir(dir, { recursive: true })
execFileSync('git', ['archive', '--format=tar', '--output='+path.join(dir, 'baseline.tar'), 'fdd9209f26185e346a862d422005cecd4770117a', 'src'])
execFileSync('tar', ['-xf', path.join(dir, 'baseline.tar'), '-C', dir])
await build({ entryPoints: [path.join(dir, 'src/rp/memory.ts')], outfile: path.join(dir, 'old.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' }); stop()
const old = await import(pathToFileURL(path.join(dir, 'old.mjs')).href)
const draft = { schemaVersion: 1, kind: 'person-draft', personId: 'erin', fields: [{ fieldId: 'name', kind: 'identity', value: '林澈', policy: 'stable' }], relationships: [], goals: [] }
const hash = v => createHash('sha256').update(v).digest('hex')

test('actual v1 global reader/writer rejects segmented scope and verified complete backup restores it',async()=>{
 const f=await setup();let reader
 try{
  const profile=path.join(f.directory,'profile'),root=path.join(profile,'.dsh-rp/v1'),identity=JSON.parse(await fs.readFile(path.join(root,'identity.json'),'utf8')),scope={kind:'world',profileId:identity.profileId,worldId:'storage'},spec={scope,visibility:{policyId:'policy',revision:0,audienceSetId:'public'},audienceSetIds:['public'],write:true},a=must(await f.global.control.authorize(spec)),approval=f.global.control.approval({commandId:'upgrade',sessionId:'upgrade'}),input={idempotencyKey:'first',expected:must(await f.global.store.readFence(a)),key:'lore',body:'Original history',privateSourceIds:[]},p=must(await f.global.control.publish(a,approval,input))
  reader=await old.openRpMemory({profileRoot:profile,entityIds:[]});const oa=must(await reader.global.control.authorize(spec)),op=reader.global.control.approval({commandId:'old',sessionId:'old'});must(await reader.global.store.readFence(oa))
  must(await f.global.control.enableSegments(a,approval,{idempotencyKey:'segments',expected:must(await f.global.store.readFence(a))}));deny(await reader.global.store.readFence(oa),'store_corrupt');deny(await reader.global.control.publish(oa,op,input),'store_corrupt')
  const status=must(await f.global.store.storageStatus(a)),backup=path.join(root,'backups/global',status.backupId),manifest=JSON.parse(await fs.readFile(path.join(backup,'manifest.json'),'utf8'));for(const file of manifest.files)assert.equal(hash(await fs.readFile(path.join(backup,file.path))),file.sha256)
  const scopeDir=path.join(root,'global',hash(api.canonical(scope)));await fs.rename(scopeDir,path.join(f.directory,'segmented-quarantine'));await fs.mkdir(scopeDir)
  for(const name of ['commits','blobs','seal.json'])await fs.cp(path.join(backup,name),path.join(scopeDir,name),{recursive:true,errorOnExist:true,force:false})
  assert.equal(must(await reader.global.store.readPublication(oa,p.id)).body,'Original history')
 }finally{reader?.retrieval.dispose();await reader?.jobs.close();await f.close()}
})

test('raw fixed-prefix commit checks inherited person ownership before added events', async () => {
  const f=await setup()
  try {
    const p=must(await f.person.preview(f.authority,draft,'parent')); must(await f.person.confirm(f.authority,p.handle,await f.controlSource('parent')))
    const parent=must(await f.store.readLedger(f.authority)), child=must(await f.control.createBranch(f.request.workspaceId,'campaign')), authority=must(await f.control.authorize({...f.request,branchId:child.id})), expected=must(await f.store.readFence(authority))
    const bindings=parent.sourceBindings.filter(b=>b.disposition==='accepted').map(b=>({...b,branchId:child.id})), original=must(await f.store.readEvents(f.authority)).find(e=>e.payload.kind==='state_change')
    const raw={...original,id:'inherited_overwrite',scope:authority.scope,payload:{kind:'state_change',subjectId:'erin',key:'identity',after:'bypass'}}
    deny(await f.store.commit(authority,{schemaVersion:1,idempotencyKey:'parent_mix',expected,nextContextRevision:1,sourceBindings:bindings,events:[raw],summaries:[],jobs:[],invalidatedIds:[],authorityChanges:[{kind:'branch_parent',recordId:'fixed_parent',record:{branchId:f.request.branchId,contextRevision:parent.fence.contextRevision,prefixManifestHash:parent.fence.sourceManifestHash,sourceBindings:bindings}}]}),'scope_denied')
    assert.deepEqual(must(await f.store.readFence(authority)),expected)
  } finally {await f.close()}
})

test('actual previous reader rejects all branches after person capability; complete backup restores old readability', async () => {
  const f = await setup(); let reader
  try {
    await f.experience('before', 'Original retained history')
    const sibling = must(await f.control.createBranch(f.request.workspaceId, 'campaign'))
    reader = await old.openRpMemory({ profileRoot: path.join(f.directory, 'profile'), entityIds: ['erin','bea','key'] })
    must(await reader.control.openWorkspace(path.join(f.directory, 'project')))
    const oldGrant = must(await reader.control.authorize(f.request))
    assert.equal(must(await reader.store.readEvents(oldGrant)).length, 1)
    const p = must(await f.person.preview(f.authority, draft, 'upgrade'))
    must(await f.person.confirm(f.authority, p.handle, await f.controlSource('upgrade')))
    deny(await reader.store.readFence(oldGrant), 'store_corrupt')
    deny(await reader.control.authorize({ ...f.request, branchId: sibling.id }), 'store_corrupt')
    const base = path.join(f.directory, 'profile/.dsh-rp/v1'), backupRoot = path.join(base, 'backups', f.request.workspaceId), [backupName] = await fs.readdir(backupRoot), backup = path.join(backupRoot, backupName)
    const manifest = JSON.parse(await fs.readFile(path.join(backup, 'manifest.json'), 'utf8'))
    for (const file of manifest.files) assert.equal(hash(await fs.readFile(path.join(backup, file.path))), file.sha256)
    const workspace = path.join(base, 'workspaces', f.request.workspaceId)
    // Test-owned profile only; retain upgraded contents in quarantine.
    await fs.rename(workspace, path.join(f.directory, 'upgraded-quarantine'))
    await fs.cp(path.join(backup, 'workspace'), workspace, { recursive: true, errorOnExist: true, force: false })
    assert.equal(must(await reader.store.readEvents(oldGrant)).length, 1)
    assert.equal(must(await f.store.readEvents(f.authority)).length, 1)
    deny(await f.person.read(f.authority, 'erin'), 'source_unavailable')
  } finally { reader?.retrieval.dispose(); await reader?.jobs.close(); await f.close() }
})

test('backup IO failure prevents person publication and same operation can safely retry', async () => {
  const f = await setup(), mkdir = fs.mkdir
  try {
    const p = must(await f.person.preview(f.authority, draft, 'backup_fail')), ctl = await f.controlSource('backup_fail'), before = await f.fence()
    fs.mkdir = async (...args) => { if (String(args[0]).includes(path.sep+'backups'+path.sep)) throw Object.assign(new Error('injected backup disk failure'), { code: 'EIO' }); return mkdir(...args) }
    const failed = await f.person.confirm(f.authority, p.handle, ctl); fs.mkdir = mkdir
    deny(failed, 'persistence_failed'); assert.deepEqual(await f.fence(), before)
    assert.equal(must(await f.store.readEvents(f.authority)).length, 0)
    must(await f.person.confirm(f.authority, p.handle, ctl))
    assert.equal(must(await f.person.read(f.authority, 'erin')).fields[0].value, '林澈')
  } finally { fs.mkdir = mkdir; await f.close() }
})

test('unknown and regressed reader capabilities are refused on cold load', async () => {
  for (const caps of [['rp.future/v99'], []]) {
    const f = await setup()
    try {
      const p = must(await f.person.preview(f.authority, draft, 'caps'))
      must(await f.person.confirm(f.authority, p.handle, await f.controlSource('caps')))
      await f.controlSource('append_after_upgrade')
      const ws = path.join(f.directory, 'profile/.dsh-rp/v1/workspaces', f.request.workspaceId), files = (await fs.readdir(path.join(ws,'commits'))).sort(), file = files.at(-1)
      const env = JSON.parse(await fs.readFile(path.join(ws,'commits',file), 'utf8'))
      assert.deepEqual(env.transaction.requiredCapabilities, ['rp.person-core/v1'])
      env.transaction.requiredCapabilities = caps; env.sha256 = hash(api.canonical(env.transaction))
      await fs.writeFile(path.join(ws,'commits',file), JSON.stringify(env))
      await fs.writeFile(path.join(ws,'seals',file), JSON.stringify({ schemaVersion:1, sequence:env.transaction.sequence, transactionHash:env.sha256 }))
      deny(await f.store.readFence(f.authority), caps.length ? 'capability_missing' : 'store_corrupt')
    } finally { await f.close() }
  }
})

test('raw store cannot bypass person ownership; old JSON remains ordinary and duplicate previews commit once', async () => {
  const f = await setup()
  try {
    const p = must(await f.person.preview(f.authority, draft, 'person'))
    const ctl = await f.controlSource('person')
    const [a,b] = await Promise.all([f.person.confirm(f.authority,p.handle,ctl), f.person.confirm(f.authority,p.handle,ctl)])
    assert.deepEqual(must(a), must(b))
    const event = must(await f.store.readEvents(f.authority)).find(e => e.payload.kind === 'state_change'), expected = await f.fence()
    const raw = { ...event, id:'unmarked_raw', payload:{ kind:'state_change', subjectId:'erin', key:'identity', after:'bypass' } }
    deny(await f.store.commit(f.authority, { schemaVersion:1, idempotencyKey:'raw', expected, nextContextRevision:expected.contextRevision+1, sourceBindings:[], events:[raw], summaries:[], jobs:[], invalidatedIds:[], authorityChanges:[] }), 'scope_denied')
    const s = await f.controlSource('ordinary'), value = { protocol:'person-core/v1', value:'ordinary JSON' }
    must(await f.canonical.applyControl(f.authority,s,{kind:'accept',idempotencyKey:'ordinary',expected:await f.fence(),sourceRevisionIds:[s.id],events:[{id:'ordinary',epistemic:'world',payload:{kind:'state_change',subjectId:'bea',key:'identity',after:value}}]}))
    assert.deepEqual(must(await f.store.replayProjection(f.authority)).state.find(s=>s.subjectId==='bea').value, value)
  } finally { await f.close() }
})
