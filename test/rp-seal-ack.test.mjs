import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { build, stop } from 'esbuild'
const base = path.resolve('work/agent-memory-2026-10-22/seal-ack'); await fs.mkdir(base, { recursive: true })
const runtime = path.join(base, 'runtime.mjs')
await build({ stdin: { contents: "export {openRpStore} from './src/rp/store.ts'; export {openRpGlobalStore} from './src/rp/global.ts'; export {createCanonicalService} from './src/rp/canonical.ts'; export {createSummaryService} from './src/rp/summarizer.ts'; export {createJobService} from './src/rp/jobs.ts'; export {MemoryCoordinator} from './src/rp/session-policy.ts'", resolveDir: process.cwd(), loader: 'ts' }, outfile: runtime, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' }); stop()
const api = await import(pathToFileURL(runtime)), must = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value }
const visibility = { policyId: 'policy', revision: 0, audienceSetId: 'public' }
async function services(profileRoot, fault) {
  const opened = await api.openRpStore({ profileRoot, fault }), coordinator = new api.MemoryCoordinator(), global = await api.openRpGlobalStore(profileRoot, coordinator)
  const canonical = api.createCanonicalService(opened.store, opened.control, { entityIds: ['key'] }), summaries = api.createSummaryService({ store: opened.store, global, coordinator, entityIds: ['key'] }), jobs = api.createJobService({ store: opened.store, summaries, coordinator, profileKey: profileRoot })
  return { ...opened, canonical, summaries, jobs }
}
for (const mode of ['canonical', 'copy', 'adopt', 'reject', 'enqueue']) test('durable retry repairs two seal failures and cold-reopens: ' + mode, async () => {
  const directory = path.join(base, randomUUID()), profileRoot = path.join(directory, 'profile'), project = path.join(directory, 'project'); await fs.mkdir(project, { recursive: true })
  let remaining = 0, workspacePath
  const fault = async stage => {
    if (stage !== 'seal_written' || !remaining) return
    const last = (await fs.readdir(path.join(workspacePath, 'commits'))).filter(n => /^\d{16}\.json$/.test(n)).sort().at(-1)
    const tx = JSON.parse(await fs.readFile(path.join(workspacePath, 'commits', last), 'utf8')).transaction
    const target = mode === 'copy' ? 'copy' : mode === 'enqueue' ? 'job' : 'commit'
    if (tx.operation.kind === target) { remaining--; throw new Error('SEAL_ACK_EIO') }
  }
  const f = await services(profileRoot, fault), workspace = must(await f.control.createWorkspace(project)), branch = must(await f.control.createBranch(workspace.workspaceId, 'campaign'))
  workspacePath = path.join(profileRoot, '.dsh-rp/v1/workspaces', workspace.workspaceId)
  const request = { workspaceId: workspace.workspaceId, campaignId: 'campaign', branchId: branch.id, sessionId: 'session', sceneId: 'scene', viewpoint: { kind: 'narrator' }, visibility, audienceSetIds: ['public'], permissions: ['read', 'observe', 'commit', 'control'] }, a = must(await f.control.authorize(request))
  const source = must(await f.store.observeSource(a, { idempotencyKey: 'source', origin: 'host_public', role: 'assistant', publicText: 'experience', turnId: 'turn', host: { sessionId: 'session', eventSeq: 1, messageId: 'message', messageRevision: 'revision' } }))
  const ctl = must(await f.store.observeSource(a, { idempotencyKey: 'ctl', origin: 'user_control', role: 'user_control', publicText: 'confirmed', turnId: 'control' }))
  must(await f.canonical.applyControl(a, ctl, { kind: 'accept', sourceRevisionIds: [source.id], events: [], idempotencyKey: 'accept', expected: must(await f.store.readFence(a)) }))
  const selection = { level: 'scene', sourceRevisionIds: [source.id], dependencySummaryIds: [], supportEventIds: [] }
  const candidate = ['adopt', 'reject'].includes(mode) ? must(await f.summaries.propose(a, { schemaVersion: 1, proposedEvents: [], proposedSummary: { level: 'scene', text: 'experience', sourceRevisionIds: [source.id], exactAnchors: [] } }, selection)) : null
  const expected = must(await f.store.readFence(a))
  const act = (service, authority) => mode === 'canonical' ? service.canonical.applyControl(authority, ctl, { kind: 'accept', sourceRevisionIds: [source.id], events: [], idempotencyKey: 'again', expected })
    : mode === 'copy' ? service.store.savePayloadCopy(authority, { idempotencyKey: 'copy', id: 'copy', kind: 'cache', sourceRevisionIds: [source.id], dependencyIds: [], body: 'experience' })
    : mode === 'adopt' ? service.summaries.adopt(authority, ctl, candidate.id, { idempotencyKey: 'adopt' })
    : mode === 'reject' ? service.summaries.reject(authority, ctl, candidate.id, 'reject') : service.jobs.enqueue(authority, selection, { idempotencyKey: 'enqueue' })
  remaining = 2
  const first = await act(f, a); assert.equal(first.code, 'persistence_uncertain', JSON.stringify(first))
  const commits = (await fs.readdir(path.join(workspacePath, 'commits'))).filter(n => /^\d{16}\.json$/.test(n)).sort()
  const second = await act(f, a); assert.equal(second.code, 'persistence_uncertain', 'retry must not acknowledge an unsealed effect: ' + JSON.stringify(second))
  const cold = await services(profileRoot, fault), ca = must(await cold.control.authorize(request)); must(await act(cold, ca))
  assert.deepEqual((await fs.readdir(path.join(workspacePath, 'commits'))).filter(n => /^\d{16}\.json$/.test(n)).sort(), commits)
  await fs.access(path.join(workspacePath, 'seals', commits.at(-1)))
  await f.jobs.close(); await cold.jobs.close()
})
