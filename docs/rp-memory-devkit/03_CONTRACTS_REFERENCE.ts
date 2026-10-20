/**
 * RP Memory 设计契约 v1.0，2026-10-20。
 * 这是应用层接口提案，不是 DSH SDK 声明，不含实现。
 * Codex 在 P0 读取实际 SDK 后映射宿主接口，在 P1 加入运行时校验器。
 * TypeScript 类型及 readonly 不构成运行时授权或持久化保证。
 * schemaVersion=1；所有 ID/哈希必须经运行时校验且由可信组件生成。
 */

export type Id = string;
export type Sha256 = string; // 64 个小写十六进制字符，完整摘要
export type Revision = number; // 安全整数，单调递增
export type JsonValue =
  | null | boolean | number | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type CapabilityStatus =
  | "verified" | "unsupported" | "failed" | "unverified";
export type CapabilityKey =
  | "canonicalReplySelection" | "messageRevisions" | "forkLineage"
  | "requestInjection" | "requestContextFiltering"
  | "durableSurfaceReplacement" | "lifecycleRecovery"
  | "tokenAccounting" | "exclusiveCompactionOwnership"
  | "modelInvocation" | "uiIntegration";
export type ProductMode = "capture" | "memory" | "compaction";

export interface CapabilityResult {
  readonly status: CapabilityStatus;
  readonly probe: string | null;
  readonly evidence: readonly string[];
  readonly contract: string | null;
}

export interface CapabilityReport {
  readonly schemaVersion: 1;
  readonly baselineCommit: string;
  readonly host: {
    readonly packageVersions: Readonly<Record<string, string>>;
    readonly sessionHeaderVersion: number | null;
  };
  readonly evidenceRoot: string | null;
  readonly capabilities: Readonly<Record<CapabilityKey, CapabilityResult>>;
  readonly allowedModes: readonly ProductMode[];
  readonly limitations: readonly string[];
}

export type Scope =
  | { readonly kind: "profile"; readonly profileId: Id }
  | { readonly kind: "world"; readonly profileId: Id; readonly worldId: Id;
      readonly entityId?: Id }
  | { readonly kind: "branch"; readonly workspaceId: Id;
      readonly campaignId: Id; readonly branchId: Id }
  | { readonly kind: "session"; readonly workspaceId: Id;
      readonly campaignId: Id; readonly branchId: Id;
      readonly sessionId: Id; readonly sceneId: Id };

export type Viewpoint =
  | { readonly kind: "narrator" }
  | { readonly kind: "character"; readonly entityId: Id };

/** audience 的 audience-set 运算由宿主维护，ID 不是模型提供的 ACL。 */
export interface Visibility {
  readonly policyId: Id;
  readonly revision: Revision;
  readonly audienceSetId: Id;
}

export interface WorkspaceBinding {
  readonly workspaceId: Id;
  readonly profileId: Id;
  readonly canonicalRootHash: Sha256;
  readonly migrationRevision: Revision;
}

export interface HostSourceLocator {
  readonly sessionId: Id;
  readonly eventSeq: number;
  readonly messageId: Id;
  readonly messageRevision: Id;
}

export interface SourceRevision {
  readonly schemaVersion: 1;
  readonly id: Id;
  readonly scope: Scope;
  readonly origin: "host_public" | "user_control" | "approved_publication";
  readonly host?: HostSourceLocator;
  readonly turnId?: Id;
  readonly role: "user" | "assistant" | "tool" | "user_control";
  readonly publicTextSha256: Sha256;
  readonly publicTextLengthUtf16: number;
  readonly blobId: Id; // 内部 locator；不得由模型传入文件路径
  readonly visibility: Visibility;
  readonly capturedAt: string;
}

export interface SourceSpan {
  readonly sourceRevisionId: Id;
  readonly publicTextSha256: Sha256;
  readonly startUtf16: number;
  readonly endUtf16: number; // 半开区间，不拆 Unicode surrogate pair
  readonly quoteSha256: Sha256;
}

