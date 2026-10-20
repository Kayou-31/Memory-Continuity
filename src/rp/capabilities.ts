/** RP application capability gates. These names are not DSH native APIs.
 * A structurally valid report is evidence metadata, not an authorization from
 * a model or an arbitrary caller. Production must use its own pinned probe.
 */
export const capabilityKeys = ['canonicalReplySelection', 'messageRevisions', 'forkLineage', 'requestInjection', 'requestContextFiltering',
  'durableSurfaceReplacement', 'lifecycleRecovery', 'tokenAccounting', 'exclusiveCompactionOwnership', 'modelInvocation', 'uiIntegration'] as const
export type CapabilityKey = typeof capabilityKeys[number]
export type CapabilityStatus = 'verified' | 'unsupported' | 'failed' | 'unverified'
export type ProductMode = 'capture' | 'memory' | 'compaction'
export interface CapabilityResult {
  readonly status: CapabilityStatus
  readonly probe: string | null
  readonly evidence: readonly string[]
  readonly contract: string | null
}
export interface CapabilityReport {
  readonly schemaVersion: 1
  readonly baselineCommit: string
  readonly host: { readonly packageVersions: Readonly<Record<string, string>>; readonly sessionHeaderVersion: number | null }
  readonly evidenceRoot: string | null
  readonly capabilities: Readonly<Record<CapabilityKey, CapabilityResult>>
  readonly allowedModes: readonly ProductMode[]
  readonly limitations: readonly string[]
}
export class CapabilityReportError extends TypeError {
  readonly code = 'invalid_capability_report'
}
export class CapabilityMissingError extends Error {
  readonly code = 'capability_missing'
  constructor(readonly missing: readonly (CapabilityKey | RpReadinessKey)[]) { super('RP capability_missing: ' + missing.join(', ')) }
}
const requirements: Record<ProductMode, readonly CapabilityKey[]> = {
  capture: [],
  // Manual canonical revisions and RP-owned branches can supply application
  // readiness even when the host has no edit/alternative-selection API.
  memory: ['requestInjection'],
  compaction: ['requestInjection', 'durableSurfaceReplacement', 'lifecycleRecovery', 'exclusiveCompactionOwnership'],
}
export type RpReadinessKey = 'sourceObservation' | 'effectiveHistory' | 'revisionFence' | 'branchIsolation'
export type RpReadinessProof = Readonly<Partial<Record<RpReadinessKey, string>>>
declare const readinessBrand: unique symbol
export interface RpReadiness { readonly [readinessBrand]: true }
const readinessVerifiers = new WeakMap<object, () => RpReadinessProof>()
/** Internal adapter seam: trusted store/adapter code binds a live verifier.
 * The verifier must read its own current validated state on EVERY admission.
 * Do not expose this function to tools/model inputs or bind parsed JSON.
 * The non-serializable handle cannot be minted by a model-supplied boolean.
 */
