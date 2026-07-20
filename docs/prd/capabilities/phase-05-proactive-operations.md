# Phase 05 — Proactive Operations Engine · capability report

- **Status:** ✅ shipped
- **Branches:** dakio-api `claude/nova-phase-2-dakio-integration` · nova-ai
  `claude/nova-phase-2-live-dakio` (both uncommitted working trees)
- **Date:** 2026-07-20
- **Blueprint:** [`05-proactive-operations.md`](../../blueprint/05-proactive-operations.md)

> Nova now runs its own daily rhythm per tenant — morning report, hourly
> pulse, cart sweeps, night ops, weekly strategy, nightly reflection — each in
> the TENANT'S own local time, on a real per-tenant job queue instead of one
> shared UTC cron for whichever single dev store `NOVA_DEV_STORE_ID` named.
> Events (abandoned carts) debounce into jobs instead of only ever being
> discovered by the next poll. Everything is at-least-once, lease-fenced
> against double-execution, and dedupe-safe end to end (jobs, and now
> reports) — proven with a real Postgres, real DST transitions, and a live
> run against the real dev tenant, not just typecheck + evals.

## Gate (all green)

| Check | Result |
|---|---|
| nova-ai `npx tsc --noEmit` | ✅ clean |
| nova-ai `npx eve build` | ✅ clean |
| nova-ai `npx eve info` diagnostics | ✅ 0 errors, 0 warnings — discovery shows exactly 1 schedule (`dispatcher`), 2 channels (`eve`, `internal`) |
| nova-ai `evals/jobs/run.ts` (this phase) | ✅ 39/39 checks |
| nova-ai `evals/isolation/run.ts` (Phase 03, regression) | ✅ 44/44 |
| nova-ai `evals/memory/run.ts` (Phase 04, regression) | ✅ 40/40 |
| dakio-api hermetic suite (`npm test`) | ✅ 430/457 (27 pre-existing failures — Node 24 + Prisma ESM under `--experimental-test-module-mocks`, identical to baseline, unrelated to this work) |
| dakio-api Nova integration suite, real Postgres (`nova.test.js` + `novaStore.integration.test.js` + `novaEvents.integration.test.js` + `novaJobs.integration.test.js`) | ✅ 61/61 |
| Live smoke test against the real dev tenant (`cmrl3wa6s0000132q7mdev915`) | ✅ seeded a due job-def, claimed+leased it, filed a dedupe-keyed report, completed it, forced a stale-lease watchdog recovery, confirmed the "rerun" returned the ORIGINAL report content (not a duplicate) — all against the real local Postgres, real HTTP, a freshly-minted real service token. Cleaned up afterward. |
| Independent adversarial review | ✅ found 2 real bugs (no lease-fencing on complete/release; a completion-ack failure was misrouted into job-failure handling) + 2 lower-severity findings (an ambiguous prompt instruction; an overclaiming code comment) — all four fixed and re-verified (see below) |

## New capabilities this phase

- **Per-tenant job queue** — `NovaJobDef`/`NovaJob` (dakio-api Prisma models,
  migrations `20260720144523_nova_job_queue`, `20260720151000_nova_report_dedupe`,
  `20260720153000_nova_job_lease_token`) + `src/routes/novaJobs.js`
  (`GET/PUT /job-defs`, `POST /jobs/claim`, `POST /jobs/:id/complete`,
  `POST /jobs/:id/release`). `StoreClient.listJobDefs`/`upsertJobDef`/
  `claimDueJobs`/`completeJob`/`releaseJob` in both `DemoStore` and
  `DakioStoreClient` — no tool/subagent change, the interface held.
- **One authored dispatcher, per-tenant claim loop** — `agent/schedules/dispatcher.ts`
  (`cron: "* * * * *"`), the only production schedule now. Loops
  `listTenants().filter(isTenantActive)`, calls `claimDueJobs` once per
  ACTIVE tenant through that tenant's own service token, then
  `receive(internal, {auth: tenantAppPrincipal(storeId)})` per job.
