import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'

test('real core TGZ installs without DSH, writes and cold-reads memory, and verifies bundled assets',async()=>{
 const base=path.resolve('work/core-package-tests',randomUUID()),stage=path.join(base,'stage')
 await fs.mkdir(base,{recursive:true})
 const run=(args,cwd,label)=>{const r=spawnSync(process.execPath,args,{cwd,encoding:'utf8',timeout:120000,windowsHide:true});assert.equal(r.status,0,label+'\n'+r.stdout+'\n'+r.stderr);return r.stdout}
 run(['scripts/build-core.mjs','--out',stage],process.cwd(),'core package build')
 const npm=process.env.npm_execpath??process.env.MEMCONT_NPM_CLI;assert.ok(npm,'run with npm test or set MEMCONT_NPM_CLI')
 const packed=JSON.parse(run([npm,'pack','--json','--ignore-scripts','--pack-destination',base],stage,'core TGZ'))[0]
 assert.ok(packed.files.some(f=>f.path==='lib/index.js'))
 assert.ok(packed.files.some(f=>f.path==='assets/tokenizers/deepseek-v3.2/tokenizer.json'))
 assert.ok(!packed.files.some(f=>/node_modules|rp-plugin|\.py$/.test(f.path)))
 const isolate=path.resolve(process.env.MEMCONT_CORE_ISOLATION_ROOT??process.env.RUNNER_TEMP??'..','memory-continuity-core-acceptance',randomUUID())
 await fs.mkdir(isolate,{recursive:true});await fs.writeFile(path.join(isolate,'package.json'),JSON.stringify({name:'core-isolation-check',version:'1.0.0',private:true,type:'module'}))
 run([npm,'install','--offline','--ignore-scripts','--no-audit','--no-fund','--package-lock=false','--cache',path.join(base,'npm-cache'),path.join(base,packed.filename)],isolate,'offline isolated install')
 const installed=path.join(isolate,'node_modules/@memory-continuity/core'),pkg=JSON.parse(await fs.readFile(path.join(installed,'package.json'),'utf8'))
 assert.equal(pkg.name,'@memory-continuity/core');assert.deepEqual(pkg.dependencies??{},{});assert.deepEqual(pkg.peerDependencies??{},{})
 assert.deepEqual(pkg.bin,{'memcont-core':'./lib/cli.js'})
 const manifest=JSON.parse(await fs.readFile(path.join(installed,'SOURCE-MANIFEST.json'),'utf8'))
 for(const file of manifest.files){assert.ok(!file.path.includes('..'));const b=await fs.readFile(path.join(installed,file.path));assert.equal(b.length,file.bytes,file.path);assert.equal(createHash('sha256').update(b).digest('hex'),file.sha256,file.path)}
 const expected=packed.files.map(f=>f.path).filter(f=>f!=='SOURCE-MANIFEST.json').sort();assert.deepEqual(manifest.files.map(f=>f.path).sort(),expected)
 const smoke=path.join(isolate,'smoke.mjs');await fs.copyFile('test/fixtures/core/package-smoke.mjs',smoke)
 const write=JSON.parse(run([smoke,'write'],isolate,'isolated write + workbench'))
 const read=JSON.parse(run([smoke,'read'],isolate,'separate process cold read'))
 assert.deepEqual(read,write);assert.equal(read.name,'林澈');assert.equal(read.diary,'今天修好了钟楼。');assert.equal(read.tokenMode,'tokenizer-text')
 run([smoke,'owner-crash'],isolate,'separate process exits without releasing owner')
 const cli=path.join(installed,'lib/cli.js'),profile=path.join(isolate,'profile')
 const initialized=JSON.parse(run([cli,'init','--directory',path.join(isolate,'new-core'),'--entity','erin'],isolate,'packaged explicit initialization without DSH'))
 assert.equal(initialized.ok,true);assert.equal(JSON.parse(await fs.readFile(initialized.configFile,'utf8')).bindings[0].id,'main')
 const diagnostic=JSON.parse(run([cli,'owner','inspect','--profile',profile],isolate,'packaged owner diagnostic'));assert.equal(diagnostic.value.process,'dead')
 const stale=spawnSync(process.execPath,[cli,'owner','recover','--profile',profile,'--expected','0'.repeat(64)],{cwd:isolate,encoding:'utf8',timeout:15000,windowsHide:true});assert.equal(stale.status,1);assert.equal(JSON.parse(stale.stderr).code,'stale_input')
 assert.equal(JSON.parse(run([cli,'owner','recover','--profile',profile,'--expected',diagnostic.value.sha256],isolate,'explicit packaged owner recovery')).value,'recovered')
 assert.deepEqual(JSON.parse(run([smoke,'read'],isolate,'read after explicit owner recovery')),write)
 const serviceFixture=path.join(isolate,'service-process.mjs');await fs.copyFile('test/fixtures/core/service-process.mjs',serviceFixture)
 const service=JSON.parse(run([serviceFixture],isolate,'packaged service actual-process crash and cold confirmation'))
 assert.equal(service.coldReceiptSame,true);assert.equal(service.automaticReplay,false)
 await fs.appendFile(path.join(installed,'assets/tokenizers/deepseek-v3.2/tokenizer.json'),' ')
 run([smoke,'corrupt'],isolate,'tampered packaged tokenizer refuses startup')
 await fs.writeFile(path.join(base,'receipt.json'),JSON.stringify({tgz:path.join(base,packed.filename),isolate,files:manifest.files.length,write,read,service},null,2))
})
