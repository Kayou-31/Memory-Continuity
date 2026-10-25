/** Browser-only transport: explicit requests, in-memory credentials and no automatic retries. */
export function createManagementClient(send:typeof fetch,token:string,onRevoke:()=>void=()=>{}){
 let revoked=false
 const revoke=()=>{if(!revoked){revoked=true;token='';onRevoke()}}
 const closed=()=>Object.assign(new Error('管理入口已失效。请在宿主执行 /memcont person manage 重新打开。'),{code:'ownership_lost'})
 return Object.freeze({revoke,reviewPresentation(review:{showImpactDialog:boolean;impact:{mandatory:boolean}}){
  if(typeof review?.showImpactDialog!=='boolean'||typeof review?.impact?.mandatory!=='boolean')throw Error('服务端影响预览不完整')
  return review.showImpactDialog||review.impact.mandatory?'dialog' as const:'inline' as const
 },async request<T=any>(route:string,input:unknown={}):Promise<T>{
  if(revoked||!/^[a-f0-9]{64}$/.test(token)){revoke();throw closed()}
  if(!['snapshot','prepare','confirm','close','injection-preview','upload','discard-upload','read'].includes(route))throw Error('不支持的管理接口')
  let response:Response,body:any
  try{
   response=await send('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(input),cache:'no-store',redirect:'error'})
   body=await response.json()
  }catch{
   if(revoked)throw closed()
   throw Object.assign(new Error(route==='confirm'?'连接中断，操作可能已写入。可以重试本次确认；也可以返回后刷新核对，但刷新会取消本次确认，请勿直接重复新建相同操作。':'无法确认请求结果，请检查宿主管理入口后手动重试。'),{code:'network_uncertain'})
  }
  if(revoked)throw closed()
  if(response.status===403||['scope_denied','ownership_lost'].includes(body?.code)){revoke();throw closed()}
  if(!response.ok||body?.ok!==true){
   const code=typeof body?.code==='string'?body.code:'invalid_response'
   const next=code==='stale_input'?'数据已变化，请刷新并重新预览。':code==='persistence_uncertain'?'操作可能已写入，请刷新核对状态后再决定是否重试。':typeof body?.message==='string'?body.message:'管理响应格式不正确'
   throw Object.assign(new Error(code+': '+next),{code})
  }
  if(!Object.hasOwn(body,'value'))throw Error('管理响应缺少结果')
  if(route==='close')revoke()
  return body.value as T
 }})
}
