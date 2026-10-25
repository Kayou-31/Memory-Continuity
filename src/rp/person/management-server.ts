import {createServer,type IncomingMessage} from 'node:http'
import {randomBytes,timingSafeEqual} from 'node:crypto'
import {object,RpError} from '../schema.js'
import type {ManagementController} from './management.js'
import {managerPage} from './manager-ui.js'
import {readWorkbenchFont} from './workbench-fonts.js'

export async function openManagementServer(controller:ManagementController,context:()=>unknown=()=>({}),changed:()=>Promise<void>=async()=>{},injectionPreview?:(query:string)=>Promise<unknown>){
 const token=randomBytes(32).toString('hex');let revoked=false,origin=''
 const auth=(req:IncomingMessage)=>{
  const actual=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+token)
  return !revoked&&actual.length===expected.length&&timingSafeEqual(actual,expected)
 }
 const server=createServer(async(req,res)=>{
  const nonce=randomBytes(16).toString('hex')
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff')
  res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`)
  try{
   if(req.headers.host!==origin.slice(7)||req.headers.origin!==undefined&&req.headers.origin!==origin)throw new RpError('scope_denied','Local management origin denied')
   const font=/^\/assets\/fonts\/(noto-serif-sc-\d{3}\.woff2)$/u.exec(req.url??'')
   if(req.method==='GET'&&font){const bytes=await readWorkbenchFont(font[1]);res.setHeader('Content-Type','font/woff2');res.setHeader('Cache-Control','public, max-age=31536000, immutable');res.end(bytes);return}
   if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(managerPage(nonce));return}
   if(req.method!=='POST'||!auth(req)||!['/api/snapshot','/api/prepare','/api/confirm','/api/close','/api/injection-preview','/api/upload','/api/discard-upload','/api/read'].includes(req.url??''))throw new RpError('scope_denied','Management authorization denied')
   if(req.headers['content-type']!=='application/json')throw new RpError('invalid_record','JSON content type required')
   const chunks:Buffer[]=[];let size=0
   const limit=req.url==='/api/upload'?1450000:131072
   for await(const part of req){size+=part.length;if(size>limit)throw new RpError('capacity_exceeded','Management request exceeds its bounded size');chunks.push(part)}
   if(!auth(req))throw new RpError('ownership_lost','Management revoked')
   const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));let value:unknown
   if(req.url==='/api/snapshot'){object(input,[]);value={...await controller.snapshot(),context:context()}}
   else if(req.url==='/api/injection-preview'){
    const q=object(input,['query']);if(typeof q.query!=='string'||Buffer.byteLength(q.query,'utf8')>8192)throw new RpError('invalid_record','Preview query exceeds 8 KiB')
    if(!injectionPreview)throw new RpError('capability_missing','当前宿主没有注入预览入口')
    await controller.snapshot();value=await injectionPreview(q.query);if(!auth(req))throw new RpError('ownership_lost','Management revoked during preview')
   }
   else if(req.url==='/api/prepare')value=await controller.prepare(input)
   else if(req.url==='/api/upload')value=await controller.upload(input)
   else if(req.url==='/api/discard-upload'){const op=object(input,['id']);value=await controller.discardUpload(op.id)}
   else if(req.url==='/api/read')value=await controller.read(input)
   else if(req.url==='/api/confirm'){const op=object(input,['id']);value=await controller.confirm(op.id);await changed()}
   else{object(input,[]);revoked=true;controller.revoke();value={closed:true}}
   if(req.url!=='/api/close'){if(!auth(req))throw new RpError('ownership_lost','管理入口已撤销；请重新打开并核对状态。');controller.assertActive()}
   res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({ok:true,value}))
   if(req.url==='/api/close')server.close()
  }catch(e){
   res.statusCode=e instanceof RpError&&['scope_denied','ownership_lost'].includes(e.code)?403:e instanceof RpError&&e.code==='capacity_exceeded'?413:409
   res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({ok:false,code:e instanceof RpError?e.code:'invalid_record',message:e instanceof Error?e.message:'Invalid request'}))
  }
 })
 server.requestTimeout=10000;server.headersTimeout=10000;server.maxConnections=8
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve()})})
 const address=server.address();if(!address||typeof address==='string')throw new Error('Management listen address unavailable')
 origin='http://127.0.0.1:'+address.port
 return {url:origin+'/#'+token,controller,async confirm(id:string){const result=await controller.confirm(id);await changed();return result},revoke(){revoked=true;controller.revoke()},async close(){revoked=true;controller.revoke();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}}
}
