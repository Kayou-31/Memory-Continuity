import type {SourceSpan} from '../types.js'
import type {AudienceContext} from '../person/documents/audience.js'
export interface DiaryEvidence {eventId:string;revision:string;span:SourceSpan}
/** Optional account of an interpretation, not a truth/understanding score. */
export interface DiaryReflection {
  understanding?:string
  context?:string
  uncertainty?:string
  revisionNote?:string
  evidence?:DiaryEvidence[]
}
export interface DiaryDraft {
  entryId:string
  title:string
  body:string
  previousEventId?:string
  reflection?:DiaryReflection
}
export type DiaryAudience = {kind:'local'} | {kind:'direct';platform:string;accountId:string;senderId:string} | {kind:'group';platform:string;accountId:string;groupId:string;senderId:string}
export interface DiaryPolicy {
  protocol:'shared-diary-policy/v1'
  boardId:string
  personId:string
  humanId:string
  originEventId:string
  previousEventId:string|null
  allowAgentWrite:boolean
  audiences:DiaryAudience[]
}
export interface DiaryValue {
  protocol:'shared-diary/v1'
  boardId:string
  personId:string
  entryId:string
  policyEventId:string
  previousEventId:string|null
  author:'human'|'agent'
  editor:'human'|'agent'
  content:SourceSpan
  evidence:DiaryEvidence[]
  createdAt:string
  modifiedAt:string
  execution:DiaryExecution|null
}
export interface DiaryExecution {sessionId:string;callId:string;sourceRevisionIds:string[];key:string}
export interface DiaryAccess {boardId:string;personId:string;audience?:AudienceContext}
