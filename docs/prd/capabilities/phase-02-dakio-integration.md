# Phase 02 — Dakio Integration · capability report

- **Status:** 🟢 **all four slices shipped** — **2.0 (backend foundation)**,
  **2.1 (live commerce reads)**, **2.2 (commerce mutations)**, and
  **2.3 (event-driven proactivity)** all built and verified. (Previously fully
  deferred; "Phase 2a", the async `StoreClient` seam, shipped in Phase 1's
  window at `98beca3`.) Remaining work is the parked gap groups (marketing/
  support), not a numbered sub-slice — see Known limitations.
- **Branches / commits:** dakio-api `claude/nova-phase-2-dakio-integration` ·
  nova-ai `claude/nova-phase-2-live-dakio` (uncommitted working tree)
- **Date:** 2026-07-20
- **Blueprint:** [`02-dakio-integration.md`](../../blueprint/02-dakio-integration.md) ·
  deep-dive [`02-findings-live-dakio.md`](../../blueprint/02-findings-live-dakio.md)

> Nova can now run on **live Dakio data** instead of the in-memory demo store —
> read it, act on it (products, orders, cart recovery, discounts, purchase
> orders), persist its own state (memory, actions, activity, reports,
> experiments), and react to real store events (new/updated orders, abandoned
> carts) within the hour instead of only ever discovering them by polling —
> all behind an env switch (`NOVA_STORE_BACKEND=dakio`).

## What shipped

### 2.0 — Backend foundation (dakio-api)
- **Service-principal auth** — `src/middleware/novaAuth.js`
  (`authenticateNovaService` + `signNovaServiceToken`). A Nova token carries
  `{ type:'service', sub:'nova', tenantId }`, verified with a **dedicated
  `NOVA_SERVICE_SECRET`** (never `JWT_SECRET`, so a Nova compromise can't forge
  user tokens). Chains into the existing `requireTenant`, so the tenant
  kill-switch (`Tenant.isActive`) applies for free. Tenancy is from the token
  only — never a header/body.
- **Agent Data API** — `src/routes/nova.js` mounted at `/api/v1/agent-data/*`:
  config / memory (+ embedding write-back) / activity (+ attribution patch) /
  actions / reports / experiments / playbooks / inbox. Every query scoped by
  `req.tenantId`.
- **8 Prisma models** (`NovaConfig`, `NovaMemory`, `NovaActivity`, `NovaAction`,
  `NovaReport`, `NovaExperiment`, `NovaPlaybook`, `NovaInbox`) + committed
  migration `20260720084436_nova_agent_data` (canonical, applied + verified).
  `storeId` (Nova) = `Tenant.id`; all cascade-delete with the tenant.

### 2.1 — Live commerce reads (dakio-api + nova-ai)
- **Nova store-read surface** — `src/routes/novaStore.js` at `/api/v1/store/*`:
  products, customers (derived segment/LTV/ordersCount), orders (status-enum
  map, items, region), abandoned carts, discounts, expenses (category derived),
  suppliers, purchase orders (flattened). All impedance (Decimal→number, enum
  maps, derivations) lives here. Gap groups (campaigns live-Meta, couriers,
  social, trending, customer messaging/support) return graceful empties.
- **`DakioStoreClient`** — nova-ai `agent/lib/store/dakio.ts`: the HTTP impl of
  all 48 `StoreClient` methods (fetch + retries/backoff + idempotency-key +
  error taxonomy). Reads hit the two live surfaces; agent-data round-trips the
  API; commerce **mutations throw `NotImplementedError` (Phase 2.2)** rather
  than silently no-op.
- **Backend switch** — `agent/lib/store/resolve.ts` builds `DemoStore` or
  `DakioStoreClient` from `NOVA_STORE_BACKEND` (default `demo`). No tool,
  executor, subagent, or context-layer change — the interface held.
- **Provisioning** — `scripts/nova-mint-token.mjs` mints a per-tenant token.

### 2.2 — Commerce mutations (dakio-api + nova-ai)
- **Mutation routes** — `src/routes/novaStore.js`: create/update products
  (price/compareAtPrice/cost/stock/status — dropship-owned stock is guarded,
  same rule as the merchant dashboard), update order (status enum map +
  courier-consignment validation), update abandoned-cart recovery state,
  create/update discounts (Coupon, duplicate-code → 409), create/update
  purchase orders (single-line, Supplier/Product existence validated).
- **Idempotency** — new `NovaIdempotency` model (`tenantId+key` unique) +
  a `w()` route wrapper: `DakioStoreClient`'s per-write `Idempotency-Key`
  header is checked before the mutation runs and only a *successful* response
  is cached, so a retried write (network blip, 429/5xx) replays the original
  result instead of double-executing (verified: two `createDiscount` calls
  with the same key create exactly one coupon).
- **`DakioStoreClient`** — the 8 previously-`NotImplementedError` methods for
  these five domains now call the live routes; client stays a thin forward —
  all enum/impedance mapping is server-side, symmetric with the read path.
