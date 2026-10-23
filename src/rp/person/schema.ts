import { cloneInput, denied, id, invalid, object, text } from '../schema.js'
import type { PersonDraft, PersonField } from './types.js'
export const personKeys: Record<PersonField['kind'], string> = { identity: 'identity', background: 'background', voice: 'voice', values: 'rule', boundaries: 'rule' }
export function personField(input: unknown): asserts input is PersonField {
  const f = object(input, ['fieldId', 'kind', 'value', 'policy']); id(f.fieldId); text(f.value, 2048, true)
  if (!Object.hasOwn(personKeys, f.kind) || !['stable', 'growable'].includes(f.policy)) invalid('person field kind/policy')
}
export function personDraft(input: unknown, known: ReadonlySet<string>): PersonDraft {
  const value = cloneInput(input)
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 65536) invalid('person draft exceeds 64 KiB')
  const d = object(value, ['schemaVersion', 'kind', 'personId', 'fields', 'relationships', 'goals'])
  if (d.schemaVersion !== 1 || d.kind !== 'person-draft') invalid('person draft version')
  const entity = (v: unknown) => { id(v); if (!known.has(v)) denied('unknown person entity') }
  entity(d.personId)
  if (!Array.isArray(d.fields) || !d.fields.length || d.fields.length > 128) invalid('person field count')
  d.fields.forEach(personField); if (new Set(d.fields.map((f: PersonField) => f.fieldId)).size !== d.fields.length) invalid('duplicate person field')
  if (!Array.isArray(d.relationships) || d.relationships.length > 32 || !Array.isArray(d.goals) || d.goals.length > 16) invalid('person relationships/goals count')
  for (const rel of d.relationships) {
    object(rel, ['targetId', 'relation', 'value']); entity(rel.targetId); text(rel.value, 2048, true)
    if (!['trust','affection','loyalty','rivalry','debt','promise','kinship','alliance','tension'].includes(rel.relation)) invalid('person relationship')
  }
  if (new Set(d.relationships.map((r: { targetId: string; relation: string }) => r.targetId+':'+r.relation)).size !== d.relationships.length) invalid('duplicate relationship')
  for (const g of d.goals) {
    object(g, ['goalId', 'category', 'objective', 'nextAction'], ['targetEntityId']); id(g.goalId); text(g.objective, 2048); text(g.nextAction, 2048, true)
    if (!['task', 'promise'].includes(g.category)) invalid('person goal category')
    if (g.category === 'promise') entity(g.targetEntityId); else if (g.targetEntityId !== undefined) invalid('task target')
  }
  if (new Set(d.goals.map((g: { goalId: string }) => g.goalId)).size !== d.goals.length) invalid('duplicate goal')
  if (1+d.fields.length+d.relationships.length+d.goals.length > 256) invalid('person initialization event count')
  return d as PersonDraft
}
