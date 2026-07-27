# Module 06 — Delivery & RTO: AS BUILT

**Status:** built, tests green, human verification pending (F-50…F-56 in
[`docs/HUMAN-VERIFICATION-REQUIRED.md`](../../HUMAN-VERIFICATION-REQUIRED.md)).
**Commits:** dakio-api `a7a6117` → `9cb5366` → `34935b4` → `0de4885` → `d7c1dc3` → `62eb564` → `a0c1326`;
nova-ai `f6ce0a8` → `e8b1f09` → `abf8d45` → `907ca4a`; dakio-merchant `b991b61` (on `develop`).
Branch `feat/front-office` for the two backends.

> Read [`AS-BUILT-03.md`](./AS-BUILT-03.md) first if you are new — its §1 explains why these files exist and
> why no Stage-10 module doc's "already real" column or file:line coordinate can be trusted.

---

## 1. The thing that nearly shipped

**Three of the module doc's DESIGN claims are false, not just its line numbers**, and two of them would have
shipped as working features that quietly did nothing.

**`open_case` has no mechanism to execute at every tier.** The doc says it does, "via module 08's SS8
`verdictForLevel` carve-out". There is no such carve-out — `verdictForLevel` has no verb awareness, and
`NEVER_GATED` is the only thing in the codebase that runs before the dial. `authority.ts:88-106` had already
pre-litigated this and, better, had already REFUSED the identical argument once for `schedule_follow_up`:

> *"That is true of the scheduling and false of its consequence… membership here would let a T0 Shadow
> store, whose whole promise is that Nova only watches, accumulate real commitments the founder never
> approved."*

**`flag_courier_issue` had two contradictory rulings on record** — module 08's doc wanted it never-gated,
06's wants it forced-prepared — and `authority.ts:94-98` explicitly deferred the decision to this module.

**And the case tools were specced as "job-session extras", a mechanism this framework does not have.** eve
resolves dynamic tools by ADDING; `disableTool()` is static; a session's tool set cannot be narrowed. So a
tool is either on `CUSTOMER_SLIM_TOOLS` or `requireFounderSession`-gated — and the loop-closer's
`args.receive` mints a **customer** principal, which means a founder-gated `get_case` would have been DENIED
in the one session built to need it.

**The lesson for module 07+:** when a doc names a mechanism, grep for it before building on it. Two of the
three above are named as if they exist, and the third is named as if the framework supports it. The hour
spent checking is the cheapest hour in the module.

**What the eval suite caught that I got wrong.** `update_order_contact` first shipped as an unconditional
`allow`, reasoning that the server already refuses a change once the parcel is with the courier and that a
pre-dispatch correction is only the customer fixing details they gave a minute ago. Both true. Both beside
the point: the address is where a COD parcel worth real money goes, and *"whoever is typing in this thread"*
is not the same claim as *"the person who placed the order"*. A redirect is a fraud shape, not only a typo
fix. `evals/inbox/run.ts`'s empty-platform check went red and was right to.

---

## 2. What shipped

### `NovaCase` — the coordination record

One customer sentence can need work from shipping, the founder and the thread before there is anything true
to say back. A case is where that is coordinated and where the answer comes back from. It is **coordination
state only** — the ledger stays the ledger and a case links to it through `refs`. It is **not a journey**:
`CustomerJourney` owns where a human stands in their life with the shop, a case is one episode inside it,
and the two machines are allowed to drift rather than being coupled.

**The `activeKey` unique claim is why this is a model.** `"<kind>:order:<orderId>"` while open, NULL once
closed — Postgres treats NULLs as distinct, so closing frees the key with no partial index and no cleanup
job. A Facebook thread and an Instagram thread about one parcel produce ONE case, ONE dept job and ONE
founder card. You cannot `@@unique`-claim a `targetRef` convention, which is exactly the argument for
rejecting loose activity rows.

Two things the doc specified that cannot work:

- **`create` + catch(P2002) inside a transaction.** A unique violation aborts the WHOLE transaction; every
  later statement fails 25P02 even though the P2002 was caught. Uses `upsert` with a deliberately NON-EMPTY
  update, because Prisma degrades `update: {}` to a non-atomic check-then-insert.