/** acceptance 是分支绑定；共享 SourceRevision 不原地改变状态。 */
export interface BranchSourceBinding {
  readonly sourceRevisionId: Id;
  readonly branchId: Id;
  readonly turnId: Id;
  readonly disposition: "candidate" | "accepted" | "superseded" | "retracted"
    | "discarded" | "pending_replay";
  readonly acceptedSeq: number | null;
  readonly supersedes?: Id;
}

export interface Branch {
  readonly schemaVersion: 1;
  readonly id: Id;
  readonly workspaceId: Id;
  readonly campaignId: Id;
  readonly contextRevision: Revision;
  readonly parent: null | {
    readonly branchId: Id;
    readonly contextRevision: Revision;
    readonly prefixManifestHash: Sha256;
  };
  readonly activeSourceManifestHash: Sha256;
  readonly canonBindingsHash: Sha256;
}

/** 用于正在运行的任务 / packet / 发送边界的乐观并发 fence。 */
export interface InputFence {
  readonly branchId: Id;
  readonly contextRevision: Revision;
  readonly sourceManifestHash: Sha256;
  readonly canonBindingsHash: Sha256;
  readonly visibilityRevision: Revision;
  readonly deletionGeneration: Revision;
  readonly policyVersion: string;
}

export interface Entity {
  readonly id: Id;
  readonly scope: Scope;
  readonly kind: "character" | "place" | "item" | "group";
  readonly displayName: string;
  readonly aliases: readonly string[];
}

export type EpistemicClass = "world" | "belief" | "utterance" | "uncertain";
export type TruthValue = "true" | "false" | "unknown";
export type AuthorityClass =
  | "user_canon" | "explicit_ooc" | "accepted_narration"
  | "character_statement" | "inference";

/** key/value 的可用组合还须经按 entity kind 的运行时白名单校验。 */
export type EventPayload =
  | { readonly kind: "canon_assertion"; readonly subjectId: Id;
      readonly key: string; readonly value: JsonValue; readonly locked: boolean }
  | { readonly kind: "occurrence"; readonly actorIds: readonly Id[];
      readonly description: string }
  | { readonly kind: "state_change"; readonly subjectId: Id;
      readonly key: string; readonly before?: JsonValue; readonly after: JsonValue }
  | { readonly kind: "knowledge_change"; readonly knowerId: Id;
      readonly claimId: Id; readonly action: "learn" | "believe" | "doubt" | "forget" }
  | { readonly kind: "relationship_change"; readonly fromId: Id; readonly toId: Id;
      readonly relation: string; readonly value: JsonValue;
      readonly triggerEventIds: readonly Id[]; readonly unresolvedTension?: string }
  | { readonly kind: "correction"; readonly targetEventIds: readonly Id[];
      readonly replacementEventIds: readonly Id[]; readonly reason: string }
  | { readonly kind: "preference_change"; readonly key:
      "language" | "person" | "dialogue_format" | "prose_style";
      readonly value: string };

export interface SemanticEvent {
  readonly schemaVersion: 1;
  readonly id: Id;
  readonly scope: Scope;
  readonly acceptedSeq: number;
  readonly fictionalTime: string | null;
  readonly payload: EventPayload;
  readonly epistemic: EpistemicClass;
  readonly authority: AuthorityClass; // 宿主依据真实输入来源赋值
  readonly beliefHolderId?: Id;
  readonly sources: readonly SourceSpan[];
  readonly visibility: Visibility;
  readonly supersedes: readonly Id[];
  readonly policyVersion: string;
}

export interface StateProjection {
  readonly branchId: Id;
  readonly contextRevision: Revision;
  readonly subjectId: Id;
  readonly key: string;
  readonly value: JsonValue;
  readonly resolution: "known" | "unknown" | "conflict";
  readonly epistemic: EpistemicClass;
  readonly beliefHolderId?: Id;
  readonly supportEventIds: readonly Id[];
  readonly conflict: "none" | "unresolved";
  readonly visibility: Visibility;
}

/** 对具体命题的三值判断；无记录不等于 false，冲突不被静默消解。 */
export interface ClaimAssessment {
  readonly claimEventId: Id;
  readonly branchId: Id;
  readonly epistemic: EpistemicClass;
  readonly beliefHolderId?: Id;
  readonly truth: TruthValue;
  readonly supportEventIds: readonly Id[];
  readonly conflict: "none" | "unresolved";
}

