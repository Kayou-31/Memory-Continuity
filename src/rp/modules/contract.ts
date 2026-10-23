import {createHash} from 'node:crypto'
import {canonical} from '../store.js'
import {cloneInput,id,integer,object,RpError,text} from '../schema.js'

export const MODES = ['rp','companion','creation','project'] as const
export type Purpose = typeof MODES[number]
export type Capability = 'read-person'|'read-records'|'propose-growth'
export interface ModuleManifest {
  protocol:'rp.module/v1'; id:string; version:string; coreVersion:'rp.modules/v1'
  capabilities:readonly Capability[]; output:'person-view'|'records'|'growth-candidate'; modes:readonly Purpose[]; shutdown:'revoke'
}
const manifest=(id:string,capability:Capability,output:ModuleManifest['output']):ModuleManifest=>Object.freeze({protocol:'rp.module/v1',id,version:'1.0.0',coreVersion:'rp.modules/v1',capabilities:Object.freeze([capability]),output,modes:Object.freeze([...MODES]),shutdown:'revoke'})
export const MODULES:readonly ModuleManifest[]=Object.freeze([manifest('person-view','read-person','person-view'),manifest('recall','read-records','records'),manifest('growth-review','propose-growth','growth-candidate')])
export interface Constraints {maxReadRecords:number;maxOutputBytes:number;deniedCapabilities:Capability[];protectedFieldIds:string[];guidance:{id:string;text:string}[]}
export interface RuntimeConfig {mode:Purpose;enabledModules:string[];constraints:Constraints}
export interface RuntimeBinding {protocol:'rp.runtime-binding/v1';registrySha256:string;config:RuntimeConfig;sha256:string}
export const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex')
export const HARD_CONSTRAINTS=Object.freeze({automaticAdoption:false,backgroundExecution:false,externalExecution:false,authority:'host-only',evidence:'original-result-and-fence',guidance:'advisory-not-permission'})
function list(value:unknown,max:number,check:(v:any)=>void):any[]{if(!Array.isArray(value)||value.length>max)throw new RpError('invalid_record','Constraint list limit');value.forEach(check);if(new Set(value.map(v=>canonical(v))).size!==value.length)throw new RpError('invalid_record','Duplicate constraint');return value}
export function runtimeConfig(input:unknown={mode:'rp',enabledModules:[],constraints:{}}):RuntimeConfig {
  const r=object(cloneInput(input),['mode','enabledModules','constraints'])
  if(!MODES.includes(r.mode))throw new RpError('capability_missing','Unknown purpose mode')
  const enabledModules=list(r.enabledModules,MODULES.length,v=>{if(!MODULES.some(m=>m.id===v&&m.modes.includes(r.mode)))throw new RpError('capability_missing','Unknown or incompatible module')}).sort()
  const c=object(r.constraints,[],['maxReadRecords','maxOutputBytes','deniedCapabilities','protectedFieldIds','guidance'])
  const maxReadRecords=c.maxReadRecords??16,maxOutputBytes=c.maxOutputBytes??16384
  integer(maxReadRecords,1);integer(maxOutputBytes,1024)
  if(maxReadRecords>32||maxOutputBytes>32768)throw new RpError('invalid_record','Constraint exceeds hard limit')
  const deniedCapabilities=list(c.deniedCapabilities??[],3,v=>{if(!['read-person','read-records','propose-growth'].includes(v))throw new RpError('capability_missing','Unknown capability')}).sort()
  const protectedFieldIds=list(c.protectedFieldIds??[],64,id).sort()
  const guidance=list(c.guidance??[],16,v=>{object(v,['id','text']);id(v.id);text(v.text,512)})
  if(new Set(guidance.map(g=>g.id)).size!==guidance.length)throw new RpError('invalid_record','Duplicate guidance ID')
  return {mode:r.mode,enabledModules,constraints:{maxReadRecords,maxOutputBytes,deniedCapabilities,protectedFieldIds,guidance:guidance.sort((a,b)=>a.id.localeCompare(b.id))}}
}
export function createRuntimeBinding(input?:unknown):RuntimeBinding {
  const data={protocol:'rp.runtime-binding/v1' as const,registrySha256:digest(MODULES),config:runtimeConfig(input)}
  return {...data,sha256:digest(data)}
}
export function validateRuntimeBinding(input:unknown):asserts input is RuntimeBinding {
  const r=object(input,['protocol','registrySha256','config','sha256'])
  if(canonical(createRuntimeBinding(r.config))!==canonical(r))throw new RpError('capability_missing','Unknown or changed runtime binding')
}
