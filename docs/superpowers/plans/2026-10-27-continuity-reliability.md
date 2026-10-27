# Memory-Continuity continuity and reliability implementation plan

> **For agentic workers:** Use superpowers:executing-plans, one writer and at most one read-only reviewer. Track RED/GREEN commands and rulings in the progress report.

**Goal:** Repair request sizing and revocation boundaries, make bounded character core and long-document evidence usable, and keep management sustainable over time.

**Architecture:** Reuse the existing source/event/candidate split and fenced reads. Share one request-envelope definition and one operation-local global read view; add explicitly authorized document excerpts and opt-in core selection without changing old field policies. Lifecycle changes preserve durable idempotency and uncertainty evidence.

**Tech Stack:** TypeScript, Node 22, native DSH rc.2/rc.3, existing offline tests and local workbench.

**Spec:** [User request](../specs/2026-10-27-continuity-reliability-request.md). The user explicitly delegates implementation decisions and requests execution without another design approval.

## Global constraints

- No merge, push or release this iteration; deliver local committed candidate artifacts.
- No paid model calls, real user services, per-turn extra model calls, automatic adoption or unlimited retries.
- Keep permissions, source verification, branch isolation, counter reservation and unknown-result recovery.
- Preserve raw history and existing uncommitted work. No broad refactor or empty future UI.
- Builds, installs and heavy tests run serially; targeted tests per change, one integrated full regression at completion.

## Review focus

- Revocation after the last asynchronous read/write but before result release or publication.
- Document excerpts at Unicode boundaries and after revision/privacy/scope changes.
- Core selected on old/person-switched data, excess core size and private/group audience mismatch.
- Archived confirmation retry after restart and unknown commits at capacity.
- Browser navigation and expired entry handling on non-DSH hosts.

## Tasks

### Task 1: One request-sizing definition
Files: `src/rp/rp-plugin.ts`, `src/rp/context-retention.ts`, cost/budget native host tests.
Interface: share proposed retained/new context memory parts between tool sizing and request preparation; retain final admission checks.
- [x] Add failing native regression with necessary context around 60% of the memory limit and multiple small tools; independently count actual envelopes.
- [x] Correct reuse versus replacement accounting, preserving declarations/history/wrapping/headroom.
- [x] Run budget, cost and retention tests including cold restore, replacement and actual overflow; record results and commit.

### Task 2: Revocation and consistent global reads
Files: `src/rp/global.ts`, `src/rp/packet.ts`, global recovery/segment tests.
Interface: an operation-local snapshot read for all/active/fixed publications, revalidated authorization and fence before release; synchronous revocation check at commit boundary.
- [x] Deterministic failpoints for queue/blob/commit/final-metadata revocation, plus content revocation/deletion.
- [x] Centralize checks, preserve seal/idempotency semantics and define the commit point.
- [x] Share metadata/body reads for packet preparation; scale read-count measurements at multiple publication counts.
- [x] Run global compatibility/recovery and packet tests; record and commit.

### Task 3: Budgeted document evidence
Files: `src/rp/person/documents/`, retrieval/injection/tools and relevant native tests.
Interface: dedicated authorized document search/read with revision-bound source-range receipts and stable cursors, not ordinary user-control retrieval.
- [x] RED: long Chinese/Unicode document beginning/middle/end accessible below follow-up budget; scope conditions and stale pagination rejected distinctly.
- [x] Implement relevant bounded excerpts and an actual model-callable read path, keeping original documents intact.
- [x] Verify revisions/deletion and authority/recipient conditions through API and native tools; record and commit.

### Task 4: Explicit bounded person core
Files: person schema/draft/editor/management, injection and person tests.
Interface: explicit injection choice independent from stable/growing policy; old data unchanged; a separate bounded core allowance with actionable overflow diagnosis.
- [x] RED: configured core present during greeting/weather/work topics, unrelated background absent; private/person isolation and mutation/continuation refresh.
- [x] Implement persisted opt-in, management edit/preview and planner selection; document compatibility/migration.
- [x] Verify actual native prepared context, not only planner output; record and commit.

### Task 5: Authentication reuse and diagnostics
Files: context-retention, rp-plugin diagnostics, workbench preview/status.
Interface: operation-local message/event indexes, current core/optional/history/tool/retirement accounting, request-count remaining and explicit usage provenance.
- [x] RED: repeated retirement verification traverses surface once, forged events still fail; diagnostic requests cause zero model calls.
- [x] Implement reusable indexes and extend existing preview/status, including continuation review.
- [x] Record bounded performance measurements and native tests; commit.

### Task 6: Draft and confirmation lifecycle
Files: document management/workbench, `src/core/confirmations.ts` and service tests.
Interface: discover/resume/cancel pending document drafts; bounded active confirmation set and durable archived receipts that retain idempotency/uncertainty.
- [x] RED: parse/navigate/refresh/person-switch preserves visible drafts; repeated preview/cancel does not exhaust active capacity; cold old commit retry never reexecutes.
- [x] Implement lifecycle and near-capacity diagnostics; do not clear uncertain operations into retryable previews.
- [x] Verify API and browser behavior, archives/restart and unchanged saved documents; commit.

### Task 7: Host capabilities and candidate delivery
Files: management/core/AstrBot host capabilities, workbench client, docs, package metadata.
Interface: host capability descriptor + reopen entry; unsupported main actions unavailable and accurately explained.
- [x] RED: independent core/AstrBot do not expose DSH-only bind/budget/real model preview/continuation controls; expired entry shows correct host instructions.
- [x] Implement capabilities and automate SDK/navigation/recovery regression.
- [x] Run typecheck, build, full tests, fixture, pack dry-run serially; verify actual candidate packages in isolated native SDKs and core service.
- [x] Read-only final review, fix significant findings with regression evidence; update RESULTS and roadmap, commit locally and package source. No merge/release.

### Task 8: AI-proposed experiences (user scope update)
The user explicitly requested changing the primary experience flow to AI extracting events from conversations. This supersedes the original request's deferral of semantic extraction, but not evidence, review, bounded cost or offline verification constraints.
- [x] Reuse structured event candidates and source spans; enable AI to propose experiences from eligible conversations, with low-frequency triggers and a user-visible switch.
- [x] Candidate deduplication, source fencing, cancellation and bounded observable calls/retries must be operational; no automatic adoption, and no per-turn additional model request.
- [x] Workbench separates suggested experiences from confirmed timeline records, supports evidence review/adoption/rejection, and retains manual entry as a supplement.
- [x] Test through the actual host call path with an offline adapter; clearly distinguish extraction plumbing from unverified real-model semantic quality.

## Final acceptance boundary

Implementation and local packaging completed. The final npm test run failed because one Windows Node test process exited with 0xC0000374; its isolated five tests passed, but this does not constitute a full pass. See RESULTS.md for the preserved failure and exact package evidence. Full integrated runtime acceptance remains open; no merge or release is authorized by these results.
