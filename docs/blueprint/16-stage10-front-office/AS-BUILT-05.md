# Module 05 — Selling & Conversion: AS BUILT

**Status:** built, tests green, human verification pending (F-43…F-49 in
[`docs/HUMAN-VERIFICATION-REQUIRED.md`](../../HUMAN-VERIFICATION-REQUIRED.md)).
**Commits:** dakio-api `a66faba` → `e81cf1d` → `81175bc`;
nova-ai `cd05b55` → `43384a1` → `0f60775`; dakio-merchant `7880585` (on `develop`).
Branch `feat/front-office` for the two backends.

> Read [`AS-BUILT-03.md`](./AS-BUILT-03.md) first if you are new — its §1 explains why these files exist and
> why no Stage-10 module doc's "already real" column or file:line coordinate can be trusted.

---

## 1. The thing that nearly shipped

**Nova could have charged a customer for the same basket twice, and the shop's own discount ceiling did not
exist.** Both were found after the build was already green.

The duplicate order was not in the order route. It was in `w()`, the shared Idempotency-Key wrapper
(`src/lib/novaIdempotency.js`) — read the cache, run the handler, write the cache. A TOCTOU with a window
exactly as wide as the handler. Two requests carrying one key both missed the read, both ran the mutation,
and the loser's unique-constraint violation on the write-back was caught and discarded under a comment
reading *"Concurrent retry raced us and won — fine, the mutation already ran once."* It had run twice.
Reproduced against a real Postgres: 2 concurrent POSTs produced 2 `Order` rows, 4 produced 4. Nine wrapped
routes were affected, not one.

The discount ceiling was worse because nothing looked broken. `inbox.maxDiscountPct` was minted, seeded to
15, read by a guardrail branch, and covered by an eval. That branch sat **after** the `inbox.discountAuto`
switch — which ships false and stays false until module 11, because `tierMoveDecision` refuses every move
that would turn it on. So on every tenant that will ever exist, the switch returned first and the ceiling
clause was unreachable. A 90% offer came back as an ordinary approve-me card reading *"Nova doesn't hand out
discounts on its own"*, never mentioning the founder's own 15% limit, and one tap issued it. Meanwhile
`offer_chat_discount`'s tool description told the model *"the shop's ceiling is enforced on the server"* —
and no server enforced it anywhere.

**The lesson for module 06+:** a guardrail that only ever runs behind a flag nobody can turn on is not a
guardrail, it is a comment. When a check gates money, ask which arm of the switch every real tenant is
actually standing on, and put the check on that arm. And a limit enforced only in the agent is advice: the
founder approving the draft walks past it, as does any direct POST.

The eval that "covered" the ceiling ran against a permissive fixture where `discountAuto` was true. It was
green for eighteen hours over code that could not execute. The suite now drives both arms.

---

## 2. What shipped

### The order path as a library — `dakio-api/src/lib/orderCreate.js`

Extracted from the **storefront** path (`executeCheckout`), not the merchant one, and that was a deliberate
cost decision (FD-2). The merchant path is simpler because it does less: variant-blind, a post-response
unawaited stock decrement, and it accepts client-supplied `discount`/`paid`/`qty`. `executeCheckout` is
variant-aware, decrements in-transaction, refuses a client discount, redeems coupons and retries the
order-number P2002. Extracting the better one has the bigger blast radius and is the strictly better result.

Takes `{tenantId, userId, ...params}` — **never `req`** — and throws `{status, message, code}` rather than
touching a response. Nova-only for now (FD-1): `routes/orders.js` still has its own path and was not
refactored. That is a known, deliberate divergence, not an oversight; see §5.

- **The price lever is refused, not ignored.** A caller-supplied `discount`, or a per-item `price`, is a
  4xx. Every line is priced from the catalogue row inside the transaction, so a stale conversation cannot
  sell at yesterday's price.
- **Stock decrements inside the transaction** and is drawn across warehouses rather than refusing an order
  the tenant can fill. An oversell rolls the whole order back; the update row count is the only truth.
- **Variants are recorded** (`OrderItem.variantId`, FD-2). "XL hobe?" is the entire module — a customer
  confirmed a size, and until now no row said which one was sold.
- Fake-order protection runs in WARN and STRICT; STRICT **blocks** rather than silently downgrading,
  because a chat thread has no OTP channel to fall back to.

### The Nova service surface — `dakio-api/src/routes/novaStore.js`

`POST /orders`, `POST /discounts`, `POST /discounts/validate`, `PATCH /carts/:id`, `GET /customers/risk`.

- **One order, EVER, per `novaActionId`**, read back off `@@index([tenantId, novaActionId])` before the
  insert. It is enforced there and not by `w()` — see §1 for why `w()` could not be trusted with it.
- Coupon codes are stored **upper-case**. Every redemption path uppercases before lookup, and
  `@@unique([tenantId, code])` is case-sensitive in Postgres, so a lower-case code created here was
  silently unredeemable *and* coexisted with its upper-case twin as a second row.
