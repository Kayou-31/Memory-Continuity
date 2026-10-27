/** Trusted service dispatcher. JSON never supplies a HostAuthority. */
import {randomBytes,createHash} from 'node:crypto'
import type {openMemoryCore} from './owned-memory.js'
import type {AuthorityRequest} from '../rp/store.js'
import {canonical} from '../rp/store.js'
import {id,integer,object,RpError,text} from '../rp/validation.js'
import {createRetrieval,unwrap} from '../rp/retrieval.js'
import {retrievalEvidence,verifyRetrievalEvidence,type RetrievalEvidence} from '../rp/retrieval-evidence.js'
import {openManagementServer} from '../rp/person/management-server.js'
import type {HostAuthority} from '../rp/types.js'
import {openConfirmations,durableManagement} from './confirmations.js'

type Core=Awaited<ReturnType<typeof openMemoryCore>>
export type CoreBinding={id:string;request:AuthorityRequest;personId?:string}
export type CoreServiceInput={memory:Core;bindings:readonly CoreBinding[];requestTimeoutMs?:number;maxRequests?:number;/** Trusted test clock; not RPC/config input. */now?:()=>number}
type Manager=ReturnType<typeof durableManagement>
type Capability={id:string;binding:CoreBinding;expires:number;revoked:boolean;authority:HostAuthority;reader:ReturnType<typeof createRetrieval>;receipts:Map<string,RetrievalEvidence>;manager?:Manager;managerOpening?:Promise<Manager>;workbench?:Awaited<ReturnType<typeof openManagementServer>>;workbenchOpening?:Promise<void>}
const secret=()=>randomBytes(32).toString('hex'),hash=(token:string)=>createHash('sha256').update(token).digest('hex')
const denied=(message:string):never=>{throw new RpError('scope_denied',message)}

