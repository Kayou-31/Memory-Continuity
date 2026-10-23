import {canonical} from '../store.js'
import {object,RpError} from '../schema.js'
import {createRuntimeBinding,HARD_CONSTRAINTS,MODULES,MODES,type RuntimeConfig} from './contract.js'
import {moduleDisplay,type ModuleRuntime} from './runtime.js'

export async function runtimeCommand(action:string,arg:string,key:string,host:{config:RuntimeConfig;runtime?:ModuleRuntime;ready:()=>Promise<void>;change:(config:RuntimeConfig,disable:boolean)=>Promise<void>}) {
  const match=/^(\S+)(?:\s+([\s\S]+))?$/u.exec(arg),op=match?.[1]??'show',value=match?.[2]??''
  const output=(value:unknown)=>({kind:'success' as const,text:canonical(value)})
  if(Buffer.byteLength(arg,'utf8')>16384)throw new RpError('invalid_record','Runtime command exceeds 16 KiB')
  if(op==='show'||op==='list')return output({config:host.config,hardConstraints:HARD_CONSTRAINTS,...(action==='modules'?{registry:MODULES}:action==='mode'?{modes:MODES}:{guidanceEnforcement:'advisory'})})
  if(action==='modules'&&op==='run'){
    await host.ready();if(!host.runtime)throw new RpError('capability_missing','Legacy session needs clean continuation')
    const r=object(JSON.parse(value),['moduleId','input']),result=await host.runtime.run(r.moduleId,r.input,key),receipt=await host.runtime.verify(result)
    return output(moduleDisplay(result.value,receipt))
  }
  let next:unknown
  if(action==='mode'&&op==='set')next={...host.config,mode:value}
  else if(action==='constraints'&&op==='set')next={...host.config,constraints:JSON.parse(value)}
  else if(action==='modules'&&['enable','disable'].includes(op)){
    if(!MODULES.some(m=>m.id===value))throw new RpError('capability_missing','Unknown module')
    next={...host.config,enabledModules:op==='enable'?[...new Set([...host.config.enabledModules,value])]:host.config.enabledModules.filter(id=>id!==value)}
  }else throw new RpError('invalid_record','Use mode show|set, modules list|enable|disable|run, constraints show|set')
  const config=createRuntimeBinding(next).config
  await host.change(config,action==='modules'&&op==='disable')
  return output({config,notice:'配置已保存；有历史的停用会话保持封锁，请使用 continue-clean。'})
}
