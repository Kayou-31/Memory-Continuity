import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {canonical} from '../store.js'
import {object,RpError} from '../validation.js'
export type WorkbenchSettings={revision:number;impactConfirmation:boolean;operationId:string|null}
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex')
/** Human management preference only. Never consulted for memory authorization. */
export function workbenchSettings(profileRoot:string){
 const file=path.join(profileRoot,'.dsh-rp/v1/workbench-settings.json')
 const read=async():Promise<WorkbenchSettings>=>{
  try{
   const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)throw new RpError('store_corrupt','Invalid workbench settings file')
   const envelope=object(JSON.parse(await fs.readFile(file,'utf8')),['data','sha256']),v=object(envelope.data,['revision','impactConfirmation','operationId'])
   if(envelope.sha256!==hash(v)||!Number.isSafeInteger(v.revision)||v.revision<1||typeof v.impactConfirmation!=='boolean'||typeof v.operationId!=='string')throw new RpError('store_corrupt','Workbench settings cannot be verified')
   return v as WorkbenchSettings
  }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {revision:0,impactConfirmation:true,operationId:null};throw e}
 }
 return {read,async write(expected:WorkbenchSettings,value:boolean,key:string,guard:()=>void){
  const old=await read();guard()
  if(old.operationId===key){if(old.impactConfirmation!==value)throw new RpError('idempotency_conflict','Settings operation changed');return old}
  if(canonical(old)!==canonical(expected))throw new RpError('stale_input','Workbench preferences changed')
  const data={revision:old.revision+1,impactConfirmation:value,operationId:key},temp=file+'.'+randomUUID()+'.tmp';let published=false
  try{const handle=await fs.open(temp,'wx',0o600);try{await handle.writeFile(canonical({data,sha256:hash(data)}));await handle.sync()}finally{await handle.close()};guard();await fs.rename(temp,file);published=true;guard();return data}
  catch(e){throw new RpError(published?'persistence_uncertain':'persistence_failed','Workbench settings save failed: '+String(e))}
  finally{await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e})}
 }}
}
