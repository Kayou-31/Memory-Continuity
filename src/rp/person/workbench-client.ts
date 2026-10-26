import type {createManagementClient} from './management-client.js'
import type {workbenchVisuals} from './workbench-visuals.js'
import type {workbenchExtensions} from './workbench-extensions.js'

/** Self-contained browser entry. All person content is rendered as text. */
export function workbenchClient(makeClient:typeof createManagementClient,extensions:typeof workbenchExtensions,makeVisuals:typeof workbenchVisuals){
 const {icon}=makeVisuals()
 const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T
 let credential=location.hash.slice(1)
 history.replaceState(null,'',location.pathname)
 let snapshot:any,selected='',page='people',reviewId='',busy=false,closed=false,epoch=0,closeReview=false,focusBefore:HTMLElement|null=null
 const names:Record<string,string>={identity:'身份',background:'背景',trait:'性格',values:'价值观',boundaries:'边界',voice:'表达方式',feeling:'当前感受',stage:'人生阶段',stable:'保持稳定',growable:'允许经确认成长',situational:'仅当前情境有效'}
 const modes:Record<string,string>={rp:'角色扮演',companion:'陪伴',creation:'创作',project:'项目助手'}
 const layers:Record<string,string>={self:'自我核心',situation:'当前处境',relationships:'关系背景',recollection:'相关往事',unfinished:'未完成事项'}
 const depths:Record<string,string>={overview:'概览',association:'关联',evidence:'证据'}
 const reasons:Record<string,string>={mandatory:'必须保留',excluded:'手动排除',pinned:'手动固定',rule_matched:'条件规则命中',relevant:'相关或当前有效',condition_not_matched:'条件未命中',budget_exceeded:'本层或总预算不足'}
 const statuses:Record<string,string>={active:'进行中',paused:'已暂停',completed:'已完成',abandoned:'已放弃'}
 const relations:Record<string,string>={trust:'信任',affection:'亲近',loyalty:'忠诚',tension:'紧张',debt:'亏欠',promise:'承诺关系',kinship:'亲属',alliance:'同盟',rivalry:'竞争'}
 const pages=[['people','全部人物','人物','◈'],['profile','人物档案','人物','♙'],['experiences','经历与时间线','记忆','▤'],['relations','关系','记忆','⇄'],['goals','目标与承诺','记忆','◎'],['growth','成长审阅','记忆','♧'],['inject','注入预览','对话','▱'],['continuity','会话延续','对话','⤴'],['rules','用途与规则','对话','☷']]
 pages.splice(2,0,['documents','完整人物资料','人物','▥']);pages.push(['diary','共同日记','记忆','▧'],['budget','记忆预算','对话','◴'],['settings','工作台设置','管理','⚙'])
 const elem=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',parent?:HTMLElement,cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;parent?.append(n);return n}
 const message=(text:string,error=false)=>{$('status').textContent=text;$('status').dataset.error=String(error)}
 const errorText=(e:unknown)=>e instanceof Error?e.message:String(e)
 const fail=(e:unknown)=>{message(errorText(e),true);if(reviewId||$<HTMLDialogElement>('review').open)$('review-error').textContent=errorText(e)}
 const current=()=>snapshot?.persons.find((p:any)=>p.personId===selected)
 const personName=(p:any)=>p?.fields.find((f:any)=>f.kind==='identity')?.value??p?.personId??'未绑定人物'
 const setBusy=(value:boolean)=>{busy=value;document.body.setAttribute('aria-busy',String(value));$('content').setAttribute('aria-busy',String(value));for(const control of document.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('button,input,select,textarea'))if(!control.closest('#theme'))control.disabled=value||closed}
 const button=(parent:HTMLElement,label:string,action:()=>unknown,cls='btn')=>{const b=elem('button',label,parent,cls);b.type='button';b.disabled=busy||closed;b.onclick=()=>{if(!busy&&!closed)Promise.resolve().then(action).catch(fail)};return b}
 const card=(parent:HTMLElement,title?:string)=>{const c=elem('section','',parent,'panel stack mc-card');if(title)elem('h3',title,c,'h3');return c}
 const note=(parent:HTMLElement,text:string)=>elem('p',text,parent,'mc-form-note')
 const code=(parent:HTMLElement,text:unknown)=>elem('pre',typeof text==='string'?text:JSON.stringify(text,null,2),parent,'mc-code')
 const details=(parent:HTMLElement,label:string,text:unknown)=>{const d=elem('details','',parent,'mc-details');elem('summary',label,d);code(d,text);return d}
 const input=(parent:HTMLElement,label:string,value='',multi=false,max=2048)=>{const box=elem('label',label,parent,'mc-field');const n=document.createElement(multi?'textarea':'input');n.className=multi?'textarea':'input';n.value=value;n.maxLength=max;n.setAttribute('aria-label',label);n.disabled=busy||closed;box.append(n);return n}
 const select=(parent:HTMLElement,label:string,options:Record<string,string>,value='')=>{const box=elem('label',label,parent,'mc-field'),s=elem('select','',box);s.className='select';s.setAttribute('aria-label',label);s.disabled=busy||closed;for(const [k,v]of Object.entries(options)){const o=elem('option',v,s);o.value=k}if(value)s.value=value;return s}
 const chip=(parent:HTMLElement,text:string)=>elem('span',text,parent,'mc-chip')
 const title=(root:HTMLElement,heading:string,description:string)=>{const h=elem('div','',root,'page-head');const box=elem('div','',h,'page-head-text');elem('div',pages.find(p=>p[0]===page)?.[2]??'人物',box,'eyebrow');const t=elem('h1',heading,box,'h1');t.id='page-title';t.tabIndex=-1;elem('p',description,box,'lede');return h}
 const fold=(root:HTMLElement,label:string)=>{const d=elem('details','',root,'mc-editor');elem('summary',label,d);return elem('div','',d,'mc-editor-body')}
 const command=(root:HTMLElement,text:string)=>{const c=card(root);code(c,text);button(c,'复制指令',async()=>{try{await navigator.clipboard.writeText(text);message('已复制。请回到宿主执行。')}catch{message('无法访问剪贴板，请选择上面的指令手动复制。',true)}});return c}
 const empty=(root:HTMLElement,text:string)=>elem('div',text,root,'mc-empty')
 const hideReview=()=>{$<HTMLDialogElement>('review').close();$('inline-review').hidden=true;reviewId='';closeReview=false}
 const closeModal=()=>{if(busy)return;hideReview();focusBefore?.focus()}
 const clear=()=>{epoch++;hideReview();snapshot=undefined;selected='';reviewId='';for(const id of ['content','person','scope','review-body','review-summary','review-error'])$(id).replaceChildren();$('chat-person').textContent='未绑定';$('stamp').textContent='';$<HTMLDialogElement>('review').close()}
 const invalidate=()=>{closed=true;clear();empty($('content'),'管理入口已关闭或失效。请在宿主执行 /memcont person manage，打开新地址。');message('人物数据已清空，旧地址不能恢复权限。',true)}
 const api=makeClient(fetch.bind(window),credential,invalidate);credential=''
 const drawer=(open:boolean)=>{$('sidebar').classList.toggle('open',open);$('scrim').classList.toggle('open',open);$('menu').setAttribute('aria-expanded',String(open))}
 const go=(next:string)=>{if(busy||closed||!snapshot)return;page=next;render();drawer(false);window.scrollTo(0,0);$('page-title')?.focus({preventScroll:true})}
 const showReview=(heading:string,presentation:'dialog'|'inline'='dialog')=>{focusBefore=document.activeElement as HTMLElement;$('review-title').textContent=heading;$('review-error').textContent='';$('confirm').textContent=closeReview?'关闭管理入口':'确认写入';const inline=presentation==='inline';$('inline-review').hidden=!inline;(inline?$('inline-review'):$('review')).append($('review-panel'));if(inline){$<HTMLDialogElement>('review').close();$('inline-review').scrollIntoView({behavior:'smooth'})}else $<HTMLDialogElement>('review').showModal();$<HTMLButtonElement>('cancel').focus()}
 const labels:Record<string,string>={personId:'人物',fieldId:'字段',value:'新内容',policy:'变化策略',note:'变化理由',description:'经历内容',actorIds:'参与实体',fictionalTime:'剧情时间',fromId:'关系发起方',toId:'关系对象',relation:'关系类型',objective:'目标内容',nextAction:'下一步',status:'目标状态',progress:'进度',causeEventIds:'支持经历',candidateIds:'采纳候选',candidateId:'拒绝候选',previousEventId:'前驱事件',kind:'记录类型',sourceRevisionIds:'来源记录',category:'类别',ownerId:'所属人物',targetEntityId:'承诺对象',goalId:'目标编号'}
 const growthDiff=(parent:HTMLElement,change:any,processed=false)=>{
  const person=snapshot.persons.find((p:any)=>p.personId===change.personId),field=person?.fields.find((f:any)=>f.fieldId===change.fieldId)
  const previous=processed?timeline(change.personId).find((t:any)=>t.eventId===change.previousEventId):field
    note(parent,personName(person)+' / '+(names[field?.kind]??change.fieldId));const d=elem('div','',parent,'compare'),before=elem('div','',d,'col now')
    elem('span',processed?'提案时内容':'当前',before,'cap');elem('p',previous?.value??'历史值不在当前快照中',before,'tx');elem('div','',d,'mid').append(icon('arrowRight'))
    const after=elem('div','',d,'col next');elem('span','提案内容',after,'cap');elem('p',change.value,after,'tx');elem('p','理由：'+change.note,parent)
  for(const id of change.causeEventIds??[]){const event=snapshot.experiences.find((e:any)=>e.id===id);note(parent,'支持经历：'+(event?.payload.description??id))}
 }
 const preview=async(action:string,payload:any)=>{
  const version=epoch;setBusy(true);message('正在生成服务端确认预览…')
  try{const review=await api.request('prepare',{snapshotId:snapshot.id,action,payload});if(closed||version!==epoch)return
   closeReview=false;reviewId=review.id;$('review-summary').replaceChildren();const summary=$('review-summary'),impact=card(summary,review.impact.title)
   for(const change of review.impact.changes)elem('p',change,impact);note(impact,review.impact.history);note(impact,review.impact.recovery);note(impact,'影响范围：'+review.impact.branchId+(review.impact.personIds.length?' · '+review.impact.personIds.join('、'):''))
   if(action==='document-import'){const p=review.payload;elem('p',p.title,summary);note(summary,p.documentId+' · '+p.utf8Bytes.toLocaleString()+' 字节 · '+p.sections.length+' 个章节');details(summary,'逐章分类与条件',p.policies);details(summary,'核对完整原文',p.text);note(summary,'原文校验：'+p.sha256)}
   else if(action==='settings')note(summary,review.payload.impactConfirmation?'以后修改时显示影响弹窗。':'以后在页面内显示预览，并保留“确认写入”按钮。')
   else if(action==='diary-configure'){note(summary,review.payload.allowAgentWrite?'你和 AI 都可以写日记，各自保留作者身份。':'你可以写日记；AI 的日记写入保持关闭。');note(summary,'当前范围：本机人物「'+personName(snapshot.persons.find((p:any)=>p.personId===review.payload.personId))+'」的共同日记。')}
   else if(action==='diary-write'){const d=review.payload.draft;elem('h3',d.title,summary,'h3');elem('p',d.body,summary,'mc-reading');if(d.reflection)details(summary,'理解与修订说明',d.reflection)}
   else if(action==='host-person')note(summary,'当前聊天将绑定「'+personName(snapshot.persons.find((p:any)=>p.personId===review.payload.personId))+'」。')
   else if(action==='host-budget'){const b=review.payload.binding;note(summary,b?'总记忆上限：'+b.limitTokens.toLocaleString()+'。计量方式：'+(b.meter.mode==='tokenizer-text'?'模型文本 token':'UTF-8 保守估算'):'恢复旧版字节预算。');if(b)details(summary,'各层上限与模型绑定',b)}
   else if(action==='host-injection')details(summary,'确认后的注入配置',review.payload.binding??'关闭分层注入')
   else if(action==='create'){note(summary,'确认后将创建人物，并按现有规则备份、启用新版人物工作区。升级前请保留完整 profile 备份。');for(const f of review.payload.fields)elem('p',f.value,card(summary,names[f.kind]??f.kind))}
   else if(action==='edit'){const before=snapshot.persons.find((p:any)=>p.personId===payload.personId)?.fields.find((f:any)=>f.fieldId===payload.fieldId);const d=elem('div','',summary,'mc-diff');elem('div','当前\n'+(before?.value??'未设定'),d);elem('div','确认后\n'+payload.value,d);note(summary,'变化理由：'+payload.note)}
   else if(action==='propose')for(const change of review.payload.changes)growthDiff(card(summary,'成长内容'),change)
   else if(action==='adopt'||action==='reject'){const ids=review.payload.candidateIds??[review.payload.candidateId];for(const id of ids){const candidate=snapshot.candidates.find((c:any)=>c.id===id);if(candidate)for(const change of candidate.changes)growthDiff(card(summary,action==='adopt'?'准备采纳':'准备拒绝'),change)}}
   else for(const [key,value]of Object.entries(review.payload)){if(!['expected','previousEventId','goalId'].includes(key)&&value!==null&&!(Array.isArray(value)&&!value.length)){const c=card(summary,labels[key]??key);if(key==='causeEventIds'&&Array.isArray(value))for(const id of value)elem('p',snapshot.experiences.find((e:any)=>e.id===id)?.payload.description??id,c);else if(typeof value==='string')elem('p',({experience:'经历',relationship:'关系',goal:'目标',task:'目标',promise:'承诺'} as Record<string,string>)[value]??names[value]??statuses[value]??relations[value]??value,c);else if(Array.isArray(value)&&value.every(v=>typeof v==='string'))elem('p',value.join('、'),c);else code(c,value)}}
   $('review-body').textContent=JSON.stringify({操作:review.action,内容:review.payload,人生线:review.fence.branchId},null,2);showReview(review.impact.title,api.reviewPresentation(review));message('预览已生成，尚未确认写入。')
  }finally{setBusy(false)}
 }
 const refresh=async(success='')=>{
  const ticket=++epoch;setBusy(true);hideReview();$('content').replaceChildren();empty($('content'),'正在读取已验证记录…');message('正在刷新…')
  try{const result=await api.request('snapshot');if(closed||ticket!==epoch)return;snapshot=result;if(!snapshot.persons.some((p:any)=>p.personId===selected))selected=snapshot.context?.personId??snapshot.persons[0]?.personId??''
   const picker=$<HTMLSelectElement>('person');picker.replaceChildren();if(!snapshot.persons.length){const o=elem('option','暂无人物',picker);o.value=''}
   for(const p of snapshot.persons){const o=elem('option',personName(p)+' · '+p.personId,picker);o.value=p.personId}picker.value=selected
   const bound=snapshot.persons.find((p:any)=>p.personId===snapshot.context?.personId);$('chat-person').textContent=personName(bound);$('chat-person').title=snapshot.context?.sessionId??'未绑定'
   $('stamp').textContent='r'+snapshot.fence.contextRevision+' · '+new Date().toLocaleTimeString('zh-CN',{hour12:false});$('scope').textContent='人生线 '+snapshot.fence.branchId
   render();message(success)
  }catch(e){if(ticket===epoch&&!closed){clear();empty($('content'),'读取失败，旧记录已清空。请手动刷新或重新打开入口。')}throw e}finally{setBusy(false)}
 }
 const causes=(root:HTMLElement)=>{const d=elem('details','',root,'mc-details');elem('summary','选择支持这次变化的经历（必选，可多选）',d);const chosen:string[]=[];for(const e of snapshot.experiences.filter((e:any)=>e.payload.kind==='occurrence').slice(-200).reverse()){
  const l=elem('label','',d,'mc-cause'),box=elem('input','',l);box.type='checkbox';box.onchange=()=>{const index=chosen.indexOf(e.id);if(box.checked&&index<0)chosen.push(e.id);else if(!box.checked&&index>=0)chosen.splice(index,1)};elem('span',e.payload.description,l)
 }if(!snapshot.experiences.length)note(d,'请先记录一段已确认经历，再用它支持关系、目标或成长变化。');return chosen}
 const sourceInfo=(root:HTMLElement,record:any)=>details(root,'查看来源编号与版本',{记录:record.id??record.eventId,修订:record.revision??record.acceptedSeq,来源:record.sourceIds??record.sourceRevisionIds??record.sources?.map((s:any)=>s.sourceRevisionId)??[],内容校验:record.bodySha256??record.textSha256})
 const timeline=(id:string)=>snapshot.timelines.find((t:any)=>t.personId===id)?.changes??[]
 const createPerson=(root:HTMLElement)=>{
  title(root,'定义一个人物的起点','只使用宿主已授权的实体。空白字段保持未设定，不会自动补写经历。')
  const allowed=snapshot.entityIds.filter((id:string)=>!snapshot.persons.some((p:any)=>p.personId===id));if(!allowed.length){empty(root,'当前没有可创建的已授权实体。请先在宿主配置 entityIds，然后重新打开管理入口。');return}
  const entity=select(root,'人物实体 ID',Object.fromEntries(allowed.map((id:string)=>[id,id]))),grid=elem('div','',root,'mc-grid'),fields:{kind:string;value:HTMLInputElement|HTMLTextAreaElement;policy:HTMLSelectElement}[]=[]
  for(const kind of ['identity','background','trait','values','boundaries','voice']){const c=card(grid,names[kind]),value=input(c,'内容','',true),policy=select(c,'变化策略',{stable:'保持稳定',growable:'允许经确认成长'},['trait','background'].includes(kind)?'growable':'stable');fields.push({kind,value,policy})}
  const actions=elem('div','',root,'mc-actions');button(actions,'预览人物定义',()=>preview('create',{schemaVersion:1,kind:'person-draft',personId:entity.value,fields:fields.filter(f=>f.value.value.trim()).map(f=>({fieldId:f.kind,kind:f.kind,value:f.value.value.trim(),policy:f.policy.value})),relationships:[],goals:[]}),'btn btn-primary');button(actions,'返回人物列表',()=>go('people'))
 }
 const renderPeople=(root:HTMLElement)=>{
  const head=title(root,'全部人物','每个人物保留自己的定义、经历与变化。正在查看的人物和当前聊天使用的人物相互独立。');button(head,'＋ 新建人物',()=>go('new'),'btn btn-primary')
  if(!snapshot.persons.length){empty(root,'还没有人物。先定义起点，再记录经历与成长。');return}
  const grid=elem('div','',root,'people-grid');for(const p of snapshot.persons){const c=elem('article','',grid,'person-card');if(p.personId===selected)c.classList.add('is-viewing');const top=elem('div','',c,'top');elem('div',personName(p).slice(0,1),top,'avatar');const name=elem('div','',top,'stack');elem('h2',personName(p),name,'nm');elem('p',p.fields.find((f:any)=>f.kind==='background')?.value??'背景尚未设定',name,'tg clamp-2')
   const flags=elem('div','',c,'mc-actions');chip(flags,p.personId);if(p.personId===selected)chip(flags,'正在查看');if(p.personId===snapshot.context?.personId)chip(flags,'当前聊天使用')
   const counts=elem('div','',c,'stat-row');elem('span',p.fields.length+' 项定义',counts);elem('span',p.relationships.length+' 段定向关系',counts);elem('span',p.goals.filter((g:any)=>['active','paused'].includes(g.value.status)).length+' 件未完成',counts)
   button(elem('div','',c,'acts'),'查看档案',()=>{selected=p.personId;$<HTMLSelectElement>('person').value=selected;go('profile')},'btn btn-sm')
  }
 }
 const renderProfile=(root:HTMLElement,p:any,editing=false)=>{
  const hero=elem('header','',root,'persona-hero');elem('div',personName(p).slice(0,1),hero,'avatar lg');const name=elem('div','',hero,'names');elem('div','人物档案 · '+p.personId,name,'eyebrow');const heading=elem('h1',personName(p),name,'h1 persona-hero-title');heading.id='page-title';heading.tabIndex=-1;elem('p',p.fields.find((f:any)=>f.kind==='background')?.value??'故事从这里开始。',name,'aka');const markers=elem('div','',name,'who-markers');elem('span','正在查看',markers,'chip marker-viewing');if(p.personId===snapshot.context?.personId)elem('span','当前聊天使用',markers,'chip marker-chat')
  const actions=elem('div','',hero,'hero-acts row');button(actions,editing?'完成编辑':'编辑档案',()=>{hideReview();root.replaceChildren();renderProfile(root,p,!editing)},editing?'btn':'btn btn-primary').prepend(icon(editing?'check':'edit'))
  if(!editing){
   const stateHead=elem('div','',root,'section-head');elem('h2','此刻的状态',stateHead,'h2');elem('span','感受、阶段和处境，与身份一起延续',stateHead,'sub')
   const states=elem('div','',root,'state-cards')
   for(const [kind,label]of [['feeling','当前感受'],['stage','人生阶段']]){const f=p.fields.find((v:any)=>v.kind===kind),state=elem('div','',states,'state-card'+(f?.policy==='situational'?' situ':'')),k=elem('div','',state,'k');elem('span',label,k);if(f)elem('span',names[f.policy],k,'chip '+(f.policy==='stable'?'chip-stable':f.policy==='growable'?'chip-grow':'chip-situ'));elem('div',f?.value??'还没有记录。',state,'v'+(f?'':' faint'));if(f?.validity)details(state,'适用范围',f.validity);if(f){const t=timeline(p.personId).find((t:any)=>t.eventId===f.eventId);if(t)elem('div','接受序号 '+t.acceptedSeq,state,'meta')}}
   const recent=snapshot.experiences.filter((e:any)=>e.payload.actorIds?.includes(p.personId)).sort((a:any,b:any)=>b.acceptedSeq-a.acceptedSeq)[0],recentCard=elem('div','',states,'state-card'),recentKey=elem('div','',recentCard,'k');elem('span','最近经历',recentKey);if(recent)elem('span','已确认',recentKey,'chip chip-ok');elem('div',recent?.payload.description??'还没有记录。',recentCard,'v'+(recent?'':' faint'));if(recent)elem('div',recent.fictionalTime??'接受序号 '+recent.acceptedSeq,recentCard,'meta')
   const head=elem('div','',root,'section-head');elem('h2','身份与性格',head,'h2');elem('span','每条内容都标明了能否变化',head,'sub');const legend=elem('div','',root,'stab-legend')
   for(const [label,cls,meaning]of [['保持稳定','chip-stable','只有明确修改时才变化。'],['允许成长','chip-grow','依据经历提出建议，确认后才更新。'],['仅当前情境','chip-situ','只在记录的有效范围内使用。']]){const item=elem('div','',legend);elem('span',label,item,'chip '+cls);elem('span',meaning,item)}
   const sections=elem('div','',root,'profile-sections'),hints:Record<string,string>={identity:'是谁，以及如何称呼',background:'来历与经历',trait:'习惯与性格倾向',values:'重视什么，如何判断',boundaries:'彼此尊重的边界',voice:'说话的方式与语气'}
   for(const kind of ['identity','background','trait','values','boundaries','voice']){const section=elem('section','',sections,'p-section'),h=elem('div','',section,'p-section-head');elem('h3',names[kind],h);elem('span',hints[kind],h,'hint');const fields=p.fields.filter((f:any)=>f.kind===kind);if(!fields.length)elem('div','还没有填写'+names[kind]+'。',section,'empty-line');for(const f of fields){const e=elem('div','',section,'entry'+(f.policy==='situational'?' situ':''));elem('div',f.value,e,'txt');const side=elem('div','',e,'side');elem('span',names[f.policy],side,'chip '+(f.policy==='stable'?'chip-stable':f.policy==='growable'?'chip-grow':'chip-situ'));const t=timeline(p.personId).find((t:any)=>t.eventId===f.eventId);if(t)elem('span','序号 '+t.acceptedSeq,side,'ver')}}
   return
  }
  note(root,'逐项预览并保存。只有点“确认写入”的修改才会进入人物；结束编辑不会自动保存草稿。')
  const section=elem('div','',root,'section-head');elem('h2','身份与性格',section,'h2');elem('span','先读懂一个人，再决定怎样修改',section,'sub')
  const grid=elem('div','',root,'profile-sections');for(const f of p.fields){const section=elem('section','',grid,'p-section'),head=elem('div','',section,'p-section-head');elem('h3',names[f.kind]??f.kind,head);elem('span',names[f.policy]??f.policy,head,'chip '+(f.policy==='stable'?'chip-stable':f.policy==='growable'?'chip-grow':'chip-situ'));elem('p',f.value,section,'mc-reading');const c=fold(section,'编辑这一项'),value=input(c,'当前内容',f.value,true),noteInput=input(c,'修改理由'),policy=select(c,'变化策略',{stable:'保持稳定',growable:'允许经确认成长',situational:'仅当前情境有效'},f.policy)
   if(f.validity)details(c,'情境适用范围',f.validity);if(f.kind==='feeling')note(c,'这是一条感受记录，不代表已经证实的外部事实。')
   const actions=elem('div','',c,'mc-actions');button(actions,'预览修改',()=>preview('edit',{personId:selected,fieldId:f.fieldId,value:value.value,note:noteInput.value,...(f.validity?{validity:f.validity}:{})}),'btn btn-sm btn-primary')
   button(actions,'预览策略变更',()=>{if(policy.value==='situational'&&!f.validity)throw Error('当前字段没有情境范围。请通过可信人物指令设置 scene 或 sequence 有效期。');return preview('set-policy',{personId:selected,fieldId:f.fieldId,policy:policy.value,note:noteInput.value,...(policy.value==='situational'?{validity:f.validity}:{})})},'btn btn-sm')
   sourceInfo(c,{eventId:f.eventId,sourceRevisionIds:timeline(p.personId).find((x:any)=>x.eventId===f.eventId)?.sourceRevisionIds??[]})
  }note(root,'情境感受和阶段可通过人物草稿定义。日历到期、任意增删现有字段等能力列入未来计划。')
 }
 // Page implementations follow the existing backend's record semantics.
 const renderExperiences=(root:HTMLElement,p:any)=>{
  title(root,'经历与人生时间线','已确认的经历支撑后续关系、目标与成长。时间采用剧情时间与接受序号，不虚构日历日期。')
  const form=fold(root,'＋ 记录一段经历'),description=input(form,'发生了什么','',true,8192),time=input(form,'剧情时间（可选）','',false,256),actors=select(form,'另一位参与者（可选）',{'':'仅当前人物',...Object.fromEntries(snapshot.entityIds.filter((id:string)=>id!==selected).map((id:string)=>[id,id]))})
  button(form,'预览经历',()=>preview('agent',{kind:'experience',actorIds:[selected,...(actors.value?[actors.value]:[])],description:description.value,sourceRevisionIds:[],...(time.value.trim()?{fictionalTime:time.value.trim()}:{})}),'btn btn-primary')
  const experiences=snapshot.experiences.filter((e:any)=>e.payload.actorIds?.includes(selected));const box=card(root,'已经确认的经历');if(!experiences.length)empty(box,'还没有已确认经历。')
  for(const e of [...experiences].reverse()){const row=elem('article','',box,'exp'),body=elem('div','',row,'exp-body');body.hidden=true;const head=button(row,'',()=>{body.hidden=!body.hidden;head.setAttribute('aria-expanded',String(!body.hidden))},'exp-head');row.prepend(head);head.setAttribute('aria-expanded','false');elem('span',e.fictionalTime??'序号 '+e.acceptedSeq,head,'exp-date');const main=elem('span','',head,'exp-main');elem('strong',e.payload.description.split('\n')[0],main,'exp-title');elem('span','已确认',head,'chip chip-ok');elem('p',e.payload.description,body,'mc-reading');sourceInfo(body,e)}
  const changes=timeline(p.personId),history=fold(root,'查看人物变化时间线');if(!changes.length)empty(history,'暂无人物变化。')
  const ops:Record<string,string>={init:'初始定义',edit:'人工修改',grow:'成长采纳','set-policy':'策略变化'}
  for(const t of [...changes].reverse()){const c=card(history,(names[t.kind]??t.kind)+' · '+(ops[t.operation]??t.operation));c.classList.add('mc-history');const previous=changes.find((x:any)=>x.eventId===t.previousEventId);if(previous){const d=elem('div','',c,'mc-diff');elem('div','之前\n'+previous.value,d);elem('div','之后\n'+t.value,d)}else elem('p',t.value,c);note(c,t.note);chip(c,t.current?'当前':t.expired?'已过期':'历史');note(c,'接受序号 '+t.acceptedSeq);details(c,'变化依据与来源',{前驱:t.previousEventId,支持经历:t.causeEventIds,来源:t.sourceRevisionIds})}
  note(root,'当前管理快照保留最近 '+snapshot.experiences.length+' / '+snapshot.experienceCount+' 条经历；人物时间线最多 200 条。更早记录保留在后端，可经授权检索。')
 }
 const renderRelations=(root:HTMLElement,p:any)=>{
  title(root,'有方向的关系','“我信任对方”不会自动变成“对方信任我”。每次变化都需要明确理由和已确认经历。')
  const graph=elem('div','',root,'stack'),incoming=snapshot.persons.flatMap((q:any)=>q.relationships).filter((r:any)=>r.toId===selected),others=[...new Set([...p.relationships.map((r:any)=>r.toId),...incoming.map((r:any)=>r.fromId)])]
  if(!others.length)empty(graph,'还没有记录关系。可以先记录一段经历，再据此描述关系的变化。')
  const display=(id:string)=>personName(snapshot.persons.find((p:any)=>p.personId===id))==='未绑定人物'?id:personName(snapshot.persons.find((p:any)=>p.personId===id))
  for(const other of others){const row=elem('article','',graph,'rel-card'),head=elem('div','',row,'rel-card-head');elem('h2',display(other as string),head,'nm');elem('span','方向分别记录',head,'chip chip-outline');const dirs=elem('div','',row,'rel-dirs');for(const [from,to,records]of [[selected,other,p.relationships.filter((r:any)=>r.toId===other)],[other,selected,incoming.filter((r:any)=>r.fromId===other)]] as [string,string,any[]][]){const dir=elem('div','',dirs,'rel-dir'+(records.length?'':' unknown')),line=elem('div','',dir,'rel-line');elem('span',display(from),line,'rel-end');const arrow=elem('span','',line,'rel-arrow');elem('span',records.length?records.map(r=>relations[r.relation]??r.relation).join('、'):'没有记录',arrow,'rel-label');elem('span',display(to),line,'rel-end');for(const r of records){elem('div',typeof r.value==='string'?r.value:JSON.stringify(r.value),dir,'rel-detail');details(dir,'支持事件',r.supportEventIds)}if(!records.length)elem('p','没有记录这个方向，系统不会替你推断。',dir,'rel-detail')}}
  const c=fold(root,'记录关系变化'),to=select(c,'关系对象',Object.fromEntries(snapshot.entityIds.filter((id:string)=>id!==selected).map((id:string)=>[id,id]))),relation=select(c,'关系类型',relations),value=input(c,'新的关系状态','',true),reason=input(c,'变化理由'),why=causes(c)
  button(c,'预览关系变化',()=>{const previous=p.relationships.find((r:any)=>r.toId===to.value&&r.relation===relation.value);return preview('agent',{kind:'relationship',fromId:selected,toId:to.value,relation:relation.value,value:value.value,previousEventId:previous?.supportEventIds[0]??null,causeEventIds:why,note:reason.value})},'btn btn-primary')
  note(root,'紧张、亏欠、竞争等关系可以记录尚未解决的问题；不会自动推断反向关系或替你解决矛盾。')
 }
 const renderGoals=(root:HTMLElement,p:any)=>{
  title(root,'目标与承诺','让未完成事项有处可寻，也为暂停、完成和放弃保留原因。')
  const grid=elem('div','',root,'stack');if(!p.goals.length)empty(grid,'还没有目标或承诺。')
  for(const g of p.goals){const v=g.value,article=elem('article','',grid,'goal'),main=elem('div','',article,'stack');elem('span',(v.category==='promise'?'承诺':'目标')+' · '+(statuses[v.status]??v.status),main,'chip '+(v.status==='completed'?'chip-ok':'chip-outline'));elem('h3',v.objective??g.key,main,'h3');if(v.targetEntityId)note(main,'对象：'+v.targetEntityId);note(main,'下一步：'+(v.nextAction||'尚未填写'));const side=elem('div','',article,'goal-side');elem('span',v.progress+'%',side,'mc-count');const bar=elem('progress','',side,'mc-progress');bar.max=100;bar.value=v.progress;bar.setAttribute('aria-label','目标进度');const c=fold(main,'更新目标进度')
   const state=select(c,'新状态',statuses,v.status),progress=input(c,'进度 0–100',String(v.progress)),next=input(c,'下一步',v.nextAction),reason=input(c,'变化理由'),support=causes(c);progress.setAttribute('type','number');progress.setAttribute('min','0');progress.setAttribute('max','100')
   button(c,'预览目标变化',()=>preview('agent',{kind:'goal',ownerId:selected,...v,status:state.value,progress:Number(progress.value),nextAction:next.value,previousEventId:g.supportEventIds[0],causeEventIds:support,note:reason.value}),'btn btn-primary');details(c,'当前记录依据',g.supportEventIds)
  }
  const c=fold(root,'＋ 建立新的目标或承诺'),category=select(c,'类别',{task:'目标',promise:'对某人的承诺'}),target=select(c,'承诺对象',Object.fromEntries(snapshot.entityIds.filter((id:string)=>id!==selected).map((id:string)=>[id,id]))),objective=input(c,'想完成什么'),next=input(c,'下一步'),reason=input(c,'建立理由'),why=causes(c)
  button(c,'预览新目标',()=>preview('agent',{kind:'goal',ownerId:selected,goalId:'goal_'+crypto.randomUUID().replaceAll('-',''),category:category.value,...(category.value==='promise'?{targetEntityId:target.value}:{}),objective:objective.value,status:'active',progress:0,nextAction:next.value,previousEventId:null,causeEventIds:why,note:reason.value}),'btn btn-primary')
 }
 const renderGrowth=(root:HTMLElement,p:any)=>{
  title(root,'成长审阅','看清变化前后、理由与经历，再决定是否采纳。候选内容不会自动进入人物。')
  const chosen:string[]=[],all=snapshot.candidates.filter((c:any)=>c.changes.some((x:any)=>x.personId===selected)),pending=all.filter((c:any)=>c.state==='pending'),processed=all.filter((c:any)=>c.state!=='pending')
  const toolbar=elem('div','',root,'review-toolbar'),count=elem('span','待审阅 '+pending.length+' 条 · 已选择 0 条',toolbar,'muted')
  if(pending.length)button(toolbar,'预览批量采纳',()=>{if(!chosen.length)throw Error('请先选择候选。');return preview('adopt',{candidateIds:chosen})},'btn btn-primary')
  const waiting=elem('div','',root,'stack');if(!pending.length)empty(waiting,'没有等待审阅的成长。人物不会在后台自行改变。')
  const history=processed.length?fold(root,'已处理的候选 · '+processed.length+' 条'):undefined
  for(const c of [...pending,...processed]){const item=elem('article','',c.state==='pending'?waiting:history!,'sugg'+(c.state==='stale'?' stale':'')),head=elem('div','',item,'sugg-head');
   if(c.state==='pending'){const label=elem('label','',head,'check row'),box=elem('input','',label);box.type='checkbox';elem('span','选择这次成长',label);box.onchange=()=>{const i=chosen.indexOf(c.id);if(box.checked&&i<0)chosen.push(c.id);else if(!box.checked&&i>=0)chosen.splice(i,1);item.classList.toggle('selected',box.checked);count.textContent='待审阅 '+pending.length+' 条 · 已选择 '+chosen.length+' 条'}}
   else elem('h2','成长记录',head,'h3')
   elem('span',({pending:'待审阅',accepted:'已采纳',rejected:'已拒绝',stale:'已失效'} as Record<string,string>)[c.state]??c.state,head,'status-pill st-'+c.state)
   for(const change of c.changes)growthDiff(item,change,c.state!=='pending')
   if(c.state==='pending'){const actions=elem('div','',item,'sugg-foot');button(actions,'预览拒绝',()=>preview('reject',{candidateId:c.id}),'btn btn-danger-ghost');button(actions,'预览采纳',()=>preview('adopt',{candidateIds:[c.id]}),'btn btn-primary')}
  }
  const c=fold(root,'＋ 提出一次成长'),fields=p.fields.filter((f:any)=>f.policy==='growable');if(!fields.length){note(c,'当前没有允许成长的字段。可先在人物档案中明确调整策略。');return}
  const field=select(c,'可成长字段',Object.fromEntries(fields.map((f:any)=>[f.fieldId,(names[f.kind]??f.kind)+' · '+f.fieldId]))),value=input(c,'建议的新状态','',true),reason=input(c,'成长理由'),support=causes(c)
  button(c,'预览成长提案',()=>{const old=p.fields.find((f:any)=>f.fieldId===field.value);return preview('propose',{changes:[{changeId:'change_'+crypto.randomUUID().replaceAll('-',''),personId:selected,fieldId:old.fieldId,previousEventId:old.eventId,value:value.value,causeEventIds:support,note:reason.value}]})},'btn btn-primary')
 }
 const renderInjection=(root:HTMLElement)=>{
  title(root,'记忆注入预览','输入这一轮的话题，查看人物会带着哪些记忆进入对话、为什么选它们，以及最终交给模型阅读的文字。')
  const banner=elem('div','',root,'preview-banner');banner.append(icon('layers'));elem('span','仅预览。不发送给模型，不修改记忆。实际发送前仍会重新验证权限与版本。',banner)
  const bound=snapshot.persons.find((p:any)=>p.personId===snapshot.context?.personId),c=elem('section','',root,'panel query-panel')
  c.setAttribute('aria-label','预览设置');note(c,'预览对象：'+personName(bound)+'。查看其他档案不会改变当前对话绑定。')
  const query=input(c,'这一轮的话题或问题','',true,8192) as HTMLTextAreaElement;query.rows=2;query.placeholder='例如：我们还有什么尚未兑现的约定？'
  const options=elem('div','',c,'opt-row'),configuration=fold(root,'分层与条件设置'),config=input(configuration,'注入配置 JSON',JSON.stringify(snapshot.context?.injection?.config??{},null,2),true,32768)
  note(configuration,'配置经预览确认后保存；可设置 depth、budgets、pin、exclude、aliases 和 rules。token 总额及分层上限在“记忆预算”页管理。')
  const configActions=elem('div','',configuration,'row');button(configActions,'预览注入配置',()=>preview('host-injection',{config:JSON.parse(config.value)}),'btn btn-primary');button(configActions,'预览关闭分层注入',()=>preview('host-injection',{config:null}))
  const summary=elem('div','',options,'result-meta');elem('span','展开：'+(depths[snapshot.context?.injection?.config?.depth]??'尚未设置'),summary);elem('span',snapshot.context?.memoryBudget?'总记忆上限 '+snapshot.context.memoryBudget.limitTokens.toLocaleString():'旧版字节预算',summary)
  const output=elem('div','',root,'stack-lg')
  if(!snapshot.context?.injection){note(output,'当前尚未启用分层注入。请在空白根会话绑定人物并明确开启；已有历史先干净续接。');button(output,'预览绑定当前查看人物',()=>preview('host-person',{personId:selected}),'btn btn-primary');return}
  const run=async()=>{const ticket=epoch;setBusy(true);output.replaceChildren();message('正在校验快照并组装预览…');try{
   const result=await api.request('injection-preview',{query:query.value});if(closed||ticket!==epoch)return;output.replaceChildren();if(!result.current){empty(output,'当前没有可用的人物连续性预览。');return}
   if(result.delivery)note(output,(result.delivery.phase==='initial'?'首轮加载':'后续按需')+' · 可选记忆上限 '+result.delivery.optionalLimit.toLocaleString()+' 当前计量单位。'+result.delivery.notice)
   const trace=result.current.trace,usage=result.memoryBudget?.usage,selectedCount=trace.entries.filter((e:any)=>e.selected).length,metrics=elem('section','',output,'panel stack'),meta=elem('div','',metrics,'result-meta')
   elem('span','选入 '+selectedCount+' / '+trace.entries.length+' 条',meta);elem('span','数据版本 r'+trace.fence.contextRevision,meta);elem('span','本次话题：'+(trace.query||'未指定'),meta)
   if(usage){const meter=elem('div','',metrics,'meter'),heading=elem('div','',meter,'row-between');elem('h2','记忆容量',heading,'h3');elem('span',usage.total.toLocaleString()+' / '+usage.limit.toLocaleString()+(usage.mode==='tokenizer-text'?' 文本 token':' UTF-8 保守计量'),heading,'num');const bar=elem('progress','',meter,'mc-budget-meter');bar.max=usage.limit;bar.value=usage.total;bar.setAttribute('aria-label','总记忆容量使用');note(meter,'包括当前记忆和已保留的工具内容；实际请求会重新计量宿主包装。');details(metrics,'完整计量依据',usage)}
   else note(metrics,'当前使用旧版 UTF-8 字节预算。下列字节数不是精确 token 数。')
   if(trace.lexicalTermsTruncated)note(metrics,'查询词超过上限，本次只使用前 128 个不同词项；请缩短话题后重新预览。')
   const layout=elem('div','',output,'inject-layout'),list=elem('div','',layout,'stack'),aside=elem('aside','',layout,'inject-side'),text=elem('section','',aside,'panel stack');aside.setAttribute('aria-label','本轮人物记忆文本');elem('h2','本轮供模型阅读的文字',text,'h2');note(text,'这是本次服务器生成的完整人物连续性文本。');elem('pre',result.current.text,text,'inject-text');details(text,'快照与配置校验',trace.context)
   const filter=elem('div','',list,'filter-chips');filter.setAttribute('role','group');filter.setAttribute('aria-label','筛选记忆');const groups=elem('div','',list,'stack'),filterButtons:HTMLButtonElement[]=[];let selectedFilter='all'
   const layerDescriptions:Record<string,string>={self:'身份、性格与稳定边界',situation:'当前感受、阶段与处境',relationships:'有方向的关系与互动背景',recollection:'与话题相关的经历和资料',unfinished:'目标、承诺与尚未完成的事'}
   const renderEntries=()=>{groups.replaceChildren();for(const b of filterButtons)b.setAttribute('aria-pressed',String(b.dataset.filter===selectedFilter));for(const [layer,label]of Object.entries(layers)){
    const all=trace.entries.filter((e:any)=>e.layer===layer),entries=all.filter((e:any)=>selectedFilter==='all'||(selectedFilter==='in'?e.selected:!e.selected)),group=elem('section','',groups,'cat');group.dataset.layer=layer
    const head=elem('div','',group,'cat-head');elem('span','',head,'cat-sw');const info=elem('div','',head);elem('h3',label,info,'nm');elem('div',layerDescriptions[layer],info,'ds');elem('span','选入 '+all.filter((e:any)=>e.selected).length+' / '+all.length,head,'ct')
    if(!entries.length){elem('p',all.length?'此筛选下没有记录。':'本层没有当前有效候选。',group,'mc-layer-empty');continue}
    for(const e of entries){const item=elem('div','',group,'mem '+(e.selected?'in':'out')),detail=elem('div','',item,'mem-detail');detail.hidden=true;const row=button(item,'',()=>{detail.hidden=!detail.hidden;row.setAttribute('aria-expanded',String(!detail.hidden))},'mem-row');item.prepend(row);row.setAttribute('aria-expanded','false');elem('span',e.selected?'✓':'−',row,'mem-state '+(e.selected?'in':'out'));const main=elem('span','',row,'mem-main');elem('span',({event:'事件',summary:'摘要',document:'人物资料',diary:'共同日记'} as Record<string,string>)[e.kind]??'记忆记录',main,'mem-title');const line=result.current.text.split('\n').find((line:string)=>line.startsWith('['+e.id+'] '));elem('span',line?line.slice(e.id.length+3):(e.selected?'选入正文见右侧完整文本':'本次未选入；不从其他快照补出正文'),main,'mem-text');const tags=elem('span','',main,'mem-tags');for(const reason of e.reasons)elem('span',reasons[reason]??reason,tags,'chip '+(e.selected?'chip-accent':'chip-outline'));const side=elem('span','',row,'mem-side');elem('span',depths[e.depth]??e.depth,side,'chip chip-outline');elem('span',e.bytes+' 字节'+(e.tokens!==undefined?' · '+e.tokens+' 计量单位':''),side,'mem-tok');note(detail,'原因：'+e.reasons.map((r:string)=>reasons[r]??r).join('；'));if(line)elem('pre',line.slice(e.id.length+3),detail,'inject-text');sourceInfo(detail,e)}
   }}
   for(const [key,label,count]of [['all','全部',trace.entries.length],['in','选入',selectedCount],['out','未选入',trace.entries.length-selectedCount]] as [string,string,number][]){const b=button(filter,label+' '+count,()=>{selectedFilter=key;renderEntries()},'filter-chip');b.dataset.filter=key;filterButtons.push(b)}renderEntries()
   const history=elem('section','',output,'stack');const hh=elem('div','',history,'section-head');elem('h2','历史保留与发送范围',hh,'h2');note(history,result.notice);if(!result.history.length)elem('p','干净上下文，没有旧宿主消息。',history,'empty-line');for(const h of result.history){const row=elem('div','',history,h.status==='blocked'?'block-item':'panel stack');elem('h3',h.status==='blocked'?'已失效，继续发送会被封锁':h.status==='retired'?'已去重，原始证据保留':'仍携带在上下文中',row,'h3');elem('p',h.reason,row);details(row,'历史消息与快照',{消息:h.messageId,快照:h.snapshotId,类型:h.kind,选入记录:h.selectedIds})}
   message('预览完成。当前未选入不代表旧历史已被删除；实际发送前会重新校验。')
  }catch(e){output.replaceChildren();throw e}finally{setBusy(false)}}
  button(options,'预览本轮注入',run,'btn btn-primary').prepend(icon('layers'));query.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!busy){e.preventDefault();run().catch(fail)}})
  note(output,'输入话题后生成一次预览。这里不会自动请求模型。')
 }
 const renderContinuity=(root:HTMLElement)=>{
  title(root,'会话会结束，人物继续','沿着同一条人生线，把已经确认的记忆带进新的对话。')
  const binding=elem('section','',root,'panel stack');elem('h2','当前人生线',binding,'h2');const chain=elem('div','',binding,'chain'),item=elem('div','',chain,'chain-item'),rail=elem('div','',item,'chain-rail');elem('span','',rail,'chain-dot active');const body=elem('div','',item,'chain-body');elem('strong',personName(snapshot.persons.find((p:any)=>p.personId===snapshot.context?.personId)),body);elem('span',snapshot.fence.branchId,body,'id');elem('p',snapshot.context?.sessionId?'当前会话：'+snapshot.context.sessionId:'当前是独立管理空间，没有宿主聊天会话。',body,'m')
  const plan=elem('div','',root,'carry-plan');for(const [heading,cls,items]of [['继续带着','yes',['有效的人物定义与已确认经历','当前人生线、关系和未完成事项','经过认证的人物绑定与注入配置']],['留在旧会话','no',['旧宿主聊天消息和未经认证的工具结果','尚未采纳的成长候选不会变成事实','结果不明的输入不会自动重发']]] as [string,string,string[]][]){const panel=elem('section','',plan,'panel stack');elem('h2',heading,panel,'h2');const list=elem('ul','',panel,'plan-list '+cls);for(const text of items){const li=elem('li','',list);li.append(icon(cls==='yes'?'check':'x'));elem('span',text,li)}}
  const next=fold(root,'开启干净的新会话');note(next,'在 DSH 中执行以下指令，再选择返回的新根会话；独立核心不代替宿主创建聊天。');command(next,'/memcont continue-clean')
  const scopes=elem('section','',root,'stack'),h=elem('div','',scopes,'section-head');elem('h2','记忆的两种范围',h,'h2');const grid=elem('div','',scopes,'grid-2');for(const [name,text]of [['人物人生线','定义、经历、关系和承诺按人物与分支读取，保持各自的来源。'],['全局记忆','通用偏好与世界设定通过明确授权发布、采用或撤销，不自动共享私人记忆。']]){const c=elem('section','',grid,'panel stack');elem('h3',name,c,'h3');elem('p',text,c,'muted')}
  const controls=fold(root,'绑定与全局记忆操作');button(controls,'预览绑定当前查看人物',()=>preview('host-person',{personId:selected}),'btn btn-primary');command(controls,'/memcont help memory\n/memcont help storage')
 }
 const renderRules=(root:HTMLElement)=>{
  title(root,'用途与规则','系统固定约束始终生效；人物规则定义表达与边界，不会授予额外权限。')
  const config=snapshot.context?.config,mode=snapshot.context?.mode??'rp',purposes=elem('section','',root,'stack');elem('h2','用途',purposes,'h2');const grid=elem('div','',purposes,'purpose-grid'),descriptions:Record<string,string>={rp:'在故事与角色之间保持连续。',companion:'保留共同经历、关系和约定。',creation:'延续人物与世界的创作。',project:'让目标、决策与进展有据可循。'}
  for(const [key,label]of Object.entries(modes)){const p=elem('div','',grid,'purpose'+(mode===key?' current':'')),h=elem('div','',p,'row-between');elem('span',label,h,'t');if(mode===key)elem('span','当前',h,'chip chip-accent');elem('span',descriptions[key],p,'d')}
  note(purposes,'用途和模块在可信宿主中明确配置；当前只展示真实运行状态。已有历史时先干净续接。')
  const modules=elem('section','',root,'panel stack');elem('h2','能力模块',modules,'h2');const list=elem('div','',modules)
  for(const [id,label,description]of [['person-view','人物视图','读取当前授权的人物定义与状态。'],['recall','授权回忆检索','在来源和受众范围内检索记忆。'],['growth-review','人工成长审阅','依据已经确认的经历提出成长候选，不自动采纳。']]){const row=elem('div','',list,'module');elem('span',label,row,'t');elem('span',config?.enabledModules?.includes(id)?'已启用':'未启用',row,'chip '+(config?.enabledModules?.includes(id)?'chip-ok':'chip-outline'));elem('span',description,row,'d')}
  const ruleHead=elem('div','',root,'section-head');elem('h2','规则',ruleHead,'h2');const cols=elem('div','',root,'rule-cols'),hard=elem('section','',cols,'sys-panel stack'),user=elem('section','',cols,'panel stack');elem('h3','系统固定约束',hard,'h3');note(hard,'对所有人物和用途生效，人物规则不能覆盖。')
  for(const text of ['来源、权限、快照或持久化校验失败时拒绝操作。','人物变化、关系与目标保留明确确认和有效依据。','不进行后台执行、自动摘要、自动采纳或自动压缩。']){const row=elem('div','',hard,'rule');row.append(icon('lock'));elem('p',text,row,'tx')}
  elem('h3','人物与用途规则',user,'h3');const guidance=config?.constraints?.guidance??[];if(!guidance.length)elem('p','当前没有额外的用途规则。',user,'empty-line');for(const g of guidance){const row=elem('div','',user,'rule');row.append(icon('user'));elem('p',g.text,row,'tx')}
  const controls=fold(root,'管理用途、模块与规则');command(controls,'/memcont help modules');details(controls,'当前真实运行配置',config??{说明:'未显式配置能力模块，保持默认关闭'})
 }
 const render=()=>{
  epoch++;hideReview();const root=$('content');root.replaceChildren();$('nav').replaceChildren();for(const group of ['人物','记忆','对话','管理']){const section=elem('div','',$('nav'),'nav-group');elem('div',group,section,'nav-title');for(const [key,label,g,_glyph]of pages.filter(p=>p[2]===group)){const b=button(section,label,()=>go(key),'nav-item');const glyph=({people:'users',profile:'user',documents:'source',experiences:'book',relations:'arrows',goals:'target',growth:'sprout',diary:'edit',inject:'layers',continuity:'thread',rules:'sliders',budget:'target',settings:'sliders'} as Record<string,string>)[key];b.prepend(icon(glyph));if(key==='inject')elem('span','重点',b,'nav-tag');b.setAttribute('aria-current',page===key?'page':'false')}}
  if(!snapshot)return;const p=current();$('person-name').textContent=personName(p);$('person-avatar').textContent=personName(p).slice(0,1);$('viewing-note').textContent=p?.personId===snapshot.context?.personId?'也是当前聊天使用的人物':'查看人物不会切换当前聊天。';$('person-menu').hidden=true;$('person-picker').setAttribute('aria-expanded','false');if(p&&p.personId!==snapshot.context?.personId){elem('div','正在查看「'+personName(p)+'」。当前聊天使用「'+personName(snapshot.persons.find((x:any)=>x.personId===snapshot.context?.personId))+'」。',root,'callout callout-cand').setAttribute('role','note')}
  if(page==='new'){createPerson(root);return}if(page==='people'){renderPeople(root);return}if(page==='inject'){renderInjection(root);return}if(page==='continuity'){renderContinuity(root);return}if(page==='rules'){renderRules(root);return}
  if((p||['budget','settings'].includes(page))&&extensions(page,root,{snapshot,selected,elem,title,card,note,input,select,button,details,chip,preview,api,message,setBusy,command,fold,icon}))return
  if(!p){title(root,'先定义一个人物','人物的经历、关系与成长将在这里延续。');empty(root,'当前没有可查看人物。');button(root,'新建人物',()=>go('new'),'btn btn-primary');return}
  if(page==='profile')renderProfile(root,p);else if(page==='experiences')renderExperiences(root,p);else if(page==='relations')renderRelations(root,p);else if(page==='goals')renderGoals(root,p);else if(page==='growth')renderGrowth(root,p)
 }
 let theme='system';try{const saved=localStorage.getItem('memcont-theme')??localStorage.getItem('urp-workbench-theme');if(saved&&['light','dark','system'].includes(saved))theme=saved}catch{}
 const applyTheme=()=>{if(theme==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme;for(const b of $('theme').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.theme===theme))}
 for(const [value,label,glyph]of [['light','浅色','☀'],['dark','深色','☾'],['system','跟随系统','◐']]){const b=elem('button','',$('theme'));b.append(icon(value==='light'?'sun':value==='dark'?'moon':'monitor'));elem('span',label,b,'t-label');b.type='button';b.dataset.theme=value;b.title=label;b.setAttribute('aria-label',label);b.onclick=()=>{theme=value;applyTheme();try{localStorage.setItem('memcont-theme',theme)}catch{}}}applyTheme()
 $('menu').replaceChildren(icon('menu'));$('refresh').replaceChildren(icon('refresh'));$('viewing-label').prepend(icon('eye'));$('person-picker').append(icon('chevDown'));$('new').prepend(icon('plus'));$('close').replaceChildren(icon('power'));$('close').setAttribute('aria-label','关闭管理入口');$('close').setAttribute('title','关闭管理入口');
 $('person-picker').onclick=()=>{if(busy||closed||!snapshot)return;const menu=$('person-menu');menu.hidden=!menu.hidden;$('person-picker').setAttribute('aria-expanded',String(!menu.hidden));menu.replaceChildren();for(const p of snapshot.persons){const b=button(menu,'',()=>{selected=p.personId;$<HTMLSelectElement>('person').value=selected;render()},'');elem('span',personName(p).slice(0,1),b,'avatar sm');elem('span',personName(p),b,'pm-name');if(p.personId===selected)b.append(icon('check'))}button(menu,'管理全部人物',()=>go('people'),'')};
 $('menu').onclick=()=>drawer($('menu').getAttribute('aria-expanded')!=='true');$('scrim').onclick=()=>drawer(false);document.addEventListener('keydown',e=>{if(e.key==='Escape')drawer(false)})
 $('brand').onclick=e=>{e.preventDefault();go('people')};$('new').onclick=()=>go('new');$('person').onchange=()=>{if(!busy&&!closed){selected=$<HTMLSelectElement>('person').value;render()}}
 $('refresh').onclick=()=>{if(!busy&&!closed)refresh().catch(fail)}
 for(const id of ['cancel','cancel-x'])$(id).onclick=closeModal;$<HTMLDialogElement>('review').oncancel=e=>{e.preventDefault();closeModal()}
 const askClose=()=>{if(busy||closed)return;closeReview=true;reviewId='';$('review-summary').replaceChildren();note($('review-summary'),'关闭会撤销当前管理入口并清空页面记录；宿主聊天不受影响。再次管理需要通过 /memcont person manage 获取新地址。');$('review-body').textContent='撤销本次管理凭证';showReview('关闭管理入口？')}
 $('close').onclick=askClose;$('close-side').onclick=askClose
 $('confirm').onclick=async()=>{if(busy||closed)return;if(closeReview){setBusy(true);try{await api.request('close');message('管理入口已关闭。')}catch(e){fail(e)}finally{setBusy(false)}return}if(!reviewId)return
  const confirmed=reviewId;setBusy(true);$('review-error').textContent='';try{await api.request('confirm',{id:confirmed});if(closed)return;$<HTMLDialogElement>('review').close();reviewId='';if(page==='new')page='people';await refresh('已确认写入并重新读取。旧聊天如提示上下文失效，请干净续接。')}catch(e){fail(e)}finally{setBusy(false)}
 }
 refresh().catch(fail)
}
