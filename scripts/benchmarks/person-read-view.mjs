/** Serial, real persisted fixture. No model calls. Baseline is actual Git source. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { execFileSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { build, stop } from 'esbuild'
import assert from 'node:assert/strict'
const baseline = 'fdd9209f26185e346a862d422005cecd4770117a'
const root = path.resolve('work/person-core-2026-10-23/benchmark')
const must = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value }
const hash = value => createHash('sha256').update(value).digest('hex')
const budget = { recentCompleteTurns: 8, targetTotalTokens: 48000, triggerTotalTokens: 72000, outputReserveTokens: 8192, toolReserveTokens: 2048, packetSoftTokens: 8000, contextWindow: 100000, inputLimit: 90000 }
if (process.argv[2] === 'worker') {
  const [runtime, descriptor] = process.argv.slice(3), f = JSON.parse(await fs.readFile(descriptor, 'utf8'))
  const api = await import(pathToFileURL(runtime).href), memory = await api.openRpMemory({ profileRoot: f.profile, entityIds: ['erin'] })
  must(await memory.control.openWorkspace(f.project)); const authority = must(await memory.control.authorize(f.request))
  const readdir = fs.readdir, readFile = fs.readFile
  const counts = { loads: 0, metadataReads: 0, blobReads: 0, bytesRead: 0, metadataReadMs: 0, blobReadMs: 0, chainLoadMs: 0 }
  let loadStart = 0
  fs.readdir = async (...args) => { if (String(args[0]).endsWith('commits')) { counts.loads++; loadStart = performance.now() } return readdir(...args) }
  fs.readFile = async (...args) => {
    const file = String(args[0]), start = performance.now(), data = await readFile(...args), ms = performance.now() - start
    counts.bytesRead += Buffer.byteLength(data)
    if (file.endsWith('.blob')) { counts.blobReads++; counts.blobReadMs += ms } else { counts.metadataReads++; counts.metadataReadMs += ms }
    if (file.endsWith(path.join('seals', String(f.transactions).padStart(16, '0') + '.json'))) counts.chainLoadMs += performance.now() - loadStart
    return data
  }
  const start = performance.now(), packet = must(await memory.packets.prepare(authority, { budget, globalAuthorities: [], inputBindings: [] })), elapsedMs = performance.now() - start
  fs.readdir = readdir; fs.readFile = readFile
  memory.retrieval.dispose(); await memory.jobs.close()
  process.stdout.write(JSON.stringify({ stages: f.stages, elapsedMs, ...counts, peakRssKiB: process.resourceUsage().maxRSS, packetHash: hash(JSON.stringify(packet)), textHash: hash(packet.text) }))
} else {
  await fs.mkdir(root, { recursive: true })
  // Unique fixture directory: reruns never overwrite previous evidence.
  const run = path.join(root, new Date().toISOString().replace(/[:.]/g, '-')); await fs.mkdir(run)
  const archive = path.join(run, 'baseline.tar'), oldRoot = path.join(run, 'baseline'); await fs.mkdir(oldRoot)
  execFileSync('git', ['archive', '--format=tar', '--output='+archive, baseline, 'src'])
  execFileSync('tar', ['-xf', archive, '-C', oldRoot])
  const runtimes = {}
  for (const [name, entry] of [['before', path.join(oldRoot, 'src/rp/memory.ts')], ['after', path.resolve('src/rp/memory.ts')]]) {
    runtimes[name] = path.join(run, name+'.mjs')
    await build({ entryPoints: [entry], outfile: runtimes[name], bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
  }
  stop()
  const api = await import(pathToFileURL(runtimes.before).href), project = path.join(run, 'project'), profile = path.join(run, 'profile'); await fs.mkdir(project)
  const memory = await api.openRpMemory({ profileRoot: profile, entityIds: ['erin'] }), workspace = must(await memory.control.createWorkspace(project)), branch = must(await memory.control.createBranch(workspace.workspaceId, 'campaign'))
  const request = { workspaceId: workspace.workspaceId, campaignId: 'campaign', branchId: branch.id, sessionId: 'session_benchmark', sceneId: 'scene', viewpoint: { kind: 'narrator' }, visibility: { policyId: 'policy_story', revision: 0, audienceSetId: 'public' }, audienceSetIds: ['public'], permissions: ['read', 'observe', 'commit', 'control'] }, authority = must(await memory.control.authorize(request))
  const source = async i => must(await memory.store.observeSource(authority, { idempotencyKey: 'ctl_'+i, origin: 'user_control', role: 'user_control', publicText: 'User-defined stage '+i, turnId: 'turn_'+i }))
  const origin = await source('origin')
  must(await memory.canonical.applyControl(authority, origin, { kind: 'accept', idempotencyKey: 'origin', expected: must(await memory.store.readFence(authority)), sourceRevisionIds: [origin.id], events: [{ id: 'origin', epistemic: 'world', payload: { kind: 'occurrence', actorIds: ['erin'], description: 'Beginning of the journey' } }] }))
  const results = [], fixtureStart = performance.now(); let previous = 0
  for (const stages of [100, 260]) {
    const setupStart = performance.now(), stageSources = [], events = []
    for (let i = previous + 1; i <= stages; i++) {
      const s = await source(i); stageSources.push(s)
      events.push({ id: 'stage_'+i, epistemic: 'world', sourceRevisionIds: [origin.id, s.id], growthProtocol: 'agent-memory/v1', payload: { kind: 'state_change', subjectId: 'erin', key: 'identity', after: { protocol: 'agent-memory/v1', channel: 'state', value: 'Stage '+i, previousEventId: i > 1 ? 'stage_'+(i-1) : null, causeEventIds: ['origin'], note: 'Explicitly confirmed development' } } })
    }
    must(await memory.canonical.applyControl(authority, stageSources.at(-1), { kind: 'accept', idempotencyKey: 'stages_'+stages, expected: must(await memory.store.readFence(authority)), sourceRevisionIds: [origin.id, ...stageSources.map(s => s.id)], events }))
    const setupMs = performance.now() - setupStart, ws = path.join(profile, '.dsh-rp/v1/workspaces', workspace.workspaceId), descriptor = path.join(run, 'fixture-'+stages+'.json')
    const files = []; let persistedBytes = 0
    for (const dir of ['commits', 'seals', 'blobs']) for (const file of (await fs.readdir(path.join(ws, dir))).sort()) { const bytes = await fs.readFile(path.join(ws, dir, file)); persistedBytes += bytes.length; files.push([dir+'/'+file, hash(bytes)]) }
    const transactions = (await fs.readdir(path.join(ws, 'commits'))).length
    await fs.writeFile(descriptor, JSON.stringify({ project, profile, request, stages, transactions }))
    const variants = {}
    for (const variant of ['before', 'after']) variants[variant] = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), 'worker', runtimes[variant], descriptor], { encoding: 'utf8' }))
    assert.equal(variants.before.packetHash, variants.after.packetHash, 'exact prepared packet must match baseline')
    results.push({ stages, setupMs, persistedBytes, fixtureHash: hash(JSON.stringify(files)), ...variants })
    await fs.writeFile(path.join(run, 'report.json'), JSON.stringify({ baseline, node: process.version, results, fixtureElapsedMs: performance.now() - fixtureStart, notes: 'One serial sample per variant/stage, warm OS cache, fresh worker process. chainLoadMs includes chain parsing/hash/schema verification plus metadata IO, excludes initial seals listing. Metadata/blob times are filesystem read await time, not exclusive CPU. maxRSS is process peak including module initialization. No model inference or p95 claim.' }, null, 2))
    console.log(JSON.stringify(results.at(-1))); previous = stages
  }
  memory.retrieval.dispose(); await memory.jobs.close()
  console.log('REPORT '+path.join(run, 'report.json'))
}
