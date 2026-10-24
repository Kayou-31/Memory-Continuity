/** Deterministic model-facing selection. All inputs must come from one authorized read view. */
import {createHash} from 'node:crypto'
import {canonical,type RpReadView} from './store.js'
import {id,integer,object,RpError,text} from './schema.js'
import {projectPerson} from './person/projection.js'
import {personValue} from './person/format.js'
import {growthValue,goalValue} from './growth-format.js'
import {semanticProtocol} from './semantic-registry.js'
import type {InputFence,SemanticEvent,Summary} from './types.js'

export const LAYERS=['self','situation','relationships','recollection','unfinished'] as const
export const DEPTHS=['overview','association','evidence'] as const
export type Layer=typeof LAYERS[number]
export type Depth=typeof DEPTHS[number]
type When={modes?:string[];persons?:string[];branches?:string[];scenes?:string[];entities?:string[];terms?:string[];recall?:boolean}
export interface InjectionConfig {depth:Depth;budgets:Record<Layer,number>;pin:string[];exclude:string[];aliases:Record<string,string[]>;rules:{layer:Layer;when:When;depth:Depth}[]}
export const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex')
export function injectionConfig(input:unknown={}):InjectionConfig{
 const v=object(structuredClone(input),[],['depth','budgets','pin','exclude','aliases','rules'])
 if(Buffer.byteLength(canonical(v),'utf8')>32768)throw new RpError('invalid_record','Injection configuration exceeds 32 KiB')
 const depth=(x:unknown):Depth=>{if(!DEPTHS.includes(x as Depth))throw new RpError('invalid_record','Unknown injection depth');return x as Depth}
 const list=(x:unknown,max:number,ids=false):string[]=>{if(!Array.isArray(x)||x.length>max||new Set(x).size!==x.length)throw new RpError('invalid_record','Invalid injection list');x.forEach(s=>ids?id(s):text(s,128));return x}
 const budgets={self:2400,situation:2400,relationships:2400,recollection:4800,unfinished:2400},raw=object(v.budgets??{},[],LAYERS)
 for(const layer of LAYERS)if(raw[layer]!==undefined){integer(raw[layer]);if(raw[layer]>65536)throw new RpError('invalid_record','Layer budget exceeds 64 KiB');budgets[layer]=raw[layer]}
 const aliases=object(v.aliases??{},[],Object.keys(v.aliases??{}));if(Object.keys(aliases).length>64)throw new RpError('invalid_record','Too many entity aliases')
 for(const [key,value]of Object.entries(aliases)){id(key);list(value,8)}
 if(!Array.isArray(v.rules??[])||(v.rules??[]).length>32)throw new RpError('invalid_record','Too many injection rules')
 const rules=(v.rules??[]).map((rule:unknown)=>{const r=object(rule,['layer','when'],['depth']);if(!LAYERS.includes(r.layer))throw new RpError('invalid_record','Unknown memory layer');const w=object(r.when,[],['modes','persons','branches','scenes','entities','terms','recall']);for(const [key,value]of Object.entries(w)){if(key==='recall'){if(typeof value!=='boolean')throw new RpError('invalid_record','Invalid recall condition')}else{list(value,32,!['modes','terms'].includes(key));if(key==='modes'&&(value as string[]).some(m=>!['rp','companion','creation','project'].includes(m)))throw new RpError('invalid_record','Unknown purpose')}}return {layer:r.layer,when:w,depth:depth(r.depth??v.depth??'association')}})
 return {depth:depth(v.depth??'association'),budgets,pin:list(v.pin??[],256,true),exclude:list(v.exclude??[],256,true),aliases,rules}
}
export interface InjectionEntry {id:string;kind:'event'|'summary';revision:string;bodySha256:string;layer:Layer;depth:Depth;selected:boolean;mandatory:boolean;reasons:string[];bytes:number;sourceIds:string[]}
export interface InjectionTrace {protocol:'rp.injection-snapshot/v1';configSha256:string;query:string;querySha256:string;lexicalTermsTruncated:boolean;context:{personId:string;branchId:string;sceneId:string|null;acceptedSeq:number;mode:string;inputSourceId:string|null};fence:InputFence;entries:InjectionEntry[];renderedSha256:string;sha256:string}
const labels:Record<Layer,string>={self:'我是谁',situation:'此刻的处境',relationships:'我与重要的人',recollection:'与此有关的往事',unfinished:'尚未完成的事'}
const normal=(v:string)=>v.normalize('NFKC').toLowerCase()
// Bounded lexical matching, not a semantic score. No regular expression from configuration.
function terms(query:string){const values=new Set<string>();let truncated=false;const add=(t:string)=>{if(t.length<2||values.has(t))return;if(values.size<128)values.add(t);else truncated=true};for(const run of normal(query).match(/\p{Script=Han}+|[\p{L}\p{N}_-]+/gu)??[]){if(/^\p{Script=Han}+$/u.test(run)){const chars=[...run];for(let i=0;i<chars.length-1;i++)add(chars[i]+chars[i+1])}else add(run)}return {values:[...values],truncated}}
const epistemic=(e:SemanticEvent)=>personValue(e)?.kind==='feeling'?'感受记录（非客观世界断言）':e.epistemic==='world'?'事实':e.epistemic==='belief'?'信念（持有者 '+e.beliefHolderId+'）':e.epistemic==='utterance'?'曾表达的说法':'未确定'
type Candidate={record:SemanticEvent|Summary;kind:'event'|'summary';layer:Layer;line:string;search:string;entities:string[];mandatory:boolean;defaultMatch:boolean;rank:number;sources:string[]}

