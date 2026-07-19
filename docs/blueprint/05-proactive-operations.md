# Phase 05 — Proactive Operations Engine

**Prereq: Phase 03** (tenant identity, kill switch); pairs with Phase 04 (reflection
jobs run here). Self-contained: how "Nova never waits" works for a FLEET of tenants —
per-tenant schedules, event-driven triggers, and the PRD daily workflow — on top of
eve's deliberately static scheduling.

## Objective

Every tenant gets their own daily operating rhythm (morning report in THEIR timezone,
pulse monitoring, cart sweeps, night ops, weekly strategy) plus reactive runs on store
events — reliably, idempotently, and within cost budgets. Milestone: a fleet of dev
tenants each autonomously operated for a week.

## Scope

**In**: job store + dispatcher, per-tenant schedule config, event triggers (webhook →
job), timezone handling, notification fan-out hooks (delivery UX in 06), degradation
policy under budget pressure.
**Out**: dashboards (06), fleet observability (08).

## The core EVE constraint (read first)

eve authored schedules are: root-only files, ONE static cron each, evaluated in UTC,
fired for the DEPLOYMENT (not per tenant), task-mode (output discarded, **cannot pause
for human input** — approvals fail fast), at-least-once, and never fired by `eve dev`
(dev uses `POST /eve/v1/dev/schedules/:id`). Therefore authored schedules cannot BE the
per-tenant scheduler. eve's own docs prescribe the pattern we use: **one authored
dispatcher schedule + your own job rows** ("dynamic scheduling"). Nova's trust system
already absorbs the no-HITL constraint: background actions become `prepared` rows, never
parked sessions.

## System architecture

```
nova_job_defs (per tenant: which jobs, what cadence, tz)      Dakio webhooks
        │ expand (daily, or on config change)                       │ verify+dedupe (Phase 02)
        ▼                                                           ▼
nova_jobs (due_at, store_id, kind, payload, status, lease…)  ◄── event→job mapper (debounce)
        ▲                                                    
        │ claim batch (SKIP LOCKED lease)                     
┌───────┴────────────────────────────────────────────────────────────┐
│ dispatcher.ts — authored eve schedule, cron "* * * * *"            │
│   for each claimed job:                                            │
│     waitUntil(receive(internalChannel, {                           │
│        message: renderJobPrompt(job),        // skill-driven       │
│        target: { storeId, jobId },                                 │
│        auth: tenantAppPrincipal(storeId),    // carries tenancy    │
│     }).then(markDone).catch(release))                              │
└─────────────────────────────────────────────────────────────────────┘
   each job = ONE eve session, tenant-scoped, same tools/gates as chat
```

## Design decisions

1. **Jobs are data; the dispatcher is dumb.** All cadence/timezone/enable-disable
   logic lives in rows; the single authored cron just drains due work. Changing a
   tenant's schedule = a DB write, no deploy.
2. **`receive()` into an internal channel, not markdown task-mode**, so each job run is
   a real session with an initiator we control: a synthetic per-tenant app principal
   `{ authenticator: "nova-scheduler", principalId: "nova:scheduler", principalType:
   "runtime", attributes: { storeId } }`. Phase 03's `requireStore` reads
   `auth.initiator` for schedule runs — tenancy flows with zero tool changes. Trust-
   plane tools still deny non-user principals (they check `principalType !== "user"`,
   extended this phase from the Phase 01 `eve:app` check).
3. **At-least-once + idempotent**: lease via `FOR UPDATE SKIP LOCKED`; job idempotency
   key = `job_id`; mutations already carry Idempotency-Keys (Phase 02); a re-run of a
   half-finished job may re-read but cannot double-write.
4. **Quiet by design** (PRD: never spammy): pulse jobs that find nothing write nothing;
   notification fan-out respects per-tenant quiet hours; consolidation happens in the
   job prompt (one digest, not N pings).
