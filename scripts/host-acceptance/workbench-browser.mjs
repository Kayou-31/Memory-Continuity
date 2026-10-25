// Manual browser acceptance using real SDK and isolated data; never a production entry.
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
process.env.RP_ACCEPTANCE_LOOPBACK='1'
const {host}=await import('../../test/fixtures/rp/native-host.mjs')
const directory=path.resolve('work/frontend-integration-2026-10-24/browser-'+Date.now())
await fs.mkdir(directory,{recursive:true})
const install=process.env.RP_PERSON_BUNDLE?(await import(pathToFileURL(path.resolve(process.env.RP_PERSON_BUNDLE)))).installRpPlugin:undefined
const f=await host({entityIds:['erin','bea','kai']},{directory,...(install?{install}:{})})
const a=await f.create(),ok=r=>{if(r.kind!=='success')throw Error(r.text);return r.text}
ok(await f.command(a,'start'))
const visual=process.env.RP_WORKBENCH_VISUAL==='1'
const draft={schemaVersion:1,kind:'person-draft',personId:'erin',fields:[
 {fieldId:'name',kind:'identity',value:'林澈',policy:'stable'},
 {fieldId:'background',kind:'background',value:'在钟楼旁长大，喜欢修理旧物。测试文本 <img src=x onerror=alert(1)> 应当原样显示。',policy:'growable'},
 {fieldId:'care',kind:'trait',value:'谨慎，但愿意尝试新事物',policy:'growable'},
 {fieldId:'values',kind:'values',value:'重视承诺与诚实',policy:'stable'},
 {fieldId:'voice',kind:'voice',value:'自然、温和地说话',policy:'stable'}],relationships:[],goals:[]}
if(visual){
 draft.fields[1].value='在钟楼旁长大，喜欢修理旧物。如今经营一家小小的修理铺，慢慢认识这座海边的城。'
 draft.fields.push({fieldId:'boundary',kind:'boundaries',value:'尊重彼此的决定，不替别人许下承诺。',policy:'stable'},
  {fieldId:'mood',kind:'feeling',value:'修好了旧钟，心里轻松了一些。仍有点在意下一次见面时，会不会不知道说什么。',policy:'situational',validity:{kind:'sequence',from:1,through:99}},
  {fieldId:'stage',kind:'stage',value:'开始独立经营修理铺，正在学着向熟悉的人求助。',policy:'growable'})
 draft.relationships.push({targetId:'bea',relation:'trust',value:'愿意把尚未完成的想法告诉她，遇到难处时会向她请教。'})
 draft.goals.push({goalId:'sea',category:'promise',objective:'和贝雅一起去看海',nextAction:'选一个双方都有空的下午',targetEntityId:'bea'})
}
const preview=JSON.parse(ok(await f.command(a,'person preview '+JSON.stringify(draft))))
ok(await f.command(a,'person confirm '+preview.previewId));ok(await f.command(a,'person use erin'));ok(await f.command(a,'injection set {}'))
if(visual){
 const friend=JSON.parse(ok(await f.command(a,'person preview '+JSON.stringify({schemaVersion:1,kind:'person-draft',personId:'bea',fields:[{fieldId:'name',kind:'identity',value:'贝雅',policy:'stable'},{fieldId:'background',kind:'background',value:'住在书店楼上，喜欢替旧故事找到新的读者。',policy:'stable'}],relationships:[],goals:[]}))))
 ok(await f.command(a,'person confirm '+friend.previewId))
 ok(await f.command(a,'agent '+JSON.stringify({kind:'experience',actorIds:['erin','bea'],description:'两人一起修好了钟楼的旧钟。收拾工具时，约好下次抽空去海边走走。',fictionalTime:'钟楼修好后的傍晚',sourceRevisionIds:[]})))
}
const live=JSON.parse(ok(await f.command(a,'person manage')))
await fs.writeFile(path.resolve('work/frontend-integration-2026-10-24/browser-session.json'),JSON.stringify({url:live.url,directory,sessionId:a.id},null,2))
console.log(JSON.stringify({url:live.url,directory,sessionId:a.id}))
const keep=setInterval(()=>{fs.access(path.join(directory,'stop')).then(()=>finish()).catch(()=>{})},1000)
let finishing=false
async function finish(){if(finishing)return;finishing=true;clearInterval(keep);await fs.writeFile(path.join(directory,'final-status.json'),JSON.stringify({status:f.rp.status(a.id),modelCalls:f.calls()},null,2));await f.dispose();console.log('Browser acceptance host disposed; offline model calls='+f.calls())}
process.on('SIGINT',()=>finish().catch(e=>{console.error(e);process.exitCode=1}))
process.on('SIGTERM',()=>finish().catch(e=>{console.error(e);process.exitCode=1}))
