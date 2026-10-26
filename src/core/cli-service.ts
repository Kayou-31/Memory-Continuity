import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createInterface} from 'node:readline'
import {openMemoryCore} from './owned-memory.js'
import {openCoreService} from './server.js'
import {id,object,RpError} from '../rp/validation.js'
import type {CoreBinding} from './rpc.js'

async function absent(file:string){try{await fs.lstat(file);throw new RpError('scope_denied','Connection file already exists; choose a new path instead of overwriting it')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}
async function writePrivate(file:string,body:string){
 await fs.mkdir(path.dirname(file),{recursive:true});const candidate=file+'.tmp-'+randomUUID()
 try{const handle=await fs.open(candidate,'wx',0o600);try{await handle.writeFile(body);await handle.sync()}finally{await handle.close()}await fs.link(candidate,file)}
 finally{await fs.unlink(candidate).catch(()=>{})}
}
/** Explicit foreground command. No scheduler, model request, or transport startup. */
export async function serveCore(configFile:string,connectionFile:string){
 if(!path.isAbsolute(configFile)||!path.isAbsolute(connectionFile))throw new RpError('invalid_record','Config and connection paths must be absolute')
 await absent(connectionFile)
 const stat=await fs.lstat(configFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw new RpError('invalid_record','Core config must be a regular JSON file of at most 64 KiB')
 let decoded:unknown;try{decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(configFile)))}catch{throw new RpError('invalid_record','Core config JSON is invalid')}
 const config=object(decoded,['schemaVersion','profileRoot','entityIds','bindings'])
 if(config.schemaVersion!==1||typeof config.profileRoot!=='string'||!path.isAbsolute(config.profileRoot)||!Array.isArray(config.entityIds)||config.entityIds.length>256||new Set(config.entityIds).size!==config.entityIds.length)throw new RpError('invalid_record','Unsupported core config')
 config.entityIds.forEach(id)
 const memory=await openMemoryCore({profileRoot:config.profileRoot,entityIds:config.entityIds,ownerKind:'service'})
 let server:Awaited<ReturnType<typeof openCoreService>>|undefined,body:string|undefined,lines:ReturnType<typeof createInterface>|undefined
 let stop:()=>void=()=>{}
 const signal=()=>stop()
 try{
  server=await openCoreService({memory,bindings:config.bindings as CoreBinding[]})
  body=JSON.stringify({schemaVersion:1,instanceId:randomUUID(),pid:process.pid,url:server.url,adminToken:server.adminToken},null,2)+'\n'
  await writePrivate(connectionFile,body)
  const stopped=new Promise<void>(resolve=>stop=resolve)
  process.on('SIGINT',signal);process.on('SIGTERM',signal)
  lines=createInterface({input:process.stdin,terminal:false});lines.on('line',line=>{if(['quit','exit','stop'].includes(line.trim()))stop()})
  // Administrative credentials live only in the explicit private connection file.
  console.log(JSON.stringify({ok:true,connectionFile,pid:process.pid,notice:'输入 quit 停止服务。没有启用模型发送或后台自动记忆。'}))
  await stopped
 }finally{
  lines?.close();process.stdin.pause();process.off('SIGINT',signal);process.off('SIGTERM',signal)
  try{if(server)await server.close();else await memory.close()}
  finally{if(body)try{if(await fs.readFile(connectionFile,'utf8')===body)await fs.unlink(connectionFile)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}
 }
}
