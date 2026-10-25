/** Form validation and clipboard failures are separate outcomes. */
export interface CopyDraftPorts {
  generate():string
  version():number
  writeText(command:string):Promise<void>
  invalid(error:unknown):void
  changed():void
  fallback(command:string):void
  copied():void
}
export async function copyDraftCommand(ports:CopyDraftPorts){
  let command:string
  try{command=ports.generate()}catch(error){ports.invalid(error);return 'invalid' as const}
  const version=ports.version()
  try{await ports.writeText(command)}catch{
    if(ports.version()!==version){ports.changed();return 'changed' as const}
    ports.fallback(command);return 'manual' as const
  }
  if(ports.version()!==version){ports.changed();return 'changed' as const}
  ports.copied();return 'copied' as const
}