- **Scoped out, on purpose** — campaign writes (read-only Meta insights is a
  product decision, unchanged), social posts (no publishing integration),
  ticket status (Dakio's `SupportTicket` is merchant→Dakio-admin support, not
  shopper support — no backing store for a customer-ticket workflow),
  customer messaging (Meta's `InboxConversation` has no link to `Customer` —
  resolving a `customerId` to a conversation would mean guessing at the
  recipient). These remain `NotImplementedError`, same as before this slice.

### 2.3 — Event-driven proactivity (dakio-api + nova-ai)
- **Emission is explicit, not a global hook** — `src/lib/novaEvents.js` exports
  `emitOrderCreated`/`emitOrderUpdated`/`emitCartAbandoned`, each taking the
  DB client as its first argument. An audit of every `Order`/`StorefrontLead`
  create/update in the codebase (~29 call sites across 8 files) found several
  happen inside `prisma.$transaction(async tx => {...})` callbacks (checkout,
  dropship/ops fulfillment transitions) — a global Prisma hook attached to the
  top-level client can't cheaply enqueue an event as part of THAT transaction,
  so it would have to use a separate client, committing the inbox row
  immediately even if the surrounding transaction later rolls back (a phantom
  event for an order that never actually placed). Explicit call sites pass
  whatever client is already correctly scoped — `tx` inside a transaction,
  `prisma` outside one — so the event commits or rolls back atomically with
  the change it describes. ~20 call sites instrumented across `orders.js`,
  `admin/orders.js`, `admin/fulfillments.js`, `ops/fulfillments.js`, `pos.js`,
  `store.js`, `webhook.js`, `jobs/courierSync.js`.
- **No self-notification** — Nova's own writes back to Dakio (`novaStore.js`'s
  `PATCH /orders/:id` and `PATCH /carts/:id`) simply never call these helpers,
  so Nova never receives an event about its own action.
- **Idempotent by construction** — `enqueueNovaEvent` catches the `NovaInbox`
  unique-`dedupeKey` constraint (P2002) and swallows it; `order.updated` is
  keyed on `(orderId, RAW Dakio status)` — not the Nova-mapped status, since
  e.g. `PROCESSING` and `SHIPPED` both map to Nova's `fulfilled` and using the
  mapped value would silently collapse two distinct real transitions into one.
- **New `StoreClient` surface** (nova-ai) — `listInboxEvents`/
  `markEventProcessed`, implemented in both `DemoStore` (empty by default — no
  external event source in the demo) and `DakioStoreClient` (the agent-data
  `/inbox` routes Phase 2.0 already built but nothing wrote to until now).
  New tools `get_inbox_events` / `mark_event_processed`; `pulse-monitor`'s
  hourly schedule now drains unprocessed events for situational awareness
  before its anomaly scan.
- **Known, accepted gaps** (documented in code, not silent): hard order
  deletion (`DELETE /api/orders/:id`) has no event type to fire — a create/
  update-shaped model has nowhere to put "deleted"; `courierSync.js`'s
  dropship-fulfillment loop (array-form `$transaction([...])`) isn't
  instrumented — a third, idempotent statement there risks aborting the real
  business update on a dedupeKey collision — so that one path is discovered by
  Nova's next scheduled poll instead of instantly (an accepted latency
  trade-off, not a correctness bug, since Nova already polls as a fallback).
- **Found by adversarial review, undecided rather than built:** there is no
  cart-lifecycle-transition event — `emitCartAbandoned` fires once, at
  creation, and a lead later moving OPEN→CONVERTED (checkout auto-convert in
  `orders.js`/`store.js`) or OPEN→CONTACTED/DISCARDED (a merchant's manual
  PATCH in `storefrontLeads.js`) enqueues nothing. Partially mitigated on the
  auto-convert path — Nova already learns "a new order arrived" via
  `order.created` moments earlier — but there's no signal for "this
  specific previously-abandoned cart is the one that resolved." Not built
  now (would mean a new `InboxEventType` + nova-ai plumbing); a product
  decision to make later, not an oversight.

## Gate (verified this session)

