import { randomUUID, createHash } from 'node:crypto'
import type { RpStore } from './store.js'
import type { HostAuthority, InputFence, Result, SourceRevision } from './types.js'
import { failure, denied, integer, object, RpError, text } from './schema.js'
import { readConsistentRecords, type RetrievalRecord } from './retrieval-index.js'
import { bindRetrievalEvidence } from './retrieval-evidence.js'
import { hitExcerpt, lexicalScore, queryGroups } from './lexical.js'
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
export const fullSpan = (s: SourceRevision) => ({ sourceRevisionId: s.id, publicTextSha256: s.publicTextSha256, startUtf16: 0, endUtf16: s.publicTextLengthUtf16, quoteSha256: s.publicTextSha256 })
export function unwrap<T>(r: Result<T>): T { if (!r.ok) throw new RpError(r.code, r.message); return r.value }
export interface RetrievalSizing {fits?:(result:any)=>boolean}
interface Fixed { authority: HostAuthority; fence: InputFence; ids: readonly { id: string; revision: string }[]; snapshotId: string; queryHash: string; query?: string }
export function createRetrieval(store: RpStore, options: { inputSourceIds?: (authority: HostAuthority) => ReadonlySet<string>; entityIds?: readonly string[]; verification?: (recordId: string) => Promise<'source-match' | 'unavailable' | 'hash-mismatch'> } = {}) {
  const searches = new Map<string, { fixed: Fixed; offset: number }>(), bodies = new Map<string, { fixed: Fixed; source: Pick<RetrievalRecord, 'id' | 'revision'>; offset: number }>()
  const records = (authority: HostAuthority) => readConsistentRecords(store, authority, options.inputSourceIds?.(authority) ?? new Set())
  const token = () => 'cursor_' + randomUUID().replaceAll('-', '')
  const validate = async (authority: HostAuthority, fixed: Fixed) => {
    if (fixed.authority !== authority) denied('cross-authority cursor')
    const { fence, records: current } = await records(authority)
    if (fence.branchId !== fixed.fence.branchId || fence.canonBindingsHash !== fixed.fence.canonBindingsHash || fence.visibilityRevision !== fixed.fence.visibilityRevision || fence.deletionGeneration !== fixed.fence.deletionGeneration || fence.policyVersion !== fixed.fence.policyVersion) throw new RpError('snapshot_changed', 'RP cursor authorization changed')
    const map = new Map(current.map(s => [s.id, s]))
    if (fixed.ids.some(s => map.get(s.id)?.revision !== s.revision)) throw new RpError('snapshot_changed', 'RP fixed result was revoked, deleted or revised')
    return { map, fence }
  }
  const bounded = (n: unknown, fallback: number, max: number) => { const value = n ?? fallback; integer(value, 1); if (value > max) throw new RpError('invalid_record', 'RP page limit'); return value }
  return Object.freeze({
    async search(authority: HostAuthority, input: { query?: string; cursor?: string; limit?: number; entityId?: string; kind?: string }, sizing:RetrievalSizing={}) {
      try {
        object(input, [], ['query', 'cursor', 'limit', 'entityId', 'kind']); const limit = bounded(input.limit, 7, 100)
        let fixed: Fixed, offset = 0
        if (input.cursor !== undefined) {
          const saved = searches.get(input.cursor); if (!saved) denied('unknown search cursor'); fixed = saved!.fixed; offset = saved!.offset
        } else {
          text(input.query ?? '', 4096, true)
          const terms = queryGroups(input.query ?? ''), { fence, records: sources } = await records(authority)
          const hits: { id: string; revision: string; score: number }[] = []
          for (const source of sources) {
            if (input.entityId && (!(options.entityIds ?? []).includes(input.entityId) || !source.entities.includes(input.entityId))) continue
            if (input.kind && source.kind !== input.kind) continue
            const score = lexicalScore(source.body, terms)
            if (score !== null) hits.push({ id: source.id, revision: source.revision, score })
          }
          hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, 'en'))
          fixed = { authority, fence, ids: hits.map(({ id, revision }) => ({ id, revision })), snapshotId: token(), queryHash: sha(input.query ?? ''), query: input.query ?? '' }
        }
        const { map, fence } = await validate(authority, fixed), items: {id:string;revision:string;kind:RetrievalRecord['kind'];excerpt:string}[] = []
        for (const hit of fixed.ids.slice(offset, offset + limit)) { const source = map.get(hit.id)!; items.push({ id: source.id, revision: source.revision, kind: source.kind, excerpt: hitExcerpt(source.body, fixed.query ?? '') }) }
        const candidateCursor=token()
        const result=()=>({ok:true as const,value:{snapshotId:fixed.snapshotId,queryHash:fixed.queryHash,resultManifestHash:sha(JSON.stringify(fixed.ids)),sortVersion:'rp-terms/v2',items:[...items],nextCursor:offset+items.length<fixed.ids.length?candidateCursor:null}})
        while(sizing.fits&&!sizing.fits(result())){if(items.length<=1)throw new RpError('context_budget_exceeded','No complete search item fits the remaining memory budget');items.pop()}
        const selected=result()
        if(selected.value.nextCursor)searches.set(candidateCursor,{fixed,offset:offset+items.length})
        return bindRetrievalEvidence(selected,authority,fence,items.map(({id,revision,kind})=>({id,revision,kind})))
      } catch (e) { return failure(e) }
    },
    async get(authority: HostAuthority, input: { id?: string; cursor?: string; maxChars?: number }, sizing:RetrievalSizing={}) {
      try {
        object(input, [], ['id', 'cursor', 'maxChars']); const maxChars = bounded(input.maxChars, 4096, 65536)
        let fixed: Fixed, source: Pick<RetrievalRecord, 'id' | 'revision'>, offset = 0
        if (input.cursor !== undefined) { const saved = bodies.get(input.cursor); if (!saved) denied('unknown body cursor'); ({ fixed, source, offset } = saved!) }
        else {
          const { fence, records: sources } = await records(authority), found = sources.find(s => s.id === input.id)
          if (!found) denied('source is unavailable in this view'); source = found!
          fixed = { authority, fence, ids: [{ id: source.id, revision: source.revision }], snapshotId: token(), queryHash: sha(source.id) }
        }
        const { map: current } = await validate(authority, fixed)
        const body = current.get(source.id)!.body
        let end = Math.min(offset + maxChars, body.length)
        if (end < body.length && /[\uD800-\uDBFF]/u.test(body[end - 1]) && /[\uDC00-\uDFFF]/u.test(body[end])) end--
        if (end === offset && offset < body.length) end += 2
        const verification = await options.verification?.(source.id) ?? 'source-match'
        if (!['source-match', 'unavailable', 'hash-mismatch'].includes(verification)) throw new RpError('invalid_record', 'Trusted verification state invalid')
        const verified = await validate(authority, fixed),candidateCursor=token()
        const result=()=>({ok:true as const,value:{recordId:source.id,revision:source.revision,snapshotId:fixed.snapshotId,bodySha256:sha(body),text:body.slice(offset,end),nextCursor:end<body.length?candidateCursor:null,currentStatus:{verification,revoked:false}}})
        while(sizing.fits&&!sizing.fits(result())){
          const length=end-offset;if(length===1||(length===2&&/[\uD800-\uDBFF]/u.test(body[offset])))throw new RpError('context_budget_exceeded','No complete code point fits the remaining memory budget')
          end=offset+Math.floor(length/2)
          if(end<body.length&&/[\uD800-\uDBFF]/u.test(body[end-1])&&/[\uDC00-\uDFFF]/u.test(body[end]))end--
          if(end===offset)end+=2
        }
        const selected=result()
        if(selected.value.nextCursor)bodies.set(candidateCursor,{fixed,source:{id:source.id,revision:source.revision},offset:end})
        return bindRetrievalEvidence(selected,authority,verified.fence,[{id:source.id,revision:source.revision,kind:verified.map.get(source.id)!.kind}])
      } catch (e) { return failure(e) }
    },
    dispose() { searches.clear(); bodies.clear() },
  })
}
