import type { RpReadView } from '../store.js'
import { RpError } from '../schema.js'
import { semanticProtocol } from '../semantic-registry.js'
import { personValue } from './format.js'
export function projectPerson(view: RpReadView, personId: string) {
  const origin = view.events.find(e => semanticProtocol(e) === 'person-origin/v1' && e.payload.kind === 'occurrence' && e.payload.actorIds[0] === personId)
  if (!origin) throw new RpError('source_unavailable', 'Person origin unavailable in this branch')
  return { personId, originEventId: origin.id, fence: view.fence,
    fields: view.events.flatMap(e => { const v = personValue(e); return v && e.payload.kind === 'state_change' && e.payload.subjectId === personId ? [{ ...v, eventId: e.id }] : [] }),
    relationships: view.projection.relationships.filter(r => r.fromId === personId),
    goals: view.projection.state.filter(s => s.subjectId === personId && /^(task|promise):/.test(s.key)) }
}
