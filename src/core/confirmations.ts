/** Durable administrative outcomes contain hashes, never a second copy of memory. */
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {canonical} from '../rp/store.js'
import {object,RpError,text,integer} from '../rp/validation.js'
import type {ManagementController} from '../rp/person/management.js'
import {assertPublicationAllowed} from '../rp/publication-guard.js'

const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex')
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT'
function corrupt():never{throw new RpError('store_corrupt','Confirmation evidence is corrupt; retain it for diagnosis')}
function operationId(value:string){if(!/^[a-f0-9]{32}$/u.test(value))throw new RpError('scope_denied','Unknown confirmation ID')}
type Phase='prepared'|'attempted'|'committed'|'cancelled'
type Entry={schemaVersion:1;id:string;phase:Phase;bindingHash:string;action:string;payloadSha256:string;previousHash:string;resultSha256:string}
type Envelope={record:Entry;sha256:string}
const phases:Phase[]=['prepared','attempted','committed','cancelled'],zero='0'.repeat(64)
const queues=new Map<string,Promise<unknown>>()

export async function openConfirmations(profileRoot:string,options:{/** Internal test bound, never an RPC option. */maxActive?:number}={}){
 const root=path.join(await fs.realpath(profileRoot),'.dsh-rp/v1/core-confirmations');await fs.mkdir(root,{recursive:true})
 const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())corrupt()
 const maxActive=options.maxActive??4096;integer(maxActive,1);if(maxActive>4096)throw new RpError('invalid_record','Confirmation active limit')
 const serial=<T>(work:()=>Promise<T>)=>{const run=(queues.get(root)??Promise.resolve()).catch(()=>{}).then(work);queues.set(root,run);void run.finally(()=>{if(queues.get(root)===run)queues.delete(root)}).catch(()=>{});return run}
 const file=(id:string,phase:Phase)=>path.join(root,id+'.'+phase+'.json')
 const archiveFile=(id:string)=>path.join(root,'archive',id.slice(0,2),id+'.json')
 const validate=(raw:unknown,id:string,phase:Phase):Envelope=>{
  const envelope=object(raw,['record','sha256']),r=object(envelope.record,['schemaVersion','id','phase','bindingHash','action','payloadSha256','previousHash','resultSha256']) as Entry
  if(r.schemaVersion!==1||r.id!==id||r.phase!==phase||envelope.sha256!==digest(r))corrupt()
  text(r.action,64);for(const h of[r.bindingHash,r.payloadSha256,r.previousHash,r.resultSha256])if(!/^[a-f0-9]{64}$/u.test(h))corrupt()
  return {record:r,sha256:envelope.sha256 as string}
 }
 const readJson=async(name:string,max:number)=>{
  try{const stat=await fs.lstat(name);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)corrupt();const parsed=JSON.parse(await fs.readFile(name,'utf8'));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))corrupt();return parsed}
  catch(error){if(missing(error))return null;if(error instanceof RpError&&error.code==='store_corrupt')throw error;if(!(error instanceof RpError)&&(error as NodeJS.ErrnoException).code)throw new RpError('persistence_failed','Confirmation evidence could not be read');corrupt()}
 }
 const read=async(id:string,phase:Phase)=>{
  const raw=await readJson(file(id,phase),4096);if(raw===null)return null
  try{return validate(raw,id,phase)}catch{corrupt()}
 }
 const chain=(records:(Envelope|null)[])=>{
  const [prepared,attempted,committed,cancelled]=records
  if(!prepared){if(attempted||committed||cancelled)corrupt();throw new RpError('scope_denied','Unknown confirmation')}
  if(prepared.record.previousHash!==zero||prepared.record.resultSha256!==zero||cancelled&&(attempted||committed)||committed&&!attempted)corrupt()
  let prior=prepared
  for(const next of[attempted,committed,cancelled]){
   if(!next)continue
   if(next.record.previousHash!==prior.sha256||next.record.bindingHash!==prepared.record.bindingHash||next.record.action!==prepared.record.action||next.record.payloadSha256!==prepared.record.payloadSha256)corrupt()
   if(next!==committed&&next.record.resultSha256!==zero)corrupt();prior=next
  }
  return{prepared,attempted,committed,cancelled,latest:prior,records}
 }
 const state=async(bindingHash:string|undefined,id:string,allowMissing=false)=>{
  operationId(id);const active=[];for(const phase of phases)active.push(await read(id,phase))
  for(const dir of[path.join(root,'archive'),path.dirname(archiveFile(id))])try{const st=await fs.lstat(dir);if(!st.isDirectory()||st.isSymbolicLink())corrupt()}catch(e){if(!missing(e))throw e}
  const raw=await readJson(archiveFile(id),16384);let records=active,archived=false
  if(raw!==null){
   try{const a=object(raw,['record','sha256']),v=object(a.record,['schemaVersion','id','records']);if(v.schemaVersion!==1||v.id!==id||a.sha256!==digest(v)||!Array.isArray(v.records)||v.records.length!==4)corrupt();records=v.records.map((e:unknown,i:number)=>e===null?null:validate(e,id,phases[i]));const complete=chain(records);if(!complete.committed&&!complete.cancelled)corrupt();for(let i=0;i<4;i++)if(active[i]&&canonical(active[i])!==canonical(records[i]))corrupt();archived=true}catch{corrupt()}
  }
  if(!records.some(Boolean)&&allowMissing)return null
  const s=chain(records);if(bindingHash!==undefined&&s.prepared.record.bindingHash!==bindingHash)throw new RpError('scope_denied','Confirmation belongs to another binding')
  return {...s,archived}
 }
 const required=async(bindingHash:string|undefined,id:string)=>(await state(bindingHash,id))!
 const publish=async(target:string,body:string,guard:boolean)=>{
  const candidate=target+'.tmp-'+randomUUID()
  try{
   if(guard)assertPublicationAllowed()
   const h=await fs.open(candidate,'wx',0o600);try{await h.writeFile(body);await h.sync()}finally{await h.close()}
   if(guard)assertPublicationAllowed()
   try{await fs.link(candidate,target)}catch(error){const saved=await readJson(target,16384);if(saved&&canonical(saved)===body)return;throw error}
  }catch(error){if(error instanceof RpError)throw error;throw new RpError('persistence_failed','Confirmation evidence could not be saved')}
  finally{await fs.unlink(candidate).catch(()=>{})}
 }
 const write=(record:Entry)=>publish(file(record.id,record.phase),canonical({record,sha256:digest(record)}),record.phase==='prepared'||record.phase==='attempted')
 const outcome=(s:Awaited<ReturnType<typeof required>>)=>({id:s.prepared.record.id,action:s.prepared.record.action,status:s.committed?'committed' as const:s.cancelled?'cancelled' as const:s.attempted?'uncertain' as const:'prepared' as const,resultSha256:s.committed?.record.resultSha256??null})
 const archive=async(s:Awaited<ReturnType<typeof required>>)=>{
  if(!s.committed&&!s.cancelled)return
  const id=s.prepared.record.id,target=archiveFile(id)
  for(const dir of[path.join(root,'archive'),path.dirname(target)]){await fs.mkdir(dir,{recursive:true});const st=await fs.lstat(dir);if(!st.isDirectory()||st.isSymbolicLink())corrupt()}
  const record={schemaVersion:1,id,records:s.records};await publish(target,canonical({record,sha256:digest(record)}),false)
  const verified=await required(s.prepared.record.bindingHash,id);if(!verified.archived||canonical(verified.records)!==canonical(s.records))corrupt()
  for(const phase of phases)try{await fs.unlink(file(id,phase))}catch(error){if(!missing(error))throw new RpError('persistence_failed','Confirmation archived; active cleanup pending')}
 }
 const archiveBestEffort=async(s:Awaited<ReturnType<typeof required>>)=>{try{await archive(s)}catch(error){if(error instanceof RpError&&error.code==='store_corrupt')throw error}}
 const activeIds=async()=>[...new Set((await fs.readdir(root)).flatMap(n=>/^([a-f0-9]{32})\.(prepared|attempted|committed|cancelled)\.json$/u.exec(n)?.slice(1,2)??[]))]
 const maintain=async(bindingHash?:string)=>{for(const id of await activeIds()){const s=await required(undefined,id);if(bindingHash===undefined||s.prepared.record.bindingHash===bindingHash)await archiveBestEffort(s)}}
 return{
  async prepare(bindingHash:string,id:string,action:string,payload:unknown){return serial(async()=>{
   operationId(id);text(action,64);if(!/^[a-f0-9]{64}$/u.test(bindingHash))throw new RpError('invalid_record','Confirmation binding hash');const payloadSha256=digest(payload),existing=await state(bindingHash,id,true)
   if(existing){if(existing.prepared.record.action!==action||existing.prepared.record.payloadSha256!==payloadSha256)throw new RpError('idempotency_conflict','Confirmation draft changed');return}
   if((await activeIds()).length>=maxActive)await maintain()
   if((await activeIds()).length>=maxActive)throw new RpError('capacity_exceeded','活动确认已满；请取消未执行预览或核对结果未知的操作，历史不会被截断')
   await write({schemaVersion:1,id,phase:'prepared',bindingHash,action,payloadSha256,previousHash:zero,resultSha256:zero})
  })},
  async inspect(bindingHash:string,id:string){return serial(async()=>outcome(await required(bindingHash,id)))},
  async attempt(bindingHash:string,id:string){return serial(async()=>{const s=await required(bindingHash,id);if(s.cancelled)throw new RpError('stale_input','Confirmation cancelled');if(!s.attempted)await write({...s.prepared.record,phase:'attempted',previousHash:s.prepared.sha256})})},
  async complete(bindingHash:string,id:string,result:unknown){return serial(async()=>{const s=await required(bindingHash,id);if(!s.attempted)corrupt();const resultSha256=digest(result)
   if(s.committed){if(s.committed.record.resultSha256!==resultSha256)throw new RpError('idempotency_conflict','Confirmation result changed');return outcome(s)}
   await write({...s.prepared.record,phase:'committed',previousHash:s.attempted.sha256,resultSha256});const completed=await required(bindingHash,id);await archiveBestEffort(completed);return outcome(completed)
  })},
  async cancelPrepared(bindingHash:string,id:string){return serial(async()=>{let s=await required(bindingHash,id);if(s.attempted&&!s.committed)throw new RpError('persistence_uncertain','Confirmation was attempted; inspect memory before further action');if(!s.committed&&!s.cancelled){await write({...s.prepared.record,phase:'cancelled',previousHash:s.prepared.sha256});s=await required(bindingHash,id)}await archiveBestEffort(s);return outcome(s)})},
  async maintain(bindingHash:string){return serial(()=>maintain(bindingHash))},
  async status(bindingHash:string){return serial(async()=>{const ids=await activeIds();let prepared=0,uncertain=0,cleanupPending=0;for(const id of ids){const s=await required(undefined,id);if(s.prepared.record.bindingHash!==bindingHash)continue;if(s.committed||s.cancelled)cleanupPending++;else if(s.attempted)uncertain++;else prepared++}return{active:ids.length,limit:maxActive,prepared,uncertain,cleanupPending,nearCapacity:ids.length>=Math.floor(maxActive*.8),notice:'活动确认与永久归档分开。结果未知的操作不自动重放；归档保留摘要证据，磁盘占用会随历史增长。'}})},
 }
}

