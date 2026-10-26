/** Pure data validation shared by the server and offline editor. No storage or authority imports. */
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
