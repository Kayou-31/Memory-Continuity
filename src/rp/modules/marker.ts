/** Independent fail-closed configuration marker; never grants story authority. */
import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {canonical,readRpJson} from '../store.js'
import {object,RpError} from '../schema.js'
import type {RuntimeBinding} from './contract.js'
const markerPath=(root:string,session:string)=>path.join(root,'.dsh-rp-policy','v1',createHash('sha256').update(session).digest('hex')+'.json')
export async function runtimeMarkerValid(root:string,session:string,workspace:string,binding:RuntimeBinding):Promise<boolean>{
  try{const m=object(await readRpJson(markerPath(root,session)),['protocol','sessionId','workspaceId','runtimeBindingSha256','runtimeBlocked'])
    return m.protocol==='dsh.session-memory-policy/v1'&&m.sessionId===session&&m.workspaceId===workspace&&m.runtimeBindingSha256===binding.sha256&&m.runtimeBlocked===false
  }catch{return false}
}
export async function writeRuntimeMarker(root:string,session:string,workspace:string,binding:RuntimeBinding|undefined,blocked:boolean){
  const target=markerPath(root,session),tmp=target+'.tmp-'+randomUUID();await fs.mkdir(path.dirname(target),{recursive:true})
  const data={protocol:'dsh.session-memory-policy/v1',sessionId:session,workspaceId:workspace,...(binding?{runtimeBindingSha256:binding.sha256,runtimeBlocked:blocked}:{})}
  try{const h=await fs.open(tmp,'wx',0o600);try{await h.writeFile(canonical(data));await h.sync()}finally{await h.close()};await fs.rename(tmp,target)}
  catch(e){await fs.rm(tmp,{force:true}).catch(()=>{});throw new RpError('persistence_uncertain','Runtime revocation marker was not confirmed: '+(e instanceof Error?e.message:String(e)))}
}
