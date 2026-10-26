import type {RpStore} from '../store.js'
import type {HostAuthority} from '../types.js'
import type {RetrievalEvidence} from '../retrieval-evidence.js'
import {RpError} from '../schema.js'
import {unwrap} from '../retrieval.js'
import {diaryHash,diaryHead,diaryPolicyCandidate} from './format.js'
import {currentDiaryEvents} from './selection.js'
import type {AudienceIdentity} from '../person/documents/audience.js'
export interface DiaryReceiptContext {personId:string;boardId:string;policyEventId:string}
export type DiaryEvidenceProof=RetrievalEvidence&{diary:DiaryReceiptContext}
const proofs=new WeakMap<object,{authority:HostAuthority;proof:DiaryEvidenceProof}>()
export function bindDiaryEvidence<T extends object>(result:T,authority:HostAuthority,proof:Omit<DiaryEvidenceProof,'resultSha256'>):T {
  proofs.set(result,{authority,proof:structuredClone({...proof,resultSha256:diaryHash(result)})});return result
}
export function diaryEvidence(result:object,authority:HostAuthority):DiaryEvidenceProof {
  const p=proofs.get(result);if(!p||p.authority!==authority||p.proof.resultSha256!==diaryHash(result))throw new RpError('scope_denied','Uncertified diary result')
  return structuredClone(p.proof)
}
export async function verifyDiaryEvidence(store:RpStore,authority:HostAuthority,proof:DiaryEvidenceProof,personId:string|undefined,audience?:AudienceIdentity){
  if(!personId||proof.diary.personId!==personId)throw new RpError('scope_denied','Diary receipt belongs to another person')
  return unwrap(await store.withReadView(authority,view=>{
    const a=proof.inputFence,b=view.fence
    if(a.branchId!==b.branchId||a.canonBindingsHash!==b.canonBindingsHash||a.visibilityRevision!==b.visibilityRevision||a.deletionGeneration!==b.deletionGeneration||a.policyVersion!==b.policyVersion||diaryHead(view.ledger!.authorityChanges,diaryPolicyCandidate(personId,proof.diary.boardId))!==proof.diary.policyEventId)throw new RpError('stale_input','Diary receipt authorization changed')
    const records=new Map(currentDiaryEvents(view,personId,audience).filter(e=>e.payload.kind==='diary_entry'&&e.payload.value.boardId===proof.diary.boardId).map(e=>[e.id,diaryHash(e)]))
    if(proof.records.some(r=>r.kind!=='event'||records.get(r.id)!==r.revision))throw new RpError('stale_input','Diary result was revised or deleted; use clean continuation')
    return b
  },{audit:true}))
}
