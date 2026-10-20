/** RP application records. Native host capabilities are defined separately. */
export type Id = string
export type Sha256 = string
export type Revision = number
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }
export type ErrorCode = 'scope_denied' | 'invalid_record' | 'invalid_candidate' | 'source_unavailable' | 'stale_input'
  | 'idempotency_conflict' | 'persistence_failed' | 'persistence_uncertain' | 'store_locked' | 'capability_missing' | 'store_corrupt'
  | 'snapshot_changed' | 'context_budget_exceeded' | 'ownership_lost'
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: ErrorCode; readonly message: string }
export type Scope = { readonly kind: 'profile'; readonly profileId: Id }
  | { readonly kind: 'world'; readonly profileId: Id; readonly worldId: Id; readonly entityId?: Id }
  | { readonly kind: 'branch'; readonly workspaceId: Id; readonly campaignId: Id; readonly branchId: Id }
  | { readonly kind: 'session'; readonly workspaceId: Id; readonly campaignId: Id; readonly branchId: Id; readonly sessionId: Id; readonly sceneId: Id }
export type BranchScope = Extract<Scope, { kind: 'branch' | 'session' }>
export type Viewpoint = { readonly kind: 'narrator' } | { readonly kind: 'character'; readonly entityId: Id }
export interface Visibility { readonly policyId: Id; readonly revision: Revision; readonly audienceSetId: Id }
export interface WorkspaceBinding { readonly workspaceId: Id; readonly profileId: Id; readonly canonicalRootHash: Sha256; readonly migrationRevision: Revision }
export interface HostSourceLocator { readonly sessionId: Id; readonly eventSeq: number; readonly messageId: Id; readonly messageRevision: Id }
export interface SourceRevision {
  readonly schemaVersion: 1; readonly id: Id; readonly scope: Scope
  readonly origin: 'host_public' | 'user_control' | 'approved_publication'; readonly host?: HostSourceLocator; readonly turnId?: Id
  readonly role: 'user' | 'assistant' | 'tool' | 'user_control'; readonly publicTextSha256: Sha256
  readonly publicTextLengthUtf16: number; readonly blobId: Id; readonly visibility: Visibility; readonly capturedAt: string
}
export interface SourceSpan { readonly sourceRevisionId: Id; readonly publicTextSha256: Sha256; readonly startUtf16: number; readonly endUtf16: number; readonly quoteSha256: Sha256 }
export interface BranchSourceBinding {
  readonly sourceRevisionId: Id; readonly branchId: Id; readonly turnId: Id
  readonly disposition: 'candidate' | 'accepted' | 'superseded' | 'retracted' | 'discarded' | 'pending_replay'
  readonly acceptedSeq: number | null; readonly supersedes?: Id
}
export interface Branch {
  readonly schemaVersion: 1; readonly id: Id; readonly workspaceId: Id; readonly campaignId: Id; readonly contextRevision: Revision
  readonly parent: null | { readonly branchId: Id; readonly contextRevision: Revision; readonly prefixManifestHash: Sha256; readonly validityManifestHash?: Sha256 }
  readonly activeSourceManifestHash: Sha256; readonly canonBindingsHash: Sha256
}
export interface InputFence {
  readonly branchId: Id; readonly contextRevision: Revision; readonly sourceManifestHash: Sha256; readonly canonBindingsHash: Sha256
  readonly visibilityRevision: Revision; readonly deletionGeneration: Revision; readonly policyVersion: string
}
export type EventPayload =
  | { readonly kind: 'canon_assertion'; readonly subjectId: Id; readonly key: string; readonly value: JsonValue; readonly locked: boolean }
  | { readonly kind: 'occurrence'; readonly actorIds: readonly Id[]; readonly description: string }
  | { readonly kind: 'state_change'; readonly subjectId: Id; readonly key: string; readonly before?: JsonValue; readonly after: JsonValue }
  | { readonly kind: 'knowledge_change'; readonly knowerId: Id; readonly claimId: Id; readonly action: 'learn' | 'believe' | 'doubt' | 'forget' }
  | { readonly kind: 'relationship_change'; readonly fromId: Id; readonly toId: Id; readonly relation: string; readonly value: JsonValue; readonly triggerEventIds: readonly Id[]; readonly unresolvedTension?: string }
  | { readonly kind: 'correction'; readonly targetEventIds: readonly Id[]; readonly replacementEventIds: readonly Id[]; readonly reason: string }
  | { readonly kind: 'preference_change'; readonly key: 'language' | 'person' | 'dialogue_format' | 'prose_style'; readonly value: string }
