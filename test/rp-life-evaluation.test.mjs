import test from 'node:test'
import assert from 'node:assert/strict'
import {scoreLifeEvidence} from '../scripts/benchmarks/life-score.mjs'
const facts=[{id:'promise',expected:'归还钥匙',evidence:[{id:'s1',revision:'r1',quote:'承诺归还钥匙'}]}]
const sources=[{id:'s1',revision:'r1',text:'他喜欢下雨。承诺归还钥匙。'}]
test('life evaluator requires the annotated fact span, original revision and actual returned content',()=>{
 const answer=(quote,revision='r1',value='归还钥匙')=>[{id:'promise',value,citation:{id:'s1',revision,quote}}]
 assert.equal(scoreLifeEvidence(facts,answer('承诺归还钥匙'),sources).supported,1)
 for(const a of [answer('他喜欢下雨'),answer('承诺归还钥匙','r2'),answer('承诺归还钥匙','r1','保留钥匙')])assert.equal(scoreLifeEvidence(facts,a,sources).supported,0)
 assert.equal(scoreLifeEvidence(facts,answer('承诺归还钥匙'),[]).supported,0)
 assert.equal(scoreLifeEvidence(facts,answer('承诺归还钥匙'),[{...sources[0],text:'他喜欢下雨。'}]).supported,0)
})
test('life evaluator reports omissions, duplicate and unknown claims without inflated scores',()=>{
 const a={id:'promise',value:'归还钥匙',citation:{id:'s1',revision:'r1',quote:'承诺归还钥匙'}}
 assert.equal(scoreLifeEvidence(facts,[],sources).missing,1)
 const scored=scoreLifeEvidence(facts,[a,a,{...a,id:'invented'}],sources)
 assert.equal(scored.supported,1);assert.equal(scored.duplicates,1);assert.equal(scored.unknown,1);assert.equal(scored.semanticQuality,'unverified')
})
