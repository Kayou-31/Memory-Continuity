import {openRpMemory} from '../rp/memory.js'
import {RpError} from '../rp/validation.js'
import {acquireProfileOwner} from './owner.js'

/** Both official entry points acquire this lease before opening any store. */
export async function openMemoryCore(input:Parameters<typeof openRpMemory>[0]&{ownerKind?:'application'|'service'|'embedded-dsh'}){
 const owner=await acquireProfileOwner({profileRoot:input.profileRoot,kind:input.ownerKind??'application'})
 let retiring=false,closePromise:Promise<void>|undefined
 const active=()=>{owner.assertActive();if(retiring)throw new RpError('ownership_lost','Memory owner is closing; reopen after it has stopped');input.active?.()}
 try{
  const memory=await openRpMemory({...input,active})
  return{...memory,close(){
   if(closePromise)return closePromise
   retiring=true
   closePromise=(async()=>{
    memory.retrieval.dispose()
    await memory.jobs.close()
    // Pending publications either finish their seals or reject at the guard.
    // Do not give another process ownership until every queued writer settles.
    await memory.coordinator.mutate(async()=>{})
    await owner.release()
   })()
   return closePromise
  }}
 }catch(error){await owner.release();throw error}
}
