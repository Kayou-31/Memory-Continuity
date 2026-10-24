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
const draft={schemaVersion:1,kind:'person-draft',personId:'erin',fields:[
 {fieldId:'name',kind:'identity',value:'林澈',policy:'stable'},
 {fieldId:'background',kind:'background',value:'在钟楼旁长大，喜欢修理旧物。测试文本 <img src=x onerror=alert(1)> 应当原样显示。',policy:'growable'},
 {fieldId:'care',kind:'trait',value:'谨慎，但愿意尝试新事物',policy:'growable'},
 {fieldId:'values',kind:'values',value:'重视承诺与诚实',policy:'stable'},
 {fieldId:'voice',kind:'voice',value:'自然、温和地说话',policy:'stable'}],relationships:[],goals:[]}
const preview=JSON.parse(ok(await f.command(a,'person preview '+JSON.stringify(draft))))
ok(await f.command(a,'person confirm '+preview.previewId));ok(await f.command(a,'person use erin'));ok(await f.command(a,'injection set {}'))
const live=JSON.parse(ok(await f.command(a,'person manage')))
await fs.writeFile(path.resolve('work/frontend-integration-2026-10-24/browser-session.json'),JSON.stringify({url:live.url,directory,sessionId:a.id},null,2))
console.log(JSON.stringify({url:live.url,directory,sessionId:a.id}))
const keep=setInterval(()=>{},30000)
let finishing=false
async function finish(){if(finishing)return;finishing=true;clearInterval(keep);await fs.writeFile(path.join(directory,'final-status.json'),JSON.stringify({status:f.rp.status(a.id),modelCalls:f.calls()},null,2));await f.dispose();console.log('Browser acceptance host disposed; offline model calls='+f.calls())}
process.on('SIGINT',()=>finish().catch(e=>{console.error(e);process.exitCode=1}))
process.on('SIGTERM',()=>finish().catch(e=>{console.error(e);process.exitCode=1}))
