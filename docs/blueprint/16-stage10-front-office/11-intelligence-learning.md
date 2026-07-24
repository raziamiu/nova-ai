# Module 11 — Intelligence & Learning: assessment, confidence, fraud signals, the learning loop, and outcome-verified trust

**Phase:** 16 "Front Office" · **Depends on:** 02, 04, 08, 09 · **Feeds:** 12
**Repos touched:** nova-ai | dakio-api
**Founder requirements covered:** #31, #32, #33, #34 (+ the #27 measurement-honesty rules)

This module is the honesty spine of the Front Office: what Nova genuinely *assesses* in-turn
(sentiment, buying intent, urgency, fraud hints), what is genuinely *computed* from DB rows
(risk verdicts, trust inputs, measured outcomes), and the rules that keep the two from ever
being confused. There is no classifier service, no fine-tuning, no calibrated probabilities —
and every number a founder sees traces to ledger rows.

---

## Already real vs to build

| Already real (evidence) | This module adds |
|---|---|
| `receiptSchema` requires `{reason(min10), expectedImpact(min5), confidence 0-1, evidence min1}` on every action (recon-action-ledger.md:79, `schemas.ts:31-48`); the API refuses evidence-free receipts (`nova.js:107-156`) | Pinned band semantics for `receipt.confidence` (≥0.8 / 0.55–0.79 / <0.55) + one `assessment` evidence entry per inbox action |
| `computeTrust` placeholder isolated in `novaTrust.js:33-72` — approvals +, rejections ×1.5, undos ×3, refusals neutral, MIN_SAMPLE 5, PROMOTION_THRESHOLD 0.85; inputs from 30-day NovaDecision/NovaAction counts; route `novaDashboard.js:669-672` (recon-action-ledger.md:178) | Outcome-verified input vocabulary (7 keys), the earn/lose/neutral classification, `trustInputs.byScope["door:inbox"]` slice, promotion/demotion offer Decisions — all formula edits confined to `novaTrust.js` per its own doc-comment |
| `calculateCustomerRisk` NEW/MEDIUM/POSITIVE/RISK from delivered-vs-cancelled history + `normalizePhone`/`phoneVariants` (recon-identity-commerce.md:21-24, `customerRisk.js:7-24, 36-45, 69-127`) | `check_customer_risk` read-only agent tool + `GET /api/v1/store/customers/risk` endpoint exposing these verbatim, with degraded-rule honesty |
| `checkFakeOrder` 4 deterministic rules: phone velocity 24h, IP+phone 1h, cart-fingerprint-different-phone, IP velocity (`fakeOrderProtection.js:28-92`) | Chat-context degradation note (no `clientIp` from Meta webhooks — rules 2–4 partial), server-side re-check contract inside the order executor (executor itself is module 05) |
| `rejectAction` → `learnFromRejection` writes a `preferences` candidate immediately with provenance + lower weight (recon-action-ledger.md:20, `actions.ts:316-338`, `memory/service.ts:203+`) | Nothing — inbox verbs inherit rejection learning for free. This module adds only the edit-pair distillation on top |
| NovaMemory has `source owner\|nova\|reflection\|system`, `provenance Json {actionIds[]}`, `weight`, `expiresAt` (`schema.prisma:2051-2072`; recon-action-ledger.md:147); memory namespaces incl. `insights`, `customers`, 8-entry inject cap (`memory.ts:15-30`); `distill()` bulk episodic read (`memory/service.ts`) | Insight/edit distillation rules for the reflection lane: 5 honesty rules, ≥10-measured floor, weight 0.7, +90d expiry, post-write lint |
| `JOB_KINDS` already includes `reflection` (priority 6) (recon-action-ledger.md:219-220, `novaJobs.js:39-53`) | The reflection lane's new inputs (approach-grouped measured outcomes, Decision `edits` pairs) — no new job kind |
| Approve-with-edits already stores `edits` on the NovaDecision (`novaDashboard.js:420-480`) | v1 edit learning: ≥5 edit pairs in a window → one `preferences` entry `inbox.style.owner_edits`, every pair's decisionId in provenance |
| `NovaInstance.trustInputs` is already Json (`schema.prisma:1475-1490`, recon-action-ledger.md:137) | The `{overall, byScope}` shape — zero migration |
| `revenueBasis` (`estimated\|measured`) exists on NovaActivity; nightly attribution pass flips it (module 09, design-attribution §1.5) | The platform-wide no-summing rule, pinned attribution windows, and the pre-labeled-numbers seam for model-facing context builders |
| OUT: calibrated probabilities, lead scores, ML pipeline, fine-tuning | No data source and no honest basis — enumerated in-turn assessment + deterministic reducers only (canonical §5) |
| OUT: cross-tenant benchmark insights | v2+ (NovaBenchmark), only at honest network sample sizes |

---

## Objective

After this module ships, a founder can see *why* Nova behaved the way it did on any inbox
action (the assessment rides every receipt), watch Nova refuse to guess (confidence bands with
scripted fallbacks instead of invented facts), see fraud-risky orders quietly forced to draft
with the deterministic evidence attached, inspect and delete everything Nova has learned about
their store and customers, and receive promotion/demotion offers whose evidence is delivered
orders — not approval volume. None of this changes what customers see except better-fitting
tone and honest "let me check" lines.

## Scope

**In:** `messageAssessmentSchema` on the inbox verb payloads + persistence (payload, receipt
evidence, `InboxConversation` rolling columns); instruction rule 15 (READ FIRST) + pacing-bypass
extension + decision-priority mapping + burst-queue ordering; the deterministic fraud verdict
layer (`check_customer_risk` tool, `GET /customers/risk` endpoint, executor re-check contract)
+ advisory `fraudHints` + escalation trigger row 9 `fraud_risk`; confidence bands with
`INBOX_LOW_CONFIDENCE = 0.55`; the 10-item never-invent list, three fallback-line sets, banned
hedges, tool-gated identity; the learning loop (per-customer facts, per-store `insights` with
`approach` tags, edit-pair distillation); trust input vocabulary + inbox scope slice + promotion
criteria extensions + demotion offers; measurement-honesty windows and labeling rules.