- **`agent/channels/internal.ts`** — a `routes: []` receive-only channel; no
  inbound HTTP surface exists for it at all.
- **Real IANA-timezone cron engine** — `dakio-api/src/lib/novaCron.js` +
  nova-ai's TS mirror `agent/lib/jobs/cron.ts`. Deliberately scoped: supports
  exactly the minute/hour/day-of-week vocabulary the six job kinds need
  (daily-at-hour, hour-range, every-N-hours, weekly-on-weekday); dom/month
  fixed to `*`, validated not silently ignored. DST-correct (self-verifying
  tests scan for the actual 2026 transitions rather than hardcoding dates),
  exercised against all three real seeded tenant zones (`America/Los_Angeles`,
  `America/New_York`, `Asia/Dhaka`).
- **Event→job mapper** — `cart.abandoned` events debounce into `cart_sweep`
  jobs (30-minute fixed windows) via `drainEventsToJobs`, reusing Phase 2.3's
  `NovaInbox`. Only this one mapping is wired (see Known limitations).
- **Lease fencing** — `NovaJob.leaseToken`, reissued fresh on every lease
  (claim/re-lease). `complete`/`release` require the exact token they were
  handed; a stale caller (its lease was reclaimed by the watchdog while its
  session kept running) gets a safe no-op instead of corrupting a newer
  lease's outcome. Found by adversarial review, not in the original design.
- **Report-level idempotency** — `NovaReport.dedupeKey` (nullable,
  tenant-scoped unique). `file_report`'s job-filing kinds pass their job's own
  dedupeKey; a P2002 collision returns the ORIGINAL report instead of erroring
  or double-filing. Closes a risk the blueprint's own risk table named
  ("idempotency keys end-to-end — jobs, mutations, AND reports") that the
  initial build had left open.
- **Trust-plane guard widened** — `approve_action`/`reject_action`/
  `undo_action`/`configure_autonomy` denied on `principalType !== "user"` (both
  the `approval` callback and the `execute()` re-check), replacing a literal
  `authenticator === "app" && principalId === "eve:app"` string match that the
  dispatcher's own `nova-scheduler` principal doesn't match at all.
- **Attribution wired into production** — Phase 04's `runAttribution` (built,
  tested, never invoked outside its eval) now runs via the new
  `run_attribution` tool as reflection's step 4.
- **Per-tenant service tokens** — `resolve.ts`'s `NOVA_SERVICE_TOKENS` JSON
  map replaces the single shared `NOVA_SERVICE_TOKEN` every tenant's
  `DakioStoreClient` used to be built from regardless of `storeId` — closing a
  cross-tenant-in-`dakio`-mode hole the tenancy audit found (`NOVA_SERVICE_TOKEN`
  remains as the single-tenant fallback).

## Real deviations from the blueprint (found by audit, not assumed)

Same discipline as Phase 2.3: audited real call sites before designing, and
the actual implementation ended up simpler/safer in some places and stricter
in others than the blueprint's pseudocode assumed.

- **Job tables live in dakio-api, not a new Postgres.** The blueprint assumed
  "Postgres — same instance as Phase 04," but Phase 04 never created one:
  nova-ai has **zero** database dependencies (confirmed — no `pg`/`prisma`/
  any DB package in `package.json`, no DB env var, one stale comment in
  `tenants.ts` says "in production this is a Postgres table"). Every other
  phase's Nova state persists in dakio-api via the agent-data API; job rows
  follow the same idiom (tenant-scoped, cascade-deletes with the tenant),
  keeping the blueprint README's rule 1 ("StoreClient is the only data path")
  intact rather than introducing a second persistence mechanism.
