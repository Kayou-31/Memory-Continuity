import { createHash } from 'node:crypto'
import { canonical, type RpStore } from '../store.js'
import type { createCanonicalService, EventProposal } from '../canonical.js'
import type { HostAuthority, InputFence, JsonValue, SourceRevision } from '../types.js'
import { denied, failure, id, invalid, RpError, text } from '../schema.js'
import { unwrap } from '../retrieval.js'
import { hasPersonOwner } from '../semantic-registry.js'
import { personDraft, personKeys } from './schema.js'
import { projectPerson } from './projection.js'
import type { PersonDraft } from './types.js'
const digest = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex')
export function createPersonService(store: RpStore, service: ReturnType<typeof createCanonicalService>, entityIds: readonly string[]) {
  type Preview = { authority: HostAuthority; draft: PersonDraft; key: string; expected: InputFence; originId: string; draftHash: string }
  const previews = new WeakMap<object, Preview>(), known = new Set(entityIds)
  const operationKey = (key: string) => 'person:' + key
  return Object.freeze({
    async preview(authority: HostAuthority, input: unknown, key: string) {
      try {
        text(key, 240); const draft = personDraft(input, known), draftHash = digest(draft)
        const view = unwrap(await store.withReadView(authority, v => v.ledger!, { audit: true }))
        const originId = 'person_' + digest({ scope: [view.branch.workspaceId, view.branch.campaignId, view.branch.id], key, draftHash }).slice(0, 48)
        const prior = unwrap(await store.readControlCommit(authority, operationKey(key)))
        if (prior) {
          if (!prior.authorityChanges.some(c => c.kind === 'candidate_adoption' && c.recordId === 'person_origin_' + originId)) throw new RpError('idempotency_conflict', 'Person operation key has different draft content')
        } else {
          if (hasPersonOwner(view.authorityChanges, draft.personId)) invalid('person already initialized in this life branch')
          const events = unwrap(await store.readEvents(authority)), conflicts = events.filter(e => (e.payload.kind === 'state_change' || e.payload.kind === 'canon_assertion') && e.payload.subjectId === draft.personId && ['identity','background','voice','rule'].includes(e.payload.key))
          if (conflicts.length) denied('legacy person field conflicts: ' + conflicts.map(e => e.id).join(', '))
        }
        const handle = Object.freeze({}), record = { authority, draft, key, expected: view.fence, originId, draftHash }
        previews.set(handle, record)
        return { ok: true as const, value: { handle, personId: draft.personId, draftHash, inputFence: structuredClone(view.fence), draft: structuredClone(draft), backupRequired: !view.authorityChanges.some(c => c.kind === 'candidate_adoption' && c.record.candidateId.startsWith('person_origin_')) } }
      } catch (e) { return failure(e) }
    },
    async confirm(authority: HostAuthority, handle: object, controlSource: SourceRevision) {
      try {
        const p = handle && previews.get(handle); if (!p || p.authority !== authority) denied('unknown or cross-authority person preview')
        const ledger = unwrap(await store.readLedger(authority)), actual = ledger.sources.find(s => s.id === controlSource.id)
        if (!actual || actual.origin !== 'user_control' || actual.publicTextSha256 !== controlSource.publicTextSha256) denied('actual person confirmation required')
        const prior = unwrap(await store.readControlCommit(authority, operationKey(p.key)))
        if (prior) {
          if (!prior.authorityChanges.some(c => c.kind === 'candidate_adoption' && c.recordId === 'person_origin_' + p.originId)) throw new RpError('idempotency_conflict', 'Person operation changed')
          unwrap(await store.ensureDurable(authority, ledger.fence))
          return { ok: true as const, value: { personId: p.draft.personId, originEventId: p.originId, fence: prior.fence } }
        }
        if (canonical(ledger.fence) !== canonical(p.expected)) throw new RpError('stale_input', 'Person preview changed; preview again')
        const d = p.draft, eventId = (slot: string) => 'person_' + digest([p.originId, slot]).slice(0, 48)
        const events: EventProposal[] = [{ id: p.originId, personProtocol: 'person-origin/v1', epistemic: 'world', payload: { kind: 'occurrence', actorIds: [d.personId], description: '用户定义人物起点；这是初始设定，不是已执行的宿主行动。' } }]
        for (const field of d.fields) events.push({ id: eventId('field:'+field.fieldId), personProtocol: 'person-core/v1', epistemic: 'world', payload: { kind: 'state_change', subjectId: d.personId, key: personKeys[field.kind], after: { protocol: 'person-core/v1', operation: 'init', ...field, previousEventId: null, causeEventIds: [p.originId], note: '用户确认的初始人物定义' } } })
        for (const rel of d.relationships) events.push({ id: eventId('relationship:'+rel.targetId+':'+rel.relation), growthProtocol: 'agent-memory/v1', epistemic: 'world', payload: { kind: 'relationship_change', fromId: d.personId, toId: rel.targetId, relation: rel.relation, triggerEventIds: [p.originId], value: { protocol: 'agent-memory/v1', channel: 'relationship', value: rel.value, previousEventId: null, causeEventIds: [p.originId], note: '用户确认的初始关系' } } })
        for (const goal of d.goals) events.push({ id: eventId('goal:'+goal.goalId), growthProtocol: 'agent-memory/v1', epistemic: 'world', payload: { kind: 'state_change', subjectId: d.personId, key: goal.category, after: { protocol: 'agent-memory/v1', channel: 'goal', value: { ...goal, status: 'active', progress: 0 }, previousEventId: null, causeEventIds: [p.originId], note: '用户确认的初始目标' } as JsonValue } })
        const result = await service.applyControl(authority, actual, { kind: 'accept', idempotencyKey: operationKey(p.key), expected: p.expected, sourceRevisionIds: [actual.id], events })
        return result.ok ? { ok: true as const, value: { personId: d.personId, originEventId: p.originId, fence: result.value as InputFence } } : result
      } catch (e) { return failure(e) }
    },
    async read(authority: HostAuthority, personId: string) {
      try { id(personId); if (!known.has(personId)) denied('unknown person entity'); return await store.withReadView(authority, view => projectPerson(view, personId)) }
      catch (e) { return failure(e) }
    },
  })
}