- **Inferring `joined` after the fact.** A pre-read races — all four concurrent callers see "no row" and
  every one believes it created the case, which books the founder four courier cards for one parcel.
  Comparing `createdAt` to `updatedAt` collides inside a millisecond, which is precisely the window this
  runs in. The id is supplied client-side so the upsert's answer is exact.

The JSON appends are raw-SQL atomic rather than read-modify-write. `refs.conversationIds` is what the
loop-closer fans out over, so a lost entry is a customer who never got the answer; `@>` keeps it idempotent
so a double-texter is not told twice. `facts` is append-only with **no code path that replaces it** — a
model re-sending a shortened list must not be able to erase what a courier poll found.

`waiting_founder` still HOLDS the key. A case on the founder's desk must still absorb the second person
asking, or they get asked twice about one parcel.

### The service surface — `/api/v1/inbox/cases`

`POST` returns **201 when it opened one and 200 when it joined**, and that is load-bearing rather than
decorative: `joined` decides whether the caller enqueues a department job, and a caller reading only the
status must reach the same conclusion as one reading only the body.

`PATCH` refuses three things: replacing facts (the field is `appendFacts`, so a replacement cannot even be
expressed), reopening a terminal case (its key was released and another case may hold it now), and writing
anything promise-shaped. `keptAt` is stamped by `onOutboundSent` only after Graph confirms a real bubble —
that is the only reason kept-rate is a number the model cannot inflate, and a PATCH-able version would hand
it the pen.

There is deliberately no DELETE. A case is closed with a resolution sentence, including when the ending is
bad; module 09 counts these rows.

### The courier-webhook bug — `updateOrderByTracking`

**Pre-existing, unrelated to Nova, and it had no test of any kind.** The function short-circuited on the
MAPPED Dakio status before writing anything:

```js
if (order.status === newStatus) return
```

Many raw courier strings map to one Dakio status, so every move that did not change the mapped status was
discarded whole. Two systems read those columns and both were being lied to:

1. **The stagnation clock ran backwards from reality.** A Pathao parcel moving normally through
   `Pickup Assigned → Picked Up → At Sorting Hub → In Transit` (all `PROCESSING`) never stamped
   `courierStatusAt` once, so a parcel actively crossing the country looked motionless and aged into
   `at_risk` — which this module turns into an apology sent to a customer whose delivery was fine.
2. **`hold` could not reach the reducer.** Steadfast `pending` and `hold` are both `PROCESSING`. `hold` is
   the ONLY failed-attempt signal any of the three couriers sends and the journey table maps it to
   `at_risk {riskReason:'courier_hold'}` — the single most actionable courier event in the system,
   unreachable since the function was written.

`emitOrderUpdated`'s dedupeKey gained the raw string for the same reason. It was keyed on (order, status)
alone, explicitly "matching the granularity courier webhooks already dedupe at" — it did match, and both
were wrong together, which is why neither looked wrong.

Also: `REDX_MAP` was missing `Partially Delivered`, which `courierSync.js` has always had. The same string
arriving by webhook was dropped silently while arriving by poll it was handled.

### `computeRtoSignals` — rule points over columns that exist

Three of the doc's six rules were wrong against the real schema, each in a way that would have shipped
looking correct:

| Doc rule | Reality |
|---|---|
| `fakeProtectionAction` set → +3 | Written `'ALLOW'` on EVERY order when the guard is on, so the rule reads "is the guard enabled" and adds 3 points to the whole store. Only `'WARN'` is a signal; `'OTP_VERIFIED'` is the opposite of one. |
| Prior `RETURNED` orders, +2 each | Nothing writes that status automatically — every courier path maps a return to `'FAILED'`. As specced the rule passes its own unit test against seeded rows and returns zero on every real store forever. |
| `Order.customerAddress` under 20 chars | No such column. The address is `Customer.address`. |

**Sparse signals mean `low`, not "unknown".** A first-time buyer in Dhaka with a full address genuinely
scores zero; loosening the definitions to make the number feel informative would turn the confirmation-ping
priority into a coin flip.

### The five verbs

| Verb | Risk | Gate | Undo |
|---|---|---|---|
| `open_case` | low | the dial, like anything else | none — a case is closed with a reason, never deleted |
| `flag_courier_issue` | low | **ALWAYS_DRAFT** | none — it changes nothing to reverse |
| `confirm_order_intent` | low | the dial (auto at T1+) | none — `confirmedAt` records that a human said yes |
| `update_order_contact` | medium | `inbox.addressEditAuto` (false) | none — the old address is one the customer already called wrong |
| `cancel_order_from_chat` | medium | `inbox.cancelAuto` (false) | `uncancel_chat_order` |

