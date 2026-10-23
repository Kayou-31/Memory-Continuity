export type PersonFieldKind = 'identity' | 'background' | 'voice' | 'values' | 'boundaries'
export type PersonPolicy = 'stable' | 'growable' | 'situational'
export interface PersonField { fieldId: string; kind: PersonFieldKind; value: string; policy: PersonPolicy }
export interface PersonDraft {
  schemaVersion: 1; kind: 'person-draft'; personId: string; fields: PersonField[]
  relationships: { targetId: string; relation: string; value: string }[]
  goals: { goalId: string; category: 'task' | 'promise'; objective: string; nextAction: string; targetEntityId?: string }[]
}
export interface PersonValue extends PersonField {
  protocol: 'person-core/v1'; operation: 'init'; previousEventId: null; causeEventIds: string[]; note: string
}
