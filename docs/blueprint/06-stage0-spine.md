# Phase 06 — Stage 0: Spine

**PRD stage:** Stage 0 "Spine" (PRD §15) · **Prereqs:** shipped phases 01–05 + Nova UI Build step 1 (live feed).
**Nature:** this is a RESHAPE phase, not a build. The ledger, undo, feed, and door plumbing shipped in 01–05
under blueprint names; Stage 0 renames/extends them to the PRD's E-8 contract, makes receipts schema-enforced
(§16.2), and closes two platform defects (subagent tenancy, ৳ currency) that every later stage inherits.

## Already real vs to build

| Capability | Already real (evidence) | Phase 06 builds |
|---|---|---|
| Action ledger | `NovaAction`+`NovaActivity` Prisma models, written by `agent/lib/nova/actions.ts` via `dakio-api/src/routes/nova.js` since Phase 02 | ALTER to E-8: receipt object, `undo_deadline`, `undone_at`, `actor`, `target_ref`, nullable `agent_id`/`duty_ref`; append-only transition whitelist; export |
| Receipt | `justification {reason, expectedImpact, confidence}` mandatory in every action tool's zod schema | Full `receipt{evidence[], before, after, confidence, expected_impact, reason}` + API-layer enforcement (§16.2: receipt-less write = 422) |
| Undo | Executor/undoer registries + `undoData` snapshots, `undoAction` → status `undone` (`agent/lib/nova/actions.ts:195`, `executors.ts`) | 24h `undo_deadline` enforcement, `undone_at`, CI inverse-coverage check (pulled forward from old 07 step 6) |
| Live feed ≤3s | SSE shipped + live-verified <2s: `dakio-api/src/lib/novaFeedBus.js`, `GET /api/nova/feed/stream`, merchant `novaFeedStream.js` (nova-ui-build-01) | Nothing — cite as shipped; gate re-measures on staging |
| Door writes | `novaStore.js` idempotent commerce writes (`w()` + `NovaIdempotency`); `create_discount` executor+undoer exist | `X-Nova-Action-Id` attribution header (planned in 02, grep-verified absent in code), `Coupon.novaActionId`, visible **by: nova** chip in the Coupons door, Dakio nav presence markers (FR-1 tail) |
| Dakio→Nova events | `novaEvents.js` → `NovaInbox` at ~20 mutation call sites | Reverse direction: founder door writes → `actor:'founder'` ledger rows (coupons door exemplar) |
| Currency | Dakio stores Decimal BDT; Nova formats USD (`agent/lib/nova/format.ts usd()`, USD-shaped demo seed) | `money()` ৳ + minor-units convention (02-findings §F.5 deferred this as "cosmetic"; PRD §14 NFR makes it load-bearing) |
| Tenancy | `requireStore` (`agent/lib/tenant.ts:74`) + `tenant-guard` hook; dispatcher jobs carry `tenantAppPrincipal` | Subagent lineage fix: session→tenant registry + `ctx.session.parent.rootSessionId` fallback + regression test (canon correction: auth is null in declared-subagent sessions) |
| Playbooks | `NovaPlaybook` persistence-only (prisma + `/playbooks` routes + StoreClient methods) | Rename → `NovaRoutine`, freeing the Playbook name for PRD E-19 seasonal bundles (phase 14) |
| Merchant app boots | The two app-crashing bugs from nova-ui-build-01 (`AutopilotProvider` import, Sidebar `pendingCount`) are **already resolved at HEAD `4ca829a`** — grep of the committed tree finds no `Autopilot` reference and no bare `pendingCount` in `Sidebar.jsx` | Verify: clean `npm run build` + browser render of `/nova`, recorded as part of the gate |

## Objective

Make the one rule (§3) mechanically true and inspectable end-to-end for one verb: **authority check → execute →
append ledger entry with receipt → land behind a door**, with a 24h undo window, so the Stage 0 gate demo —
coupon created "as Nova", visible in the Coupons door and the live feed ≤3s with its receipt, then undone —
passes on a clean staging store run by a non-builder.

