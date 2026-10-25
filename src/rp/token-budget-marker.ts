import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {canonical,readRpJson} from './store.js'
import {object,RpError} from './validation.js'
import type {MemoryBudgetV2} from './token-budget.js'
const location=(root:string,session:string)=>path.join(root,createHash('sha256').update(session).digest('hex')+'.budget.json')
export async function budgetMarkerValid(root:string,session:string,budget:MemoryBudgetV2|undefined){
  try{const m=object(await readRpJson(location(root,session)),['protocol','sessionId','bindingSha256','blocked']);return m.protocol==='memcont.budget-owner/v2'&&m.sessionId===session&&m.bindingSha256===(budget?.sha256??null)&&m.blocked===false}
  catch(e){return !budget&&(e as NodeJS.ErrnoException).code==='ENOENT'}
}
export async function writeBudgetMarker(root:string,session:string,budget:MemoryBudgetV2|undefined,blocked:boolean){
  const target=location(root,session),tmp=target+'.tmp-'+randomUUID()
  try{const h=await fs.open(tmp,'wx',0o600);try{await h.writeFile(canonical({protocol:'memcont.budget-owner/v2',sessionId:session,bindingSha256:budget?.sha256??null,blocked}));await h.sync()}finally{await h.close()};await fs.rename(tmp,target)}
  catch(e){await fs.rm(tmp,{force:true}).catch(()=>{});throw new RpError('persistence_uncertain','Memory budget publication unconfirmed: '+(e instanceof Error?e.message:String(e)))}
}