`flag_courier_issue` is in `ALWAYS_DRAFT` because that set is the only thing here that means *"always, at
every tier, forever"* — a guardrail-arm `needs_approval` is only as permanent as a platform bag (module 05
shipped a ceiling that was unreachable for exactly that reason) and `riskClass` cannot express it at all,
since `verdictForLevel` executes every class at level 4.

**The verb changes NOTHING, and that is what decides the ruling.** Dakio can book, cancel, poll and receive
webhooks at all three couriers — it **cannot** reschedule, redirect or hold a parcel. (The doc's boundary
claim omits cancel, which IS implemented for all three and already fires automatically.) So the verb gathers
the tracking id, the last scan, the expected COD and what the customer was told, and puts them in front of
the person who can pick up a phone. Auto-executing a proposal means flagging things to nobody.

### The loop closer

```
courier scan / founder action / dept job finishing
        │ (state actually changed)
        ▼
NovaInbox  case.updated   dedupe: case.updated:<caseId>:<source>:<key>
        │ drainCaseUpdated — one job per CASE per 10-min bucket
        ▼
NovaJob  case_update  (priority 4)
        │ dispatcher
        ▼
the customer's OWN thread, through the ordinary send gate
```

**The job carries ids only.** What the customer reads is composed at FIRE time from a live case read — by
the time the dispatcher arrives the triggering state may have moved on, and a message quoting the event
would tell somebody their parcel reached a hub it has since left.

Rejoining the thread gives the register, the tone, the language they write in and everything either side has
said, for free. And because the reply passes the ordinary send gate, a T0 Shadow store's loop-closure lands
as a prepared draft rather than not happening.

### `get_order_status` — the WISMO answer

The eleventh customer-plane tool and the only order read a customer session may make. **The raw courier
string never leaves the server**: it goes through the same humanizer the public tracking page uses, because
the customer can open that link while reading Nova's reply.

`stuck` is the SERVER's verdict off the journey sweep's own thresholds, now exported rather than duplicated
— one definition, or Nova calls a parcel late on a different rule than the sweep that opens cases about it.

**There is no ETA field.** No courier gives Dakio a delivery date, so there is nothing to read one from and
nothing honest to estimate from. Any date in a reply becomes a promise somebody keeps at a doorstep.

---

## 3. Frozen contracts later modules call

| Contract | Where | Why it is frozen |
|---|---|---|
| `POST /cases` answers 201-opened / 200-joined | `lib/novaCase.js` | `joined` decides whether a dept job is enqueued. Collapse them and the founder gets a card per asker. |
| `activeKey` is NULLed on close | `closeCase` | Forgetting it makes the first stuck parcel the only one an order can ever have — silently, months later. |
| `facts` append-only; the request cannot express a replacement | `PATCH /cases/:id` | Those facts are quoted to customers. |
| Nothing promise-shaped is patchable | `PATCH /cases/:id` | `keptAt` comes from a Graph-confirmed send. That is the whole basis of kept-rate. |
| `case.updated` payload is ids only | `lib/novaEvents.js` | Quote-at-send. The event may be stale by delivery time. |
| `NEVER_GATED` stays at 2 | `authority.ts` | Membership bypasses the dial AND every numeric guardrail. |
| `flag_courier_issue` ∈ `ALWAYS_DRAFT`, both repos | `authority.ts`, `novaAuthority.js` | The dakio-api mirror is the layer that 403s a direct ledger write. |
| Contact edits are pre-dispatch only, keyed on `courierSentAt` | `patchStoreOrder` | After handover the label is the courier's. |
| Any contact change resets `confirmedAt` | `patchStoreOrder` | The yes was about a specific address and total. |
| `confirmedBy` carries TWO shapes | `patchStoreOrder`, `confirmedByLabel` | A human display name since long before Nova; `nova:<id>` or `nova` now. |
| No ETA anywhere on the customer path | `get_order_status`, playbook §11 | There is no source for one. |

---

## 4. Decisions that bind later modules

