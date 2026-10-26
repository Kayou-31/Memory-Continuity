import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
const input=JSON.parse(process.env.OWNER_TEST_INPUT),core=await import(pathToFileURL(input.bundle).href)
let lease
// Keep the IPC endpoint alive before a fault intentionally parks recovery.
process.on('message',async message=>{if(message==='release'){await lease?.release();process.send({ok:true});process.disconnect()}})
try{
 if(input.mode==='recover'){
  if(input.pauseRecovery){const unlink=fs.unlink;fs.unlink=async file=>{if(path.basename(String(file))==='owner.lock'){process.send({phase:'before-unlink'});await new Promise(()=>{})}return unlink(file)}}
  const result=await core.recoverProfileOwner(input.root,input.expected);process.send({ok:true,result})
 }else{lease=await core.acquireProfileOwner({profileRoot:input.root,kind:'service'});process.send({ok:true})}
}catch(error){process.send({ok:false,code:error.code,message:error.message})}