## Scope

**In:** E-8 ledger reshape (ALTER, no rebuild); receipt schema enforcement at the dakio-api API layer (§16.2);
append-only transitions + ledger export (§16 item 6, Stage 9 pre-req); 24h undo window + undo CI inverse check
(§16.3); by:nova attribution in the Coupons door + Dakio nav presence markers (FR-1 tail); founder-door-event→
ledger direction (exemplar); ৳/minor-units currency refactor (F.5); `NovaPlaybook`→`NovaRoutine` rename;
subagent tenancy fix + regression test; soft-delete convention ruling (§12 header); merchant crash-bug
verification; Stage 0 gate harness.
**Out:** authority engine v2 / duty registry / founder-only verbs (07); Decision entity + merchant
approve/reject/undo endpoints (08) — the gate's undo runs through the harness, same path as create; door tiles,
badges, remaining nine doors' by:nova rendering (surface-by-surface as their stages land); DB-grant-level
immutability + grounding audit (15).

## System architecture

```
eve session (chat / dispatcher job / subagent)
   tool → performAction (actions.ts)                        dakio-api
     ├─ gateAction (autonomy, unchanged this phase)
     ├─ execute via StoreClient ──── X-Nova-Action-Id ────► novaStore.js  ─► Coupon row (+ novaActionId)
     ├─ receipt{evidence[],before,after,…} assembled        │
     └─ POST /agent-data/actions  ──── receipt REQUIRED ──► nova.js  ─► NovaAction (append-only whitelist)
                                                            │            └─ novaFeedBus ─► SSE ≤3s ─► merchant feed
founder edits coupon in door ─────────────────────────────► coupons.js ─► actor:'founder' ledger row + NovaInbox (existing)
merchant Coupons door: GET coupons (+novaActionId) ─► "by: nova" chip ─► receipt drawer (GET /api/nova/actions/:id)
ledger export: GET /api/nova/ledger/export (merchant JWT) · GET /agent-data/actions/export (service token)
```

## Design decisions

1. **ALTER, never rebuild (canon E-8).** `NovaAction` has live production rows and a working pipeline; E-8 is
   reached by adding columns and reshaping the API view. `verb` is the existing `type` field exposed under the
   PRD name — no duplicate column. `NovaActivity` stays the denormalized feed-line table; the E-8/feed split is
   documented, not collapsed.
2. **Receipt enforcement lives at the dakio-api API layer, not just in tool schemas (§16.2).** Tool zod schemas
   already force justification, but a direct agent-data POST could omit it. `POST /agent-data/actions` now 422s
   unless `receipt` validates: `evidence[]` non-empty array of `{source, note, metric?, window?, value?}`,
   `confidence` 0–1, `expected_impact` string, `before`/`after` present (nullable only for pure-read outcomes,
   e.g. `blocked`). Every status (`executed|prepared|blocked`) requires a receipt — a refusal's evidence is the
   gate rule that fired. Justification is absorbed into `receipt.reason`; the old column is backfilled
   (`evidence: [], migrated: true`) and dropped from the write path.
3. **Append-only via transition whitelist now; DB grants in 15.** `PATCH /actions/:id` accepts only legal
   transitions (`prepared→executed|rejected`, `executed→undone` + `undone_at`) and only mutable fields
   (`status, outcome, decidedAt, executedAt, undoneAt`); `receipt`, `payload`, `type`, `department` are frozen
   at insert. Full INSERT-only role separation is old-07 material, pulled to phase 15 — the whitelist gives
   Stage 0 the auditable guarantee without a grants migration.
