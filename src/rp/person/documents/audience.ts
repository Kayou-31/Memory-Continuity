import {cloneInput, denied, object, RpError, text} from '../../schema.js'
import type {HostAuthority} from '../../types.js'
export interface AudienceIdentity {platform:string;accountId:string;kind:'local'|'direct'|'group';senderId?:string;groupId?:string}
export interface AudienceContext {readonly protocol:'rp.audience-context/v1'}
const contexts=new WeakMap<object,{authority:HostAuthority;identity:AudienceIdentity;check:()=>void}>()
export function resolveAudience(context:AudienceContext,authority:HostAuthority):AudienceIdentity {
  const value=contexts.get(context);if(!value||value.authority!==authority)denied('Unknown or cross-authority audience context')
  value.check();return structuredClone(value.identity)
}
/** Only trusted host adapters receive this factory. Identity is never parsed from model text. */
export function createAudienceService(){return Object.freeze({create(authority:HostAuthority,input:AudienceIdentity,active:()=>boolean=()=>true){
  const identity=object(cloneInput(input),['platform','accountId','kind'],['senderId','groupId'])
  text(identity.platform,128);text(identity.accountId,256)
  if(!['local','direct','group'].includes(identity.kind))denied('Unknown conversation kind')
  if(identity.kind!=='local')text(identity.senderId,256)
  if(identity.kind==='group')text(identity.groupId,256)
  else if(identity.groupId!==undefined)denied('Group ID outside group context')
  let revoked=false
  const check=()=>{if(revoked||!active())throw new RpError('ownership_lost','Audience context revoked')}
  const context:AudienceContext=Object.freeze({protocol:'rp.audience-context/v1'})
  contexts.set(context,{authority,identity:identity as AudienceIdentity,check})
  return Object.freeze({context:()=>{check();return context},revoke:()=>{revoked=true}})
}})}
