import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { build, stop } from 'esbuild'
const base = path.resolve('work/rp-growth-tests'); await fs.mkdir(base, { recursive: true })
const runtime = path.join(base, 'runtime.mjs')
await build({ entryPoints: ['src/rp/memory.ts'], outfile: runtime, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' }); stop()
export const api = await import(pathToFileURL(runtime).href + '?' + randomUUID())
export const must = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value }
export const deny = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); if (code) assert.equal(r.code, code) }
export async function setup(directory = path.join(base, randomUUID()), request) {
  await fs.mkdir(path.join(directory, 'project'), { recursive: true })
  const memory = await api.openRpMemory({ profileRoot: path.join(directory, 'profile'), entityIds: ['erin', 'bea', 'key'] })
  const workspace = must(await (request ? memory.control.openWorkspace : memory.control.createWorkspace)(path.join(directory, 'project')))
  const branchId = request?.branchId ?? must(await memory.control.createBranch(workspace.workspaceId, 'campaign')).id
  request ??= { workspaceId: workspace.workspaceId, campaignId: 'campaign', branchId, sessionId: 'session_growth', sceneId: 'scene', viewpoint: { kind: 'narrator' }, visibility: { policyId: 'policy_story', revision: 0, audienceSetId: 'public' }, audienceSetIds: ['public'], permissions: ['read', 'observe', 'commit', 'control'] }
  const authority = must(await memory.control.authorize(request))
  const f = { ...memory, directory, request, authority, fence: async () => must(await memory.store.readFence(authority)), close: async () => { memory.retrieval.dispose(); await memory.jobs.close() } }
  f.controlSource = async key => must(await memory.store.observeSource(authority, { idempotencyKey: 'ctl_'+key, origin: 'user_control', publicText: 'Explicit human control '+key, role: 'user_control', turnId: 'turn_'+key }))
  f.apply = async (key, input) => memory.agentMemory.apply(authority, await f.controlSource(key), { ...input, idempotencyKey: key, expected: await f.fence() })
  f.experience = async (key, description) => must(await f.apply(key, { kind: 'experience', actorIds: ['erin', 'bea'], description, fictionalTime: key, sourceRevisionIds: [] })).eventId
  return f
}
