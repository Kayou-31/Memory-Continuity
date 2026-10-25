import {AsyncLocalStorage} from 'node:async_hooks'
import type {HostAuthority} from '../types.js'
import type {DiaryExecution} from './types.js'
import {denied} from '../schema.js'
export interface DiaryAdmission {authority:HostAuthority;boardId:string;personId:string;policyEventId:string;execution:DiaryExecution;sourceHash:string;check:()=>void}
const admission=new AsyncLocalStorage<DiaryAdmission>()
/** Internal capability scope. Never exported from the core package or exposed as a tool. */
export const withDiaryAdmission=<T>(value:DiaryAdmission,work:()=>Promise<T>)=>admission.run(value,work)
export function requireDiaryAdmission(authority:HostAuthority){const a=admission.getStore();if(!a||a.authority!==authority)denied('Diary write requires a live host execution');a.check();return a}
