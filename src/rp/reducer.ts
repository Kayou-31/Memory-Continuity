/** Pure reconstruction from already authorized, active events. No model, clock,
 * filesystem, implicit co-presence knowledge or last-timestamp conflict winner. */
import type { ClaimAssessment, InputFence, JsonValue, ProjectionResult, SemanticEvent, SourceSpan, StateProjection, Viewpoint } from './types.js'
import { currentGrowthHeads, projectedEventValue, projectedStateKey } from './growth-format.js'
import { personApplies } from './person/format.js'

const stable = (v: unknown): string => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable((v as Record<string, unknown>)[k])).join(',') + '}'
const unique = (items: readonly string[]) => [...new Set(items)].sort()
const sources = (events: readonly SemanticEvent[]): SourceSpan[] => [...new Map(events.flatMap(e => e.sources).map(s => [stable(s), s])).values()]
const objective = (e: SemanticEvent) => e.epistemic !== 'world' || ['user_canon', 'explicit_ooc', 'accepted_narration'].includes(e.authority)

export function reduceEvents(input: readonly SemanticEvent[], fence: InputFence, context?: {sceneId?:string;acceptedSeq:number}): ProjectionResult {
  const events = [...input].sort((a, b) => a.acceptedSeq - b.acceptedSeq || a.id.localeCompare(b.id))
  const superseded = new Set(events.flatMap(e => [...e.supersedes, ...(e.payload.kind === 'correction' ? e.payload.targetEventIds : [])]))
  const active = events.filter(e => !superseded.has(e.id) && objective(e))
  const groups = new Map<string, { subjectId: string; key: string; events: SemanticEvent[]; values: JsonValue[] }>()
  const relations = new Map<string, SemanticEvent[]>(), know = new Map<string, SemanticEvent[]>()
  for (const e of currentGrowthHeads(active)) {
    if(!personApplies(e,context))continue
    const p = e.payload
    if (p.kind === 'state_change' || p.kind === 'canon_assertion' || p.kind === 'preference_change') {
      const subjectId = p.kind === 'preference_change' ? 'preference' : p.subjectId
      const stateKey = projectedStateKey(e), key = stable([e.epistemic, e.beliefHolderId ?? null, subjectId, stateKey])
      const group = groups.get(key) ?? { subjectId, key: stateKey, events: [], values: [] }
      group.events.push(e); group.values.push(projectedEventValue(e)); groups.set(key, group)
    } else if (p.kind === 'knowledge_change' && e.epistemic === 'world') {
      const key = stable([p.knowerId, p.claimId]); know.set(key, [...(know.get(key) ?? []), e])
    } else if (p.kind === 'relationship_change') {
      const key = stable([e.epistemic, e.beliefHolderId ?? null, p.fromId, p.toId, p.relation]); relations.set(key, [...(relations.get(key) ?? []), e])
    }
  }
  const state: StateProjection[] = [], conflicts: ProjectionResult['conflicts'][number][] = []
  for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const values = new Map(group.values.map(v => [stable(v), v])), event = group.events[0], conflict = values.size > 1
    state.push({ branchId: fence.branchId, contextRevision: fence.contextRevision, subjectId: group.subjectId, key: group.key,
      value: conflict ? null : group.values[0], resolution: conflict ? 'conflict' : event.epistemic === 'uncertain' ? 'unknown' : 'known', epistemic: event.epistemic,
      ...(event.beliefHolderId ? { beliefHolderId: event.beliefHolderId } : {}), supportEventIds: group.events.map(e => e.id), sources: sources(group.events),
      conflict: conflict ? 'unresolved' : 'none', visibility: event.visibility })
    if (conflict) conflicts.push({ subjectId: group.subjectId, key: group.key, eventIds: group.events.map(e => e.id) })
  }
  const knowledge: ProjectionResult['knowledge'][number][] = []
  for (const [, history] of [...know].sort(([a], [b]) => a.localeCompare(b))) {
    const last = history.at(-1)!, p = last.payload
    if (p.kind !== 'knowledge_change') continue
    const tied = history.filter(e => e.acceptedSeq === last.acceptedSeq && e.payload.kind === 'knowledge_change')
    const uncertainOrder = new Set(tied.map(e => e.payload.kind === 'knowledge_change' ? e.payload.action : '')).size > 1
    knowledge.push({ knowerId: p.knowerId, claimId: p.claimId, known: !uncertainOrder && (p.action === 'learn' || p.action === 'believe'), action: p.action,
      supportEventIds: history.map(e => e.id), sources: sources(history) })
  }
  const relationships: ProjectionResult['relationships'][number][] = []
  for (const [, group] of [...relations].sort(([a], [b]) => a.localeCompare(b))) {
    const event = group.at(-1)!, p = event.payload
    if (p.kind !== 'relationship_change') continue
    const conflict = new Set(group.map(e => stable(projectedEventValue(e)))).size > 1
    relationships.push({ fromId: p.fromId, toId: p.toId, relation: p.relation, value: conflict ? null : projectedEventValue(event), resolution: conflict ? 'conflict' : 'known', epistemic: event.epistemic,
      ...(event.beliefHolderId ? { beliefHolderId: event.beliefHolderId } : {}), triggerEventIds: unique(group.flatMap(e => e.payload.kind === 'relationship_change' ? e.payload.triggerEventIds : [])),
      ...(p.unresolvedTension ? { unresolvedTension: p.unresolvedTension } : {}), supportEventIds: group.map(e => e.id), sources: sources(group) })
  }
  const claims = active.filter(e => e.payload.kind === 'state_change' || e.payload.kind === 'canon_assertion').map(e => {
    const p = e.payload
    if (p.kind !== 'state_change' && p.kind !== 'canon_assertion') throw new Error('unreachable claim')
    return { claimEventId: e.id, ...assessClaim({ state }, { subjectId: p.subjectId, key: projectedStateKey(e), value: projectedEventValue(e), epistemic: e.epistemic, ...(e.beliefHolderId ? { beliefHolderId: e.beliefHolderId } : {}) }) }
  })
  return { state, claims, conflicts, knowledge, relationships }
}

