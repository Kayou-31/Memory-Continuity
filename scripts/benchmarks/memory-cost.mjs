/** Local synthetic workload. No provider, network, real-user data or semantic score. */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'
import {api,setup,must} from '../../test/fixtures/rp/growth.mjs'

const output=path.resolve(process.argv[2]??'work/memory-cost/report.json')
const budget={recentCompleteTurns:8,targetTotalTokens:48000,triggerTotalTokens:72000,outputReserveTokens:8192,toolReserveTokens:2048,packetSoftTokens:8000,contextWindow:100000,inputLimit:90000}
const target={provider:'cost-offline',model:'deepseek-ai/DeepSeek-V3.2'}
const start=performance.now(),meter=await api.openMemoryMeter(api.createMemoryBudget(target),target),tokenizerLoadMs=performance.now()-start
const samples=5,checkpoints=[]
async function measure(run){
 const values=[]
 for(let i=0;i<samples;i++){const at=performance.now();await run();values.push(performance.now()-at)}
 const sorted=[...values].sort((a,b)=>a-b)
 return {samplesMs:values,p50Ms:sorted[2],maxMs:sorted.at(-1)}
}
async function inventory(dir){
 let bytes=0,files=0
 for(const entry of await fs.readdir(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name)
  if(entry.isDirectory()){const child=await inventory(file);bytes+=child.bytes;files+=child.files}
  else if(entry.isFile()){bytes+=(await fs.stat(file)).size;files++}
 }
 return {bytes,files}
}
let f=await setup(),count=0
try{
 for(const size of [8,32,128]){
  const at=performance.now()
  while(count<size){count++;await f.experience('day_'+count,'钟楼旅途第'+count+'天：一起记录天气，继续寻找归还钥匙的路线。')}
  const appendMs=performance.now()-at
  const search=await measure(async()=>{const r=must(await f.retrieval.search(f.authority,{query:'钟楼',limit:8}));assert.ok(r.items.length>0)})
  const input={budget,globalAuthorities:[],inputBindings:[],memoryMeter:meter}
  let packet
  const prepare=await measure(async()=>{packet=must(await f.packets.prepare(f.authority,input))})
  const request={...target,messages:[{role:'user',content:packet.text}],maxTokens:128}
  const admit=await measure(async()=>must(await f.packets.admit(f.authority,packet,request)))
  const directory=f.directory,authorityRequest=f.request
  await f.close()
  const coldAt=performance.now();f=await setup(directory,authorityRequest)
  assert.equal(must(await f.store.readEvents(f.authority)).length,size)
  const coldReopenAndReadMs=performance.now()-coldAt
  checkpoints.push({events:size,appendMs,search,prepare,admit,coldReopenAndReadMs,profile:await inventory(path.join(directory,'profile'))})
 }
}finally{await f.close()}
const report={kind:'memory-cost-synthetic',created:new Date().toISOString(),node:process.version,os:os.platform()+' '+os.release(),cpu:os.cpus()[0]?.model,tokenizerLoadMs,checkpoints,maxRssKiB:process.resourceUsage().maxRSS,paidCalls:0,modelQuality:'unverified',limits:['One local process and one synthetic branch; warm OS cache even after core reopen','Five observations per operation; p50/max are descriptive, not a statistical p95 or production SLO','128 short events do not represent months of full documents, media or multi-writer traffic','No model generation, external provider, platform lifecycle or actual process crash']}
await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
