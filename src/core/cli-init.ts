import fs from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {openMemoryCore} from './owned-memory.js'
import {id,RpError} from '../rp/validation.js'
import {unwrap} from '../rp/retrieval.js'
import type {AuthorityRequest} from '../rp/store.js'

/** Explicit administrator bootstrap into a new directory, never a migration. */
export async function initializeCore(directory:string,entity:string){
 if(!path.isAbsolute(directory))throw new RpError('invalid_record','初始化目录必须是新的绝对路径')
 id(entity)
 const requested=path.resolve(directory),parent=await fs.realpath(path.dirname(requested)),root=path.join(parent,path.basename(requested))
 if(path.dirname(requested)===requested)throw new RpError('invalid_record','不能使用文件系统根目录')
 // No recursive creation: existing files, directories and links all fail closed.
 try{await fs.mkdir(root)}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new RpError('scope_denied','初始化目录已存在；保留旧数据并选择新目录。此命令不负责升级或恢复');throw error}
 const profileRoot=path.join(root,'profile'),workspaceRoot=path.join(root,'workspace'),configFile=path.join(root,'core-config.json')
 let memory:Awaited<ReturnType<typeof openMemoryCore>>|undefined
 try{
  await fs.mkdir(workspaceRoot)
  memory=await openMemoryCore({profileRoot,entityIds:[entity],ownerKind:'service'})
  const workspace=unwrap(await memory.control.createWorkspace(workspaceRoot)),branch=unwrap(await memory.control.createBranch(workspace.workspaceId,'life'))
  const request:AuthorityRequest={workspaceId:workspace.workspaceId,campaignId:'life',branchId:branch.id,viewpoint:{kind:'narrator'},visibility:{policyId:'local-admin',revision:0,audienceSetId:'public'},audienceSetIds:['public'],permissions:['read','observe','commit','control']}
  const authority=unwrap(await memory.control.authorize(request));unwrap(await memory.control.checkManagement(authority))
  const config={schemaVersion:1,profileRoot,entityIds:[entity],bindings:[{id:'main',personId:entity,request}]}
  const candidate=configFile+'.tmp-'+randomUUID(),handle=await fs.open(candidate,'wx',0o600)
  try{await handle.writeFile(JSON.stringify(config,null,2)+'\n');await handle.sync()}finally{await handle.close()}
  await fs.link(candidate,configFile);await fs.unlink(candidate)
  return{ok:true,configFile,profileRoot,workspaceRoot,bindingId:'main',entityId:entity,notice:'已建立空白空间；尚未创建人物或启动服务。请显式运行 serve，再在工作台创建人物。'}
 }finally{await memory?.close()}
}