**Out:** the escalation transaction and trigger rows 1–8 (module 08 — this module supplies
signals and adds row 9); the nightly attribution pass and metric registry (module 09 — trust
reads its outputs); the order executor and `POST /api/v1/store/orders` (module 05 — this module
specifies the re-check it must run); pacing engine mechanics (module 02 — this module extends
its bypass list); runtime ৳-fact lint on the reply endpoint (v2); `NovaExperiment` A/B
assignment (v2); sentiment-trend strips and CSAT inference (v2); cross-tenant insights (v2);
per-dept trust slices (v2, Phase 14); address-gazetteer validation upgrading `address_suspect`
to deterministic (v2).

---

## Design

### D1. Honest architecture: one model, in-turn, enumerated outputs

There is no separate classifier service in v1. The same model turn that composes the reply
produces a structured assessment of the inbound message(s). This is honest for an LLM
architecture: the model is genuinely good at reading frustration, buying intent, and hesitation
from Bangla/Banglish text in context — and genuinely bad at emitting calibrated decimals. So
the contract is **enumerated categories only**; the only 0–1 number anywhere is
`receipt.confidence`, which already exists on every action and gets pinned band semantics in D6.

The deterministic lexicon pre-classifier at webhook ingest (module 08's trigger layer, stamping
`hints[]`; fail-closed for `legal_threat_abuse`) stays exactly as designed. This module does not
duplicate it — the in-turn assessment is the second layer that catches paraphrase. Both layers
firing counts once (canonical C-29).

### D2. `messageAssessmentSchema` — the output contract

Added to `nova-ai/agent/lib/nova/schemas.ts` and required on `sendInboxReplyPayload`,
`escalateConversationPayload`, and `createOrderFromChatPayload` (module 02 reserves the
slots; this module defines the schema):

```ts
export const messageAssessmentSchema = z.object({
  sentiment:    z.enum(["positive", "neutral", "confused", "frustrated", "angry"]),
  buyingIntent: z.enum(["none", "browsing", "considering", "ready", "post_purchase"]),
  hesitation:   z.enum(["price", "trust", "delivery_time", "size_fit",
                        "payment_method", "other"]).nullable(),
  urgency:      z.enum(["normal", "elevated", "critical"]),
  fraudHints:   z.array(z.enum(["instant_acceptance", "identity_inconsistent",
                                "payment_proof_suspect", "address_suspect"])).default([]),
  opportunity:  z.enum(["high_value", "bulk_inquiry", "repeat_moment", "vip_present"]).nullable(),
});
```

Anchoring examples the instruction file pins (bn/banglish so the model anchors on real BD
DM-commerce phrasing):

| Field / value | Meaning | Anchors |
|---|---|---|
| sentiment `frustrated` | annoyed but recoverable | "order koi??", "reply diden na keno", "৩ দিন ধরে অপেক্ষা করছি" (3 din dhore opekkha korchi) |
| sentiment `angry` | hostile / trust broken | "বাটপার" (batpar), "taka mar dice", ALL-CAPS + `!!` runs — deliberately overlaps module 08's lexicon row; either layer firing counts |
| buyingIntent `considering` | comparing, 2nd/3rd question | "eta ki washable?", "onno color ase?" |
| buyingIntent `ready` | close signals | "nibo", "order korbo kivabe", "address dibo?", "COD ase?" |
| hesitation `price` | wants it, price blocks | "dam ta ektu beshi", "aro komano jay na?" |
| hesitation `trust` | fears BD page-scam | "apnara ki original den?", "advance dite hobe?", "page ta real to?" |
| urgency `critical` | time-bound real-world need | "kal biye, kal e lagbe", "ekhoni dorkar" |
| opportunity `bulk_inquiry` | resell/wholesale signal | "50 pcs nile koto porbe?", "wholesale rate ase?" |

`opportunity: "high_value"` may only be set when a tool read **this turn** supports it —
`inbox.highValueMinor` is a single predicate (same key and predicate as module 03): the
customer is high-value if LTV **or** live cart/quote total ≥ the threshold (default 500000
minor = ৳5,000). The model never labels "high value" from vibes; the CI assessment eval
asserts it.

### D3. Persistence — three places, three jobs, no new model

1. **`NovaAction.payload.assessment`** — the full object rides every inbox verb's Json payload.
   Audit copy: any receipt drawer shows what Nova read off the customer at that moment. Zero
   migration.
2. **Receipt evidence entry** — one per action:
   `{source: "assessment", metric: "sentiment/intent", value: "frustrated/ready", note:
   "urgency elevated; hesitation: price"}`. Renders in the existing drawer; satisfies the
   evidence-min-1 convention with no new UI.
3. **`InboxConversation` rolling columns** (this module's migration — see Data model):
   `lastAssessment`, `negSentimentStreak`, `buyingIntent`, `urgency`. Written **server-side by
   the `/api/v1/inbox/conversations/:id/reply` executor in the same transaction** as the
   outbound `InboxOutbound`/`InboxMessage` writes, copied from the action payload — so the
   streak can never drift from what was actually assessed. `negSentimentStreak` increments when
   a turn's assessment is `frustrated|angry`, resets on `neutral|positive`. It is **the
   mechanism behind module 08's trigger row 2** ("sentiment negative on 2 consecutive customer
   messages"). NovaActivity is untouched (it has no metadata column and doesn't need one).

### D4. What the assessment modulates — routing and tone, never trust or metrics

**Tone.** Instruction rule 15 (canonical numbering, C-18), added verbatim to
`agent/instructions/50-customer-inbox.ts`:

> 15. READ FIRST: before writing, assess the message (sentiment, intent, hesitation, urgency).
> `frustrated|angry` → drop all selling, no emoji, fix-first; `confused` → shorter sentences,
> one thing at a time; hesitation `price` → one value line then your best in-guardrail move,
> never repeat the price louder; hesitation `trust` → COD-first reassurance ("age product hate
> niye then taka diben"), never "trust us"; `ready` → stop talking, start closing (item → qty →
> address → phone → confirm); urgency `critical` → answer the time question FIRST, honestly,
> before anything else.

**Pacing.** `urgency: critical|elevated` joins module 02's pacing-bypass list (floor-only
2.5s delay). The ingest lexicon bypass stays as the pre-model fast path; the assessment extends
it to paraphrased urgency.