**R1 — `open_case` is an ordinary gated verb.** `NEVER_GATED` stays at two. The T0 story survives because
cases have two openers: SERVER-opened ones (courier webhook, stagnation sweep) never touch the authority
gate, because no model asked for them, and run at every tier unchanged. Only Nova ASKING is gated — which is
what T0 Shadow means.

**R2 — `flag_courier_issue` is `ALWAYS_DRAFT`.** Settles the contradiction `authority.ts:94-98` recorded.

**R3 — no `get_case` tool; the case rides in on `get_conversation`.** Avoids the customer-principal
collision entirely, adds no slim-list member, and costs no prompt budget — of which there is now **13
tokens**.

**R4 — `update_order_contact` is gated behind `inbox.addressEditAuto` (false).** The honest cost: a
genuinely typo'd address waits for a founder tap.

**R5 — Movement 4 (`failed_attempt` rescue) has no trigger and is NOT claimed.** No provider sends a
failed-attempt string; the only near-match is Steadfast `hold`. Recorded rather than faked.

---

## 5. Known-not-built, with owners

- **Movement 4's rescue ping.** `hold` now reaches the reducer (it could not before this module), but no
  rescue flow consumes it. Owner: module 07, or whoever revisits RTO.
- **`order.item_unfulfillable` is structurally impossible as specified.** `PATCH /orders/:id/items` deletes
  and recreates every row, so there is no stable `itemId` for the dedupeKey and no way to distinguish
  "removed because unavailable" from "customer changed their mind". Deferred honestly, not faked.
- **`courier-refresh` route.** Not built. `GET /orders/:id/courier/status` does NOT persist `courierStatus`
  and implements **Steadfast only** — RedX and Pathao answer null. Wrapping it as specced would return a
  fresh string that never lands and would not reset the stagnation clock. It also does a live HTTP poll,
  which inside `w()`'s 60s `STALE_CLAIM_MS` is exactly the shape that breaks the claim.
- **`CourierConsignment.courierStatus` is hand-maintained** — its only writer is a manual merchant PATCH.
  A card quoting it will lie; `trackingId` and `expectedCod` are safe.
- **Dropship orders cannot be detected as stuck.** They carry `courierTrackingId` but no `courierSentAt`,
  and the stagnation sweep short-circuits on that column.
- **`GET /api/nova/cases`** (the merchant "customers needing attention" list) and the conversation-header
  case chip are not built. Module 10 owns that surface; the server fields are here.
- **`sweep.courier_failed`** still has no producer — a dead rule predating this module.

---

## 6. Baselines

```bash
cd dakio-api && npm test                  # 1852 tests, 1851 pass, 1 skipped, 0 fail
cd dakio-api && npm run test:integration  # 148 pass, 0 fail (needs local Postgres :5433)
cd nova-ai   && npx tsc --noEmit          # 0 errors
cd nova-ai   && npm run test:inbox        # 778 checks (delivery's 41 folded in)
cd nova-ai   && npm run test:delivery     # 41 checks, focused iteration only
cd nova-ai   && npm run check:undo        # 25 verbs
cd nova-ai   && npm run check:duty-seed   # 72 duties mirrored
cd dakio-merchant && npm run build        # clean
```

Standing traps, unchanged: dakio-api's `package.json` enumerates test files explicitly and `node --test`
tolerates a missing one **silently**. nova-ai's `npm test` is still RED at the isolation step (founder
context 3085 > 2500, **F-20**) and is an `&&` chain, so everything after it never runs — run suites
individually. **New:** the customer register renders 3512 against a 3525 ceiling — 13 tokens. Raise
`CUSTOMER_PROMPT_BUDGET` before adding text, not after, and remember the estimator understates Bangla.

---

## 7. If you are starting module 07 (Aftersales & Retention)

Waiting for you: `NovaCase` with a `damaged_item` kind already routed to support and already openable;
`open_case` registered and gated; the loop-closer, so anything you coordinate can come back to the customer
without new plumbing; `get_order_status` on the customer plane, so a returns conversation can see the real
delivery state; and `hold` finally reaching the journey reducer.

What you must not break: the `activeKey` release on close, the append-only facts guarantee, the
ids-only `case.updated` payload, and `NEVER_GATED`'s size — the check pinning it at two is the fourth
module in a row to be asked to grow it.

Budget an hour to re-derive your doc's "already real" column. Module 05's recon found 34 corrections;
module 06's found ~25 plus three false design claims.
