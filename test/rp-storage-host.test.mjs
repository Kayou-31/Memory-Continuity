import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {host} from './fixtures/rp/native-host.mjs'
const bundle=process.env.RP_PERSON_BUNDLE?await import(pathToFileURL(path.resolve(process.env.RP_PERSON_BUNDLE))):undefined
const ok=r=>{assert.equal(r.kind,'success',r.text);return r.text}
test('native manual storage upgrade changes only selected global scope with verified backup and no model calls',async()=>{
 const f=await host({},bundle?{install:bundle.installRpPlugin}:{})
 try{const a=await f.create();ok(await f.command(a,'global publish '+JSON.stringify({worldId:'life',key:'lore',body:'旧城历史'})));assert.equal(JSON.parse(ok(await f.command(a,'global storage-status {"worldId":"life"}'))).format,'v1');ok(await f.command(a,'global storage-enable {"worldId":"life"}'));const status=JSON.parse(ok(await f.command(a,'global storage-status {"worldId":"life"}')));assert.equal(status.format,'rp.global-segments/v1');assert.ok(status.backupId);assert.equal(JSON.parse(ok(await f.command(a,'global storage-status {}'))).format,'v1');assert.match(ok(await f.command(a,'global list {"worldId":"life"}')),/publication_/);assert.equal(f.calls(),0)}finally{await f.dispose()}
})