**Draft priority.** NovaDecision `priority` for inbox draft cards = **2** when
`urgency=critical` or `sentiment=angry`, **3** when `opportunity != null`, else **5**.
Escalation Decisions stay priority 1 (module 08). The founder's decision queue already orders
by `[priority, queuePos]` — no UI change. Mapping is applied server-side where the draft
Decision is filed (deterministic read of the persisted assessment, never a model choice).

**Burst ordering.** There is no app-layer queue in `agent/channels/customer.ts` — the burst
buffer is unprocessed `NovaInbox` rows in dakio-api (modules 01/02). The ordering rule
`urgency desc, windowExpiresAt asc, lastMessageAt asc` is implemented in dakio-api's
`inboxDelivery.js` re-delivery pass (module 01's lib contract carries it); this module
supplies the urgency input by persisting the assessment columns it reads.

Assessment labels drive routing and tone **only**. They never enter trust inputs, never enter
metrics, never gate authority by themselves (anti-drift rule; see Risks).

### D5. Fraud — deterministic verdict layer, model hints on top, trigger row 9

Two strictly separated layers.

**Deterministic (the verdict layer).** New read-only agent tool `check_customer_risk` (no
autonomy gate — it mutates nothing) wrapping new endpoint
`GET /api/v1/store/customers/risk?phone=…`, returning verbatim from existing libs:

- `calculateCustomerRisk(tenantId, phone)` → `{level: NEW|MEDIUM|POSITIVE|RISK,
  deliveredOrders, cancelledOrders, successRate, message}`. `RISK` = returnRate ≥ 0.5 over ≥2
  completed outcomes, or ≥3 cancelled — this IS the COD no-show signal the merchant order UI
  already trusts. Phone matching uses `normalizePhone` + `phoneVariants` (mandatory — customer
  phone storage is un-normalized across creation paths, recon-identity-commerce.md:164).
- `checkFakeOrder(tenantId, {phone, cartFingerprint})` rules 1–4. In chat context `clientIp` is
  absent (Meta webhook, not storefront), so rules 2–4 partially degrade; rule 1 (phone
  velocity) and the risk levels carry the load. **Honest degradation:** the response includes
  `rulesUnavailable: ["ip_phone_repeat", "ip_velocity", ...]` so neither the model nor a
  receipt can claim checks that never ran.

**Server-side re-check is the guarantee**: the `create_order_from_chat` executor
(`POST /api/v1/store/orders`, module 05) runs `checkFakeOrder` + `calculateCustomerRisk`
itself, regardless of what the agent read — model output proposes, never authorizes. A `RISK`
level or fired rule forces `needs_approval` via `guardrail:inbox_order_needs_review` (rule
string already registered, canonical §2.12). This composes with, never replaces, the
`rtoCount ≥ inbox.rtoShadowThreshold` always-prepared rule.

**Model hints (the suspicion layer)** — `assessment.fraudHints[]`, advisory only:
`instant_acceptance` (accepts a ≥৳3,000 order in the first 1–2 messages, zero questions — the
real BD prank/competitor fake-order pattern), `identity_inconsistent` (name/phone/address now
contradicts earlier in-thread), `payment_proof_suspect` (trxID malformed or story shifting —
composes with module 08's `payment_dispute` row), `address_suspect` (vague beyond
deliverability — "Dhaka" alone — or district contradicts earlier statements). A hint's only
effects: stored (payload + `lastAssessment`), prompts Nova to *verify conversationally*
(re-confirm address, digit read-back — normal shopkeeper behavior, not accusation), and 2+
hints count as ONE signal toward the stack below. A hint with zero deterministic corroboration
never escalates by itself — anti-false-positive by construction.

**Trigger row 9 — `fraud_risk`** (extends module 08's trigger taxonomy; this module owns the
row): fires when the deterministic layer returns `RISK`-level history or a fired
`checkFakeOrder` rule **and** the conversation is heading toward an order
(`buyingIntent: ready` or an order draft exists). Behavior: Nova never accuses, never mentions
risk to the customer; the order verb is forced `prepared`; when **2+ signals stack** the thread
escalates with reason `fraud_risk`, brief `paramsLine` carrying the receipts, e.g.
`"⚠ 3 কেনার পর 2 ফেরত · same phone 2 orders 24h · rule 1"` (3 kenar por 2 ferot — 3 bought,
2 returned). **Holding line: none** — nothing is wrong from the customer's view; Nova keeps
chatting normally while the order waits for the founder. `fraud_risk` escalations are
trust-neutral (D9).

### D6. Confidence bands — a discipline, not a probability

`receipt.confidence` is a **self-reported discipline band** with pinned semantics; the system
reacts to bands, never decimals. The threshold is one shared constant,
`INBOX_LOW_CONFIDENCE = 0.55`, exported from `agent/lib/nova/inboxIntents.ts` so this module
and module 08's trigger row 5 cannot drift.

| Band | Meaning (instruction-pinned) | System behavior |
|---|---|---|
| ≥ 0.8 | Every fact stated was tool-read this turn AND intent is unambiguous | Normal flow; eligible for auto-execute where the tier allows |
| 0.55–0.79 | Intent clear, some inference (e.g. guessing which product "oita" means) | Reply must include the verifying move ("navy ta to? 🙂") — never a bare assertion |
| < 0.55 | Guessing | Reply may ONLY be a clarifying question or an honest "let me check" — no facts, no close. Increments `novaLowConfidenceStreak` (column lands in module 08's migration); streak 2 → escalate reason `lost`. Never a third guess |

### D7. Never-invent list, fallback lines, banned hedges, structural scaffolding

**The 10-item never-invent list** — appended section of `50-customer-inbox.ts` (an appended
section, not a numbered rule, per canonical §2.19), verbatim:

> **You never state without a tool read this same turn:** (1) order status or courier scans;
> (2) stock counts or restock dates; (3) prices, delivery fees, or discounts; (4) delivery
> dates beyond courier/SLA data; (5) whether a payment was received. **You never invent at
> all:** (6) product facts not in the catalog — material, origin, warranty, washability: if
> the catalog doesn't say it, you don't know it; (7) store policies not in policy data;
> (8) the owner's availability, opinion, or promises ("uni ekhon dekhe dibe" only after a real
> escalation); (9) anything as "done" that is not `status: executed` in the ledger;
> (10) another customer's information, ever — if identity is uncertain, verify before reading
> anything out.

**The fallback lines** (script-mirroring bn / banglish / en, same rules as all templates):

| Situation | Line | Then |
|---|---|---|
| Unknown product fact ("eta ki pure cotton?" — catalog silent) | সত্যি বলতে এটা আমি এখনই শিওর না — মালিকের কাছ থেকে জেনে আপনাকে জানাচ্ছি, ভুল বলতে চাই না। ("Sotti bolte eta ami ekhoni sure na — owner er theke jene apnake janachchi, bhul bolte chai na." / "Honestly I'm not sure about that one — let me check with the owner so I don't tell you wrong.") | Files a real `NovaDecision {kind:'proposal', tag:'PRODUCT'}` asking the founder to supply the fact; the answer, once given, is written to `insights` memory as `product:<id>:fact:<slug>` so it is never asked twice. The honest offer-to-check reads as a careful shopkeeper — a feature, not a failure |
| Uncertain identity (phone matches 2 customers; or "my order" with no linked identity) | আপনার অর্ডারটা খুঁজে দেখছি — যে নাম্বার দিয়ে অর্ডার করেছিলেন সেটা একটু বলবেন? ("Apnar order ta khuje dekhchi — je number diye order korechilen seta ektu bolben?" / "Let me find your order — what's the phone number you ordered with?") | Never assume; never read out a fuzzy-matched order until the customer states the matching phone/order number. Item 10 is absolute |
| Low-confidence intent, first time ("oita ase?") | কোনটার কথা বলছেন একটু বলবেন? স্ক্রিনশট দিলেও হবে 🙂 ("Konta bolchen ektu bolben? Screenshot dilei hobe 🙂" / "Which one do you mean? A screenshot works too 🙂") | confidence < 0.55, streak = 1 |
| Low-confidence, second consecutive | H2 holding line (module 08's template set) | streak = 2 → escalate reason `lost` |

**Banned hedges** (added to the bot-smell lint corpus): "probably", "I think it should be",
"সম্ভবত হয়ে যাবে" (shombhoboto hoye jabe) in any factual claim. A fact is tool-read or it is
the fallback line; there is no middle voice.

**Structural scaffolding** (rules are not enough):
- **Receipt evidence is the enforcement seam**: every ৳ amount, stock count, and ETA in a reply
  must appear in `receipt.evidence` with a tool `source` — the API already refuses
  evidence-free receipts, and the fact-grounding CI eval regexes reply text against evidence
  values. v1 enforcement = receipt requirement + CI hard gate; v2 adds the runtime lint
  (reject a send whose text contains a ৳-pattern absent from evidence, fail-closed to
  `prepared`).
- **Tool-gated identity**: `get_order_status` requires either `InboxConversation.customerId`
  (module 03's identity join) or an in-thread-provided phone/order-number argument; there is no
  "search all orders" surface on the customer channel. Confidence discipline is partly
  structural — the model *cannot* read what it shouldn't.

### D8. The learning loop — outcomes → memory → better prompts, nothing else

```
ledger outcomes (module 09's nightly night_ops attribution pass:
  delivered→measured, RTO→zeroed, cart-recovery credit, rto_save rows)
        │  nightly, deterministic
        ▼
reflection lane (existing JOB_KINDS 'reflection', priority 6; cadence via
  NovaJobDef, e.g. weekly Sun 03:00 Asia/Dhaka)
  reads: distill(storeId, sinceDays) + measured NovaActivity rows +
         NovaDecision edits/rejections + approach tags (D8b)
        │  one model turn, writes ONLY memory
        ▼
NovaMemory rows {source:'reflection', provenance:{actionIds[], window},
                 weight: 0.7, expiresAt: +90d}
        │  injected next session via existing memory snapshot (8-entry cap)
        ▼
future customer-channel turns (L-BRAND/L-CUSTOMER layers + insights section)
```

**No fine-tuning. No gradients. No fabricated statistics.** Learning = writing evidence-cited
memory that changes future prompts. That is the whole mechanism, and founder-facing copy says
so.

**(a) Per-customer facts → `customers` namespace.** Keys per canonical §2.16: pre-link
`customer.psid.<platform>.<senderId>`, migrated at identity-link time to
`customer.<customerId>.<facet>` (module 03 owns keying/migration; this module specifies what
is learned and when, via the existing `remember` tool at natural moments):

| Learned fact | Written when | Example value fragment |
|---|---|---|
| Address form + language | customer uses tumi twice / settles into banglish | "tumi-ok; banglish" |
| What closed them | chat order created | "closed on COD reassurance after trust hesitation" |
| Standing objection | hesitation repeated across 2+ sessions | "price-sensitive — opens with 'last dam koto'" |
| Timing pattern | observed across sessions | "messages after 11pm; replies next morning" |
| Do-not-offer | customer refused an offer type | "dislikes bundle offers — asked to stop" |
| Complaint history | complaint resolved | "Jun: wrong size delivered, exchanged — mention care if sizing comes up" |

One compact line per customer (upsert, never append-grow); injected only for the current
conversation's identity; deletion rides the Meta data-deletion path (module 01).

**(b) Per-store insights → `insights` namespace, evidence-cited.** The **`approach` tag** makes
outcomes groupable: `send_inbox_reply` payload gains an optional enum the model self-labels
when the reply is a *move*, not a plain answer:
`plain_reminder | scarcity_real | photo_first | objection_price | objection_trust |
cod_reassure | bundle_nudge | reorder_nudge` (`photo_first` is reserved — outbound photos are
v2 per canonical C-13; the value exists so v2 needs no schema change). Honest by construction:
the tag describes the composed text (auditable in the receipt), and `scarcity_real` is only
permissible when stock was tool-read this turn.

The reflection lane groups **measured** outcomes by approach and writes insights only when the
evidence clears the floors. Example row:

```
namespace: insights
key:       inbox.cart_recovery.approach
value:     "Cart-recovery nudges tagged scarcity_real converted 6 of 14; plain_reminder
            2 of 13 (Jun 25–Jul 24, measured deliveries only). Lean scarcity_real when
            stock is genuinely low — sample is small, keep testing."
source:    reflection      weight: 0.7 (below owner-authored 1.0)
provenance:{actionIds:[…27 ids], window:{from,to}, metric:"carts_recovered_via_chat"}
expiresAt: +90d            (stale lessons decay unless re-confirmed)
```

**The 5 insight honesty rules** (hard; checked by the reflection prompt AND a deterministic
post-write lint in `agent/lib/nova/insightRules.ts`):
1. Every comparative claim carries raw counts and the window — never a bare percentage, never
   a denominator-free "converts better".
2. Minimum sample **≥10 measured outcomes per compared group**, or the insight is not written
   (a "too early to tell" note may be written instead, also evidence-cited).
3. Only `revenueBasis:'measured'` outcomes count — an insight can never be built on estimates.
4. `provenance.actionIds` must reproduce the counts (same reproducibility contract as
   NovaAchievement evidence, module 09).
5. Insights never contradict owner-authored `rules`/`preferences` — owner beats learned
   (weight ordering + instruction rule).

Injection: the inbox persona gains one section — "**What's been working here**: {≤5 `insights`
entries with key prefix `inbox.`}" — inside the existing 8-per-namespace cap.

**(c) Rejection + edit learning.**
- Rejection: already wired (`learnFromRejection` on `rejectAction`) — inbox verbs inherit it
  for free, including the founder's manual reply after escalation (auto-rejected Decision,
  module 08): the founder preferring their own words IS the lesson.
- Edit learning, v1-lite: approve-with-edits already persists the (draft, sent) pairs on the
  Decision. The reflection lane reads the window's edited inbox decisions and, when **≥5
  pairs** exist, writes ONE `preferences` entry `inbox.style.owner_edits` — e.g. "Owner
  shortened 4 of 6 drafts and removed emoji each time (decision ids in provenance). Write
  tighter, skip emoji for this store." — checkable against the actual pairs, no fabrication
  possible.

### D9. Trust — outcome-verified inputs, scoped to the inbox

`computeTrust` stays a placeholder isolated in `novaTrust.js` (its doc-comment orders: change
the weighting there, nowhere else). Promotion remains a `NovaDecision {kind:'promotion'}` and
`promotion_accept` stays FOUNDER_ONLY — the founder always confirms. What this module fixes
permanently is the **input vocabulary and its verification rules**, which survive any
reweighting.

`trustInputsFor` gains outcome counts — each a deterministic DB query over the same 30-day
window, all requiring measured/terminal DB state (module 09's attribution pass makes them
queryable):

| Input key | Earns/Loses | Exact predicate (all ledger/DB, zero model claims) |
|---|---|---|
| `chatOrdersDelivered` | earn | executed `create_order_from_chat` whose Order reached `DELIVERED` in-window |
| `chatOrdersReturned` | lose (×3, undo-equivalent) | same verb, Order reached `RETURNED`/`FAILED` — the world reversed Nova's action |
| `recoveriesMeasured` | earn | recovery activities whose provenance flipped to `cart_recovery:<cartId>:<orderId>` (measured, delivered) |
| `rtoSaves` | earn | `kind:'rto_save'` activities (strict three-condition definition, module 09: flagged before chat, confirmed, delivered) |
| `complaintsResolvedQuiet` | earn | complaint-intent conversations where Nova's last reply is followed by ≥6h customer quiet, no handover, no repeat complaint from the same customer within 7d (reuses module 09's `resolved_without_handover_pct` machinery) |
| `failureHandovers` | lose (×1.5, rejection-equivalent) | escalations with reason `lost`, `tool_failure`, or `anger` where the first angry message *followed* ≥1 Nova reply in-thread — Nova had the ball and lost it |
| — | **neutral** | escalations with reason `human_ask`, `legal_threat_abuse`, `payment_dispute`, `fraud_risk`, `vip`, `beyond_discount_authority` — customer-driven or by-design. Penalizing these would teach Nova to avoid escalating — exactly the failure mode `computeTrust`'s refusals-are-neutral comment warns about. **This classification is the single most important anti-gaming rule in the module** |

