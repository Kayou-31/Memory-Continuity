// A real native SDK process. The parent kills it only after a durable rename/failed command handshake.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {host} from './native-host.mjs'
const [directory,operation,checkpoint]=process.argv.slice(2)
const bundle=process.env.RP_PERSON_BUNDLE?await import(pathToFileURL(path.resolve(process.env.RP_PERSON_BUNDLE)).href):undefined
const ok=r=>{if(r.kind!=='success')throw new Error(r.text);return r.text}
const sha=v=>createHash('sha256').update(v).digest('hex')
try{
 const f=await host({entityIds:['erin']},{directory,...(bundle?{install:bundle.installRpPlugin}:{})}),a=await f.create()
 ok(await f.command(a,'start'))
 const draft={schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'name',kind:'identity',value:'林澈',policy:'stable'}],relationships:[],goals:[]}
 const p=JSON.parse(ok(await f.command(a,'person preview '+JSON.stringify(draft))));ok(await f.command(a,'person confirm '+p.previewId));ok(await f.command(a,'person use erin'))
 const journal=path.join(f.profile,'.dsh-rp/v1/host',sha(a.id)+'.json'),original=await fs.readFile(journal)
 if(operation==='disable')ok(await f.command(a,'injection set {}'))
 if(!await f.ctx.sessions.flush(a.session))throw new Error('Native flush failed before checkpoint')
 const marker=journal.replace(/\.json$/,'.injection.json'),rename=fs.rename;let stage=0
 const hold=async()=>{await new Promise((resolve,reject)=>process.send({sessionId:a.id,originalSha256:sha(original),stage},e=>e?reject(e):resolve()));await new Promise(resolve=>process.once('message',resolve));throw new Error('Unexpected parent release')}
 fs.rename=async(from,to)=>{
  if(checkpoint==='marker-failure'&&to===marker)throw Object.assign(new Error('INJECTION_MARKER_EIO'),{code:'EIO'})
  if((to===journal||to===marker)&&checkpoint==='failure-'+(stage+1))throw Object.assign(new Error('INJECTION_TRANSITION_EIO_'+(stage+1)),{code:'EIO'})
  await rename(from,to)
  if((to===journal||to===marker)&&++stage===Number(checkpoint))await hold()
 }
 const result=await f.command(a,'injection set '+(operation==='enable'?'{}':'null'))
 if(!(checkpoint==='marker-failure'||checkpoint.startsWith('failure-'))||result.kind!=='error')throw new Error('Checkpoint not reached: '+JSON.stringify(result))
 await hold()
}catch(e){process.stderr.write(String(e?.stack??e));process.exit(1)}