5. **Degradation order under budget pressure** (per tenant, from Phase 07 budgets):
   drop pulse runs → reduce cart-sweep frequency → keep morning report → ALWAYS keep
   approval surfacing. Encoded in dispatcher priority, not model judgment.
6. **Events become jobs, not sessions.** Webhook mapper debounces (e.g. 20 carts
   abandoned in 5min → one sweep job), dedupes by `event_id`, and enqueues with
   `due_at = now + debounce window`.

## EVE features to use (exact surface)

- **Dispatcher** (`agent/schedules/dispatcher.ts`) — the only production schedule:
  ```ts
  import { defineSchedule } from "eve/schedules";
  import internal from "../channels/internal";
  export default defineSchedule({
    cron: "* * * * *",
    async run({ receive, waitUntil }) {                    // NOTE: defineState is unusable here (no session scope)
      const jobs = await claimDueJobs(50);                 // SKIP LOCKED lease, shard-aware
      for (const job of jobs) {
        waitUntil(
          receive(internal, {
            message: renderJobPrompt(job),                 // e.g. "Load the morning-report skill…"
            target: { storeId: job.storeId, jobId: job.id },
            auth: tenantAppPrincipal(job.storeId),
          }).then(() => completeJob(job.id)).catch((e) => releaseJob(job.id, e)),
        );
      }
    },
  });
  ```
