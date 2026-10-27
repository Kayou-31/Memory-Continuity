/** Logical adapter admissions, not provider billing or hidden adapter HTTP attempts. */
import {hostId,integer,object,RpError,text} from './schema.js'
import type {DurableSession} from './host-journal.js'

export interface RequestLimits {maxRequestsPerInput:number;maxRetriesPerStep:number}
export interface RequestCost {inputId:string;requests:number;stepKey:string;stepRequests:number;stopReason?:'request_limit'|'retry_limit'}
export function requestCostDiagnostic(cost:RequestCost|undefined,limits:RequestLimits){
 const requests=cost?.requests??0,stepRequests=cost?.stepRequests??0,currentStepRetries=Math.max(0,stepRequests-1)
 return {limits,...(cost??{requests,stepRequests}),requestsRemaining:Math.max(0,limits.maxRequestsPerInput-requests),currentStepRetries,retriesRemaining:Math.max(0,limits.maxRetriesPerStep-currentStepRetries),unit:'durably-reserved-adapter-admissions',notice:'按明确输入累计准入预留次数；写入结果不确定也会保留预留。不是供应商账单或隐藏 HTTP 重试次数。'}
}
export function requestLimits(input:unknown={}):RequestLimits{
 const v=object(input,[],['maxRequestsPerInput','maxRetriesPerStep'])
 const maxRequestsPerInput=v.maxRequestsPerInput??16,maxRetriesPerStep=v.maxRetriesPerStep??2
 integer(maxRequestsPerInput,1);integer(maxRetriesPerStep,0)
 if(maxRequestsPerInput>128||maxRetriesPerStep>8)throw new RpError('invalid_record','Request limits exceed supported bounds')
 return {maxRequestsPerInput,maxRetriesPerStep}
}
export function validateRequestCost(input:unknown):asserts input is RequestCost{
 const v=object(input,['inputId','requests','stepKey','stepRequests'],['stopReason'])
 hostId(v.inputId);integer(v.requests);integer(v.stepRequests);text(v.stepKey,100)
 if(!/^\d+:\d+$/u.test(v.stepKey)||v.stepRequests>v.requests||v.stopReason!==undefined&&!['request_limit','retry_limit'].includes(v.stopReason))throw new RpError('store_corrupt','Invalid request cost journal')
}
/** Upgrade only authenticated native history; do not fabricate a new allowance on resume. */
export function currentRequestCost(session:any,journal:DurableSession):RequestCost{
 const input=journal.inputs.findLast(i=>i.turnId===journal.currentTurnId&&journal.messageHashes[i.messageId])
 if(!input)throw new RpError('scope_denied','Model requests require an explicit registered input')
 const events=session.snapshotEvents(),step=events.findLast((e:any)=>e.type==='step/start')
 if(!step)throw new RpError('scope_denied','Model request has no native step')
 const stepKey=step.data.turn+':'+step.data.step
 if(journal.requestCost?.inputId===input.messageId){
  const cost=journal.requestCost
  if(cost.stepKey===stepKey)return cost
  return {...cost,stepKey,stepRequests:0}
 }
 const start=events.findIndex((e:any)=>e.type==='user/message'&&e.surfaceOp==='append'&&e.data.id===input.messageId)
 if(start<0)throw new RpError('scope_denied','Registered input is absent from native history')
 const attempts=events.slice(start+1).filter((e:any)=>e.type==='assistant/message'||e.type==='assistant/attempt')
 return {inputId:input.messageId,requests:attempts.length,stepKey,stepRequests:attempts.filter((e:any)=>e.data.turn===step.data.turn&&e.data.step===step.data.step).length}
}
export function requestStop(cost:RequestCost,limits:RequestLimits):RequestCost['stopReason']{
 return cost.stopReason??(cost.requests>=limits.maxRequestsPerInput?'request_limit':cost.stepRequests>=1+limits.maxRetriesPerStep?'retry_limit':undefined)
}
