import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {build,stop} from 'esbuild'
const dir=path.resolve('work/similarity-tests');await fs.mkdir(dir,{recursive:true});const out=path.join(dir,'algorithm.mjs')
await build({entryPoints:['src/rp/similarity-review.ts'],outfile:out,bundle:true,platform:'node',format:'esm',logLevel:'silent'});stop()
const {reviewSimilarity}=await import(pathToFileURL(out).href)
const row=(id,text,partition='erin/world/user')=>({id,text,partition})
test('large exact partitions are interned once and metadata exhaustion is disclosed',()=>{
 const partition=Array.from({length:256},(_,i)=>'actor_'+i+'x'.repeat(100)).join(','),text=Array.from({length:1000},(_,i)=>String.fromCodePoint(0x4e00+i)).join('')
 const r=reviewSimilarity([row('a',text,partition),row('b',text,partition)])
 assert.equal(r.pairs.length,1);assert.equal(r.stats.partitionUnits,partition.length);assert.ok(r.stats.indexKeyUnits<10000)
 const limited=reviewSimilarity([row('a',text,partition)],{maxPartitionUnits:1000});assert.equal(limited.coverage.completeForStrategy,false);assert.ok(limited.coverage.limits.includes('maxPartitionUnits'))
})
test('similarity uses Unicode normalization but keeps original text and semantic partitions',()=>{
 const input=[row('a','周末我会去书屋帮小贝一起整理作品集。'),row('b','周末我会去书屋帮小贝整理作品集。'),row('c','周末我会去书屋帮小贝整理作品集。','bea/world/user'),row('d','周末我会去书屋帮小贝整理作品集。','erin/belief/user')]
 const r=reviewSimilarity(input);assert.deepEqual(r.pairs.map(p=>p.ids),[['a','b']]);assert.equal(r.coverage.completeForStrategy,true)
 const unicode=reviewSimilarity([row('a','Ｐｒｏｊｅｃｔ　Ａ：一起整理作品集。'),row('b','Project A:一起整理作品集。')]);assert.equal(unicode.pairs.length,1);assert.equal(input[0].text,'周末我会去书屋帮小贝一起整理作品集。')
})
test('negation and date differences are review warnings, never equivalent groups',()=>{
 const r=reviewSimilarity([row('a','林澈答应在11月15日回来帮忙整理书店的库存。'),row('b','林澈没有答应在11月16日回来帮忙整理书店的库存。')]);assert.equal(r.pairs.length,1);assert.deepEqual(r.pairs[0].warnings,['negation_difference','number_difference']);assert.deepEqual(r.groups,[])
})
test('groups require every pair, not transitive similarity',()=>{
 const r=reviewSimilarity([row('a','abcdefghijklm'),row('b','abcdefghijklmNOPQ'),row('c','fghijklmNOPQ')]);assert.equal(r.pairs.length,2);assert.ok(r.groups.every(g=>g.length<=2));assert.equal(r.pairs.some(p=>p.ids.join()==='a,c'),false)
})
test('all bounded stages disclose incomplete coverage and remain deterministic',()=>{
 const rows=Array.from({length:80},(_,i)=>row('r'+String(i).padStart(3,'0'),'大家都在书店整理作品集，一起准备下个月的展览。'+i))
 for(const limits of [{maxRecords:3},{maxTextUnits:80},{maxPostings:16},{maxWork:3},{maxBucketPairs:2},{maxCompareUnits:12},{maxPairs:2}]){const r=reviewSimilarity(rows,limits);assert.equal(r.coverage.completeForStrategy,false,JSON.stringify(limits));assert.ok(r.coverage.limits.length);assert.deepEqual(r,reviewSimilarity(rows,limits))}
 const oversized=reviewSimilarity([row('large','字'.repeat(8193)),row('valid','一条可以复核的有效经历。')]);assert.equal(oversized.coverage.skippedOversize,1);assert.equal(oversized.coverage.completeForStrategy,false)
 const tiny=reviewSimilarity([row('a','是'),row('b','是')]);assert.equal(tiny.pairs.length,0)
})
