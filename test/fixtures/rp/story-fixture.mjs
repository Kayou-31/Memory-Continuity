export const visibility = { policyId: 'policy_public', revision: 0, audienceSetId: 'audience_public' }
export const ids = { campaign: 'campaign_story', session: 'session_story', scene: 'scene_room', turn: 'turn_one', message: 'message_reply' }
export function observation(text = 'PUBLIC_KEY_RED', revision = 'revision_a', key = revision) {
  return { idempotencyKey: key, origin: 'host_public', role: 'assistant', publicText: text, turnId: ids.turn,
    host: { sessionId: ids.session, eventSeq: 1, messageId: ids.message, messageRevision: revision } }
}
export function batch(fence, source, key = 'accept_a', overrides = {}) {
  return { schemaVersion: 1, idempotencyKey: key, expected: fence,
    sourceBindings: [{ sourceRevisionId: source.id, branchId: fence.branchId, turnId: source.turnId,
      disposition: 'accepted', acceptedSeq: 1 }], events: [], summaries: [], jobs: [], invalidatedIds: [], authorityChanges: [],
    nextContextRevision: fence.contextRevision + 1, ...overrides }
}
