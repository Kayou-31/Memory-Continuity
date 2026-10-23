import type { Result, RpRecord, CommitBatch, SourceObservation, SourceSpan, Scope, Visibility, EventPayload, SemanticEvent, Summary, Branch, BranchSourceBinding, InputFence, Job, AuthorityChange } from './types.js'

export class RpError extends Error {
  constructor(readonly code: import('./types.js').ErrorCode, message: string) { super(message) }
}
export function invalid(field: string): never { throw new RpError('invalid_record', 'Invalid RP record: ' + field) }
export function denied(field: string): never { throw new RpError('scope_denied', 'RP scope denied: ' + field) }
export function wellFormed(v: string): boolean { return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v) }
export function object(v: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)) invalid('object')
  const r = v as Record<string, any>
  const keys = Object.keys(r)
  for (const key of keys) {
    if (!required.includes(key) && !optional.includes(key)) {
      if (/^(?:approved|authority|owner|ownership|trusted|profile|profileId|scope|viewpoint|narrator|global|reasoning|accepted)$/u.test(key)) denied('untrusted authority field')
      invalid('unknown field ' + key)
    }
    if (!('value' in Object.getOwnPropertyDescriptor(r, key)!)) invalid('accessor')
  }
  for (const key of required) if (!Object.hasOwn(r, key) || r[key] === undefined) invalid('missing ' + key)
  return r
}
export function text(v: unknown, max = 4096, empty = false): asserts v is string {
  if (typeof v !== 'string' || (!empty && !v.trim()) || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v)) invalid('text')
  // Buffer's replacement of lone surrogates would destroy exact source identity.
  if (!wellFormed(v)) invalid('unpaired surrogate')
}
export function id(v: unknown): asserts v is string { if (typeof v !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(v)) invalid('id') }
/** SDK UUID identities may start with a digit; they are never filesystem paths. */
export function hostId(v: unknown): asserts v is string { if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(v)) invalid('host id') }
export function hash(v: unknown): asserts v is string { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/u.test(v)) invalid('sha256') }
export function integer(v: unknown, min = 0): asserts v is number { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) invalid('safe integer') }
function choice(v: unknown, choices: readonly unknown[]) { if (!choices.includes(v)) invalid('enum') }
function list(v: unknown, parse: (entry: any) => void, max = 2048, min = 0) { if (!Array.isArray(v) || v.length > max || v.length < min) invalid('array'); v.forEach(parse) }
function ids(v: unknown, min = 0) { list(v, id, 2048, min); if (new Set(v as string[]).size !== (v as string[]).length) invalid('duplicate IDs') }
function version(v: unknown) { if (v !== 1) invalid('schemaVersion') }
export const MAX_EXACT_ANCHORS = 256
export function scope(v: unknown): asserts v is Scope {
  const kind = (v as any)?.kind
  const fields = kind === 'profile' ? ['kind', 'profileId'] : kind === 'world' ? ['kind', 'profileId', 'worldId'] : kind === 'branch' ? ['kind', 'workspaceId', 'campaignId', 'branchId'] : kind === 'session' ? ['kind', 'workspaceId', 'campaignId', 'branchId', 'sessionId', 'sceneId'] : invalid('scope kind')
  const r = object(v, fields, kind === 'world' ? ['entityId'] : [])
  Object.entries(r).forEach(([key, value]) => { if (key === 'sessionId') hostId(value); else if (key !== 'kind') id(value) })
}
export function visibility(v: unknown): asserts v is Visibility { const r = object(v, ['policyId', 'revision', 'audienceSetId']); id(r.policyId); integer(r.revision); id(r.audienceSetId) }
export function fence(v: unknown): asserts v is InputFence {
  const r = object(v, ['branchId', 'contextRevision', 'sourceManifestHash', 'canonBindingsHash', 'visibilityRevision', 'deletionGeneration', 'policyVersion'])
  id(r.branchId); integer(r.contextRevision); hash(r.sourceManifestHash); hash(r.canonBindingsHash); integer(r.visibilityRevision); integer(r.deletionGeneration); text(r.policyVersion, 128)
}
export function sourceSpan(v: unknown): asserts v is SourceSpan { const r = object(v, ['sourceRevisionId', 'publicTextSha256', 'startUtf16', 'endUtf16', 'quoteSha256']); id(r.sourceRevisionId); hash(r.publicTextSha256); hash(r.quoteSha256); integer(r.startUtf16); integer(r.endUtf16); if (r.endUtf16 < r.startUtf16) invalid('span order') }
export function binding(v: unknown): asserts v is BranchSourceBinding {
  const r = object(v, ['sourceRevisionId', 'branchId', 'turnId', 'disposition', 'acceptedSeq'], ['supersedes'])
  id(r.sourceRevisionId); id(r.branchId); id(r.turnId); choice(r.disposition, ['candidate', 'accepted', 'superseded', 'retracted', 'discarded', 'pending_replay'])
  if (r.acceptedSeq !== null) integer(r.acceptedSeq, 1)
  if (r.disposition === 'accepted' && r.acceptedSeq === null) invalid('accepted sequence')
  if (r.supersedes !== undefined) id(r.supersedes)
}
function locator(v: unknown) { const r = object(v, ['sessionId', 'eventSeq', 'messageId', 'messageRevision']); hostId(r.sessionId); integer(r.eventSeq); hostId(r.messageId); hostId(r.messageRevision) }
function source(v: unknown) {
  const r = object(v, ['schemaVersion', 'id', 'scope', 'origin', 'role', 'publicTextSha256', 'publicTextLengthUtf16', 'blobId', 'visibility', 'capturedAt'], ['host', 'turnId'])
  version(r.schemaVersion); id(r.id); scope(r.scope); choice(r.origin, ['host_public', 'user_control', 'approved_publication']); choice(r.role, ['user', 'assistant', 'tool', 'user_control'])
  hash(r.publicTextSha256); integer(r.publicTextLengthUtf16); if (r.publicTextLengthUtf16 > 1048576) invalid('source text size'); id(r.blobId); if (r.blobId !== 'blob_' + r.publicTextSha256) invalid('source blob identity'); visibility(r.visibility); text(r.capturedAt, 64)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(r.capturedAt) || !Number.isFinite(Date.parse(r.capturedAt))) invalid('capture time')
  if (r.turnId !== undefined) id(r.turnId)
  if (r.host !== undefined) locator(r.host)
  if ((r.origin === 'host_public') !== (r.host !== undefined)) invalid('host provenance')
  if (r.origin === 'user_control' && r.role !== 'user_control') invalid('control role')
}
function value(v: unknown, depth = 0): void {
  if (depth > 12) invalid('JSON depth')
  if (v === null || typeof v === 'boolean') return
  if (typeof v === 'number') { if (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v))) invalid('JSON number'); return }
  if (typeof v === 'string') { text(v, 16384, true); return }
  if (Array.isArray(v)) return list(v, entry => value(entry, depth + 1), 256)
  const r = object(v, [], Object.keys(v as object ?? {})); if (Object.keys(r).length > 128) invalid('JSON object size')
  for (const [key, entry] of Object.entries(r)) { if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) invalid('JSON key'); value(entry, depth + 1) }
}
const stateKeys = ['location', 'owner', 'condition', 'status', 'alive', 'color', 'injury', 'promise', 'task', 'inventory', 'identity', 'voice', 'background', 'rule']
export function payload(v: unknown): asserts v is EventPayload {
  const kind = (v as any)?.kind
  let r: Record<string, any>
  switch (kind) {
    case 'canon_assertion': r = object(v, ['kind', 'subjectId', 'key', 'value', 'locked']); id(r.subjectId); choice(r.key, stateKeys); value(r.value); if (typeof r.locked !== 'boolean') invalid('locked'); break
    case 'occurrence': r = object(v, ['kind', 'actorIds', 'description']); ids(r.actorIds, 1); text(r.description, 65536); break
    case 'state_change': r = object(v, ['kind', 'subjectId', 'key', 'after'], ['before']); id(r.subjectId); choice(r.key, stateKeys); value(r.after); if (r.before !== undefined) value(r.before); break
    case 'knowledge_change': r = object(v, ['kind', 'knowerId', 'claimId', 'action']); id(r.knowerId); id(r.claimId); choice(r.action, ['learn', 'believe', 'doubt', 'forget']); break
    case 'relationship_change': r = object(v, ['kind', 'fromId', 'toId', 'relation', 'value', 'triggerEventIds'], ['unresolvedTension']); id(r.fromId); id(r.toId); choice(r.relation, ['trust', 'affection', 'loyalty', 'rivalry', 'debt', 'promise', 'kinship', 'alliance', 'tension']); value(r.value); ids(r.triggerEventIds, 1); if (r.unresolvedTension !== undefined) text(r.unresolvedTension, 16384); break
    case 'correction': r = object(v, ['kind', 'targetEventIds', 'replacementEventIds', 'reason']); ids(r.targetEventIds, 1); ids(r.replacementEventIds); text(r.reason, 16384); break
    case 'preference_change': r = object(v, ['kind', 'key', 'value']); choice(r.key, ['language', 'person', 'dialogue_format', 'prose_style']); text(r.value, 4096); break
    default: invalid('payload kind')
  }
}
export function event(v: unknown): asserts v is SemanticEvent {
  const r = object(v, ['schemaVersion', 'id', 'scope', 'acceptedSeq', 'fictionalTime', 'payload', 'epistemic', 'authority', 'sources', 'visibility', 'supersedes', 'policyVersion'], ['beliefHolderId'])
  version(r.schemaVersion); id(r.id); scope(r.scope); integer(r.acceptedSeq, 1); if (r.fictionalTime !== null) text(r.fictionalTime, 256)
  payload(r.payload); choice(r.epistemic, ['world', 'belief', 'utterance', 'uncertain']); choice(r.authority, ['user_canon', 'explicit_ooc', 'accepted_narration', 'character_statement', 'inference'])
  if (r.epistemic === 'belief') id(r.beliefHolderId); else if (r.beliefHolderId !== undefined) invalid('belief holder outside belief')
  list(r.sources, sourceSpan, 256, 1); visibility(r.visibility); ids(r.supersedes); text(r.policyVersion, 128)
}
export function summary(v: unknown): asserts v is Summary {
  const r = object(v, ['schemaVersion', 'id', 'scope', 'level', 'createdFrom', 'sourceRevisionIds', 'dependencySummaryIds', 'supportEventIds', 'exactAnchors', 'text', 'visibility', 'policyVersion', 'measuredTokens', 'tokenMeasurement'])
  version(r.schemaVersion); id(r.id); scope(r.scope); choice(r.level, ['scene', 'chapter', 'arc']); fence(r.createdFrom); ids(r.sourceRevisionIds, 1); ids(r.dependencySummaryIds); ids(r.supportEventIds); list(r.exactAnchors, sourceSpan, MAX_EXACT_ANCHORS); text(r.text, 262144); visibility(r.visibility); text(r.policyVersion, 128); integer(r.measuredTokens); choice(r.tokenMeasurement, ['exact', 'estimated'])
}
export function branch(v: unknown): asserts v is Branch {
  const r = object(v, ['schemaVersion', 'id', 'workspaceId', 'campaignId', 'contextRevision', 'parent', 'activeSourceManifestHash', 'canonBindingsHash']); version(r.schemaVersion); id(r.id); id(r.workspaceId); id(r.campaignId); integer(r.contextRevision); hash(r.activeSourceManifestHash); hash(r.canonBindingsHash)
  if (r.parent !== null) parent(r.parent)
}
function parent(v: unknown) { const r = object(v, ['branchId', 'contextRevision', 'prefixManifestHash'], ['validityManifestHash']); id(r.branchId); integer(r.contextRevision); hash(r.prefixManifestHash); if (r.validityManifestHash !== undefined) hash(r.validityManifestHash) }
export function job(v: unknown): asserts v is Job {
  const r = object(v, ['id', 'kind', 'inputFence', 'attempts', 'maxAttempts', 'state', 'idempotencyKey'], ['errorCode', 'inputCopyId', 'summaryId']); id(r.id); choice(r.kind, ['extract', 'summarize', 'reindex']); fence(r.inputFence); integer(r.attempts); if (r.maxAttempts !== 3 || r.attempts > 3) invalid('job attempts'); choice(r.state, ['queued', 'running', 'prepared', 'committed', 'stale', 'deferred', 'failed', 'cancelled']); text(r.idempotencyKey, 256); if (r.errorCode !== undefined) text(r.errorCode, 64); if (r.inputCopyId !== undefined) id(r.inputCopyId); if (r.summaryId !== undefined) id(r.summaryId)
}
export function authorityChange(v: unknown): asserts v is AuthorityChange {
  const r = object(v, ['kind', 'recordId', 'record']); id(r.recordId)
  switch (r.kind) {
    case 'branch_parent': { const p = object(r.record, ['branchId', 'contextRevision', 'prefixManifestHash', 'sourceBindings']); parent({ branchId: p.branchId, contextRevision: p.contextRevision, prefixManifestHash: p.prefixManifestHash }); list(p.sourceBindings, binding); break }
    case 'canon_binding': { const p = object(r.record, ['worldId', 'publicationId', 'revision', 'bodySha256'], ['entityId']); id(p.worldId); id(p.publicationId); if (p.entityId !== undefined) id(p.entityId); integer(p.revision); hash(p.bodySha256); break }
    case 'visibility': visibility(r.record); break
    case 'deletion': { const p = object(r.record, ['id', 'generation', 'scope', 'sourceRevisionIds', 'blockedDerivedIds', 'purgeState', 'externalLimitations']); id(p.id); integer(p.generation, 1); scope(p.scope); ids(p.sourceRevisionIds); ids(p.blockedDerivedIds); choice(p.purgeState, ['blocked', 'purging', 'complete', 'limited']); list(p.externalLimitations, entry => text(entry, 1024), 128); break }
    case 'candidate_adoption': { const p = object(r.record, ['candidateId', 'sourceRevisionIds', 'eventIds', 'summaryIds', 'decision', 'controlSourceId']); id(p.candidateId); ids(p.sourceRevisionIds); ids(p.eventIds); ids(p.summaryIds); choice(p.decision, ['accepted', 'rejected']); id(p.controlSourceId); break }
    default: invalid('authority change kind')
  }
}
export function batch(v: unknown): asserts v is CommitBatch {
  const r = object(v, ['schemaVersion', 'idempotencyKey', 'expected', 'sourceBindings', 'events', 'summaries', 'jobs', 'invalidatedIds', 'authorityChanges', 'nextContextRevision'], ['expectedJobs'])
  version(r.schemaVersion); text(r.idempotencyKey, 256); fence(r.expected); list(r.sourceBindings, binding); list(r.events, event, 256); list(r.summaries, summary, 64); list(r.jobs, job, 256); ids(r.invalidatedIds); list(r.authorityChanges, authorityChange, 256); integer(r.nextContextRevision)
  if (r.expectedJobs !== undefined) list(r.expectedJobs, job, 256)
}
export function observation(v: unknown): asserts v is SourceObservation {
  const r = object(v, ['idempotencyKey', 'origin', 'turnId', 'role', 'publicText'], ['host']); text(r.idempotencyKey, 256); choice(r.origin, ['host_public', 'user_control']); id(r.turnId); choice(r.role, ['user', 'assistant', 'tool', 'user_control']); text(r.publicText, 1048576, true)
  if (r.origin === 'host_public') { locator(r.host); if (r.role === 'user_control') invalid('public role') }
  else if (r.host !== undefined || r.role !== 'user_control') invalid('control provenance')
}
/** Before serialization: bounded recursive inspection rejects lossy values and accessors. */
export const MAX_RP_JSON_BYTES = 4_194_304
export const MAX_RP_PUBLISH_BYTES = 3_145_728
export function cloneInput<T>(input: T, maxBytes = MAX_RP_JSON_BYTES, capacityError = false, maxArrayLength = 4096): T {
  const visit = (v: unknown, depth: number): void => {
    if (depth > 24) invalid('record depth')
    if (v === null || typeof v === 'boolean') return
    if (typeof v === 'string') { if (v.length > 1048576 || !wellFormed(v)) invalid('record string'); return }
    if (typeof v === 'number') { if (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v))) invalid('number'); return }
    if (!v || typeof v !== 'object') invalid('JSON value')
    if (Array.isArray(v)) { if (v.length > maxArrayLength) invalid('array size'); v.forEach(entry => visit(entry, depth + 1)); return }
    if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) invalid('prototype')
    for (const key of Object.keys(v)) { const d = Object.getOwnPropertyDescriptor(v, key)!; if (!('value' in d)) invalid('accessor'); visit(d.value, depth + 1) }
  }
  visit(input, 0)
  const encoded = JSON.stringify(input); if (Buffer.byteLength(encoded, 'utf8') > maxBytes) { if (capacityError) throw new RpError('capacity_exceeded', 'RP complete envelope byte limit'); invalid('record size') }
  return JSON.parse(encoded) as T
}
/** Inspect the entire envelope, then write exactly these preflighted bytes. */
export function checkedRpJson(input: unknown, encode: (value: unknown) => string, maxBytes = MAX_RP_JSON_BYTES, maxArrayLength = 4096): string {
  const encoded = encode(cloneInput(input, maxBytes, true, maxArrayLength))
  if (Buffer.byteLength(encoded, 'utf8') > maxBytes) throw new RpError('capacity_exceeded', 'RP complete envelope byte limit')
  return encoded
}
export function parseRecord(input: unknown): Result<RpRecord> {
  try {
    if (typeof input === 'string' && Buffer.byteLength(input, 'utf8') > 4194304) invalid('JSON size')
    const r = object(cloneInput(typeof input === 'string' ? JSON.parse(input) : input), ['kind', 'record'])
    const validators: Record<string, (v: unknown) => void> = { source, branch, event, summary, job, batch }
    if (!Object.hasOwn(validators, r.kind)) invalid('record kind')
    validators[r.kind](r.record)
    return { ok: true, value: r as RpRecord }
  } catch (error) { return failure(error) }
}
export function failure(error: unknown): { ok: false; code: import('./types.js').ErrorCode; message: string } {
  return { ok: false, code: error instanceof RpError ? error.code : 'invalid_record', message: error instanceof Error ? error.message : 'Invalid RP input' }
}
