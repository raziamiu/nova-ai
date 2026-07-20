# Phase 02 — Dakio Integration · capability report

- **Status:** ⛔ **DEFERRED / not started** — only the async-seam slice
  ("Phase 2a", commit `98beca3`) was pulled forward. Phases 3 and 4 shipped
  on top of it *ahead of* Phase 2.
- **Branch / commit:** `claude/nova-phase-4-memory-avdxb6` @ `98beca3` (2a only)
- **Date:** 2026-07-20
- **Blueprint:** `docs/blueprint/02-dakio-integration.md`

> This report exists to keep the tracker honest: the build order was **1 → 3 →
> 4**, and Phase 2 (make Nova talk to the *real* Dakio store) was jumped. The one
> piece done early — turning the whole `StoreClient` contract async — was a
> mechanical prerequisite so later phases wouldn't have to re-break it. **Every
> read and write in the running agent still hits the in-memory `DemoStore`; there
> is no live Dakio HTTP integration and no webhook ingestion anywhere in the
> codebase.** This is the single biggest gap between the PRD and reality, and it
> blocks the "real" version of almost everything phases 1/3/4 demonstrate.

## What Phase 2 promised (blueprint `02-dakio-integration.md`)

- Replace the demo backend with a real **`DakioStoreClient`** — an HTTP impl of
  `StoreClient` (auth, store header, retries/backoff on 429/5xx, error taxonomy,
  `Idempotency-Key` on writes). Milestone: "Nova operates one real dev store."
- **`resolve.ts` env switch** — `NOVA_STORE_BACKEND=demo|dakio` +
  `DAKIO_API_URL` / `DAKIO_API_TOKEN` / `DAKIO_STORE_ID` / `DAKIO_WEBHOOK_SECRET`.
- **Webhook ingestion channel** — `agent/channels/dakio-webhooks.ts`
  (`POST /webhooks/dakio`), HMAC-SHA256 over the raw body, enqueue to a
  `nova_inbox` table, never invoke the model synchronously.
- **Dakio Agent Data API** — `nova_memory / nova_actions / nova_activity /
  nova_reports / nova_config / nova_inbox` tables + `GET/PUT/POST/PATCH
  /api/v1/agent-data/*` so agent state persists in Dakio's DB.
- Idempotency everywhere; CI eval suite green against **both** demo and Dakio
  backends; a 48h soak on a real dev store.

## What "Phase 2a" (`98beca3`) actually delivered — and did not

**Delivered:** the entire `StoreClient` contract went **async** —
`agent/lib/store/client.ts` methods return `Promise<…>` (except `now(): string`,
deliberately kept sync as a local clock read), and every `DemoStore` method in
`agent/lib/store/backend.ts` is `async` even though nothing awaits I/O. This is a
**seam, not a connection**: the interface is now HTTP-shaped so a future
`DakioStoreClient` drops in without rippling through tools/executors/analytics
again. Verified at the time (tsc/eve build clean; Phase-1 behavior unchanged).

**Not delivered (all still open):**
- ❌ No `dakio.ts` / `DakioStoreClient` — grep for `DakioStoreClient` = 0 code hits.
- ❌ No HTTP client at all — the only `fetch(` reference in the repo is a *comment*
  in `client.ts`; `package.json` has no HTTP-client dependency.
- ❌ `resolve.ts` always constructs `new DemoStore(...)`; no `NOVA_STORE_BACKEND`
  branch — grep for `NOVA_STORE_BACKEND` / `DAKIO_API_URL` = 0 code hits.
- ❌ No webhook channel, no `nova_inbox`, no HMAC verification (`agent/channels/`
  holds only `eve.ts`, an inbound *auth* channel — not a webhook ingest route).
- ❌ No Dakio Agent Data API wiring — agent state lives in `DemoStore.data` and is
  lost on restart.
- ❌ No `Idempotency-Key` on writes, no error taxonomy, no retries/backoff, no CI
  run against a Dakio backend.

> **Not to be mistaken for live integration:** `agent/lib/auth/dakio-jwt.ts`
> (verifies Dakio-signed JWTs for tenancy — but reads the key from env, makes no
> network calls) and the `x-dakio-*` request headers in `agent/channels/eve.ts`
> (inbound dashboard metadata). Both are Nova *receiving* a signed request, not
> Nova *calling* Dakio.

## Capabilities blocked on this phase (currently demo-only)

- **Live orders / customers / products / catalog** — reads and mutations go to
  seed-backed `DemoStore` arrays.
- **Live courier & logistics APIs** — no real carrier/fulfillment integration.
- **Live marketing / Meta ads metrics** — campaign stats are seeded, not from an
  ad platform.
- **Webhook / event ingestion** — `order.created`, `cart.abandoned`,
  `ticket.opened`, `inventory.low`, `refund.requested` cannot arrive; event-driven
  proactivity (and the Phase 5 dispatcher that depends on it) is blocked.
- **Real revenue & attribution** — the Phase-4 attribution pass runs over
  in-memory activity; no real sales data behind it.
- **Durable agent-state persistence** — memory, actions, activity, reports,
  autonomy config evaporate on restart.
- **Idempotent, auditable mutations against a real store** — no idempotency keys yet.

## Recommendation

Phase 2 should be the **next** build, before Phase 5 (proactive fleet) — Phase 5's
webhook-driven dispatcher and the "real" versions of Phase 1/3/4 all sit behind
it. Everything shipped so far is architecturally sound *behind the async seam*;
Phase 2 is what turns the demo into a business.

## Matrix updates

Phase 2 introduces no ✅ rows. It is named as the blocker on the "(live)" caveat
of every commerce-data capability in `docs/prd/capability-matrix.md`.
