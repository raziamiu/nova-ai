# Module 03 — Customer Identity & Memory: one human, one record, promises kept

**Phase:** 16 "Front Office" · **Depends on:** 01, 02 · **Feeds:** 04, 05, 06, 07, 09, 10
**Repos touched:** dakio-api | nova-ai | dakio-merchant (hand-back promise quick-picks + Decision cards only)
**Founder requirements covered:** #3 (customer memory & context), #10 (lead→customer conversion linkage), #20 (omnichannel continuity — identity layer), #24 (hand-back ingestion half), #22 (brief's identity + open-promises inputs)

This module builds the identity graph under every conversation: how an anonymous Meta PSID
becomes a linked `Customer`, exactly what Nova knows about that customer each turn (the
server-assembled customer-360 block), how commitments made in chat are ledgered and kept
(`NovaPromise`), and how durable per-customer memory is keyed, migrated, distilled, redacted,
and retired. Everything here is server-side truth: the model never resolves identity, never sees
a full phone number or street address, and never "remembers" anything that didn't pass the
redaction guard. The wrong-person link is the one unrecoverable trust failure in DM commerce —
this module's design bias everywhere is *ambiguity resolves to "unknown customer."*

---

## Already real vs to build

| Already real (recon evidence) | This module adds |
|---|---|
| `Customer` model with `@@unique([tenantId, phone])` — phone is THE per-tenant identity key (recon-identity-commerce; schema.prisma:462-482, unique at :480) | Reused unchanged as the graph's hub node; zero Customer columns added |
| Three Customer creation paths, none normalizing phone — merchant manual (customers.js:54-67), merchant order find-or-create by *exact* string (orders.js:609-642), storefront checkout (store.js:556-569); `+8801…`/`8801…`/`01…` can be three rows | `identity_merge_sweep` nightly detection + founder-gated `merge_customer_records` verb/executor; conversation linking always goes through `normalizePhone` + `phoneVariants` |
| `normalizePhone` / `phoneVariants` / `calculateCustomerRisk` (customerRisk.js:7-24, 36-45, 69-127) | Reused verbatim as the only phone-matching discipline; risk feeds the 360 `history.riskLevel` |
| `CustomerChannel` registry: `kind` incl. anticipated `messenger`, unique `[tenantId, kind, address]`, consent default `transactional`, `optedOutAt`, "Sends only ever go to rows here (verified addresses), never inferred identities" (schema.prisma:1758-1778, doc at :1760-1763) | **Zero schema change; the first writers** — link-customer route and chat-order executor upsert `messenger`/`instagram` spokes; address formats codified per module 01's table |
| `POST /channels/backfill` copies raw checkout phone into sms channel rows (novaReach.js:66-81) | Backfill fix: normalize before writing (raw variants would violate one-address-one-row) |
| **No inbox↔customer link exists** — `InboxConversation` has senderId/senderName only; "a customerId can't be resolved to a conversation" (schema.prisma:1310-1327; novaStore.js:22-24) | The whole linking protocol: provenance columns, confidence ladder, digit verification, `link_customer_identity` verb, `channel_backref` auto-link at ingest |
| `customerOut` Nova read with derived segment, ordersCount, LTV — **no phone field in output** (novaStore.js:252-296, segment fn :132-139, shape :265-278) | `customer360Out` — the far richer single-serializer block (`src/lib/customer360.js`), masked-phone projection, journeyStage, flags, open orders/complaints/promises/preferences |
| Humanized 7-step public tracking (`displayStatus`, `statusStep`, Pathao/Steadfast/RedX maps — publicTracking.js:16-90); `Order.courierStatus` kept live by courier webhooks (webhook.js:73-131) | 360 `openOrders[]` quotes these fields — Nova never invents delivery state |
| Phone-verified order lookup patterns: `GET /api/orders/track` last-10-digit match (orders.js:365-397, check :376-379); OTP account lookup with partial variant matching (store.js:1248-1326, variant gap :1304) | The digit-verification flow reuses the last-digits-compare idea, server-side, with zero-leak scripts |
| `StorefrontLead` has no Customer FK and no conversation link (schema.prisma:755-777; gap confirmed novaStore.js:402) | `StorefrontLead.conversationId String?` gap fix so cart recovery (module 05) can find its way back to the thread |
| Storefront checkout auto-converts OPEN leads by phone (store.js:876-881); merchant `POST /orders` converts by `leadId` (orders.js:969-984) | Chat orders inherit the same conversion for free; identity join on order-create is this module's HIGH-(a) ladder rung |
| Meta data-deletion handler hard-deletes conversations+messages cross-tenant by senderId (meta.js:866-887) | Executed by module 01; this module owns the graph semantics: which spokes/memory/promises die, what survives, promise release with `releasedReason:'meta_deletion'` |
| `NovaMemory` namespaces + provenance + `INJECT_LIMIT_PER_NAMESPACE = 8` cap (recon-eve-runtime; memory.ts:34) | Memory keying scheme (`customer.psid.*` → `customer.<customerId>.<facet>`), link-time migration, `remember`-tool redaction guard, `conversation_distill` job |
| Consent policy written down: transactional from checkout capture, marketing explicit, opt-out absolute (schema.prisma:1760-1763; novaReach.js:63-99) | Enforced at every new writer; DM-link consent is always `'transactional'`, marketing never inferred |
| OUT: shopper ticket system — `SupportTicket` is merchant↔Dakio-admin only (schema.prisma:1223-1259; novaStore.js:20-21). Complaint state rides `InboxConversation` columns + escalation Decisions (module 08) and `NovaCase` (module 06), never a new ticket model | — |
| OUT: cross-tenant identity resolution — the same human at two Dakio merchants is two unrelated Customers by design (each merchant's relationship is their own asset). No data source, no plan | — |

---

## Objective

After this module ships, a returning customer is *recognized*: the moment a conversation links
(order created in-thread, self-stated phone, verified digits, channel back-reference, or founder
manual link), Nova's next turn carries that customer's real history — orders with live courier
state, LTV, risk level, open promises, distilled preferences — assembled server-side inside a
~530-token block, with full phone and street address structurally absent. Every committing reply
("কাল জানাবো") creates a `NovaPromise` row that is swept nightly and either kept by a real send,
broken visibly with a founder Decision, or released with a reason. The founder can watch
`inbox.promise.kept_rate` and `inbox.identity.linked` move as real ledger counters.

## Scope

**In:** identity provenance + propose/confirm columns on `InboxConversation`; the confidence
ladder and digit-verification flow; `POST /link-customer` (+verify) and the first
`CustomerChannel` messenger/instagram writers; `StorefrontLead.conversationId` gap fix; late-merge
detection (`identity_merge_sweep`) + `merge_customer_records` verb/executor; `customer360Out`
serializer (`src/lib/customer360.js`) inside `GET /api/v1/inbox/conversations/:id`; `NovaPromise`
model + self-declared promises on the reply payload + instruction rule 16 + undeclared-promise CI
gate + founder-promise quick-picks at hand-back; promise fulfillment via the unified `followup`
job (`payload.promiseId`), `promise_sweep`, and the window-collision ladder; memory keying +
link-time migration + `conversation_distill` (P2); redaction boundary, `remember` write-guard
regexes, retention policy; identity/promise/memory metric registry rows.

**Out (with owner):** journey stage computation — module 04 owns `CustomerJourney`; this module
only *carries* `journeyStage` in the 360 block. Order creation and the auto-link it triggers —
module 05 (the executor calls this module's link path). Handover state machine and the brief that
embeds open promises — module 08 (this module supplies the promise rows and the quick-pick
capture UI spec). Achievement/scorecard rendering — module 09 (this module emits the counters).
Merchant duplicate-review UI, customer-profile drawer, founder-promise NLP extraction,
distill-quality eval, WhatsApp/webchat adapters — v2+ (module 12 tracks). Cross-tenant identity —
never.

---

## Design

### D1. The graph: three layers, three lifetimes

```
                    Customer  (tenant+phone unique — the ONLY identity anchor;
                   /    |    \       materializes via orders, never via chat alone)
                  /     |     \
     CustomerChannel  Order[]   NovaMemory 'customers' rows
     (spokes, EXISTS: (LTV, RTO  key customer.<customerId>.<facet>
      messenger | ig | history)      + NovaPromise (NEW — commitments ledger,
      sms | email;                     customerId? FK SetNull,
      whatsapp/webchat/voice           conversationId plain string)
      reserved)
          |
   InboxConversation.customerId   (fast-read FK, nullable forever, SetNull)
          |
   eve session customer:inbox:<conversationId>   (reasoning cache, NOT truth)
```

1. **Thread layer** — `InboxConversation` + the eve session: one channel, one thread, days–weeks.
2. **Identity layer** — `Customer` + `CustomerChannel`: forever (commerce records).
3. **Memory layer** — `NovaMemory customers` + `NovaPromise`: distilled knowledge + open debts.

A channel row is a *claim route* to a Customer; history, memory, and promises hang off the
Customer node. New channels (WhatsApp, web chat, voice) plug in as new spokes — nothing above the
spoke changes. Cold-start invariant (shared with module 02): the eve session is a cache, never
the only copy of anything; session loss costs reasoning nuance, never facts.

### D2. The confidence ladder — who may write `customerId`

| Tier | Trigger | Action | Written by |
|---|---|---|---|
| **HIGH (a)** | Order created in this thread (`create_order_from_chat` executor succeeded — module 05) | Link immediately: `customerId`, `customerLinkSource:'order_created'`, upsert `CustomerChannel{kind, address, customerId, consent:'transactional'}` | order executor, server-side |
| **HIGH (b)** | Customer states a phone **as their own, first person** ("amar number 01712…", giving it for delivery) and `normalizePhone` + `phoneVariants` match exactly ONE Customer | `link_customer_identity` verb → `POST /link-customer` → `customerLinkSource:'phone_stated'` + CustomerChannel upsert | Nova tool, autonomy-gated (low risk, auto at all tiers — bookkeeping-verb carve-out, 08 SS8) |
| **HIGH (c)** | A `CustomerChannel` row with this exact `kind+address` already carries a `customerId` (returning customer, new thread) | Link during conversation upsert at ingest: `customerLinkSource:'channel_backref'` — zero model involvement | webhook path (module 01's `handleMessage`, one indexed lookup) |
| **HIGH (d)** | Founder links manually from the merchant UI (v1: via existing conversation PATCH; drawer UI is v2) | `customerLinkSource:'founder_manual'` | merchant JWT route |
| **MEDIUM — propose, confirm** | senderName ≈ Customer.name (normalized) PLUS one context signal: an order number that exists for that customer, matching city/district, or a product that customer bought | Set `proposedCustomerId` + `proposedBasis` (`'name_match'`\|`'order_ref'`\|`'context'`). Nova asks ONE verification question (D3). Pass → link with `'digits_verified'`. Fail → clear proposal, never re-propose that candidate in this conversation | `PATCH /conversations/:id` (proposing is bookkeeping, not a verb — it touches zero customer data) |
| **NEVER** | Name alone; avatar; writing style; "I'm Rahim's brother"; a phone stated about a third party ("order ta amar bhai er nam e"); `phoneVariants` matching >1 Customer | No link, no proposal. Third-party orders attach the third party's Customer to the ORDER, not to the conversation identity. Multi-match → merge Decision (D5), conversation stays unlinked until resolved | — |

**Proposal grants zero access.** `proposedCustomerId` is deliberately a separate column that the
360 serializer never reads — it only licenses one verification question. It dies with the
conversation row (no FK; cleared on link or mismatch). The never-guess rule is the Stage-6
principle verbatim: sends only ever go to verified addresses, never inferred identities
(schema.prisma:1760-1763). A wrong link leaks order history to a stranger — hence *ambiguity
always resolves to "unknown customer."*

`claimedPhone` holds a normalized in-thread phone that matched **zero** Customers: the join
materializes later when a chat order creates the Customer (module 05 seeds find-or-create with
it), and cart-recovery matching (module 05) uses it meanwhile.

### D3. Digit verification — server compares, model never sees

The check: customer supplies the last 2–4 digits of the phone on the candidate's record; the
**server** compares (`POST /link-customer` body `{verify:{customerId, lastDigits}}`) and returns
matched/not. The model holds only `maskedPhone` (`017••••••89`) — it cannot leak what it does not
have. Approved question shapes (script-mirrored per module 02's register rules):

- bn: "আপনার আগের অর্ডারটা দেখে নিচ্ছি — যে নাম্বার দিয়ে অর্ডার করেছিলেন তার শেষ ২টা ডিজিট বলবেন?"
  (apnar ager order-ta dekhe nichchi — je number diye order korechilen tar shesh 2-ta digit bolben?)
- banglish: "apnar ager order ta dekhte pari — je number diye order korechilen tar sesh 2 ta digit bolen to 🙂"
- en: "let me pull up your last order — what are the last 2 digits of the number you ordered with?"

Rules: max ONE verification attempt per candidate per conversation. A failed check is answered
warmly with **zero leakage** — "আচ্ছা, তাহলে নতুন করে একটু ডিটেইলস নেই 🙂" (achha, tahole notun
kore ektu details nei) — never "wrong, that customer's number ends differently." A customer who
declines to verify proceeds as new: **service is never gated on identity**; only history access is.

### D4. The link write path — route, tool, channel spokes, lead fix

`POST /api/v1/inbox/conversations/:id/link-customer` (service auth, `w()`-idempotent, key =
`novaActionId`). Two bodies:

- `{phone}` — normalize via `normalizePhone`, match via `phoneVariants` `in` query. Exactly one
  match → **link only, never create** (Customers materialize via orders — recon-identity: no
  direct lead→Customer path exists, and chat must not invent one). Zero matches → store
  `claimedPhone`, return `{matched:false}`. Multiple matches → return `{matched:false,
  mergeProposed:true}` and enqueue the merge Decision (D5).
- `{verify:{customerId, lastDigits}}` — compare against the candidate's stored phone (normalized,
  suffix match); pass → link with `'digits_verified'`; fail → clear
  `proposedCustomerId/proposedBasis`, increment `inbox.identity.verify_fail`.

On every successful link, one transaction: set `customerId`, `customerLinkedAt`,
`customerLinkSource`, clear proposal columns; upsert the platform spoke
`CustomerChannel{kind:'messenger'|'instagram', address:'messenger:<pageId>:<psid>'|'instagram:<igAccountId>:<igsid>',
customerId, consent:'transactional'}` (unique `[tenantId, kind, address]` makes the upsert
idempotent); migrate psid-keyed memory (D8); stamp `StorefrontLead.conversationId` on any OPEN
lead matching the phone (the CAP-08 gap fix — module 05's recovery lane needs the way back to the
thread); re-key the journey (module 04's reducer is called with the new phone — its merge rule,
not ours). Consent from a DM link is **always `'transactional'`**; marketing consent is a
separate explicit ask owned by the conversation flow and written via the existing consent-grant
pattern (novaReach.js:93-99), never inferred.

The nova-ai tool `link_customer` maps to verb `link_customer_identity` (risk low, MINUTES 2,
undoable via `unlink`, department support, auto at all tiers (bookkeeping-verb carve-out,
08 SS8) — deterministic, self-asserted, reversible). The undo path clears `customerId/customerLinkedAt/customerLinkSource` but leaves the
CustomerChannel row (it is factually true; removing it would forget a verified address).

### D5. Same human across FB + IG + phone; late merges

Cross-platform unification is **v1** and falls out of the graph with no merge machinery: the
Messenger thread links via phone → Customer C; later the IG thread captures the same phone →
links to the same C; the sms spoke from checkout backfill already points at C. One Customer,
three spokes, two conversations both carrying `customerId = C.id`; the 360 block is keyed on
`customerId`, so both threads see identical history from the moment of linking. Pre-link, FB and
IG are honestly two people (PSID and IGSID are different id spaces — inference across them is
killed permanently). Only the merchant-facing merge-review UI stays v2.

**Late merge — two Customer rows, one person.** Cause: all three Customer creation paths store
phone un-normalized, so formatting variants (or two real numbers) can mint duplicates.

- **Detection:** (a) at link time, `phoneVariants` matching >1 Customer; (b) nightly
  `identity_merge_sweep` NovaJob (priority 6, dedupeKey `merge_sweep:<tenantId>:<date>`) scanning
  for variant-colliding rows. Both emit `inbox.identity.merge_detected`.
- **Decision, not auto-merge:** merging rewires financial records — always a founder Decision,
  authored through the action pipeline as verb **`merge_customer_records`** (risk **high** ⇒
  always drafts; MINUTES 5; department support; not undoable — hence high). Card copy: "Two
  customer records look like the same person: Rahim (0171…, 4 orders) and Rahim Ahmed (+88171…,
  1 order). Merge?"
- **Executor** (`EXECUTORS.merge_customer_records`, one transaction): survivor = row with more
  orders (tie → older). Reassign `Order.customerId`, `CustomerChannel.customerId`,
  `InboxConversation.customerId`, `CustomerTagMap`; merge NovaMemory `customer.<loser>.*` into
  `customer.<survivor>.*` (append, dedupe, keep provenance); repoint `NovaPromise.customerId`;
  store the loser's phone as an extra `CustomerChannel{kind:'sms', address:<normalized loser
  phone>}` spoke so that number still resolves; delete the loser row. `@@unique([tenantId,
  phone])` guarantees no new dupes. The action's receipt IS the merge audit trail.

Open founder question (module 12 consolidates): whether *provable* pure-formatting dupes (same
normalized phone) may auto-merge, reserving the Decision for genuinely different numbers.

### D6. Customer-360 block — one server-side serializer

**The single source of customer truth is `src/lib/customer360.js`, assembled in dakio-api inside
`GET /api/v1/inbox/conversations/:id`.** Eve-side memory recall is NOT used for customer facts
(explicit override, canonical C-17): the `INJECT_LIMIT_PER_NAMESPACE = 8` cap makes
whole-namespace injection both insufficient and privacy-hostile (it would spray other customers'
notes into every session), and every fact must be DB-true at turn time — courier status changes
hourly via webhooks. The serializer itself reads the relevant `NovaMemory` rows and ships them
inside the block. One assembly point = one redaction point (D9). Eve's role stays: transcript
continuity + `remember`-tool *writes*.

Exact shape (rendered by the `get_conversation` tool as a **trusted-framed section outside the
`untrusted()` transcript wrapper** — server-authored, not customer text):

```js
customer360Out = {
  identity: {
    customerId, name,
    callName,             // observed preferred address ("bhaiya-caller") — from memory
    maskedPhone,          // '017••••••89' — full phone NEVER in model context
    linkSource,           // customerLinkSource — Nova knows HOW sure the link is
    channels: [{kind, verified: true}],   // spokes list, addresses omitted
  },
  profile: {
    languagePref,         // 'bn'|'banglish'|'en'|null — last distilled; L-TURN mirror still wins
    addressForm,          // 'apni'|'tumi'|null — observed
    city, district,       // from Customer row (area level only)
    hasAddressOnFile,     // boolean — the street address NEVER enters context;
  },                      //   at order time the customer restates or confirms
  history: {
    ordersCount, deliveredCount, rtoCount, cancelledCount,
    lifetimeValue,        // ৳ delivered-basis (honest LTV, matches revenue discipline)
    avgOrderValue, lastOrderAt,
    riskLevel,            // NEW|RISK|POSITIVE|MEDIUM from calculateCustomerRisk
  },
  openOrders: [ // status ∉ terminal, max 3, newest first
    { orderNumber, status, displayStatus, statusStep,   // humanized 7-step map — what Nova QUOTES
      courierProvider, codAmount, courierSentAt, trackingCode }
  ],
  openComplaints: [ // max 3: unresolved complaint-intent threads + open escalations
    { topic, openedAt, status }   // 'nova_handling'|'with_founder'|'resolved_recent'
  ],
  promises: [ // NovaPromise status='open' for this customer, max 5, soonest dueAt first
    { id, text, kind, dueAt, madeBy }    // Nova sees its own and the founder's word
  ],
  preferences: [ // NovaMemory 'customers' keys customer.<customerId>.*, ≤5 lines ≤120 chars
    "always COD, delivery to Chattogram office address",
    "asked twice about XL restock — size XL",
  ],
  journeyStage,           // CustomerJourney.stage verbatim: stranger|inquirer|qualified_lead|
                          //   negotiating|ordered|confirmed|in_delivery|delivered|retained|
                          //   repeat_buyer|at_risk|dormant|won_back|lost — computed by module 04;
                          //   this field is its delivery vehicle (canonical C-26)
  flags: [                // deterministic, server-computed — never model-guessed
    'rto_history',            // rtoCount >= 1
    'high_value',             // LTV OR live cart/quote total >= inbox.highValueMinor
                              //   (default 500000 minor = Tk 5,000) — same key, same predicate
                              //   as module 11
    'payment_claim_pending',  // open verify_payment_slip action exists
    'recent_complaint',       // complaint intent within 14d
    'repeat_window',          // reorder window open (module 04 computes)
    'broken_promise_recent',  // NovaPromise broken within 7d — acknowledge, don't sell
  ],
}
```

Unlinked conversation → `customer: null` plus `proposal: {basis} | null` (basis only — no
candidate data). Token budget, serializer-enforced: identity+profile+history ~120, openOrders
~90, openComplaints ~45, promises ~100, preferences ~150, journeyStage+flags ~25 — **hard cap
~530 tokens**, JSON minified. Assembly: Customer row + `calculateCustomerRisk` + three indexed
queries (open orders by customerId; open promises via `[tenantId, customerId, status]`; memory
keys by `[tenantId, namespace]` + prefix). Target ≤80ms added to the conversation read, measured
as `inbox.c360.assembly_ms`.

### D7. Promises — the commitments ledger

"কুরিয়ারের সাথে কথা বলে কাল জানাবো" (courier-er shathe kotha bole kal janabo) is a debt. Pages
that ghost after "janachchi" are why BD customers screenshot conversations; Nova's kept-rate is a
headline honesty metric. Storage is a **new model, not NovaMemory**: memory stores what Nova
*believes* (key-value, weights, embeddings); `NovaPromise` stores what Nova *owes* (status
transitions, due-time sweeps, job linkage).

**Extraction is self-declared at send time, not NLP-mined.** The `reply_in_thread` tool payload
gains an optional field:

```ts
promise?: { text: string, kind: PromiseKind, dueAtISO: string }
```

Instruction hard rule — **rule 16** in `50-customer-inbox.ts` (numbering per canonical C-18;
rule 15 is READ FIRST, owned by module 11; rule 17 is D10's reference-facts rule):

> **PROMISES ARE DEBTS.** Any reply that commits to a future action or answer — "check kore
> janachchi", "kal janabo", "courier er sathe kotha bolchi", "stock asle inform korbo",
> "কাল সকালে আপডেট দেবো", "I'll confirm by tomorrow" — MUST carry the promise field with a
> realistic dueAt. Never promise a time you cannot meet: no tool path to the answer → do not
> name a time, escalate instead. One open promise per topic — check the 360 block's promises
> before making a new one.

CI hard gate (module 12 runs it; this module ships the corpus): regex over outbound reply text —
`janachchi|janabo|janiye dibo|inform korbo|update d(e|i)bo|confirm kor(bo|chi)|khoj nichchi|dekhe
bolchi|kotha bole (bolchi|janabo)|জানাচ্ছি|জানাবো|জানিয়ে দেবো|আপডেট দেবো|খোঁজ নিচ্ছি|i('|)ll
(check|confirm|get back|let you know)|will update you` — any match without a declared `promise`
field fails the build (same class as the fact-grounding gate).

Server-side (`POST /reply` handler, module 02's route — the seam is specified here): promise
present → create the `NovaPromise` row in the same transaction as `InboxOutbound`, stamp
`sourceMessageId` when chunk 1 sends, enqueue the fulfillment job. If the send is canceled
(`new_inbound` / `founder_takeover` / `window_closed` / `manual`), the co-created promise row is
deleted with it — **an unsent promise was never made**.

**Founder promises (req #24).** On `POST /meta/conversations/:id/release` (merchant JWT, module
08's route), the hand-back sheet asks "Did you promise the customer anything?" with quick-picks —
refund by DATE / replacement / callback / restock notify / none — creating
`NovaPromise{madeBy:'founder'}`. Nova then executes the founder's word, the strongest continuity
signal: "ওনার বলেছেন কাল রিফান্ড হবে — প্রসেস হয়ে গেছে 🙂" (owner bolechen kal refund hobe —
process hoye geche). v2: NLP extraction over founder-typed messages with one-tap confirm.

### D8. Promise fulfillment — jobs, transitions, the window ladder

On promise creation: NovaJob kind **`followup`** (the ONE unified kind, priority 3 — canonical
C-15; `promise_follow_up` does not exist), `payload.promiseId`, `runAt = dueAt − 30min`,
dedupeKey `followup:<conversationId>:<dueAtISO>`. The job re-joins the SAME conversation session
via the dispatcher's cross-channel receive (module 01's fallback-lane mechanics), so the
fulfillment turn carries full thread memory. Job prompt frame: "Open promise to {name}: '{text}'
(due {dueAt}). Fulfill it: gather the answer with tools, then reply in-thread if the window
allows; otherwise follow the collision ladder." Module 04's single cancel-on-inbound hook covers
promise-backed follow-ups identically to NBA follow-ups (the customer coming back first
supersedes the scheduled nudge; the promise itself stays open until answered).

Status transitions:

- **kept** — the fulfillment reply's executor calls `PATCH /api/v1/inbox/promises/:id
  {status:'kept', keptActionId}` (service auth, `w()`-idempotent). Only an actually-sent (or
  founder-approved-and-sent) message keeps a promise; a draft sitting unapproved keeps nothing.
- **broken** — nightly `promise_sweep` (priority 6, dedupeKey `promise_sweep:<tenantId>:<date>`)
  marks `open` rows past `dueAt + graceHours` (default 12h) as broken → emits a recovery
  Decision: "Promise to Rahim broken ('courier check by yesterday') — send apology + answer
  now?" Recovery is founder-visible, never silent; `broken_promise_recent` enters the 360 flags
  and the register rules require acknowledging before selling.
- **released** — customer resolved it themselves ("থাক, লাগবে না" / thak, lagbe na), order
  cancelled, founder released, or Meta deletion. Always via `PATCH` with `releasedReason`; never
  silent.

**24h-window collision ladder** (evaluated at fire time — fire-time re-check is mandatory,
canonical C-28; scheduling never extends Meta's window):

1. Window open → reply in-thread.
2. Window closed → prepared-blocked ledger row (`skipped_window`-class honesty, never silent) +
   Decision to the founder; the promise stays `open`. v1 has no merchant-to-customer sms sender
   (`src/lib/sms.js` is OTP-only; broadcasts are prepared and held, never sent —
   novaStore.js:767), so there is no out-of-window delivery route. The customer's next inbound
   re-opens the window, at which point the queued answer sends FIRST, before anything else:
   "আপনার জন্য খবরটা নিয়ে রেখেছিলাম — স্টক চলে এসেছে 🙂" (apnar jonno khobor-ta niye
   rekhechilam — stock chole esheche).

Instruction corollary: when Nova cannot guarantee a delivery route, it promises the *action*,
not the *notification time* ("খোঁজ নিচ্ছি" / khoj nichchi — not "kal 10-tay janabo").

### D9. Memory keying, migration, distillation

Keying (canonical §2.16 — dot-keys, dual scheme from day one):

- **Pre-link:** `customer.psid.<platform>.<senderId>` — Meta-derived, deleted by the data-
  deletion path.
- **Post-link:** `customer.<customerId>.<facet>`, facet ∈ `prefs | sizes | tone | complaints |
  notes` — ≤5 keys per customer, one line each ≤120 chars (the 360 `preferences` cap).
- **At link time** the link executor migrates: read psid keys, merge into customerId keys
  (`source:'nova'`, provenance `{actionIds:[linkActionId]}` — the existing NovaMemory provenance
  shape), delete psid keys. One-way, idempotent.

Writes go through the existing `remember` tool → NovaMemory, with D10's redaction guard enforced
server-side in the memory write route (not just prompt-level).

**Distillation (P2):** NovaJob kind `conversation_distill` (priority 6, event-driven), enqueued
by the drain when a conversation goes quiet — `lastInboundAt` > 72h with ≥1 Nova reply since the
last distill — or immediately on order-delivered / complaint-resolved / handover-released.
DedupeKey `distill:<conversationId>:<lastMessageId>` (re-distills only when new messages exist).
Cheap model tier, slow lane. Writes AT MOST 3 memory updates, durable facts only:

| Distill | Example value | Facet |
|---|---|---|
| Preference learned | "size XL; prefers navy/dark colors" | sizes/prefs |
| Logistics pattern | "always COD; office address Agrabad; receives after 5pm" | prefs |
| Tone that worked | "tumi ok'd; banglish; humor lands; hates long messages" | tone |
| Complaint outcome | "2026-07: late delivery resolved w/ free-delivery coupon (promised)" | complaints |
| Price sensitivity | "negotiates every order; converted at 10% off twice" | prefs |

NOT distilled: transients (this order's address lives on the Order), anything on D10's deny
list, single-bad-day sentiment, and facts already in structured columns (LTV, RTO count — the
360 computes those live; duplicating them in memory would drift stale).

Register rule — **rule 17** in the instruction file: **reference facts, not surveillance.**
"আপনার অর্ডারটা কাল কুরিয়ারে উঠবে" (apnar order-ta kal courier-e uthbe) is a shopkeeper
remembering; "apni Messenger-e bolechilen je…" is a system reading logs. Nova uses cross-channel
knowledge without narrating the crossing.

### D10. Privacy, deletion, retention, isolation

**Redaction boundary** — the raw `InboxMessage` row keeps whatever Meta delivered (transcript
integrity), but the 360 block, NovaMemory, distillation, and promise text are the redaction
layer:

| Datum | Rule |
|---|---|
| Full phone | masked only (`017••••••89`); server matches full values |
| Street address on file | never in context — `hasAddressOnFile:true` + `city, district` only; at order time the customer restates or confirms (server-generated masked readback, area level max) |
| bKash/Nagad PIN, OTP codes | reply with a safety warning, NEVER echo, NEVER write to memory/promise text |
| NID / passport numbers | same; `remember` route rejects values matching NID (10/13/17 digits), card-PAN (Luhn), and OTP patterns — server-side regex guard |
| Payment credentials | never stored Nova-side; slip images stay attachment URLs, referenced not parsed |
| Another customer's anything | 360 is single-customer by construction; verification failures leak nothing |

**Meta data-deletion** (executed in module 01's handler; semantics owned here): delete
`CustomerChannel` rows where `kind IN ('messenger','instagram') AND address LIKE '%:'||senderId`;
delete `NovaMemory` rows with prefix `customer.psid.<platform>.<senderId>`; release open promises
whose conversation vanished (`releasedReason:'meta_deletion'` — with no send channel left, there
is no re-route; v1 has no sms sender). **What survives,
deliberately:** the Customer row, orders, `customer.<customerId>.*` memory, sms/email spokes —
Dakio commerce records keyed by phone, created by the customer's own orders, not Meta data. This
split is the compliance boundary and is documented in the handler comment. `NovaPromise.
conversationId` is a plain string (no FK) precisely so promise rows survive the cascade.

**Retention:** `customer.*` memory rows get `expiresAt = last-touch + 18 months`, refreshed on
every distill/order. Settled NovaPromise rows retained 24 months (they back kept-rate +
achievements), then hard-deleted by the sweep. Psid-keyed memory: until link-migration or Meta
deletion. Tenant off-boarding: existing tenant cascade covers CustomerChannel, NovaMemory,
NovaPromise.

**Isolation:** every path rides `authenticateNovaService + requireTenant` (dakio-api) and the
tenant guard (nova-ai); NovaMemory's `@@unique([tenantId, namespace, key])` scopes structurally;
the 360 serializer takes tenantId from the token only. No cross-tenant identity resolution ever.

### D11. Metrics (registry rows; storage and rendering owned by module 09)

Identity: `inbox.identity.linked` (labeled by `customerLinkSource`), `inbox.identity.proposed`,
`inbox.identity.verify_pass` / `verify_fail`, `inbox.identity.merge_detected` /
`merge_approved`. Promises: `inbox.promise.made` (by kind, madeBy), `.kept`, `.broken`,
`.released`, `.blocked_window`, headline **`inbox.promise.kept_rate` = kept / (kept + broken)** —
Support-room achievement copy: "Kept 47 of 49 promises to customers this month" (real ledger
rows). Memory: `inbox.memory.distilled`. Telemetry: `inbox.c360.assembly_ms`. A link/promise is
counted when the DB row is written — honest counters only. (Bot-disclosure counters are
`inbox.disclosure.*`, module 02 — deliberately not in this namespace, canonical C-19.)

---

## Data model

New model (full):

```prisma
model NovaPromise {
  id              String    @id @default(cuid())
  tenantId        String
  customerId      String?   // FK -> Customer, onDelete: SetNull
  conversationId  String?   // PLAIN STRING, no FK — survives Meta hard-delete
  channelKind     String    // 'messenger' | 'instagram' | 'sms' — where fulfillment should go;
                            // 'sms' reserved — no sender exists in v1; sms fulfillment arrives
                            // with the Reach send provider
  madeBy          String    // 'nova' | 'founder'
  text            String    // the commitment in the customer's language, as communicable
  kind            String    // 'follow_up_info' | 'delivery_eta' | 'courier_check' | 'restock_notify'
                            // | 'refund' | 'replacement' | 'callback_founder' | 'price_hold' | 'other'
  dueAt           DateTime  // when the customer expects to hear back
  graceHours      Int       @default(12)
  status          String    @default("open") // open | kept | broken | released
  keptAt          DateTime?
  brokenAt        DateTime?
  releasedReason  String?   // 'customer_resolved' | 'order_cancelled' | 'meta_deletion' | 'founder_released'
  sourceMessageId String?   // InboxMessage id containing the promise (receipt)
  novaActionId    String?   // the send_inbox_reply action that made it (ledger link)
  keptActionId    String?   // the action that fulfilled it
  followUpJobId   String?   // NovaJob (kind 'followup') created for fulfillment
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  customer        Customer? @relation(fields: [customerId], references: [id], onDelete: SetNull)
  tenant          Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, status, dueAt])
  @@index([tenantId, customerId, status])
}
```

Changed models (added fields only):

```prisma
model InboxConversation {
  // customerId String? landed in module 01's base migration (FK -> Customer, onDelete: SetNull)
  customerLinkedAt    DateTime? // NEW — when the link was written
  customerLinkSource  String?   // NEW — 'order_created' | 'phone_stated' | 'digits_verified'
                                //       | 'founder_manual' | 'channel_backref'
  proposedCustomerId  String?   // NEW — medium-confidence candidate; NOT a link; never read by 360
  proposedBasis       String?   // NEW — 'name_match' | 'order_ref' | 'context' — audit only
  claimedPhone        String?   // NEW — normalized in-thread phone that matched zero Customers
}

model StorefrontLead {
  conversationId String? // NEW — plain string, no FK; the thread this cart intent came from
                         //       (gap fix: recovery finds its way back to the conversation)
}
```

`CustomerChannel`: **zero columns added.** Doc-comment updates only — `kind` gains `instagram`
and reserved `webchat`/`voice` (plain string, the recon list was advisory), address formats per
module 01's table (`messenger:<pageId>:<psid>`, `instagram:<igAccountId>:<igsid>`, sms =
normalized `01XXXXXXXXX`, email lowercased, whatsapp E.164 reserved).

Migration `nova_identity_memory_p1` notes: no backfill needed (all new columns nullable; no
pre-existing links exist to describe). Indexes: the two NovaPromise indexes above;
`InboxConversation.customerId` index landed in module 01. Cascade audit: NovaPromise→Tenant
Cascade, →Customer SetNull; `conversationId` deliberately FK-free (Meta hard-delete survival);
`StorefrontLead.conversationId` FK-free for the same reason. The novaReach backfill
(`POST /channels/backfill`) is patched in the same PR to `normalizePhone` before writing sms
addresses — existing raw-phone rows are normalized by a one-off data statement in this migration
(idempotent: skip when the normalized address already exists for the tenant).

---

## APIs & interfaces

### dakio-api — service surface (`/api/v1/inbox`, auth `authenticateNovaService + requireTenant`, writes `w()`-idempotent)

| Route | Body | Returns | Notes |
|---|---|---|---|
| `GET /conversations/:id` (extended) | `?messages≤50` | `conversationOut + messages[] + customer360Out\|null + proposal:{basis}\|null` | 360 assembled by `src/lib/customer360.js`; replaces the thinner `customerSummaryOut` |
| `POST /conversations/:id/link-customer` | `{phone}` or `{verify:{customerId, lastDigits}}` | `{matched, customerId?, channelWritten, mergeProposed?}` | link only, never create; normalize + variants; clears proposal on outcome; migrates psid memory in-tx |
| `PATCH /conversations/:id` (extended) | `{proposedCustomerId?, proposedBasis?}` (alongside module 01's `lastIntent`) | `{ok}` | proposal bookkeeping; proposal grants zero data access |
| `GET /promises` | `?status=open&customerId?&limit≤50` | `{promises:[promiseOut]}` | sweep/brief reads; `promiseOut = {id, customerId, conversationId, channelKind, madeBy, text, kind, dueAt, status, keptAt, brokenAt}` |
| `PATCH /promises/:id` | `{status:'kept'\|'released', keptActionId?, releasedReason?}` | `{ok, promise}` | `broken` is sweep-only, never settable via PATCH; transitions validated (open→kept/released only) |

Seams specified here, carried by sibling modules' routes: `POST /conversations/:id/reply`
(module 02) gains promise co-creation in-tx + `followup` job enqueue + cancel-deletes-promise;
the `create_order_from_chat` executor (module 05) calls the HIGH-(a) link path; module 01's
`handleMessage` performs the `channel_backref` lookup at conversation upsert; module 01's
data-deletion handler executes D10.

### dakio-api — merchant surface (JWT)

`POST /meta/conversations/:id/release` (module 08's route) accepts
`{promise?: {kind:'refund'|'replacement'|'callback_founder'|'restock_notify', text, dueAt}}`
(`dueAt` an ISO string, required) from the quick-pick sheet → creates `NovaPromise{madeBy:'founder'}`. Merge proposals and
broken-promise recoveries render as ordinary Decision cards on the existing five decision
surfaces — zero new transport.

### NovaJob kinds (registered in this module)

| kind | prio | cadence | dedupeKey |
|---|---|---|---|
| `followup` (promise-backed uses of the unified kind) | 3 | event, `runAt = dueAt − 30min` | `followup:<conversationId>:<dueAtISO>`, `payload.promiseId` |
| `promise_sweep` | 6 | nightly | `promise_sweep:<tenantId>:<date>` |
| `identity_merge_sweep` | 6 | nightly | `merge_sweep:<tenantId>:<date>` |
| `conversation_distill` | 6 | event (P2) | `distill:<conversationId>:<lastMessageId>` |

### nova-ai

Tools/verbs (registered per the full new-verb checklist — types.ts union, zod schema,
RISK_CLASS, TARGET_TEXT with Bangla NFC, MINUTES_BY_ACTION, executors, ATTRIBUTABLE/DOOR_OF,
dutyRef):

- `link_customer` → verb `link_customer_identity` — risk low, MINUTES 2, undoable (unlink),
  department support, duty `support.inbox_replies` door, **auto at all tiers**
  (bookkeeping-verb carve-out, 08 SS8; self-stated phone only). Input: `{phone}` or
  `{verify:{customerId, lastDigits}}`.
- verb `merge_customer_records` — risk **high** (always drafts), MINUTES 5, not undoable,
  department support. Proposed by sweeps/link-collisions, never invoked mid-conversation by the
  model.
- `reply_in_thread` payload extension: `promise?: {text, kind, dueAtISO}` (schema-enforced kind
  enum matching the model column).
- `remember` tool: server-mirrored redaction guard (NID/PAN/OTP regex rejection) — the tool
  surfaces the rejection so the model does not retry.
- `get_conversation`: renders `customer360Out` as a trusted-framed section **outside** the
  `untrusted()` transcript wrapper; unlinked → `customer: null` + proposal basis.

Instruction file `agent/instructions/50-customer-inbox.ts` additions: hard rule 16 (PROMISES ARE
DEBTS, D7), hard rule 17 (reference facts, not surveillance, D9), the D3 verification scripts,
and the identity floor corollary: service is never gated on identity; history access always is.

CI evals shipped with this module (run as hard gates by module 12): undeclared-promise regex
gate (D7 corpus); identity-leak eval — verification-failure transcripts must contain zero digits
or names of the candidate; redaction-guard unit corpus (NID/PAN/OTP strings rejected at the
memory route).

---

## Files touched

**dakio-api**
- `prisma/schema.prisma` + migration `nova_identity_memory_p1` — NovaPromise (new);
  InboxConversation +5 identity columns; StorefrontLead +conversationId; CustomerChannel
  doc-comments; sms-address normalization data statement.
- `src/lib/customer360.js` (new) — the 360 serializer: single assembly + redaction point, token
  caps, masked projections, flags computation.
- `src/routes/novaInbox.js` — extend `GET /conversations/:id` with `customer360Out`; new
  `POST /conversations/:id/link-customer` (both bodies, in-tx spoke upsert + memory migration +
  lead stamp); `PATCH /conversations/:id` proposal fields; new `GET /promises` +
  `PATCH /promises/:id`.
- `src/routes/novaJobs.js` — register `promise_sweep`, `identity_merge_sweep`,
  `conversation_distill`; `followup` promise-payload handling (kind itself registered with
  module 04; this module lands the `payload.promiseId` branch).
- `src/lib/novaExecutors.js` — `EXECUTORS.merge_customer_records`; `UNDO.unlink_customer`;
  kept-promise stamping inside the `send_inbox_reply` executor when fulfilling
  (`payload.promiseId` present → `PATCH /promises/:id kept` on successful send).
- `src/routes/novaReach.js` — backfill normalization fix.
- `src/routes/meta.js` — data-deletion extensions (executed with module 01; the channel/memory/
  promise deletion steps + compliance-boundary comment land here).
- `src/lib/novaMemoryGuard.js` (new) — NID/PAN(Luhn)/OTP regex guard, used by the memory write
  route.

**nova-ai**
- `agent/lib/types.ts`, `agent/lib/nova/authority.ts`, `agent/lib/nova/activity.ts`,
  `agent/lib/duties.ts` — `link_customer_identity` + `merge_customer_records` checklist entries.
- `agent/tools/link_customer.ts` (new); `agent/tools/reply_in_thread.ts` — `promise?` payload
  field; `agent/tools/get_conversation.ts` — 360 trusted framing; `remember` tool — redaction
  rejection surface.
- `agent/instructions/50-customer-inbox.ts` — rules 16/17 + verification scripts.
- `agent/lib/store/client.ts` + `store/dakio.ts` — `linkCustomer`, `listPromises`,
  `settlePromise` client methods.
- `evals/` — undeclared-promise gate, identity-leak eval, redaction corpus.

**dakio-merchant**
- Hand-back sheet promise quick-picks on the release flow (renders into module 08's release
  call); Decision-card copy for merge proposals and broken-promise recoveries rides existing
  Decision surfaces unchanged.

---

## Testing

**dakio-api** (node:test, files added to the package.json test list):
- `test/nova-identity.test.js`
  1. Given a stated phone matching exactly one Customer (stored as `+8801…`), when
     `POST /link-customer {phone:'01712345678'}`, then the conversation links with
     `customerLinkSource:'phone_stated'`, a `messenger:` CustomerChannel spoke exists with
     `consent:'transactional'`, and psid memory keys are migrated to `customer.<id>.*`.
  2. Given `phoneVariants` matching two Customer rows, when link is attempted, then no link is
     written, `mergeProposed:true` returns, and a `merge_customer_records` draft Decision exists.
  3. Given a proposal, when `verify.lastDigits` is wrong, then the proposal columns are cleared,
     `inbox.identity.verify_fail` increments, and the response leaks neither digits nor name.
  4. Given an existing spoke with customerId, when a new conversation upserts for the same
     address, then it links with `'channel_backref'` and zero model calls.
- `test/nova-promises.test.js`
  5. Given a reply payload with `promise`, when the send transaction commits, then a NovaPromise
     row + `followup` job (`payload.promiseId`, dedupeKey `followup:<convId>:<dueAtISO>`) exist;
     when the outbound is canceled `new_inbound`, then the promise row is gone.
  6. Given an open promise past `dueAt + graceHours`, when `promise_sweep` runs twice, then
     exactly one `broken` transition and one recovery Decision exist (idempotent).
  7. Given a due promise with the Meta window closed and a consented sms spoke, when the
     `followup` fires, then a prepared card + blocked ledger row + Decision exist, no sms row is
     written (v1 has no sms sender), and the promise stays `open`.
- `test/customer360.test.js`
  8. Given a linked customer with 2 open orders, 1 open promise, and 6 memory lines, when
     `GET /conversations/:id`, then the block caps at 3 orders / 5 preference lines, contains
     `maskedPhone` but no full phone and no street address, and an unlinked conversation returns
     `customer:null` with basis-only proposal.
- `test/nova-merge.test.js` — merge executor: orders/channels/conversations/promises/memory
  repointed to the survivor, loser phone kept as an sms spoke, loser deleted; re-run is a no-op.

**nova-ai** (repo suite + isolation suite — tenancy touched): tenant-guard denial of
cross-tenant promise/link reads; `link_customer_identity` verdict matrix — bookkeeping verb
(module 08 SS8 carve-out), executes at every tier including T0 Shadow; assert executes at T0
(bookkeeping class);
undeclared-promise eval red corpus (10 committing phrases without payload → all fail);
identity-leak eval green corpus.

---

## Risks & trade-offs

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Wrong-person link** — order history leaks to a stranger (worst failure) | low | NEVER tier hard rules; proposal-grants-zero-access column split; server-side digit compare; one attempt per candidate; multi-match → merge Decision + stay unlinked; identity-leak CI eval |
| Duplicate Customers linger; two threads see different history | medium | `identity_merge_sweep` nightly + link-time detection; merge is founder-gated so lag is bounded by Decision latency — acceptable (money records) |
| Undeclared promise slips past the regex corpus | medium | corpus grows from production sampling (v2 nightly sweep is named); broken-promise sweep still catches the *declared* misses; kept-rate is honest either way because only declared promises are graded |
| Promise spam — model over-declares trivial promises | medium | kind enum + one-open-promise-per-topic rule 16 + 360 promises list visible to the model; sweep Decisions make noise founder-visible fast |
| 360 assembly slows the hot conversation read | low | ≤80ms budget measured as `inbox.c360.assembly_ms`; all reads on existing/new indexes; caps bound the payload |
| Memory poisoning via customer text ("remember I always get 50% off") | medium | customer text is `untrusted()`; distill prompt writes facts, not instructions; owner-rules-win (module 11); memory inspectable/deletable |
| Meta deletion races an open promise's `followup` job | low | fire-time re-check: conversation gone → promise already `released:'meta_deletion'` → job no-ops |

---

## Gate

Scripted demo, clean staging store, run by a non-builder:

1. Message the store from a fresh Messenger account, state "amar number 017XXXXXXXX" (a phone
   with an existing seeded Customer) → within one turn the conversation shows a linked customer
   in the merchant Inbox; the next Nova reply references the previous order naturally, without
   narrating the lookup, and the transcript contains no full phone number.
2. From a second fresh account, claim to be that customer by name → Nova asks the last-2-digits
   question; answer wrongly → warm fallback line, zero leaked digits/names, no link.
3. Ask a question Nova must check on ("stock kobe ashbe?") → the reply carries "জানাবো"-class
   copy AND a NovaPromise row appears (`GET /promises`); let it pass dueAt+grace → the nightly
   sweep produces a broken-promise recovery Decision on the founder's Decision surface.
4. Approve a fulfillment draft → the promise flips `kept` with a `keptActionId`; the Support
   room shows `inbox.promise.kept_rate` computed from these real rows.
5. Trigger the data-deletion callback for account #1 → messenger spoke + psid memory gone,
   Customer row + orders + customerId memory intact (verified by direct DB read in the demo
   script).

Measurable checks: `inbox.identity.linked` labeled by source matches the demo's link count;
`inbox.c360.assembly_ms` P95 ≤ 80ms on staging; CI green on undeclared-promise, identity-leak,
and redaction corpora; merge executor idempotence test green.

**Rollback (no deploy):** flip `NovaAgentMode {scope:'door:inbox'}` to `assisted` — every
identity/promise verb drafts, nothing links or promises without founder approval; pause job
kinds `promise_sweep` / `identity_merge_sweep` / `conversation_distill` (job-kind pause,
module 12's off-path registry) to freeze background writes; individual links are reversible via
the `unlink_customer` undo. The 360 serializer degrades safely on its own: with linking paused,
conversations simply return `customer:null` and Nova works from the thread alone.
