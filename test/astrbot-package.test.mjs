import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'

test('AstrBot package contains only reviewed adapter files, verifies its manifest and refuses overwrite',async()=>{
 const script=path.resolve('scripts/build-astrbot.py');assert.equal(await fs.stat(script).then(s=>s.isFile(),()=>false),true,'standalone AstrBot package builder is required')
 const dir=path.resolve('work/astrbot-package-tests',randomUUID());await fs.mkdir(dir,{recursive:true})
 const python=process.env.MEMCONT_PYTHON??(process.platform==='win32'?'python':'python3')
 const run=args=>{const r=spawnSync(python,args,{cwd:process.cwd(),encoding:'utf8',timeout:20000,windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout}
 const one=path.join(dir,'one.zip'),two=path.join(dir,'two.zip')
 const receipt=JSON.parse(run([script,'--out',one]));run([script,'--out',two])
 const bytes=await fs.readFile(one),checksum=createHash('sha256').update(bytes).digest('hex')
 assert.equal(checksum,receipt.sha256);assert.deepEqual(await fs.readFile(two),bytes)
 const duplicate=spawnSync(python,[script,'--out',one],{encoding:'utf8',timeout:20000,windowsHide:true});assert.notEqual(duplicate.status,0);assert.deepEqual(await fs.readFile(one),bytes)
 const verified=JSON.parse(run(['-c',`import ast,hashlib,json,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 names=z.namelist()
 assert len(names)==len(set(names))
 assert set(names)=={'main.py','core_client.py','metadata.yaml','_conf_schema.json','README.md','LICENSE','SOURCE-MANIFEST.json'}
 m=json.loads(z.read('SOURCE-MANIFEST.json'))
 assert {f['path'] for f in m['files']}==set(names)-{'SOURCE-MANIFEST.json'}
 for f in m['files']:
  b=z.read(f['path']);assert len(b)==f['bytes'] and hashlib.sha256(b).hexdigest()==f['sha256']
 for name in ['main.py','core_client.py']:ast.parse(z.read(name).decode('utf-8'),filename=name)
 assert json.loads(z.read('_conf_schema.json'))['enabled']['default'] is False
 print(json.dumps({'files':len(names),'manifestFiles':len(m['files'])}))`,one]))
 assert.equal(verified.files,7);await fs.writeFile(path.join(dir,'receipt.json'),JSON.stringify({...receipt,...verified},null,2))
 // Windows checkouts may use CRLF; preserve metadata bytes while parsing version.
 const clone=path.join(dir,'crlf-source');await fs.mkdir(path.join(clone,'scripts'),{recursive:true});await fs.mkdir(path.join(clone,'adapters/astrbot'),{recursive:true})
 await fs.copyFile(script,path.join(clone,'scripts/build-astrbot.py'));await fs.copyFile('LICENSE',path.join(clone,'LICENSE'))
 for(const name of ['main.py','core_client.py','metadata.yaml','_conf_schema.json','README.md'])await fs.copyFile(path.join('adapters/astrbot',name),path.join(clone,'adapters/astrbot',name))
 const metadata=path.join(clone,'adapters/astrbot/metadata.yaml');await fs.writeFile(metadata,(await fs.readFile(metadata,'utf8')).replace(/\r?\n/g,'\r\n'))
 const crlfZip=path.join(dir,'crlf.zip');run([path.join(clone,'scripts/build-astrbot.py'),'--out',crlfZip])
 run(['-c',`from pathlib import Path
import json,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.read('metadata.yaml')==Path(sys.argv[2]).read_bytes()
 assert json.loads(z.read('SOURCE-MANIFEST.json'))['version']=='0.1.0-preview.1'`,crlfZip,metadata])
})