export function bindRpReadiness(verify: () => RpReadinessProof): RpReadiness {
  if (typeof verify !== 'function') throw new TypeError('RP readiness requires a trusted live verifier')
  const handle = Object.freeze({})
  readinessVerifiers.set(handle, verify)
  return handle as RpReadiness
}
function bad(field: string): never { throw new CapabilityReportError('Invalid capability report: ' + field) }
function object(value: unknown, fields: readonly string[], field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return bad(field)
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== fields.length || Object.keys(record).some(key => !fields.includes(key))) return bad(field + ' fields')
  return record
}
function text(value: unknown, field: string, max = 8192): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) bad(field)
}
function strings(value: unknown, field: string, max = 128): asserts value is string[] {
  if (!Array.isArray(value) || value.length > max) bad(field)
  value.forEach((entry: unknown) => text(entry, field))
  if (new Set(value).size !== value.length) bad(field + ' duplicates')
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
export function deriveAllowedModes(capabilities: Readonly<Record<CapabilityKey, CapabilityResult>>): ProductMode[] {
  // Report metadata describes potential native prerequisites, never an active
  // product mode. Source observation is evidenced by injection/fork traces.
  return (['capture', 'memory', 'compaction'] as const).filter(mode => mode === 'capture'
    ? capabilities.requestInjection.status === 'verified' || capabilities.forkLineage.status === 'verified'
    : requirements[mode].every(key => capabilities[key].status === 'verified'))
}
/** Bounded strict schema parse; derived grants must match supplied metadata. */
export function parseCapabilityReport(input: unknown): CapabilityReport {
  let encoded: string | undefined
  try { encoded = typeof input === 'string' ? input : JSON.stringify(input) } catch { return bad('JSON') }
  if (!encoded || encoded.length > 262144) return bad('JSON size')
  let parsed: unknown
  try { parsed = JSON.parse(encoded) } catch { return bad('JSON') }
  const v = object(parsed, ['schemaVersion', 'baselineCommit', 'host', 'evidenceRoot', 'capabilities', 'allowedModes', 'limitations'], 'report')
  if (v.schemaVersion !== 1) bad('schemaVersion')
  if (typeof v.baselineCommit !== 'string' || !/^[a-f0-9]{40}$/u.test(v.baselineCommit)) bad('baselineCommit')
  const host = object(v.host, ['packageVersions', 'sessionHeaderVersion'], 'host')
  if (host.sessionHeaderVersion !== null && (!Number.isSafeInteger(host.sessionHeaderVersion) || (host.sessionHeaderVersion as number) < 1)) bad('sessionHeaderVersion')
  const versions = host.packageVersions
  if (versions === null || typeof versions !== 'object' || Array.isArray(versions) || Object.keys(versions).length > 128) bad('packageVersions')
  for (const [name, version] of Object.entries(versions as object)) {
    if (!/^(?:@[a-z0-9-]+\/)?[a-z0-9-]+$/u.test(name) || typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) bad('packageVersions exact version')
  }
  if (v.evidenceRoot !== null) text(v.evidenceRoot, 'evidenceRoot', 4096)
  const capabilities = object(v.capabilities, capabilityKeys, 'capabilities')
  for (const key of capabilityKeys) {
    const result = object(capabilities[key], ['status', 'probe', 'evidence', 'contract'], key)
    if (!['verified', 'unsupported', 'failed', 'unverified'].includes(String(result.status))) bad(key + '.status')
    strings(result.evidence, key + '.evidence')
    for (const file of result.evidence) if (!/^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/u.test(file) || file.split('/').some(part => part === '..' || part === '.' || !part)) bad(key + '.evidence path')
    if (result.probe !== null) text(result.probe, key + '.probe')
    if (result.contract !== null) text(result.contract, key + '.contract')
    if (result.status !== 'unverified' && (!result.evidence.length || result.probe === null || result.contract === null || v.evidenceRoot === null || !Object.keys(versions as object).length || host.sessionHeaderVersion === null)) bad(key + ' evidence/environment')
  }
  strings(v.allowedModes, 'allowedModes', 3)
  const expected = deriveAllowedModes(capabilities as unknown as CapabilityReport['capabilities'])
  if (JSON.stringify(expected) !== JSON.stringify(v.allowedModes)) bad('allowedModes derived grants')
  strings(v.limitations, 'limitations')
  return freeze(parsed as CapabilityReport)
}
export interface RpCapabilityRequest {
  readonly mode: ProductMode
  readonly strictPov?: boolean
  readonly automaticCanonical?: boolean
  readonly modelExtraction?: boolean
}
/** Fail before dispatch. No caller-supplied report can override missing gates. */
export function assertRpCapabilities(input: CapabilityReport, request: RpCapabilityRequest, readiness?: RpReadiness): void {
  const report = parseCapabilityReport(input)
  if (!Object.hasOwn(requirements, request.mode)) throw new TypeError('Invalid RP mode')
  for (const key of ['strictPov', 'automaticCanonical', 'modelExtraction'] as const) if (request[key] !== undefined && typeof request[key] !== 'boolean') throw new TypeError('Invalid RP option: ' + key)
  const needed = [...requirements[request.mode], ...(request.strictPov ? ['requestContextFiltering' as const] : []),
    ...(request.automaticCanonical ? ['canonicalReplySelection' as const] : []), ...(request.modelExtraction ? ['modelInvocation' as const] : [])]
  const missing: (CapabilityKey | RpReadinessKey)[] = needed.filter(key => report.capabilities[key].status !== 'verified')
  const verify = readiness && readinessVerifiers.get(readiness)
  const proof = verify ? verify() : {}
  const appKeys: RpReadinessKey[] = request.mode === 'capture' ? ['sourceObservation'] : ['sourceObservation', 'effectiveHistory', 'revisionFence', 'branchIsolation']
  for (const key of appKeys) if (typeof proof?.[key] !== 'string' || !proof[key]?.trim() || proof[key]!.length > 4096) missing.push(key)
  if (missing.length) throw new CapabilityMissingError([...new Set(missing)])
}
/** Capability discovery only; this does not select or replace a surface range. */
export function inspectRpCompressionBoundary(report: CapabilityReport, boundary: { unreadableMultimodal: boolean; toolPairsComplete: boolean }, readiness?: RpReadiness): { eligible: boolean; reasons: string[] } {
  if (typeof boundary.unreadableMultimodal !== 'boolean' || typeof boundary.toolPairsComplete !== 'boolean') throw new TypeError('Invalid RP boundary')
  const reasons: string[] = []
  try { assertRpCapabilities(report, { mode: 'compaction' }, readiness) } catch (error) {
    if (!(error instanceof CapabilityMissingError)) throw error
    reasons.push('capability_missing')
  }
  if (boundary.unreadableMultimodal) reasons.push('multimodal_barrier')
  if (!boundary.toolPairsComplete) reasons.push('tool_pair_incomplete')
  return { eligible: reasons.length === 0, reasons }
}
