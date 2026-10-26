import {createHash} from 'node:crypto'
import {canonical} from './store.js'
import {object,text,integer,hash,RpError} from './validation.js'
import {DEEPSEEK_MODEL,DEEPSEEK_REVISION,DEEPSEEK_SHA,deepseekTokenizer} from './tokenizers/deepseek.js'
export const MEMORY_LAYERS=['self','situation','relationships','recollection','unfinished'] as const
export type MemoryLayer=typeof MEMORY_LAYERS[number]
export interface ModelTarget {provider:string;model:string}
export interface MeterIdentity {id:'deepseek-v3.2'|'utf8';revision:string;mode:'tokenizer-text'|'conservative-utf8'}
export interface MemoryBudgetV2 {protocol:'memcont.memory-budget/v2';unit:'tokens';limitTokens:number;target:ModelTarget;meter:MeterIdentity;layers:Record<MemoryLayer,number>;sha256:string}
export interface MemoryPart {kind:string;text:string;id?:string}
export interface MemoryUsage {protocol:'memcont.memory-usage/v2';budgetSha256:string;mode:MeterIdentity['mode'];total:number;limit:number;bytes:number;parts:{kind:string;id?:string;count:number;bytes:number}[];sha256:string}
export interface MemoryMeter {readonly budget:MemoryBudgetV2;readonly identity:MeterIdentity;count:(value:string)=>number}
const issued=new WeakSet<object>()
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex')
const targetValue=(value:ModelTarget)=>{const v=object(value,['provider','model']);text(v.provider,256);text(v.model,256);return {provider:v.provider as string,model:v.model as string}}
export function createMemoryBudget(target:ModelTarget,input:unknown={}):MemoryBudgetV2{
  target=targetValue(target)
  const v=object(structuredClone(input),[],['limitTokens','tokenizer','layers']),limitTokens=v.limitTokens??32768;integer(limitTokens,1)
  if(limitTokens>32768)throw new RpError('invalid_record','Memory budget cannot exceed 32768 tokens')
  const name=v.tokenizer??'auto';if(!['auto','deepseek-v3.2','utf8'].includes(name))throw new RpError('invalid_record','Unknown tokenizer')
  if(name==='deepseek-v3.2'&&target.model!==DEEPSEEK_MODEL)throw new RpError('capability_missing','Tokenizer does not match the exact model identity')
  const meter:MeterIdentity=name!=='utf8'&&target.model===DEEPSEEK_MODEL?{id:'deepseek-v3.2',revision:DEEPSEEK_REVISION+':'+DEEPSEEK_SHA+':hf-js-0.2.0',mode:'tokenizer-text'}:{id:'utf8',revision:'utf8-bytes/v1',mode:'conservative-utf8'}
  const defaults={self:6144,situation:4096,relationships:4096,recollection:12288,unfinished:4096},raw=object(v.layers??{},[],MEMORY_LAYERS),layers={...defaults}
  for(const layer of MEMORY_LAYERS){layers[layer]=raw[layer]??Math.min(defaults[layer],limitTokens);integer(layers[layer]);if(layers[layer]>limitTokens)throw new RpError('invalid_record','Layer tokens exceed total budget')}
  const data={protocol:'memcont.memory-budget/v2' as const,unit:'tokens' as const,limitTokens,target,meter,layers};return {...data,sha256:digest(data)}
}
export function validateMemoryBudget(input:unknown):asserts input is MemoryBudgetV2{
  const b=object(input,['protocol','unit','limitTokens','target','meter','layers','sha256']);hash(b.sha256)
  if(canonical(createMemoryBudget(b.target,{limitTokens:b.limitTokens,tokenizer:b.meter?.id,layers:b.layers}))!==canonical(b))throw new RpError('store_corrupt','Memory budget identity or units changed')
}
export async function openMemoryMeter(budget:MemoryBudgetV2,actual:ModelTarget):Promise<MemoryMeter>{
  validateMemoryBudget(budget);if(canonical(targetValue(actual))!==canonical(budget.target))throw new RpError('stale_input','Model changed; explicitly rebind memory budget in a clean session')
  const snapshot=structuredClone(budget),tokenizer=snapshot.meter.id==='deepseek-v3.2'?await deepseekTokenizer():undefined
  Object.freeze(snapshot.target);Object.freeze(snapshot.meter);Object.freeze(snapshot.layers);Object.freeze(snapshot)
  const meter=Object.freeze({budget:snapshot,identity:snapshot.meter,count:(value:string)=>{text(value,4_194_304,true);return tokenizer?tokenizer.encode(value,{add_special_tokens:false}).ids.length:Buffer.byteLength(value,'utf8')}})
  issued.add(meter);return meter
}
export function measureMemoryParts(parts:readonly MemoryPart[],meter:MemoryMeter,enforce=true):MemoryUsage{
  if(!issued.has(meter))throw new RpError('scope_denied','Unrecognized memory meter')
  if(parts.length>8192)throw new RpError('context_budget_exceeded','Too many retained memory fragments')
  const measured=parts.map(p=>({kind:p.kind,...(p.id?{id:p.id}:{}),count:meter.count(p.text),bytes:Buffer.byteLength(p.text,'utf8')})),total=measured.reduce((n,p)=>n+p.count,0)
  const base={protocol:'memcont.memory-usage/v2' as const,budgetSha256:meter.budget.sha256,mode:meter.identity.mode,total,limit:meter.budget.limitTokens,bytes:measured.reduce((n,p)=>n+p.bytes,0),parts:measured}
  if(enforce&&total>base.limit)throw new RpError('context_budget_exceeded',`Memory needs ${total}/${base.limit} ${base.mode==='tokenizer-text'?'tokenizer tokens':'conservative UTF-8 units'}; retained history may need explicit clean continuation`)
  return {...base,sha256:digest(base)}
}
