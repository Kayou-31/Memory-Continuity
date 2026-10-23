/** Annotated evidence availability only. No model or semantic entailment claim. */
export function scoreLifeEvidence(facts, claims, returned) {
  const known=new Map(facts.map(f=>[f.id,f])),seen=new Set();let supported=0,duplicates=0,unknown=0,unsupported=0
  for(const claim of claims){
    if(seen.has(claim.id)){duplicates++;continue}seen.add(claim.id)
    const fact=known.get(claim.id);if(!fact){unknown++;continue}
    const c=claim.citation,allowed=c&&fact.evidence.some(e=>e.id===c.id&&e.revision===c.revision&&e.quote===c.quote)
    const original=c&&returned.some(s=>s.id===c.id&&s.revision===c.revision&&typeof c.quote==='string'&&c.quote.length>0&&s.text.includes(c.quote))
    if(claim.value===fact.expected&&allowed&&original)supported++;else unsupported++
  }
  return {total:facts.length,supported,unsupported,missing:facts.filter(f=>!seen.has(f.id)).length,duplicates,unknown,semanticQuality:'unverified'}
}