- **No cross-tenant claim credential.** The blueprint's pseudocode calls
  `claimDueJobs(50)` once, globally. Every Nova service token that exists is
  scoped to exactly one tenant (`authenticateNovaService` hard-codes
  `req.tenantId = payload.tenantId`) — there has never been an "all tenants"
  credential anywhere in this codebase, and minting one to satisfy the
  blueprint's literal shape would have been a new, more dangerous kind of
  access this system has never had. The dispatcher instead loops
  `listTenants()` and calls `claimDueJobs` once per active tenant, each
  through that tenant's own token — N small HTTP round trips a minute instead
  of one big one, fully isolated (a bug in the claim path for one tenant
  can't leak into another's), and still bounded by SKIP LOCKED underneath.
- **No webhook mapper — the existing pull-based inbox is the event source.**
  The blueprint's step 5 assumed webhooks arrive at nova-ai. Phase 2.3 already
  built a pull-based `NovaInbox` drain instead (no webhook route exists in
  nova-ai at all) — `drainEventsToJobs` reads from the SAME table dakio-api's
  `enqueueNovaEvent` already writes to, no new wire protocol needed.
- **`eve`'s built-in dev-dispatch route IS the dev-drain mechanism.** The
  blueprint's testing strategy mentions "a dev-only channel route" for
  triggering claims in dev; eve already ships exactly this
  (`POST /eve/v1/dev/schedules/:id`), used directly for both the discovery
  check and the live smoke test — no custom route needed.
- **Degradation is scaffolded, not real** (see Known limitations) —
  `checkBudgetOk` always returns `true`; the priority-ordering and
  shed-below-priority-2 mechanism exists in `/jobs/claim` but has no real
  signal to act on since Phase 07 (budgets) hasn't shipped.

## PRD sections advanced

