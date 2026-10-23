import test from 'node:test'
import assert from 'node:assert/strict'
import {build,stop} from 'esbuild'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {setup} from './fixtures/rp/growth.mjs'
const file=path.resolve('work/rp-growth-tests/management-server.mjs')
await build({entryPoints:['src/rp/person/management-server.ts'],outfile:file,bundle:true,platform:'node',format:'esm',logLevel:'silent'});stop()
const {openManagementServer}=await import(pathToFileURL(file))
test('manual management server binds loopback, rejects foreign callers and never exposes its token in HTML',async()=>{
 const f=await setup();let server
 try{
  server=await openManagementServer(f.management.create(f.authority));const url=new URL(server.url),token=url.hash.slice(1);url.hash=''
  const html=await fetch(url);assert.equal(html.status,200);const body=await html.text();assert.match(body,/Ultra-RP-Memory/);assert.ok(!body.includes(token));assert.match(html.headers.get('content-security-policy'),/default-src 'none'/)
  const call=(headers={},data={})=>fetch(new URL('api/snapshot',url),{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)})
  assert.equal((await call()).status,403);assert.equal((await call({authorization:'Bearer '+token,origin:'https://untrusted.example'})).status,403)
  assert.equal((await call({authorization:'Bearer '+token,origin:'null'})).status,403)
  assert.equal((await call({authorization:'Bearer '+token,origin:url.origin})).status,200)
  server.revoke();assert.equal((await call({authorization:'Bearer '+token})).status,403)
 }finally{await server?.close();await f.close()}
})
