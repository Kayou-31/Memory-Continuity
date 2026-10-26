import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {RpError} from '../validation.js'
import {Tokenizer} from './vendor/tokenizers.mjs'
export const DEEPSEEK_MODEL='deepseek-ai/DeepSeek-V3.2'
export const DEEPSEEK_REVISION='a7e62ac04ecb2c0a54d736dc46601c5606cf10a6'
export const DEEPSEEK_SHA='cd050be35cae877f8f0aa847f45aa87e23835a56ca32b29b28545597852784e5'
const configSha='b5de6cc1c6758d02c0d3cec0efa062f1161654475458003f6f293f6ef28acdaa'
let tokenizer:Promise<Tokenizer>|undefined
async function packageRoot(){
  let dir=path.dirname(fileURLToPath(import.meta.url))
  for(let n=0;n<9;n++){
    try{const p=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8'));if(['@dsh-external/dsh-memory-continuity','@memory-continuity/core'].includes(p.name))return dir}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
    const parent=path.dirname(dir);if(parent===dir)break;dir=parent
  }
  throw new RpError('capability_missing','Packaged tokenizer assets unavailable')
}
export async function deepseekTokenizer(){
  tokenizer??=(async()=>{
    const root=path.join(await packageRoot(),'assets/tokenizers/deepseek-v3.2'),data=[]
    for(const [name,hash]of [['tokenizer.json',DEEPSEEK_SHA],['tokenizer_config.json',configSha]]){
      const bytes=await fs.readFile(path.join(root,name));if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new RpError('capability_missing','Packaged tokenizer integrity mismatch')
      data.push(JSON.parse(bytes.toString('utf8')))
    }
    return new Tokenizer(data[0],data[1])
  })()
  return tokenizer
}
