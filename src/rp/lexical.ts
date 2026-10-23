/** Deterministic, local lexical retrieval. No embeddings or inferred facts. */
import { RpError } from './schema.js'
const normalize = (s: string) => s.normalize('NFKC').toLowerCase()
export function queryGroups(query: string): string[][] {
  const runs = normalize(query).match(/\p{Script=Han}+|[\p{L}\p{N}_-]+/gu) ?? []
  const groups = runs.map(run => {
    const chars = [...run]
    return /^\p{Script=Han}+$/u.test(run) && chars.length > 1
      ? [...new Set(chars.slice(0, -1).map((c, i) => c + chars[i + 1]))] : [run]
  })
  if (groups.flat().length > 128) throw new RpError('invalid_record', 'Use at most 128 lexical query terms')
  return groups
}
export function lexicalScore(body: string, groups: readonly string[][]): number | null {
  const content = normalize(body); let score = 0
  for (const group of groups) {
    const matched = group.filter(term => content.includes(term))
    // Joined Chinese phrases tolerate the new boundaries introduced by prose.
    // Latin/ID terms remain exact AND groups. No semantic-equivalence claim.
    if (matched.length < Math.ceil(group.length / 2)) return null
    score += matched.reduce((sum, term) => sum + term.length * (1 + Math.log2(Math.min(16, content.split(term).length - 1))), 0)
  }
  return score
}
export function hitExcerpt(body: string, query: string, maxChars = 256): string {
  if (body.length <= maxChars) return body
  const terms = queryGroups(query).flat(), normalized = normalize(body)
  const positions = terms.map(t => normalized.indexOf(t)).filter(n => n >= 0)
  const hit = positions.length ? Math.min(...positions) : 0
  // NFKC can expand or contract characters. Translate back to original UTF-16
  // before slicing, so every excerpt remains verbatim evidence.
  let original = 0, offset = 0
  if (hit) for (const scalar of body) { if (offset >= hit) break; offset += normalize(scalar).length; original += scalar.length }
  let start = Math.max(0, original - 48), end = Math.min(body.length, start + maxChars)
  if (start && /[\uDC00-\uDFFF]/u.test(body[start])) start++
  if (end < body.length && /[\uDC00-\uDFFF]/u.test(body[end])) end--
  return body.slice(start, end)
}
