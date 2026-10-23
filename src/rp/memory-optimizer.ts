/** Optional RP-safe adaptation for compatible Ultra installations. This local
 * algorithm does not call Ultra's archive, capture, tools or compaction paths. */
import { lexicalScore, queryGroups } from './lexical.js'
export interface RecallCandidate { readonly id: string; readonly text: string; readonly kind: 'experience' | 'summary'; readonly sequence: number }
export interface RecallOptimizer {
  readonly protocol: 'ultra-rp/v1'
  rank(input: { readonly query: string; readonly maxRecords: number; readonly candidates: readonly RecallCandidate[] }): readonly string[]
}
export function createUltraRpOptimizer(): RecallOptimizer {
  return Object.freeze({ protocol: 'ultra-rp/v1', rank({ query, maxRecords, candidates }: Parameters<RecallOptimizer['rank']>[0]) {
    const terms = queryGroups(query), selected: string[] = [], seen = new Set<string>()
    const ranked = candidates.map(c => ({ ...c, score: lexicalScore(c.text, terms) ?? 0 })).sort((a, b) => b.score - a.score || b.sequence - a.sequence || a.id.localeCompare(b.id))
    for (const candidate of ranked) {
      const key = candidate.text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
      if (seen.has(key)) continue
      seen.add(key); selected.push(candidate.id)
      if (selected.length >= Math.max(1, Math.min(32, maxRecords))) break
    }
    return selected
  } })
}
