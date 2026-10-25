import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {canonical,readRpJson} from './store.js'
import {hash,id,integer,object,RpError,fence,text,sourceSpan} from './schema.js'
import {digest,injectionConfig,LAYERS,DEPTHS,type InjectionConfig,type InjectionTrace} from './injection.js'
export interface InjectionBinding {protocol:'rp.injection-binding/v1';config:InjectionConfig;sha256:string}
export function createInjectionBinding(value:unknown={}):InjectionBinding {const data={protocol:'rp.injection-binding/v1' as const,config:injectionConfig(value)};return {...data,sha256:digest(data)}}
export function validateInjectionBinding(value:unknown):asserts value is InjectionBinding{const b=object(value,['protocol','config','sha256']);if(canonical(createInjectionBinding(b.config))!==canonical(b))throw new RpError('store_corrupt','Injection binding does not match original config')}
export function validateInjectionTrace(value:unknown):asserts value is InjectionTrace{
 const t=object(value,['protocol','configSha256','query','querySha256','lexicalTermsTruncated','context','fence','entries','renderedSha256','sha256']);hash(t.configSha256);hash(t.querySha256);hash(t.renderedSha256);hash(t.sha256);text(t.query,1048576,true);fence(t.fence);if(typeof t.lexicalTermsTruncated!=='boolean')throw new RpError('store_corrupt','Lexical limit marker missing')
 const c=object(t.context,['personId','branchId','sceneId','acceptedSeq','mode','inputSourceId']);id(c.personId);id(c.branchId);if(c.sceneId!==null)id(c.sceneId);if(c.inputSourceId!==null)id(c.inputSourceId);integer(c.acceptedSeq);if(!['rp','companion','creation','project'].includes(c.mode))throw new RpError('store_corrupt','Injection mode')
 if(!Array.isArray(t.entries)||t.entries.length>4096)throw new RpError('store_corrupt','Injection trace entries')
 const seen=new Set<string>();for(const entry of t.entries){const e=object(entry,['id','kind','revision','bodySha256','layer','depth','selected','mandatory','reasons','bytes','sourceIds'],['sourceSpan','recordId']);id(e.id);hash(e.revision);hash(e.bodySha256);integer(e.bytes);if(seen.has(e.id)||!['event','summary','document','diary'].includes(e.kind)||!LAYERS.includes(e.layer)||!DEPTHS.includes(e.depth)||typeof e.selected!=='boolean'||typeof e.mandatory!=='boolean'||!Array.isArray(e.reasons)||!e.reasons.length||e.reasons.some((r:unknown)=>!['mandatory','excluded','pinned','rule_matched','relevant','condition_not_matched','budget_exceeded'].includes(r as string))||!Array.isArray(e.sourceIds)||e.sourceIds.length>256)throw new RpError('store_corrupt','Injection entry');seen.add(e.id);e.sourceIds.forEach(id)
  if(e.kind==='document'||e.kind==='diary'){id(e.recordId);sourceSpan(e.sourceSpan);if(e.sourceIds.length!==1||e.sourceIds[0]!==e.sourceSpan.sourceRevisionId||e.mandatory)throw new RpError('store_corrupt','Document injection proof')}
  else if(e.sourceSpan!==undefined||e.recordId!==undefined)throw new RpError('store_corrupt','Unexpected document locator')
 }
 const {sha256,...data}=t;if(t.protocol!=='rp.injection-snapshot/v1'||t.querySha256!==digest(t.query)||sha256!==digest(data)||c.branchId!==t.fence.branchId)throw new RpError('store_corrupt','Injection trace digest mismatch')
}
/** Bind diagnostic evidence to the original authenticated host text, never a fresh reconstruction. */
export function verifyInjectionText(trace:InjectionTrace,body:string){
 validateInjectionTrace(trace)
 const fragments=body.matchAll(/"personContinuity":(\{"personId":"[a-zA-Z0-9_-]+","snapshotId":"[a-f0-9]{64}","text":"(?:[^"\\]|\\.)*"\})/gu)
 for(const fragment of fragments){const p=JSON.parse(fragment[1]);if(p.personId===trace.context.personId&&p.snapshotId===trace.sha256&&digest(p.text)===trace.renderedSha256)return}
 throw new RpError('stale_input','Historical selection does not match the original host packet text')
}
const markerPath=(root:string,session:string)=>path.join(root,createHash('sha256').update(session).digest('hex')+'.injection.json')
export async function injectionMarkerValid(root:string,session:string,binding:InjectionBinding|undefined){
 try{const m=object(await readRpJson(markerPath(root,session)),['protocol','sessionId','bindingSha256','blocked']);return m.protocol==='rp.injection-owner/v1'&&m.sessionId===session&&m.bindingSha256===(binding?.sha256??null)&&m.blocked===false}
 catch(e){return !binding&&(e as NodeJS.ErrnoException).code==='ENOENT'}
}
export async function writeInjectionMarker(root:string,session:string,binding:InjectionBinding|undefined,blocked:boolean){
 const target=markerPath(root,session),tmp=target+'.tmp-'+randomUUID()
 try{const h=await fs.open(tmp,'wx',0o600);try{await h.writeFile(canonical({protocol:'rp.injection-owner/v1',sessionId:session,bindingSha256:binding?.sha256??null,blocked}));await h.sync()}finally{await h.close()};await fs.rename(tmp,target)}catch(e){await fs.rm(tmp,{force:true}).catch(()=>{});throw new RpError('persistence_uncertain','Injection marker publication unconfirmed: '+(e instanceof Error?e.message:String(e)))}
}
