import type {createDiaryService} from './service.js'
import type {HostAuthority,InputFence,SourceRevision} from '../types.js'
import {RpError} from '../schema.js'
import {unwrap} from '../retrieval.js'
import {validateDiaryDraft} from './schema.js'

/** Native human controls. This handler is never exposed through a model tool. */
export async function diaryCommand(input:string,host:{
  diary:ReturnType<typeof createDiaryService>;authority:HostAuthority;personId?:string;commandId:string
  control:(text:string)=>Promise<SourceRevision>;fence:()=>Promise<InputFence>;changed:()=>Promise<void>
}){
  if(!host.personId)throw new RpError('scope_denied','请先绑定人物：/memcont person use <personId>')
  const parsed=/^(\S+)(?:\s+([\s\S]+))?$/u.exec(input),sub=parsed?.[1],value=parsed?.[2]??''
  const access={personId:host.personId,boardId:'shared'},d=host.diary,a=host.authority
  if(sub==='settings'&&!value)return unwrap(await d.settings(a,access))
  if(sub==='list')return unwrap(await d.list(a,{...access,query:value}))
  if(sub==='show')return unwrap(await d.read(a,{...access,entryId:value}))
  if(sub==='history')return unwrap(await d.history(a,{...access,entryId:value}))
  let result:unknown
  if((sub==='enable'||sub==='disable')&&!value){
    const previous=await d.settings(a,access)
    if(!previous.ok&&previous.code!=='scope_denied')throw new RpError(previous.code,previous.message)
    result=unwrap(await d.configure(a,await host.control(input),{...access,humanId:previous.ok?previous.value.humanId:'local_user',audiences:previous.ok?previous.value.audiences:[{kind:'local'}],allowAgentWrite:sub==='enable',...(previous.ok?{previousEventId:previous.value.eventId}:{}),expected:await host.fence(),idempotencyKey:host.commandId}))
  }else if(sub==='write'){
    let raw:unknown;try{raw=JSON.parse(value)}catch{throw new RpError('invalid_record','日记需要有效 JSON：entryId、title、body；修改时还需 previousEventId')}
    const draft=validateDiaryDraft(raw)
    result=unwrap(await d.writeHuman(a,await host.control(input),{...access,draft,expected:await host.fence(),idempotencyKey:host.commandId}))
  }else if(sub==='delete'){
    result=unwrap<unknown>(await d.privacyDelete(a,await host.control(input),{...access,entryId:value,expected:await host.fence(),idempotencyKey:host.commandId,affectedBranchIds:[a.scope.branchId]}))
  }else throw new RpError('invalid_record','使用 /memcont diary enable|disable|settings|list|show <ID>|history <ID>|write <JSON>|delete <ID>')
  await host.changed();return result
}