4. **Undo is a right with a clock (E-8, §13 non-negotiable).** Execution of an undoable action stamps
   `undo_deadline = executed_at + 24h`. `undoAction` refuses past-deadline undos with an explainable error that
   is itself persisted (a `blocked` record). Separate clock from decision expiry (canon §5: that TTL applies to
   Decisions, phase 08). CI inverse check (pulled from old 07): `scripts/check-undo-coverage.ts` statically
   asserts every ActionType whose executor can return `undoable: true` has a registered undoer + a named inverse
   unit test; wired into CI before `eve build`. This is the enforcement half of §16.3's new-verb checklist.
5. **by:nova is data, not inference (§4 Door, §14 Existing doors).** `DakioStoreClient` writes send
   `X-Nova-Action-Id`; `novaStore.js` persists it (`Coupon.novaActionId`) and `coupons.js` GET exposes it; the
   merchant Coupons page renders a **by: nova** chip whose click opens the receipt (fetched from the read-only
   `GET /api/nova/actions/:id`). Coupons first because it is the gate door; the column+chip pattern is the
   convention every later door copies. Nav presence markers (FR-1): Sidebar dots on watched modules from a
   static watched-module list in `NovaContext` (per-door modes arrive in 07).
6. **Door-event→ledger direction (§14).** `novaEvents.js` events feed Nova's inbox (Dakio→Nova, proactivity) —
   kept unchanged. The PRD also wants door writes IN the ledger: founder mutations in watched doors append
   `actor:'founder'` NovaAction rows (verb, target_ref, minimal receipt with before/after) — coupons.js
   create/update/delete as the exemplar. Founder rows are excluded from `tasksToday`/hours-saved aggregates
   (`actor` filter in `novaDashboard.js`) — §8/§11 count Nova's work, not the founder's.
