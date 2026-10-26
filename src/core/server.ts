import {createServer,type IncomingMessage,type ServerResponse} from 'node:http'
import {randomBytes,timingSafeEqual} from 'node:crypto'
import {createCoreRpc,type CoreServiceInput} from './rpc.js'
import {RpError} from '../rp/validation.js'
import {withPublicationGuard} from '../rp/publication-guard.js'

/** Explicit loopback service; administrative credentials never become tool capabilities. */
export async function openCoreService(input:CoreServiceInput){
 const timeout=input.requestTimeoutMs??10000,maxRequests=input.maxRequests??32
 if(!Number.isSafeInteger(timeout)||timeout<100||timeout>30000)throw new RpError('invalid_record','Core request timeout must be between 100 and 30000 milliseconds')
 if(!Number.isSafeInteger(maxRequests)||maxRequests<1||maxRequests>32)throw new RpError('invalid_record','Core allows at most 32 in-flight requests')
 const rpc=await createCoreRpc(input),adminToken=randomBytes(32).toString('hex'),pending=new Set<Promise<void>>(),aborts=new Set<AbortController>()
 let origin='',closed=false,closePromise:Promise<void>|undefined
 const equal=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
 const handler=async(req:IncomingMessage,res:ServerResponse)=>{
  const abort=new AbortController();aborts.add(abort)
  const active=()=>{if(closed||abort.signal.aborted)throw new RpError('ownership_lost','Request was cancelled, timed out, or the service closed')}
  const timer=setTimeout(()=>{
   abort.abort()
   if(!res.destroyed&&!res.writableEnded){res.statusCode=408;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({ok:false,code:'ownership_lost',message:'Core request timed out; inspect an uncertain change before retrying'}),()=>req.destroy())}
  },timeout);timer.unref()
  const disconnected=()=>{if(!res.writableEnded)abort.abort()};res.on('close',disconnected);req.on('aborted',()=>abort.abort())
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff')
  try{
   active()
   if(req.method!=='POST'||req.headers.host!==origin.slice(7)||req.headers.origin!==undefined&&req.headers.origin!==origin)throw new RpError('scope_denied','Only authenticated loopback requests with the correct origin are accepted')
   const bearer=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization??'')?.[1]
   if(!bearer)throw new RpError('scope_denied','A service capability is required')
   const admin=equal(bearer,adminToken),route=req.url??''
   const tool=admin?undefined:rpc.toolCapability(bearer)
   const adminRoutes=['/v1/admin/status','/v1/admin/session','/v1/admin/revoke','/v1/admin/workbench','/v1/admin/verify','/v1/admin/snapshot','/v1/admin/prepare','/v1/admin/confirm','/v1/admin/confirmation']
   if(admin?!adminRoutes.includes(route):!['/v1/tool/search','/v1/tool/get'].includes(route))throw new RpError('scope_denied','This credential cannot perform the requested operation')
   if(req.headers['content-type']!=='application/json')throw new RpError('invalid_record','JSON content type required')
   const chunks:Buffer[]=[];let size=0
   for await(const part of req){active();size+=part.length;if(size>131072)throw new RpError('capacity_exceeded','Core RPC request exceeds 128 KiB');chunks.push(part)}
   active();const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))
   const value=admin?await withPublicationGuard(active,()=>rpc.admin(route,body,active)):await rpc.tool(tool!,route,body,active);active()
   const encoded=JSON.stringify({ok:true,value});if(Buffer.byteLength(encoded)>131072)throw new RpError('capacity_exceeded','Core RPC response exceeds 128 KiB')
   res.setHeader('Content-Type','application/json; charset=utf-8');res.end(encoded)
  }catch(error){
   if(!res.destroyed&&!res.writableEnded){res.statusCode=error instanceof RpError&&['scope_denied','ownership_lost'].includes(error.code)?403:error instanceof RpError&&error.code==='capacity_exceeded'?413:409;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({ok:false,code:error instanceof RpError?error.code:'invalid_record',message:error instanceof Error?error.message:'Core request failed'}),()=>{if(!req.complete)req.destroy()})}
  }finally{clearTimeout(timer);res.off('close',disconnected);aborts.delete(abort)}
 }
 const server=createServer({maxHeaderSize:8192},(req,res)=>{
  if(pending.size>=maxRequests){res.statusCode=429;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({ok:false,code:'capacity_exceeded',message:'Too many in-flight core requests'}),()=>{if(!req.complete)req.destroy()});return}
  const work=handler(req,res);pending.add(work);void work.finally(()=>pending.delete(work))
 })
 server.requestTimeout=timeout;server.headersTimeout=timeout;server.maxConnections=16
 try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve()})})}catch(error){await rpc.close();throw error}
 const address=server.address();if(!address||typeof address==='string')throw new Error('Core loopback address unavailable')
 origin='http://127.0.0.1:'+address.port
 return{url:origin,adminToken,close(){
  if(closePromise)return closePromise
  closed=true;for(const abort of aborts)abort.abort()
  closePromise=(async()=>{server.closeAllConnections();const stopped=new Promise<void>(resolve=>server.close(()=>resolve()));try{await rpc.close();await Promise.allSettled([...pending]);await stopped}finally{await input.memory.close()}})()
  return closePromise
 }}
}
