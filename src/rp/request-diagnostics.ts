/** Local serialization measurements. Never provider token usage or billing. */
import {canonical} from './store.js'
import type {DurableSession} from './host-journal.js'
import type {MemoryPacket} from './packet.js'
import type {MemoryMeter} from './token-budget.js'
const bytes=(v:unknown)=>Buffer.byteLength(canonical(v),'utf8')
export function selectionCost(packet?:MemoryPacket){
 const sum=(mandatory:boolean)=>{const entries=packet?.injection?.entries.filter(e=>e.selected&&e.mandatory===mandatory)??[];return {entries:entries.length,bytes:entries.reduce((n,e)=>n+e.bytes,0),measuredUnits:entries.reduce((n,e)=>n+(e.tokens??e.bytes),0)}}
 return {mandatory:sum(true),optional:sum(false),notice:'选中条目的正文计量；不含消息包装，不能与请求总量相加。'}
}
export function requestPayloadDiagnostics(options:any,journal:DurableSession,packet:MemoryPacket,meter?:MemoryMeter){
 const groups=new Map<string,any[]>(),add=(kind:string,value:any)=>{const list=groups.get(kind)??[];list.push(value);groups.set(kind,list)}
 for(const message of options.messages??[]){
  const kind=message.role==='system'?'system':message.id?.startsWith('retired_')?'retirement':message.role==='tool'?'tool-result':journal.frames[message.id]?'tool-call':journal.snapshots[message.id]?'current-memory':'ordinary-history'
  add(kind,message)
 }
 const sections=[...groups].map(([kind,messages])=>({kind,messages:messages.length,bytes:bytes(messages),measuredUnits:meter?meter.count(canonical(messages)):bytes(messages)}))
 for(const key of ['tools','toolHistory'])if(options[key])sections.push({kind:key==='tools'?'tool-declarations':'tool-history',messages:0,bytes:bytes(options[key]),measuredUnits:meter?meter.count(canonical(options[key])):bytes(options[key])})
 const payload=Object.fromEntries(Object.entries(options).filter(([key])=>key!=='signal'))
 return {provenance:'certified-adapter-input' as const,at:new Date().toISOString(),payloadUtf8Bytes:bytes(payload),mode:meter?.identity.mode??'conservative-utf8',sections,selection:selectionCost(packet),wireBytes:null,providerUsage:null,providerBilling:null,notice:'这是交给宿主适配器的最后一次已准入请求。分项含各自 JSON 包装，合计不等于完整请求；供应商格式、缓存、隐藏重试和实际账单未测量。'}
}
