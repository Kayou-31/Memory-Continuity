/** Cooperative ownership for the official embedded and service entry points. */
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {canonical} from '../rp/store.js'
import {RpError,object} from '../rp/validation.js'

type Kind='embedded-dsh'|'service'|'application'
type Evidence={schemaVersion:1;type:'owner'|'recovery';rootHash:string;pid:number;nonce:string;createdAt:string;kind?:Kind;ownerSha256?:string;previousHash?:string;sequence?:number}
const sha=(body:string)=>createHash('sha256').update(body).digest('hex')
function fail(code:'store_locked'|'store_corrupt'|'stale_input'|'ownership_lost',message:string):never{throw new RpError(code,message)}
const isMissing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT'
function processState(pid:number):'alive'|'dead'|'unknown'{try{process.kill(pid,0);return'alive'}catch(error){return(error as NodeJS.ErrnoException).code==='ESRCH'?'dead':'unknown'}}
async function location(profileRoot:string,create=false){
 const absolute=path.resolve(profileRoot)
 if(create)await fs.mkdir(absolute,{recursive:true})
 const real=await fs.realpath(absolute),normalized=(p:string)=>process.platform==='win32'?p.toLowerCase():p
 if(normalized(real)!==normalized(absolute)||(await fs.lstat(absolute)).isSymbolicLink())fail('ownership_lost','Profile aliases cannot create a second writer')
 const directory=path.join(real,'.memory-continuity-owner')
 if(create)await fs.mkdir(directory,{recursive:true})
 try{const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())fail('store_corrupt','Owner directory is not a real directory')}catch(error){if(!isMissing(error))throw error}
 return{directory,file:path.join(directory,'owner.lock'),rootHash:sha(normalized(real))}
}
async function readEvidence(file:string,type:Evidence['type'],rootHash:string){
 const stat=await fs.lstat(file)
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)fail('store_corrupt','Owner evidence is not a bounded regular file')
 const body=await fs.readFile(file,'utf8')
 try{
  const envelope=object(JSON.parse(body),['record','sha256']),record=object(envelope.record,type==='owner'?['schemaVersion','type','rootHash','pid','nonce','createdAt','kind']:['schemaVersion','type','rootHash','pid','nonce','createdAt','ownerSha256','previousHash','sequence']) as Evidence
  if(record.schemaVersion!==1||record.type!==type||record.rootHash!==rootHash||!Number.isSafeInteger(record.pid)||record.pid<1||!/^[a-f0-9-]{36}$/.test(record.nonce)||!Number.isFinite(Date.parse(record.createdAt))||envelope.sha256!==sha(canonical(record)))throw new Error('invalid owner evidence')
  if(type==='owner'&&!['embedded-dsh','service','application'].includes(record.kind!))throw new Error('invalid owner kind')
  if(type==='recovery'&&(!/^[a-f0-9]{64}$/.test(record.ownerSha256!)||!/^[a-f0-9]{64}$/.test(record.previousHash!)||!Number.isSafeInteger(record.sequence)||record.sequence!<1||record.sequence!>128))throw new Error('invalid recovery chain')
  return{record,sha256:sha(body)}
 }catch{fail('store_corrupt','Owner evidence failed schema/hash verification; retain it for diagnosis')}
}
/** Publish a complete fsynced descriptor with no empty-lock crash window. */
async function exclusive(file:string,record:Evidence){
 const candidate=path.join(path.dirname(file),'.candidate-'+randomUUID()),body=canonical({record,sha256:sha(canonical(record))})
 try{
  const handle=await fs.open(candidate,'wx',0o600)
  try{await handle.writeFile(body);await handle.sync()}finally{await handle.close()}
  await fs.link(candidate,file)
  return sha(body)
 }finally{await fs.unlink(candidate).catch(()=>{})}
}
export async function inspectProfileOwner(profileRoot:string){
 const loc=await location(profileRoot)
 try{const evidence=await readEvidence(loc.file,'owner',loc.rootHash);return{owner:evidence.record,sha256:evidence.sha256,process:processState(evidence.record.pid)}}catch(error){if(isMissing(error))return null;throw error}
}
export async function acquireProfileOwner(input:{profileRoot:string;kind:Kind}){
 if(!['embedded-dsh','service','application'].includes(input.kind))fail('ownership_lost','Unknown profile owner kind')
 const loc=await location(input.profileRoot,true),record:Evidence={schemaVersion:1,type:'owner',rootHash:loc.rootHash,pid:process.pid,nonce:randomUUID(),createdAt:new Date().toISOString(),kind:input.kind}
 let digest:string
 try{digest=await exclusive(loc.file,record)}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')fail('store_locked','Profile already has an owner; stop it or inspect and explicitly recover a verified dead owner');throw error}
 let released=false,releasePromise:Promise<void>|undefined
 return Object.freeze({
  assertActive(){if(released||releasePromise)fail('ownership_lost','Profile owner is closed')},
  release(){
   if(releasePromise)return releasePromise
   releasePromise=(async()=>{if(released)return;const current=await readEvidence(loc.file,'owner',loc.rootHash);if(current.sha256!==digest)fail('ownership_lost','Profile owner changed; refusing to unlink another owner');await fs.unlink(loc.file);released=true})()
   return releasePromise
  },
 })
}
/** Administrator-only: no age timeout, force flag or automatic stale-lock removal. */
export async function recoverProfileOwner(profileRoot:string,expectedSha256:string):Promise<'recovered'|'unlocked'>{
 if(!/^[a-f0-9]{64}$/.test(expectedSha256))fail('stale_input','A verified owner digest is required for recovery')
 const loc=await location(profileRoot)
 let owner:Awaited<ReturnType<typeof readEvidence>>
 try{owner=await readEvidence(loc.file,'owner',loc.rootHash)}catch(error){if(isMissing(error))return'unlocked';throw error}
 if(owner.sha256!==expectedSha256)fail('stale_input','Owner changed since inspection; inspect it again')
 if(processState(owner.record.pid)!=='dead')fail('store_locked','Owner process is alive or its death cannot be verified')
 // Immutable claims serialize recovery itself. A crashed recovery never needs
 // an unsafe timeout or a recursive lock steal: the next verified claim extends it.
 const prefix='recovery-'+owner.record.nonce+'-',names=(await fs.readdir(loc.directory)).filter(name=>name.startsWith(prefix)).sort()
 let previousHash=owner.sha256,sequence=0,last:Evidence|undefined
 for(const name of names){
  if(name!==prefix+String(sequence+1).padStart(3,'0')+'.json')fail('store_corrupt','Recovery chain has missing or unexpected entries')
  const claim=await readEvidence(path.join(loc.directory,name),'recovery',loc.rootHash)
  if(claim.record.ownerSha256!==owner.sha256||claim.record.previousHash!==previousHash||claim.record.sequence!==sequence+1)fail('store_corrupt','Recovery chain hash mismatch')
  last=claim.record;previousHash=claim.sha256;sequence++
 }
 if(last&&processState(last.pid)!=='dead')fail('store_locked','Another recovery process is alive or unverifiable')
 if(sequence>=128)fail('store_locked','Recovery evidence limit reached; retain history for diagnosis')
 const claim:Evidence={schemaVersion:1,type:'recovery',rootHash:loc.rootHash,pid:process.pid,nonce:randomUUID(),createdAt:new Date().toISOString(),ownerSha256:owner.sha256,previousHash,sequence:sequence+1}
 try{await exclusive(path.join(loc.directory,prefix+String(sequence+1).padStart(3,'0')+'.json'),claim)}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')fail('store_locked','Concurrent recovery won the claim; inspect again');throw error}
 const current=await readEvidence(loc.file,'owner',loc.rootHash)
 if(current.sha256!==owner.sha256)fail('stale_input','Owner changed while recovery was being claimed')
 if(processState(owner.record.pid)!=='dead')fail('store_locked','Owner process death cannot be verified at recovery publication')
 await fs.unlink(loc.file)
 return'recovered'
}
