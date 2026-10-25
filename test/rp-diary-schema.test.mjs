import test from 'node:test'
import assert from 'node:assert/strict'
import {api} from './fixtures/rp/growth.mjs'
const draft=extra=>({entryId:'today',title:'今天的一页',body:'\ufeff今天一起聊了星星。\r\n我觉得很开心😀。',...extra})
const validate=v=>{assert.equal(typeof api.validateDiaryDraft,'function','diary draft validation must exist');return api.validateDiaryDraft(v)}
const invalid=(v,code='invalid_record')=>assert.throws(()=>validate(v),e=>e.code===code)
test('free prose diary requires no reflection template and preserves original Unicode and newlines',()=>{
 const original=draft(),d=validate(original);assert.deepEqual(d,original);assert.notEqual(d,original)
 original.body='changed';assert.notEqual(d.body,original.body)
})
test('optional understanding remains subjective and retains exact evidence references and revision note',()=>{
 const source={sourceRevisionId:'source_a',publicTextSha256:'a'.repeat(64),startUtf16:3,endUtf16:7,quoteSha256:'b'.repeat(64)}
 const original=draft({previousEventId:'entry_previous',reflection:{understanding:'当时我以为她喜欢安静。',context:'那天正在休息。',uncertainty:'还没有问过她。',revisionNote:'后来得知她只是有些累，修正原来的猜测。',evidence:[{eventId:'event_a',revision:'c'.repeat(64),span:source}]}})
 assert.deepEqual(validate(original),original)
 assert.deepEqual(validate(draft({reflection:{understanding:'没有证据的主观印象'}})).reflection,{understanding:'没有证据的主观印象'})
})
test('body limit is 16 KiB UTF-8 and title limit is 256 code points without truncation',()=>{
 assert.equal(validate(draft({body:'😀'.repeat(4096)})).body.length,8192)
 invalid(draft({body:'😀'.repeat(4097)}),'capacity_exceeded')
 assert.equal([...validate(draft({title:'😀'.repeat(256)})).title].length,256)
 invalid(draft({title:'😀'.repeat(257)}))
 invalid(draft({body:'\ud800'}));invalid(draft({body:'bad\u0000'}));invalid(draft({body:' '}))
})
test('author, authority, paths and truth claims cannot be smuggled into a diary draft',()=>{
 for(const extra of [{author:'human'},{scope:{kind:'profile'}},{trusted:true},{autoAdopt:true},{createdAt:'2000-01-01'}])assert.throws(()=>validate(draft(extra)))
 invalid(draft({reflection:{evidence:[{path:'C:/secret.txt'}]}}))
 invalid(draft({reflection:{truth:true}}))
 invalid(draft({reflection:{understanding:'x'.repeat(4097)}}))
})