- **Internal channel** (`agent/channels/internal.ts`): `defineChannel` whose
  `continuationToken` encodes `{storeId, jobId}`; `events: { "session.completed" }`
  handler records job outcome + duration. Not exposed publicly (route disabled or
  auth `none` + not routed by the LB — prefer: no inbound routes at all; `receive`
  doesn't need one).
- Existing five schedule FILES become job KINDS (`morning_report`, `pulse`,
  `cart_sweep`, `night_ops`, `weekly_strategy`, plus Phase 04's `reflection`,
  `attribution`); their markdown bodies move into `renderJobPrompt` templates that
  point at the same skills. Keep one authored `dev-*.ts` schedule per kind ONLY for
  dev-dispatch testing convenience, or drop them.
- **eve limitations honored**: UTC-only cron (tz math in `expandDue`); dev never fires
  cron (dev harness calls `claimDueJobs` via a dev-only channel route); schedule
  handler has no `ctx` and no state access; `waitUntil` REQUIRED around `receive`
  (fire-and-forget leaks otherwise); self-hosted deployments must run `eve start`
  (Nitro) or cron never fires — document in runbook.

## External services

Postgres (job tables — same instance as Phase 04). Optionally a queue (SQS/QStash) at
very large fleet sizes — NOT now; Postgres SKIP LOCKED comfortably handles tens of
thousands of jobs/minute, and the dispatcher shards before Postgres becomes the limit.

## Data models

```sql
CREATE TABLE nova_job_defs (
  id uuid PK, store_id text NOT NULL, kind text NOT NULL,
  cadence text NOT NULL,            -- cron expr interpreted in `tz`, or 'event'
  tz text NOT NULL DEFAULT 'UTC',
  enabled bool NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}',        -- e.g. {hour: 8} for morning report
  UNIQUE(store_id, kind));

CREATE TABLE nova_jobs (
  id uuid PK, store_id text NOT NULL, kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',        -- event batch refs, date window…
  due_at timestamptz NOT NULL,
  priority int NOT NULL DEFAULT 5,            -- 1=approval surfacing … 9=pulse
  status text NOT NULL DEFAULT 'due',         -- due|leased|done|failed|skipped
  lease_until timestamptz, attempts int DEFAULT 0, last_error text,
  session_id text, started_at timestamptz, finished_at timestamptz,
  dedupe_key text UNIQUE,                     -- e.g. 'morning:{store}:{date}'
  INDEX (status, due_at), INDEX (store_id, kind, due_at));
```
`expandDue` (runs inside dispatcher tick): for each enabled def whose next local-time
occurrence ≤ now → insert job with `dedupe_key = kind:store:occurrence` (UNIQUE makes
expansion idempotent across dispatcher replicas).

## APIs & interfaces

`agent/lib/jobs/service.ts`: `claimDueJobs(n)`, `completeJob(id)`, `releaseJob(id,
err)` (attempts<5 → backoff requeue; else `failed` + ops alert), `enqueueEvent(evt)`
(webhook mapper), `upsertJobDef(storeId, kind, cadence, tz, config)`. Dakio dashboard
settings API calls `upsertJobDef` when the founder edits Nova's working hours
(Phase 06). Job prompt templates: `agent/lib/jobs/prompts.ts` — thin wrappers that
name a skill + inject job payload facts.

## Implementation steps

1. Tables + job service + unit tests (lease contention, dedupe, backoff).
2. Internal channel + tenant app principal + `requireStore` initiator support +
   trust-tool guard update (`principalType !== "user"` denial).
3. Dispatcher schedule + `expandDue` + tz library (IANA, `Intl`-based, no deps).
4. Port the five daily-loop kinds to prompt templates; wire Phase 04 reflection +
   attribution kinds.
5. Webhook mapper: event→job matrix (cart.abandoned→cart_sweep debounced 30m;
   ticket.opened→support_triage debounced 10m; inventory.low→inventory_check 1h;
   refund.requested→support_triage priority 2).
6. Degradation policy in `claimDueJobs` ordering (priority, then budget check per
   tenant — skip-and-mark `skipped(budget)` when over).
7. Fleet soak: 10 dev tenants × 7 days.

## Dependencies

Phases 02 (webhooks, idempotent mutations) + 03 (tenancy, kill switch). Notification
delivery lands in 06 — this phase writes reports/prepared actions only.

## Risks & trade-offs

| Risk | Mitigation |
|---|---|
| Dispatcher tick overruns (many due jobs) | claim ≤50/tick/replica; horizontal replicas safe (SKIP LOCKED + dedupe_key); backlog metric + alert |
| Runaway model spend from event storms | debounce windows + per-tenant budget check at claim time + priority shedding |
| Job re-run duplicates side effects | idempotency keys end-to-end (jobs, mutations, reports keyed by `dedupe_key`) |
| Timezone/DST bugs | occurrence computed in tenant tz via IANA rules; dedupe_key on the occurrence; DST test vectors |
| A stuck job starves a tenant | lease timeout (10m) auto-releases; attempts cap; per-store concurrency 1 for same kind |
| `receive` session fails silently | internal channel `session.failed`/`session.completed` events update job rows; watchdog sweeps `leased` past timeout |

## Testing strategy

Unit: lease/dedupe/backoff/tz occurrence math (DST vectors). Integration (dev): seed
job defs → hit dev drain route → assert sessions ran, reports filed, jobs `done`,
duplicates impossible (run drain twice). Chaos: kill dispatcher mid-batch → jobs
re-lease, no double reports (dedupe). Fleet soak exit metrics below. Eval: morning
report content quality per Phase 01 eval, now per tenant.

## Performance considerations

Dispatcher tick p95 < 5s (claim + spawn only; sessions run async via waitUntil);
job sessions use model tiering (pulse/triage → cheap tier via job-kind model hint in
the dynamic model resolver); Postgres indexes above keep claim O(batch).

## Security considerations

Tenant app principal is minted ONLY by the dispatcher (constructor not exported to
tools); trust-plane tools deny it; internal channel accepts no external traffic;
job payloads treated as data in prompts; webhook path already HMAC-verified (02).

## Success / exit criteria

7-day 10-tenant soak: 100% morning reports on time (±5m local), zero duplicate
reports/mutations, event→job p95 latency within debounce+2m, budget shedding observed
working, kill-switched tenant receives zero runs.

## Deliverables

Job tables + service, dispatcher schedule, internal channel + tenant app principal,
event→job mapper matrix, tz engine + tests, ported job prompts, soak report.
