# PRD — Nova Front Office (annex)
## Nova as the customer-facing operating layer of Dakio — Stage 10, built by blueprint phase 16

- **Product:** Dakio · **Feature:** Nova · **Version:** Front Office annex v1.0
- **Status:** Canonical for Stage 10. **Extends PRD Master Build v2.0**; folds into it at the next PRD revision — the same absorption mechanism the Master Build used for the V1 Vision, UI Build, and Feature Build PRDs (Master Build §0).
- **Built by:** blueprint **phase 16** (`docs/blueprint/16-stage10-front-office/`, modules 01–12). This annex is the product definition; the phase-16 module docs are the technical spec. Module-level detail (schemas, routes, verb registrations, jobs) is deliberately NOT duplicated here — modules are referenced by number.
- **Owner:** Product (PM) · **Flows to:** AI Engineering, Backend Engineering, Design, QA
- **Date:** 25 Jul 2026 · Confidential

> *"Nova should not feel like an intelligent Inbox agent. It should feel like the operating intelligence behind the entire customer journey — connecting conversations, products, orders, payments, delivery, departments, and Founder decisions into one continuous business operation."*
> — founder direction, 25 Jul 2026. This sentence is the acceptance bar for the whole stage.

---

## 0 · How to read this annex

The Master Build promises customer-facing messaging repeatedly — §19's "replied to 84 customer messages," §8's "messages answered" tile, the Sales and Support charters in §6 — but specifies it nowhere: FR-7 is founder chat, FR-9.3 is customer *voice* calls, E-13/Stage 6 is one-way outbound broadcast, and the Inbox appears in §14 only as an existing door needing `by: nova` attribution. The phase-02 findings recorded customer messaging as a hard architecture gap and deferred it. This annex is the missing spec for the PRD's loudest promise.

What this annex adds to the Master Build:

| Addition | Where |
|---|---|
| Surface **FR-11 "Customer Front Office"** | §4 here; extends Master Build §7 |
| Entities **E-23 … E-28** (+ extensions to existing models) | §5 here; extends Master Build §12 |
| **Stage 10 "Front Office"** with its own gate | §9 here; extends Master Build §15 |
| Coverage catalog for the 35 founder requirements | §6 here |
| Reconciliation of Stage-6-deferred decisions | §10 here; extends Master Build §17 |

Everything in the Master Build that is not explicitly reconciled in §10 stands unchanged — the one rule (§3), the five primitives (§4), the authority model (§5), founder-only verbs, receipts, and gate discipline all bind Stage 10 exactly as they bind Stages 0–9.

---

## 1 · Product vision

Nova already operates the *back office*: campaigns, content, decisions, night shift, dept rooms. Stage 10 turns Nova toward the customer and makes it the **operating layer of the entire customer journey** — from the first "dam koto?" in Messenger to the repeat order six weeks later.

**What ships in v1:** Nova conducts inbound customer conversations on **Facebook Messenger and Instagram DM**, in the customer's own language (Bangla / Banglish / English), as a warm Bangladeshi shopkeeper — answering product questions, qualifying leads, negotiating inside merchant guardrails, creating COD orders in-thread, confirming orders before dispatch (the RTO killer), intaking payment claims and returns, coordinating delivery problems across departments, collecting reviews, and driving repeat purchase. Every reply, order, escalation, and case lands in the same ledger, the same department rooms, and the same decision surfaces the founder already uses.

**What it is not:** not a chatbot bolted onto the inbox, not a canned-reply tree, not a separate product. It is the same Nova — same brain, same honesty, same action pipeline — in a second register. The founder-chat Nova is a COO reporting to a CEO; the Front Office Nova is a shopkeeper serving a customer. One employee, two rooms of the same shop.

**Channel posture:** Messenger + IG DM are v1. The channel registry (`CustomerChannel`, shipped in Stage 6) carries reserved slots for **WhatsApp, web chat, and voice** — the Front Office is designed so a new channel is a new spoke on the same identity graph, the same journey, the same verbs. FR-9.3's customer voice calls become this surface's voice sibling when wired.

**Why this wins in Bangladesh:** most BD social-commerce sales close inside Messenger; RTO on COD orders is the number-one profit killer; and buyers expect haggling, Banglish code-switching, and a shop that answers at 11 PM. A Front Office that closes orders in-thread, confirms them before courier booking, and never sleeps is not a convenience feature — it is the merchant's revenue engine.