/**
 * 已发布摘要不要求创建时的 branch head 永远等于当前 head。
 * 重用须检查全部来源仍在有效分支、canon/policy/visibility/删除状态仍适用。
 * 新消息只会使正在提交的旧任务 stale，不必作废不相关的已发布场景摘要。
 */
export interface Summary {
  readonly schemaVersion: 1;
  readonly id: Id;
  readonly scope: Scope;
  readonly level: "scene" | "chapter" | "arc";
  readonly createdFrom: InputFence;
  readonly sourceRevisionIds: readonly Id[];
  readonly dependencySummaryIds: readonly Id[];
  readonly supportEventIds: readonly Id[];
  readonly exactAnchors: readonly SourceSpan[];
  readonly text: string;
  readonly visibility: Visibility;
  readonly policyVersion: string;
  readonly measuredTokens: number;
  readonly tokenMeasurement: "exact" | "estimated";
}

export interface CanonBinding {
  readonly worldId: Id;
  readonly entityId?: Id;
  readonly publicationId: Id;
  readonly revision: Revision;
  readonly bodySha256: Sha256;
}

export interface GlobalPublication {
  readonly schemaVersion: 1;
  readonly id: Id;
  readonly scope: Extract<Scope, { kind: "profile" | "world" }>;
  readonly key: string;
  readonly revision: Revision;
  readonly body: string;
  readonly bodySha256: Sha256;
  readonly approvedSourceId: Id;
  readonly visibility: Visibility;
  readonly supersedes: Id | null;
  readonly status: "active" | "revoked";
}

export interface DeletionMarker {
  readonly id: Id;
  readonly generation: Revision;
  readonly scope: Scope;
  readonly sourceRevisionIds: readonly Id[];
  readonly blockedDerivedIds: readonly Id[];
  readonly purgeState: "blocked" | "purging" | "complete" | "limited";
  readonly externalLimitations: readonly string[];
}

/** 仅候选载荷。无 trusted/approved/authority/ACL 字段可由模型注入。 */
export interface MemoryCandidate {
  readonly schemaVersion: 1;
  readonly id: Id; // 接收器生成，模型不得决定冲突/覆盖键
  readonly inputFence: InputFence;
  readonly proposedEvents: readonly {
    readonly payload: EventPayload;
    readonly epistemic: EpistemicClass;
    readonly sources: readonly SourceSpan[];
  }[];
  readonly proposedSummary?: {
    readonly level: Summary["level"];
    readonly text: string;
    readonly sourceRevisionIds: readonly Id[];
    readonly exactAnchors: readonly SourceSpan[];
  };
}

export interface Job {
  readonly id: Id;
  readonly kind: "extract" | "summarize" | "reindex";
  readonly inputFence: InputFence;
  readonly attempts: number;
  readonly maxAttempts: 3;
  readonly state: "queued" | "running" | "prepared" | "committed"
    | "stale" | "deferred" | "failed" | "cancelled";
  readonly idempotencyKey: string;
  readonly errorCode?: ErrorCode;
}

export type ErrorCode =
  | "capability_missing" | "scope_denied" | "stale_input"
  | "invalid_candidate" | "conflict_unresolved" | "source_unavailable"
  | "snapshot_changed" | "context_budget_exceeded" | "ownership_lost"
  | "lifecycle_open" | "persistence_uncertain" | "store_locked";

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

/** 实际授权对象必须由宿主 mint 并在每个越界操作运行时验证。 */
declare const hostAuthorityBrand: unique symbol;
export interface HostAuthority {
  readonly [hostAuthorityBrand]: true;
  readonly scope: Scope;
  readonly viewpoint: Viewpoint;
  readonly visibility: Visibility;
}

export interface CanonicalChange {
  readonly idempotencyKey: string;
  readonly kind: "accept" | "replace" | "retract" | "fork" | "retcon";
  readonly sessionId: Id;
  readonly branchId: Id;
  readonly expected: InputFence;
  readonly sourceChanges: readonly BranchSourceBinding[];
  readonly forkFrom?: Branch["parent"];
  readonly userControlSourceId?: Id;
}

