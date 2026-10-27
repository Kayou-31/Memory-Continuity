/** Local review hints, never a semantic equality or merge decision.
 * Design reference (owner-authorized): reusable-algorithm-assets at 905552ea,
 * candidates.py (bounded postings), dedupe.py (complete-link grouping).
 * Independently implemented in TypeScript; no Python or RapidFuzz dependency.
 */
export interface SimilarityRecord { id:string; text:string; partition:string; time?:string|null }
export const similarityLimits=Object.freeze({maxRecords:256,maxRecordUnits:8192,maxTextUnits:262144,maxPartitionUnits:262144,maxPostings:262144,maxWork:50000,maxBucketPairs:2048,maxCompareUnits:500000,maxPairs:64})
type Limits=typeof similarityLimits
export function reviewSimilarity(input:readonly SimilarityRecord[],options:Partial<Limits>={}){
 const caps={...similarityLimits,...options};for(const n of Object.values(caps))if(!Number.isSafeInteger(n)||n<1)throw new Error('Positive similarity budget required')
 const limits=new Set<string>(),rows:{record:SimilarityRecord;normalized:string;grams:Set<string>}[]=[],postings=new Map<string,number[]>(),partitions=new Map<string,number>()
 let textUnits=0,indexEntries=0,skippedOversize=0,skippedShort=0,visits=0,compareUnits=0,comparisons=0,partitionUnits=0,indexKeyUnits=0
 if(input.length>caps.maxRecords)limits.add('maxRecords')
 // Slice before sorting, normalizing or indexing. Never silently truncate a record.
 for(const record of input.slice(0,caps.maxRecords).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
  let partition=partitions.get(record.partition)
  if(partition===undefined){if(partitionUnits+record.partition.length>caps.maxPartitionUnits){limits.add('maxPartitionUnits');continue}partition=partitions.size;partitions.set(record.partition,partition);partitionUnits+=record.partition.length}
  if(record.text.length>caps.maxRecordUnits){skippedOversize++;limits.add('maxRecordUnits');continue}
  const normalized=record.text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'')
  if(normalized.length>caps.maxRecordUnits){skippedOversize++;limits.add('maxRecordUnits');continue}
  if(textUnits+record.text.length+normalized.length>caps.maxTextUnits){limits.add('maxTextUnits');break}
  textUnits+=record.text.length+normalized.length
  const chars=Array.from(normalized);if(chars.length<8){skippedShort++;continue}
  const grams=new Set(chars.slice(0,-1).map((c,i)=>c+chars[i+1]))
  if(indexEntries+grams.size>caps.maxPostings){limits.add('maxPostings');break}
  const index=rows.length;rows.push({record,normalized,grams});indexEntries+=grams.size
  for(const gram of grams){const key=partition+':'+gram;let list=postings.get(key);if(!list){list=[];postings.set(key,list);indexKeyUnits+=key.length}list.push(index)}
 }
 const seen=new Set<string>(),pairs:{ids:[string,string];score:number;warnings:string[]}[]=[],neighbors=new Map<string,Set<string>>()
 const marks=(s:string,re:RegExp)=>JSON.stringify((s.match(re)??[]).sort())
 outer:for(const members of postings.values()){
  let bucketVisits=0
  for(let a=0;a<members.length;a++)for(let b=a+1;b<members.length;b++){
   if(bucketVisits>=caps.maxBucketPairs){limits.add('maxBucketPairs');break}
   if(visits>=caps.maxWork){limits.add('maxWork');break outer}bucketVisits++;visits++
   const i=members[a],j=members[b],key=i+':'+j;if(seen.has(key))continue;seen.add(key)
   const left=rows[i],right=rows[j],cost=Math.min(left.grams.size,right.grams.size)
   if(compareUnits+cost>caps.maxCompareUnits){limits.add('maxCompareUnits');break outer}compareUnits+=cost;comparisons++
   const small=left.grams.size<=right.grams.size?left.grams:right.grams,large=small===left.grams?right.grams:left.grams
   let common=0;for(const g of small)if(large.has(g))common++
   const score=common/(left.grams.size+right.grams.size-common);if(common<3||score<0.65)continue
   if(pairs.length>=caps.maxPairs){limits.add('maxPairs');break outer}
   const warnings:string[]=[]
   if(marks(left.record.text.normalize('NFKC').toLowerCase(),/不|没|未|无|别|\bnever\b|\bnot\b|\bno\b|n't/gu)!==marks(right.record.text.normalize('NFKC').toLowerCase(),/不|没|未|无|别|\bnever\b|\bnot\b|\bno\b|n't/gu))warnings.push('negation_difference')
   if(marks(left.normalized,/\d+/gu)!==marks(right.normalized,/\d+/gu))warnings.push('number_difference')
   if((left.record.time??null)!==(right.record.time??null))warnings.push('time_difference')
   pairs.push({ids:[left.record.id,right.record.id],score:Math.round(score*1000)/1000,warnings})
   if(!warnings.length)for(const [x,y]of [[left.record.id,right.record.id],[right.record.id,left.record.id]]){const set=neighbors.get(x)??new Set<string>();set.add(y);neighbors.set(x,set)}
  }
 }
 const groups:string[][]=[]
 for(const {record}of rows){const group=groups.find(g=>g.every(id=>neighbors.get(record.id)?.has(id)));if(group)group.push(record.id);else groups.push([record.id])}
 return {method:'bounded-qgram-review/v1',pairs,groups:groups.filter(g=>g.length>1),coverage:{inputRecords:input.length,indexedRecords:rows.length,skippedOversize,skippedShort,completeForStrategy:limits.size===0,limits:[...limits].sort(),notice:'只比较同一归属中的文字相似性；未选中不代表不同，分组不代表事实相同。'},stats:{textUnits,partitionUnits,indexKeyUnits,indexEntries,postingVisits:visits,comparisons,compareUnits},budget:caps}
}