export async function createCoreRpc(input:CoreServiceInput){
 const memory=input.memory,now=input.now??Date.now,bindings=new Map<string,CoreBinding>(),caps=new Map<string,Capability>(),tokens=new Map<string,Capability>()
 let closed=false,opening=0
 if(!Array.isArray(input.bindings)||input.bindings.length>32)throw new RpError('invalid_record','At most 32 configured bindings are supported')
 for(const original of input.bindings){
  const b=structuredClone(original);object(b,['id','request'],['personId']);id(b.id);if(b.personId)id(b.personId)
  if(bindings.has(b.id))throw new RpError('invalid_record','Duplicate service binding')
  const authority=unwrap(await memory.control.authorize(b.request));unwrap(await memory.control.checkManagement(authority));bindings.set(b.id,b)
 }
 const journal=await openConfirmations(memory.profileRoot)
 const active=(cap?:Capability)=>{if(closed||cap&&(cap.revoked||now()>=cap.expires))throw new RpError('ownership_lost','Core service capability expired or was revoked; reopen it explicitly')}
 const lookup=(value:unknown)=>{text(value,64);const cap=caps.get(value as string);if(!cap)denied('Unknown session capability');active(cap);return cap!}
 const revoke=async(cap:Capability)=>{
  cap.revoked=true;cap.reader.dispose();cap.receipts.clear();caps.delete(cap.id)
  for(const [key,value]of tokens)if(value===cap)tokens.delete(key)
  await cap.managerOpening?.catch(()=>{});cap.manager?.revoke()
  await cap.workbenchOpening?.catch(()=>{});await cap.workbench?.close();await cap.manager?.drain()
 }
 const sweep=async()=>{for(const cap of caps.values())if(now()>=cap.expires)await revoke(cap)}
 const manager=async(cap:Capability):Promise<Manager>=>{
  if(cap.manager)return cap.manager
  return cap.managerOpening??=(async()=>{
   const authority=unwrap(await memory.control.authorize(cap.binding.request));active(cap)
   const base=memory.management.create(authority,()=>!closed&&!cap.revoked&&now()<cap.expires)
   return cap.manager=durableManagement(base,journal,hash(canonical(cap.binding)),async()=>{active(cap);unwrap(await memory.control.checkManagement(authority));unwrap(await memory.store.readFence(authority));active(cap)})
  })()
 }
 return{
  toolCapability(token:string){active();const cap=tokens.get(hash(token));if(!cap)denied('Unknown tool capability');active(cap);return cap!},
  async admin(route:string,value:unknown,requestActive:()=>void){
   active();requestActive();await sweep();active();requestActive()
   if(route==='/v1/admin/status'){
    object(value,[]);return{modelDispatch:false,bindings:[...bindings.keys()],sessions:[...caps.values()].map(c=>({sessionId:c.id,bindingId:c.binding.id,expiresAt:new Date(c.expires).toISOString()}))}
   }
   if(route==='/v1/admin/session'){
    const v=object(value,['bindingId'],['ttlMs']);id(v.bindingId);const binding=bindings.get(v.bindingId);if(!binding)denied('Binding was not configured by the administrator')
    const ttl=v.ttlMs??600000;integer(ttl,1000);if(ttl>600000)throw new RpError('invalid_record','Session lifetime exceeds ten minutes')
    if(caps.size+opening>=64)throw new RpError('capacity_exceeded','Too many active service sessions; revoke unused sessions')
    opening++
    try{
    const sessionId=randomBytes(24).toString('hex'),toolToken=secret(),authority=unwrap(await memory.control.authorize({...binding!.request,sessionId:'core_'+sessionId,sceneId:binding!.request.sceneId??'core',permissions:['read']}))
    active();requestActive()
    const cap:Capability={id:sessionId,binding:binding!,expires:now()+ttl,revoked:false,authority,reader:createRetrieval(memory.store,{entityIds:binding!.personId?[binding!.personId]:[]}),receipts:new Map()}
    caps.set(sessionId,cap);tokens.set(hash(toolToken),cap);return{sessionId,toolToken,expiresAt:new Date(cap.expires).toISOString()}
    }finally{opening--}
   }
   if(route==='/v1/admin/revoke'){
    const v=object(value,['sessionId']),cap=lookup(v.sessionId);await revoke(cap);return{revoked:true}
   }
   if(route==='/v1/admin/workbench'){
    const v=object(value,['sessionId'],['host']),cap=lookup(v.sessionId);if(v.host!==undefined&&v.host!=='astrbot')throw new RpError('invalid_record','Unsupported management surface')
    if(!cap.workbench)await(cap.workbenchOpening??=(async()=>{
     const controller=await manager(cap);active(cap);requestActive()
     const workbench=await openManagementServer(controller,()=>({host:'memory-continuity-core',personId:cap.binding.personId??null,modelDispatch:false}),undefined,undefined,v.host??'independent-core')
     try{active(cap);requestActive()}catch(error){await workbench.close();throw error}
     cap.workbench=workbench
    })().finally(()=>{cap.workbenchOpening=undefined}))
    active(cap);requestActive();return{url:cap.workbench!.url}
   }
   if(['/v1/admin/snapshot','/v1/admin/prepare','/v1/admin/confirm','/v1/admin/confirmation','/v1/admin/cancel'].includes(route)){
    const fields=route.endsWith('/prepare')?['sessionId','snapshotId','action','payload']:route.endsWith('/snapshot')?['sessionId']:['sessionId','id']
    const v=object(value,fields),cap=lookup(v.sessionId),control=await manager(cap);active(cap);requestActive()
    if(route.endsWith('/snapshot'))return control.snapshot()
    if(route.endsWith('/prepare'))return control.prepare({snapshotId:v.snapshotId,action:v.action,payload:v.payload})
    if(route.endsWith('/cancel'))return control.cancel(v.id)
    return route.endsWith('/confirmation')?control.confirmation(v.id):control.confirm(v.id)
   }
   if(route==='/v1/admin/verify'){
    const v=object(value,['sessionId','receiptId']),cap=lookup(v.sessionId);text(v.receiptId,64)
    const proof=cap.receipts.get(v.receiptId);if(!proof)denied('Receipt does not belong to this session')
    const fence=await verifyRetrievalEvidence(memory.store,cap.authority,proof!,new Set());active(cap);requestActive()
    return{inputFence:fence,resultSha256:proof!.resultSha256}
   }
   return denied('Unknown administrator operation')
  },
  async tool(cap:Capability,route:string,value:unknown,requestActive:()=>void){
   active(cap);requestActive();const params=object(value,[],route==='/v1/tool/search'?['query','cursor','limit','entityId','kind']:route==='/v1/tool/get'?['id','cursor','maxChars']:[])
   const sizing={fits:(result:unknown)=>Buffer.byteLength(canonical(result))<=63000}
   const result=route==='/v1/tool/search'?await cap.reader.search(cap.authority,params,sizing):route==='/v1/tool/get'?await cap.reader.get(cap.authority,params,sizing):denied('Only bounded read tools are available')
   const body=unwrap<unknown>(result),proof=retrievalEvidence(result,cap.authority)
   await verifyRetrievalEvidence(memory.store,cap.authority,proof,new Set());active(cap);requestActive()
   const receiptId=randomBytes(24).toString('hex');if(cap.receipts.size>=128)cap.receipts.delete(cap.receipts.keys().next().value!)
   cap.receipts.set(receiptId,proof);return{result:body,receiptId,resultSha256:proof.resultSha256}
  },
  async close(){closed=true;const failures:unknown[]=[];for(const cap of [...caps.values()])try{await revoke(cap)}catch(error){failures.push(error)}if(failures.length)throw new AggregateError(failures,'Core management shutdown failed')},
 }
}