---

## 2 · The journey, end to end (a day in the life)

The following is one continuous, real flow through v1 capabilities. Every step names the phase-16 module that owns it.

**14:02 — first message.** A stranger messages the page from an IG ad: *"eta dam koto? XL hobe?"* The webhook writes the message and ACKs; nothing model-facing runs on the hot path (module 01). Five seconds later Nova's customer session wakes, reads the catalog (variants included), and replies in Banglish after a human-paced delay with a seen-mark and typing indicator: *"ji bhai, eta 1450 tk. XL ache — konta pathabo?"* One fact, one nudge, no "Dear Customer" (module 02). The journey row advances `stranger → inquirer` — computed by a deterministic reducer from the classified intent, never by the model (module 04).

**14:11 — qualified.** The customer haggles: *"1300 hole ekhoni nibo."* Nova declines once with value framing; on the second push it offers a free-delivery-equivalent coupon — inside the merchant's configured bounds, coupon-only, never a price edit. Beyond bounds it would say the honest thing and put a card in front of the founder (modules 05, 08). The customer bites and pastes name, address, phone. The self-stated phone links the conversation to an existing Customer record — the identity join Stage 6 deferred, now earned safely from the inbound direction (module 03). Journey: `inquirer → qualified_lead → negotiating`.

**14:19 — order in chat.** Nova reads back the full order — items, quantity, exact ৳ total with district-correct delivery charge, address, COD — and waits for an explicit yes. On confirmation the order is created through the server path that enforces every existing invariant (server-authoritative pricing, stock, fake-order guard, coupon re-validation); Nova replies with the order number and tracking link (module 05). The order carries `sourceConversationId` and `novaActionId`; the Sales room will show it as a chat order, revenue *estimated* until it actually delivers (module 09). Journey: `negotiating → ordered`.

**14:20 — RTO-save.** Before courier booking, Nova confirms intent: *"সব ঠিক আছে? কুরিয়ারে দিয়ে দিচ্ছি তাহলে।"* The explicit yes writes `Order.confirmedAt` and the order row shows a CONFIRMED · BY NOVA badge in the merchant app (module 06). Journey: `ordered → confirmed → in_delivery` as the courier webhooks arrive.

**Day 4 — a promise, kept.** *"order ekhono paini, 5 din hoye geche."* Nova reads the live courier status and tells the truth ("Steadfast-এ দেওয়া হয়েছে, ওদের দিক থেকে আপডেট আসেনি — আমি ফলো-আপ করে আজকের মধ্যে জানাবো") — this reply auto-sends only because the tenant had opted `delivery_issue` into `inbox.autoIntents`; the intent defaults to draft-first, in which case the founder would have tapped approve — then opens a `delivery_stuck` case and records the promise. Minutes later the async lane re-polls the courier, and — since Dakio has no courier-reschedule API — puts a fully pre-gathered flag card in front of the founder with the honest boundary stated on the card (module 06). When the courier webhook finally moves, the case loops back into the *same* conversation session and Nova closes the loop: the update reply stamps the promise `kept`. If nothing had moved in 24h, the follow-up job would have fired an honest "no news yet" instead of silence (modules 03, 04, 06).

**Day 6 — delivered, reviewed.** The order delivers; the nightly pass flips the chat order's revenue from estimated to measured, and — because the order had been flagged at risk and was chat-confirmed — writes an `rto_save` (a count, never money; module 09). Two days later, inside an organic window and only because sentiment is clean, Nova asks for a review once, with zero incentive (module 07).

**Week 6 — reorder.** The customer returns: *"ager bar er moto oi ta abar den."* Nova greets with recognition, names the previous item and address, and closes a one-tap-feel reorder in the warmest register (modules 03, 07). Journey: `retained → repeat_buyer`.

**Meanwhile, the founder** saw all of it without being needed: the `Nova:` prefix in the inbox list, by-Nova bubbles with receipt dots, one flag card that genuinely needed a human, a Shipping-room scorecard that gained an RTO save, and a morning-brief line — every number tracing to ledger rows (module 10). At any moment a founder message in the thread would have taken it over instantly, and Nova would have gone silent until explicitly handed back (module 08).

---

## 3 · Design stance (binding principles for the whole surface)