- The D6 **frequency guard** — one Nova discount per customer per window — reads the `NovaAction` ledger
  (`Coupon` has no `customerId`) and is **returned** as a 409 with a machine-readable `code`, never thrown:
  the executor retries a thrown 409 with a fresh code, and retrying a frequency refusal would be the
  executor defeating the guard it is meant to honour.
- The **discount ceiling** is enforced here, fail-closed, on Nova-attributed PERCENT coupons only. A
  merchant-created coupon is bounded by the store-wide `maxDiscountPct` instead — two numbers on purpose,
  so one room's decision cannot silently re-price the other's.

### Provenance — three columns, no foreign keys

`Order.novaActionId`, `Order.sourceConversationId`, `Order.sourceChannel`, `OrderItem.variantId`. All plain
strings. Meta's data-deletion callback **hard-deletes** `InboxConversation` rows, and `PUT /products/:id`
deletes variant rows by name diff — so renaming "XL" to "X-Large" deletes the XL row. A foreign key would
force either CASCADE (destroying a financial record) or RESTRICT (blocking a routine edit or a deletion Meta
requires us to honour). The ids survive as dangling receipts and every reader tolerates a miss.

`sourceChannel` is carried separately from `sourceConversationId` precisely because it **outlives** it: after
the deletion callback runs, the channel is the only thing left saying where the order came from.

### Policy snippets — `TenantPolicy` (D2)

The merchant's own answers to the questions no column can answer: return window, exchange rules, warranty,
delivery timelines. Nova reads them through `GET /api/v1/store/settings` and **quotes** them; it may never
compose one.

**An absent row is the product saying "the shop has not decided this."** No seed, no default text, and a
real DELETE — D2's rule is that Nova hands a policy question to the founder when the shop has no answer on
file, which only works if "no answer" is distinguishable from "the answer is no". A placeholder would have
made every shop look like it had a return policy it never wrote, and Nova would have quoted it to a
customer.

`key` is a slug (open string, shaped not enumerated) — shops sell things nobody enumerated. Capped at 20
rows × 600 chars, and both caps are about the **model's context**, not the database: every policy is
returned in full into the customer-session prompt, whose estimator understates Bangla badly. A merchant
pasting their whole terms page would not fail — it would silently crowd out the conversation.

### The verbs — `nova-ai/agent/tools/`

`create_order_from_chat`, `offer_chat_discount`, `validate_coupon`, `verify_payment_slip`.

- `create_order_from_chat` requires the customer's own yes as a **zod literal**, not a free-text field, so a
  replayed or hand-built payload cannot claim consent nobody gave.
- `offer_chat_discount` declines once before offering, reaches for free delivery before a percentage, and
  never quotes a number the model worked out itself — the executor resolves the shop's real delivery charge
  from settings, because a guessed ৳60 on an outside-Dhaka parcel is a discount the shop did not agree to.
- `verify_payment_slip` is `ALWAYS_DRAFT` and **verifies nothing**. It records that the customer *claims* to
  have paid. Nothing on that path may say the payment was received, because nobody has read a bank
  statement. It claims no revenue and stamps no order door.
- Every guardrail read is fail-closed and every platform key is **bracket-indexed**.
  `guardrails.maxDiscountPct` compiles and is `undefined` at runtime — a fail-open wearing a type-check's
  clothes, and the reason `evals/inbox/selling.ts` is built as a delta table over a baseline that *allows*.

### Cart recovery, split across two lanes (D8)

The founder-plane `cart_sweep` reaches email and SMS. dakio-api's `runCartRecoveryMatch` matches each open
cart to its live conversation and books a **`followup` NovaJob** rather than sending during its own lease —
which is what buys `recheckBeforeFire`, the proactive marker and the weekly touch cap for free, and is the
difference between shipping module 04's named worst failure and not.

The split is legible from the sweep only because `get_abandoned_carts` now returns `conversationId`. It did
not, so the instruction *"SKIP any cart that already has a conversationId"* could not be obeyed even in
principle and every cart with a thread was worked by both lanes: one customer, one basket, two channels.
Absent and null are kept distinct — null is "no thread matched", absent is "this dakio-api predates module
05", and collapsing them would stand the whole sweep down against an older server.

---

## 3. Frozen contracts later modules call

| Contract | Where | Why it is frozen |
|---|---|---|
| `createOrderFromParams({tenantId, userId, ...})` throws `{status, message, code}` | `lib/orderCreate.js` | The route re-emits it. A thrown Express response would make the lib unusable from a job or an executor. |
| One order per `novaActionId`, read back pre-insert | `routes/novaStore.js` | Not delegated to `w()`. Module 06's cancel/modify verbs must read the same column, not invent a second key. |
| `guardrail:inbox_max_discount_pct` / `guardrail:inbox_discount_frequency` returned as 409 `code` | `routes/novaStore.js` | nova-ai turns the rule into a receipted blocked row. String-matching prose would break silently. |
| Ceiling is checked **before** `inbox.discountAuto` | `agent/lib/nova/autonomy.ts` | Reordering it back makes the ceiling unreachable again. The ordering is the check. |
| `AbandonedCart.conversationId` is `string \| null \| absent`, three distinct facts | `agent/lib/types.ts`, `get_abandoned_carts` | `?? null` anywhere on this path re-opens the double-contact bug. |
| `sourceConversationId` is read by `reduceOrderEvent`, not merely written | `lib/novaJourney.js` | Any new order-event reader must pass it as the conversation rung or it forks a journey per sale. |
| `create_order_from_chat` returns `status: "prepared"` with **no order number** today | `agent/lib/nova/actions.ts` | The playbook's close is written around this. Module 11 flipping `orderAuto` changes which script fires, not the contract. |

