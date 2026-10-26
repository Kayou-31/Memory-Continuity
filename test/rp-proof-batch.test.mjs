import test from 'node:test'
import assert from 'node:assert/strict'
import {build,stop} from 'esbuild'
import {pathToFileURL} from 'node:url'
import path from 'node:path'
const runtime=path.resolve('work/task10-injection-cost/packet-proof.mjs')
await build({entryPoints:['src/rp/packet-proof.ts'],outfile:runtime,bundle:true,platform:'node',format:'esm'});stop()
const api=await import(pathToFileURL(runtime))
test('historical packet proofs share one scoped read while each original proof is checked',async()=>{
 assert.equal(typeof api.verifyPacketProofs,'function')
 const projection={state:[],claims:[],conflicts:[],knowledge:[],relationships:[]},proof=api.capturePacketProof([],[],projection);let reads=0
 const store={async withReadView(authority,work){reads++;return {ok:true,value:await work({events:[],summaries:[],projection,ledger:{authorityChanges:[]}})}}}
 const authority={viewpoint:{kind:'narrator'}}
 await api.verifyPacketProofs(store,authority,Array.from({length:128},()=>proof));assert.equal(reads,1)
 await assert.rejects(api.verifyPacketProofs(store,authority,[proof,{...proof,projectionSha256:'0'.repeat(64)}]),/Historical packet records changed/)
 await assert.rejects(api.verifyPacketProofs(store,authority,[undefined]),/no original proof/)
})
