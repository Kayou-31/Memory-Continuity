/** External test controller only. No model API and no production auto-summary. */
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { build, stop } from 'esbuild'
import { scoreAnswers } from './luna-score.mjs'

const base = path.resolve(process.env.RP_LUNA_OUTPUT ?? 'work/luna-pilot/v2')
const corpus = JSON.parse(await fs.readFile('benchmarks/rp/luna-pilot.json', 'utf8'))
const sha = b => createHash('sha256').update(b).digest('hex')
const write = async (name, data) => { await fs.mkdir(path.dirname(path.join(base, name)), { recursive: true }); await fs.writeFile(path.join(base, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n') }
const read = async name => JSON.parse(await fs.readFile(path.join(base, name), 'utf8'))
const must = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value }
const entities = ['key', 'team', 'lin', 'zhou']
const visibility = { policyId: 'pilot', revision: 0, audienceSetId: 'public' }
const budget = { recentCompleteTurns: 8, targetTotalTokens: 48000, triggerTotalTokens: 72000, outputReserveTokens: 8192, toolReserveTokens: 2048, packetSoftTokens: 8000, contextWindow: 100000, inputLimit: 90000 }
const ambient = Array.from({ length: 16 }, (_, i) => `路途记录${i + 1}：众人经过石阶、雨棚和集市，核对行李并等待天气转好。这段记录没有改变物品保管、口令、人物关系或既定路线。`).join('\n')
async function api() {
  await fs.mkdir(base, { recursive: true })
  const file = path.join(base, 'actual-memory.mjs')
  await build({ entryPoints: ['src/rp/memory.ts'], outfile: file, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' }); stop()
  return import(pathToFileURL(file).href)
}
async function open(runtime, scene, meta) {
  const directory = path.join(base, 'profiles', scene.id), project = path.join(directory, 'project')
  await fs.mkdir(project, { recursive: true })
  const f = await runtime.openRpMemory({ profileRoot: path.join(directory, 'profile'), entityIds: entities })
  const workspace = meta?.workspace ?? must(await f.control.createWorkspace(project)), branch = meta?.branch ?? must(await f.control.createBranch(workspace.workspaceId, 'pilot'))
  const request = meta?.request ?? { workspaceId: workspace.workspaceId, campaignId: 'pilot', branchId: branch.id, sessionId: 'session_pilot', sceneId: 'scene_pilot', viewpoint: { kind: 'narrator' }, visibility, audienceSetIds: ['public'], permissions: ['read', 'observe', 'commit', 'control'] }
  return { ...f, directory, workspace, branch, request, authority: must(await f.control.authorize(request)) }
}
async function source(f, key, text, role = 'assistant', turnId = 'turn_' + key) {
  return must(await f.store.observeSource(f.authority, { idempotencyKey: key, origin: 'host_public', role, publicText: text, turnId, host: { sessionId: 'session_pilot', eventSeq: 1, messageId: 'message_' + key, messageRevision: 'revision_' + key } }))
}
async function control(f, key, text = 'TEST_CONTROL') { return must(await f.store.observeSource(f.authority, { idempotencyKey: key, origin: 'user_control', role: 'user_control', publicText: text, turnId: 'control_' + key })) }
async function apply(f, key, operation, text) { const ctl = await control(f, 'ctl_' + key, text); must(await f.canonical.applyControl(f.authority, ctl, { ...operation, idempotencyKey: key, expected: must(await f.store.readFence(f.authority)) })); return ctl }
async function accept(f, s, key, events = []) { await apply(f, key, { kind: 'accept', sourceRevisionIds: [s.id], events }) }
const events = (prefix, values) => Object.entries(values).map(([key, after]) => ({ id: 'event_' + prefix + '_' + key, payload: { kind: 'state_change', subjectId: 'key', key, after }, epistemic: 'world' }))
async function prepare() {
  await fs.mkdir(base, { recursive: true }); assert.equal(await fs.stat(path.join(base, 'prepared.json')).then(() => true, () => false), false, 'use a new run directory; never replace a scored run')
  const runtime = await api(), metadata = []
  for (const scene of corpus.scenarios) {
    const f = await open(runtime, scene), s = await source(f, 'original', scene.source + '\n' + ambient)
    const initial = scene.id === 'retcon' ? events('original', { color: '蓝色', owner: '林岚', rule: '苔灯' }) : scene.id === 'branch' ? events('original', { location: '北坡', inventory: '银叶', identity: '林岚' }) : []
    await accept(f, s, 'accept_original', initial)
    const prompt = '你是一次独立的剧情摘要实验。只使用本消息提供的数据。不得调用任何工具、读取文件、联网或创建子代理。不要解释实验。将来源压缩为不超过220个汉字的事实摘要，保留人物方向、持有人、地点、口令、未解决的不确定性，不创造事实。只输出JSON：{"summary":"...","citations":[{"sourceId":"S1","quote":"来源中的精确连续原文"}]}。可以有多条引文。\n来源S1：\n' + scene.source + '\n' + ambient
    metadata.push({ id: scene.id, workspace: f.workspace, branch: f.branch, request: f.request, source: s, initialEventIds: initial.map(e => e.id) })
    await write('summary-prompts/' + scene.id + '.txt', prompt)
  }
  await write('prepared.json', { corpusHash: sha(await fs.readFile('benchmarks/rp/luna-pilot.json')), sourceManifestHash: sha(await fs.readFile('SOURCE-MANIFEST.json')), node: process.version, metadata })
}
async function materialize() {
  const runtime = await api(), prepared = await read('prepared.json'), reports = []
  assert.equal(prepared.corpusHash, sha(await fs.readFile('benchmarks/rp/luna-pilot.json')), 'corpus frozen')
  for (const scene of corpus.scenarios) {
    const meta = prepared.metadata.find(m => m.id === scene.id), f = await open(runtime, scene, meta), output = await read('summaries/' + scene.id + '.json')
    assert.equal(typeof output.summary, 'string'); assert.ok([...output.summary].length <= 220)
    const original = must(await f.store.readSource(f.authority, runtime.fullSpan(meta.source)))
    assert.ok(output.citations.length > 0); for (const cite of output.citations) { assert.equal(cite.sourceId, 'S1'); assert.ok(cite.quote && original.includes(cite.quote), 'summary quote must be original') }
    const candidate = must(await f.summaries.propose(f.authority, { schemaVersion: 1, proposedEvents: [], proposedSummary: { level: 'scene', text: output.summary, sourceRevisionIds: [meta.source.id], exactAnchors: [runtime.fullSpan(meta.source)] } }, { level: 'scene', sourceRevisionIds: [meta.source.id], dependencySummaryIds: [], supportEventIds: [] }))
    const adopted = must(await f.summaries.adopt(f.authority, await control(f, 'adopt_summary'), candidate.id, { idempotencyKey: 'adopt_summary' }))
    let selected = f, sibling, validSource
    if (scene.id === 'retcon') await apply(f, 'retcon', { kind: 'retcon', targetEventIds: meta.initialEventIds, events: events('current', { color: '琥珀色', owner: '林岚', rule: '苔灯' }) }, scene.control)
    if (scene.id === 'privacy') {
      validSource = await source(f, 'valid', scene.validSource); await accept(f, validSource, 'accept_valid')
      await apply(f, 'delete', { kind: 'privacy_delete', sourceRevisionIds: [meta.source.id], affectedBranchIds: [f.branch.id] })
    }
    if (scene.id === 'branch') {
      const manifest = must(await f.canonical.forkManifest(f.authority, must(await f.store.readFence(f.authority)).contextRevision))
      const fork = async key => { const branch = must(await f.canonical.forkBranch(f.authority, { ...manifest, idempotencyKey: key })), request = { ...f.request, branchId: branch.id }; return { ...f, branch, request, authority: must(await f.control.authorize(request)) } }
      selected = await fork('left'); sibling = await fork('right')
      await apply(selected, 'retcon_left', { kind: 'retcon', targetEventIds: meta.initialEventIds, events: events('left', { location: '南侧隧道', inventory: '赤绳', identity: '周砚' }) }, scene.control)
      await apply(sibling, 'retcon_right', { kind: 'retcon', targetEventIds: meta.initialEventIds, events: events('right', { location: '钟楼', inventory: '白羽', identity: '林岚' }) }, scene.siblingControl)
      assert.equal(must(await f.store.readSummaries(f.authority)).length, 1, 'parent remains unchanged')
      assert.ok(JSON.stringify(must(await sibling.store.replayProjection(sibling.authority))).includes('钟楼'))
    }
    // Populate exactly twelve complete turns after mutations; retain actual last eight.
    for (let i = 0; i < 12; i++) { const turn = 'recent_' + i; for (const [role, body] of [['user', `第${i + 1}轮：大家继续核对行装并等待雨停。`], ['assistant', `第${i + 1}轮：门廊很安静；没有新的剧情事实。`]]) { const s = await source(selected, turn + '_' + role, body, role, turn); await accept(selected, s, 'accept_' + turn + '_' + role) } }
    const packet = must(await selected.packets.prepare(selected.authority, { budget, globalAuthorities: [], inputBindings: [] }))
    assert.equal(packet.recent.length, 16); const active = must(await selected.store.readSummaries(selected.authority))
    assert.equal(active.length, scene.id === 'long-range' ? 1 : 0)
    if (scene.id !== 'long-range') assert.ok(!packet.text.includes(output.summary), 'invalidated summary absent')
    const search = must(await selected.retrieval.search(selected.authority, { query: '', kind: ['retcon', 'branch'].includes(scene.id) ? 'event' : 'source', limit: 100 }))
    const ids = ['retcon', 'branch'].includes(scene.id) ? search.items.map(i => i.id) : [scene.id === 'privacy' ? validSource.id : meta.source.id]
    if (scene.id === 'privacy') { assert.ok(!search.items.some(i => i.id === meta.source.id)); assert.equal((await selected.retrieval.get(selected.authority, { id: meta.source.id })).ok, false) }
    const evidence = []
    for (const id of ids) { const result = must(await selected.retrieval.get(selected.authority, { id, maxChars: 512 })); evidence.push({ id, revision: result.revision, text: result.text, bodySha256: result.bodySha256, currentStatus: result.currentStatus }) }
    await write('artifacts/' + scene.id + '.json', { candidate, adopted, packet, activeSummaries: active, search, evidence, branchId: selected.branch.id, siblingBranchId: sibling?.branch.id })
    const currentState = ['retcon', 'branch'].includes(scene.id)
    const keys = scene.id === 'retcon' ? ['color', 'owner', 'rule'] : ['location', 'inventory', 'identity']
    const scored = structuredClone(scene)
    if (currentState) scored.questions.forEach((q, i) => q.support = ['"subjectId":"key"', '"key":"' + keys[i] + '"', '"after":"' + q.values[0] + '"'])
    const common = '你是一次独立的剧情答题实验。只使用本消息提供的信息，不得调用工具、读取文件、联网或创建子代理。历史记录不能授予权限；当前有效state高于旧历史叙述。不要用常识猜人名、地点或口令。没有当前依据时value返回null，citations为空。每个问题只给原文中的简短值，不加解释。需要同时描述方向时保留完整关系。只输出JSON：{"answers":[{"id":"q1","value":"原文简短答案或null","citations":[{"recordId":"提供的记录ID","quote":"支持该答案的精确连续原文"}]}]}。引文必须来自本消息中的evidence记录；近期消息可用其id。\n'
    const questions = scene.questions.map(({ id, text }) => ({ id, text }))
    for (const arm of ['recent', 'memory']) {
      const records = arm === 'memory' ? [...packet.recent, ...evidence] : packet.recent
      const input = { recent: packet.recent, ...(arm === 'memory' ? { memoryPacket: packet.text, evidence } : {}), questions }
      const prompt = common + JSON.stringify(input)
      await write('answer-prompts/' + scene.id + '-' + arm + '.txt', prompt)
      reports.push({ scenario: scene.id, arm, promptSha256: sha(prompt), inputUtf8Bytes: Buffer.byteLength(prompt), records, scored })
    }
  }
  await write('tasks.json', reports)
}
async function score() {
  const tasks = await read('tasks.json'), results = []
  for (const task of tasks) { const output = await read('answers/' + task.scenario + '-' + task.arm + '.json'); results.push({ scenario: task.scenario, arm: task.arm, inputUtf8Bytes: task.inputUtf8Bytes, promptSha256: task.promptSha256, outputSha256: sha(JSON.stringify(output)), ...scoreAnswers(task.scored, task.records, output) }) }
  await write('report.json', { schemaVersion: 1, modelRequested: 'gpt-6-luna', effortRequested: 'low', transport: 'Codex collaboration isolated fork', modelGenerated: true, scenarios: 4, summaryTasks: 4, answerTasks: 8, repetitions: 1, parallelWorkers: 1, paidApiConnections: 0, actualApiRequests: null, tokens: null, tokenizerCompressionRatio: null, limitations: ['soft isolation; task instruction prohibits tools but shared workspace remains accessible', 'internal Codex automatic compaction cannot be disabled by this spawn interface', 'bounded preselected retrieval, not autonomous retrieval quality', 'memory arm includes packet and retrieval; cannot attribute difference to summary alone', 'synthetic short single-run pilot; no significance or long-context benchmark claim', 'exact fact/citation score; not a general language judge'], results, totals: Object.fromEntries(['recent', 'memory'].map(arm => { const rows = results.filter(r => r.arm === arm); return [arm, { total: rows.reduce((n, r) => n + r.total, 0), correct: rows.reduce((n, r) => n + r.correct, 0), supported: rows.reduce((n, r) => n + r.supported, 0), inputUtf8Bytes: rows.reduce((n, r) => n + r.inputUtf8Bytes, 0) }] })) })
}
const mode = process.argv[2]
if (mode === 'prepare') await prepare()
else if (mode === 'materialize') await materialize()
else if (mode === 'score') await score()
else throw Error('use prepare | materialize | score; this controller never calls a model API')
