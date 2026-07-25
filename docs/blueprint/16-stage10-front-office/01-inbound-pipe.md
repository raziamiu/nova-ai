# Module 01 — Inbound Pipe: the hardened webhook→Nova event spine

**Phase:** 16 "Front Office" · **Depends on:** none · **Feeds:** 02, 03, 04, 06, 08
**Repos touched:** dakio-api | nova-ai (channel stub contract + fallback receive branch only)
**Founder requirements covered:** #20 (channel substrate), #23 (echo/takeover detection substrate), #26 (event/idempotency substrate)

This module is the plumbing every other Front Office module stands on: it turns Meta webhook
deliveries into exactly-once, actor-attributed database rows, exactly-once `NovaInbox` events, and
an authenticated, coalesced delivery lane into nova-ai's customer channel — with a job-queue
fallback when nova-ai is unreachable. It composes no customer-facing text; every customer-visible
byte in Stage 10 is produced by later modules through the reply pipeline whose queueing table
(`InboxOutbound`) and loop/rate contracts are defined here.

---

## Already real vs to build

| Already real (recon evidence) | This module adds |
|---|---|
| Webhook handshake + HMAC-SHA256 signature verification over `req.rawBody` with `timingSafeEqual` (recon-meta-pipeline.md:8-9; meta.js:437-475) | Unchanged — reused as-is |
| ACK-200-then-async processing (meta.js:478; recon-meta-pipeline.md:10) | Unchanged posture; the async block is hardened (insert-first dedupe, per-message try/catch) |
| FB/IG routing on `entry.id` → `FacebookPage.pageId` / `igAccountId` (meta.js:481-526) | Unchanged |
| `InboxMessage.metaMid @unique` (schema.prisma:1335) but check-then-insert dedupe is non-atomic and conversation upsert happens BEFORE the dedupe check, so duplicates bump `lastMessageAt`/unhide (meta.js:550-559; recon bites #3/#4) | Insert-first dedupe (create + catch P2002); conversation upsert moved after the insert |
| Echo suppression is only `senderId === selfId`; no `is_echo` check; page not subscribed to `message_echoes` — human replies from Meta Business Suite are invisible (meta.js:273, 532-534; recon bites #1/#2) | `is_echo` handling, `message_echoes` subscription, Send-API `metadata` stamping, echo classification incl. `founder_external` takeover |
| `sentAt` is DB insert time, not Meta's timestamp; ordering not guaranteed (schema.prisma:1337; recon bite #5) | `metaTimestamp DateTime?` stored from the event envelope |
| Attachments lossy (first URL only, type discarded); IG `rawPayload` not stored (meta.js:490-497, 495, 508; recon bite #6) | `attachmentType String?`; IG rawPayload stored |
| Profile fetch inline on every inbound, up to 5s before the row exists (meta.js:536-548; recon bite #13) | Fetch moved after insert, fire-and-forget |
| No actor/author column on outbound; Nova vs founder indistinguishable (recon bite #12; schema.prisma:1329-1342) | `InboxMessage.actor` + truthful backfill |
| No 24h-window tracking; late sends get Meta's opaque 400 (meta.js:750-770; recon bite #8) | `lastInboundAt` + `windowExpiresAt` maintained at ingest |
| No hook/event on inbound message — handleMessage writes and stops (recon-meta-pipeline.md:98) | `NovaInbox` `message.received` producer + suppression matrix |
| `NovaInbox` table with globally-unique `dedupeKey`; "never invoke the model synchronously on a webhook" (recon-action-ledger.md:144; schema.prisma:2201-2214) | New eventType `message.received` (+ registry rows for later producers); zero schema change |
| `enqueueNovaEvent` P2002-swallowed producer helper (recon-action-ledger.md:161; novaEvents.js:68-74) | New `emitMessageReceived(tx, …)` built on it |
| `drainEventsToJobs` — only `cart.abandoned` wired, 30-min buckets, atomic upsert (recon-action-ledger.md:223; novaJobs.js:134-185) | `message.received` fallback branch → `inbox_reply` job (priority 1) + hook seams for modules 04/06 |
| NovaJob priorities 1–2 explicitly reserved for the critical band (recon-action-ledger.md:235; novaJobs.js:41-53) | `inbox_reply` claims priority 1 |
| eve custom channels: `send()` with channel-namespaced `continuationToken`; cross-channel `args.receive(otherChannel, …)` hand-off (recon-eve-runtime.md:36, 40; custom.mdx:16-55, 148-185) | `agent/channels/customer.ts` stub (HMAC contract, 202/401/409 semantics) + `internal.ts` `inbox_reply` branch |
| Per-tenant service tokens, `authenticateNovaService + requireTenant`; no fleet credential (recon-action-ledger.md:249) | Reused unchanged for the nova-ai → dakio-api direction |
| `CustomerChannel` model with `[tenantId, kind, address]` unique + consent columns (schema.prisma:1758-1778) | Zero schema change; address-format doc-comments codified here (first writers land in module 03) |
| Meta data-deletion handler: hard-deletes conversations+messages cross-tenant by senderId (meta.js:866-887; recon-meta-pipeline.md:76) | CustomerChannel + psid-memory deletion, InboxOutbound cascade verification, promise-release step (spec here, enabled with module 03), compliance-boundary comment |
| Merchant send rate limiter 30/60s per tenant, in-process (meta.js:716-725; recon bite #9) | Separate Nova rate bucket instance (30/min/tenant) so Nova neither consumes nor hides behind the merchant budget |
| OUT: postback/quick-reply persistence — the webhook still drops non-`msg.message` events (meta.js:488, 502; recon bite #7). No data source for structured round-trips in v1; deferred to rollout P4 (module 12 tracks it) | — |
| OUT: out-of-window sends — no MESSAGE_TAG/HUMAN_AGENT support anywhere (meta.js:750-770); v1 refuses honestly, never works around | — |

---

## Objective

After this module ships, every inbound Messenger/IG customer message becomes exactly one
actor-attributed `InboxMessage` row and exactly one `NovaInbox` `message.received` event, delivered
to nova-ai's customer channel within ~6s (or drained to a priority-1 job if nova-ai is down), with
duplicate Meta deliveries, echoes, and self-sends provably producing nothing. A founder reply typed
in Meta Business Suite locks the thread (`novaLockedAt`) within one webhook delivery. A Meta
data-deletion callback removes every Nova-side row derived from that PSID while commerce records
survive.

## Scope

**In:** webhook hardening; base schema migration (`InboxMessage` actor columns + backfill,
`InboxConversation` base columns, `InboxOutbound` model); `message.received` producer + suppression
matrix; coalesced HMAC delivery lane + `inbox_reply` fallback job + cross-channel receive branch;
five-layer reply-loop prevention contract; end-to-end idempotency/race table; echo classification +
Send-API metadata stamping + `message_echoes` subscription; both-direction auth + tenant-registry
provisioning prerequisite; Meta data-deletion extensions; channel abstraction (kinds/address
formats/per-adapter window rules); drain extension seams + event registry; latency budget + alarms;
the `/api/v1/inbox` router file (`src/routes/novaInbox.js`: router creation, service-auth
middleware, mount in `src/index.js`) + the `w()` idempotency-wrapper extraction
(`src/lib/novaIdempotency.js`).

**Out (owner in parens):** the customer session itself — principal, persona, instructions, tools,
timing engine, the `/api/v1/inbox` route *handlers* incl. `POST /reply` guards (module 02 — the
router file itself is owned here, see In); identity
linking, `CustomerChannel` first writers, `customer360Out`, `NovaPromise` semantics (module 03);
journey reducer logic + followup cancel semantics (module 04 — call sites wired here);
`case.updated` handling (module 06 — drain branch seam here); handover columns
`escalationReason/handedBackAt/sla*` + merchant takeover/release routes (module 08); postbacks,
structured sends, WhatsApp adapter wiring (rollout P4, module 12).

---

## Design

### D1. The webhook stays write-and-ACK; the model is never in the request path

`POST /api/meta/webhook` keeps its exact external behavior (signature check, immediate 200, async
processing). Everything below happens inside the hardened `handleMessage`. The stated rule "never
invoke the model synchronously on a webhook" (schema.prisma:2201-2202) is preserved: model
invocation happens in a separate post-commit delivery step (D5) with the `NovaInbox` row as the
durable record, so a crash between commit and delivery loses nothing.

Hardening changes inside `routes/meta.js` (fix recon bites #3/#4/#5/#6/#13):

1. **Insert-first dedupe.** Replace findUnique-then-create with `tx.inboxMessage.create` + catch
   P2002. The `metaMid @unique` insert becomes the atomic dedupe point. On P2002: stop for that
   message — no conversation bump, no event. Messages with `mid == null` insert with
   `metaMid: null` (no unique collision), as today.
2. **Conversation upsert moves AFTER the insert** — duplicate deliveries no longer bump
   `lastMessageAt` or resurrect archived threads (recon bite #10 quirk closed).
3. **Per-message try/catch** inside the entry loop — one race/P2002 no longer aborts the rest of
   the webhook batch (recon bite #4).
4. **Store `metaTimestamp`** from the event envelope (ordering truth; `sentAt` stays insert time);
   **store `rawPayload` for IG too**; **store `attachmentType`** from
   `msg.message.attachments?.[0]?.type` (`image|audio|video|file|share|sticker`).
5. **Profile fetch moved after insert, fire-and-forget** — removes up to 5s from the trigger path.
6. **`msg.message.is_echo` checked** alongside `senderId === selfId` (D8 owns full echo
   classification; until `message_echoes` is subscribed this is defensive only).

### D2. Ingest transaction — exact sequence

One Prisma transaction per inbound message (after the echo/self short-circuit):

```
tx: 1. INSERT InboxMessage {direction:'in', actor:'customer', text, attachmentUrl,
       attachmentType, metaMid, metaTimestamp, rawPayload}        ── P2002 ⇒ abort, no-op
    2. UPSERT InboxConversation {lastMessageAt, lastInboundAt: now,
       windowExpiresAt: metaTimestamp + 24h, hiddenAt: null, senderName?, senderAvatar?}
    3. CANCEL queued InboxOutbound rows for this conversation
       (updateMany status:'queued' → 'canceled', cancelReason:'new_inbound')
    4. FOLLOWUP CANCEL HOOK: tx.novaJob.updateMany({where:{tenantId, kind:'followup',
       status:'due', payload:{path:['conversationId'], equals: conversationId}},
       data:{status:'skipped', lastError:'cancelled:customer_replied'}})   (semantics: module 04)
    5. JOURNEY REDUCER CALL SITE: advanceJourney(tx, tenantId, {type:'message.received', …})
       — deterministic code, no model; ships as a no-op stub until module 04 lands
    6. emitMessageReceived(tx, …)  → NovaInbox row (suppression matrix D3)
post-commit: schedule coalesced delivery (D5); fire-and-forget profile fetch
```

Steps 3–5 run in the same transaction deliberately: a customer double-texting must atomically
supersede a queued Nova reply and a scheduled follow-up — a crash cannot leave a stale send armed
against a newer message. The 24h window is computed from `metaTimestamp` (Meta counts from the
customer's send, not our insert).

### D3. `message.received` emit rules — the suppression matrix (canonical C-22)

`emitMessageReceived(tx, tenantId, conversationId, messageId, platform)` wraps `enqueueNovaEvent`
(P2002-swallowed, novaEvents.js:68-74) with eventType `message.received`, dedupeKey
`message.received:<inboxMessageId>`, payload `{conversationId, messageId, platform}`. Message
**content never rides the event bus** — Nova reads it via `get_conversation`, which keeps the
`untrusted()` boundary in one place.

Emit is suppressed **only** when:

| Condition | Why |
|---|---|
| `actor !== 'customer'` | Outbound writes (Nova/founder/echo/system) can never trigger Nova — loop layer 2 (D6) |
| Tenant has not hired Nova / tenant kill switch active | A paused tenant's customers silently get no Nova; merchant inbox works as today |
| `InboxConversation.novaEnabled === false` | Per-thread founder switch, server-enforced |

On founder-held/locked threads (`handledBy:'founder'` or `novaLockedAt` set) events **still flow**
when guardrail key `inbox.draftWhileFounderActive` is true (seeded default true) — silent drafting
(module 08 §6.4 behavior) needs the events; the guardrail branch and the `/reply` hard gate force
draft/blocked so the lock still cannot be raced. A missing key reads false ⇒ no events on held
threads ⇒ fail-closed in the quiet direction. **The default-true seed is NOT shipped in
this module** — it is deferred to module 08's guardrail seeding (a gate item there); until
then held-thread events stay off, which is the quiet direction and therefore safe to defer.

### D4. `InboxOutbound` — the delayed-send + retry ledger (schema owned here)

Meta send failures persist nothing today (meta.js:767-771), so Nova's send must be at-most-once
with its own ledger. The table (full Prisma in Data model) is created in this module's migration
because the ingest transaction cancels its rows (D2 step 3) and the data-deletion cascade covers
it (D10). Consumers: module 02's reply route/`inboxSender.js` write and claim rows; module 08's
takeover cancels them (`cancelReason:'founder_takeover'`). Claim idiom: conditional
`updateMany({where:{id, status:'queued'}, data:{status:'sending'}})` — same at-most-once pattern
as decision approve. Crash recovery: a startup/15s sweep marks stale `sending` rows `failed` after
timeout and **never auto-resends** them — a possibly-delivered chat message must not repeat;
the failure is a visible ledger row.

### D5. Coalesced delivery lane — `src/lib/inboxDelivery.js` (new)

```
Meta ─webhook─► handleMessage (D2) ─commit─► inboxDelivery.js
                                              │ per-conversation coalesce timer, COALESCE_MS=5000
                                              │ collect ALL unprocessed message.received events
                                              ▼
                              POST https://<nova>/customer/message
                              body {storeId, conversationId, platform, messageIds:[…]}
                              x-nova-signature: HMAC-SHA256(rawBody, NOVA_INBOX_SHARED_SECRET)
                              x-nova-timestamp: ISO, rejected outside ±5 min
                    2xx ──► PATCH NovaInbox rows processedAt
                    409 (session busy) / 5xx / timeout ──► leave unprocessed;
                          in-process retry at +10s, +30s; then the dispatcher drain owns it
FALLBACK: drainEventsToJobs message.received branch → NovaJob {kind:'inbox_reply', priority:1,
          dedupeKey:'inbox_reply:<conversationId>:<30min-bucket>'} → dispatcher next tick →
          internal.ts inbox_reply branch → args.receive(customerChannel, {message, target,
          auth: customerPrincipal(...)}) — the SAME customer:inbox:<conversationId> session
          handles it (cross-channel hand-off, custom.mdx:148-185); worst case +60s cron lag
```

Decisions:
- The 5s coalesce window is the double-text batcher: a customer sending three rapid messages
  produces one model turn over all three, not three competing turns.
- The delivery worker is in-process (same single-instance posture as the SSE bus, documented).
  Durability comes from the `NovaInbox` rows, not the timer: unprocessed events survive deploys
  and are re-coalesced on boot and drained by the dispatcher lane.
- The fallback job handler **re-reads unprocessed events**; if the live lane already processed
  them the job is a no-op — the two lanes can never double-deliver a message id (D7).
- **Re-delivery ordering:** when multiple undelivered conversations queue (boot resume, kill-switch
  resume, drain), re-delivery orders by urgency desc, `windowExpiresAt` asc, `lastMessageAt` asc.
  Urgency is computed per module 11's assessment persistence; a conversation with no persisted
  assessment is treated as normal urgency. nova-ai keeps no app-layer queue — the burst buffer is
  the unprocessed `NovaInbox` rows in dakio-api.
- **`mark_seen` hook:** on delivery of an inbound batch, `inboxDelivery` fires the `mark_seen`
  sender action per module 02 D7's timing spec.
- nova-ai side in this module is a **stub contract**: `agent/channels/customer.ts` verifies HMAC +
  timestamp (401 on failure), parses the body, and returns 202 (or 409 when the continuation is
  busy — the app-layer queue of unprocessed events is the burst buffer). Module 02 fills in the
  principal/session/tool behavior behind the same route without changing this contract.
  **Interim safety flag:** dispatch is gated behind `NOVA_CUSTOMER_TURNS_ENABLED` (default
  OFF) — deliveries authenticate and return 202 so the contract holds end to end, but no
  model turn starts. Without module 02's `dakio-inbox` instruction layer a dispatched turn
  would run Nova's FOUNDER instructions and full business toolset against
  customer-controlled input; the flag flips on with module 02, never before.

### D6. Reply-loop prevention — five layers, defense in depth

1. Webhook drops `senderId === selfId` and `msg.message.is_echo` (D1.6).
2. `emitMessageReceived` fires only for `actor:'customer'` rows (D3) — no outbound write can
   trigger a turn.
3. Echo classification (D8): our own echoes match a `dakio:*` metadata stamp or an existing
   `metaMid` and are dropped by the same unique insert; unmatched echoes become
   `actor:'founder_external'` and **pause** Nova — the opposite of triggering it.
4. Hard loop-breaker at the reply route (contract defined here, enforced where the route lands in
   module 02): more than `NOVA_MAX_CONSECUTIVE_OUTBOUND = 5` Nova messages since the last inbound
   ⇒ 409 `LOOP_GUARD`, surfaced as a receipted blocked action — never a silent drop.
5. Nova's send path uses its **own** rate bucket — 30/min/tenant, a separate limiter instance from
   the merchant's `/meta/send-message` budget (meta.js:716-725) — so Nova neither starves the
   founder's sends nor hides behind their limit.

Page-to-page loops (two Dakio tenants messaging each other, recon bite #1) are bounded by layers
4–5 even though each side sees the other as a customer.

### D7. Idempotency & races, end to end

| Seam | Mechanism |
|---|---|
| Meta duplicate delivery | `InboxMessage.metaMid @unique`, insert-first; duplicate ⇒ no row, no conversation bump, no event |
| Event double-emit | `NovaInbox.dedupeKey = message.received:<messageId>`, P2002 swallowed (novaEvents.js:68-74) |
| Delivery double-POST | channel 409 on busy continuation; events stay unprocessed and re-coalesce |
| Executor/route retry | `w()` Idempotency-Key replay via `NovaIdempotency` on all `/api/v1/inbox` writes (key = novaActionId or eve step id) — module 02 implements; the contract is binding from day one |
| Graph send crash window | `InboxOutbound` conditional claim `queued→sending`; stale `sending` rows swept to `failed`, never auto-resent (D4) |
| Founder takeover mid-turn | reply route checks `novaLockedAt` at execute time ⇒ 409 `LOCKED`; queued outbounds canceled `founder_takeover`; blocked ledger row |
| New inbound vs queued send | D2 step 3 cancels `queued` rows in the ingest transaction (`new_inbound`) |
| Drain lane vs live lane | `inbox_reply` dedupeKey per conversation+bucket; job handler re-reads unprocessed events — already-processed ⇒ no-op |
| Echo vs our own insert | 2s delayed re-check before classifying an unstamped echo as external (D8) |

### D8. Echo classification + Send-API metadata stamping (founder-takeover substrate, req #23)

BD merchants answer from the Meta Business Suite app constantly; today those replies are invisible
(recon bite #2) — the thread lock would have a hole the size of every founder's phone. v1:

1. **Stamp every Dakio-originated send** with Graph `message.metadata`:
   `dakio:nova:<novaActionId>` · `dakio:founder:<userId>` · `dakio:system:<novaActionId>`
   (the graphBody at meta.js:750 gains `metadata`; module 02's `inboxSender.js` inherits it).
   Echo webhooks deliver the stamp back.
2. **Subscribe `message_echoes`**: `connect-page` (meta.js:267-291) and `/resubscribe`
   (meta.js:360-388) both move to `subscribed_fields=messages,messaging_postbacks,message_reads,message_echoes`.
3. **Classify echoes** (replacing the blanket `senderId===selfId` drop for echo events):
   - Echo **with** a `dakio:*` stamp → our own send; skip; reconcile the DB row's `metaMid` if
     null.
   - Echo **without** a stamp → check `metaMid` against `InboxMessage` with **one delayed
     re-check (~2s)** to absorb the send-then-insert race (our insert at meta.js:773 happens
     after the Graph call returns; the echo can beat it).
   - Still unknown → **out-of-band human send**: insert
     `InboxMessage {direction:'out', actor:'founder_external', metaMid, text}` and apply the full
     takeover in the same transaction: `handledBy:'founder'`, `novaLockedAt: now`, cancel queued
     `InboxOutbound` (`founder_takeover`), emit `NovaInbox` `conversation.taken_over`
     (dedupeKey `taken_over:<convId>:<messageId>`), emit SSE `conversation.taken_over`.
4. Non-echo self-sends (`senderId===selfId` without `is_echo`) keep the existing drop.

This makes takeover detection complete across all three reply surfaces: Dakio inbox (module 08's
implicit takeover on `/meta/send-message`), tap-send (executor lock re-check), and the founder's
phone (here).

### D9. Multi-tenant auth, both directions + tenant provisioning

- **dakio-api → nova-ai**: the shared secret `NOVA_INBOX_SHARED_SECRET` authenticates *dakio-api
  itself* (HMAC over raw body + ±5 min timestamp). Tenancy then comes from the body's `storeId` —
  legitimate because dakio-api is the authoritative tenancy system and the channel mints the
  principal server-side after authenticating the caller (recon-eve Option A shape). The channel
  never accepts founder JWTs. nova-ai's `tenant-guard` pinning + kill switch apply unchanged: a
  paused tenant's turns are refused, events stay unprocessed, the conversation stays
  `handledBy:null`, and the merchant inbox works exactly as today.
- **nova-ai → dakio-api**: unchanged per-tenant service tokens (`NOVA_SERVICE_TOKENS`),
  `authenticateNovaService + requireTenant` on every route; the client never sends storeId. No
  fleet credential exists anywhere. This module establishes the `/api/v1/inbox` router itself —
  `src/routes/novaInbox.js` creates the router, attaches the service-auth middleware, and mounts
  it, and `src/lib/novaIdempotency.js` provides the `w()` idempotency wrapper — so modules 02+
  only add route handlers to an existing, already-authenticated surface.
- **Provisioning prerequisite (ops task, gate checklist item):** every pilot tenant must exist in
  nova-ai's production tenant registry (`nova_tenants`) BEFORE enabling the pipe, or
  `tenant-guard` silently refuses every customer turn — the classic "Nova sees nothing and nobody
  knows why" failure.

### D10. Meta data-deletion path extensions (compliance boundary)

`POST /data-deletion` (meta.js:866-887) hard-deletes conversations+messages cross-tenant by
senderId. This module extends the same handler:

1. `InboxOutbound` — covered by `onDelete: Cascade` from InboxConversation; **verified by test**,
   not assumed.
2. Delete `CustomerChannel` rows where `kind IN ('messenger','instagram') AND address LIKE
   '%:' || senderId` (the page-scoped address suffix, D11 — the statement ships now and matches
   zero rows until module 03 writes the first spokes).
3. Delete `NovaMemory` rows with namespace `customers` and key prefix
   `customer.psid.<platform>.<senderId>` (pre-link notes ARE Meta-derived data).
   The handler also nulls `CustomerJourney.conversationId` and strips the senderId's conversation
   ids from `CustomerJourney.stageData.linkedConversationIds` (per module 04's migration notes).
4. Release open `NovaPromise` rows whose `conversationId` matches a deleted conversation:
   `status:'released', releasedReason:'meta_deletion'` (if `customerId` is set and an sms channel
   exists, module 03's fulfillment ladder re-routes instead). **Sequencing:** this statement is
   specified here verbatim but can only compile after module 03's migration creates `NovaPromise`;
   it lands commented with a `// ENABLE-WITH-03` marker and module 03's gate checks it is live.
5. **The compliance boundary comment** goes in the handler: what survives, deliberately — the
   `Customer` row, orders, `customer.<customerId>.*` memory, sms/email channels. These are Dakio
   commerce records keyed by phone, created by the customer's own orders — not Meta data.
   `Order.sourceConversationId`, `NovaCase.conversationId`, `NovaPromise.conversationId` are plain
   strings (no FK) precisely so commerce records survive this hard delete.

### D11. Channel abstraction — one substrate, reserved slots (req #20)

A channel is three things; adding one touches exactly these seams and nothing above them:

1. **A `CustomerChannel.kind` + address format** (identity spoke; formats codified as doc-comments
   on the model in this module's migration — zero schema change, first writers in module 03):

| kind | address format | window/consent rule (per-adapter data, not global logic) |
|---|---|---|
| `messenger` | `messenger:<pageId>:<psid>` | Meta 24h window from last inbound; page-scoped — a page switch mints new PSIDs so old rows never match again, no cross-page identity reuse |
| `instagram` | `instagram:<igAccountId>:<igsid>` | same 24h rule, same page-scoping |
| `sms` | normalized `01XXXXXXXXX` (`normalizePhone`) | consent tier gate; **backfill fix**: novaReach backfill must normalize before writing (today it copies raw checkout phones) |
| `email` | lowercased email | existing consent rules |
| `whatsapp` | E.164 `+8801XXXXXXXXX` | **reserved** — WA BSP choice pending; its own 24h+template rules when it lands |
| `webchat` | `webchat:<siteVisitorId>` | **reserved** — storefront widget; can be born pre-linked via storefront OTP |
| `voice` | E.164 | **reserved** slot only |

2. **A transport adapter** behind the same `InboxOutbound` shape — the sender dispatches on
   conversation platform / promise channelKind; each adapter owns its own window rule.
3. **A conversation surface** — new channels create `InboxConversation` rows with a new
   `platform` value; linking, 360, promises, memory are keyed above the channel and need zero
   change.

Consent from a DM link is always `'transactional'`; marketing consent is never inferred from a DM.
No UI ever claims a channel that cannot send (Grow Broadcast precedent).

### D12. Drain extension points + event registry

`drainEventsToJobs` (novaJobs.js:134-185) today handles only `cart.abandoned`. This module
restructures it into a small per-eventType handler registry so later modules add branches without
touching each other:

- `message.received` → `inbox_reply` fallback job (this module, D5).
- **Every drained event** additionally calls `advanceJourney(tx, tenantId, event)` inside the same
  transaction before `processedAt` is stamped (call site wired here; reducer logic is module 04's
  `src/lib/novaJourney.js`, stubbed as a no-op until it lands). The model is never invoked here —
  the reducer is plain code.
- `case.updated` → `case_update` job branch (seam registered here; handler is module 06's).

Event registry this module establishes (canonical §2.7 — producers land with their owner modules):

| eventType | dedupeKey | Producer (module) |
|---|---|---|
| `message.received` | `message.received:<inboxMessageId>` | webhook ingest, customer-actor rows only (01) |
| `conversation.taken_over` | `taken_over:<convId>:<messageId>` | founder send / echo classification (01/08) |
| `conversation.handed_back` | `handed_back:<convId>:<ISO>` | release route (08) |
| `order.confirmed` | `order.confirmed:<orderId>` | confirm writeback (06) |
| `channel.opted_out` | `opted_out:<channelId>` | novaReach opt-out (04) |
| `case.updated` | `case.updated:<caseId>:<source>:<key>` | courier webhook / founder action / job (06) |
| `payment.claim_rejected` | `claim_rejected:<actionId>` | decision reject executor (05) |
| `order.item_unfulfillable` | `unfulfillable:<orderId>:<itemId>` | ops/merchant hook (06) |

Existing `order.created` / `order.updated` / `cart.abandoned` are unchanged. Payloads are minimal
ids everywhere — content never rides the bus.

`inbox_reply` joins `JOB_KINDS` with priority **1** (the reserved fast-lane band, novaJobs.js:41-53
— this module is the claimant that comment anticipated), `cadence:'event'`, per-tenant dedupeKey
`inbox_reply:<conversationId>:<30min-bucket>`.

### D13. Latency budget for the pipe + alarms

| Step | P50 | P95 |
|---|---|---|
| Meta webhook → InboxMessage committed | 0.15s | 0.5s |
| Coalesce debounce | 5s | 5s (fixed) |
| Delivery POST + channel dispatch | 0.3s | 1s |
| **Pipe total: inbound → turn dispatched** | **~5.5s** | **~6.5s** |
| Fallback lane (nova-ai down) | +≤60s | +~90s |

Downstream (model turn, human-timing, Graph send) belongs to module 02's budget; end-to-end
targets: inbound → `typing_on` ~5.5s P50, inbound → reply delivered ~13–18s P50 (Haiku). OTel
alarms (Phase-15 pattern): **P95 inbound→typing > 10s**, **P95 inbound→delivered > 90s**, plus
pipe-owned gauges: unprocessed-event age is a two-level alarm on the single metric key
`inbox.events.unprocessed_age` — warn at 120s, page at 5 min (consistent with module 12 §5) —
plus `InboxOutbound` `sending`-claim
sweep count > 0/hour, delivery-POST failure ratio > 10%/15min.

---

## Data model

New model (this module's migration `nova_front_office_01_pipe`):

```prisma
model InboxOutbound {
  id              String    @id @default(cuid())
  tenantId        String
  conversationId  String
  conversation    InboxConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  novaActionId    String?   // null when actor='founder'
  actor           String    // 'nova' | 'founder' | 'system'
  chunks          Json      // [{text: "..."}] — 1-3 human-sized bubbles (canonical C-12: array, no divider)
  status          String    @default("queued") // queued|sending|sent|partial|failed|canceled
  cancelReason    String?   // 'new_inbound' | 'founder_takeover' | 'window_closed' | 'manual'
  scheduledAt     DateTime  // when chunk 1 should go out (human-timing computed by module 02)
  sentAt          DateTime?
  attempts        Int       @default(0)
  lastError       String?
  metaMids        Json?     // Graph message_ids per chunk — echo reconciliation (D8)
  createdAt       DateTime  @default(now())

  @@index([tenantId, status, scheduledAt])
  @@index([conversationId, status])
}
```

Changed models — added fields only:

```prisma
model InboxMessage {
  // ...existing fields (schema.prisma:1329-1342) unchanged...
  actor          String?   // NEW 'customer' | 'nova' | 'founder' | 'founder_external' | 'system'
  novaActionId   String?   // NEW ledger receipt link (indexed by module 09)
  metaTimestamp  DateTime? // NEW Meta event timestamp — ordering truth; sentAt stays insert time
  attachmentType String?   // NEW 'image'|'audio'|'video'|'file'|'share'|'sticker' (first attachment)
  purpose        String?   // NEW outbound rows: reply purpose/intent slug (canonical §2.6)
}

model InboxConversation {
  // ...existing fields (schema.prisma:1310-1327) unchanged...
  customerId           String?   // NEW FK -> Customer (provenance columns land in module 03)
  customer             Customer? @relation(fields: [customerId], references: [id], onDelete: SetNull)
  handledBy            String?   // NEW 'nova' | 'founder' | null
  novaLockedAt         DateTime? // NEW set ONLY by human takeover; Nova can never clear it
  lastIntent           String?   // NEW canonical intent slug (closed set, canonical §2.6)
  escalatedAt          DateTime? // NEW (escalation machinery: module 08)
  escalationDecisionId String?   // NEW NovaDecision backing a handover
  lastInboundAt        DateTime? // NEW last actor:'customer' message time
  windowExpiresAt      DateTime? // NEW lastInboundAt + 24h — Meta messaging window
  novaEnabled          Boolean   @default(true) // NEW per-thread founder switch, server-enforced
  outbounds            InboxOutbound[]

  @@index([tenantId, handledBy])
}
```

Migration notes:
- **Actor backfill** (data migration in the same step, truthful because Nova has never sent):
  `direction:'in'` → `actor:'customer'`; `direction:'out'` → `actor:'founder'`.
- All columns additive + nullable (or defaulted) — no destructive change, no downtime.
- **`novaState` is NOT a column** — it is derived server-side in merchant API responses (module
  10). Do not add it here.
- Cascade behavior: `InboxOutbound` dies with its conversation (Meta hard-delete compliant, D10);
  `customerId` is `SetNull` on Customer delete and nullable forever — the identity join is earned,
  never guessed.
- Later migrations extend `InboxConversation` per owner module (03 identity provenance, 08
  handover/SLA, 11 assessment) — this module must not pre-create those columns.

---

## APIs & interfaces

**dakio-api — changed behavior, no new public routes:**

- `POST /api/meta/webhook` — externally unchanged (signature, 200-ACK). Internally: D1/D2/D3/D8.
- `POST /api/meta/connect-page` + `POST /api/meta/resubscribe` — `subscribed_fields` gains
  `message_echoes` (and connect-page aligns with resubscribe's `message_reads`).
- `POST /api/meta/data-deletion` — D10 extensions; response contract to Meta unchanged.
- Internal library surface (consumed by later modules):
  `emitMessageReceived(tx, tenantId, conversationId, messageId, platform)` in
  `src/lib/novaEvents.js`; `scheduleDelivery(conversationId)` + boot-time
  `resumeUnprocessed()` in `src/lib/inboxDelivery.js`; drain handler registry in
  `src/routes/novaJobs.js`.

**dakio-api → nova-ai delivery contract (owned here, both sides must not drift):**

```
POST https://<nova-host>/customer/message
Headers: x-nova-signature: hex(HMAC-SHA256(rawBody, NOVA_INBOX_SHARED_SECRET))
         x-nova-timestamp: <ISO-8601>            // rejected outside ±5 minutes
Body:    { "storeId": "...", "conversationId": "...", "platform": "messenger"|"instagram",
           "messageIds": ["..."] }
→ 202 accepted (turn dispatched or queued)     → dakio-api stamps processedAt
→ 401 bad signature / stale timestamp          → never retried with same body silently; alarm
→ 409 session busy                             → events stay unprocessed, re-coalesce
→ 5xx / timeout                                → retry +10s, +30s, then dispatcher drain
```

**nova-ai (stub scope in this module):**

- `agent/channels/customer.ts` (new): route `POST /customer/message`, HMAC + timestamp
  verification, body parse, 202/401/409 semantics. Session keying contract fixed here:
  `continuationToken: 'inbox:<conversationId>'` → framework-namespaced
  `customer:inbox:<conversationId>`. Principal, instructions, tools: module 02.
- `agent/channels/internal.ts`: new branch — job kind `inbox_reply` →
  `args.receive(customerChannel, {message, target, auth})` cross-channel hand-off so the fallback
  lane rejoins the SAME session (memory preserved).

**No merchant-JWT routes change in this module** (merchant response-shape additions ride modules
08/10). No tools, no verbs — the pipe never calls the model.

**Constants / env (registry):** `NOVA_INBOX_SHARED_SECRET` (new env, both repos) ·
`COALESCE_MS = 5000` · `NOVA_MAX_CONSECUTIVE_OUTBOUND = 5` · Nova send rate bucket 30/min/tenant ·
Send-API metadata
stamps `dakio:nova:<novaActionId>` / `dakio:founder:<userId>` / `dakio:system:<novaActionId>`.

---

## Files touched

**dakio-api**
- `prisma/schema.prisma` + migration `nova_front_office_01_pipe` — InboxMessage/InboxConversation
  additions, InboxOutbound model, actor backfill, CustomerChannel address-format doc-comments.
- `src/routes/meta.js` — webhook hardening (insert-first, per-message try/catch, metaTimestamp, IG
  rawPayload, attachmentType, profile fetch off hot path, is_echo), ingest transaction (cancel
  outbounds, followup-cancel hook, journey call site, emit), echo classification + takeover,
  `message_echoes` subscription in connect-page/resubscribe, metadata stamping on the existing
  merchant send, data-deletion extensions + compliance comment.
- `src/lib/novaEvents.js` — `emitMessageReceived` + registry rows for the new event types.
- `src/lib/inboxDelivery.js` (new) — coalescer, HMAC POST, retries, processedAt stamping, boot
  resume, re-delivery ordering (urgency desc, windowExpiresAt asc, lastMessageAt asc), `mark_seen`
  sender-action fire on batch delivery (timing per module 02 D7).
- `src/routes/novaJobs.js` — `inbox_reply` job kind (priority 1), drain handler registry,
  `message.received` branch, `advanceJourney` call site (stubbed).
- `src/lib/novaJourney.js` (new, stub) — `advanceJourney` no-op export; module 04 replaces the
  body.
- `src/routes/novaInbox.js` (new) — creates the `/api/v1/inbox` router, HMAC/service-auth
  middleware, and mounts it in `src/index.js`; later modules add route handlers to it.
- `src/lib/novaIdempotency.js` (new) — the `w()` idempotency-wrapper extraction consumed by every
  inbox service route.
- `package.json` — new test files added to the test list.

**nova-ai**
- `agent/channels/customer.ts` (new) — HMAC-verified channel stub per the contract above.
- `agent/channels/internal.ts` — `inbox_reply` cross-channel receive branch.
- `.env` docs — `NOVA_INBOX_SHARED_SECRET`.
- Ops: tenant-registry provisioning for pilot stores (checklist item, not code).

**dakio-merchant** — none.

---

## Testing

dakio-api (`node --test`, files added to the package.json test list):

- `test/meta.novaEvents.test.js`
  1. Given a valid FB webhook delivery, when processed, then exactly one InboxMessage
     (`actor:'customer'`, `metaTimestamp` set) and exactly one NovaInbox row
     (`message.received:<id>`) exist.
  2. Given the same delivery replayed (same `metaMid`), when processed, then no new row, no
     `lastMessageAt` bump, no unhide, no second event.
  3. Given a batch of 3 entries where the 2nd hits P2002, when processed, then entries 1 and 3
     still land (per-message try/catch).
  4. Given `novaEnabled:false` or a not-hired tenant, when a message arrives, then the row is
     written but no event is emitted; given a founder-held thread with
     `inbox.draftWhileFounderActive:true`, the event IS emitted (suppression matrix).
- `test/meta.echo.test.js`
  5. Given an echo with `dakio:nova:<id>` metadata, when classified, then it is dropped and the
     existing row's `metaMid` reconciled; given an unstamped echo whose mid appears in
     InboxMessage within 2s, then dropped; given a still-unknown echo, then
     `actor:'founder_external'` row + `novaLockedAt` set + queued outbounds canceled
     `founder_takeover` + one `taken_over:<convId>:<messageId>` event.
- `test/inboxDelivery.test.js`
  6. Given 3 messages inside 5s, when the coalescer fires, then ONE POST carries all 3 messageIds
     with a valid HMAC/timestamp; a 2xx stamps all 3 `processedAt`.
  7. Given the POST 409s/5xxs through all retries, when `drainEventsToJobs` runs, then one
     `inbox_reply` job (priority 1, bucketed dedupeKey) exists; given the live lane processed the
     events first, then the job handler is a no-op.
  8. Given an inbound arriving while an `InboxOutbound` is `queued` and a `followup` job is
     `due`, when ingested, then in one transaction the outbound is `canceled:new_inbound` and the
     job is `skipped:cancelled:customer_replied`.
- `test/meta.deletion.test.js`
  9. Given a signed data-deletion request, when handled, then conversations, messages,
     InboxOutbound (via cascade — asserted), matching messenger/instagram CustomerChannel rows,
     and `customer.psid.*` memory rows are gone; Customer + Orders survive.

nova-ai (repo suite + isolation suite — tenancy is touched):
- Channel HMAC: bad signature ⇒ 401; stale timestamp (>5 min) ⇒ 401; busy continuation ⇒ 409.
- Isolation: a valid POST for store A can never dispatch into a session keyed to store B's
  conversation (tenant-guard + continuation namespacing).
- `internal.ts` `inbox_reply` branch re-joins `customer:inbox:<conversationId>` (same
  continuation), not a fresh `job:<id>` session.

---

## Risks & trade-offs

| Risk | Likelihood | Mitigation |
|---|---|---|
| Echo race regressing loop safety — a mis-classified own-echo triggers a takeover or (worse) an event loop | medium | Five-layer defense (D6); 2s delayed re-check; `metaMids` double-booking on InboxOutbound; echo matrix test #5 is a hard gate |
| In-process coalesce timers lost on deploy → messages answered late | high (every deploy) | Durability lives in NovaInbox rows: boot-time `resumeUnprocessed()` + dispatcher drain; worst case +60s |
| Insert-first refactor breaks a subtle existing inbox behavior (unhide, senderName backfill) | medium | Existing `test/meta.*.test.js` suites run unchanged as the regression net; upsert content is unchanged, only ordering moves |
| Pilot tenant missing from nova-ai registry ⇒ silent total refusal | medium | Provisioning is a named gate checklist item; the `inbox.events.unprocessed_age` alarm (warn 120s, page 5 min) catches it in minutes |
| Duplicate turns from live-lane/fallback overlap | low | Bucketed job dedupeKey + no-op re-read (D7); test #7 |
| Worst customer-facing failure: a stale queued send fires after the customer double-texted or the founder took over (wrong/duplicate message to a human) | low | Cancel-in-ingest-transaction (D2 step 3), claim-based at-most-once, `sending` rows never auto-resent, takeover cancels queued rows — all test-pinned |
| Single-instance delivery worker is a scaling ceiling | accepted v1 | Same posture as the SSE bus, documented; multi-replica drain is a v2 item (module 12 perf gate) |

---

## Gate

Scripted demo on a clean staging store, run by a non-builder:

1. Connect the staging Facebook page; confirm `message_echoes` appears in the page's subscribed
   fields (page-status/Graph check).
2. Send a Messenger message to the page. Within 10s, verify (read-only admin query script
   provided): one `InboxMessage {actor:'customer', metaTimestamp != null}`, one `NovaInbox`
   `message.received` row, `windowExpiresAt ≈ +24h`, and — with the stub channel running — the
   event stamped `processedAt`.
3. Replay the identical webhook body (curl script with valid signature). Verify: zero new rows,
   zero new events, `lastMessageAt` unchanged.
4. Stop nova-ai. Send another message. Verify the event drains to a `NovaJob
   {kind:'inbox_reply', priority:1}` within the dispatcher tick. Restart nova-ai; verify the job
   re-joins the same `customer:inbox:<conversationId>` continuation (log line).
5. Reply to the customer from Meta Business Suite on a phone. Within one webhook delivery, verify:
   `InboxMessage {actor:'founder_external'}`, `novaLockedAt` set, any queued `InboxOutbound`
   canceled `founder_takeover`, one `conversation.taken_over` event.
6. Fire the data-deletion callback for the test PSID. Verify deletion per test #9's checklist;
   verify the Customer row and its orders survive.
7. Measured checks: pipe P95 inbound→dispatch ≤ 6.5s over 20 messages; zero events older than
   120s at rest; the merchant inbox UI behaves exactly as before throughout.

**Rollback (no deploy):** the lane kill switch is module 12's `NOVA_INBOX_DELIVERY_DISABLED` —
events keep persisting for replay while delivery and the drain stop; on resume, events older than
30 minutes expire as `expired_by_kill`. The webhook, merchant inbox, and all pre-existing behavior
continue untouched. Per-tenant: the nova-ai tenant kill switch (registry pause) stops all turns
while events accumulate harmlessly; per-thread: `novaEnabled:false`. Echo subscription can be
reverted with `/resubscribe` minus `message_echoes` if classification misbehaves.