---

## 4. Decisions that bind later modules

**FD-1 — the lib is Nova-only first.** `routes/orders.js` was not refactored onto `orderCreate.js`. Two
order paths exist and may drift. Whoever unifies them owns a parity story; nobody has written one.

**FD-2 — `OrderItem.variantId` was added rather than rejecting variants.** The alternative was a 400 on any
`variantId`, which means Nova cannot sell any product that has sizes. Accepting-and-dropping was never on
the table: the customer is confirmed an XL, the merchant ships whatever, and no row records the discrepancy.

**FD-3 — the Gate stops at T1; auto-execute defers to module 11.** `inbox.orderAuto` and
`inbox.discountAuto` both ship false and there is no supported way to turn them on, because
`tierMoveDecision` refuses every upward move to T2/T3 unconditionally. **Every chat order drafts.** The
module's rollback plan depends on those flags being the off switch, so do not "finish" them here.

**FD-4 — the escalation enum was widened** rather than reusing `tool_failure` for a blocked order. Reusing
it would have handed the customer holding template H2 ("Nova is not sure") when the true state is "the owner
will confirm" — a different sentence to a person who is waiting.

---

## 5. Known-not-built, with owners

- **`routes/orders.js` still has its own order path** (FD-1). No parity test exists between it and
  `orderCreate.js`, and one written today would mostly assert deliberate differences. Owner: whoever
  unifies them.
- **No hermetic route-level suite for `POST /orders`.** `orderCreate.test.js` covers the library and runs in
  `npm test`; the route wrapper (body validation, conversation-ownership check, serializer) is covered only
  by `novaStore.selling.integration.test.js`, which needs a real Postgres and is in `test:integration`. On a
  machine with no DB that surface has **zero** coverage. Two files intended to close this
  (`orderCreate.parity.test.js`, `novaStore.orders.test.js`) were lost when the build agents died mid-write
  and were deliberately not reconstructed for their own sake.
- **No taka-denominated discount ceiling exists anywhere.** A FIXED or free-delivery coupon has nothing to
  compare against, so it drafts under `guardrail:inbox_discount_no_ceiling`. That is honest, not enforced.
- **`inbox.maxDiscountPct` (15) vs nova-ai's `DEFAULT_GUARDRAILS.maxDiscountPct` (20).** A tenant with no
  `NovaConfig` row is *told* 20 by the L2 context block while the server refuses at 15. Predates module 05;
  named here so the next reader does not conclude the seeded numbers are the whole story.
- **`cart-recovery.md` still prices its discount rule in dollars** ("carts over $80"). Every number in this
  product is taka. Predates module 05, not fixed here, and it is a 100× wrong threshold.

---

## 6. Baselines

```bash
cd dakio-api && npm test              # 1836 tests, 1835 pass, 1 skipped, 0 fail
cd dakio-api && npm run test:integration  # 108 pass, 0 fail (needs local Postgres :5433)
cd nova-ai   && npx tsc --noEmit      # 0 errors
cd nova-ai   && npm run test:inbox    # 734 checks (selling's 74 folded in)
cd nova-ai   && npm run test:selling  # 74 checks, focused iteration only
cd nova-ai   && npx eve info          # 0 errors, 0 warnings
cd nova-ai   && npm run check:undo    # 20 verbs
cd nova-ai   && npm run check:duty-seed   # 70 duties mirrored
```

Standing traps, unchanged: dakio-api's `package.json` enumerates test files explicitly and `node --test`
tolerates a missing one **silently** — an audit during this module found **18 test files on disk that had
never run**, including tenant isolation and four security suites (all 205 passed; now wired). nova-ai's
`npm test` is still RED at the isolation step (founder context 3085 > 2500, **F-20**) and is an `&&` chain,
so everything after it never runs. Run suites individually.

---

## 7. If you are starting module 06 (Delivery & RTO)

What is waiting for you: `Order.sourceChannel` and `sourceConversationId` on every chat-born order, so a
delivery update can find the thread it was sold in; `reduceOrderEvent` already resolving journeys through
the conversation rung; `inbox.cancelAuto` seeded false and gating a verb that exists nowhere — it is yours;
`OrderItem.variantId` recorded, so an RTO can say *which* variant came back.

What you must not break: the ordering in `checkGuardrails`' `offer_chat_discount` arm (§3), the
at-most-once `novaActionId` read, and `w()`'s claim-first contract — a handler that now takes longer than
`STALE_CLAIM_MS` (60s) would let a second request take over a live claim and reintroduce the double-write.

Budget an hour to re-derive your doc's "already real" column. Module 05's recon found 34 corrections in it.
