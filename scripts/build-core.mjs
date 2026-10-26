import './workbench-style.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {createHash,randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {build,stop} from 'esbuild'

const root=fileURLToPath(new URL('../',import.meta.url)),req=createRequire(import.meta.url),args=process.argv.slice(2)
if(args.length&&!(args.length===2&&args[0]==='--out'))throw Error('Usage: node scripts/build-core.mjs [--out NEW_DIRECTORY]')
const output=args.length?path.resolve(args[1]):path.join(root,'work/core-package','stage-'+Date.now()+'-'+randomUUID().slice(0,8))
await fs.mkdir(path.dirname(output),{recursive:true});await fs.mkdir(output)
const manifest=JSON.parse(await fs.readFile(path.join(root,'packages/core/package.json'),'utf8'))
await fs.writeFile(path.join(output,'package.json'),JSON.stringify(manifest,null,2)+'\n')
await fs.copyFile(path.join(root,'packages/core/README.md'),path.join(output,'README.md'))
await fs.copyFile(path.join(root,'LICENSE'),path.join(output,'LICENSE'))
const types=spawnSync(process.execPath,[req.resolve('typescript/bin/tsc'),'-p',path.join(root,'tsconfig.core.json'),'--declarationDir',path.join(output,'lib/types')],{cwd:root,stdio:'inherit',windowsHide:true})
if(types.status!==0)process.exit(types.status??1)
try{
 const built=await build({absWorkingDir:root,entryPoints:{index:'src/core/index.ts',cli:'src/core/cli.ts'},outdir:path.join(output,'lib'),bundle:true,format:'esm',platform:'node',target:'node22',charset:'utf8',sourcemap:'linked',sourcesContent:true,external:['node:*'],metafile:true,logLevel:'silent'})
 for(const o of Object.values(built.metafile.outputs))for(const i of o.imports)if(i.external&&!i.path.startsWith('node:'))throw Error('Core runtime must not import external package '+i.path)
 for(const name of Object.keys(built.metafile.inputs))if(name.includes('node_modules')||name.includes('rp-plugin'))throw Error('Unexpected host dependency in core '+name)
 await fs.cp(path.join(root,'assets'),path.join(output,'assets'),{recursive:true})
 const files=[],hash=bytes=>createHash('sha256').update(bytes).digest('hex')
 async function walk(relative=''){for(const entry of (await fs.readdir(path.join(output,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=relative?relative+'/'+entry.name:entry.name;if(entry.isDirectory())await walk(name);else{const bytes=await fs.readFile(path.join(output,name));files.push({path:name,bytes:bytes.length,sha256:hash(bytes)})}}}
 await walk()
 const sources=[];for(const name of Object.keys(built.metafile.inputs).sort()){const bytes=await fs.readFile(path.join(root,name));sources.push({path:name.replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes)})}
 await fs.writeFile(path.join(output,'SOURCE-MANIFEST.json'),JSON.stringify({schemaVersion:1,package:manifest.name,version:manifest.version,entry:'src/core/index.ts',files,sources},null,2)+'\n')
 console.log(JSON.stringify({package:manifest.name,version:manifest.version,output,files:files.length}))
}finally{stop()}