| Check | Result |
|---|---|
| Prisma migrations applied (real Postgres) | ✅ `20260720084436_nova_agent_data`, `20260720124104_nova_commerce_idempotency` |
| Service-auth unit test (hermetic, in CI) | ✅ `src/middleware/novaAuth.test.js` — 8/8 |
| Store mapper unit test (hermetic, in CI) | ✅ `src/routes/novaStore.mappers.test.js` — 22/22 (12 read + 10 write-map/2.2) |
| Agent-data integration (live DB) | ✅ `src/routes/nova.test.js` — 8/8 (auth, isolation, kill-switch, CRUD, dedupe) |
| Store integration — reads + mutations (live DB) | ✅ `src/routes/novaStore.integration.test.js` — 11/11 (5 reads + create/update product, order status/courier, cart recovery, discount + duplicate-code, PO create/status, idempotency replay) |
| Live smoke test against real dev tenant (2.2) | ✅ create/toggle discount, create/update product round-tripped over HTTP with the minted service token, then cleaned up |
| Event-emission unit test (hermetic, in CI) | ✅ `src/lib/novaEvents.test.js` — 7/7 (dedupeKey formats, Nova status mapping, P2002 swallow, error passthrough) |
| Event-emission integration (live DB) | ✅ `src/lib/novaEvents.integration.test.js` — 6/6: real HTTP mutation → real `NovaInbox` row → drained via the real Agent Data API; a rolled-back transaction leaves NO event; a committed one does; dedupe holds against the real unique constraint; cart Decimal→number; tenant isolation |
| Live smoke test against real dev tenant (2.3) | ✅ real admin HTTP status-change round-tripped through the actually-running dev server → real `NovaInbox` row → drained + marked processed via the real Nova service token, then cleaned up |
| Independent adversarial review | ✅ 4-dimension parallel review (call-site correctness, dedupe/tenant-scoping, missed call sites, nova-ai side) + adversarial re-verification of every finding — 1 cosmetic fix applied (merchant status-PATCH no-op guard), 1 new gap surfaced and documented (cart-lifecycle events), 0 correctness bugs |
| nova-ai `tsc --noEmit` | ✅ clean |
| nova-ai demo-path regression | ✅ isolation 44 + memory 40 green |
| dakio-api full suite | 419/446 (27 failures **pre-existing** — Node 24 + Prisma ESM module-mock issue, identical on clean base; not this change) |

## PRD sections advanced

| PRD section | Before | After | Note |
|---|---|---|---|
| "Every store gets one employee" (live) | 🟡 demo | 🟡 live reads + writes | Real store data + real actions behind the env switch; single dev store (fleet = Phase 03). |
| Context-Aware on real data | 🟡 demo | 🟡 live | Snapshot/anomaly/finance/morning report can run on live orders/products/customers/expenses. |
| Autonomous action-taking (commerce) | ⬜ | 🟡 live | Product/order/cart/discount/PO writes now hit real Dakio data, idempotently. Marketing/support actions still gap. |
| Durable agent-state persistence | ⬜ | ✅ | Memory/actions/activity/reports/config persist in Dakio (survive restart). |
| Trust boundary (machine auth) | ⬜ | ✅ | Dedicated service principal, tenant-scoped, kill-switchable. |
| Event-driven proactivity | ⬜ | ✅ | Real order/cart events reach Nova within the hour via the inbox drain, not only via polling. |

## Known limitations / not yet

- **Gap groups — genuine architecture gaps, not oversights:**
  - Ticket status: Dakio's only `SupportTicket` model is merchant→Dakio-admin
    support (suppliers/billing), not shopper support — there's no column to
    hold a customer-ticket workflow status.
  - Customer messaging: Meta's `InboxConversation` is keyed by Facebook/IG
    sender id with **no link to `Customer`** — resolving `customerId` →
    conversation would mean guessing (real risk of messaging the wrong
    person). Email delivery would additionally need a new registered email
    template (none exists for an agent-composed message).
  - Both deferred together rather than half-built; revisit if/when Dakio adds
    a customer-identity↔Meta-identity join or a shopper support-ticket model.
  - Also empty/unbuilt: live campaign insights (connection detected, fetch
    pending — read-only by product decision, not a gap), social publishing,
    per-courier performance, trending intelligence, supplier scores.
- **Events don't cover everything (documented, not silent):** hard order
  deletion has no event type; `courierSync.js`'s dropship-fulfillment poll
  loop (array-form transaction) isn't instrumented — Nova learns of that one
  path on its next scheduled poll rather than instantly. See the 2.3 section
  above.
- **Currency:** Dakio is BDT; Nova's persona/format still prints `$` — cosmetic
  follow-up (`format.ts` + persona → ৳).
- **Single dev store.** Per-tenant token provisioning across a fleet → Phase 03.
- **Unrelated pre-existing bug found while smoke-testing, NOT part of this
  work:** `POST /api/store/:slug/leads` (dakio-api's public storefront lead
  capture) 500s on every call — its race-guard queries `Order.phone`, a field
  that doesn't exist on the `Order` model (`src/routes/store.js`, the
  `recentOrder` lookup just before the lead upsert). Confirmed via `git diff`
  that this code is untouched by this session's changes. Worth a separate fix;
  flagging here since it was discovered, not because Phase 02 owns it.
- **Not committed / not deployed.** Work sits on branches; migrations must be
  `prisma migrate deploy`-d and `NOVA_SERVICE_SECRET` set before any live use.

## Matrix updates

See `docs/prd/capability-matrix.md` — durable agent-state persistence and machine
auth flip to ✅; commerce-data rows note the live-read path behind the switch.
