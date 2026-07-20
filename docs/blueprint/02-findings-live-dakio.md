# Phase 02 — Live Dakio integration: deep-dive findings

- **Date:** 2026-07-20
- **Purpose:** Ground the Phase-02 blueprint against the *real* `dakio-api`
  (Express + Prisma, `d:\Dakio Apps\dakio-api`) before building. The blueprint
  assumed store APIs mostly exist and just need "confirm/extend." Reality: the
  Nova side is small; the backend side is three net-new build areas, and **only
  ~40% of `StoreClient` maps cleanly** — the rest needs derivation adapters or
  genuine new backend + product decisions.
- **Companion:** [`02-dakio-integration.md`](./02-dakio-integration.md) (the
  original plan) · [capability report](../prd/capabilities/phase-02-dakio-integration.md).

## TL;DR

1. **Nova side is cheap.** `StoreClient` is already async and tenant-bound. Phase 2
   on Nova = write `agent/lib/store/dakio.ts` (HTTP impl), flip `resolve.ts` to an
   env switch, add a webhook channel. No tool/executor/subagent changes.
2. **dakio-api has ZERO agent infra.** No machine auth, no agent-data tables, no
   outbound events, no queue. Three things must be built there.
3. **`storeId` (Nova) = `Tenant.id` (cuid).** Kill-switch is free: `Tenant.isActive`
   is checked per-request by `requireTenant`.
4. **The commerce data mostly exists but doesn't line up.** Products/customers/
   orders/discounts/expenses/carts/suppliers/POs read (with adapters). Campaigns,
   social posts, customer messaging, and per-courier performance are **hard gaps**.
5. **Currency mismatch is cross-cutting:** Dakio money is `Decimal` **BDT**; Nova
   assumes plain-number USD and formats `$`. Must normalize (BDT ৳ throughout).
6. **Two JWTs, two problems** (see Auth below): the inbound dashboard→Nova token
   Nova already verifies expects a `storeId` claim + audience, but Dakio issues
   `{userId, tenantId, role}` with no `aud`. And there is no token at all for the
   outbound Nova→Dakio direction.

---

## A. Nova side (small)

| Item | Where | Effort |
|---|---|---|
| `DakioStoreClient` (fetch impl of `StoreClient`: auth header, `X-Dakio-Store-Id`, retries/backoff on 429/5xx, error taxonomy, `Idempotency-Key` on writes) | new `agent/lib/store/dakio.ts` | M |
| Env switch `NOVA_STORE_BACKEND=demo\|dakio` | `agent/lib/store/resolve.ts` (`storeFor` builds `DemoStore` **or** `DakioStoreClient`) | S |
| Field/enum **adapters** (BDT scale, status maps, derivations) | inside `dakio.ts` | M–L |
| Webhook channel `POST /webhooks/dakio` (HMAC over raw body → `nova_inbox`; no model call) | new `agent/channels/dakio-webhooks.ts` | M |
| `.env` — currently only `ANTHROPIC_API_KEY`; add `DAKIO_API_URL` / `NOVA_SERVICE_TOKEN` / `DAKIO_WEBHOOK_SECRET` / `NOVA_STORE_BACKEND` | `nova-ai/.env` | S |

The `StoreClient` interface (`agent/lib/store/client.ts`, 48 methods) and
`DemoStore` (`agent/lib/store/backend.ts`) are the exact behavioral spec `dakio.ts`
must reproduce.

---

## B. dakio-api side — three net-new build areas

### B1. Service-principal auth (LOW effort, LOW risk) — do first
No machine/service auth exists; every `jwt.verify` uses `JWT_SECRET` and expects a
user payload. **Template already in the repo:** the admin-minted *support session*
token — `{ type: 'support', tenantId, adminId }`, 10-min, read-only — handled by a
`type` branch in `src/middleware/auth.js`.

**Build:** a `type === 'service'` branch in `authenticate` that sets
`req.user = { userId: null, tenantId, role: 'SERVICE', isService: true }` +
`req.tenantId`, then flows through the unchanged `requireTenant`. Sign Nova tokens
with a **separate `NOVA_SERVICE_SECRET`** (mirroring `getPreviewSecret()`), tenant-
scoped, so a Nova compromise can't forge user JWTs. Kill-switch comes free via
`requireTenant`'s `Tenant.isActive` check.

### B2. Agent Data API (MEDIUM effort, LOW–MED risk) — contained, additive
No `nova_*` tables exist. Add Prisma models + a `src/routes/nova.js` router (guarded
by `authenticate + requireTenant`, every query scoped by `req.tenantId`) + a
**committed** migration (repo had a P0 from an uncommitted migration — must commit).

