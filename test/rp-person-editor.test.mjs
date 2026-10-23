import test from 'node:test'
import assert from 'node:assert/strict'
import {build,stop} from 'esbuild'
const {outputFiles}=await build({stdin:{contents:"export {createDraftIds} from './src/rp/person/editor-ids.ts'; export {personDraft} from './src/rp/person/schema.ts'",resolveDir:process.cwd(),loader:'ts'},write:false,bundle:true,platform:'node',format:'esm'});stop()
const {createDraftIds,personDraft}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
test('saved editor draft can reopen and append fields and goals without hidden ID collisions',()=>{
  const saved={schemaVersion:1,kind:'person-draft',personId:'erin',fields:[{fieldId:'field_1',kind:'identity',value:'Name',policy:'stable'}],relationships:[],goals:[{goalId:'goal_2',category:'task',objective:'Travel',nextAction:'Start'}]}
  const reopened=personDraft(JSON.parse(JSON.stringify(saved)),new Set(['erin'])), ids=createDraftIds(reopened)
  reopened.fields.push({...saved.fields[0],fieldId:ids('field')}); reopened.goals.push({...saved.goals[0],goalId:ids('goal')})
  assert.equal(personDraft(reopened,new Set(['erin'])).fields.length,2)
  assert.equal(new Set(reopened.goals.map(g=>g.goalId)).size,2)
})