export type EpistemicClass = 'world' | 'belief' | 'utterance' | 'uncertain'
export type AuthorityClass = 'user_canon' | 'explicit_ooc' | 'accepted_narration' | 'character_statement' | 'inference'
export interface SemanticEvent {
  readonly schemaVersion: 1; readonly id: Id; readonly scope: Scope; readonly acceptedSeq: number; readonly fictionalTime: string | null
  readonly payload: EventPayload; readonly epistemic: EpistemicClass; readonly authority: AuthorityClass; readonly beliefHolderId?: Id
  readonly sources: readonly SourceSpan[]; readonly visibility: Visibility; readonly supersedes: readonly Id[]; readonly policyVersion: string
}
export interface Summary {
  readonly schemaVersion: 1; readonly id: Id; readonly scope: Scope; readonly level: 'scene' | 'chapter' | 'arc'; readonly createdFrom: InputFence
  readonly sourceRevisionIds: readonly Id[]; readonly dependencySummaryIds: readonly Id[]; readonly supportEventIds: readonly Id[]
  readonly exactAnchors: readonly SourceSpan[]; readonly text: string; readonly visibility: Visibility; readonly policyVersion: string
  readonly measuredTokens: number; readonly tokenMeasurement: 'exact' | 'estimated'
}
export interface CanonBinding { readonly worldId: Id; readonly entityId?: Id; readonly publicationId: Id; readonly revision: Revision; readonly bodySha256: Sha256 }
export interface DeletionMarker {
  readonly id: Id; readonly generation: Revision; readonly scope: Scope; readonly sourceRevisionIds: readonly Id[]; readonly blockedDerivedIds: readonly Id[]
  readonly purgeState: 'blocked' | 'purging' | 'complete' | 'limited'; readonly externalLimitations: readonly string[]
}
/** Fixed parent manifest is authority metadata, never a mutable pointer. */
export type AuthorityChange =
  | { readonly kind: 'branch_parent'; readonly recordId: Id; readonly record: NonNullable<Branch['parent']> & { readonly sourceBindings: readonly BranchSourceBinding[] } }
  | { readonly kind: 'canon_binding'; readonly recordId: Id; readonly record: CanonBinding }
  | { readonly kind: 'visibility'; readonly recordId: Id; readonly record: Visibility }
  | { readonly kind: 'deletion'; readonly recordId: Id; readonly record: DeletionMarker }
  | { readonly kind: 'candidate_adoption'; readonly recordId: Id; readonly record: { readonly candidateId: Id; readonly sourceRevisionIds: readonly Id[]; readonly eventIds: readonly Id[]; readonly summaryIds: readonly Id[]; readonly decision: 'accepted' | 'rejected'; readonly controlSourceId: Id } }
export interface Job {
  readonly id: Id; readonly kind: 'extract' | 'summarize' | 'reindex'; readonly inputFence: InputFence; readonly attempts: number; readonly maxAttempts: 3
  readonly state: 'queued' | 'running' | 'prepared' | 'committed' | 'stale' | 'deferred' | 'failed' | 'cancelled'; readonly idempotencyKey: string; readonly errorCode?: ErrorCode
  readonly inputCopyId?: Id; readonly summaryId?: Id
}
export interface CommitBatch {
  readonly schemaVersion: 1; readonly idempotencyKey: string; readonly expected: InputFence; readonly sourceBindings: readonly BranchSourceBinding[]
  readonly events: readonly SemanticEvent[]; readonly summaries: readonly Summary[]; readonly jobs: readonly Job[]; readonly invalidatedIds: readonly Id[]
  readonly authorityChanges: readonly AuthorityChange[]; readonly nextContextRevision: Revision
  readonly expectedJobs?: readonly Job[]
}
declare const hostAuthorityBrand: unique symbol
export interface HostAuthority { readonly [hostAuthorityBrand]: true; readonly scope: BranchScope; readonly viewpoint: Viewpoint; readonly visibility: Visibility }
export interface SourceObservation {
  readonly idempotencyKey: string; readonly origin: 'host_public' | 'user_control'; readonly host?: HostSourceLocator; readonly turnId: Id
  readonly role: SourceRevision['role']; readonly publicText: string
}
export type RpRecord = { readonly kind: 'source'; readonly record: SourceRevision } | { readonly kind: 'event'; readonly record: SemanticEvent }
  | { readonly kind: 'summary'; readonly record: Summary } | { readonly kind: 'branch'; readonly record: Branch }
  | { readonly kind: 'job'; readonly record: Job } | { readonly kind: 'batch'; readonly record: CommitBatch }
