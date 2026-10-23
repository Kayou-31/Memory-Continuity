/** Explicit, bounded physical layout. Logical global State and history hashes stay v1. */
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {canonical,readRpJson} from './store.js'
import {object,hash,id,checkedRpJson,RpError} from './schema.js'

const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex')
export const SEGMENT_FORMAT='rp.global-segments/v1'
export const SEGMENT_PUBLISH_BYTES=8*1024*1024,SEGMENT_CONTROL_BYTES=12*1024*1024
const PAGE_BYTES=256*1024,MAX_PAGES=128
export interface SegmentLayout{backupId:string;backupSha256:string}
interface State{fence:unknown;publications:unknown[];keys:Record<string,unknown>;previousHash:string;seq:number}
type Atomic=(file:string,body:string)=>Promise<void>
const regular=async(file:string,directory=false)=>{const s=await fs.lstat(file);if(s.isSymbolicLink()||!(directory?s.isDirectory():s.isFile()))throw new RpError('store_corrupt','Global storage requires regular files/directories')}
export async function readSegmentState(dir:string,input:unknown,cache:Map<string,unknown>){
 const d=object(input,['format','header','publications','keys','sha256','backup']),h=object(d.header,['fence','previousHash','seq']),backup=object(d.backup,['backupId','backupSha256'])
 if(d.format!==SEGMENT_FORMAT)throw new RpError('store_corrupt','Unknown global layout')
 id(backup.backupId);hash(backup.backupSha256);hash(d.sha256)
 await regular(path.join(dir,'segments'),true)
 const read=async(refs:unknown)=>{
  if(!Array.isArray(refs)||refs.length>MAX_PAGES)throw new RpError('store_corrupt','Global segment count')
  const result:unknown[]=[]
  for(const ref of refs){hash(ref);let page=cache.get(ref);if(page===undefined){const file=path.join(dir,'segments',ref+'.json');await regular(file);page=await readRpJson(file);const encoded=canonical(page);if(Buffer.byteLength(encoded)>PAGE_BYTES||sha(encoded)!==ref||!Array.isArray(page)||page.length===0)throw new RpError('store_corrupt','Global segment hash/schema');cache.set(ref,page)}result.push(...page as unknown[])}
  return result
 }
 const publications=await read(d.publications),entries=await read(d.keys),keys:Record<string,unknown>=Object.create(null)
 for(const entry of entries){if(!Array.isArray(entry)||entry.length!==2)throw new RpError('store_corrupt','Global key segment');hash(entry[0]);if(Object.hasOwn(keys,entry[0]))throw new RpError('store_corrupt','Duplicate global key');keys[entry[0]]=entry[1]}
 const state={...h,publications,keys} as State
 checkedRpJson({state,sha256:d.sha256},canonical,SEGMENT_CONTROL_BYTES,8192)
 return {state,sha256:d.sha256 as string,layout:backup as SegmentLayout}
}
export function encodeSegments(state:State,layout:SegmentLayout){
 const pages=new Map<string,string>()
 const pack=(values:unknown[])=>{
  const refs:string[]=[];let page:unknown[]=[],size=2
  const flush=()=>{if(!page.length)return;const encoded=canonical(page),ref=sha(encoded);pages.set(ref,encoded);refs.push(ref);page=[];size=2}
  for(const item of values){const bytes=Buffer.byteLength(canonical(item));if(bytes+2>PAGE_BYTES)throw new RpError('capacity_exceeded','Global item exceeds segment size');if(size+bytes+(page.length?1:0)>PAGE_BYTES)flush();size+=bytes+(page.length?1:0);page.push(item)}flush()
  if(refs.length>MAX_PAGES)throw new RpError('capacity_exceeded','Global segment count limit');return refs
 }
 const descriptor={format:SEGMENT_FORMAT,header:{fence:state.fence,previousHash:state.previousHash,seq:state.seq},publications:pack(state.publications),keys:pack(Object.entries(state.keys)),sha256:sha(canonical(state)),backup:layout}
 return {encoded:checkedRpJson(descriptor,canonical,64*1024),pages}
}
export async function writeSegments(dir:string,pages:Map<string,string>,atomic:Atomic){
 const root=path.join(dir,'segments');await fs.mkdir(root,{recursive:true});await regular(root,true)
 for(const [ref,bytes]of pages){const file=path.join(root,ref+'.json');try{await regular(file);if(await fs.readFile(file,'utf8')!==bytes)throw new RpError('store_corrupt','Existing global segment differs')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;await atomic(file,bytes)}}
}
export async function backupGlobal(root:string,dir:string,state:State,atomic:Atomic):Promise<SegmentLayout>{
 const backupId='backup_'+randomUUID().replaceAll('-',''),target=path.join(root,'backups','global',backupId),files:{path:string;sha256:string;bytes:number}[]=[]
 for(const p of state.publications as {deleted:boolean;bodySha256:string;source:{id:string;blobId:string;publicTextLengthUtf16:number}}[]){
  if(p.deleted)continue
  const file=path.join(dir,'blobs',p.source.id,p.source.blobId+'.txt')
  try{await regular(path.dirname(file),true);await regular(file);const body=await fs.readFile(file);if(sha(body)!==p.bodySha256||body.toString('utf8').length!==p.source.publicTextLengthUtf16)throw new RpError('store_corrupt','Global backup source hash/length mismatch')}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')throw new RpError('store_corrupt','Global backup source missing');throw e}
 }
 for(const directory of [path.join(root,'backups'),path.join(root,'backups','global'),target]){await fs.mkdir(directory,{recursive:true});await regular(directory,true)}
 const copy=async(source:string,relative:string)=>{await regular(source);const body=await fs.readFile(source),destination=path.join(target,relative);await fs.mkdir(path.dirname(destination),{recursive:true});const handle=await fs.open(destination,'wx',0o600);try{await handle.writeFile(body);await handle.sync()}finally{await handle.close()}if(!body.equals(await fs.readFile(destination)))throw new RpError('persistence_failed','Backup verification failed');files.push({path:relative,sha256:sha(body),bytes:body.length})}
 const tree=async(source:string,relative:string)=>{await regular(source,true);for(const item of await fs.readdir(source,{withFileTypes:true})){if(item.isSymbolicLink()||(!item.isFile()&&!item.isDirectory()))throw new RpError('store_corrupt','Unsafe global backup entry');const rel=path.join(relative,item.name);if(item.isDirectory())await tree(path.join(source,item.name),rel);else await copy(path.join(source,item.name),rel)}}
 await copy(path.join(root,'identity.json'),'identity.json')
 for(const name of ['commits','blobs']){let exists=true;try{await regular(path.join(dir,name),true)}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;if(name==='commits'&&state.seq>0)throw e;exists=false}if(exists)await tree(path.join(dir,name),name)}
 if(state.seq>0)await copy(path.join(dir,'seal.json'),'seal.json')
 // Re-read the originals before completing the manifest. A partial directory is never a completed backup.
 for(const f of files){const source=f.path==='identity.json'?path.join(root,f.path):path.join(dir,f.path);if(sha(await fs.readFile(source))!==f.sha256)throw new RpError('stale_input','Global files changed during backup')}
 const manifest=canonical({format:'rp.global-backup/v1',scope:(state.fence as any).scope,seq:state.seq,stateSha256:sha(canonical(state)),files})
 await atomic(path.join(target,'manifest.json'),manifest)
 return {backupId,backupSha256:sha(manifest)}
}
