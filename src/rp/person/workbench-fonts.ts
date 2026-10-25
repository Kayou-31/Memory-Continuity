import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {workbenchFontHashes} from './workbench-font-manifest.js'
import {RpError} from '../validation.js'
/** A fixed public asset allowlist, independent of memory credentials and paths. */
export async function readWorkbenchFont(name:string):Promise<Buffer>{
 if(!Object.hasOwn(workbenchFontHashes,name))throw new RpError('source_unavailable','Unknown font asset')
 let directory=path.dirname(fileURLToPath(import.meta.url))
 for(let n=0;n<9;n++){
  let manifest:any
  try{manifest=JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'))}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
  if(manifest?.name==='@dsh-external/dsh-memory-continuity'||manifest?.name==='@memory-continuity/core'){
   const bytes=await fs.readFile(path.join(directory,'assets/fonts/noto-serif-sc',name))
   if(bytes.length>2*1024*1024||bytes.subarray(0,4).toString()!=='wOF2'||createHash('sha256').update(bytes).digest('hex')!==workbenchFontHashes[name])throw new RpError('store_corrupt','Font asset integrity mismatch')
   return bytes
  }
  const parent=path.dirname(directory);if(parent===directory)break;directory=parent
 }
 throw new RpError('source_unavailable','Packaged font assets unavailable')
}