| PRD section | Before | After | Note |
|---|---|---|---|
| Daily proactive loop (fleet cadence) | ⬜ | ✅ | Per-tenant job queue + dispatcher; each of the six job kinds now fires in the tenant's own local time. |
| Never spammy / consolidates | 🟡 (prompt-enforced only) | 🟡 | Unchanged — still no code guarantee beyond prompt instructions; the queue changes WHEN a job runs, not what it says. |
| Kill switch (pause an employee) | ✅ (demo, in-memory) | ✅ | Now also enforced at claim time, not only the `turn.started` hook — a paused tenant's `/jobs/claim` call 403s before this router's code ever runs (verified live). |
| Learns from experience (reflection loop) | 🟡 (deterministic distiller, dev-dispatch only) | 🟡 | Now per-tenant dispatched; distiller is still deterministic (Phase 04's scope, unchanged). Attribution (`runAttribution`) is now actually invoked in production via `run_attribution`, not just the eval harness. |
| Idempotency everywhere (blueprint standing rule 6) | 🟡 (mutations only) | ✅ | Jobs, mutations, AND reports now all dedupe-safe under retry/re-lease. |

## Scenario walkthroughs

### Scenario 1 — Three tenants, three timezones, one dispatcher tick
Aurora Living (`America/Los_Angeles`), Beacon Supply Co (`America/New_York`),
and Mayer Doya Store (`Asia/Dhaka`) each have a `morning_report` job-def with
cadence `0 8 * * *` in their own `tz`. Every minute, `dispatcher.ts` loops all
three, calling `claimDueJobs` on each. At any given UTC minute, at most one of
them is actually at local 08:00 — `lastOccurrenceAtOrBefore` computes that
independently per tenant, so Aurora's morning report files around 15:00 UTC,
Beacon's around 12:00 UTC (or 13:00 during EDT), and Dhaka's at 02:00 UTC —
each on ITS OWN schedule, from the SAME one cron file. Verified live for the
Dhaka tenant during this session (seeded a job-def due at the exact current
Dhaka minute, watched it expand, lease, and complete against a real dispatch
call).

### Scenario 2 — A cart abandons, Nova reacts within the debounce window instead of the next poll
A shopper abandons a cart. dakio-api's `emitCartAbandoned` writes a
`cart.abandoned` row to `NovaInbox` (Phase 2.3, unchanged). On its next
`/jobs/claim` tick for that tenant, `drainEventsToJobs` picks up the
unprocessed event, buckets it into a 30-minute window, and upserts (idempotent
across ticks) a `cart_sweep` job due at the window's end — instead of waiting
for `cart_sweep`'s own every-4-hours cadence. If 19 more carts abandon in the
same window, they all land in the SAME job (one sweep, not twenty).

### Scenario 3 — A slow night-ops run doesn't get double-executed
`night_ops` does five sequential steps (campaign optimization → inventory
reorder → support triage → social draft → file the night plan) and can run
long. If it somehow outlives its 10-minute lease, the next tick's watchdog
recovers the row and a NEW session picks it up — but the ORIGINAL session's
eventual `completeJob` call carries its OLD lease token, which no longer
matches the row's current one, so it's a safe no-op instead of silently
overwriting whatever the newer session decided. And if the night plan itself
gets re-filed by a legitimately-re-run occurrence, it lands under the SAME
report row (dedupeKey) rather than duplicating it.

## Known limitations / not yet

- **Degradation is scaffolded, not real.** Priority ordering + a shed-path
  exist in `/jobs/claim`, but `checkBudgetOk` always returns `true` — there is
  no real per-tenant spend signal yet (Phase 07). Marked 🟡, not ✅.
- **Event→job mapping covers only `cart.abandoned`.** The blueprint's full
  matrix (`ticket.opened`→support_triage, `inventory.low`→inventory_check,
  `refund.requested`→support_triage) has no real event PRODUCER yet — Nova's
  actual event emitter (`novaEvents.js`) only ever fires `order.created`,
  `order.updated`, `cart.abandoned`. Wiring dead mappings for events nothing
  emits would be silent no-op code; the matrix structure supports adding rows
  when a producer exists, not before.
- **`NovaInbox.dedupeKey` is still globally `@unique`, not per-tenant** — a
  pre-existing Phase 2.0 schema choice, untouched by this phase (confirmed via
  diff). Currently dormant (every producer keys off a globally-unique cuid
  row id) but worth a follow-up if a future event producer doesn't.
- **`cart_sweep`'s event-triggered job undercounts `eventCount` on a bucket
  hit.** If a second event lands in an already-created window's bucket, the
  job's `payload.eventCount` isn't incremented (cosmetic — the sweep's own
  prompt does a general scan, not a per-event one, so nothing is missed
  functionally).
- **`DemoStore.completeJob` doesn't persist `sessionId`**, and `NovaJob`'s
  type carries no `startedAt`/`finishedAt`/`sessionId` at all (present in the
  dakio-api model, not surfaced through the API) — an observability gap in
  demo mode, not a correctness one.
- **Reflection's prompt wording was tightened, but not model-verified.**
  Adversarial review flagged that the original Step 5 phrasing ("File a short
  note...") echoed the other four kinds' explicit `file_report` instructions
  closely enough that the model could plausibly call `file_report` for
  reflection too — which would be unprotected (`reflection` is deliberately
  excluded from `FILES_REPORT`'s dedupeKey set, since `agent/skills/reflection.md`
  says this is a memory write, not a report). Fixed the wording to say
  explicitly "in memory... not `file_report`," but this is prompt
  engineering, not code — worth a live eval of actual model behavior once a
  gateway key is available (Phase 1's evals are already model-in-the-loop and
  gated the same way).
- **Not committed / not deployed.** Both repos' migrations must be
  `prisma migrate deploy`-d and the new env vars set (`NOVA_SERVICE_TOKENS`
  for a real fleet) before any live multi-tenant use.

## Matrix updates

See `docs/prd/capability-matrix.md` — "Daily proactive loop (fleet cadence)"
flips ⬜→✅; "Idempotency everywhere" flips 🟡→✅; kill-switch and reflection
rows get an evidence-pointer update.