/** Text/payload fields are deliberately absent from immutable commits. */
export interface StoredDerived {
  readonly id: Id; readonly kind: 'event' | 'summary'; readonly blobId: Id; readonly bodySha256: Sha256; readonly scope: Scope
  readonly sourceRevisionIds: readonly Id[]; readonly dependencyIds: readonly Id[]; readonly visibility: Visibility; readonly policyVersion: string
  readonly active: boolean
}
export interface LedgerSnapshot {
  readonly branch: Branch; readonly fence: InputFence; readonly sources: readonly SourceRevision[]; readonly sourceBindings: readonly BranchSourceBinding[]
  readonly records: readonly StoredDerived[]; readonly jobs: readonly Job[]; readonly authorityChanges: readonly AuthorityChange[]; readonly deletions: readonly DeletionMarker[]
}
export interface StateProjection {
  readonly branchId: Id; readonly contextRevision: Revision; readonly subjectId: Id; readonly key: string; readonly value: JsonValue
  readonly resolution: 'known' | 'unknown' | 'conflict'; readonly epistemic: EpistemicClass; readonly beliefHolderId?: Id
  readonly supportEventIds: readonly Id[]; readonly sources: readonly SourceSpan[]; readonly conflict: 'none' | 'unresolved'; readonly visibility: Visibility
}
export interface ClaimAssessment { readonly truth: 'true' | 'false' | 'unknown'; readonly supportEventIds: readonly Id[]; readonly conflict: 'none' | 'unresolved' }
export interface KnowledgeProjection {
  readonly knowerId: Id; readonly claimId: Id; readonly known: boolean; readonly action: 'learn' | 'believe' | 'doubt' | 'forget'
  readonly supportEventIds: readonly Id[]; readonly sources: readonly SourceSpan[]
}
export interface RelationshipProjection {
  readonly fromId: Id; readonly toId: Id; readonly relation: string; readonly value: JsonValue; readonly resolution: 'known' | 'conflict'
  readonly epistemic: EpistemicClass; readonly beliefHolderId?: Id; readonly triggerEventIds: readonly Id[]; readonly unresolvedTension?: string
  readonly supportEventIds: readonly Id[]; readonly sources: readonly SourceSpan[]
}
export interface ProjectionResult {
  readonly state: readonly StateProjection[]; readonly claims: readonly (ClaimAssessment & { readonly claimEventId: Id })[]
  readonly conflicts: readonly { readonly eventIds: readonly Id[]; readonly subjectId: Id; readonly key: string }[]
  readonly knowledge: readonly KnowledgeProjection[]; readonly relationships: readonly RelationshipProjection[]
}
/** Content-bearing plugin copies share the source ledger and deletable blob store.
 * No arbitrary filesystem paths, global publications or host surfaces are implied. */
export interface PayloadCopy {
  readonly id: Id; readonly kind: 'projection' | 'scene' | 'chapter' | 'cache' | 'job_input' | 'archive' | 'snapshot' | 'index'
  readonly branchId: Id; readonly sourceRevisionIds: readonly Id[]; readonly dependencyIds: readonly Id[]
  readonly visibility: Visibility; readonly blobId: Id; readonly bodySha256: Sha256
}
export interface ForkManifest { readonly parentRevision: Revision; readonly prefixManifestHash: Sha256; readonly validityManifestHash: Sha256 }
export interface PrivacyDeletion {
  readonly operationId: string; readonly sourceRevisionIds: readonly Id[]; readonly affectedBranchIds: readonly Id[]
  readonly blockedDerivedIds: readonly Id[]; readonly blobIds: readonly Id[]; readonly purgeState: 'blocked' | 'complete'
  readonly externalLimitations: readonly string[]
}
