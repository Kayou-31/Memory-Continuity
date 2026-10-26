/** Serialized with the existing workbench entry; no remote assets or framework. */
export function workbenchExtensions(page:string,root:HTMLElement,u:any):boolean {
 const {snapshot,selected,elem,title,card,note,input,select,button,details,chip,preview,api,message,setBusy,command,fold,icon}=u
 const read=async(kind:string,id:string)=>api.request('read',{kind,personId:selected,id})
 const download=(name:string,text:string)=>{const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=elem('a','',root);a.href=url;a.download=name;a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 const categories={persona:'人物',rule:'规则',program:'程序 / 行为流程',memory:'记忆资料',knowledge:'知识',unclassified:'待分类'}
 if(page==='settings'){
  title(root,'工作台设置','这些偏好只影响工作台的交互，不改变记忆权限。')
  const c=card(root,'修改前提示对后续对话的影响'),choice=select(c,'影响提示',{on:'开启弹窗（默认）',off:'关闭弹窗，在页面内预览'},snapshot.preferences.impactConfirmation?'on':'off')
  note(c,'关闭后仍须点击确认写入。创建人物和隐私删除保留必要确认；不会关闭权限、来源或版本检查。')
  button(c,'保存提醒偏好',()=>preview('settings',{impactConfirmation:choice.value==='on'}),'btn btn-primary')
  note(c,'本机 profile 内持久保存；不向 AI 开放此设置。');return true
 }
 if(page==='budget'){
  title(root,'记忆预算','完整人物、相关往事、全局记忆和已返回的工具内容，共用一份总额。')
  const binding=snapshot.context?.memoryBudget,c=card(root,'当前预算'),usage=snapshot.context?.memoryUsage
  chip(c,binding?binding.limitTokens.toLocaleString()+' 总上限':'尚未启用 token 预算')
  note(c,binding?.meter.mode==='tokenizer-text'?'使用已校验的本地模型 tokenizer 计量文本 token。':'当前模型未匹配精确 tokenizer，使用 conservative-utf8 保守估算；中文容量不等于精确 token 容量。')
  details(c,'模型与计量身份',binding??snapshot.context?.model??{});if(snapshot.context?.diagnostic?.requestCost){const cost=snapshot.context.diagnostic.requestCost;note(c,'当前输入已预留 '+cost.requests+' 次适配器请求，上限 '+cost.limits.maxRequestsPerInput+' 次；每步重试上限 '+cost.limits.maxRetriesPerStep+' 次。');note(c,'这不是供应商账单，也无法统计适配器内部 HTTP 重试。')}if(usage)details(c,'最近实际请求的用量',usage);else note(c,'尚无本次会话的实际请求计量。注入预览不会制造真实模型结果。')
  const form=fold(root,'调整总额与分层上限'),limit=input(form,'总记忆上限（1–32768）',String(binding?.limitTokens??32768)),fields:any={};limit.type='number';limit.min='1';limit.max='32768'
  const layerFields=elem('div','',form,'form-grid');for(const [key,label]of Object.entries({self:'自我核心',situation:'当前处境',relationships:'关系背景',recollection:'相关往事',unfinished:'未完成事项'}))fields[key]=input(layerFields,label+'上限',String(binding?.layers[key]??({self:6144,situation:4096,relationships:4096,recollection:12288,unfinished:4096} as any)[key]))
  note(form,'只能在空白根会话修改；有历史时先干净续接。总记忆预算仍受模型总上下文、输出及工具预留限制。各层是上限，不代表一定填满。')
  button(form,'预览预算修改',()=>preview('host-budget',{config:{limitTokens:Number(limit.value),layers:Object.fromEntries(Object.entries(fields).map(([k,v]:[string,any])=>[k,Number(v.value)]))}}),'btn btn-primary')
  button(form,'预览恢复旧字节配置',()=>preview('host-budget',{config:null}));return true
 }
 if(page==='documents'){
  const pageHead=title(root,'完整人物资料','完整保留原文，按章节分类并明确适用范围。导入本身不把资料变成已发生的事实。')
  const form=fold(root,'＋ 导入或修订资料'),meta=elem('div','',form,'form-grid'),docId=input(meta,'资料编号','doc_'+Date.now().toString(36)),docTitle=input(meta,'资料标题','人物资料'),format=select(meta,'文件格式',{markdown:'Markdown',text:'纯文本'}),file=input(meta,'选择 UTF-8 文件');file.type='file';file.accept='.md,.markdown,.txt,text/plain,text/markdown'
  const body=input(form,'完整原文','',true,1048576),bytes=note(form,'每份资料最多 1 MiB UTF-8；文件选择后可检查原文。'),staging=elem('div','',root,'workbench-body');let previousEventId:string|undefined,uploadId='',policies:any[]|undefined,loadedText:string|undefined,loadedView=''
  form.addEventListener('input',()=>{if(staging.childElementCount){staging.replaceChildren();note(staging,'原文或信息已修改，请重新解析后再保存。')}})
  body.oninput=()=>{bytes.textContent=new TextEncoder().encode(loadedText!==undefined&&body.value===loadedView?loadedText:body.value).length.toLocaleString()+' UTF-8 字节'}
  file.onchange=async()=>{const f=file.files?.[0];if(!f)return;try{if(f.size>1048576)throw Error('文件超过 1 MiB，请自行整理后重新选择；不会截断。');const value=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await f.arrayBuffer());body.value=value;loadedText=value;loadedView=body.value;body.oninput();format.value=/\.(md|markdown)$/i.test(f.name)?'markdown':'text';docTitle.value=f.name}catch(e){message(String(e),true)}}
  button(form,'解析并检查分类',async()=>{
   const original=new TextEncoder().encode(loadedText!==undefined&&body.value===loadedView?loadedText:body.value);if(!original.length||original.length>1048576)throw Error('原文须为 1 字节至 1 MiB。')
   let binary='';for(let offset=0;offset<original.length;offset+=8192)binary+=String.fromCharCode(...original.subarray(offset,offset+8192))
   setBusy(true);try{
    if(uploadId)await api.request('discard-upload',{id:uploadId});uploadId=''
    const uploaded=await api.request('upload',{personId:selected,documentId:docId.value,title:docTitle.value,mime:format.value==='markdown'?'text/markdown':'text/plain',encoding:'utf8',base64:btoa(binary),...(previousEventId?{previousEventId}:{})});uploadId=uploaded.id;staging.replaceChildren()
    const ready=card(staging,'核对分类与注入范围');note(ready,'临时草稿保留 10 分钟，尚未写入人物。下方修改只改变分类与条件；原文保持完整。');chip(ready,uploaded.draft.utf8Bytes.toLocaleString()+' 字节');details(ready,'原文校验与分段', {sha256:uploaded.draft.sha256,sections:uploaded.draft.sections.length,chunks:uploaded.draft.chunks.length})
    if(uploaded.revisionReview){const r=uploaded.revisionReview;note(ready,'修订核对：'+r.matches.length+' 个章节可对应旧稿，'+r.unmatchedNext.length+' 个新章节需要重新检查。旧条件不会因标题相似而自动启用。');details(ready,'查看章节对应建议',r)}
    const values=uploaded.draft.sections.map((s:any)=>{
     const old=policies?.find(p=>p.sectionId===s.sectionId),row=card(ready,s.title),category=select(row,'分类',categories,old?.category??s.category),label=input(row,'自定义分类标签',old?.label??s.title),tags=input(row,'标签（逗号分隔）',old?.tags.join(', ')??''),enabled=select(row,'注入资格',{yes:'允许按条件选入',no:'仅保存，不注入'},old?.enabled===true?'yes':'no'),kind=select(row,'对话类型',{all:'全部授权对话',direct:'仅私聊',group:'仅群聊'},old?.when.kind??'all')
     const filters=elem('details','',row,'mc-details');elem('summary','进一步限定平台、账号与参与者',filters)
     const platform=input(filters,'平台（留空不限）',old?.when.platform??''),accountId=input(filters,'账号（留空不限）',old?.when.accountId??''),senderIds=input(filters,'发送者编号（逗号分隔）',old?.when.senderIds?.join(', ')??''),groupIds=input(filters,'群编号（逗号分隔）',old?.when.groupIds?.join(', ')??''),sceneIds=input(filters,'场景编号（逗号分隔）',old?.when.sceneIds?.join(', ')??'')
     const match=uploaded.revisionReview?.matches.find((m:any)=>m.nextSectionId===s.sectionId)
     if(match){note(row,match.textChanged?'正文有变化，请重新检查分类与适用对象。':'原文与旧稿一致。');if(match.suggestedPolicy){details(row,'建议沿用的旧条件',match.suggestedPolicy);button(row,'将旧条件填入草稿，继续核对',()=>{const p=match.suggestedPolicy;category.value=p.category;label.value=p.label;tags.value=p.tags.join(', ');enabled.value=p.enabled?'yes':'no';kind.value=p.when.kind;platform.value=p.when.platform??'';accountId.value=p.when.accountId??'';senderIds.value=p.when.senderIds?.join(', ')??'';groupIds.value=p.when.groupIds?.join(', ')??'';sceneIds.value=p.when.sceneIds?.join(', ')??'';message('旧条件已填入当前草稿；尚未保存，请核对后预览确认。')},'btn btn-sm')}}
     return ()=>{const split=(s:string)=>s.split(/[,，]/).map(v=>v.trim()).filter(Boolean);return {sectionId:s.sectionId,category:category.value,label:label.value,tags:split(tags.value),enabled:enabled.value==='yes',when:{kind:kind.value,...(platform.value?{platform:platform.value}:{}),...(accountId.value?{accountId:accountId.value}:{}),...(senderIds.value?{senderIds:split(senderIds.value)}:{}),...(groupIds.value?{groupIds:split(groupIds.value)}:{}),...(sceneIds.value?{sceneIds:split(sceneIds.value)}:{})}}}
    })
    button(ready,'预览保存资料',()=>preview('document-import',{uploadId:uploaded.id,policies:values.map((v:any)=>v())}),'btn btn-primary')
    button(ready,'取消这份草稿',async()=>{await api.request('discard-upload',{id:uploaded.id});uploadId='';staging.replaceChildren();message('已取消临时草稿，没有导入资料。')})
    details(ready,'宿主短指令（使用默认分类，不包含此处未保存的调整）',uploaded.command);message('原文已解析，尚未确认写入。')
   }finally{setBusy(false)}
  },'btn btn-primary')
  button(pageHead,'导入资料',()=>{form.parentElement.open=true;form.scrollIntoView({behavior:'smooth'})},'btn btn-primary').prepend(icon('plus'));const list=elem('section','',root,'stack-lg'),listHead=elem('div','',list,'section-head');elem('h2','已经保存的资料',listHead,'h2');elem('span',snapshot.documents.filter((d:any)=>d.personId===selected&&d.status==='active').length+' 份原文',listHead,'sub');if(!snapshot.documents.some((d:any)=>d.personId===selected)){const welcome=card(list,'把完整的故事留下来');note(welcome,'身份、语气、习惯，或还没想好如何归类的一段文字。原文会被完整保留，何时进入对话由你决定。');button(welcome,'导入第一份资料',()=>{form.parentElement.open=true;form.scrollIntoView({behavior:'smooth'})},'btn btn-primary')}for(const d of snapshot.documents.filter((d:any)=>d.personId===selected)){
   const row=elem('article','',list,'panel stack mc-document-entry'),head=elem('div','',row,'row-between');elem('h3',d.title,head,'h2');elem('span',d.status==='active'?d.bytes.toLocaleString()+' 字节':'已撤回',head,'chip chip-outline');note(row,'原文完整保存 · '+d.documentId)
   if(d.status!=='active')continue;const actions=elem('div','',row,'mc-actions')
   const reader=elem('section','',row,'mc-document-reader');reader.hidden=true;button(actions,'查看原文',async()=>{const r=await read('document',d.documentId);reader.replaceChildren();reader.hidden=false;elem('h4','完整原文',reader,'h3');elem('div',r.draft.text,reader,'mc-reading');button(reader,'收起原文',()=>{reader.hidden=true},'btn btn-sm btn-ghost')},'btn btn-sm btn-primary');const more=fold(row,'导出、修订与撤回'),secondary=elem('div','',more,'row')
   button(secondary,'导出原文',async()=>{const r=await read('document',d.documentId);download(r.draft.documentId+(r.draft.format==='markdown'?'.md':'.txt'),r.draft.text)})
   button(secondary,'载入修订',async()=>{const r=await read('document',d.documentId);docId.value=r.draft.documentId;docTitle.value=r.draft.title;format.value=r.draft.format;body.value=r.draft.text;loadedText=r.draft.text;loadedView=body.value;body.oninput();previousEventId=r.eventId;policies=r.policies;form.parentElement.open=true;form.scrollIntoView({behavior:'smooth'});message('已载入当前版本；修改原文后重新解析，再预览保存。')})
   button(secondary,'预览撤回',()=>preview('document-retract',{personId:selected,documentId:d.documentId}),'btn btn-danger-ghost')
  }return true
 }
 if(page==='diary'){
  const pageHead=title(root,'共同日记','你写今天的感受，它记录自己的理解。每篇保留作者，修订保留原稿；日记不自动成为事实。')
  const board=snapshot.diaries.find((v:any)=>v.personId===selected),layout=elem('div','',root,'mc-reading-layout'),main=elem('div','',layout,'stack-lg'),aside=elem('aside','',layout,'stack-lg'),settings=card(aside,'这本日记'),allowed=!!board?.settings?.allowAgentWrite
  note(settings,board?.settings?(allowed?'已允许 AI 在实际对话中写自己的日记。':'当前仅开放人类写入；AI 写入未开启。'):'还没有建立共同日记。请先明确保存权限。')
  const permissions=fold(settings,'管理共同写作权限'),permission=select(permissions,'允许 AI 写自己的日记',{no:'关闭',yes:'开启'},allowed?'yes':'no')
  button(permissions,'预览日记权限',()=>preview('diary-configure',{personId:selected,allowAgentWrite:permission.value==='yes'}),'btn btn-primary')
  note(settings,'开启后仍没有后台写作。AI 只能在获授权的当前会话调用工具，不能替你写、改人类日记或改权限。')
  if(!board?.settings){const welcome=elem('section','',main,'mc-journal-welcome');elem('div','共同日记',welcome,'eyebrow');elem('h2','今天，想留下一点什么？',welcome,'h1');elem('p','可以是一起度过的一天，也可以是一句还想再说的话。你和它各自写下的内容，会带着各自的名字留在这里。',welcome,'lede');button(welcome,'建立这本日记',()=>preview('diary-configure',{personId:selected,allowAgentWrite:false}),'btn btn-primary');note(welcome,'先建立人类可写的日记。是否允许 AI 写作，之后由你决定。');return true}
  const form=fold(main,'写下今天'),heading=input(form,'标题','今天'),body=input(form,'日记正文','',true,16384),extra=fold(form,'编号、依据与修订说明（可选）'),entryId=input(extra,'日记编号','day_'+Date.now().toString(36)),reflection=input(extra,'理解与修订说明（可选 JSON）','',true,16384);let previousEventId:string|undefined;button(pageHead,'写日记',()=>{form.parentElement.open=true;heading.focus();form.scrollIntoView({behavior:'smooth'})},'btn btn-primary').prepend(icon('edit'))
  note(reflection.parentElement.parentElement,'可记录理解、情境、不确定性、修订原因及认证依据。修改旧日记时，原有说明会一起载入。')
  button(form,'预览保存日记',()=>preview('diary-write',{personId:selected,draft:{entryId:entryId.value,title:heading.value,body:body.value,...(previousEventId?{previousEventId}:{}),...(reflection.value.trim()?{reflection:JSON.parse(reflection.value)}:{})}}),'btn btn-primary')
  const list=elem('section','',main,'stack-lg'),listHead=elem('div','',list,'section-head');elem('h2','已经写下的日子',listHead,'h2');elem('span',board.listing.items.length+' 篇',listHead,'sub');if(!board.listing.items.length){const welcome=elem('section','',list,'mc-journal-welcome');elem('h3','第一页，还空着。',welcome,'h2');note(welcome,'不必写得完整，也不必每天都写。留下一件你想记住的小事就好。');button(welcome,'写第一篇日记',()=>{form.parentElement.open=true;form.scrollIntoView({behavior:'smooth'})},'btn btn-primary')};if(board.listing.truncated)note(list,'当前显示最多 32 篇；完整列表与关键词搜索可用宿主 diary list。')
  for(const e of board.listing.items){const row=elem('article','',list,'panel stack mc-journal-entry'),head=elem('div','',row,'row-between');elem('h3',e.title,head,'h2');const tags=elem('div','',head,'row');elem('span',e.author==='agent'?'AI 原作':'人类原作',tags,'chip chip-outline');if(e.editor!==e.author)elem('span','经人类修订',tags,'chip chip-cand');const excerpt=elem('p',e.excerpt.startsWith(e.title)?e.excerpt.slice(e.title.length).trimStart():e.excerpt,row,'mc-reading');const actions=elem('div','',row,'row'),reader=elem('section','',row,'mc-document-reader');reader.hidden=true
   button(actions,'阅读全文',async()=>{const r=await read('diary',e.entryId);reader.replaceChildren();reader.hidden=false;excerpt.hidden=true;elem('div',r.draft.body,reader,'mc-reading');details(reader,'作者、修订与依据',r);button(reader,'收起正文',()=>{reader.hidden=true;excerpt.hidden=false},'btn btn-sm btn-ghost')},'btn btn-sm btn-primary')
   button(actions,'载入修订',async()=>{const r=await read('diary',e.entryId);entryId.value=r.draft.entryId;heading.value=r.draft.title;body.value=r.draft.body;reflection.value=r.draft.reflection?JSON.stringify(r.draft.reflection,null,2):'';previousEventId=r.eventId;form.parentElement.open=true;form.scrollIntoView({behavior:'smooth'});message('载入了当前版本。保存会保留原作者与修订历史。')})
   const more=fold(row,'历史、导出与隐私'),secondary=elem('div','',more,'row');button(secondary,'查看原稿与修订',async()=>{details(row,'全部有效版本',await read('diary-history',e.entryId)).open=true})
   button(secondary,'导出当前日记',async()=>{const r=await read('diary',e.entryId);download(e.entryId+'.json',JSON.stringify(r,null,2))})
   button(secondary,'预览隐私删除',()=>preview('diary-delete',{personId:selected,entryId:e.entryId}),'btn btn-danger-ghost')
  }return true
 }
 return false
}
