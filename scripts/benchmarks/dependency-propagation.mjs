// Shadow only: execute reference loops extracted from current store.ts. No writes
// to a memory workspace, no production replacement, no external dependencies.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {build,stop} from 'esbuild'
const out=path.resolve('work/iteration-review-2026-10-27');await fs.mkdir(out,{recursive:true})
const source=await fs.readFile('src/rp/store.ts','utf8'),start=source.indexOf('  #activeRecords(branch:'),end=source.indexOf('  async #append(',start),method=source.slice(start,end),body=method.slice(method.indexOf('{')+1,method.lastIndexOf('}')).replace('this.#deleted(branch)','branch.deleted')
assert.ok(start>0&&end>start)
const freezeStart=source.indexOf('        const affectedSources = new Set<string>()'),freezeEnd=source.indexOf("        await this.#authorize(authority, 'commit')",freezeStart),freeze=source.slice(freezeStart,freezeEnd);assert.ok(freezeStart>0&&freezeEnd>freezeStart)
const bundle=path.join(out,'dependency-reference.mjs');await build({stdin:{contents:`type InputFence=any;export function active(branch:any){${body}}\nexport function closure(current:any,activeBefore:any,invalidated:Set<string>){${freeze};return invalidated}`,loader:'ts'},outfile:bundle,bundle:true,platform:'node',format:'esm',logLevel:'silent'});stop()
const ref=await import(pathToFileURL(bundle).href),fence={policyVersion:'p',canonBindingsHash:'h',visibilityRevision:0}
function reverse(records){const index=new Map();let edges=0;for(const r of records.values())for(const dep of [...r.sourceRevisionIds,...r.dependencyIds]){const a=index.get(dep)??[];a.push(r.id);index.set(dep,a);edges++}return {index,edges}}
function activeQueue(b){const {index,edges}=reverse(b.records),blocked=new Set([...b.invalidated,...b.deleted]);let visits=0
 for(const s of b.bindings.values())if(s.disposition!=='accepted')blocked.add(s.sourceRevisionId)
 for(const r of b.records.values())if(!r.active||r.kind==='summary'&&(r.policyVersion!==b.fence.policyVersion||r.metadata.createdFrom.canonBindingsHash!==b.fence.canonBindingsHash||r.metadata.createdFrom.visibilityRevision!==b.fence.visibilityRevision)||r.sourceRevisionIds.some(id=>b.bindings.get(id)?.disposition!=='accepted')||r.dependencyIds.some(id=>!b.records.has(id)))blocked.add(r.id)
 const queue=[...blocked];for(let i=0;i<queue.length;i++)for(const id of index.get(queue[i])??[]){visits++;if(!blocked.has(id)){blocked.add(id);queue.push(id)}}return {ids:[...b.records.keys()].filter(id=>!blocked.has(id)),edges,visits}}
function closureQueue(records,active,seeds){const {index,edges}=reverse(records),summaries=new Map(),blocked=new Set(seeds);let visits=0,specialEdges=0
 for(const r of records.values())if(r.kind==='summary'&&active.get(r.id)?.active)for(const s of r.sourceRevisionIds){const a=summaries.get(s)??[];a.push(r.id);summaries.set(s,a);specialEdges++}
 const queue=[...blocked],add=id=>{visits++;if(!blocked.has(id)){blocked.add(id);queue.push(id)}}
 for(let i=0;i<queue.length;i++){const id=queue[i];for(const child of index.get(id)??[])add(child);const old=active.get(id);if(old?.active&&old.kind==='event')for(const s of old.sourceRevisionIds)for(const child of summaries.get(s)??[])add(child)}return {ids:[...blocked],edges,specialEdges,visits}}
const record=(id,deps=[],sources=['s'],kind='event')=>({id,kind,active:true,sourceRevisionIds:sources,dependencyIds:deps,policyVersion:'p',metadata:{createdFrom:fence}})
const branch=(rows,seeds=[])=>({records:new Map(rows.map(r=>[r.id,r])),bindings:new Map([['s',{sourceRevisionId:'s',disposition:'accepted'}]]),invalidated:new Set(seeds),deleted:[],fence})
const cases=[{name:'diamond',b:branch([record('a'),record('b',['a']),record('c',['a']),record('d',['b','c'])],['a'])},{name:'missing-dependency',b:branch([record('a',['missing'])])},{name:'cycle-no-seed-defensive',b:branch([record('a',['b']),record('b',['a'])])},{name:'cycle-seeded-defensive',b:branch([record('a',['b']),record('b',['a'])],['a'])},{name:'reaccepted-source-old-records-stay-invalid',b:branch([record('old'),record('old_summary',['old'],['s'],'summary'),record('new')],['old','old_summary'])}]
for(const n of [64,512,2048]){const chain=Array.from({length:n},(_,i)=>record('r'+i,i?['r'+(i-1)]:[]));cases.push({name:'chain-insertion-order-'+n,b:branch(chain,['r0'])});if(n<=512)cases.push({name:'reverse-chain-defensive-'+n,b:branch([...chain].reverse(),['r0'])})}
let seed=47;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32)
for(let c=0;c<64;c++){const rows=[];for(let i=0;i<64;i++)rows.push(record('r'+i,i?[...new Set(Array.from({length:3},()=> 'r'+Math.floor(random()*i)))]:[]));cases.push({name:'generated-'+c,b:branch(rows,['r'+Math.floor(random()*64),'r'+Math.floor(random()*64)])})}
const equal=(a,b)=>assert.deepEqual([...a].sort(),[...b].sort()),results=[]
for(const c of cases){const start=performance.now(),actual=ref.active(c.b),referenceMs=performance.now()-start,at=performance.now(),shadow=activeQueue(c.b),queueMs=performance.now()-at;equal([...actual.values()].filter(r=>r.active).map(r=>r.id),shadow.ids);results.push({name:c.name,records:c.b.records.size,referenceMs,queueMs,edges:shadow.edges,visits:shadow.visits})}
const closureCases=[branch([record('early_summary',[],['s'],'summary'),record('later_event'),record('independent_event')]),branch([record('a'),record('b',['a']),record('c',['b'],['s'],'summary')])]
for(let i=0;i<closureCases.length;i++){const b=closureCases[i],active=ref.active(b),seeds=[i?'a':'later_event'],actual=ref.closure(b,active,new Set(seeds)),shadow=closureQueue(b.records,active,seeds);equal(actual,shadow.ids);if(!i){assert.ok(actual.has('early_summary'));assert.ok(!actual.has('independent_event'));assert.ok(!actual.has('s'))}results.push({name:'commit-special-'+i,records:b.records.size,...shadow})}
const report={node:process.version,sourceSha256:createHash('sha256').update(source).digest('hex'),equivalentCases:results.length,results,decision:'Shadow only. Normal insertion-order reads do not establish a consistent end-to-end benefit; retain current production loops.',limits:'Synthetic graph microbenchmark; excludes disk replay, view authorization, managed copies and workspace privacy closure. Timings include queue construction, single samples, not a stable speed claim.',maxRssKiB:process.resourceUsage().maxRSS}
await fs.writeFile(path.join(out,'dependency-benchmark.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
