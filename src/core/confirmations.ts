/** Durable administrative outcomes contain hashes, never a second copy of memory. */
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {canonical} from '../rp/store.js'
import {object,RpError,text} from '../rp/validation.js'
import type {ManagementController} from '../rp/person/management.js'
import {assertPublicationAllowed} from '../rp/publication-guard.js'

const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex')
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT'
function corrupt():never{throw new RpError('store_corrupt','Confirmation evidence is corrupt; retain it for diagnosis')}
function operationId(value:string){if(!/^[a-f0-9]{32}$/u.test(value))throw new RpError('scope_denied','Unknown confirmation ID')}
type Phase='prepared'|'attempted'|'committed'
type Entry={schemaVersion:1;id:string;phase:Phase;bindingHash:string;action:string;payloadSha256:string;previousHash:string;resultSha256:string}

export async function openConfirmations(profileRoot:string){
 const root=path.join(await fs.realpath(profileRoot),'.dsh-rp/v1/core-confirmations');await fs.mkdir(root,{recursive:true})
 const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())corrupt()
 let tail:Promise<unknown>=Promise.resolve()
 const serial=<T>(work:()=>Promise<T>)=>{const run=tail.catch(()=>{}).then(work);tail=run;return run}
 const file=(id:string,phase:Phase)=>path.join(root,id+'.'+phase+'.json')
 const read=async(id:string,phase:Phase)=>{
  try{
   const name=file(id,phase),stat=await fs.lstat(name);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)corrupt()
   const envelope=object(JSON.parse(await fs.readFile(name,'utf8')),['record','sha256']),r=object(envelope.record,['schemaVersion','id','phase','bindingHash','action','payloadSha256','previousHash','resultSha256']) as Entry
   if(r.schemaVersion!==1||r.id!==id||r.phase!==phase||envelope.sha256!==digest(r))corrupt()
   text(r.action,64);for(const h of[r.bindingHash,r.payloadSha256,r.previousHash,r.resultSha256])if(!/^[a-f0-9]{64}$/u.test(h))corrupt()
   return{record:r,sha256:envelope.sha256 as string}
  }catch(error){if(missing(error))return null;if(error instanceof RpError&&error.code==='store_corrupt')throw error;if(!(error instanceof RpError)&&(error as NodeJS.ErrnoException).code)throw new RpError('persistence_failed','Confirmation evidence could not be read');corrupt()}
 }
 const state=async(bindingHash:string,id:string)=>{
  operationId(id)
  const prepared=await read(id,'prepared'),attempted=await read(id,'attempted'),committed=await read(id,'committed')
  if(!prepared){if(attempted||committed)corrupt();throw new RpError('scope_denied','Unknown confirmation')}
  if(prepared.record.bindingHash!==bindingHash)throw new RpError('scope_denied','Confirmation belongs to another binding')
  if(prepared.record.previousHash!=='0'.repeat(64)||prepared.record.resultSha256!=='0'.repeat(64))corrupt()
  let prior=prepared
  for(const next of[attempted,committed]){
   if(!next){if(prior===prepared&&committed)corrupt();continue}
   if(next.record.previousHash!==prior.sha256||next.record.bindingHash!==bindingHash||next.record.action!==prepared.record.action||next.record.payloadSha256!==prepared.record.payloadSha256)corrupt()
   if(next===attempted&&next.record.resultSha256!=='0'.repeat(64))corrupt();prior=next
  }
  return{prepared,attempted,committed,latest:prior}
 }
 const write=async(record:Entry)=>{
  const target=file(record.id,record.phase),candidate=target+'.tmp-'+randomUUID(),body=canonical({record,sha256:digest(record)})
  try{
   if(record.phase!=='committed')assertPublicationAllowed()
   const h=await fs.open(candidate,'wx',0o600);try{await h.writeFile(body);await h.sync()}finally{await h.close()}
   if(record.phase!=='committed')assertPublicationAllowed()
   try{await fs.link(candidate,target)}catch(error){const saved=await read(record.id,record.phase);if(saved&&canonical(saved.record)===canonical(record))return;throw error}
  }catch(error){if(error instanceof RpError)throw error;throw new RpError('persistence_failed','Confirmation evidence could not be saved')}
  finally{await fs.unlink(candidate).catch(()=>{})}
 }
 const outcome=(s:Awaited<ReturnType<typeof state>>)=>({id:s.prepared.record.id,action:s.prepared.record.action,status:s.committed?'committed' as const:s.attempted?'uncertain' as const:'prepared' as const,resultSha256:s.committed?.record.resultSha256??null})
 return{
  async prepare(bindingHash:string,id:string,action:string,payload:unknown){return serial(async()=>{
   operationId(id);text(action,64);const payloadSha256=digest(payload),existing=await read(id,'prepared')
   if(existing){const s=await state(bindingHash,id);if(s.prepared.record.action!==action||s.prepared.record.payloadSha256!==payloadSha256)throw new RpError('idempotency_conflict','Confirmation draft changed');return}
   if(await read(id,'attempted')||await read(id,'committed'))corrupt()
   if((await fs.readdir(root)).filter(name=>name.endsWith('.prepared.json')).length>=4096)throw new RpError('capacity_exceeded','Confirmation history reached its limit; retain history and inspect current memory')
   await write({schemaVersion:1,id,phase:'prepared',bindingHash,action,payloadSha256,previousHash:'0'.repeat(64),resultSha256:'0'.repeat(64)})
  })},
  async inspect(bindingHash:string,id:string){return serial(async()=>outcome(await state(bindingHash,id)))},
  async attempt(bindingHash:string,id:string){return serial(async()=>{const s=await state(bindingHash,id);if(!s.attempted)await write({...s.prepared.record,phase:'attempted',previousHash:s.prepared.sha256})})},
  async complete(bindingHash:string,id:string,result:unknown){return serial(async()=>{const s=await state(bindingHash,id);if(!s.attempted)corrupt();const resultSha256=digest(result)
   if(s.committed){if(s.committed.record.resultSha256!==resultSha256)throw new RpError('idempotency_conflict','Confirmation result changed');return outcome(s)}
   await write({...s.prepared.record,phase:'committed',previousHash:s.attempted.sha256,resultSha256});return outcome(await state(bindingHash,id))
  })},
 }
}