Tables (mirror `DemoStore` behavior, all `tenantId`-scoped):
`NovaMemory` (PK `tenantId,namespace,key`; value, source, provenance jsonb, weight,
expiresAt, embedding — pgvector optional, brute-force fine to start) · `NovaAction`
(status/payload/justification/undoData jsonb; INDEX tenantId,status,createdAt) ·
`NovaActivity` (revenueInfluence, minutesSaved, department; INDEX tenantId,at) ·
`NovaReport` (kind, title, body) · `NovaConfig` (autonomy jsonb, PK tenantId) ·
`NovaExperiment` + `NovaPlaybook` (Phase-4 state) · `NovaInbox` (webhook landing;
dedupeKey unique) for B3.

This unblocks **all** of Nova's own-state persistence independent of commerce data.

### B3. Outbound event emitter (HIGH effort, HIGHEST risk) — do last, gated
Nothing emits domain events; no queue/broker. Closest pattern:
`notifyStorefrontRevalidate` (fire-and-forget signed `fetch`) + the `setInterval`
job pattern in `src/jobs/*`.

**Build:** an outbox table + HMAC-signed POST to Nova's webhook + a `setInterval`
delivery/retry worker (at-least-once). Wire emit calls into hot commerce mutations
(order create/update in `store.js`/`orders.js`, `StorefrontLead` abandonment,
`SupportTicket`) — the invasive part. Gate per tenant behind an `aiEnabled`-style
`Tenant` boolean. Until this lands, Nova stays **poll-based** (the existing
schedules already poll), so B3 is a latency/proactivity upgrade, not a blocker.

---

## C. StoreClient → dakio-api data mapping (verdict per group)

Legend: **DIRECT** works now · **DERIVE** compute in the client adapter from existing
rows · **GAP** no data source (needs backend + product decision).

| Group | dakio route / model | Verdict | Notes |
|---|---|---|---|
| Products (CRUD) | `products.js` / `Product`,`Inventory`,`Category` | DERIVE | stock = sum `Inventory.quantity`; cost = `purchasePrice`; price = `sellingPrice`; status case-map. GAP: `supplierId` (no FK), `compareAtPrice` write, reorderPoint, ratings, tags |
| Customers | `customers.js` / `Customer` | DERIVE | GAP: `segment`, LTV, ordersCount, lastOrderAt — all derivable from `Order` aggregates |
| Orders (read + status) | `orders.js` / `Order`,`OrderItem` | DERIVE | enum map (placed→PENDING, paid→APPROVED, delivered→DELIVERED, rto→RETURNED…). GAP: `refunded`/`refund_requested` states, `deliveredAt`, per-order `courierId` |
| Abandoned carts | `storefrontLeads.js` / `StorefrontLead` | DERIVE | real cart concept exists. GAP: no `recoveryMessage` field, no `message_prepared` state, no `customerId` FK |
| **Campaigns + ad stats** | `reports.js` (live Meta), `MetaAdsConnection` | **HARD GAP** | nothing stored; live Meta `ads_read` gives spend/impr/clicks only — **no revenue/conversions/ROAS/CPA/dailyBudget**; create/update **impossible** (no write scope) |
| **Social posts** | — | **HARD GAP** | no model, route, or Meta publishing — greenfield |
| Discounts | `coupons.js` / `Coupon` | DIRECT | percent maps to `type=PERCENT` + `amount`. GAP: scope/product/customer targeting |
| **Support tickets + customer messages** | `support.js`/`SupportTicket`, `meta.js`/`InboxMessage` | **GAP** | `SupportTicket` is merchant↔Dakio-ops (wrong scope, wrong taxonomy, no `customerId`); no unified `CustomerMessage` store (email/SMS unlogged; only Meta DMs) |
| Suppliers | `suppliers.js` / `Supplier` | DIRECT id | GAP: reliability/quality/offers/delay (derivable from `Purchase` history) |
| Purchase orders | `purchases.js` / `Purchase`,`PurchaseItem` | DERIVE | multi-line vs Nova single-product; **no status-update route**; GAP: `expectedAt` |
| **Couriers** | `courierLedger.js`, `DakioCourierAccount` | **GAP** | "courier" = provider string on `Tenant`; no tenant-facing list, no stored on-time%/RTO/regions; can't pick courier per order |
| Expenses | `expenses.js` / `Expense`,`ExpenseHead` | DIRECT | category = head-name map; add `sinceDays` filter |
| Trending products | `dropship.js` / `DropshipProduct` | GAP | marketplace catalog exists; demand/competition/insight scores have no source |

**Cleanly usable now:** discounts, expenses, supplier identity, PO create/list,
products/customers/orders/carts core (with adapters). **~40% clean, ~60% gap/derive.**

