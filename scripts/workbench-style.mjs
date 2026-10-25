import fs from 'node:fs/promises'
const root=new URL('../',import.meta.url)
const css=await fs.readFile(new URL('ui/workbench/fonts.css',root),'utf8')+'\n'+await fs.readFile(new URL('ui/workbench/styles.css',root),'utf8')
await fs.writeFile(new URL('src/rp/person/workbench-style.ts',root),'// Generated from ui/workbench/styles.css by scripts/workbench-style.mjs.\nexport const workbenchStyle = '+JSON.stringify(css)+'\n')
