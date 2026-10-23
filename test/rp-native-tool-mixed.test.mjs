import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { host } from './fixtures/rp/native-host.mjs'

for (const mode of ['tool', 'mixed', 'unknown', 'reasoning']) test('native tool cycle '+mode, {timeout:20000}, async () => {
  const mixed = mode !== 'tool', allowed = mode === 'tool' || mode === 'mixed'
  const f=await host(); let calls=0
  class Repro extends LlmAdapter {
    async *stream() {
      calls++
      if(calls===1) {
        if(mode === 'reasoning') yield {type:'reasoning-delta',index:2,text:'Hidden content must not enter certified public history.'}
        if(mixed) yield {type:'text-delta',index:0,text:'I will check the accepted record.'}
        yield {type:'tool-call-delta',index:mixed?1:0,id:'repro_call',name:mode === 'unknown' ? 'write_file' : 'rp_memory_search',argumentsDelta:'{"query":"REVIEW_FACT"}'}
        yield {type:'finish',reason:{kind:'tool-calls'}}
      } else { yield {type:'text-delta',index:0,text:'The accepted record is available.'}; yield {type:'finish',reason:{kind:'stop'}} }
    }
  }
  try {
    if(process.env.RP_REVIEW_TRACE) f.ctx.on('session/event',(session,event)=>{const m=event.type==='user/message'?event.data:event.data?.message;console.log('TRACE '+JSON.stringify({event:event.type,source:m?.source,types:m?.content?.map(b=>b.type),blocked:f.rp.status(session.id).blocked}))})
    f.ctx.llm.registerAdapter(['review-repro'],new Repro())
    const a=await f.create(); a.options.provider='review-repro'
    assert.equal((await f.command(a,'start')).kind,'success')
    assert.equal((await f.command(a,'input REVIEW_FACT')).kind,'success')
    await a.whenIdle(); const ready=await f.rp.ready(a.id).then(()=>true,()=>false)
    console.log('OBSERVATION '+JSON.stringify({mixed,calls,ready,status:f.rp.status(a.id),messages:a.session.deriveMessages().map(m=>({role:m.role,types:m.content?.map(b=>b.type)}))}))
    assert.equal(calls,allowed ? 2 : 1,'valid native mixed message should permit read tool and second request')
    assert.equal(ready,allowed)
  } finally {await f.dispose()}
})