/** A live explicit retry may reuse the original engine handle; a cold retry never replays it. */
export function durableManagement(base:ManagementController,journal:Awaited<ReturnType<typeof openConfirmations>>,bindingHash:string,authorize:()=>Promise<void>){
 const live=new Set<string>(),pending=new Set<Promise<unknown>>(),confirming=new Map<string,Promise<unknown>>();let retired=false
 const active=()=>{if(retired)throw new RpError('ownership_lost','Management closed');base.assertActive()}
 const track=async<T>(work:()=>Promise<T>)=>{active();const run=(async()=>{await authorize();active();return work()})();pending.add(run);try{return await run}finally{pending.delete(run)}}
 return{...base,
  prepare(value:unknown){return track(async()=>{const p=await base.prepare(value);active();await journal.prepare(bindingHash,p.id,p.action,p.payload);active();if(live.size>=32)live.delete(live.values().next().value!);live.add(p.id);return p})},
  confirm(id:string){
   active();const existing=confirming.get(id);if(existing)return existing
   const run=track(async()=>{
    const current=await journal.inspect(bindingHash,id);active()
    if(current.status==='committed')return current
    if(!live.has(id))throw new RpError(current.status==='uncertain'?'persistence_uncertain':'stale_input','This review belonged to a previous management session; inspect current memory and create a fresh review')
    await journal.attempt(bindingHash,id);active()
    const result=await base.confirm(id)
    try{return await journal.complete(bindingHash,id,result)}catch(error){throw new RpError('persistence_uncertain','Memory change completed but its confirmation receipt could not be saved; inspect current memory before further action')}
   })
   confirming.set(id,run);void run.finally(()=>confirming.delete(id)).catch(()=>{});return run
  },
  confirmation(id:string){return track(async()=>{const result=await journal.inspect(bindingHash,id);active();return result})},
  revoke(){retired=true;base.revoke()},
  async drain(){await Promise.allSettled([...pending])},
 }
}
