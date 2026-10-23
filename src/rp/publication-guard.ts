import {AsyncLocalStorage} from 'node:async_hooks'
const guards=new AsyncLocalStorage<readonly (()=>void)[]>()
/** Trusted callers can only add checks. Nested scopes never remove outer guards. */
export const withPublicationGuard=<T>(guard:()=>void,work:()=>Promise<T>)=>guards.run([...(guards.getStore()??[]),guard],work)
export const assertPublicationAllowed=()=>{for(const guard of guards.getStore()??[])guard()}
