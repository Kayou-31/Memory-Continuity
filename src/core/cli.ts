#!/usr/bin/env node
import path from 'node:path'
import {inspectProfileOwner,recoverProfileOwner} from './owner.js'
import {RpError} from '../rp/validation.js'

const help=`Memory-Continuity 本机核心管理

  memcont-core owner inspect --profile <绝对路径>
  memcont-core owner recover --profile <绝对路径> --expected <诊断中的 sha256>

inspect 只读取占用信息。recover 只处理已确认退出的旧进程；
不会按超时抢占，不会恢复被拒绝的会话，也不会自动重发输入。
本机服务和 AstrBot 入口仍在开发中。`
try{
 const args=process.argv.slice(2)
 if(args.length===0||args.length===1&&['help','--help','-h'].includes(args[0]))console.log(help)
 else{
  const recovery=args[1]==='recover'
  if(args[0]!=='owner'||!['inspect','recover'].includes(args[1])||args.length!==(recovery?6:4)||args[2]!=='--profile'||!path.isAbsolute(args[3])||recovery&&args[4]!=='--expected')throw new RpError('invalid_record','用法不正确。请运行 memcont-core --help；不会修改数据。')
  const value=recovery?await recoverProfileOwner(args[3],args[5]):await inspectProfileOwner(args[3])
  console.log(JSON.stringify({ok:true,value}))
 }
}catch(error){
 console.error(JSON.stringify({ok:false,code:error instanceof RpError?error.code:'persistence_failed',message:error instanceof Error?error.message:'本机核心操作失败'}))
 process.exitCode=1
}