export function assessClaim(projection: Pick<ProjectionResult, 'state'>, query: { readonly subjectId: string; readonly key: string; readonly value: JsonValue; readonly epistemic: SemanticEvent['epistemic']; readonly beliefHolderId?: string }): ClaimAssessment {
  const state = projection.state.find(s => s.subjectId === query.subjectId && s.key === query.key && s.epistemic === query.epistemic && s.beliefHolderId === query.beliefHolderId)
  if (!state) return { truth: 'unknown', conflict: 'none', supportEventIds: [] }
  if (state.resolution !== 'known') return { truth: 'unknown', conflict: state.conflict, supportEventIds: state.supportEventIds }
  // A non-null, explicitly supported exclusive property can negate a specific
  // value. Null is absence/unknown, never an inferred negative assertion.
  return { truth: state.value === null ? 'unknown' : stable(state.value) === stable(query.value) ? 'true' : 'false', conflict: 'none', supportEventIds: state.supportEventIds }
}

export function eventsForView(events: readonly SemanticEvent[], fence: InputFence, view: Viewpoint): readonly SemanticEvent[] {
  if (view.kind === 'narrator') return events
  const knowledge = reduceEvents(events, fence).knowledge.filter(k => k.knowerId === view.entityId && k.known)
  const known = new Set(knowledge.map(k => k.claimId)), support = new Set(knowledge.flatMap(k => k.supportEventIds))
  return events.filter(e => (e.epistemic === 'belief' && e.beliefHolderId === view.entityId) || known.has(e.id) || (support.has(e.id) && e.payload.kind === 'knowledge_change' && e.payload.action !== 'forget' && e.payload.action !== 'doubt'))
}
