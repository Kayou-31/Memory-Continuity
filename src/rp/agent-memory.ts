/** Explicit human growth controls; never registered as model write tools. */
import { createHash } from 'node:crypto'
import { canonical, type RpStore } from './store.js'
import type { createCanonicalService } from './canonical.js'
import type { EventPayload, HostAuthority, InputFence, JsonValue, SemanticEvent, SourceRevision } from './types.js'
import { cloneInput, denied, failure, fence as validateFence, id, invalid, object, payload as validatePayload, RpError, text } from './schema.js'
import { unwrap } from './retrieval.js'
import { goalValue, type GoalValue, type GrowthValue } from './growth-format.js'
type Base = { idempotencyKey: string; expected: InputFence; fictionalTime?: string | null }
type Progress = { previousEventId: string | null; causeEventIds: string[]; note: string; value: JsonValue }
export type AgentMemoryControl = Base & (
  | { kind: 'experience'; actorIds: string[]; description: string; sourceRevisionIds: string[] }
  | (Progress & { kind: 'state'; entityId: string; key: string })
  | (Progress & { kind: 'relationship'; fromId: string; toId: string; relation: string })
  | (Omit<Progress, 'value'> & GoalValue & { kind: 'goal'; ownerId: string }))
export function createAgentMemory(store: RpStore, service: ReturnType<typeof createCanonicalService>, entityIds: readonly string[]) {
  const entities = new Set(entityIds)
  const known = (entity: unknown) => { id(entity); if (!entities.has(entity)) denied('unknown Agent entity') }
  return Object.freeze({
    async apply(authority: HostAuthority, controlSource: SourceRevision, input: AgentMemoryControl) {
      try {
        const value = cloneInput(input), ctl = cloneInput(controlSource)
        const extra = value.kind === 'experience' ? ['actorIds', 'description', 'sourceRevisionIds'] : value.kind === 'state' ? ['entityId', 'key', 'value', 'previousEventId', 'causeEventIds', 'note'] : value.kind === 'relationship' ? ['fromId', 'toId', 'relation', 'value', 'previousEventId', 'causeEventIds', 'note'] : value.kind === 'goal' ? ['ownerId', 'goalId', 'category', 'objective', 'status', 'progress', 'nextAction', 'previousEventId', 'causeEventIds', 'note'] : invalid('Agent control kind')
        object(value, ['kind', 'idempotencyKey', 'expected', ...extra], ['fictionalTime', ...(value.kind === 'goal' ? ['targetEntityId'] : [])]); text(value.idempotencyKey, 256); validateFence(value.expected)
        if (value.fictionalTime !== undefined && value.fictionalTime !== null) text(value.fictionalTime, 256)
        const ledger = unwrap(await store.readLedger(authority)), actual = ledger.sources.find(s => s.id === ctl.id)
        if (!actual || actual.origin !== 'user_control' || actual.publicTextSha256 !== ctl.publicTextSha256) denied('actual human control required')
        const eventId = 'agent_' + createHash('sha256').update(canonical({ value, control: ctl.id })).digest('hex').slice(0, 48)
        const prior = unwrap(await store.readControlCommit(authority, value.idempotencyKey))
        if (prior) {
          if (!prior.authorityChanges.some(c => c.kind === 'candidate_adoption' && c.record.controlSourceId === ctl.id && c.record.eventIds.length === 1 && c.record.eventIds[0] === eventId)) throw new RpError('idempotency_conflict', 'Agent control differs from its published effect')
          unwrap(await store.ensureDurable(authority, ledger.fence)); return { ok: true as const, value: { eventId, fence: prior.fence } }
        }
        if (canonical(ledger.fence) !== canonical(value.expected)) throw new RpError('stale_input', 'Agent input changed')
        const events = unwrap(await store.readEvents(authority)), origins = new Set<string>([ctl.id])
        let payload: EventPayload
        if (value.kind === 'experience') {
          if (!Array.isArray(value.actorIds) || !value.actorIds.length) invalid('experience actors'); value.actorIds.forEach(known)
          if (!Array.isArray(value.sourceRevisionIds) || value.sourceRevisionIds.length > 32) invalid('experience sources')
          value.sourceRevisionIds.forEach(sourceId => { id(sourceId); if (!ledger.sourceBindings.some(b => b.sourceRevisionId === sourceId && b.disposition === 'accepted')) denied('experience source must already be accepted'); origins.add(sourceId) })
          payload = { kind: 'occurrence', actorIds: value.actorIds, description: value.description }
        } else {
          if (value.previousEventId !== null) id(value.previousEventId)
          if (!Array.isArray(value.causeEventIds) || !value.causeEventIds.length || value.causeEventIds.length > 32) invalid('growth causes')
          const deps = [...value.causeEventIds, ...(value.previousEventId ? [value.previousEventId] : [])]
          for (const dep of deps) { id(dep); const event = events.find(e => e.id === dep); if (!event) denied('growth evidence unavailable'); if (value.causeEventIds.includes(dep)) event.sources.forEach(s => origins.add(s.sourceRevisionId)) }
          const goal = value.kind === 'goal' ? goalValue({ goalId: value.goalId, category: value.category, objective: value.objective, status: value.status, progress: value.progress, nextAction: value.nextAction, ...(value.targetEntityId ? { targetEntityId: value.targetEntityId } : {}) }) : null
          const g: GrowthValue = { protocol: 'agent-memory/v1', channel: value.kind, value: goal ? goal as unknown as JsonValue : (value as Progress).value, previousEventId: value.previousEventId, causeEventIds: value.causeEventIds, note: value.note }
          if (value.kind === 'state') { known(value.entityId); payload = { kind: 'state_change', subjectId: value.entityId, key: value.key, after: g as unknown as JsonValue } }
          else if (value.kind === 'relationship') { known(value.fromId); known(value.toId); payload = { kind: 'relationship_change', fromId: value.fromId, toId: value.toId, relation: value.relation, value: g as unknown as JsonValue, triggerEventIds: value.causeEventIds } }
          else { known(value.ownerId); if (value.targetEntityId) known(value.targetEntityId); payload = { kind: 'state_change', subjectId: value.ownerId, key: value.category, after: g as unknown as JsonValue } }
        }
        validatePayload(payload)
        const result = await service.applyControl(authority, ctl, { kind: 'accept', idempotencyKey: value.idempotencyKey, expected: value.expected, sourceRevisionIds: [ctl.id], events: [{ id: eventId, payload, epistemic: 'world', fictionalTime: value.fictionalTime ?? null, sourceRevisionIds: [...origins], ...(value.kind === 'experience' ? {} : { growthProtocol: 'agent-memory/v1' as const }) }] })
        return result.ok ? { ok: true as const, value: { eventId, fence: result.value as InputFence } } : result
      } catch (e) { return failure(e) }
    },
  })
}