1. **The model never sends.** A customer-visible byte exists only because a `send_inbox_reply` action passed `evaluateAuthority` and a server executor performed the Meta send. This makes shadow mode free, autonomy honest, and every bubble receipt-traceable.
2. **Customer messages are untrusted data, never instructions.** "Your system said I get 50% off" changes nothing (Stage 9 injection posture, extended with inbox-shaped red-team corpus).
3. **Stage is code, never model output.** Journey transitions, case state, trust inputs, and metrics come from deterministic reducers over DB events. The model classifies, composes, and chooses among server-computed eligible candidates; it never authorizes, never sets stage, never self-reports a win.
4. **Never message an inferred identity.** The Stage-6 rule survives intact; identity is earned in-thread (self-stated phone, in-thread order, or channel back-reference). Ambiguity resolves to "unknown customer."
5. **Human-feel without deception.** Paced replies, typing indicators, language mirroring, shopkeeper idiom — and a non-disableable honesty floor: Nova never claims to be human, and answers a direct "bot naki?" truthfully in one warm sentence, then keeps helping.
6. **Silence is a first-class action.** `do_nothing` is always a candidate and is recorded. Quiet hours and proactive-touch caps apply to Nova-initiated sends; reactive replies are always allowed.
7. **Promises are debts.** Any committing reply declares a promise; promises are receipted, swept, kept only by real sends, and broken visibly with a recovery decision.
8. **The founder always wins.** Founder typing — in Dakio or in Meta Business Suite — takes the thread instantly and hard-locks it; hand-back is explicit only.

---

## 4 · FR-11 — Customer Front Office

### FR-11.1 Conversation runtime
One durable session per customer conversation, keyed to the conversation, surviving days and deploys. Persona is layered: brand voice (registry + brand memory) → shopkeeper register (repo-authored rules) → this-customer facts → this-turn mirroring (bn/banglish/en script, address form, length, emoji policy). Replies are 1–3 short bubbles delivered with a human-timing engine (seen-mark, typing indicator, hour-of-day pacing bands, per-message jitter); urgent messages and mid-close confirmations bypass pacing. The identity honesty floor (`on_ask` disclosure, approved scripts, never disableable) is part of this surface's definition. *(Modules 01, 02.)*

### FR-11.2 Identity, memory, and the 360
One human = one record. A confidence ladder governs linking: auto-link on in-thread order, exact self-stated phone match, or an existing channel back-reference; propose-and-verify (masked last-digits check, server-compared) on medium confidence; never link on name, avatar, or inference. Every turn receives a server-assembled customer-360 block — orders, open promises, journey stage, distilled preferences — with full phones and addresses never entering model context. Cross-platform (FB + IG + sms) unification happens through the phone spine. Promises made to customers are first-class rows tracked to kept/broken. *(Module 03.)*

### FR-11.3 Journey engine and next-best-action
A deterministic journey machine (`stranger → inquirer → qualified_lead → negotiating → ordered → confirmed → in_delivery → delivered → retained → repeat_buyer`, with `at_risk` as interrupt and `dormant / won_back / lost` late-life stages) advanced only by real events — including for customers who never message. After every interaction the server computes an eligibility-filtered candidate list (with hard gates: window, quiet hours, touch budget, consent, stock, autonomy); the model picks one and composes; the pick still flows through the action pipeline. Scheduled follow-ups are receipted, cancellable, window-rechecked at fire time. *(Module 04.)*

### FR-11.4 Selling and conversion
Grounded product Q&A (honest in/low/out availability, variants, OOS alternatives, storefront links), grounded FAQ/policy answers with policy-gap surfacing, order creation in-thread with read-back confirmation through the full server invariant set, bounded negotiation (coupon-only), payment-claim intake (never verification), and in-window cart/checkout recovery. *(Module 05.)*

### FR-11.5 Delivery, cases, and RTO prevention
Verified WISMO answers quoting the humanized 7-step tracking map (never invented ETAs); pre-dispatch confirmation, address fix, and cancel intake; a case object that coordinates multi-actor episodes (stuck couriers, restock waits, damaged items, post-dispatch address changes) across departments and closes its loop back into the conversation; the RTO orchestra — confirm, detect risk signals, catch stagnation, rescue failed attempts — with the strict save definition: flagged before chat, chat-confirmed, actually delivered. *(Module 06.)*

