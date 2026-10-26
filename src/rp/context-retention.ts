/** Remove only a certified MC contribution from the model surface, never its source log. */
import {createHash} from 'node:crypto'
import {joinContextSections} from '@deepseek-ai/dsh-system-prompt'
import {canonical} from './store.js'
import {RpError} from './schema.js'
import type {DurableSession} from './host-journal.js'
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const text=(m:any)=>(m.content??[]).filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n')
const marker={name:'memcont-retained',text:'Earlier memory snapshot omitted. Use the latest Memory-Continuity context.'}

function remainder(message:any,journal:DurableSession){
 const snapshot=journal.snapshots[message.id]
 if(!snapshot||snapshot.provenance!=='packet'||message.source?.kind!=='runtime-context')return
 if(journal.messageHashes[message.id]!==hash(canonical(message))||snapshot.bodyHash!==hash(text(message)))throw new RpError('stale_input','Original memory snapshot changed')
 const sections=message.source.sections
 // No guessing or prose splitting for older native formats.
 if(!Array.isArray(sections))return
 if(message.source.form!=='snapshot'||sections.some((s:any)=>!s||typeof s.name!=='string'||typeof s.text!=='string'||Object.keys(s).some(k=>!['name','text'].includes(k)))||joinContextSections(sections)!==text(message))throw new RpError('stale_input','Memory section attribution changed')
 const owned=sections.filter((s:any)=>s.name==='rp-memory')
 if(owned.length!==1)throw new RpError('scope_denied','Memory section ownership is ambiguous')
 let packet:any;try{packet=JSON.parse(owned[0].text)}catch{throw new RpError('stale_input','Memory section is not the original packet')}
 if(packet.rpPacketId!==snapshot.packetId)throw new RpError('stale_input','Memory section packet identity changed')
 const rest=sections.filter((s:any)=>s.name!=='rp-memory')
 return {id:'retired_'+hash(message.id+':'+snapshot.bodyHash),role:'user',source:{kind:'runtime-context',form:'snapshot',sections:rest.length?rest:[marker]},content:[{type:'text',text:joinContextSections(rest.length?rest:[marker])}]}
}

/** Exact durable derivation; a label, new hash, or source reference alone is never authorization. */
export function retiredContextOriginal(session:any,journal:DurableSession,message:any,event?:any):any|undefined{
 if(!message.id?.startsWith('retired_'))return
 event??=session.surface.nodes.map((seq:any)=>session.eventAt(seq)).find((e:any)=>e?.type==='user/message'&&e.data.id===message.id)
 if(!event||event.type!=='user/message'||event.surfaceOp?.op!=='replace'||event.surfaceOp.startSeq!==event.surfaceOp.endSeq||event.sourceEventSeqs?.length!==1||event.sourceEventSeqs[0]!==event.surfaceOp.startSeq)throw new RpError('scope_denied','Uncertified memory surface replacement')
 const original=session.eventAt(event.sourceEventSeqs[0])
 if(original?.type!=='user/message'||original.surfaceOp!=='append')throw new RpError('scope_denied','Memory replacement must cite one original snapshot')
 const expected=remainder(original.data,journal)
 if(!expected||canonical(expected)!==canonical(message)||canonical(event.data)!==canonical(message))throw new RpError('scope_denied','Memory replacement changed more than its owned section')
 return original.data
}

/** Pure proposed surface used by sizing and then committed through the SDK's single-node API. */
export function planContextRetirement(session:any,journal:DurableSession,keepPacketId?:string,keepBodyHash?:string){
 const replacements:{seq:any;message:any}[]=[],messages=session.deriveMessages().map((message:any)=>{
  if(keepBodyHash&&journal.snapshots[message.id]?.bodyHash===keepBodyHash)return message
  if(journal.snapshots[message.id]?.packetId===keepPacketId)return message
  const next=remainder(message,journal);if(!next)return message
  const seq=session.surface.nodes.find((s:any)=>{const e=session.eventAt(s);return e?.type==='user/message'&&e.data.id===message.id&&e.surfaceOp==='append'})
  if(seq===undefined)throw new RpError('scope_denied','Memory snapshot is not an original surface node')
  replacements.push({seq,message:next});return next
 })
 return {messages,replacements}
}

export function memoryDelivery(journal:DurableSession,firstLimit:number){
 const phase=Object.keys(journal.snapshots).length?'followup':'initial'
 return {phase,optionalLimit:phase==='initial'?firstLimit:Math.min(firstLimit,2048),notice:'首轮按需加载；后续只携带最新记忆视图，可选内容最多 2048 当前计量单位。必需身份与边界不截断，仍受总预算限制。'}
}

export function missingRecentOriginals(journal:DurableSession,packet:any,messages:readonly any[]){
 const present=new Set(messages.filter(m=>journal.messageHashes[m.id]===hash(canonical(m))).map(m=>journal.hostSources[m.id]))
 // Expected queued input; final admission must prove it actually reached the
 // request before this omission is trusted (pre-step middleware can filter it).
 const pending=journal.inputs.find(i=>i.turnId===journal.currentTurnId&&journal.messageHashes[i.messageId])
 if(pending)present.add(pending.sourceId)
 return packet.recent.filter((source:any)=>!present.has(source.id))
}