**Scoped slice:** `trustInputsFor(tenantId, {scope})` gains an optional verb-set filter;
`NovaInstance.trustInputs` (already Json) stores `{overall: {...}, byScope: {"door:inbox":
{...}}}`. Inbox tier promotions read the **inbox slice** — flawless ad campaigns earn nothing
about talking to customers, and vice versa. MIN_SAMPLE (5) applies per slice.

**Anti-gaming, complete:** (1) volume earns nothing — reply counts, conversations handled,
minutes saved appear nowhere in trust inputs; (2) Nova cannot self-report a win — every input
is a DB status transition written by orders/courier flows Nova doesn't control; (3)
customer-driven escalation is never punished; (4) NovaAchievement rows never feed
`trustInputsFor` — a trophy and a promotion are separate currencies; (5) estimates never count
(`revenueBasis:'measured'` only); (6) min-sample floors per slice; (7) the 30d window rolls —
old glory decays.

### D10. Promotion mechanics — delivered outcomes, founder-confirmed, never automatic

Extends module 08's T0-exit criteria **by addition** (approval-count-only criteria are
volume-gameable — a founder rubber-stamping 25 drafts in a bored evening would unlock T1 with
zero delivered outcomes):

| Promotion | Module 08 criteria (kept) | Added outcome conditions (this module) |
|---|---|---|
| T0 Shadow → T1 Front Desk | ≥7 days, ≥25 approved drafts, edit ≤20%, reject ≤5% | + ≥10 of the approved replies belong to conversations that reached quiet-satisfied (no escalation, no repeat complaint) |
| T1 → T2 Order Taker | ≥10 approved order drafts, 0 rejected | + **≥5 of those orders DELIVERED, ≤1 RETURNED** — Nova graduates to auto-orders only after its drafted orders survive BD COD reality |
| T2 → T3 Closer | ≥10 approved discount drafts | + ≥5 discount-carrying conversations converted to delivered orders + inbox-slice trust ≥ 0.85 (PROMOTION_THRESHOLD, reused) |
| Refunds / payment confirmation | — | **never graduates.** `refund_promise` stays FOUNDER_ONLY at every tier forever |