7. **৳ + minor units (canon §4.10, F.5, §17).** Convention: every NEW money field is integer minor units
   (poisha) + implicit BDT; display currency from the store profile (all Dakio tenants BDT today). `format.ts`:
   `usd()` → `money(minor: number): string` using `toLocaleString("en-BD")` grouping with ৳; `moneyFromDecimal()`
   adapts Dakio's Decimal-major columns (e.g. `NovaActivity.revenueInfluence` — stays Decimal BDT, documented).
   Money guardrail caps re-denominated (maxAutoPurchaseOrderTotal → ৳2,50,000; maxAutoRefundTotal → ৳10,000 —
   placeholder values, re-cut by 07's canonical `NovaGuardrails`). Demo seed re-priced ৳-realistic. Persona and
   report prompts updated to speak ৳.
8. **Subagent tenancy (canon §4.1 — corrects Phase 03's claim).** eve's auth-and-route-protection guide:
   `ctx.session.auth.current` AND `.initiator` are **null** inside declared-subagent sessions (internal runtime
   path), so shipped `requireStore` falls to the `NOVA_DEV_STORE_ID` dev fallback — throws in prod, silently
   single-tenant in dev. Fix: an in-process session→tenant registry (`agent/lib/tenancy/registry.ts`,
   `Map<rootSessionId, storeId>` with TTL) written fail-closed wherever the root's tenant is resolved — the
   `tenant-guard` hook (`turn.started`, root sessions) and the dispatcher at `receive()` dispatch. `requireStore`:
   when auth is null and `ctx.session.parent` exists → `registry.lookup(ctx.session.parent.rootSessionId)`;
   a miss **throws** (never the dev fallback for subagent lineage). Tenancy still never comes from model input —
   the delegation message is model-authored and stays untrusted. Note: parent hooks never fire for subagent
   turns (canon §4.5), which is exactly why registration happens at the root and reads happen in shared tool code.
9. **`NovaPlaybook` → `NovaRoutine` (canon E-19).** Phase 04's procedural-skill promotions collide with PRD
   E-19 seasonal Playbooks. Persistence-only today → cheap rename: Prisma model + table rename migration,
   `/agent-data/routines` routes (old `/playbooks` path kept as an alias for one deploy cycle), nova-ai
   `types.ts` + StoreClient methods + `reflection.md` wording.
10. **Soft-delete ruling (canon §4.11, §12 header).** PRD §12 wants soft-delete everywhere; Phase 04's memory
    forget is a deliberate compliance HARD delete (no shadow copies). Ruling: hard delete stands for owner
    memory forget — **documented spec deviation, privacy wins**; all NEW Nova entities from this phase on carry
    `deletedAt` (nullable) and default-scoped queries. The ledger itself is append-only and never deleted.

## EVE features to use (exact surface)

- `ctx.session.parent` — present for child subagent sessions: `{ callId, sessionId, rootSessionId, turn }`
  (`eve/docs/guides/session-context.md`). The tenancy fallback keys off `rootSessionId`.
- `ctx.session.auth.current` / `.initiator` — null in declared-subagent sessions; top-level schedule sessions see
  `eve:app`; dispatcher `receive()` sessions carry the injected `tenantAppPrincipal` (shipped 05) — unaffected.
- `defineHook` `turn.started` — existing `agent/hooks/tenant-guard.ts` extended to register the session→tenant
  pair; hooks that throw fail the turn (kill-switch behavior kept). Parent hooks do not fire for subagent turns.
- `defineTool` — receipt fields ride each action tool's `inputSchema` (zod): `justificationSchema` →
  `receiptInputSchema` (evidence[], confidence, expected_impact, reason). Enforcement stays in shared tool code
  (`performAction`), the only place that covers root and subagents alike (canon §4.5).
- No new channels, schedules, sandboxes, or dynamic capabilities this phase.

## External services

None new. Postgres (existing dakio-api instance), the live Dakio Express API, the shipped SSE bus. No Redis, no
queue.

## Data models

```sql
-- dakio-api migration (ALTER of shipped tables — no rebuild)
ALTER TABLE "NovaAction"
  ADD COLUMN receipt jsonb,                -- {evidence[], before, after, confidence, expected_impact, reason, migrated?}
  ADD COLUMN "undoDeadline" timestamptz,   -- executed_at + 24h, undoable rows only
  ADD COLUMN "undoneAt" timestamptz,
  ADD COLUMN actor text NOT NULL DEFAULT 'nova',   -- 'nova' | 'founder' | 'system'
  ADD COLUMN "targetRef" text,             -- e.g. 'coupon:cku…' — the door record this action touched
  ADD COLUMN "agentId" text,               -- nullable until phase 14 (E-22)
  ADD COLUMN "dutyRef" text;               -- nullable until phase 07 seeds duties (E-5)
-- backfill: receipt = {reason, expected_impact, confidence} lifted from justification, evidence: [], migrated: true
-- then: writes stop accepting justification; column dropped in a follow-up migration after one deploy cycle

ALTER TABLE "Coupon" ADD COLUMN "novaActionId" text;          -- by:nova attribution (door exemplar)
ALTER TABLE "NovaPlaybook" RENAME TO "NovaRoutine";           -- + Prisma model rename
```

`verb` = existing `type` (exposed under the PRD name in API output). New-entity convention from here on:
`tenantId`, `createdAt`/`updatedAt`, `deletedAt` (soft delete), money in integer minor units ৳.

## APIs & interfaces

- `POST /api/v1/agent-data/actions` — **receipt schema-enforced**: 422 `RECEIPT_REQUIRED` unless receipt
  validates (D2). Response gains `verb`, `targetRef`, `actor`, `undoDeadline`, `undoneAt`, `agentId`, `dutyRef`.
- `PATCH /api/v1/agent-data/actions/:id` — transition whitelist (D3); illegal transition → 409.
- `GET /api/v1/agent-data/actions/export` (service token) and `GET /api/nova/ledger/export` (merchant JWT) —
  streaming NDJSON, `?from&to&status` filters. The merchant export is the §16 item-6 gate artifact source.
- `GET /api/nova/actions/:id` (shipped, read-only) — now returns the full receipt; the merchant receipt drawer
  reads it. Dashboard stays read-only — approve/undo endpoints are phase 08.
- `novaStore.js` writes — read `X-Nova-Action-Id` header inside `w()`, persist onto the mutated row (Coupon
  now; convention for every door).
- `coupons.js` — GET exposes `novaActionId`; founder create/update/delete appends an `actor:'founder'` ledger
  row (D6) alongside the existing `NovaInbox` emit.
- nova-ai: `performAction` assembles receipt (evidence from the tool call, before/after from the executor's new
  display-snapshot return, distinct from `undoData`); `undoAction` enforces `undoDeadline`; `DakioStoreClient`
  sends `X-Nova-Action-Id` on executor mutations.
- Merchant UI: by:nova chip + receipt drawer on Coupons rows; Sidebar presence dots. Founder-facing strings
  (chip label, marker tooltip, receipt field labels) ship **bn + en** from day one; all money rendered via
  `money()` ৳.

## Implementation steps

1. **Migration + backfill** (dakio-api): NovaAction ALTER, Coupon.novaActionId, NovaRoutine rename + route
   alias; backfill script with `migrated: true` receipts; integration tests over the transition whitelist.
2. **Receipt enforcement** in `nova.js` (shared validator module + tests: missing evidence → 422, blocked rows
   still need receipts, feed-bus emits unchanged).
3. **nova-ai reshape**: `receiptInputSchema` across all 11 action tools, executor display snapshots,
   `performAction`/`undoAction` (deadline stamp + refusal record), typecheck-driven sweep; `types.ts` ActionRecord
   → E-8 fields.
4. **Currency**: `money()`/`moneyFromDecimal()`, delete `usd()`, persona/prompt/report ৳ sweep, guardrail money
   caps re-denominated, demo seed re-priced (F.5).
5. **Tenancy**: `registry.ts`, tenant-guard + dispatcher registration, `requireStore` parent-lineage fallback,
   regression test: department delegation resolves tenant with `NOVA_DEV_STORE_ID` **unset**; verify registry
   repopulation on a resumed root turn (see Risks).
6. **Attribution + doors**: `X-Nova-Action-Id` in `dakio.ts`, `w()` persist, coupons.js expose + founder ledger
   rows + actor filter in `novaDashboard.js` aggregates; merchant chip/drawer/nav dots (bn+en strings).
7. **Undo CI check**: `scripts/check-undo-coverage.ts` + per-verb inverse unit tests; CI wiring; §16.3 checklist
   documented in the repo (gate-table entry + inverse + founder-only classification — the latter two enforced
   fully from 07).
8. **Merchant verification**: confirm crash-free HEAD (`npm run build` + browser render of `/nova` and Coupons).
9. **Gate harness** `scripts/stage0-gate.ts`: mint owner JWT for the staging store → drive the eve HTTP channel
   ("Create coupon SPINE10, 10% off") → assert Coupon row + `novaActionId`, SSE feed frame ≤3s, receipt complete
   → "undo it" → coupon gone, ledger shows `executed` + `undone` rows with `undoneAt` inside the window →
   export ledger NDJSON. Then the scripted staging demo, run by a non-builder.

## Dependencies

Phases 01–05 shipped (all on clean main). A clean staging store + staging deployments of dakio-api,
dakio-merchant, and the Nova agent. No Dakio-team work beyond code in these repos. The nova-ai and dakio-api
deploys for the rename/receipt changes are coordinated (route alias + tolerant reader cover one cycle of skew).

## Risks & trade-offs

| Risk | Mitigation |
|---|---|
| Receipt enforcement breaks live agent writes mid-deploy | deploy order: dakio-api accepts BOTH shapes (receipt required, justification tolerated-and-lifted) for one cycle → nova-ai ships receipt writes → drop justification path |
| Backfilled receipts have empty evidence — auditors could read them as violations | `migrated: true` marker + export includes it; grounding audit (15) treats migrated rows as pre-Stage-0 history |
| In-process tenant registry lost on process restart mid-delegation | fail-closed throw (never wrong-tenant); regression test covers resumed-turn repopulation; if `turn.started` proves not to re-fire on replay, escalate to a durable `NovaSessionTenant` table (open question) |
| Founder-actor ledger rows flood the feed/counters | actor filter excludes them from tasksToday/hours; feed shows them unlabeled-as-Nova; only watched doors instrumented (coupons exemplar) |
| ৳ re-denomination silently changes gate thresholds | one PR, typechecker-driven `Money` type on cap fields; autonomy-gating eval re-run against ৳ fixtures |
| Rename skew (playbooks→routines) between repos | route alias one deploy cycle; StoreClient method names switch atomically with the alias present |
| Undo-after-deadline surprises the founder | refusal is a persisted, explainable `blocked` record (D4) and surfaces in the feed |

## Testing strategy

dakio-api integration (real Postgres): receipt 422 matrix, transition whitelist, export streaming, coupon
attribution round-trip, founder-actor row + aggregate exclusion, SSE still pushes (existing 6/6 suite extended).
nova-ai: phase suite `evals/spine/run.ts` (receipt assembly, undo deadline enforcement incl. refusal record,
money formatting vectors, registry hit/miss/fail-closed, tenancy regression with dev fallback unset); undo
inverse unit test per undoable verb; `check-undo-coverage.ts` in CI. Prior suites stay green: isolation (44),
memory (40), jobs (39), autonomy-gating + nova evals. Merchant: `npm run build` clean + scripted browser check
of feed/chip/dots against staging.

## Performance

Feed path untouched — ≤3s bound already measured <2s live (nova-ui-build-01); gate re-measures on staging.
Receipt validation is in-process schema checking (<1ms). Export streams with a cursor (no full-table load).
Registry lookups are O(1) in-process. The ALTER adds nullable columns — no table rewrite on Postgres.

## Security

Tenancy never from model input; subagent fallback reads only the server-written registry, keyed by runtime
lineage (`ctx.session.parent.rootSessionId`), and fails closed. Receipt enforcement means no code path — model,
tool, or raw HTTP with a stolen service token — can write an unexplained action. Append-only whitelist blocks
history rewriting via PATCH. Ledger export is tenant-scoped by the same verified auth as every read
(`authenticateNovaService` / merchant JWT + `requireTenant`). `X-Nova-Action-Id` is attribution metadata, not
authority — the action row it points to is the source of truth.

## Success & exit criteria

**PRD Stage 0 gate (§15, verbatim):** *Create a coupon "as Nova" via harness → shows in door + feed ≤3s with
receipt → undo removes it, ledger shows action + undo.* All steps, zero manual DB pokes.
**§16 gate discipline:** scripted demo on a **clean staging store**, run by someone who didn't build the phase;
artifact filed = demo recording + the ledger export (NDJSON) from that run.
**Standing engineering gates:** `tsc --noEmit` clean · `eve build` clean · `eve info` 0 diagnostics · phase
suite green · prior suites green (isolation/memory/jobs/evals).
**Phase-specific:** receipt-less POST rejected (422) in integration test · undo refused past deadline with a
persisted explanation · `check-undo-coverage.ts` green in CI · tenancy regression test green with dev fallback
unset · zero `usd(`/`$` money strings in agent output paths (grep gate) · by:nova chip + nav dots render in the
staging browser check (bn + en) · merchant `npm run build` clean.

## Deliverables

Migration + backfill (E-8 columns, Coupon attribution, NovaRoutine rename); receipt validator + append-only
whitelist + export endpoints; reshaped action pipeline + tools (receipt, undo window, refusal records);
`money()` ৳/minor-units convention + re-priced seed; tenancy registry + `requireStore` fallback + regression
test; undo CI inverse check + §16.3 checklist doc; Coupons by:nova chip + receipt drawer + nav presence markers
(bn+en); `stage0-gate.ts` harness; gate demo recording + ledger export artifact; capability report
`docs/prd/capabilities/phase-06-stage0-spine.md` + capability-matrix updates.
