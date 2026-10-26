/** Explicit local assistance. Suggestions have no canonical authority. */
import {createHash} from 'node:crypto'
import type {RpStore} from './store.js'
import type {HostAuthority,SourceRevision} from './types.js'
import type {createSummaryService,SummaryContext} from './summarizer.js'
import {failure,id,integer,object,RpError} from './schema.js'
import {fullSpan,unwrap} from './retrieval.js'
const sha=(s:string)=>createHash('sha256').update(s).digest('hex')
function excerpt(source:SourceRevision,text:string){
 let end=Math.min(text.length,512)
 if(end<text.length&&/[\uDC00-\uDFFF]/u.test(text[end]))end--
 const quote=text.slice(0,end)
 return {sourceRevisionId:source.id,role:source.role,text:quote,truncated:end<text.length,span:{...fullSpan(source),endUtf16:end,quoteSha256:sha(quote)}}
}
export function createOrganizer(store:RpStore,summaries:ReturnType<typeof createSummaryService>,inputs:(a:HostAuthority)=>ReadonlySet<string>){
 const conversation=(a:HostAuthority,s:SourceRevision)=>s.origin==='host_public'&&['user','assistant'].includes(s.role)||s.origin==='user_control'&&inputs(a).has(s.id)
 const ids=(v:unknown)=>{if(!Array.isArray(v)||!v.length||v.length>32||new Set(v).size!==v.length)throw new RpError('invalid_record','Select 1 to 32 distinct source revisions');v.forEach(id);return v as string[]}
 return Object.freeze({
  async summarize(authority:HostAuthority,input:unknown={},options:SummaryContext={}){
   try{
    const v=object(input,[],['sourceRevisionIds']),available=unwrap(await store.readAcceptedSources(authority)).filter(s=>conversation(authority,s))
    const selected=v.sourceRevisionIds?ids(v.sourceRevisionIds):available.slice(-8).map(s=>s.id)
    if(!selected.length||selected.some(key=>!available.some(s=>s.id===key)))throw new RpError('source_unavailable','Select accepted conversation sources only')
    const selection={level:'scene' as const,sourceRevisionIds:[...selected].sort(),supportEventIds:[],dependencySummaryIds:[]}
    const snapshot=await summaries.capture(authority,selection,options),quotes=snapshot.sources.map(({source,text})=>excerpt(source,text))
    const proposal={schemaVersion:1,proposedEvents:[],proposedSummary:{level:'scene',text:'原文摘录候选（本地整理，非模型总结；确认前不进入正式记忆）\n'+quotes.map(q=>`[${q.role} / ${q.sourceRevisionId}] ${q.text}${q.truncated?'〔摘录，原文可按来源读取〕':''}`).join('\n'),sourceRevisionIds:selection.sourceRevisionIds,exactAnchors:quotes.map(q=>q.span)}}
    const result=await summaries.proposeOnce(authority,proposal,selection,options)
    return result.ok?{ok:true as const,value:{...result.value,method:'local-extractive/v1',modelCalls:0,requiresConfirmation:true}}:result
   }catch(e){return failure(e)}
  },
  async review(authority:HostAuthority,input:unknown={}){
   try{
    const v=object(input,[],['asOf','staleAfterDays']),asOf=v.asOf??new Date().toISOString(),days=v.staleAfterDays??90
    integer(days,1);if(days>36500||typeof asOf!=='string'||!Number.isFinite(Date.parse(asOf)))throw new RpError('invalid_record','Invalid review date or age threshold')
    return await store.withReadView(authority,view=>{
     const sources=view.sources.filter(s=>conversation(authority,s)),groups=new Map<string,string[]>()
     for(const s of sources){const key=s.role+':'+s.publicTextSha256;groups.set(key,[...(groups.get(key)??[]),s.id])}
     const duplicates=[...groups.values()].filter(g=>g.length>1).map(sourceRevisionIds=>({sourceRevisionIds,suggestion:'核对是否重复；不同日期的相同话语可能都是有效经历。'}))
     return {inputFence:view.fence,asOf,modelCalls:0,requiresConfirmation:true,duplicates,conflicts:view.projection.conflicts,openCommitments:view.projection.state.filter(s=>/^(task|promise):/u.test(s.key)&&['active','paused'].includes((s.value as any)?.status)),ageReview:sources.filter(s=>Date.parse(asOf)-Date.parse(s.capturedAt)>days*86400000).map(s=>({sourceRevisionId:s.id,capturedAt:s.capturedAt,suggestion:'时间较久，建议复核；不代表已失效。'})),notice:'只提出复核建议；不自动合并、删除、解决冲突或完成约定。'}
    })
   }catch(e){return failure(e)}
  },
  async handoff(authority:HostAuthority,input:unknown={}){
   try{
    const v=object(input,[],['sourceRevisionIds']),selected=v.sourceRevisionIds?ids(v.sourceRevisionIds):undefined
    return await store.withReadView(authority,async view=>{
     const users=view.sources.filter(s=>conversation(authority,s)&&s.role!=='assistant'),chosen=selected?selected.map(key=>{const s=users.find(s=>s.id===key);if(!s)throw new RpError('source_unavailable','Handoff quotes require accepted user originals');return s}):users.slice(-8)
     const userQuotes=[];for(const s of chosen)userQuotes.push(excerpt(s,await view.readSource(fullSpan(s))))
     const experiences=view.events.filter(e=>e.payload.kind==='occurrence'&&e.epistemic==='world')
     return {schemaVersion:1,kind:'continuity-handoff',inputFence:view.fence,userQuotes,currentState:view.projection.state,relationships:view.projection.relationships,confirmedExperiences:experiences.slice(-24),openCommitments:view.projection.state.filter(s=>/^(task|promise):/u.test(s.key)&&['active','paused'].includes((s.value as any)?.status)),coverage:{userSources:users.length,quoted:chosen.length,confirmedExperiences:experiences.length,includedExperiences:Math.min(24,experiences.length)},modelCalls:0,notice:'来自当前授权分支；原话片段附范围和哈希。continue-clean 继续使用该分支，不复制旧工具回执；更正或删除后必须重新生成交接。'}
    })
   }catch(e){return failure(e)}
  },
 })
}
