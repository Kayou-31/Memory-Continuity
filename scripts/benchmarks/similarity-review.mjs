import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {build,stop} from 'esbuild'
const out=path.resolve('work/iteration-review-2026-10-27');await fs.mkdir(out,{recursive:true})
const bundle=path.join(out,'similarity-benchmark.mjs');await build({entryPoints:['src/rp/similarity-review.ts'],outfile:bundle,bundle:true,platform:'node',format:'esm',logLevel:'silent'});stop()
const {reviewSimilarity}=await import(pathToFileURL(bundle).href),fixture=JSON.parse(await fs.readFile('benchmarks/rp/similarity-review.json','utf8'))
const rows=fixture.cases.flatMap(c=>[{id:c.id+'_a',text:c.left,partition:'erin/world'},{id:c.id+'_b',text:c.right,partition:c.rightPartition??'erin/world'}]),key=ids=>[...ids].sort().join('|'),positive=new Set(fixture.cases.filter(c=>c.label!=='different').map(c=>key([c.id+'_a',c.id+'_b'])))
// Additional cross-case matches are deliberately scored as unlabelled, not false
// positives: independently labelled pair tests avoid inventing semantic labels.
const labelled=new Set(fixture.cases.map(c=>key([c.id+'_a',c.id+'_b'])))
const exact=[];for(let a=0;a<rows.length;a++)for(let b=a+1;b<rows.length;b++)if(rows[a].partition===rows[b].partition&&rows[a].text===rows[b].text)exact.push([rows[a].id,rows[b].id])
const score=pairs=>{const inspected=pairs.filter(p=>labelled.has(key(p))),hits=inspected.filter(p=>positive.has(key(p))).length;return {suggestions:pairs.length,labelledSuggestions:inspected.length,unlabelledCrossCase:pairs.length-inspected.length,reviewPrecision:inspected.length?hits/inspected.length:null,labelledRecall:hits/positive.size,hits}}
const started=performance.now(),result=reviewSimilarity(rows),milliseconds=performance.now()-started
const stress=Array.from({length:256},(_,i)=>({id:'s'+String(i).padStart(3,'0'),partition:'erin/world',text:'书店里共同整理资料，准备下周的作品展示。'+i})),stressStart=performance.now(),bounded=reviewSimilarity(stress),stressMs=performance.now()-stressStart
const report={node:process.version,note:fixture.note,modelCalls:0,baseline:score(exact),qgram:score(result.pairs.map(p=>p.ids)),matchedReviewBudget:{limit:exact.length,baseline:score(exact),qgram:score(result.pairs.slice(0,exact.length).map(p=>p.ids))},milliseconds,coverage:result.coverage,stats:result.stats,pairs:result.pairs,missedLabelled:[...positive].filter(k=>!result.pairs.some(p=>key(p.ids)===k)),boundedStress:{input:stress.length,milliseconds:stressMs,coverage:bounded.coverage,stats:bounded.stats},memory:{rssBytes:process.memoryUsage().rss,maxRssKiB:process.resourceUsage().maxRSS,scope:'whole process including fixture and bundler; not per-algorithm allocation'}}
await fs.writeFile(path.join(out,'similarity-benchmark.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
