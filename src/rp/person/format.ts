import type { SemanticEvent } from '../types.js'
import { denied, id, invalid, object, text } from '../schema.js'
import { semanticProtocol } from '../semantic-registry.js'
import { personField, personKeys } from './schema.js'
import type { PersonValue } from './types.js'
export function personValue(event: SemanticEvent): PersonValue | null {
  if (semanticProtocol(event) !== 'person-core/v1') return null
  const p = event.payload
  if (p.kind !== 'state_change') invalid('person field payload')
  const v = object(p.after, ['protocol', 'operation', 'fieldId', 'kind', 'value', 'policy', 'previousEventId', 'causeEventIds', 'note'])
  if (v.protocol !== 'person-core/v1' || v.operation !== 'init' || v.previousEventId !== null) invalid('person operation')
  personField({ fieldId: v.fieldId, kind: v.kind, value: v.value, policy: v.policy })
  if (p.key !== personKeys[v.kind as PersonValue['kind']]) invalid('person storage key')
  if (!Array.isArray(v.causeEventIds) || v.causeEventIds.length !== 1) invalid('person origin dependency')
  v.causeEventIds.forEach(id); text(v.note, 2048)
  if (event.epistemic !== 'world' || !['user_canon','explicit_ooc'].includes(event.authority) || event.supersedes.length) denied('person explicit control required')
  return v as PersonValue
}
export function checkPersonTransition(event: SemanticEvent, history: readonly SemanticEvent[]) {
  const v = personValue(event); if (!v || event.payload.kind !== 'state_change') return
  const subject = event.payload.subjectId
  if (history.some(e => e.payload.kind === 'state_change' && e.payload.subjectId === subject && personValue(e)?.fieldId === v.fieldId)) invalid('duplicate person field initialization')
  const origin = history.find(e => e.id === v.causeEventIds[0])
  if (!origin || semanticProtocol(origin) !== 'person-origin/v1' || origin.payload.kind !== 'occurrence' || origin.payload.actorIds[0] !== subject || origin.acceptedSeq > event.acceptedSeq) invalid('person origin unavailable')
}
