/** Untrusted generator data. No authority, store, path or control capability is
 * accepted here. Source identity and dependency metadata come from the host. */
import { createHash, randomUUID } from 'node:crypto'
import { cloneInput, object, payload, sourceSpan, text, RpError } from './schema.js'
import type { EventPayload, InputFence, Result, SemanticEvent, SourceRevision, SourceSpan, Summary } from './types.js'
import type { GlobalFence } from './global.js'
export interface SummarySelection {
  level: Summary['level']; sourceRevisionIds: readonly string[]; dependencySummaryIds: readonly string[]; supportEventIds: readonly string[]
  exactAnchors?: readonly SourceSpan[]; boundary?: 'explicit' | 'proposal'
}
export interface CandidateSnapshot {
  inputFence: InputFence; globalFences: readonly GlobalFence[]; policyEpoch: number; selection: SummarySelection
  sources: readonly { source: SourceRevision; text: string }[]; dependencies: readonly Summary[]; supportEvents: readonly SemanticEvent[]; entityIds: readonly string[]
}
export interface MemoryCandidate {
  schemaVersion: 1; id: string; inputFence: InputFence
  proposedEvents: readonly { payload: EventPayload; epistemic: SemanticEvent['epistemic']; beliefHolderId?: string; sources: readonly SourceSpan[] }[]
  proposedSummary?: { level: Summary['level']; text: string; sourceRevisionIds: readonly string[]; exactAnchors: readonly SourceSpan[] }
  sceneBoundaryHint?: 'scene_end'
}
export interface SavedCandidate { candidate: MemoryCandidate; globalFences: readonly GlobalFence[]; policyEpoch: number; selection: SummarySelection }
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
function bad(message: string): never { throw new RpError('invalid_candidate', message) }
export function verifyCandidateSpan(span: SourceSpan, snapshot: CandidateSnapshot) {
  sourceSpan(span)
  const item = snapshot.sources.find(s => s.source.id === span.sourceRevisionId)
  if (!item || item.source.publicTextSha256 !== span.publicTextSha256 || span.endUtf16 > item.text.length) bad('Unselected source or source revision')
  for (const offset of [span.startUtf16, span.endUtf16]) if (offset > 0 && offset < item.text.length && /[\uD800-\uDBFF]/u.test(item.text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(item.text[offset])) bad('Split surrogate pair')
  if (sha(item.text.slice(span.startUtf16, span.endUtf16)) !== span.quoteSha256) bad('Quote hash mismatch')
}
export function validateCandidate(input: unknown, snapshot: CandidateSnapshot): Result<MemoryCandidate> {
  try {
    const r = object(cloneInput(input), ['schemaVersion', 'proposedEvents'], ['proposedSummary', 'sceneBoundaryHint'])
    if (r.schemaVersion !== 1 || !Array.isArray(r.proposedEvents) || r.proposedEvents.length > 128) bad('Candidate schema/size')
    if (!r.proposedEvents.length && !r.proposedSummary) bad('Empty candidate')
    const entities = new Set(snapshot.entityIds), known = new Set(snapshot.supportEvents.map(e => e.id))
    const entity = (v: string) => { if (!entities.has(v)) bad('Unknown entity requires confirmation') }
    const proposedEvents = r.proposedEvents.map((entry: unknown) => {
      const e = object(entry, ['payload', 'epistemic', 'sources'], ['beliefHolderId']); payload(e.payload)
      if (!['world', 'belief', 'utterance', 'uncertain'].includes(e.epistemic)) bad('Epistemic class')
      if (e.epistemic === 'belief') entity(e.beliefHolderId); else if (e.beliefHolderId !== undefined) bad('Belief holder outside belief')
      const p = e.payload as EventPayload
      if (p.kind === 'preference_change' || p.kind === 'canon_assertion' || p.kind === 'correction') bad('Use explicit canon/preference/correction controls')
      if ('subjectId' in p) entity(p.subjectId)
      if (p.kind === 'occurrence') p.actorIds.forEach(entity)
      if (p.kind === 'knowledge_change') { entity(p.knowerId); if (!known.has(p.claimId)) bad('Unknown claim dependency') }
      if (p.kind === 'relationship_change') { entity(p.fromId); entity(p.toId); if (p.triggerEventIds.some(id => !known.has(id))) bad('Unknown relationship trigger') }
      if (!Array.isArray(e.sources) || !e.sources.length || e.sources.length > 128) bad('Event needs original sources')
      e.sources.forEach((s: SourceSpan) => verifyCandidateSpan(s, snapshot))
      return { payload: p, epistemic: e.epistemic as SemanticEvent['epistemic'], sources: e.sources as SourceSpan[], ...(e.beliefHolderId ? { beliefHolderId: e.beliefHolderId as string } : {}) }
    })
    let proposedSummary: MemoryCandidate['proposedSummary']
    if (r.proposedSummary !== undefined) {
      const s = object(r.proposedSummary, ['level', 'text', 'sourceRevisionIds', 'exactAnchors'])
      text(s.text, 262144)
      const expected = snapshot.sources.map(s => s.source.id).sort()
      if (s.level !== snapshot.selection.level || !Array.isArray(s.sourceRevisionIds) || JSON.stringify([...s.sourceRevisionIds].sort()) !== JSON.stringify(expected)) bad('Summary original-source coverage')
      if (!Array.isArray(s.exactAnchors) || s.exactAnchors.length > 256) bad('Summary anchors')
      s.exactAnchors.forEach((a: SourceSpan) => verifyCandidateSpan(a, snapshot))
      const anchors = [...(snapshot.selection.exactAnchors ?? []), ...snapshot.dependencies.flatMap(d => d.exactAnchors), ...s.exactAnchors] as SourceSpan[]
      anchors.forEach(a => verifyCandidateSpan(a, snapshot))
      proposedSummary = { level: s.level, text: s.text, sourceRevisionIds: expected, exactAnchors: [...new Map(anchors.map(a => [JSON.stringify(a), a])).values()] }
    }
    if (r.sceneBoundaryHint !== undefined && r.sceneBoundaryHint !== 'scene_end') bad('Boundary hint')
    return { ok: true, value: { schemaVersion: 1, id: 'candidate_' + randomUUID().replaceAll('-', ''), inputFence: structuredClone(snapshot.inputFence), proposedEvents, ...(proposedSummary ? { proposedSummary } : {}), ...(r.sceneBoundaryHint ? { sceneBoundaryHint: 'scene_end' as const } : {}) } }
  } catch (e) { return { ok: false, code: 'invalid_candidate', message: e instanceof RpError ? e.message : 'Malformed candidate' } }
}
/** Fixed-output fixture annotations; no human review or model quality claim. */
export function scoreAnnotatedClaims(claims: readonly { expected: string; actual: string; critical: boolean }[]) {
  const incorrect = claims.filter(c => c.expected !== c.actual)
  return { evaluated: claims.length, supported: claims.length - incorrect.length, unsupported: incorrect.length, criticalErrors: incorrect.filter(c => c.critical).length, passed: incorrect.length === 0, method: 'fixed-annotated-exact-claim' }
}
