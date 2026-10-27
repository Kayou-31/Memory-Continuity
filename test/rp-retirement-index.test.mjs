import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {performance} from 'node:perf_hooks'
import {build,stop} from 'esbuild'
import {pathToFileURL} from 'node:url'
import {joinContextSections} from '@deepseek-ai/dsh-system-prompt'
const file=path.resolve('work/iteration-2026-10-27/retirement-'+randomUUID()+'.mjs');await fs.mkdir(path.dirname(file),{recursive:true});await build({entryPoints:['src/rp/context-retention.ts'],outfile:file,bundle:true,platform:'node',format:'esm',logLevel:'silent'});stop();const api=await import(pathToFileURL(file).href)
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}',sha=s=>createHash('sha256').update(s).digest('hex')
function fixture(n){let reads=0;const events=new Map(),journal={snapshots:{},messageHashes:{}},nodes=[],messages=[]
 for(let i=0;i<n;i++){const sections=[{name:'rp-memory',text:JSON.stringify({rpPacketId:'p_'+i})}],m={id:'m_'+i,role:'user',source:{kind:'runtime-context',form:'snapshot',sections},content:[{type:'text',text:joinContextSections(sections)}]};events.set(i,{type:'user/message',data:m,surfaceOp:'append'});nodes.push(i);messages.push(m);journal.snapshots[m.id]={provenance:'packet',packetId:'p_'+i,bodyHash:sha(m.content[0].text)};journal.messageHashes[m.id]=sha(canonical(m))}
 const session={surface:{nodes},deriveMessages:()=>messages,eventAt:seq=>{reads++;return events.get(seq)}}
 const plan=api.planContextRetirement(session,journal);nodes.length=0;messages.length=0
 for(const [i,r]of plan.replacements.entries()){nodes.push(n+i);messages.push(r.message);events.set(n+i,{type:'user/message',data:r.message,surfaceOp:{op:'replace',startSeq:r.seq,endSeq:r.seq},sourceEventSeqs:[r.seq]})}reads=0
 return {session,journal,events,messages,reads:()=>reads}
}
for(const n of [32,256])test('retirement certification indexes '+n+' surface nodes once',()=>{
 const f=fixture(n);assert.equal(typeof api.createSurfaceIndex,'function');const start=performance.now(),index=api.createSurfaceIndex(f.session)
 for(const message of f.messages)assert.ok(api.retiredContextOriginal(f.session,f.journal,message,undefined,index))
 console.log('RETIREMENT_MEASUREMENT '+JSON.stringify({n,eventReads:f.reads(),ms:performance.now()-start,node:process.version}));assert.ok(f.reads()<=2*n)
 const forged=structuredClone(f.messages[0]);forged.content[0].text='FORGED';assert.throws(()=>api.retiredContextOriginal(f.session,f.journal,forged,undefined,index),/changed/)
 assert.throws(()=>api.retiredContextOriginal(f.session,f.journal,f.messages[0],undefined,{}),/index/)
})
