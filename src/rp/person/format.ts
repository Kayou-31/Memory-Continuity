import type { SemanticEvent } from '../types.js'
import { denied, id, invalid, object, text, RpError } from '../schema.js'
import { semanticProtocol } from '../semantic-registry.js'
import { personField, personKeys } from './schema.js'
import type { PersonValue } from './types.js'
export function personValue(event: SemanticEvent): PersonValue | null {
  if (semanticProtocol(event) !== 'person-core/v1') return null
  const p = event.payload
  if (p.kind !== 'state_change') invalid('person field payload')
  const v = object(p.after, ['protocol', 'operation', 'fieldId', 'kind', 'value', 'policy', 'previousEventId', 'causeEventIds', 'note'], ['validity'])
  if (v.protocol !== 'person-core/v1' || !['init','edit','grow','set-policy'].includes(v.operation)) invalid('person operation')
  if(v.operation==='init') { if(v.previousEventId!==null)invalid('person initial predecessor') } else id(v.previousEventId)
  personField({ fieldId: v.fieldId, kind: v.kind, value: v.value, policy: v.policy, ...(v.validity?{validity:v.validity}:{}) })
  if (p.key !== personKeys[v.kind as PersonValue['kind']]) invalid('person storage key')
  if (!Array.isArray(v.causeEventIds) || v.causeEventIds.length > 32 || new Set(v.causeEventIds).size!==v.causeEventIds.length || (v.operation==='init' ? v.causeEventIds.length!==1 : v.operation==='grow' ? !v.causeEventIds.length : v.causeEventIds.length!==0)) invalid('person causes')
  v.causeEventIds.forEach(id); text(v.note, 2048)
  if (event.epistemic !== 'world' || !['user_canon','explicit_ooc'].includes(event.authority) || event.supersedes.length) denied('person explicit control required')
  return v as PersonValue
}
export function checkPersonTransition(event: SemanticEvent, history: readonly SemanticEvent[]) {
  const v = personValue(event); if (!v || event.payload.kind !== 'state_change') return
  const subject = event.payload.subjectId
  const fields=history.filter(e=>e.payload.kind==='state_change'&&e.payload.subjectId===subject&&personValue(e)?.fieldId===v.fieldId)
  if(v.operation==='init') {
    if(fields.length)invalid('duplicate person field initialization')
    const origin = history.find(e => e.id === v.causeEventIds[0])
    if (!origin || semanticProtocol(origin) !== 'person-origin/v1' || origin.payload.kind !== 'occurrence' || origin.payload.actorIds[0] !== subject || origin.acceptedSeq > event.acceptedSeq) invalid('person origin unavailable')
    return
  }
  const predecessors=new Set(fields.map(e=>personValue(e)!.previousEventId)), heads=fields.filter(e=>!predecessors.has(e.id))
  if(heads.length!==1 || heads[0].id!==v.previousEventId)throw new RpError('stale_input','Person change requires the unique current predecessor')
  const old=personValue(heads[0])!
  if(old.kind!==v.kind || heads[0].acceptedSeq>event.acceptedSeq)invalid('person field identity/order')
  if(v.operation==='set-policy') {if(v.value!==old.value)invalid('policy change must retain value')}
  else if(v.policy!==old.policy)denied('use explicit set-policy')
  if(v.operation==='grow') {
    if(old.policy!=='growable')denied('only growable person fields can grow')
    for(const id of v.causeEventIds) {const cause=history.find(e=>e.id===id);if(!cause || cause.payload.kind!=='occurrence' || cause.epistemic!=='world' || cause.acceptedSeq>event.acceptedSeq || semanticProtocol(cause)==='person-origin/v1')invalid('person growth requires accepted experiences, not initial definitions')}
  }
}
export function personApplies(event:SemanticEvent, context?:{sceneId?:string;acceptedSeq:number}):boolean {
  const v=personValue(event);if(!v || v.policy!=='situational')return true
  if(!context)return false
  return v.validity?.kind==='scene' ? v.validity.sceneId===context.sceneId : !!v.validity && context.acceptedSeq>=v.validity.from && context.acceptedSeq<=v.validity.through
}
