import type { AuthorityChange, JsonValue, SemanticEvent } from './types.js'
import { denied, id, integer, invalid, object, RpError, text } from './schema.js'
const growthRecords = new WeakSet<object>()
export const hasGrowthMarker = (changes: readonly AuthorityChange[], eventId: string) => changes.some(c => c.kind === 'candidate_adoption' && c.recordId === 'growth_' + eventId && c.record.candidateId === 'agent_memory_v1' && c.record.decision === 'accepted' && c.record.eventIds.length === 1 && c.record.eventIds[0] === eventId)
/** Only a verified authority-ledger marker opts an event into growth semantics. */
export function markGrowthEvent(event: SemanticEvent) { growthRecords.add(event); if (!growthValue(event)) invalid('marked growth payload missing') }
export function inheritGrowthMarks(from: unknown, to: unknown) {
  if (!from || !to || typeof from !== 'object' || typeof to !== 'object') return
  if (growthRecords.has(from)) growthRecords.add(to)
  for (const key of Object.keys(from)) inheritGrowthMarks((from as Record<string, unknown>)[key], (to as Record<string, unknown>)[key])
}

export interface GrowthValue {
  protocol: 'agent-memory/v1'; channel: 'state' | 'relationship' | 'goal'; value: JsonValue
  previousEventId: string | null; causeEventIds: string[]; note: string
}
export interface GoalValue {
  goalId: string; category: 'task' | 'promise'; objective: string; status: 'active' | 'paused' | 'completed' | 'abandoned'
  progress: number; nextAction: string; targetEntityId?: string
}
export function goalValue(input: unknown): GoalValue {
  const g = object(input, ['goalId', 'category', 'objective', 'status', 'progress', 'nextAction'], ['targetEntityId'])
  id(g.goalId); text(g.objective, 2048); text(g.nextAction, 2048, true); integer(g.progress)
  if (!['task', 'promise'].includes(g.category) || !['active', 'paused', 'completed', 'abandoned'].includes(g.status) || g.progress > 100 || (g.status === 'completed' && g.progress !== 100)) invalid('goal lifecycle')
  if (g.category === 'promise') id(g.targetEntityId); else if (g.targetEntityId !== undefined) invalid('task promise target')
  return g as GoalValue
}
export function growthValue(event: SemanticEvent): GrowthValue | null {
  if (!growthRecords.has(event)) return null
  const p = event.payload, raw = p.kind === 'state_change' ? p.after : p.kind === 'relationship_change' ? p.value : null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('protocol' in raw) || typeof raw.protocol !== 'string' || !raw.protocol.startsWith('agent-memory/')) return null
  const g = object(raw, ['protocol', 'channel', 'value', 'previousEventId', 'causeEventIds', 'note'])
  if (g.protocol !== 'agent-memory/v1' || (g.channel === 'goal' ? p.kind !== 'state_change' || !['task', 'promise'].includes(p.key) : g.channel !== (p.kind === 'state_change' ? 'state' : 'relationship'))) invalid('growth protocol/channel')
  if (g.channel === 'goal' && p.kind === 'state_change' && goalValue(g.value).category !== p.key) invalid('goal category')
  if (g.previousEventId !== null) id(g.previousEventId)
  if (!Array.isArray(g.causeEventIds) || !g.causeEventIds.length || g.causeEventIds.length > 32 || new Set(g.causeEventIds).size !== g.causeEventIds.length) invalid('growth causes')
  g.causeEventIds.forEach(id); text(g.note, 2048)
  if (event.epistemic !== 'world' || !['user_canon', 'explicit_ooc'].includes(event.authority) || event.supersedes.length) denied('growth requires explicit control without retcon')
  return g as GrowthValue
}
export function growthSlot(event: SemanticEvent): string | null {
  const p = event.payload
  return p.kind === 'state_change' || p.kind === 'canon_assertion' ? JSON.stringify(['state', event.epistemic, event.beliefHolderId ?? null, p.subjectId, projectedStateKey(event)])
    : p.kind === 'relationship_change' ? JSON.stringify(['relationship', event.epistemic, event.beliefHolderId ?? null, p.fromId, p.toId, p.relation]) : null
}
export function projectedStateKey(event: SemanticEvent): string {
  const p = event.payload, g = growthValue(event)
  return g?.channel === 'goal' ? goalValue(g.value).category + ':' + goalValue(g.value).goalId : 'key' in p ? p.key : ''
}
export function currentGrowthHeads(events: readonly SemanticEvent[]): SemanticEvent[] {
  const previous = new Set(events.map(e => growthValue(e)?.previousEventId).filter((id): id is string => !!id))
  return events.filter(e => !previous.has(e.id))
}
export function projectedEventValue(event: SemanticEvent): JsonValue {
  const g = growthValue(event); if (g) return g.value
  const p = event.payload
  return p.kind === 'state_change' ? p.after : 'value' in p ? p.value : null
}
export function checkGrowthTransition(event: SemanticEvent, history: readonly SemanticEvent[]) {
  const g = growthValue(event); if (!g) return
  const heads = currentGrowthHeads(history).filter(e => growthSlot(e) === growthSlot(event))
  if (heads.length > 1 || (heads[0]?.id ?? null) !== g.previousEventId) throw new RpError('stale_input', 'Growth requires the unique current predecessor')
  if (heads[0]?.payload.kind === 'canon_assertion' && heads[0].payload.locked) denied('locked identity requires explicit retcon')
  if (heads[0] && heads[0].acceptedSeq >= event.acceptedSeq) invalid('growth must follow its predecessor')
  for (const causeId of g.causeEventIds) {
    const cause = history.find(e => e.id === causeId)
    if (!cause || cause.payload.kind !== 'occurrence' || cause.epistemic !== 'world' || cause.acceptedSeq > event.acceptedSeq) invalid('growth requires accepted world experiences')
  }
  if (g.channel === 'goal') {
    const next = goalValue(g.value), previous = heads[0] && growthValue(heads[0])
    if (!previous) { if (next.status !== 'active' || next.progress !== 0) invalid('new goal must start active at zero') }
    else {
      const old = goalValue(previous.value)
      if (['completed', 'abandoned'].includes(old.status)) invalid('terminal goal requires a distinct new goal')
      if (old.objective !== next.objective || old.targetEntityId !== next.targetEntityId || next.progress < old.progress) invalid('goal identity or regressing progress')
      if ((old.status === 'paused' || next.status === 'paused') && next.progress !== old.progress) invalid('resume goal before advancing progress')
    }
  }
}
