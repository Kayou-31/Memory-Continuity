/** Offline draft editor; host authorization is always repeated on import. */
import { personDraft } from './schema.js'
import { createDraftIds } from './editor-ids.js'
import type { PersonDraft, PersonField } from './types.js'
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const kinds = { identity:'身份', background:'背景', voice:'表达', values:'价值观', boundaries:'边界' }
const policies = { stable:'保持稳定', growable:'可经确认成长' }
const relations = { trust:'信任', affection:'亲近', loyalty:'忠诚', rivalry:'竞争', debt:'亏欠', promise:'承诺关系', kinship:'亲属', alliance:'同盟', tension:'矛盾' }
let key: (prefix:string)=>string
function input(parent: HTMLElement, title: string, value: string, multiline = false) {
  const label = document.createElement('label'), el = document.createElement(multiline ? 'textarea' : 'input'); label.textContent=title; el.value=value; el.maxLength=2048; label.append(el); parent.append(label); return el
}
function select(parent: HTMLElement, title: string, choices: Record<string,string>, value: string) {
  const label=document.createElement('label'), el=document.createElement('select'); label.textContent=title
  for (const [key,text] of Object.entries(choices)) { const option=document.createElement('option'); option.value=key; option.textContent=text; el.append(option) }
  el.value=value; label.append(el); parent.append(label); return el
}
function entry(container: string) { const el=document.createElement('div'); el.className='entry'; const remove=document.createElement('button'); remove.textContent='移除这一项'; remove.onclick=()=>el.remove(); el.append(remove); $(container).append(el); return el }
const readers = new WeakMap<HTMLElement, () => unknown>()
function field(value: PersonField) {
  const row=entry('fields'), kind=select(row,'项目',kinds,value.kind), content=input(row,'内容',value.value,true), policy=select(row,'改变方式',policies,value.policy)
  readers.set(row,()=>({fieldId:value.fieldId,kind:kind.value,value:content.value,policy:policy.value}))
}
function relationship(value: PersonDraft['relationships'][number]) {
  const row=entry('relationships'), target=input(row,'对方人物 ID',value.targetId), relation=select(row,'关系方向：我 → 对方',relations,value.relation), content=input(row,'起点',value.value)
  readers.set(row,()=>({targetId:target.value.trim(),relation:relation.value,value:content.value}))
}
function goal(value: PersonDraft['goals'][number]) {
  const row=entry('goals'), category=select(row,'愿望类型',{task:'个人目标',promise:'对另一个人的承诺'},value.category), objective=input(row,'想完成什么',value.objective), nextAction=input(row,'下一步',value.nextAction), target=input(row,'承诺对象 ID（个人目标可留空）',value.targetEntityId??'')
  readers.set(row,()=>({goalId:value.goalId,category:category.value,objective:objective.value,nextAction:nextAction.value,...(category.value==='promise'?{targetEntityId:target.value.trim()}:{})}))
}
function read() {
  const readRows=(id:string)=>[...$(id).children].map(row=>readers.get(row as HTMLElement)!())
  const raw={schemaVersion:1,kind:'person-draft',personId:$<HTMLInputElement>('personId').value.trim(),fields:readRows('fields'),relationships:readRows('relationships'),goals:readRows('goals')} as PersonDraft
  return personDraft(raw,new Set([raw.personId,...raw.relationships.map(r=>r.targetId),...raw.goals.flatMap(g=>g.targetEntityId?[g.targetEntityId]:[])]))
}
function generate() { const draft=read(), encoded=JSON.stringify(draft); $<HTMLTextAreaElement>('output').value='/rp person preview '+encoded; $('status').textContent=`草稿已检查：${draft.fields.length} 项定义，${draft.relationships.length} 条关系，${draft.goals.length} 个目标。宿主仍会核对实体与权限。`; return draft }
function run(work:()=>unknown) { try { work() } catch(e) { $('status').textContent='未生成：'+(e instanceof Error?e.message:String(e)); $<HTMLTextAreaElement>('output').value='' } }
function load(draft:PersonDraft) {
  key=createDraftIds(draft)
  $('fields').replaceChildren(); $('relationships').replaceChildren(); $('goals').replaceChildren(); $<HTMLInputElement>('personId').value=draft.personId
  draft.fields.forEach(field); draft.relationships.forEach(relationship); draft.goals.forEach(goal)
}
$('addField').onclick=()=>field({fieldId:key('field'),kind:'background',value:'',policy:'stable'})
$('addRelationship').onclick=()=>relationship({targetId:'',relation:'trust',value:''})
$('addGoal').onclick=()=>goal({goalId:key('goal'),category:'task',objective:'',nextAction:''})
$('generate').onclick=()=>run(generate)
$('download').onclick=()=>run(()=>{const draft=generate(),url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=draft.personId+'.person.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)})
$('copy').onclick=async()=>{try{generate();await navigator.clipboard.writeText($<HTMLTextAreaElement>('output').value);$('status').textContent='导入命令已复制。请在 DSH 中预览后确认。'}catch{$<HTMLTextAreaElement>('output').select();$('status').textContent='请选择上方命令并手动复制。'}}
$<HTMLInputElement>('importFile').onchange=async e=>{try{const file=(e.target as HTMLInputElement).files?.[0];if(!file)return;if(file.size>65536)throw Error('草稿超过 64 KiB');const raw=JSON.parse(await file.text()), known=new Set<string>([raw.personId,...(raw.relationships??[]).map((r:any)=>r.targetId),...(raw.goals??[]).flatMap((g:any)=>g.targetEntityId?[g.targetEntityId]:[])]);load(personDraft(raw,known));generate()}catch(e){$('status').textContent='导入失败：'+(e instanceof Error?e.message:String(e))}}
load({schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'},{fieldId:'background',kind:'background',value:'在钟楼旁长大，想找回故乡的线索。',policy:'stable'},{fieldId:'voice',kind:'voice',value:'温和、直接，遇到不确定的事会坦诚承认。',policy:'stable'},{fieldId:'values',kind:'values',value:'珍惜共同经历，认真对待承诺。',policy:'growable'},{fieldId:'boundaries',kind:'boundaries',value:'尊重彼此的选择。',policy:'stable'}],relationships:[],goals:[]})