export interface CommitBatch {
  readonly schemaVersion: 1;
  readonly idempotencyKey: string;
  readonly expected: InputFence;
  readonly sourceBindings: readonly BranchSourceBinding[];
  readonly events: readonly SemanticEvent[];
  readonly summaries: readonly Summary[];
  readonly invalidatedIds: readonly Id[];
  readonly authorityChanges: readonly {
    readonly kind: "branch_parent" | "canon_binding"
      | "visibility" | "deletion" | "candidate_adoption";
    readonly recordId: Id;
    readonly record: JsonValue; // 实现必须按 kind 解析为具体运行时 schema
  }[];
  readonly nextContextRevision: Revision;
}

/** RpStore / CommitBatch 仅负责分支事务，不要求全局管理存在虚构 branchId。 */
export interface RpStore {
  readBranch(authority: HostAuthority): Promise<Result<Branch>>;
  commit(authority: HostAuthority, batch: CommitBatch): Promise<Result<InputFence>>;
  // 所有读取仍需做活动分支/删除/权限检查；禁止调用方绕过索引直接读 blob。
  readSource(authority: HostAuthority, span: SourceSpan): Promise<Result<string>>;
  replayProjection(authority: HostAuthority): Promise<Result<readonly StateProjection[]>>;
}

export interface GlobalFence {
  readonly scope: Extract<Scope, { kind: "profile" | "world" }>;
  readonly scopeRevision: Revision;
  readonly visibilityRevision: Revision;
  readonly deletionGeneration: Revision;
}

export interface GlobalCommitBatch {
  readonly schemaVersion: 1;
  readonly idempotencyKey: string;
  readonly operationId: Id; // 跨范围发布/删除协调记录身份
  readonly expected: GlobalFence;
  readonly approvedSources: readonly SourceRevision[];
  readonly publications: readonly GlobalPublication[];
  readonly revokedPublicationIds: readonly Id[];
  readonly deletionMarkers: readonly DeletionMarker[];
  readonly nextScopeRevision: Revision;
}

export interface RpGlobalStore {
  readFence(authority: HostAuthority): Promise<Result<GlobalFence>>;
  commit(
    authority: HostAuthority, batch: GlobalCommitBatch
  ): Promise<Result<GlobalFence>>;
}

// Global revision 更新独立于剧情 head；分支显式采用新 canon 才提交 canon_binding。
// 跨存储删除先持久化可检查的阻断标记，再逐范围提交/清理，按 operationId 恢复。

export interface RecordPage {
  readonly recordId: Id;
  readonly revision: Revision;
  readonly snapshotId: Id;
  readonly bodySha256: Sha256;
  readonly text: string;
  readonly nextCursor: string | null; // 绑定授权上下文的 opaque cursor
  readonly currentStatus: {
    readonly verification: "source-match" | "unavailable" | "hash-mismatch";
    readonly revoked: boolean;
  }; // 动态状态不在分页正文内
}

export interface SearchPage {
  readonly snapshotId: Id;
  readonly queryHash: Sha256;
  readonly resultManifestHash: Sha256;
  readonly sortVersion: string;
  readonly items: readonly {
    readonly id: Id; readonly revision: Revision; readonly excerpt: string;
  }[];
  readonly nextCursor: string | null;
}

export interface MemoryPacket {
  readonly id: Id;
  readonly inputFence: InputFence;
  readonly viewpoint: Viewpoint;
  readonly sections: readonly {
    readonly kind: "canon" | "scene" | "state" | "open_threads"
      | "relationships" | "history" | "anchors";
    readonly text: string;
    readonly sourceIds: readonly Id[];
    readonly tokens: number;
  }[];
  readonly totalTokens: number;
  readonly droppedOptionalIds: readonly Id[];
}

export interface BudgetConfig {
  readonly recentCompleteTurns: 8;
  readonly targetTotalTokens: 48000;
  readonly triggerTotalTokens: 72000;
  readonly outputReserveTokens: 8192;
  readonly toolReserveTokens: 2048;
  readonly packetSoftTokens: 8000;
}

