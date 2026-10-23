import type {PersonDraft} from './types.js'
/** Reserve imported identifiers too; removed rows need not recycle their IDs. */
export function createDraftIds(draft: PersonDraft) {
  const used=new Set([...draft.fields.map(f=>f.fieldId),...draft.goals.map(g=>g.goalId)])
  let counter=0
  return (prefix:string) => { let value: string; do { value=prefix+'_'+(++counter) } while(used.has(value)); used.add(value); return value }
}
