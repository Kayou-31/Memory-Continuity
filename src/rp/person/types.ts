export type PersonFieldKind = 'identity' | 'background' | 'voice' | 'values' | 'boundaries' | 'trait' | 'feeling' | 'stage'
export type PersonPolicy = 'stable' | 'growable' | 'situational'
export type PersonValidity = {kind:'scene';sceneId:string} | {kind:'sequence';from:number;through:number}
export interface PersonField { fieldId: string; kind: PersonFieldKind; value: string; policy: PersonPolicy; validity?: PersonValidity }
export interface PersonDraft {
  schemaVersion: 1; kind: 'person-draft'; personId: string; fields: PersonField[]
  relationships: { targetId: string; relation: string; value: string }[]
  goals: { goalId: string; category: 'task' | 'promise'; objective: string; nextAction: string; targetEntityId?: string }[]
}
export interface PersonValue extends PersonField {
  protocol: 'person-core/v1'; operation: 'init' | 'edit' | 'grow' | 'set-policy'; previousEventId: string | null; causeEventIds: string[]; note: string
}