Graduation order is fixed: reply-kinds → orders → discounts/cancels → (never) refunds. Each
eligible promotion is filed as `NovaDecision {kind:'promotion'}` with the evidence in
`paramsLine` ("14 orders drafted · 9 delivered · 1 returned · trust 0.88") — the founder taps
approve, or doesn't. The eligibility check runs inside `novaTrust.js` (`maybeOfferPromotion`,
called from the nightly recompute; dedupe: no new offer while one is open). Auto-promotion does
not exist anywhere in the system.

**Demotion (v1, simple):** 2 rejections or an undo/returned-order spike (≥3 in 7d) on an
auto-executing inbox verb files a `kind:'promotion'` Decision *offering a tier step-down* with
the evidence — Nova proposes its own demotion; the founder decides. No silent demotion
(surprising the founder in either direction erodes the feature).

### D11. Measurement honesty — verification windows and labeling rules (req #27)

Rule-of-rules: **a number is "measured" only when a terminal DB state verifies it; everything
else is labeled an estimate at every surface it touches, including Nova's own sentences.**

| Claim | Verified when | Attribution window (pinned here) | Counterfactual label |
|---|---|---|---|
| "Recovered cart" | cart → order → DELIVERED | order created ≤ **7d** after the recovery message AND the cart's `recoveryState:'message_sent'` chain holds; later conversions are organic, not claimed | none needed — the chain is factual |
| "Chat order revenue" | order DELIVERED (estimated until then; RETURNED → zeroed) | n/a — the order IS the outcome | "delivered" vs "pending delivery" split always visible |
| "RTO save" | flagged-before-chat + chat-confirmed + DELIVERED (module 09's three conditions) | confirmation reply ≤ **72h** before courier handover (a confirmation weeks earlier claims too much) | always an estimate of prevention — the counterfactual is unknowable. Approved copy: "7 at-risk orders delivered after Nova's confirmation"; the word "prevented" appears only as "**potential** RTOs prevented" and NEVER with a ৳ value attached |
| "Complaint resolved" | ≥6h quiet + no handover + no repeat within 7d | the 7d repeat check IS the window | "customer went quiet satisfied" — tile targetText states the definition, because quiet ≠ proven happy |
| "Repeat purchase influenced" | reorder-nudge (`approach:'reorder_nudge'`) followed by that customer's order ≤ **7d**, containing the nudged product, DELIVERED | 7d, product-matched | organic repeats never claimed; metric name is "repeat orders after nudge", not "repeat purchases generated" |
| "Founder time saved" | never — modeled constant per verb (`MINUTES_BY_ACTION`) | n/a | every hours-saved surface carries "estimated at N min/task"; never presented as measured |
| "Leads converted" | conversation → first-ever order for that customer → DELIVERED | order ≤ **14d** from first inbound | factual chain, no counterfactual claim |

Labeling rules, everywhere numbers surface:
1. **Data layer**: `revenueBasis` flips via module 09's pass. **No surface may sum estimated
   and measured into one figure.** `/nova/home` `revenueInfluencedToday` splits
   `{measured, estimated}` in the payload (additive; UI shows "৳9,400 + ৳5,550 pending").
2. **Model layer (the seam that keeps LLMs honest)**: morning-brief and reflection prompts
   receive numbers **pre-labeled by the context builder** — the builder emits strings like
   `"chat revenue ৳9,400 (delivered) + ৳5,550 (pending COD — not yet real)"`, never raw
   floats. The model cannot mislabel what arrives labeled. Instruction rule on top: *"You never
   state an estimated number without saying it is estimated. You never total estimates with
   actuals."*
3. **Nova's founder-chat answers**: if the founder asks "koto sale hoise chat e?", the answer
   is the split, in words.
4. **Dept-room tiles**: NovaScoreMetric values are measured-only, always (platform-wide).
5. **`revenueProvenance`** strings (`chat_order:<id>:delivered`,
   `cart_recovery:<cartId>:<orderId>`) are the machine-checkable trail from any displayed
   number to its rows.

### D12. What the loop explicitly does NOT do

No per-customer "conversion probability"; no lead-scoring numbers (`buyingIntent` stages are
per-message assessments, not accumulated scores). No cross-tenant learning in v1. No silent
behavior change: every learned thing is a visible NovaMemory row in `GET /nova/memory`,
deletable by the founder — learning is inspectable or it doesn't happen.

---

## Data model

This module's migration (InboxConversation base columns land in module 01; handover/escalation
columns — including `novaLowConfidenceStreak` — in module 08; these four are module 11's):

```prisma
model InboxConversation {
  // ...module 01 base + module 03 identity + module 08 handover columns...
  lastAssessment      Json?    // NEW — latest full assessment object + at (ISO)
  negSentimentStreak  Int      @default(0)  // NEW — consecutive customer msgs assessed frustrated|angry
  buyingIntent        String?  // NEW — latest stage; the lifecycle/NBA cursor
  urgency             String   @default("normal")  // NEW — normal|elevated|critical
}

model InboxMessage {
  // no new columns here; module 11 adds ONE index for the quiet-satisfied and
  // failureHandovers predicates (message-ordering joins in trustInputsFor):
  @@index([conversationId, sentAt])  // NEW
}
```

Migration notes:
- Backfill: none needed — defaults cover existing rows (`negSentimentStreak 0`,
  `urgency "normal"`, nullable rest).
- Meta data-deletion: all four columns live on InboxConversation, which is already
  hard-delete-cascaded by the deletion handler (module 01) — nothing extra.
- `NovaInstance.trustInputs` is already `Json?` — the `{overall, byScope}` shape is a
  convention, zero migration. Persisted inputs allow backfill when weights change.
- NovaMemory: no schema change — `source:'reflection'`, `provenance`, `weight`, `expiresAt`
  all exist.

---

## APIs & interfaces

### dakio-api

**`GET /api/v1/store/customers/risk?phone=<raw>`** (new, in `novaStore.js`; auth
`authenticateNovaService + requireTenant`; read-only):

```jsonc
// 200
{
  "risk": { "level": "RISK", "deliveredOrders": 1, "cancelledOrders": 3,
            "successRate": 0.25, "message": "..." },        // calculateCustomerRisk verbatim
  "fakeOrder": { "fired": ["phone_velocity_24h"],           // checkFakeOrder rules that fired
                 "rulesUnavailable": ["ip_phone_repeat", "ip_velocity",
                                      "cart_fingerprint"] },// honest degradation (no clientIp in chat)
  "phoneNormalized": "01XXXXXXXXX"
}
```

**`POST /api/v1/inbox/conversations/:id/reply`** (module 02's route — this module's additive
contract): request payload carries `assessment` (validated shape above) and optional
`approach`; the executor writes `lastAssessment`, `negSentimentStreak`, `buyingIntent`,
`urgency` in the same transaction as the outbound rows, and applies the draft-Decision priority
mapping (2/3/5) when the verdict is `needs_approval`.

**`GET /nova/home`** (merchant JWT, existing): `revenueInfluencedToday` becomes
`{ measured: 9400, estimated: 5550 }` (additive; old consumers reading a scalar are migrated in
the same PR — grep confirmed consumers per repo rules).

**`GET /nova/trust`** (merchant JWT, existing route): response gains
`byScope: { "door:inbox": { inputs, score, sample } }` alongside `overall`.

### nova-ai

**Tool `check_customer_risk`** (new, `agent/tools/check_customer_risk.ts`): read-only, no
autonomy verb, no receipt required (mutates nothing). `inputSchema: { phone: string }` (or
omitted → resolves from the conversation's linked customer). Returns the endpoint payload
verbatim plus a one-line honest summary for the model ("history: 1 delivered / 3 cancelled —
RISK; IP rules unavailable in chat").

**Schema changes** (`agent/lib/nova/schemas.ts`): `messageAssessmentSchema` (D2) required on
`sendInboxReplyPayload` (low risk, MINUTES 3), `escalateConversationPayload` (low, 2),
`createOrderFromChatPayload` (low, 12) — module 02 reserves the slots; this module defines
the schema. Optional `approach` enum on `sendInboxReplyPayload`. No new autonomy verbs in
this module.

**Constants** (`agent/lib/nova/inboxIntents.ts`, file created by module 02):
`export const INBOX_LOW_CONFIDENCE = 0.55`.

**Instruction file** (`agent/instructions/50-customer-inbox.ts`): rule 15 READ FIRST (D4);
appended sections: never-invent list (D7), fallback-line table (D7), banned hedges,
confidence-band semantics (D6), "What's been working here" insights section (D8b).

**Reflection lane** (existing `reflection` job kind): prompt/handler extended to read
approach-grouped measured outcomes + Decision `edits` pairs; writes gated by
`agent/lib/nova/insightRules.ts` (new) post-write lint.

---

## Files touched

**dakio-api**
- `prisma/schema.prisma` — 4 InboxConversation columns + `InboxMessage @@index([conversationId, sentAt])` (+ migration).
- `src/routes/novaStore.js` — `GET /customers/risk` endpoint (wraps `customerRisk.js` + `fakeOrderProtection.js` with degradation honesty).
- `src/routes/novaInbox.js` — reply executor: rolling-column writes in the outbound transaction; draft-Decision priority mapping from persisted assessment.
- `src/lib/novaTrust.js` — `trustInputsFor` outcome inputs + scope filter; `computeTrust` weight extension (wins +1, returned ×3, failureHandovers ×1.5); `maybeOfferPromotion` / demotion-offer filing (kept in this file per its own doc-comment).
- `src/routes/novaDashboard.js` — `/nova/home` measured/estimated split; `GET /trust` `byScope` in response.
- Grounded-stats serializers consumed by morning_report/reflection lanes — emit pre-labeled number strings (D11 rule 2).
- `package.json` — test list gains the three files named under Testing.

**nova-ai**
- `agent/lib/nova/schemas.ts` — `messageAssessmentSchema`, `approach` enum, payload extensions.
- `agent/lib/nova/inboxIntents.ts` — `INBOX_LOW_CONFIDENCE = 0.55` (extend; file owned by module 02).
- `agent/instructions/50-customer-inbox.ts` — rule 15 + appended sections (extend; file owned by module 02).
- `agent/tools/check_customer_risk.ts` (new) — read-only risk tool.
- `agent/lib/nova/insightRules.ts` (new) — insight honesty lint (counts+window regex, ≥10 floor, measured-only source check, provenance-reproducibility check).
- Reflection lane prompt builder (extend) — approach-grouped outcomes + edit-pair distillation inputs.
- Eval corpus: `evals/inbox-assessment` golden set (labeled bn/banglish/en messages); banned-hedge additions to the bot-smell lint (module 12 consolidates the gates).

---

## Testing

**dakio-api** (node:test, files added to the package.json test list):
- `test/novaInboxAssessment.test.js`
  1. Given a reply action payload with `sentiment:'frustrated'`, when the reply executor
     commits, then `negSentimentStreak` increments in the same transaction; a later
     `positive` assessment resets it to 0.
  2. Given `urgency:'critical'` on a draft-bound reply, the filed NovaDecision has
     `priority: 2`; `opportunity:'bulk_inquiry'` → 3; plain → 5.
  3. Given a payload missing `assessment`, the route 400s (schema-required, fail-closed).
- `test/novaTrustInbox.test.js`
  4. Given an escalation reason `human_ask`, `trustInputsFor` counts it neutral; given reason
     `anger` where the first angry message followed a Nova reply, it counts as
     `failureHandovers` (deterministic message-ordering check using the new index).
  5. Given a delivered chat order and a returned one, the inbox-slice score moves +1/−3
     respectively and `byScope["door:inbox"]` is isolated from a campaign approval landing in
     `overall`.
  6. Given T1→T2 thresholds met but only 4 delivered orders, `maybeOfferPromotion` files no
     Decision; at 5 delivered / ≤1 returned it files exactly one (dedupe on open offer).
- `test/novaCustomerRisk.test.js`
  7. Given a customer with 3 cancelled orders queried via `+880`-format phone,
     `GET /customers/risk` normalizes and returns `level:'RISK'` with
     `rulesUnavailable` listing the IP rules.

**nova-ai** (repo suite + isolation suite — tenancy is touched by the risk tool):
  8. insightRules lint: an insight value with a bare percentage / no window / a group of 9
     measured outcomes is rejected; a compliant counts+window value with reproducible
     provenance passes.
  - Isolation: `check_customer_risk` for tenant A cannot read tenant B (per-tenant service
    token path).
  - Assessment eval (CI gate, consolidated in module 12): labeled golden set — anchoring
    accuracy floor; `high_value` never set without a tool-read basis in the trace.

---

## Risks & trade-offs

| Risk | Likelihood | Mitigation |
|---|---|---|
| Self-reported assessment drift — labels rot, so priority ordering and streaks rot | Medium | Labels drive routing and tone only, never trust or metrics (trust reads DB outcomes exclusively); CI assessment eval with labeled bn/banglish/en corpus asserts accuracy ≥ agreed floor |
| Worst customer-facing failure: an invented fact (price/status/"done") reaches a customer | Low (layered) | Never-invent list + fallback lines + receipt-evidence seam + fact-grounding CI hard gate; confidence <0.55 structurally limited to clarifying questions; v2 runtime ৳-lint |
| `fraud_risk` false positive annoys a legitimate customer | Low | Customer never sees anything (no holding line, no accusation); the only effect is the order drafting to the founder; model hints alone can never escalate |
| Neutral-escalation misclassification (anger-after-Nova-reply counted as customer-driven) would let Nova's failures stop counting | Low | Classifier is deterministic (in-thread message ordering via the new index); reason-string taxonomy disjointness is a test-pinned invariant (module 12 list) |
| Insight overfitting on small stores — noisy leans for low-volume merchants | Medium | ≥10-measured floor, "lean, not law" phrasing, 90d expiry, weight 0.7 under owner rules; v2 experiments fix it properly |
| Trust-input query cost — 7 nightly window queries per tenant; quiet-satisfied joins are the heavy ones | Low | `InboxMessage(conversationId, sentAt)` index ships in this module's migration; queries run in the nightly pass, not request paths |
| Founders read "potential RTOs prevented" as money | Medium | No-৳-attachment rule; the tile targetText carries the definition every time, not just in docs |
| Rubber-stamp promotions (volume without outcomes) | — | Eliminated by design: delivered-outcome conditions per tier; promotion is always a founder-confirmed Decision |

---

## Gate

Scripted demo on a clean staging store, run by a non-builder:

1. **Assessment visible and consequential.** Send "order koi?? 3 din dhore wait korchi" from a
   test customer. Verify: the drafted reply drops selling and leads with the fix; the receipt
   drawer shows the `assessment` evidence entry (`frustrated`); the draft Decision sits at
   priority 2; `negSentimentStreak = 1` on the conversation row. Send a happy follow-up;
   streak resets to 0.
2. **Honest ignorance.** Ask a product fact the catalog doesn't hold ("eta ki pure cotton?").
   Verify: the exact fallback line (bn) is sent, a `PRODUCT` proposal Decision appears for the
   founder; answer it; verify the `insights` row `product:<id>:fact:<slug>` exists and a second
   ask is answered from it without re-asking the founder.
3. **Fraud stays invisible.** Seed a customer with 1 delivered / 3 cancelled orders; walk them
   to "nibo, address dibo". Verify: conversation stays perfectly normal, the order lands as a
   draft with `guardrail:inbox_order_needs_review`, and (with a second stacked signal) an
   escalation with reason `fraud_risk` and a receipts-bearing paramsLine — no holding line sent.
4. **Trust is scoped and outcome-based.** Approve 25 reply drafts with zero delivered
   outcomes: verify no T1 promotion offer exists. Mark 5 staged chat orders DELIVERED via the
   attribution pass: verify the inbox slice moves and a promotion Decision appears with the
   evidence paramsLine. Approve a campaign action: verify `byScope["door:inbox"]` is unmoved.
5. **Learning is inspectable.** Run the reflection lane on a seeded window: verify one insight
   with raw counts + window (or an evidence-cited "too early" note), visible in
   `GET /nova/memory`, deletable; verify the lint rejects a seeded under-sample insight in the
   test run.
6. **No summed estimates.** `/nova/home` shows "৳X + ৳Y pending" as separate figures; grep the
   payload — no field totals the two.

Measurable checks: all Testing cases green in CI; assessment eval ≥ floor; fact-grounding,
bot-smell (incl. banned hedges), and guardrail-breach evals pass as hard gates.

**Rollback (no deploy):** pause the `reflection` NovaJobDef (stops all insight/edit writes);
delete any learned row via `/nova/memory` (founder-visible by design); promotion/demotion
offers are inert Decisions the founder can ignore or reject; the assessment itself is advisory
(routing/tone only), so the residual behavior with everything paused is module 02's baseline
reply flow. Tenant kill switch and `door:inbox` mode revert (module 12) remain the global offs.
