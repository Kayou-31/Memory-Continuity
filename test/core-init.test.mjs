import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {spawn,spawnSync} from 'node:child_process'
import {createInterface} from 'node:readline'
import {build,stop} from 'esbuild'

const base=path.resolve('work/core-init-tests',randomUUID());await fs.mkdir(base,{recursive:true})
const cli=path.join(base,'cli.mjs');await build({entryPoints:['src/core/cli.ts'],outfile:cli,bundle:true,platform:'node',format:'esm',target:'node22',logLevel:'silent'});stop()
const run=(directory,entity='erin')=>spawnSync(process.execPath,[cli,'init','--directory',directory,'--entity',entity],{encoding:'utf8',windowsHide:true,timeout:20000})

test('explicit new core directory produces a usable real configuration and foreground workbench without DSH',async t=>{
 const directory=path.join(base,'new'),created=run(directory)
 assert.equal(created.status,0,created.stderr)
 const result=JSON.parse(created.stdout);assert.equal(result.ok,true)
 const configFile=path.join(directory,'core-config.json'),config=JSON.parse(await fs.readFile(configFile,'utf8'))
 assert.equal(result.configFile,configFile);assert.deepEqual(config.entityIds,['erin'])
 assert.equal(config.profileRoot,path.join(directory,'profile'));assert.equal(config.bindings[0].id,'main')
 const connection=path.join(directory,'connection.json'),child=spawn(process.execPath,[cli,'serve','--config',configFile,'--connection',connection],{stdio:['pipe','pipe','pipe'],windowsHide:true})
 let stderr='';child.stderr.on('data',v=>stderr+=v)
 const exit=new Promise(resolve=>child.once('exit',(code)=>resolve(code)))
 const lines=createInterface({input:child.stdout});t.after(async()=>{lines.close();if(child.exitCode===null){child.stdin.end('quit\n');await exit}})
 const started=await Promise.race([new Promise(resolve=>lines.once('line',resolve)),exit.then(()=>{throw Error('service failed: '+stderr)})])
 assert.equal(JSON.parse(started).ok,true)
 const address=JSON.parse(await fs.readFile(connection,'utf8'))
 const call=async(route,payload={})=>{const response=await fetch(address.url+'/v1/admin/'+route,{method:'POST',headers:{authorization:'Bearer '+address.adminToken,'content-type':'application/json'},body:JSON.stringify(payload)});const body=await response.json();assert.equal(body.ok,true,JSON.stringify(body));return body.value}
 assert.deepEqual((await call('status')).bindings,['main'])
 const session=await call('session',{bindingId:'main'}),snapshot=await call('snapshot',{sessionId:session.sessionId})
 assert.deepEqual(snapshot.persons,[],'initialization must not invent person content')
 const workbench=await call('workbench',{sessionId:session.sessionId});assert.equal((await fetch(workbench.url)).status,200)
 child.stdin.end('quit\n');assert.equal(await exit,0,stderr)
 await assert.rejects(fs.stat(connection),{code:'ENOENT'})
 const before=await fs.readFile(configFile),duplicate=run(directory)
 assert.equal(duplicate.status,1);assert.deepEqual(await fs.readFile(configFile),before)
})

test('initialization rejects invalid identifiers and relative paths before creating data',async()=>{
 const directory=path.join(base,'invalid');assert.equal(run(directory,'../bad').status,1)
 await assert.rejects(fs.stat(directory),{code:'ENOENT'})
 const relative='relative-'+randomUUID();assert.equal(run(relative).status,1)
 await assert.rejects(fs.stat(relative),{code:'ENOENT'})
})

test('initialization preserves an existing or interrupted directory without migration or overwrite',async()=>{
 const directory=path.join(base,'existing');await fs.mkdir(directory)
 const marker=path.join(directory,'core-config.json.tmp-interrupted');await fs.writeFile(marker,'preserve me')
 assert.equal(run(directory).status,1);assert.equal(await fs.readFile(marker,'utf8'),'preserve me')
 assert.deepEqual(await fs.readdir(directory),['core-config.json.tmp-interrupted'])
})