## D. Ranked gaps needing product decisions

1. **Campaigns + ROAS** — deepest. Needs a stored `Campaign`/`CampaignDayStat`
   model, Meta `ads_management` scope for writes, and a revenue-attribution source.
   Nova's marketing/growth/finance ROAS all depend on it.
2. **Social publishing** — greenfield capability.
3. **Customer messaging + customer support** — build a real `CustomerMessage` +
   customer-support model, or map Nova onto Meta inbox + email events only?
4. **Per-courier performance + per-order courier choice** — derive aggregates from
   `CourierConsignment`, or model couriers as entities?
5. **Cart recovery messaging** — add `recoveryMessage`/`message_prepared` to
   `StorefrontLead`.
6. Product↔supplier link, PO status update, supplier scores, trending intelligence.

---

## E. Recommended re-scope (slice Phase 2)

The original "swap DemoStore for DakioStoreClient" is too coarse — it would ship
campaigns/social/messaging/couriers broken. Slice it:

- **2.0 Backend foundation** (dakio-api): B1 service auth + B2 Agent Data API +
  migration. Contained, low risk. Unblocks all Nova state persistence. *No commerce
  coupling.*
- **2.1 Live reads** (Nova `dakio.ts`, read-only): products/customers/orders/carts/
  discounts/expenses/suppliers/POs via adapters. Morning report, anomaly radar,
  finance now run on **real store data**. Campaigns/couriers best-effort read.
  Actions stay `prepared` (no writes yet).
- **2.2 Mutations**: wire executor mutations to dakio PATCH/POST with
  `Idempotency-Key` + `X-Nova-Action-Id`. Order status, discount, PO, cart status,
  product update. Skip gap groups.
- **2.3 Events** (B3): outbound emitter + `nova_inbox` drain in the pulse schedule.
  Gated per tenant. Latency upgrade over polling.
- **Parking lot** (product decisions): campaign writes, social publishing, customer-
  messaging store, per-courier perf. These PRD capabilities stay 🟡 until built.

## F. Decisions (made 2026-07-20) & what shipped

1. **Ownership:** build the dakio-api side here. ✅ done.
2. **Scope:** 2.0 (foundation) + 2.1 (live reads) now; defer 2.2/2.3. ✅ All four
   slices now shipped & verified — **2.2 (commerce mutations)** and
   **2.3 (event-driven proactivity)** both built this session — see
   [phase-02 report](../prd/capabilities/phase-02-dakio-integration.md). B3
   (the outbound emitter) turned out simpler than originally scoped in §B3
   below: because `NovaInbox` lives in Dakio's own database (not a separate
   Nova-owned store), "emit" is just a same-process `prisma.novaInbox.create()`
   at each real mutation call site — no HTTP webhook, no HMAC signature, no
   retry worker needed.
3. **Campaigns:** read-only Meta insights. 🟡 endpoint wired (detects a live
   connection; insight fetch pending real creds) — returns `[]` gracefully.
4. **Customer messaging/support:** map to Meta inbox + email events. ❌ **not
   built** — investigated during 2.2 and found to be a genuine architecture
   gap, not just unscheduled work: Dakio's `SupportTicket` model is
   merchant→Dakio-admin support (no shopper-ticket status column to write
   through), and `InboxConversation` has no link to `Customer` (a `customerId`
   can't be resolved to a Meta conversation without guessing at the
   recipient — a real risk of messaging the wrong person). Deferred rather
   than half-built; revisit if Dakio ever adds a customer↔Meta-identity join
   or a shopper support-ticket model. Reads stay empty.
5. **Currency:** BDT throughout; Nova's `$`→৳ persona/format is a cosmetic follow-up.

**Built (2.0 + 2.1 + 2.2 + 2.3):** dakio-api service auth + Agent Data API +
`novaStore` read *and* write surface (products, orders, carts, discounts,
purchase orders) + idempotency cache (`NovaIdempotency`) + real event emission
(`src/lib/novaEvents.js`, ~20 call sites across 8 files) into the `NovaInbox`
table Phase 2.0 already built + 9 Prisma models + 3 migrations; nova-ai
`DakioStoreClient` (all commerce methods except the gaps above) + inbox
drain (`listInboxEvents`/`markEventProcessed`, `get_inbox_events`/
`mark_event_processed` tools, wired into the `pulse-monitor` schedule) +
`resolve` env switch + `nova-mint-token` script. **Remaining:** campaign
writes (product decision to stay read-only), social publishing, and the
messaging/ticket gap above — none of these are numbered sub-slices, they're
the parking-lot gap groups from §E.