// 上面的 literal 值是默认配置模板；实际运行时配置使用经校验的 number。
export interface RuntimeBudget {
  readonly recentCompleteTurns: number;
  readonly targetTotalTokens: number;
  readonly triggerTotalTokens: number;
  readonly outputReserveTokens: number;
  readonly toolReserveTokens: number;
  readonly packetSoftTokens: number;
}

export interface TokenMeasurement {
  readonly inputTokens: number;
  readonly outputReserveTokens: number;
  readonly toolReserveTokens: number;
  readonly totalTokens: number;
  readonly modelInputLimit: number | null;
  readonly modelTotalLimit: number | null;
  readonly mode: "exact" | "estimated";
}

export interface RpArchiveManifest {
  readonly protocol: "rp.context/v1";
  readonly id: Id; // rpa_ + 完整 sha256
  readonly inputFence: InputFence;
  readonly sessionId: Id;
  readonly surfaceGeneration: number;
  readonly sourceSeqs: readonly number[];
  readonly sourceRevisionIds: readonly Id[];
  readonly capsuleSha256: Sha256;
  readonly summaryIds: readonly Id[];
  readonly visibility: Visibility;
  readonly rawRecoverable: true; // 仅校验后能创建；恢复时重新核验
}

export interface RecoveryState {
  readonly archiveId: Id;
  readonly prepared: boolean;
  readonly surfaceCommitted: boolean;
  readonly persisted: boolean;
  readonly lifecycleClosed: boolean;
  readonly recoverable: boolean;
  readonly admission: "ready" | "blocked";
  readonly errorCode?: ErrorCode;
}

/** 下列 opaque handle 由真实适配层生成，不能用假 token 冒充原生锁。 */
declare const requestBrand: unique symbol;
declare const leaseBrand: unique symbol;
export interface FinalRequestHandle { readonly [requestBrand]: true }
export interface SessionLease { readonly [leaseBrand]: true; readonly sessionId: Id }

/**
 * 提案接口，必须依 capability 映射到现存 SDK 或标为 unsupported。
 * 不允许因这些方法在本文件存在就把相应宿主能力标为 verified。
 */
export interface RpHostAdapter {
  readonly capabilities: CapabilityReport;
  observeCanonicalChanges(
    consume: (change: CanonicalChange, authority: HostAuthority) => Promise<void>
  ): Promise<() => Promise<void>>;
  prepareFinalRequest(input: {
    authority: HostAuthority;
    packet: MemoryPacket;
    recentSourceIds: readonly Id[];
    currentSourceIds: readonly Id[];
    budget: RuntimeBudget;
    signal: AbortSignal;
  }): Promise<Result<FinalRequestHandle>>;
  measureFinalRequest(request: FinalRequestHandle): Promise<Result<TokenMeasurement>>;
  withSessionLease<T>(
    sessionId: Id,
    work: (lease: SessionLease) => Promise<T>
  ): Promise<Result<T>>;
  replaceSurface(input: {
    lease: SessionLease;
    manifest: RpArchiveManifest;
    capsuleText: string;
    expected: InputFence;
    signal: AbortSignal;
  }): Promise<Result<RecoveryState>>;
  inspectRecovery(
    authority: HostAuthority, archiveId: Id
  ): Promise<Result<RecoveryState>>;
  admitFinalRequest(input: {
    request: FinalRequestHandle;
    lease: SessionLease;
    expected: InputFence;
    signal: AbortSignal;
  }): Promise<Result<"admitted">>;
}

/**
 * 实现约束：
 * - admit 的验证与宿主实际消费请求之间必须有已验证的原子边界；
 *   无法阻止中间篡改/并发写入的 SDK 不能宣称该能力成立。
 * - replaceSurface/inspectRecovery 分别记录 surface、flush、lifecycle 状态。
 * - 模型调用服务另注入候选生成器；它不能持有 RpStore 写权限或 HostAuthority。
 * - token、序号、revision 检查 finite/safe integer；JSON 限制尺寸/深度/未知键。
 * - 运行时校验由项目已有 schemastery 或小型显式解析器实现；
 *   不能以 "as SemanticEvent" 等类型断言替代外部数据验证。
 */