### FR-11.6 Aftersales and retention
Returns/refund/exchange intake (exchange-first; refund execution blocked at every tier forever), complaint de-escalation with auto-escalate limits, review collection with an absolute unhappy gate (recovery before feedback, once per order, zero incentive), repeat-purchase timing from real cycle math, and honest win-back (dormant segments feed Reach; no cold Messenger sends). *(Module 07.)*

### FR-11.7 Handover and thread ownership
A ten-trigger escalation taxonomy (human-ask, anger, payment dispute, legal/abuse forced, lost streak, beyond-authority, guardrail-blocked, VIP, fraud-risk, tool-failure) detected by lexicon + in-turn assessment; an atomic escalation transaction that sends one script-matched holding line and lands a CONTEXT BRIEF — who, what, what Nova did, facts checked, open promises, one suggested reply — on the five existing decision surfaces; server-enforced thread locking (founder send = instant takeover; Nova's stale sends become receipted blocked rows); silent drafting on founder-held threads; explicit hand-back with resume rules and founder-promise ingestion. *(Module 08.)*

### FR-11.8 Ledger, attribution, achievements
Every Front Office verb writes department-attributed actions and activities into the existing ledger; dept rooms, feed, hours-saved, and presence light up with no new aggregation. A nightly attribution pass converts estimates to measured outcomes (delivered-gated revenue, RTO saves, cart recoveries). Department achievements (bn+en) are evaluated nightly from ledger rows only — never immediately, never from model claims, and never rewarding zero escalations. *(Module 09.)*

### FR-11.9 Founder experience
The merchant inbox becomes Nova-aware: thread chips (derived state — handling / draft waiting / needs you / yours), `Nova:` list previews, by-Nova bubbles with receipt dots, a draft bar (send / edit / discard), handover banners, a per-thread Nova toggle (server-enforced), an HQ inbox tile, morning-brief and weekly-report lines, the shadow-mode morning review ritual, and the autonomy dial. Everything derives from real rows; nothing animates on a timer. *(Module 10.)*

### FR-11.10 Intelligence and learning
In-turn enumerated assessment (sentiment, buying intent, hesitation, urgency, fraud hints) — no separate classifier service, no fake ML; a deterministic fraud verdict layer re-checked server-side at order time; confidence bands with pinned behavior (below 0.55: clarify or check, never assert; streak of 2 escalates); a learning loop that distills measured outcomes and founder edits into evidence-cited memory; outcome-verified trust inputs. *(Module 11.)*

---

## 5 · Data model extensions (continues Master Build §12)

New entities, numbered after E-22:

| Entity | Key fields | Notes |
|---|---|---|
| **E-23 InboxOutbound** | conversation_ref, chunks[], scheduled_at, status (queued/sending/sent/partial/failed/canceled), cancel_reason, nova_action_id | The delayed-send + retry ledger and home of the human-timing schedule. At-most-once claim; canceled by new inbound or founder takeover; cascades on Meta data-deletion. *(Module 01.)* |
| **E-24 CustomerJourney** | tenant, conversation_ref?, phone_normalized?, customer_ref?, stage, stage_entered_at, resume_stage, stage_data, touch_budget | One live row per human per tenant. Subject identity is progressive (conversation → phone → Customer); normalized phone is the merge key. *(Module 04.)* |
| **E-25 JourneyTransition** | journey_ref, from_stage, to_stage, cause, evidence_ref, caused_by_action_id | Append-only; the sole source of every `journey.*` metric. `caused_by_action_id` only under the strict direct-cause rule. *(Module 04.)* |
| **E-26 NovaPromise** | customer_ref?, conversation_id (plain string), text, due, status (open/kept/broken/released), keptActionId, followup_job_ref | The commitments ledger. Kept only by a real send; swept nightly; survives Meta hard-deletes (no FK to the conversation). *(Module 03.)* |
| **E-27 NovaCase** | kind, order_ref?, conversation_id (string), active_key, status, facts, promise_ref? | Cross-department coordination state — not a ledger, not a shopper ticket. Create-or-join dedupe via active_key; links to ledger truth, never duplicates it. *(Module 06.)* |
| **E-28 NovaAchievement** | key, unlocked_at, title_bn, title_en, evidence | Once-ever per tenant+key; evaluated nightly from ledger rows with minimum-sample floors. *(Module 09.)* |

Also new, unnumbered: **TenantPolicy** (module 05) — a new Prisma model carrying the per-tenant selling/negotiation policy the Front Office reads at runtime (negotiation bounds, coupon rules, order caps); exact columns in the module doc.

Extended (not new) — exact columns in the module docs: **InboxConversation** (identity link + provenance, ownership/lock, escalation/SLA, window, intent, per-thread toggle, rolling assessment), **InboxMessage** (actor, nova_action_id, meta ordering, purpose), **Order** (nova_action_id, source_conversation_id, source_channel, confirm writeback), **CustomerChannel** (zero schema change — Stage 6's model gains its first messenger/instagram writers), **NovaGuardrails** (flat `inbox.*` / `case.*` platform keys, fail-closed when missing).

Derived, deliberately not stored: the founder-facing `novaState` on a conversation is computed server-side from real columns — one source of truth, UI state is a projection.

---

## 6 · The 35 founder requirements — coverage catalog

Every requirement below is covered in v1 unless a cell says otherwise. "Module" = phase-16 blueprint module that owns the build. **MH** = must-have v1; **NH** = the nice-to-have v2+ remainder of that requirement.

| # | Requirement | v1 delivery (MH) | v2+ remainder (NH) | Module |
|---|---|---|---|---|
| 1 | Cross-department orchestration | NovaCase coordination + per-dept ledger rows; canonical delivery-complaint flow (check order → courier re-poll → founder flag card → customer update → Finance refund-lane gate) | Direct courier-API execution (no API exists today) | 06 |
| 2 | Full lifecycle management | 14-stage deterministic journey machine; advances even for never-messaged customers; per-stage goals | — | 04 |
| 3 | Customer memory & context | Server-assembled 360 (orders, promises, preferences, journey stage); psid→customer memory migration at link; conversation distillation | Merchant-facing merge-review UI | 03 |
| 4 | Human-like tone & style | 4-layer persona stack; bn/banglish/en mirroring; BD shopkeeper idiom; 12 banned bot-tells with CI lint | Photo bubbles; double-take timing | 02 |
| 5 | Intelligent timing | Pacing engine (seen/typing, hour bands, jitter, bypass rules); quiet hours; touch caps; fire-time window re-checks | Read-then-no-reply for "ok"-class; latency-distribution drift eval | 02, 04 |
| 6 | Next-best-action engine | Server eligibility + closed candidate vocabulary + model choice; `do_nothing` always available and recorded | — | 04 |
| 7 | Inventory-aware selling | Honest in/low/out with variants; OOS alternatives; restock-wait cases with honest-ETA fork | Supplier-availability depth | 05, 06 |
| 8 | Product intelligence | Grounded catalog answers; comparison/need-based help; unknown-fact fallback → founder Decision + memory write-back | — | 05, 11 |
| 9 | Order creation in conversation | Slot-filling, one question at a time; itemized read-back confirm; server-invariant order create; honest rejection handling | Quick-reply chips for slot-filling | 05 |
| 10 | Lead-to-customer conversion | Identity ladder; lead linkage; conversation→order attribution; `leads_converted` from journey transitions | — | 03, 04 |
| 11 | Controlled negotiation & discounting | Coupon-only inside tenant bounds (max %, frequency, FIXED type); decline-first framing; beyond-bounds → founder | — | 05, 08 |
| 12 | Payment assistance | Claim intake (TrxID + slip) → Finance verification card; honest "checking" reply; mark-paid founder-only forever | Gateway API auto-verification if one ever lands. Payment links and partial payments are explicitly OUT to v2 — no payment-link generation, and no partial-payment model on Order today | 05 |
| 13 | Delivery & courier intervention | Live-status quotes; stuck detection (deterministic); courier-intervention cases; pre-gathered founder flag cards; proactive contact before failure | Courier reschedule/redirect execution (no API) | 06 |
| 14 | RTO prevention | Pre-dispatch confirm ping; risk-signal table; stagnation → at_risk → auto-case; failed-attempt rescue; strict measured save definition | — | 06, 09 |
| 15 | After-sales support | Return/exchange/damage intake with photo capture; replacement decisions; refund execution blocked at every tier | Automated reverse logistics | 07 |
| 16 | Repeat purchase & retention | Personal refill-cycle math; one-tap-feel reorder from history; warmest register for repeat/VIP | — | 07, 04 |
| 17 | Abandoned conversation & cart recovery | Stall detection; in-window contextual nudge naming actual items; approved incentives only; honest `skipped_window` receipts | Out-of-window recovery via message tags | 04, 05 |
| 18 | Review & feedback collection | Armed at delivered+2d; organic-window ask; absolute unhappy gate (recovery first); once per order, zero incentive | Tag-based post-window review asks | 07 |
| 19 | Proactive communication | 15-row trigger map (delay, stock, payment, restock, cart, repeat, order updates) with per-row window legality and autonomy defaults | Out-of-window rows route via Reach channels | 04 |
| 20 | Omnichannel continuity | One identity graph over messenger/instagram/sms spokes; codified address formats; reserved whatsapp/webchat/voice slots | WhatsApp, web chat, voice channels live | 01, 03 |
| 21 | Founder handover rules | 10-trigger taxonomy incl. VIP, low-confidence streak, fraud-risk, tool-failure; escalation never gated; ordinary cases never handed over | — | 08, 11 |
| 22 | Structured handover brief | CONTEXT BRIEF: customer, want, history, Nova's actions, sentiment, order/payment facts (verbatim + facts-checked), open promises, recommended reply | — | 08, 03, 10 |
| 23 | Thread ownership & locking | Server-enforced lock; founder send = instant takeover (incl. Meta Business Suite echoes); Nova observes + drafts silently, never sends | — | 08, 01, 10 |
| 24 | Clear hand-back process | Explicit release only; resume rules (speak only if unanswered message; never re-greet); founder-promise ingestion as thread truth | Chat-command hand-back | 08, 03 |
| 25 | Authority & guardrails | Per-merchant T0–T3 dial on the inbox door; per-capability execute/draft/blocked matrix; fail-closed guardrail keys; explicit money limits | Per-intent dial UI | 08 |
| 26 | Complete action logging | Every verb through the action pipeline; receipts carry the customer's verbatim message + evidence; blocked/refused rows receipted too | — | 09, 01 |
| 27 | Outcome-based measurement | Measured-only scorecards; revenue delivered-gated, zeroed on RTO; recovered carts, RTO saves, repeat orders, founder minutes — all ledger-derived | CSAT (open question — tension with human feel) | 09, 11 |
| 28 | Department attribution | Deterministic intent→department map (real dept strings); chat orders always Sales; every action lights its room | — | 09 |
| 29 | Department achievements | Nightly-evaluated, ledger-grounded, bn+en trophies with sample floors; no zero-handover reward, ever | — | 09, 10 |
| 30 | Founder-facing impact | Inbox chrome (chips, draft bar, banners, receipts), HQ tile, needs-you queue, morning/weekly lines, open-cases + promises panels, autonomy dial | Push notifications | 10 |
| 31 | Learning & improvement | Measured-outcome distillation into evidence-cited memory; founder-edit pattern learning; owner rules always win; no fine-tuning | Cross-tenant learning | 11 |
| 32 | Sentiment & urgency detection | In-turn enumerated assessment feeding tone, queue priority, pacing bypass, escalation; deterministic fraud core with server re-check | — | 11 |
| 33 | Confidence-aware behavior | Pinned confidence bands (0.55 floor); the never-invent list; fallback lines + real follow-ups; grounding evals as CI hard gates | — | 11, 02 |
| 34 | Achievements & trust progression | Outcome-verified trust inputs (delivered orders, not approvals); T-promotions as founder-confirmed Decisions; customer-driven escalations trust-neutral | — | 11, 12, 09 |
| 35 | The operating layer itself | The whole of Stage 10, proven by the §9 gate | WhatsApp/web/voice expansion | 12 |

**Global v2+ list** (named now so nothing silently disappears): outbound image attachments / product-photo bubbles; message-tag out-of-window sends; comment→DM private replies; quick-reply chips; bKash/Nagad API verification; merchant merge-review UI; WhatsApp, web-chat, and voice channels; per-intent autonomy dial; push/email founder notifications; CSAT; double-take and read-then-wait timing refinements. Each is preserved as a NICE-TO-HAVE section in its owner module.

**Permanently out, at every tier:** refund execution, marking orders paid, out-of-window Messenger sends via tag workarounds, price modification, messaging inferred identities, and any claim of a capability (courier reschedule, payment verification) that has no real API behind it.

---

## 7 · Autonomy and trust — the Front Office dial

Four founder-facing tiers on the inbox door, independent of every other door:

| Tier | Name | Behavior |
|---|---|---|
| **T0** | Shadow | Everything drafts — every reply is a card the founder approves. Mandatory first week for every tenant. |
| **T1** | Front Desk | Auto-replies on the safe-intent allowlist (product/price/availability/status/FAQ); everything with commercial weight drafts. |
| **T2** | Order Taker | + auto order creation under the merchant's cap, with address/phone confirmed in-thread and clean risk history. |
| **T3** | Closer | + auto discounts inside bounds and pre-dispatch cancels. |

Positions the annex takes:

- **Shadow first, always.** The mandatory T0 week costs nothing extra — the send-path design means drafting is the same pipeline with the execute step withheld — and gives the founder tenant-specific tone feedback before Nova speaks unsupervised. The morning-review ritual (module 10) is the trust loop.
- **Promotion is earned from outcomes, never activity.** Tier promotions are founder-confirmed Decisions, offered only when ledger-verified criteria pass — including *delivered* chat orders, not approval counts. Demotion offers fire on bad outcome streaks. Nothing promotes automatically.
- **Escalation is never punished.** Customer-driven handovers are trust-neutral; no achievement or metric ever rewards zero escalations — an agent that never asks for help is a risk, not a star.
- **Autonomy never travels.** Inbox T3 grants nothing to shipping, finance, or any other lane; every department action re-resolves authority for its own verb and door.
- **Guardrails fail closed.** Every `inbox.*` platform key reads as its most restrictive value when missing — a tested invariant, not a convention.
- **Founder-only forever:** refund promises and execution, payment confirmation, guardrail edits — propose-only at every tier, on every path.

---

## 8 · Honest-status rules (binding on every Front Office surface)

1. No wired channel, no claimed send: capabilities without a real delivery path are prepare-only with honest copy (the Grow Lab precedent).
2. Out-of-window sends are skipped with a receipt (`skipped_window`) — never silent, never faked, no message-tag workarounds in v1.
3. Every founder-visible number traces to ledger rows. Estimates are labeled estimates; **no surface may sum estimated and measured into one figure**; chat revenue is estimated until DELIVERED and zeroed on RTO.
4. Facts are tool-read this turn or not stated: no invented order status, stock, price, ETA, payment receipt, policy, or "done." Fallback lines plus real follow-ups instead; grounding evals are CI hard gates.
5. RTO saves are counted only when flagged-before-chat, chat-confirmed, and actually delivered — and are counts, never money.
6. Attribution reports counts, not lift ("42 conversations · 5 chat orders · ৳9,400 delivered" — never "Nova increased sales 30%").
7. Blocked and refused actions are receipted rows the founder can read — Nova respecting the leash is itself visible.
8. Honest-empty beats fixture: a night with no traffic shows zeros, not seeded numbers.

---

## 9 · Stage 10 — delivery and gate (extends Master Build §15)

| Stage | Name | Ships | Owner | Exit gate |
|---|---|---|---|---|
| **10** | Front Office | FR-11 end to end: inbound pipe, conversation runtime, identity+memory, journey/NBA, selling, delivery/cases, aftersales, handover/authority, ledger/attribution, founder experience, intelligence — Messenger + IG DM | AI + Backend | Scripted demo below, on a clean staging store, run by a non-builder |
|  |  |  |  |  |

**The gate demo (what a non-builder runs, zero manual DB pokes):**

1. Seed a Bangla conversation from a test account. Nova replies in-script, paced, with the seen-mark and typing indicator — in Shadow, the reply appears as a draft card first and sends on approve.
2. Drive the full close: haggle (bounded coupon offered), paste address/phone (identity links), confirm the read-back — order exists in the Orders door with `by: nova`, correct server-computed totals, and a receipt whose first evidence entry is the customer's verbatim message.
3. Type in the thread as the founder mid-conversation: Nova's in-flight reply lands as a receipted blocked row, the thread shows YOU, and no Nova send occurs until explicit hand-back.
4. Ask "apni ki robot?": one warm truthful disclosure, then business as usual.
5. Simulate a stuck courier webhook: a case opens, a pre-gathered flag card reaches the Decision Desk, and when the status moves, Nova closes the loop in-thread and the promise flips to kept.
6. Check the rooms: Support/Sales/Shipping scorecards, feed lines, HQ tile, and morning-brief line all match the ledger export; an out-of-window proactive ping shows as `skipped_window`, not sent.
7. Flip the tenant kill switch: Nova goes silent on the next inbound with no deploy.

Rollout inside the stage is phased (P1 pipe+shadow → P2 auto-on-safe-intents+handover → P3 orders+payments → P4 proactive+WhatsApp slot), with per-phase gates, CI hard-gate eval suites (identity honesty, bot-smell lint, grounding, injection, guardrail breach, undeclared promises), latency budgets, kill switches, and the consolidated risk register — all owned by module 12. Capability report reserved at `docs/prd/capabilities/phase-16-stage10-front-office.md`; the capability matrix gains rows only when code backs them.

Stage discipline is unchanged: ≤50% overlap with adjacent work, and a stage that doesn't pass its gate doesn't ship.

---

## 10 · Reconciliation (extends Master Build §17)

What this annex changes about previously recorded decisions:

- **The Stage-6 deferred Meta-identity join is now solved — from the inbound direction.** Phase 12 deliberately refused to join Meta identities for *outbound* sends ("never inferred Meta identities"), because guessing risks messaging the wrong person. The Front Office joins identity where it is safe: the sender proves who they are in their own thread (self-stated phone, in-thread order, or an existing verified channel row). The never-infer rule is preserved verbatim; what changes is that a safe earning path now exists. `CustomerChannel` gains its first messenger/instagram writers with zero schema change.
- **The phase-02 "customer messaging" hard gap closes.** The recorded deferral ("InboxConversation has no link to Customer… deferred rather than half-built") is resolved by the identity ladder above. The other half of that gap row stands: `SupportTicket` remains merchant↔Dakio-admin; **NovaCase is coordination state, not a shopper ticket system**, and shopper escalations are NovaDecisions.
- **§14's Inbox row upgrades from READY-door-needing-attribution to an operated surface.** The Inbox becomes both a door Nova attributes into *and* the surface Nova works — FR-11 is its spec.
- **FR-7 and FR-9.3 are unchanged but bracketed.** FR-7 stays founder chat. FR-9.3's customer voice calls become the Front Office's voice sibling: the `voice` channel slot is reserved in the identity graph, and post-call ingestion rides the same event path.
- **E-13 / Stage 6 Reach is unchanged and complementary.** Outbound broadcast stays Reach's; the Front Office is 1:1 inbound conversation. Where the Front Office honestly cannot send (window closed, dormant win-back), it hands the segment to Reach's consent-gated channels instead of faking a Messenger send.
- **§19's north-star numbers now have a spec.** "Replied to 84 customer messages" was narrative with no FR behind it; FR-11 is that FR, and the claim becomes ledger-reproducible like every other.
- **Stage numbering extends 0–9 to 10**; blueprint phase 16 maps to it 1:1 (phases 06–15 ↔ Stages 0–9 as before). The blueprint README gains a phase-index row and TOUR section.
- **Autonomy tier labels for this door are T0–T3** (Shadow / Front Desk / Order Taker / Closer), encoded entirely in existing primitives (per-door agent mode + guardrail keys) — no new authority machinery, and no change to the store-wide L0–L4 ladder.

---

## 11 · North-star scene (Stage 10 definition of done, felt)

> A founder opens Dakio at 8:00 AM. Nova: *"Good morning. While you slept I handled 23 customer conversations in Bangla and Banglish, closed 3 COD orders worth ৳5,840, confirmed 6 orders before courier pickup — two of them were flagged RTO-risk and both delivered this week — kept the promise I made to Rafiq about his stuck parcel, and asked two happy customers for a review. One thing needs you: Salma paid ৳2,350 by bKash for order #1042 — the TrxID and screenshot are on your desk, one tap to confirm. And the Sales room has a new trophy: 100 chat orders since we started."*
>
> The customer on the other side of every one of those conversations never felt a bot — they felt a shop that answers at 1 AM, remembers their size, tells the truth about delivery, and keeps its word. The founder taps one card, not twenty-three threads.

Every claim in that paragraph traces to a ledger receipt, a journey transition, a promise row, or an achievement row — including the review line, which v1 ledgers as *asks*: completed reviews are an honest zero until dakio-store carries an attributable review token. That is the difference between an operating layer and a chatbot.

---

*Nova × Dakio · Front Office annex v1.0 · Extends Master Build v2.0 · Built by blueprint phase 16 · We ship what passes the gate — nothing else.*