/** A live explicit retry may reuse the original engine handle; a cold retry never replays it. */
export function durableManagement(base:ManagementController,journal:Awaited<ReturnType<typeof openConfirmations>>,bindingHash:string,authorize:()=>Promise<void>){
 const live=new Set<string>(),owned=new Set<string>(),pending=new Set<Promise<unknown>>(),confirming=new Map<string,Promise<unknown>>();let retired=false,retirement:Promise<void>|undefined
 const active=()=>{if(retired)throw new RpError('ownership_lost','Management closed');base.assertActive()}
 const track=async<T>(work:()=>Promise<T>)=>{active();const run=(async()=>{await authorize();active();return work()})();pending.add(run);try{return await run}finally{pending.delete(run)}}
 return{...base,
  snapshot(){return track(async()=>{const result={...await base.snapshot(),confirmationCapacity:await journal.status(bindingHash)};active();return result})},
  organize(value:unknown){return track(async()=>{const result=await base.organize(value);active();return result})},
  prepare(value:unknown){return track(async()=>{const p=await base.prepare(value);active();await journal.prepare(bindingHash,p.id,p.action,p.payload);owned.add(p.id);active();if(live.size>=32){const old=live.values().next().value!;try{await journal.cancelPrepared(bindingHash,old);owned.delete(old)}catch(e){if(!(e instanceof RpError)||e.code!=='persistence_uncertain')throw e}live.delete(old)}active();live.add(p.id);return p})},
  confirm(id:string){
   active();const existing=confirming.get(id);if(existing)return existing
   const run=track(async()=>{
    const current=await journal.inspect(bindingHash,id);active()
    if(current.status==='committed')return current
    if(current.status==='cancelled')throw new RpError('stale_input','Confirmation cancelled; create a fresh review')
    if(!live.has(id))throw new RpError(current.status==='uncertain'?'persistence_uncertain':'stale_input','This review belonged to a previous management session; inspect current memory and create a fresh review')
    await journal.attempt(bindingHash,id);active()
    const result=await base.confirm(id)
    try{const saved=await journal.complete(bindingHash,id,result);owned.delete(id);live.delete(id);return saved}catch(error){throw new RpError('persistence_uncertain','Memory change completed but its confirmation receipt could not be saved; inspect current memory before further action')}
   })
   confirming.set(id,run);void run.finally(()=>confirming.delete(id)).catch(()=>{});return run
  },
  confirmation(id:string){return track(async()=>{const result=await journal.inspect(bindingHash,id);active();return result})},
  cancel(id:string){return track(async()=>{const result=await journal.cancelPrepared(bindingHash,id);if(result.status==='committed')return result;await base.cancel(id);owned.delete(id);live.delete(id);return result})},
  revoke(){if(retired)return;retired=true;base.revoke();retirement=(async()=>{await Promise.allSettled([...pending]);const failures:unknown[]=[];for(const id of owned)try{await journal.cancelPrepared(bindingHash,id)}catch(e){if(!(e instanceof RpError)||e.code!=='persistence_uncertain')failures.push(e)}if(failures.length)throw new AggregateError(failures,'Confirmation retirement failed')})();void retirement.catch(()=>{})},
  async drain(){await Promise.allSettled([...pending]);await retirement},
 }
}
