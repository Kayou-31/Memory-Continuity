/** One verified read view per grant, only for this authentication operation. */
import type {openRpGlobalStore,GlobalFence} from './global.js'
import type {GlobalDependency} from './packet.js'
import {canonical} from './store.js'
import {unwrap} from './retrieval.js'
import {RpError} from './schema.js'
type Store=Awaited<ReturnType<typeof openRpGlobalStore>>['store']
export const globalDependencyKey=(d:GlobalDependency)=>canonical(d)
export async function checkGlobalDependencies(store:Store,authorities:readonly object[],dependencies:readonly GlobalDependency[]){
 const requested=[...new Map(dependencies.map(d=>[globalDependencyKey(d),structuredClone(d)])).values()],valid=new Set<string>(),fences:{authority:object;fence:GlobalFence}[]=[]
 for(const authority of authorities){
  const checked=unwrap(await store.withReadView(authority,async view=>{
   const visible=new Map(view.publications.map(p=>[p.id,p])),heads=new Set(view.active.map(p=>p.id)),found:string[]=[]
   for(const dep of requested){
    const p=visible.get(dep.publicationId)
    if(!p||p.source.id!==dep.sourceId||p.bodySha256!==dep.bodySha256||p.key!==dep.key||canonical(p.scope)!==canonical(dep.scope)||p.scope.kind==='profile'&&!heads.has(p.id))continue
    await view.readPublication(p.id);found.push(globalDependencyKey(dep))
   }
   return {fence:view.fence,found}
  }))
  checked.found.forEach(key=>valid.add(key));fences.push({authority,fence:checked.fence})
 }
 return {valid,async assertCurrent(){for(const {authority,fence}of fences)if(canonical(fence)!==canonical(unwrap(await store.readFence(authority))))throw new RpError('stale_input','Global authentication view changed')}}
}
