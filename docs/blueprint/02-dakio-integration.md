# Phase 02 — Dakio Integration Layer

**Prereq: Phase 01 shipped.** Self-contained: everything needed to connect Nova to the
real Dakio Express store — data, mutations, agent-state persistence, and inbound events —
for ONE store (multi-tenancy is Phase 03; do not build it here, but don't block it).

## Objective

Replace the in-memory demo backend with the Dakio platform: Nova reads live store data,
writes mutations through Dakio, persists its own agent state (memory, actions, activity,
reports) in Dakio's database, and reacts to store events via webhooks. Milestone: Nova
operates one real dev store end-to-end.

## Scope

**In**: `DakioStoreClient` (HTTP impl of `StoreClient`); Dakio-side Agent Data API;
webhook ingestion channel; idempotency; error taxonomy; realistic seed for the dev
store; eval suite in CI.
**Out**: tenant fan-out, per-tenant context (03); vector memory (04); per-tenant
schedules (05).

## System architecture

```
agent/lib/store/
├── client.ts        # StoreClient interface (UNCHANGED — Phase 01 contract)
├── backend.ts       # demo impl (kept for evals/local dev)
├── dakio.ts         # NEW: HTTP impl → Dakio Express APIs
└── resolve.ts       # NEW: getStoreClient() picks impl from env

Nova (eve app)                          Dakio Express server
  tools → StoreClient(dakio) ──HTTPS──► /api/v1/store/*      (products, orders, carts…)
  action executors           ──HTTPS──► /api/v1/store/*      (mutations, Idempotency-Key)
  memory/actions/activity    ──HTTPS──► /api/v1/agent-data/* (NEW surface, Dakio team)
  channels/dakio-webhooks.ts ◄──HMAC─── event emitter (order.created, cart.abandoned…)
```

Selection: `NOVA_STORE_BACKEND=demo|dakio` + `DAKIO_API_URL`, `DAKIO_API_TOKEN`,
`DAKIO_STORE_ID` (single store this phase), `DAKIO_WEBHOOK_SECRET`.

## Design decisions

1. **The interface does not move.** `StoreClient` stays sync-looking? No — it must go
   async. **Breaking change executed once, this phase**: every `StoreClient` method
   becomes `Promise<...>`; demo backend methods become `async`; tools/executors/
   analytics add `await`. Do this FIRST (mechanical, typechecker-driven) so both impls
   share one async contract forever.
2. **Dakio owns persistence of agent data** (per platform design): Nova is stateless
   beyond eve sessions. Nova defines the API; Dakio team implements storage.
3. **Webhooks enqueue, never invoke the model synchronously.** A webhook write is
   cheap; model runs are scheduled work (this phase: a simple `nova_inbox` table read
   by the existing cron schedules; Phase 05 upgrades to the full dispatcher).
4. **Idempotency everywhere**: eve re-runs steps interrupted mid-execution, and
   webhooks are at-least-once. Every mutation carries `Idempotency-Key`.
5. Demo backend is retained and used by evals — deterministic CI without a Dakio dev
   server.

## EVE features to use (all you need this phase)

- Tools already exist; they only gain `await` — `execute` may be async, `ctx` unchanged.
- **Custom channel** for webhooks — `agent/channels/dakio-webhooks.ts`:
  ```ts
  import { defineChannel, POST } from "eve/channels";
  export default defineChannel({
    routes: [
      POST("/webhooks/dakio", async (req, { waitUntil }) => {
        const raw = await req.text();                 // HMAC over RAW body, constant-time
        if (!verifyHmac(raw, req.headers.get("x-dakio-signature"))) return new Response("bad sig", { status: 401 });
        waitUntil(enqueueEvent(JSON.parse(raw)));     // write to inbox; NO model call here
        return Response.json({ ok: true });
      }),
    ],
  });
  ```
- Idempotency key inside tools when needed: `` `${ctx.session.id}:${ctx.session.turn.id}:${ctx.callId}` ``.
- Evals (`evals/` sibling dir, `evals.config.ts` required):
  ```ts
  import { defineEval } from "eve/evals";
  export default defineEval({
    description: "Blocked discount is reported honestly",
    async test(t) {
      await t.send("Create a 35% off sitewide code BLOWOUT35 now.");
      t.calledTool("create_discount");
      t.check(t.reply, /* satisfies */ (v) => /block|guardrail|20%/i.test(String(v)));
    },
  });
  ```
  Schedule evals: `const { sessionIds } = await t.target.dispatchSchedule("morning-report")`
  then `await t.target.attachSession(sessionIds[0]!)` (dev-only route; CI runs against `eve dev`).
- **eve limitation noted**: connections (`defineOpenAPIConnection`) could expose Dakio's
  OpenAPI spec directly to the model — rejected: raw store APIs would bypass the action
  pipeline (autonomy, justification, undo, audit). All Dakio access stays behind typed
  tools. Use a connection only ever for read-only exploratory surfaces, if at all.

## External services

Dakio Express server (dev instance) — the only one. No DB owned by Nova this phase.

## Data models

**Dakio Agent Data API** (Nova-defined contract, Dakio-implemented; all rows scoped by
`store_id` from day one — Phase 03 depends on this):

```
nova_memory   (store_id, namespace, key, value text, updated_at, PRIMARY KEY(store_id, namespace, key))
nova_actions  (id, store_id, type, department, title, payload jsonb, justification jsonb,
               risk_class, status, outcome, undoable bool, undo_data jsonb,
               created_at, decided_at, executed_at; INDEX(store_id, status, created_at))
nova_activity (id, store_id, at, department, kind, title, detail, minutes_saved int,
               revenue_influence numeric, action_id; INDEX(store_id, at))
nova_reports  (id, store_id, kind, title, body text, created_at; INDEX(store_id, kind, created_at))
nova_config   (store_id PK, autonomy jsonb, updated_at)
nova_inbox    (id, store_id, event_type, payload jsonb, received_at, processed_at nullable,
               dedupe_key UNIQUE)   -- webhook landing zone
```

## APIs & interfaces

**Store data (Dakio → confirm/extend existing):** `GET /api/v1/store/products|orders|
customers|carts|campaigns|social-posts|discounts|tickets|messages|suppliers|
purchase-orders|couriers|expenses|trending` with the filters `StoreClient` needs
(`sinceDays`, `status`, …); `PATCH/POST` mutation twins of every executor mutation.
**Agent data:** `GET/PUT /api/v1/agent-data/config` · `GET/POST /api/v1/agent-data/
memory` (+`DELETE`) · `GET/POST/PATCH /api/v1/agent-data/actions` · `GET/POST
/api/v1/agent-data/activity` · `GET/POST /api/v1/agent-data/reports`.
**Conventions:** Bearer service token; `X-Dakio-Store-Id` header; `Idempotency-Key` on
all writes (Dakio stores 24h); errors `{ code, message, retryable }` with
`404 NOT_FOUND / 409 CONFLICT / 422 VALIDATION / 429 RATE_LIMITED`.
**Webhooks (Dakio → Nova):** `order.created|updated`, `cart.abandoned`,
`ticket.opened|customer_replied`, `inventory.low`, `refund.requested` — HMAC-SHA256
header, `event_id` for dedupe, ≥3 retries w/ backoff on non-2xx.

## Implementation steps

1. **Async-ify** `StoreClient` + demo backend + all call sites (tools, executors,
   analytics, dynamic-context). Gate: tsc clean, demo behavior unchanged.
2. Author the realistic demo seed (carried from Phase 01): 18 products, ~70 orders/30d,
   14 carts, 7 campaigns (incl. the CPA+43% bleeder and the scale-ready Blender push),
   PRD-signature stockouts/dead stock/courier & supplier issues, pre-seeded memory,
   2 prepared actions. Evals depend on these fixtures.
3. Build `dakio.ts` (fetch wrapper: auth, store header, retries w/ jittered backoff on
   429/5xx, error taxonomy mapping, Idempotency-Key on writes) + `resolve.ts` env switch.
4. Ship the Agent Data API contract to the Dakio team (this doc §Data models/§APIs).
5. Webhook channel + `nova_inbox` enqueue + dedupe; extend `pulse-monitor` schedule
   prompt to drain unprocessed inbox events ("new abandoned carts → run recovery").
6. Eval suite (5 evals from Phase 01 list) wired to CI: `eve eval --strict --junit` vs
   demo backend.
7. Point a dev store at `NOVA_STORE_BACKEND=dakio`; run the daily loop for 48h; fix drift.

## Dependencies

Dakio team delivers Agent Data API + webhook emitter; a dev store with data; service
token provisioning. Nova blocks on none of it until step 7 (demo backend covers 1–6).

## Risks & trade-offs

| Risk | Mitigation |
|---|---|
| Dakio API shape drifts from StoreClient | contract tests (step 6) run against both impls; interface is the spec |
| Webhook storms (bulk imports) | inbox dedupe + batch-drain in scheduled runs, never per-event model calls |
| Double execution (eve step replay / webhook retry) | Idempotency-Key on every write; `dedupe_key` unique index |
| Async refactor ripples | one mechanical PR, typechecker-driven, before any new features |
| Latency vs demo (network) | tool-level parallel fetches where independent; snapshot endpoint server-side aggregation (optional Dakio `GET /api/v1/store/snapshot`) |

## Testing strategy

Contract tests: same eval suite green on demo AND dakio backends. Unit: dakio client
(mock fetch) — retries, idempotency, error mapping. Integration: webhook signature
verify + dedupe. Soak: 48h daily loop on dev store; assert zero duplicate mutations.

## Performance considerations

HTTP keep-alive; page + cap all list pulls (tools already cap at 50); prefer one
aggregated snapshot call over N list calls in hot paths; webhook route does zero model
work (<10ms p99).

## Security considerations

Service token in Nova env only; HMAC (constant-time) on webhooks over raw body; never
log tokens or full customer PII in traces; all writes attributable
(`X-Nova-Action-Id` header on executor mutations → Dakio audit trail).

## Success / exit criteria

- Same eval suite green against demo and Dakio dev store.
- 48h soak: morning reports filed daily, carts recovered, zero duplicate mutations,
  zero cross-status inconsistencies in `nova_actions`.
- `StoreClient` interface untouched except async (proof the boundary held).

## Deliverables

`dakio.ts` + `resolve.ts`; async StoreClient; realistic seed; webhook channel +
inbox; Agent Data API contract doc for Dakio team; CI eval pipeline.
