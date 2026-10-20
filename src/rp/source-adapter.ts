/** Explicit source observation only. This adapter subscribes to no host event
 * and never treats a completed generation as accepted/canonical. Its public
 * text projection follows evidence.ts / memory-host.publicEvidence's primitive
 * (text blocks joined by LF), without initializing engineering MemoryRun. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { RpStore } from './store.js'
import type { HostAuthority, HostSourceLocator, Result, SourceRevision } from './types.js'
import { cloneInput, failure, id, integer, object, RpError, text } from './schema.js'

export interface PublicHostObservation {
  readonly idempotencyKey: string; readonly host: HostSourceLocator; readonly turnId: string; readonly event: SessionEvent
}
export async function observePublicHostSource(store: RpStore, authority: HostAuthority, input: PublicHostObservation): Promise<Result<SourceRevision>> {
  try {
    // Validate authorization before interpreting untrusted event contents.
    const admission = await store.readFence(authority)
    if (!admission.ok) return admission
    const r = object(input, ['idempotencyKey', 'host', 'turnId', 'event'])
    text(r.idempotencyKey, 256); id(r.turnId)
    const locator = cloneInput(r.host), event = r.event
    integer(event.seq)
    if (event.seq !== locator.eventSeq) throw new RpError('source_unavailable', 'RP host source locator does not match event sequence')
    const role = event.type === 'user/message' ? 'user' : event.type === 'assistant/message' ? 'assistant' : event.type === 'tool/result' ? 'tool' : undefined
    if (!role) throw new RpError('source_unavailable', 'RP event has no supported public message body')
    const data = event.data as unknown as Record<string, any>, message = event.type === 'user/message' ? data : data?.message
    const blocks = message?.content
    if (!Array.isArray(blocks) || blocks.length > 2048) throw new RpError('source_unavailable', 'RP public source content unavailable')
    const publicBlocks: string[] = []
    for (const block of blocks) {
      if (block?.type === 'thinking' || block?.type === 'reasoning') continue
      if (block?.type !== 'text') throw new RpError('capability_missing', 'RP rich source observation requires a verified lossless adapter')
      text(block.text, 1048576, true); publicBlocks.push(block.text)
    }
    return await store.observeSource(authority, { idempotencyKey: r.idempotencyKey, host: locator, turnId: r.turnId,
      origin: 'host_public', role, publicText: publicBlocks.join('\n') })
  } catch (cause) { return failure(cause) }
}