export async function planInjection(view:RpReadView,input:{personId:string;query:string;config:InjectionConfig;mode:string;inputSourceId?:string;optionalBytes:number}){
 const {config,personId}=input,person=projectPerson(view,personId),events=new Map(view.events.map(e=>[e.id,e])),query=normal(input.query),lexical=terms(input.query),tokens=lexical.values,recall=/回忆|记得|往事|之前|过去|remember|recall/iu.test(query)
 const mentioned=new Set(Object.entries(config.aliases).filter(([id,aliases])=>[id,...aliases].some(a=>query.includes(normal(a)))).map(([id])=>id))
 const mentions=(ids:readonly string[])=>ids.some(id=>mentioned.has(id)||query.includes(normal(id)))
 const related=(body:string)=>tokens.some(t=>normal(body).includes(t))
 const candidates:Candidate[]=[],classified=new Set<string>()
 const add=(e:SemanticEvent,layer:Layer,line:string,entities:string[],mandatory:boolean,match:boolean,rank:number)=>{classified.add(e.id);candidates.push({record:e,kind:'event',layer,line,search:line,entities,mandatory,defaultMatch:match,rank,sources:e.sources.map(s=>s.sourceRevisionId)})}
 for(const f of person.fields){const e=events.get(f.eventId)!,mandatory=['identity','values','boundaries','voice'].includes(f.kind),layer=f.kind==='feeling'||f.kind==='stage'?'situation':'self';add(e,layer,(f.kind==='feeling'?'当时的感受':f.kind==='stage'?'人生阶段':({identity:'身份',values:'价值观',boundaries:'边界',voice:'表达',background:'背景',trait:'性格'}[f.kind]??f.kind))+'：'+f.value,[personId],mandatory,mandatory||layer==='situation'||related(f.value),50)}
 for(const r of person.relationships){const e=events.get(r.supportEventIds[0]);if(!e)throw new RpError('source_unavailable','Relationship proof missing');add(e,'relationships',r.fromId+' → '+r.toId+'，'+r.relation+'：'+canonical(r.value)+(r.unresolvedTension?'；尚未解决：'+r.unresolvedTension:''),[r.toId],r.resolution==='conflict'||!!r.unresolvedTension,mentions([r.toId])||related(canonical(r.value)),40)}
 for(const g of person.goals){const e=events.get(g.supportEventIds[0]);if(!e||growthValue(e)?.channel!=='goal')continue;const goal=goalValue(g.value),active=goal.status==='active';add(e,'unfinished',(goal.category==='promise'?'承诺':'目标')+'：'+goal.objective+'；状态 '+({active:'进行中',paused:'暂停',completed:'已完成',abandoned:'已放弃'}[goal.status])+'；进度 '+goal.progress+'%；下一步 '+goal.nextAction+(goal.targetEntityId?'；对象 '+goal.targetEntityId:''),goal.targetEntityId?[goal.targetEntityId]:[],g.resolution==='conflict',active||related(goal.objective)||!!goal.targetEntityId&&mentions([goal.targetEntityId]),active?45:10)}
 for(const e of view.events){if(e.payload.kind!=='occurrence'||semanticProtocol(e)==='person-origin/v1')continue;add(e,'recollection',e.payload.description,[...e.payload.actorIds],false,related(e.payload.description)||recall&&mentions(e.payload.actorIds),related(e.payload.description)?30:20)}
 for(const s of view.summaries)candidates.push({record:s,kind:'summary',layer:'recollection',line:s.text,search:s.text,entities:[],mandatory:false,defaultMatch:related(s.text),rank:25,sources:[...s.sourceRevisionIds]})
 candidates.sort((a,b)=>Number(b.mandatory)-Number(a.mandatory)||Number(config.pin.includes(b.record.id))-Number(config.pin.includes(a.record.id))||b.rank-a.rank||a.record.id.localeCompare(b.record.id))
 const context={personId,branchId:view.fence.branchId,sceneId:view.context.sceneId??null,acceptedSeq:view.context.acceptedSeq,mode:input.mode,inputSourceId:input.inputSourceId??null}
 const matches=(w:When,c:Candidate)=>(!w.modes||w.modes.includes(context.mode))&&(!w.persons||w.persons.includes(personId))&&(!w.branches||w.branches.includes(context.branchId))&&(!w.scenes||w.scenes.includes(context.sceneId??''))&&(!w.entities||w.entities.some(e=>c.entities.includes(e)&&mentions([e])))&&(!w.terms||w.terms.some(t=>query.includes(normal(t))))&&(w.recall===undefined||w.recall===recall)
 const used=Object.fromEntries(LAYERS.map(l=>[l,0])) as Record<Layer,number>,sections:Record<Layer,string[]>={self:[],situation:[],relationships:[],recollection:[],unfinished:[]},entries:InjectionEntry[]=[],selectedSummaries:Summary[]=[]
 let remaining=Math.max(0,input.optionalBytes)
 for(const c of candidates){const rules=config.rules.filter(r=>r.layer===c.layer),rule=rules.find(r=>matches(r.when,c)),pinned=config.pin.includes(c.record.id),excluded=config.exclude.includes(c.record.id),eligible=c.mandatory||pinned||(rules.length?!!rule:c.defaultMatch),depth=c.mandatory?'association':rule?.depth??config.depth
  if(excluded&&c.mandatory)throw new RpError('scope_denied','Cannot exclude mandatory identity, boundary or conflict: '+c.record.id)
  const reasons:string[]=[c.mandatory?'mandatory':excluded?'excluded':pinned?'pinned':eligible?(rule?'rule_matched':'relevant'):'condition_not_matched']
  const snippet=depth==='overview'&&!c.mandatory?[...c.line].slice(0,100).join('')+(Array.from(c.line).length>100?'（概览节选）':''):c.line
  let rendered='['+c.record.id+'] '+(c.kind==='event'?epistemic(c.record as SemanticEvent):'已采纳摘要')+' · '+snippet
  if(depth==='evidence'&&eligible&&!excluded){for(const sourceId of [...new Set(c.sources)].slice(0,2)){const source=view.sources.find(s=>s.id===sourceId);if(!source)throw new RpError('source_unavailable','Evidence source missing');const span=c.kind==='event'?(c.record as SemanticEvent).sources.find(s=>s.sourceRevisionId===sourceId):undefined;const sourceText=span?await view.readSource(span):await view.readSource({sourceRevisionId:source.id,publicTextSha256:source.publicTextSha256,startUtf16:0,endUtf16:source.publicTextLengthUtf16,quoteSha256:source.publicTextSha256});rendered+='\n来源 '+sourceId+'（节选）：'+[...sourceText].slice(0,256).join('')}}
  const bytes=Buffer.byteLength(rendered,'utf8'),fits=c.mandatory||bytes<=config.budgets[c.layer]-used[c.layer]&&bytes<=remaining,selected=eligible&&!excluded&&fits
  if(eligible&&!excluded&&!fits)reasons.push('budget_exceeded')
  entries.push({id:c.record.id,kind:c.kind,revision:digest(c.record),bodySha256:digest(c.line),layer:c.layer,depth,selected,mandatory:c.mandatory,reasons,bytes,sourceIds:[...new Set(c.sources)]})
  if(selected){sections[c.layer].push(rendered);if(!c.mandatory){used[c.layer]+=bytes;remaining-=bytes}if(c.kind==='summary')selectedSummaries.push(c.record as Summary)}
 }
 // Remove only semantically recognized current-person optional slots. Unknown legacy data and conflicts stay mandatory.
 const state={...view.projection,state:view.projection.state.filter(s=>s.conflict==='unresolved'||s.subjectId!==personId||!s.supportEventIds.every(id=>classified.has(id)||!!events.get(id)&&!!personValue(events.get(id)!))),relationships:view.projection.relationships.filter(r=>r.fromId!==personId||r.resolution==='conflict')}
 const narrative='人物 '+personId+' 的记忆视图。快照场景 '+(context.sceneId??'未指定')+'，序号 '+context.acceptedSeq+'。以下是记录支持的事实、说法与感受；不据此推断未记载的经历或互惠关系。情境描述只在本快照时点成立。\n'+LAYERS.map(l=>labels[l]+'\n'+(sections[l].join('\n')||'本轮没有选入条目。')).join('\n\n')+'\n需要更多细节时，使用只读记忆检索工具核对来源。'
 const traceBase={protocol:'rp.injection-snapshot/v1' as const,configSha256:digest(config),query:input.query,querySha256:digest(input.query),lexicalTermsTruncated:lexical.truncated,context,fence:view.fence,entries,renderedSha256:digest(narrative)}
 return {narrative,state,summaries:selectedSummaries,trace:{...traceBase,sha256:digest(traceBase)} as InjectionTrace}
}
