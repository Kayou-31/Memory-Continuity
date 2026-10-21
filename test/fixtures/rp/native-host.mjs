import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build, stop } from 'esbuild'
import test from 'node:test'
import assert from 'node:assert/strict'
const sdkRoot = path.resolve(process.env.RP_NATIVE_SDK ?? 'node_modules')
const req = createRequire(path.join(sdkRoot, 'rp-dev3.cjs'))
const base = path.resolve('work/dev3-native'); await fs.mkdir(base, { recursive: true })
const networkLog = path.join(base, 'network-' + process.pid + '.jsonl'); process.env.ULTRA_ACCEPTANCE_NETWORK_LOG = networkLog
req(path.resolve('scripts/host-acceptance/network-guard.cjs'))
test.after(async () => { assert.equal(await fs.readFile(networkLog, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e }), '', 'native acceptance must remain offline') })
const runtime = path.join(base, 'runtime.mjs')
await build({ stdin: { contents: "export {installRpPlugin} from './src/rp/rp-plugin.ts'; export {retrievalEvidence, verifyRetrievalEvidence} from './src/rp/retrieval-evidence.ts'", resolveDir: process.cwd(), loader: 'ts' }, outfile: runtime, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', define: { 'import.meta.url': JSON.stringify(pathToFileURL(path.join(sdkRoot, 'rp-dev3-runtime.mjs')).href) }, plugins: [{ name: 'exact-sdk', setup(b) { b.onResolve({ filter: /^@deepseek-ai\// }, a => ({ path: pathToFileURL(req.resolve(a.path)).href, external: true })) } }] }); stop()
const { installRpPlugin, retrievalEvidence, verifyRetrievalEvidence } = await import(pathToFileURL(runtime).href + '?' + randomUUID())
const sdk = {}
for (const name of ['cordis', 'cordis-plugin-loader', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-agent-loop', 'dsh-session-persistence-jsonl', 'dsh-commands']) sdk[name] = await import(pathToFileURL(req.resolve('@deepseek-ai/' + name)).href)
export function latch() { let enter, release; const entered = new Promise(r => enter = r), released = new Promise(r => release = r); return { entered, release, async wait() { enter(); await released } } }
export async function host(config = {}, hooks = {}) {
  const directory = hooks.directory ?? path.join(base, randomUUID()), profile = path.join(directory, 'profile'), project = path.join(directory, 'project'); await fs.mkdir(project, { recursive: true })
  const ctx = new sdk.cordis.Context(); ctx.baseUrl = pathToFileURL(profile + path.sep).href
  for (const [name, value] of [['cordis-plugin-loader'], ['dsh-llm'], ['dsh-session'], ['dsh-session-projection'], ['dsh-system-prompt', { includeHarnessIdentity: false, includeRuntimeContext: true }], ['dsh-tools', { mode: 'native' }], ['dsh-agent'], ['dsh-agent-loop', { agents: [] }], ['dsh-session-persistence-jsonl', { root: path.join(profile, 'sessions'), compression: 'none' }], ['dsh-commands']]) await ctx.plugin(sdk[name].default ?? sdk[name], value).await()
  let calls = 0, streamGate
  class Terminal extends sdk['dsh-llm'].LlmAdapter { async *stream() { calls++; if (streamGate) await streamGate.wait(); yield { type: 'text-delta', text: 'offline' }; yield { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } } } }
  ctx.llm.registerAdapter(['rp-dev3'], new Terminal())
  const budget = { recentCompleteTurns: 8, targetTotalTokens: 48000, triggerTotalTokens: 72000, outputReserveTokens: 8192, toolReserveTokens: 2048, packetSoftTokens: 8000, contextWindow: 100000, inputLimit: 90000 }
  const settings = { enabled: true, profileRoot: profile, workspaceRoot: project, campaignId: 'dev3', knownCooperatingWriters: true, entityIds: ['key'], budget, ...config }
  const install = hooks.install ?? installRpPlugin
  await hooks.before?.({ ctx, sdk, profile, project })
  const rp = await install(ctx, settings), handles = []
  await hooks.after?.({ ctx, sdk, profile, project, rp })
  const create = async () => { const h = await ctx.agents.create({ sessionId: 'session_' + randomUUID().replaceAll('-', ''), meta: { cwd: project }, agentOptions: { provider: 'rp-dev3', model: 'offline', maxTokens: 128 } }); handles.push(h); return h.agent }
  const command = async (agent, input) => (await ctx.commands.execute(agent, '/rp ' + input, [], new AbortController().signal)).result
  const stream = async (agent, options = {}) => { for await (const _ of ctx.llm.stream({ provider: 'rp-dev3', model: 'offline', messages: [], sessionId: agent.id, ...options })) {} }
  const resume = async agent => { const h = await ctx.agents.resume({ resumeSessionId: agent.id, agentOptions: { ...agent.options } }); handles.push(h); return h.agent }
  const drop = async agent => { await ctx.sessions.flush(agent.session); await handles.find(h => h.agent === agent).dispose(); await rp.policy.coordinator.mutate(async () => {}) }
  return { ctx, rp, profile, project, settings, create, resume, drop, command, stream, installRpPlugin: install, retrievalEvidence, verifyRetrievalEvidence, createToolResultMessage: sdk['dsh-llm'].createToolResultMessage, calls: () => calls, gate: g => streamGate = g, async dispose() { await rp.close().catch(() => {}); for (const h of handles) await h.dispose(); await ctx.fiber.dispose() } }
}
