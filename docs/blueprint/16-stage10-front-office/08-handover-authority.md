# Module 08 — Handover & Authority: locks, escalation, briefs, and the T0–T3 dial

**Phase:** 16 "Front Office" · **Depends on:** 01, 02 · **Feeds:** 05, 06, 07, 10, 11
**Repos touched:** dakio-api | nova-ai | dakio-merchant
**Founder requirements covered:** #21, #22, #23, #24, #25, #11 (authority half)

---

## Already real vs to build

| Already real (evidence) | This module adds |
|---|---|
| Single authority seam `evaluateAuthority` with fixed judgement order (founder-only → no-touch → duty → mode → level → guardrails), fail-closed invariants, bn+en explanations on every verdict (recon-action-ledger: `authority.ts:1-22, 10-19, 213-216, 191-210`) | Fail-closed `inbox.*` guardrail branches, 12 new rule strings, `refund_promise` added to `FOUNDER_ONLY` |
| Per-door modes: `NovaAgentMode {scope:'door:<module>'}`, `MODE_CEILING` assisted→2 / autonomous→4, `effectiveLevel = min(level, earned, ceiling)` (recon-action-ledger: `authority.ts:147-165`, `schema.prisma:1514-1523`) | T0–T3 inbox dial encoded as `door:inbox` mode + guardrail-key flips — zero new authority machinery |
| `NovaDecision` with `kind proposal\|escalation\|promotion`, `actionId @unique`, priority 1 pinning, at-most-once approve claim with `body.edits`, reject settles the linked prepared action (recon-action-ledger: `schema.prisma:1536-1594`, `novaDashboard.js:420-480, 559-586`) | Escalation Decisions carrying the CONTEXT BRIEF; tap-send with lock re-check; auto-settle on founder manual reply; promotion/demotion Decisions |
| Blocked actions persist as receipted ledger rows; refusal Decisions authored by the gate (recon-action-ledger: `actions.ts:109-135, 139-146, 357-394`) | `concurrency:founder_active` / `concurrency:stale_reply` blocked rows — "Nova was about to reply; the founder got there first" is visible, never silent |
| Five decision surfaces render any queued Decision for free (recon-merchant-ui: `NovaCommand.jsx:564-630`, `NovaDesk.jsx:44-59`, `NovaDeptRoomPage.jsx:365-392`, `suggestions.js:80-83`, `NovaChat.jsx:48-103`) | Escalations appear on all five with zero new UI in this module (module 10 adds the in-inbox banner) |
| SSE bus + merchant switch that silently drops unknown event types (recon-action-ledger: `novaFeedBus.js:17-25`; recon-merchant-ui: `NovaContext.jsx:303-315`) | `conversation.escalated` / `conversation.taken_over` / `conversation.handed_back` producers + one `NovaContext.jsx` toast branch |
| `NovaInstance.statusLine` flows to HQ/Desk ticker with zero UI change (recon-merchant-ui: `NovaContext.jsx:758-761`; `schema.prisma:1475-1490`) | Server-set inbox statusLine ("2 customers waiting on you in Messenger") |
| `recordFounderAction` founder-actor ledger rows, excluded from hours-saved (recon-action-ledger: `novaLedger.js:17-51, 10-12`) | Manual-reply ledger row (`verb:'send_inbox_reply'`, actor founder) |
| Trust: `computeTrust` placeholder + `learnFromRejection` on reject (recon-action-ledger: `novaDashboard.js:669-672`, `actions.ts:332-333`) | Shadow-week exit criteria computed from existing ledger counts; promotions filed as `kind:'promotion'` Decisions (outcome-condition extensions owned by module 11) |
| Duty registry with Inbox door already real: `DOORS.Inbox {exists:true, route:'/inbox'}` (recon-action-ledger: `duties.ts:50, 69-80`) | Consumption of the five inbox duties registered by modules 02 (support ×2) and 05 (sales ×3), all `minLevel: 2` so Shadow can draft |
| Meta send path `/meta/send-message` merchant-JWT only, no author concept, 30/min in-process limiter (recon-meta-pipeline: `meta.js:713-798, 716-725`); page echoes dropped (`senderId===selfId`, `meta.js:532-534`) and `message_echoes` not subscribed (`meta.js:273`) — founder replies from the Meta Business Suite app are invisible today (recon-meta-pipeline §Echo handling) | Implicit-takeover transaction on `/meta/send-message`; consumption of module 01's echo classification (`actor:'founder_external'`) as a full takeover |
| No conversation-ownership state anywhere: `InboxConversation`/`InboxMessage` have no handler, lock, or author columns (recon-meta-pipeline: `schema.prisma:1310-1342`; recon-action-ledger §2.4) | `handledBy`/`novaLockedAt` semantics (columns land in module 01's migration) + this module's escalation/SLA columns |
| `NovaGuardrails` versioned-immutable rows with free-form `platform Json` (recon-action-ledger: `schema.prisma:1495-1510`) | The `inbox.*` platform-key registry; missing key reads `false` ⇒ fail closed (tested invariant) |
| OUT — founder push/email notification: no push infra exists in dakio-merchant, and v1 ships none (honest-statuses rule). Email nudge on 24h SLA breach is v2. | — |
| OUT — founder-chat verbal commands ("Nova, take the thread back"): v2, needs a founder-channel tool. | — |
| OUT — `InboxConversationEvent` per-thread history table: the NDJSON ledger export covers audit in v1 (recon-action-ledger: `novaDashboard.js:112-144`); dedicated table is v2. | — |

---

## Objective

After this module ships, a founder can: (a) see every conversation's owner at all times and take any thread from Nova instantly — by typing in Dakio, by tapping takeover, or by replying from their phone in Meta Business Suite — with Nova provably unable to send past the lock; (b) receive escalations as first-class Decisions carrying a complete brief (who, what, what Nova did, what it verified, open promises, a ready-to-send reply) and clear them with one tap; (c) hand threads back explicitly and have Nova resume without re-greeting or re-asking; (d) dial Nova's inbox authority through four honest tiers (T0 Shadow → T3 Closer) where every tier is enforced server-side by fail-closed guardrail keys, never by prompt politeness. Testable end-to-end: a staged race (founder types while Nova drafts) must produce a blocked ledger row, never a double reply.

## Scope

**In:** conversation ownership model (`handledBy` + `novaLockedAt`) and its three enforcement layers; the 8-trigger escalation taxonomy + ingest lexicon; the atomic escalation transaction; holding/SLA template set H1–H6 + S1 and the SLA cron sweep; founder notification path over existing surfaces; the CONTEXT BRIEF payload shape; tap-send / manual-reply / hand-back flows with the four resume rules and founder-promise capture pass-through; T0–T3 encoding, the per-capability autonomy matrix, the `inbox.*` guardrail-key registry, new rule strings, consumption of the five inbox duties (registered by modules 02/05); the mandatory Shadow week + promotion Decisions; failure-honesty instruction rules + fallback lines; concurrency (implicit takeover, staleness 409s, silent drafting); the audit-trail mapping.

**Out (with owner):** webhook echo classification mechanics + Send API metadata stamping (module 01 — this module consumes `actor:'founder_external'`); `send_inbox_reply`/`escalate_conversation` verb registration plumbing and the `/reply` route implementation (module 02 — this module is the spec authority for its lock/staleness semantics); order/discount/cancel verb registration (modules 05/06); `fraud_risk` trigger row 9 signals + promotion outcome-conditions + trust-formula edits (module 11); all founder-facing UI components — banner, chips, dial, Needs-you tab (module 10); `DOOR_OF`/`ATTRIBUTABLE`/sidebar `novaDoor` plumbing (module 09); NovaPromise model + promise sweeps (module 03 — this module passes captured founder promises to it); email/push nudges, verbal commands, per-thread history table, `vipPolicy: shadow|escalate` (v2).

---

## Design

### 1. Ownership: two columns, three enforcement layers

Single source of truth is `InboxConversation` in dakio-api — never eve-session state (the session is a reasoning cache; DB is truth).

- **`handledBy String?`** — `'nova' | 'founder' | null`. Who is expected to answer next. `null` = Nova-in-Inbox not active on this thread (pre-hire or disabled).
- **`novaLockedAt DateTime?`** — the hard lock. Set ONLY by human takeover: founder-typed send in Dakio, explicit takeover route, or an external echo classified `founder_external` by module 01. Nova can flip `handledBy` back to `'nova'` after a resolved escalation; **it can never clear `novaLockedAt`** — only the founder's explicit release does.

This deliberately kills a single `handler ('none'|'nova'|'founder')` enum: an escalation (Nova's own choice, no human involved yet) and a takeover (human acted) must be distinguishable, because the SLA timer applies only to escalations and silent drafting behaves differently on each. `escalatedAt` set + `novaLockedAt` null = "waiting on founder"; `novaLockedAt` set = "founder owns it".

```
                     escalation trigger (Design 2)
     ┌──────────────────────────────────────────────────┐
     │                                                  ▼
  handledBy='nova' ──founder types / echo /────►  handledBy='founder'
     ▲                takeover route                escalatedAt and/or
     │                (novaLockedAt=now)            novaLockedAt set
     │                                                  │
     ├──── POST /claim (service; escalation resolved,   │
     │     novaLockedAt IS NULL) ◄──────────────────────┤
     └──── POST /release (merchant JWT; clears          │
           novaLockedAt + escalation fields) ◄──────────┘
```

Three enforcement layers, fail closed:

1. **Server hard gate (the real lock).** `POST /api/v1/inbox/conversations/:id/reply` (module 02's route) 409s per Design 11's staleness rules whenever `handledBy='founder'` or `novaLockedAt` is set. Lock-check + `InboxOutbound` insert happen in one transaction over the conversation row — Nova cannot race past it.
2. **Agent-side check.** The customer channel reads conversation state before composing; a locked thread produces no send attempt (only a prepared draft when `inbox.draftWhileFounderActive`, Design 11.4). This is an optimization; layer 1 is the guarantee.
3. **Ledger honesty.** A 409'd send persists as a **blocked `NovaAction`** with rule `concurrency:founder_active` or `concurrency:stale_reply` — same pattern as the undo-window refusal rows (`actions.ts:357-394`). Every non-send is a receipt; nothing silently vanishes.

### 2. Trigger taxonomy (the complete req-21 answer)

Detection is two layers, both required (they agree by design — C-29):

- **Deterministic lexicon at ingest** — new lib `src/lib/inboxEscalationLexicon.js`, called from `handleMessage` (module 01 wires the call site). Cheap, no model; stamps `hints: ['human_ask','legal',...]` onto the `message.received` event payload. NFC-normalized matching (reuse the Bangla normalization from `authority.ts:96-131`); per-tenant extension via `NovaGuardrails.platform['inbox.escalationLexiconExtra']`. For `legal_threat_abuse` the hint **forces** escalation even if the model disagrees — fail closed.
- **Model-side judgment** — the turn calls the `flag_handover` tool (→ `escalate_conversation` verb), catching paraphrase the lexicon misses.

`escalationReason` closed set: `human_ask | anger | payment_dispute | legal | lost | negotiation | guardrail:<rule> | vip | tool_failure | fraud_risk`.

| # | Trigger key | Detection | Behavior |
|---|---|---|---|
| 1 | `human_ask` | Lexicon: `মানুষ`, `আসল মানুষ`, `কারো সাথে কথা`, `মালিক`, `এডমিন`, `admin`, `owner`, `agent`, `real person`, `manush ase?`, `malik` — **plus phone-number/call requests** (`নাম্বার দিন`, `কল দিন`, `number den`, `call den`): in BD DM-commerce, asking for a number IS asking for a human. Model confirms intent ("মালিক কে?" about the brand story is not an escalation). | Immediate escalation, holding line H1, reason `human_ask`. One clean handoff — Nova never tries to talk them out of it. |
| 2 | `anger` | `negSentimentStreak ≥ 2` (module 11 writes the streak server-side; frustrated/angry assessments on consecutive customer messages) after Nova attempted exactly one de-escalation reply; OR one-shot lexicon: `বাটপার`, `চিটার`, `ফালতু`, `থার্ড ক্লাস`, `fraud`, `scam`, `batpar`, `cheater`, `faltu`; OR shouting pattern (≥6-char ALL-CAPS run + repeated `??`/`!!`). | One genuine, specific apology attempt (no reflex discounts). Second angry message → escalate, H3, reason `anger`. Lexicon one-shots skip the attempt. |
| 3 | `payment_dispute` | Lexicon `টাকা কেটে নিছে`, `পেমেন্ট করছি কিন্তু`, `টাকা ফেরত`, `refund`, `taka niye gese`, `bkash e disi`, OR trxID-shaped token (`/\b[A-Z0-9]{10}\b/` in payment context). Threshold: disputed amount > `inbox.paymentDisputeEscalateMinor` (default 200000 = ৳2,000) or amount unknown. Below threshold with a verifiable ledger answer, Nova may answer factually — no promise. | H4 (collect trxID), then escalate with trxID + order facts in the brief. Nova never confirms/denies money received without a payment record read this turn; never promises a refund (Design 8 — `refund_promise` is founder-only forever). |
| 4 | `legal_threat_abuse` | Lexicon-forced, model cannot override: `মামলা`, `উকিল`, `থানা`, `পুলিশ`, `ভোক্তা অধিকার`, `mamla`, `police`, `case korbo`, `vokta odhikar`, `court` + severe abuse/harassment. | Immediate escalation, neutral H5, no negotiation, no apology-with-admission. Decision priority 1. Reason `legal`. Nova writes nothing further on the thread until hand-back. |
| 5 | `lost` | `novaLowConfidenceStreak` increments when a turn's `receipt.confidence < INBOX_LOW_CONFIDENCE (0.55)` or the reply was a clarifying question / self-reported "not sure"; resets on a confident turn. Streak 2 → trigger. | Escalate reason `lost`, H2. The brief states exactly what Nova couldn't figure out. Never a third guess. |
| 6 | `beyond_discount_authority` | Customer haggles past the ceiling: asks > `inbox.maxDiscountPct` (15 — OQ-5 RESOLVED by founder 2026-07-25; the platform seed stays 20 for dashboard coupons, `autonomy.ts:35`) or keeps pushing after Nova's best in-guardrail offer (`আরো কমান`, `শেষ দাম কত`, `last price`, `aro komano jay na?`). Mechanically the existing `guardrail:max_discount_pct` refusal, which already escalates. | Best allowed offer ONCE (auto only at T3, else drafted). Next push → H6 + thread escalation reusing the gate-authored Decision. Reason `negotiation`. Brief carries Nova's recommended counter-offer with margin math in evidence. |
| 7 | `guardrail_blocked` | Any `evaluateAuthority` refuse-with-escalation on an action attempted mid-conversation (order over cap, no-touch lock, refund promise). Signal is the pipeline itself — `actions.ts:139-146` already authors the Decision. | Customer never hears "guardrail". Purpose-matched holding line (H6 for money, H1 otherwise); `escalationDecisionId` links the gate-authored Decision — no second Decision. Reason `guardrail:<rule>`. |
| 8 | `vip` | `Customer.tags` contains `vip` OR lifetime delivered total ≥ `inbox.vipLtvMinor` (default 5000000 = ৳50,000), resolved at conversation-open via the module-03 identity link. | v1 = `inbox.vipPolicy:'notify'` only: Nova handles normally + priority feed line + statusLine mention + VIP chip (module 10). `shadow`/`escalate` policies are v2. |
| 9 | `fraud_risk` | **Slot reserved — module 11 owns the signals** (2+ stacked deterministic signals; `check_customer_risk` + `checkFakeOrder`). | No holding line — nothing is wrong from the customer's view; Nova keeps chatting while the order waits prepared. Reason `fraud_risk`. |
| — | `tool_failure` | 2 consecutive tool failures on one conversation (Design 10). | Escalate; brief states exactly what couldn't be checked. |

**Anti-spam rule:** a conversation escalates at most once per open escalation. Triggers firing while `handledBy='founder'` update the existing brief (append to `lastMessages`, bump Decision `priority` to 1) — never stack new Decisions.

### 3. The escalation transaction (atomic, in dakio-api)

Agent side: `flag_handover` is thin — it calls `performAction(escalate_conversation)` (risk `low`, MINUTES 2, **never gated at any tier** — escalation sends nothing customer-visible except a deterministic template, and cross-cutting rule 15 says escalation is never punished). Its executor calls `POST /api/v1/inbox/conversations/:id/handover` (service token, `w()`-idempotent) with `{reason, summary, summaryBn, suggestedReply, suggestedAction?, factsChecked[]}`. One transaction:

1. `handledBy='founder'`, `escalatedAt=now`, `escalationReason`, `slaNextUpdateAt = now + inbox.slaHoldingHours` in business time (window 09:00–23:00 Asia/Dhaka via existing novaCron civil-time math). `novaLockedAt` untouched — no human has acted.
2. Send the **holding message** as a SYSTEM TEMPLATE SEND: insert `InboxOutbound` (actor system, instant schedule — no typing simulation, metadata stamp `dakio:system:<novaActionId>`), which `inboxSender.js` delivers → `InboxMessage {actor:'system', purpose:'holding', novaActionId}` + executed `NovaAction {actor:'system', type:'send_inbox_reply', evidence source 'system:holding_template'}`. System template sends are deterministic (no model authorship) — the one send class allowed on a locked/escalated thread, which is why holding works even in Shadow.
3. Write a **prepared** `NovaAction {type:'send_inbox_reply', purpose:'escalation_draft', department per DEPARTMENT_BY_INTENT}` carrying the suggested reply + brief (Design 6). The guardrail branch for purpose `escalation_draft` returns `needs_approval` **always** (rule `guardrail:inbox_escalated`) — it can never auto-execute at any tier.
4. Author `NovaDecision {kind:'escalation', tag:'SUPPORT'|'SALES'|'FINANCE', priority:1, actionId:<the prepared action>}`; store its id in `escalationDecisionId`. If the trigger was a guardrail refusal (row 7), reuse the gate-authored Decision instead.
5. Emit SSE `conversation.escalated {conversationId, customerName, reason, decisionId}` + standard `decision.created`; enqueue nothing on the NovaInbox bus (the session already knows — it escalated).
6. Set `NovaInstance.statusLine` count-aware: "1 customer waiting on you in Messenger".

Idempotent under `w()` replay and under the anti-spam rule: a second call with an open escalation updates the brief and returns `{alreadyEscalated:true}`.

### 4. Holding + SLA templates (H1–H6, S1)

Rules: match the customer's script (Bangla script → Bangla; Banglish → Banglish; English → English); never name a wait time; never say "bot/AI/system"; one holding message per escalation, ever. Templates are founder-editable per store — overrides live in `NovaGuardrails.platform['inbox.holdingTemplates']` (versioned + FOUNDER_ONLY like all guardrail edits), seeded from these defaults; `{{signature}}` from the tenant registry.

| Key | Bangla | Banglish (romanized gloss) | English |
|---|---|---|---|
| **H1** default / human-ask | আপনার ব্যাপারটা আমি উপরে জানিয়ে দিচ্ছি — উনি দেখে আপনাকে জানাবেন। একটু অপেক্ষা করবেন প্লিজ 🙏 | Apnar bepar ta ami senior ke janiye dichchi — uni dekhe apnake janaben. Ektu wait korben please 🙏 | Let me pass this to the owner — he'll take a look and get back to you shortly 🙏 |
| **H2** lost / low-confidence | এই ব্যাপারটা যিনি ভালো জানেন উনাকেই জিজ্ঞেস করে আপনাকে সঠিকটা জানাচ্ছি — একটু সময় দিন। | Ei bepar ta jini bhalo janen unake jiggesh kore apnake thik ta janachchi — ektu somoy din. | Let me check with the person who knows this best so you get the right answer — one moment. |
| **H3** anger | সত্যিই দুঃখিত আপনার এই অভিজ্ঞতার জন্য। বিষয়টা এখনই দায়িত্বে যিনি আছেন উনাকে জানাচ্ছি — উনি নিজে আপনার সাথে কথা বলবেন। | Really sorry apnar ei experience er jonno. Bishoy ta ekhoni senior ke janachchi — uni nije apnar sathe kotha bolben. | Really sorry about this experience. I'm flagging it right now — the owner will speak with you personally. |
| **H4** payment dispute (ack) | ট্রানজেকশন আইডিটা (bKash/Nagad) একটু দিয়ে রাখুন — আমি এখনই চেক করার জন্য পাঠিয়ে দিচ্ছি। | Transaction ID ta (bKash/Nagad) ektu diye rakhun — ami ekhoni check korar jonno pathiye dichchi. | Please share the bKash/Nagad transaction ID — I'm sending it for checking right away. |
| **H5** legal/threat (neutral, no admission) | বিষয়টা গুরুত্বের সাথে নেওয়া হয়েছে। সংশ্লিষ্ট ব্যক্তিকে এখনই জানানো হচ্ছে — উনি আপনার সাথে যোগাযোগ করবেন। | Bishoy ta gurutto diye neya hoyeche. Songslishto bekti ke ekhoni janano hochche — uni apnar sathe jogajog korben. | This has been noted seriously. The responsible person is being informed and will contact you. |
| **H6** price/money check | দামের ব্যাপারটা একটু উপরের সাথে কথা বলে আপনাকে বেস্টটা জানাচ্ছি 🙂 | Dam er bepar ta ektu senior er sathe kotha bole apnake best ta janachchi 🙂 | Let me check with the owner on the price — I'll get you the best we can do 🙂 |
| **S1** SLA update | একটু দেরি হচ্ছে বলে দুঃখিত 🙏 আপনার বিষয়টা এখনো দেখা হচ্ছে — জানার সাথে সাথেই আপনাকে জানানো হবে। | Ektu deri hochche bole sorry 🙏 apnar bishoy ta dekha hochche — janar sathe sathei apnake janano hobe. | Sorry for the wait 🙏 — this is still being looked at. You'll hear from us as soon as there's an update. |

**SLA sweep** — a dakio-api novaCron every 10 min, no model, no NovaJob: finds `handledBy='founder' AND escalatedAt IS NOT NULL AND slaNextUpdateAt < now AND slaUpdatesSent < inbox.slaMaxHoldingUpdates (default 1)`, and — outside `inbox.quietHours` (default 23:00–08:00 Dhaka), fire-time window re-check per C-28 — sends S1 as a system template send, increments `slaUpdatesSent`, nulls `slaNextUpdateAt`. One polite update, then silence: repeated "still checking!" reads as a bot. S1 never contains an ETA, a promise, or an invented status. At **24h founder-silent**: no more customer messages — Decision priority pins to 1, an `activity.created` feed line fires ("Rafiq has been waiting 24h in Messenger"), statusLine updates. Voluntary takeovers (`novaLockedAt` set, `escalatedAt` null) get **no SLA messages** — the founder chose the thread; Nova's only duty there is silent drafting.

### 5. Founder notification path (no push infra — everything rides what exists)

1. The escalation Decision itself (kind `escalation`, priority 1) surfaces on all five existing decision surfaces for free (DecisionDesk, NovaDesk cards, dept-room WAITING ON YOU, suggestion chips pin needs-you, inline chat cards).
2. Sidebar pulsing dot: module 09 adds `inbox` to `DOOR_OF` + `novaDoor:'inbox'` on the Inbox nav item; the prepared draft makes `pending > 0` → lime ping within the existing 60s presence poll.
3. SSE toast: this module adds the `conversation.escalated` branch to the `NovaContext.jsx:303-315` switch (unknown types are silently dropped today) → toast "Customer waiting on you in Messenger — Rafiq" deep-linking `/inbox?c=<id>` + `liveVersion` bump. Escalations are never SSE-only — the presence poll and decision refetch are the reliable fallback (single-instance bus caveat).
4. statusLine ticker: server-set, zero UI change.
5. v1 explicitly has **no push/email**. v2: email on 24h breach; WhatsApp/Telegram founder ping later.

### 6. CONTEXT BRIEF — the exact shape (req #22)

The brief lives on the prepared action's payload, so it travels with the existing `decisionCard` nested-action shape (`novaDashboard.js:213-254`) — no new read endpoint.

`NovaDecision` fields: `title` ≤60 chars, customer name first ("Rafiq wants a human — payment issue"); `paramsLine` ("Messenger · 2 orders · LTV ৳4,200 · 0 RTO · reason: payment_dispute"); `impactLabel` only when a real order/cart amount is in evidence ("৳2,350 order at stake") — never invented; `why` ≤400 chars (bn via `whyBn` in payload).

Linked prepared `send_inbox_reply` payload:

```jsonc
{
  "conversationId": "cln…",
  "inReplyToMessageId": "im_…",      // latest inbound Nova saw — drives staleness (Design 11)
  "purpose": "escalation_draft",
  "chunks": [{ "text": "ভাইয়া, আপনার bKash পেমেন্টটা চেক করা হয়েছে — TrxID 9J7X1A2B3C তে ৳2,350 এসেছে। অর্ডারটা আজকেই কুরিয়ারে দিয়ে দিচ্ছি।" }],
  "brief": {
    "reason": "payment_dispute",
    "summary": "Rafiq paid ৳2,350 by bKash for order #1042 but it still shows unpaid…",
    "summaryBn": "রফিক অর্ডার #1042 এর জন্য বিকাশে ৳2,350 দিয়েছেন কিন্তু…",
    "customer": { "name": "Rafiq Islam", "platform": "messenger", "senderId": "<psid>",
                  "customerId": "c_…|null", "ordersCount": 2, "ltvMinor": 420000,
                  "rtoCount": 0, "vip": false },
    "lastMessages": [ { "dir": "in", "text": "…", "at": "…" } ],   // ≤5, verbatim
    "factsChecked": [ { "source": "order_lookup", "note": "Order #1042 status=pending_payment, total ৳2,350" } ],
    "openPromises": [ { "promiseId": "np_…", "text": "stock asle janabo", "dueAt": "…" } ],
    "suggestedAction": { "verb": "assign_courier", "payload": { "orderId": "…" } }   // optional
  }
}
```

`factsChecked` mirrors receipt evidence — the founder sees exactly what Nova verified vs. couldn't; nothing may appear in the brief that isn't in evidence or verbatim from the thread. `openPromises` is assembled server-side from module 03's NovaPromise rows (`status:'open'` for this conversation/customer) — the founder inherits the debts (req #22).

### 7. Founder reply paths, hand-back, resume

**Tap-send** = existing `POST /nova/decisions/:id/approve`, optionally with `body.edits` (customize-then-approve applied before the at-most-once claim). Module 02's dakio-api `EXECUTORS['send_inbox_reply']` re-checks staleness rules (b)/(c) of Design 11 — founder approval does not bypass "the customer double-texted since": it 409s honestly and the server refreshes the brief's `lastMessages`. Rule (a) (`handledBy='founder'`) is waived for founder-approved actions — the approval IS the founder acting. On success: Meta send with metadata stamp, `InboxMessage {actor:'nova', novaActionId, purpose}`, activity `{department, kind:'inbox_reply', minutesSaved: 3}` (canonical MINUTES — not 8). The claim is at-most-once across desk/room/chat/inbox surfaces — an escalation can never double-send.

**Type-your-own** = the founder types in `/inbox`; `POST /meta/send-message` now records `actor:'founder'` + implicit takeover (Design 11.1). If an escalation Decision was open, it auto-settles `rejected` with `decidedBy:'founder_manual_reply'` — honest trust signal (a founder preferring their own words over the draft IS a rejection, ×1.5 in `computeTrust`) and the queue never shows a stale card. Edited tap-sends count as approvals with `edits` recorded.

**Hand-back protocol — explicit only; founder silence never hands a thread back:**

1. Button (module 10) → `POST /meta/conversations/:id/release` (merchant JWT). bn label: "Nova-কে ফিরিয়ে দিন" (Nova-ke firiye din — hand back to Nova).
2. **Tap-send auto-hand-back (default on):** approving the escalation's suggested reply hands the thread back, with a "keep this thread with me" opt-out (`body.keepThread:true` passed through the approve route to the executor). Rationale: tap-send exists so the founder can clear a queue in seconds; a forced second tap would kill that.
3. v2: founder-chat verbal command.

Release effect (one transaction): `handledBy='nova'`, `handedBackAt=now`, `novaLockedAt=null`, escalation fields + `slaNextUpdateAt` cleared, `novaLowConfidenceStreak=0`; enqueue NovaInbox `conversation.handed_back` (dedupeKey `handed_back:<convId>:<ISO>`) so the session resumes with full context; emit SSE `conversation.handed_back`. The release body optionally carries `promises: [{kind, text, dueAt}]` (`dueAt` an ISO string, required — aligned with module 03's quick-picks) — founder-promise quick-picks (module 10 UI) that the route forwards to module 03's NovaPromise creation (`madeBy:'founder'`), so "kalke pathabo" typed by the founder becomes a tracked debt.

The service-side counterpart `POST /api/v1/inbox/conversations/:id/claim` lets Nova flip `handledBy` back to `'nova'` itself — allowed **only** when `novaLockedAt IS NULL` and the escalation Decision is settled (approved/rejected/expired); otherwise 409. This covers "escalation resolved via tap-send with keepThread accidentally left on" and decision-expiry cleanup without ever overriding a human lock.

**Resume rules (instruction-level, hard — verbatim into `50-customer-inbox.ts`):** on hand-back Nova (a) reads everything since the lock; (b) speaks **only if there is an unanswered customer message** — if the founder resolved it, Nova stays silent until the customer writes again; (c) never re-greets, never re-introduces, never summarizes "what happened while I was away" — it continues like the same shop assistant who stepped away; (d) a founder in-thread commitment ("kalke pathabo") is now thread truth Nova must honor and may cite as evidence source `founder_commitment`.

### 8. Autonomy encoding — T0–T3 on existing machinery (req #25, #11)

Founder-facing 4-position dial: **T0 Shadow / T1 Front Desk / T2 Order Taker / T3 Closer**. The store-wide level stays at its hire default (L3); the inbox ladder moves independently:

| Tier | `NovaAgentMode {scope:'door:inbox'}` | Effective level | Guardrail keys |
|---|---|---|---|
| **T0 Shadow** | `assisted` (ceiling 2) | 2 → every verb verdicts `draft` | — |
| **T1 Front Desk** | `autonomous` | 3 → low-risk executes; branches gate the rest | `inbox.orderAuto:false, discountAuto:false, cancelAuto:false` |
| **T2 Order Taker** | `autonomous` | 3 | `inbox.orderAuto:true` |
| **T3 Closer** | `autonomous` | 3 | + `discountAuto:true, cancelAuto:true` |

**Bookkeeping-verb carve-out (this module owns the definition).** Verbs with zero customer-visible or external side effects — `link_customer_identity`, `schedule_follow_up`, `open_case`, `flag_courier_issue` — are exempt from the tier ceiling in `verdictForLevel` and execute at every tier, including T0 Shadow; every other verb drafts at T0. Implementation: a `BOOKKEEPING_VERBS` set consulted before the ceiling check — membership short-circuits to `execute`, non-members fall through to the normal ceiling/guardrail path. Customer-visible verbs are never in the set.

Key ruling (C-2): **inbox mutation verbs are `RISK_CLASS 'low'` with fail-closed guardrail branches**, not `medium`. `verdictForLevel` only distinguishes low vs not-low at L3 — `medium` would pin chat orders to draft until store-wide L4, coupling the inbox dial to the whole store. Each verb's `checkGuardrails` branch returns `needs_approval` unless its `inbox.*Auto` key is `true` AND caps pass; **a missing platform key reads `false`** — a tenant without inbox guardrails provisioned drafts everything. The guardrail IS the risk control; the branch is the matrix cell.

Since `resolveMode` reaches `door:inbox` via the duty's `doorModule`, every inbox action carries a `dutyRef`. This module registers no duties — it consumes the five inbox duties registered elsewhere, all `minLevel: 2` so Shadow (effective 2) can draft (C-24): module 02 registers `support.inbox_replies` and `support.inbox_escalations`; module 05 registers `sales.inbox_orders`, `sales.inbox_discounts`, `sales.inbox_cart_recovery` (module 06 adds `shipping.delivery_cases`, `shipping.predispatch_confirms`).

The matrix (`auto` = executed + logged; `prepared` = draft + Decision; `blocked→escalate` = receipted blocked row + escalation). Every cell is a real `evaluateAuthority` outcome — nothing bespoke:

| Capability | T0 | T1 | T2 | T3 |
|---|---|---|---|---|
| Reply on safe intent (`send_inbox_reply`, intent ∈ `inbox.autoIntents`) | prepared | auto | auto | auto |
| Reply on non-safe intent (rule `guardrail:inbox_intent_not_auto`) | prepared | prepared | prepared | prepared |
| Holding + SLA templates (system sends) | auto | auto | auto | auto |
| Escalate thread (`escalate_conversation`) | auto | auto | auto | auto |
| Create COD order (`create_order_from_chat`) — COD ∧ total ≤ `inbox.maxAutoOrderMinor` ∧ address+phone confirmed in-thread ∧ `rtoCount < inbox.rtoShadowThreshold` | prepared | prepared | **auto** | auto |
| Create order — over cap / non-COD / unconfirmed / `rtoCount ≥ 2` (rule `guardrail:inbox_order_needs_review`) | prepared | prepared | prepared | prepared |
| Address/phone change pre-dispatch (`update_order_contact`) | prepared | prepared | auto | auto |
| Address change post-dispatch (module 06: case, human coordination) | prepared | prepared | prepared | prepared |
| Discount ≤ `maxDiscountPct`, ≤1 per customer per `inbox.discountPerCustomerDays` (`offer_chat_discount`) | prepared | prepared | prepared | **auto** |
| Discount > `maxDiscountPct` | blocked→escalate | blocked→escalate | blocked→escalate | blocked→escalate |
| Cancel order pre-dispatch (`cancel_order_from_chat`) | prepared | prepared | prepared | auto |
| Refund promise / payment confirmation (`refund_promise` — FOUNDER_ONLY) | blocked→escalate | blocked→escalate | blocked→escalate | blocked→escalate |
| Delivery-date promise beyond courier data | never (instruction-level prohibition, not a verb) | never | never | never |

Notes: `refund_promise` joins `FOUNDER_ONLY` alongside `bulk_refund` — proposals at every level forever; `maxAutoRefundTotal` stays unenforced-and-irrelevant because no refund verb auto-executes. The RTO guard is a first-class cell: `rtoCount ≥ inbox.rtoShadowThreshold (2)` forces every order for that customer through the founder at every tier; the draft's `paramsLine` flags it ("৩ বার পার্সেল রিসিভ করেননি" — tin bar parcel receive korenni, refused delivery three times).

**Guardrail platform keys** (this module owns the registry; consumers noted; flat namespace per C-16; missing key ⇒ `false`/absent ⇒ fail closed — a **tested invariant**):

```jsonc
{
  "inbox.autoIntents": ["general","product_question","price_query","availability_check",
                        "order_status","delivery_eta","checkout_help"],   // safe-intent allowlist (02 consumes)
  "inbox.orderAuto": false,            "inbox.maxAutoOrderMinor": 500000,     // ৳5,000 (05)
  "inbox.discountAuto": false,         "inbox.discountPerCustomerDays": 30,   // (05)
  "inbox.cancelAuto": false,           "inbox.rtoShadowThreshold": 2,         // (05/06)
  "inbox.paymentDisputeEscalateMinor": 200000,                               // ৳2,000 (08)
  "inbox.vipLtvMinor": 5000000,        "inbox.vipPolicy": "notify",           // (08)
  "inbox.slaHoldingHours": 4,          "inbox.slaMaxHoldingUpdates": 1,       // (08)
  "inbox.quietHours": { "start": "23:00", "end": "08:00" },                  // Asia/Dhaka (04/08)
  "inbox.maxProactiveTouchesPerWeek": 4, "inbox.maxUnansweredProactiveStreak": 2, // (04)
  "inbox.highValueMinor": 500000,   // (11) high-value iff LTV OR live cart/quote total >= threshold (default ৳5,000)
  "inbox.shadowStartedAt": "<ISO>",    "inbox.draftWhileFounderActive": true, // (08)
  "inbox.escalationLexiconExtra": [],  "inbox.holdingTemplates": {}           // (08)
}
```

**New `AuthorityDecision.rule` strings** (all with `explanation` + `explanationBn`): `guardrail:inbox_intent_not_auto` · `guardrail:inbox_order_auto_off` · `guardrail:inbox_order_over_cap` · `guardrail:inbox_order_needs_review` · `guardrail:inbox_discount_auto_off` · `guardrail:inbox_discount_frequency` · `guardrail:inbox_cancel_auto_off` · `guardrail:inbox_escalated` · `founder_only:refund_promise` · `concurrency:founder_active` · `concurrency:stale_reply` · `duty:thread_off`.

Tier switching is a founder action, Owner/Admin only (`OWNER_ROLES`): `PUT /api/nova/inbox/tier` writes `NovaAgentMode {scope:'door:inbox'}` + a new NovaGuardrails version flipping the tier's `inbox.*Auto` keys in one transaction. T1+ positions are refused (422, honest reason) until Shadow exit criteria are met. `PUT /api/nova/inbox/tier` is the ONLY write path for the inbox dial: the merchant AgentBar dial calls it, and `PUT /nova/agents/:dept/mode` rejects scope `door:inbox` with 422, so the shadow lockout cannot be bypassed.

### 9. T0 Shadow — the mandatory first week

Enabling Nova-in-Inbox seeds `NovaAgentMode {scope:'door:inbox', mode:'assisted'}` + `platform['inbox.shadowStartedAt']`. Every reply Nova would send is written in full, in the customer's language, and lands as a prepared action + Decision within seconds; the founder taps to send (with optional edit). Nothing reaches a customer without a tap — except system template holding/SLA lines (deterministic, founder-authored text). Shadow is architecturally free: the channel never delivers model text anyway (module 02), so Shadow is just "ceiling 2 ⇒ every verdict drafts".

**Exit criteria (all, computed from the ledger — no new counters):** ≥7 calendar days since `inbox.shadowStartedAt`; ≥25 shadow drafts approved; edit rate ≤20% of approvals (Decision `edits`); rejection rate ≤5% — **plus module 11's outcome conditions** (≥10 approved replies in conversations that reached quiet-satisfied). Promotions T1→T2 (≥10 approved order drafts, 0 rejected, + ≥5 DELIVERED ≤1 RETURNED per module 11) and T2→T3 (≥10 approved discount drafts + delivered conversions + inbox-slice trust ≥0.85) follow the same shape. When met, Nova files `NovaDecision {kind:'promotion'}` with the evidence in `paramsLine` ("14 orders drafted · 9 delivered · 1 returned · trust 0.88") — the founder approves; promotion is **never automatic**, and demotion offers (module 11) are Decisions too. The dial UI shows progress honestly ("Shadow since Jul 25 · 14/25 drafts sent · 2 edits").

Tell the founder what the week is for: shadow is not a trial delay — it's how Nova learns the store's voice. Every edit is a style lesson; every rejection writes a standing objection via `learnFromRejection` (exists today).

### 10. Failure honesty — what Nova says when it cannot know

Fact discipline (persona-level, enforced by receipts): any order, stock, courier, or payment fact stated to a customer must have been tool-read **in the same turn** and cited in `receipt.evidence` (evidence ≥1 is already API-enforced, `nova.js:107-156`). "If you didn't read it this turn, you don't know it." Module 11 owns the full 10-item never-invent list; these rows are the handover-owned fallback set:

| Situation | Nova says (bn / romanized gloss) | Then |
|---|---|---|
| Order-status lookup fails | আপনার অর্ডারের লেটেস্ট আপডেটটা এই মুহূর্তে চেক করতে পারছি না — একটু পরে দেখে আপনাকে জানাচ্ছি। (Apnar order er latest update ta ei muhurte check korte parchi na — ektu pore dekhe janachchi.) | Retry next turn; 2 consecutive tool failures on one conversation → escalate reason `tool_failure`; brief states exactly what couldn't be checked. |
| Courier has no scan yet | Handover recorded: কুরিয়ারে দেওয়া হয়েছে, নতুন আপডেট আসলেই জানাবো। (Courier e deya hoyeche, notun update ashlei janabo.) Otherwise: অর্ডারটা প্রসেসিং-এ আছে — কুরিয়ারে গেলেই ট্র্যাকিং জানিয়ে দিবো। (Order ta processing e ache — courier e gelei tracking janiye dibo.) | Never invent a scan, location, or date. |
| Stock uncertain | স্টকটা কনফার্ম করে জানাচ্ছি আপনাকে — একটু সময় দিন। (Stock ta confirm kore janachchi apnake — ektu somoy din.) | Check; if unknowable → counts toward `lost` streak. |
| Doesn't know the answer | সঠিকটা জেনে আপনাকে জানাচ্ছি — ভুল বলতে চাই না। (Thik ta jene apnake janachchi — bhul bolte chai na.) | Increments `novaLowConfidenceStreak`; ×2 → escalate `lost`. This line is a feature — a real shop assistant says exactly this. |
| Payment can't be verified | H4 (collect trxID) — never "টাকা পাইনি" (taka paini — accusation), never "পেয়েছি" (peyechi — unverified confirmation). | Escalate per trigger row 3. |

**Banned utterances (instruction-level, every tier):** invented delivery dates ("কালকেই পাবেন" / kalkei paben, without courier-SLA evidence), invented stock, refund timelines, "হয়ে গেছে / done" for anything not `status:'executed'` in the ledger, and any claim that a human is "typing right now" when none is.

### 11. Concurrency — the founder always wins

Rule zero: no exceptions, no merge, no "Nova finishes its thought."

**11.1 Implicit takeover from the Dakio inbox.** `POST /meta/send-message` gains, in the same transaction as the `InboxMessage {actor:'founder'}` insert: `handledBy='founder'`, `novaLockedAt=now`; cancel queued `InboxOutbound` rows (`cancelReason:'founder_takeover'`); emit SSE `conversation.taken_over`; enqueue NovaInbox `conversation.taken_over` (dedupeKey `taken_over:<convId>:<messageId>`) so the in-flight session turn learns and stops; ledger via `recordFounderAction(verb:'send_inbox_reply')`; auto-settle any open escalation Decision (Design 7).

**11.2 Server-side staleness guard (why Nova can never win a race).** The reply route carries `inReplyToMessageId` = newest inbound Nova had seen when composing. In one transaction over the conversation row, 409 when:

- (a) `handledBy='founder'` or `novaLockedAt` set → `concurrency:founder_active` (waived only for founder-approved `escalation_draft` executions);
- (b) any outbound with `actor ∈ {founder, founder_external}` exists newer than that inbound — someone already answered → `concurrency:founder_active`;
- (c) any newer **inbound** exists and the send's purpose is substantive (not `holding`/`sla_update`) — the customer double-texted; Nova must re-read → `concurrency:stale_reply` (the channel's burst queue redelivers).

On 409 the executor writes the blocked `NovaAction` with the returned rule; dept rooms render it with the existing `blocked` chip. The model never retries a `founder_active` block — it treats the thread as handed over.

**11.3 Takeover from outside Dakio.** Module 01 stamps every Dakio-originated Send API call with `metadata` (`dakio:nova:<novaActionId>` / `dakio:founder:<userId>` / `dakio:system:<novaActionId>`), subscribes `message_echoes`, and classifies echoes (2s delayed re-check for the send-then-insert race). An unstamped, unknown echo is an out-of-band human send: `InboxMessage {actor:'founder_external'}` + the full 11.1 takeover. This module's contribution is the ruling that `founder_external` IS a takeover — without it the lock has a hole the size of every founder's phone (today `meta.js:532-534` drops all page echoes and `message_echoes` isn't subscribed, `meta.js:273`).

**11.4 Silent drafting on founder-held threads.** While the thread is founder-held and `inbox.draftWhileFounderActive:true` (default), new customer messages still flow (C-22: emit is suppressed only for actor≠customer, tenant-not-hired, or `novaEnabled:false`) and produce **prepared** drafts — the guardrail branch forces `needs_approval` on send verbs for held/locked threads independent of tier, and the server gate (11.2a) makes auto-send structurally impossible. The founder sees fresh suggested replies appear as the customer talks; the customer never sees Nova. The per-thread switch `PATCH /meta/conversations/:id/nova {enabled:false}` stops even drafting: events suppressed at ingest, any attempted send verdicts `blocked` with rule `duty:thread_off`.

### 12. Audit trail — every step lands in existing exportable stores

| Event | Record |
|---|---|
| Escalation | executed system `NovaAction` (holding send) + prepared `NovaAction` (draft w/ brief) + `NovaDecision kind:escalation` + conversation `escalatedAt/escalationReason/escalationDecisionId` |
| Holding / SLA sends | `NovaAction actor:'system'` + `InboxMessage actor:'system', novaActionId` |
| Tap-send | Decision approved (`decidedBy, decidedAt, edits`) + action prepared→executed + `InboxMessage actor:'nova', novaActionId` + activity "Approved by owner" |
| Founder manual reply | `InboxMessage actor:'founder'` + `recordFounderAction` row + auto-rejected Decision if open |
| External reply | `InboxMessage actor:'founder_external'` + takeover fields |
| Takeover / hand-back | `novaLockedAt` / `handedBackAt` + SSE `conversation.taken_over` / `conversation.handed_back` |
| Nova blocked by concurrency | blocked `NovaAction` rule `concurrency:*` |

The existing NDJSON ledger export (`GET /nova/ledger/export`) covers the whole handover history; conversation columns give the per-thread view.

---

## Data model

No new models in this module (NovaPromise is module 03; NovaCase is module 06). One migration extending `InboxConversation` — module 01's base migration already landed `handledBy`, `novaLockedAt`, `escalatedAt`, `escalationDecisionId`, `novaEnabled`, `lastInboundAt`, `windowExpiresAt`:

```prisma
model InboxConversation {
  // ...existing + module-01 columns...
  escalationReason        String?    // NEW (08): closed set — human_ask|anger|payment_dispute|legal|lost|negotiation|guardrail:<rule>|vip|tool_failure|fraud_risk
  handedBackAt            DateTime?  // NEW (08): last explicit hand-back
  slaNextUpdateAt         DateTime?  // NEW (08): business-time due mark for S1; null after send/hand-back
  slaUpdatesSent          Int        @default(0)  // NEW (08): capped by inbox.slaMaxHoldingUpdates
  novaLowConfidenceStreak Int        @default(0)  // NEW (08): reset on confident turn and on hand-back

  @@index([tenantId, handledBy, escalatedAt])  // NEW (08): escalation queue + SLA sweep scan
}
```

Migration notes: pure additive, no backfill (all existing rows read as never-escalated). `derived novaState` in merchant responses is NOT a column (C-5) — computed from handledBy/novaLockedAt/escalatedAt/open draft/in-flight delivery. Meta data-deletion: these columns ride the existing `InboxConversation` hard-delete cascade (module 01 owns the handler); `escalationDecisionId` is a plain string, not an FK, so Decision history survives conversation deletion while the conversation row itself is fully removable. Guardrail keys are `NovaGuardrails.platform` Json entries — versioned-immutable rows, no schema change.

---

## APIs & interfaces

**dakio-api — service surface** (`src/routes/novaInbox.js`, `authenticateNovaService + requireTenant`, writes `w()`-idempotent via `src/lib/novaIdempotency.js`):

- `POST /api/v1/inbox/conversations/:id/handover` — body `{reason, summary, summaryBn, suggestedReply, suggestedAction?, factsChecked:[{source,note,metric?,value?}]}`. Runs the Design-3 transaction. 200 `{escalated:true, decisionId, holdingSent:true|false}`; open escalation → `{escalated:true, alreadyEscalated:true, decisionId}` (brief updated). 404 cross-tenant (findFirst by tenantId).
- `POST /api/v1/inbox/conversations/:id/claim` — body `{}`. Flips `handledBy='nova'` + clears escalation fields iff `novaLockedAt IS NULL` and the escalation Decision is settled; else 409 `{code:'conversation_locked'|'escalation_open'}`.

**dakio-api — merchant surface** (`src/routes/meta.js`, merchant JWT):

- `POST /meta/conversations/:id/takeover` — explicit takeover without typing: sets `handledBy='founder'`, `novaLockedAt=now`, cancels queued outbound (`founder_takeover`), SSE + NovaInbox `conversation.taken_over`. 200 `{handledBy:'founder', novaLockedAt}`.
- `POST /meta/conversations/:id/release` — body `{promises?: [{kind, text, dueAt}]}` (`dueAt` ISO string, required per entry). Runs the Design-7 release transaction; forwards promises to module 03. 200 `{handledBy:'nova', handedBackAt}`. (One pair — no `/handback` alias, C-9.)
- `PATCH /meta/conversations/:id/nova` — body `{enabled: boolean}`. Server-enforced per-thread toggle.
- `POST /meta/send-message` — changed: same-transaction implicit takeover (Design 11.1).
- `PUT /api/nova/inbox/tier` (`src/routes/novaDashboard.js`, Owner/Admin) — body `{tier:'T0'|'T1'|'T2'|'T3'}`. Atomically writes `NovaAgentMode {scope:'door:inbox'}` + new guardrails version; 422 with honest bn+en reason when exit criteria unmet. `GET` returns `{tier, shadow:{startedAt, approvedDrafts, editRatePct, rejectRatePct, eligible}}`.

**SSE (merchant bus):** `conversation.escalated {conversationId, customerName, reason, decisionId}` · `conversation.taken_over {conversationId}` · `conversation.handed_back {conversationId}`.

**nova-ai:**

- Tool `flag_handover` (`agent/tools/flag_handover.ts` — file owned by module 02) — inputSchema `{conversationId, reason: z.enum([...closed set]), summary, summaryBn, suggestedReply, suggestedAction?, factsChecked[], receipt}`; verb `escalate_conversation` (risk `low`, MINUTES 2, not undoable, department from param, never gated — no guardrail branch may return needs_approval for it). Verb-registration plumbing (types/schemas/executor wiring) and the tool file ship with module 02; this module extends the server-side executor only and owns the `/handover` route.
- `agent/lib/nova/autonomy.ts` — `checkGuardrails` branches for `send_inbox_reply` (autoIntents allowlist, `escalation_draft` always needs_approval, held/locked thread needs_approval, `novaEnabled:false` blocked `duty:thread_off`), plus the fail-closed `inbox.*Auto`/cap branches consumed by modules 05/06 verbs. All branches read missing keys as `false`.
- `agent/lib/nova/authority.ts` — `FOUNDER_ONLY` += `refund_promise`.
- `agent/lib/duties.ts` — no rows added here; the five inbox duties (`minLevel: 2`, door `Inbox`) are registered by modules 02 (support ×2) and 05 (sales ×3) and consumed by this module.
- `agent/instructions/50-customer-inbox.ts` — escalation-behavior rules, resume rules (Design 7), failure-honesty lines + banned utterances (Design 10). Loads only for `authenticator === 'dakio-inbox'`.

---

## Files touched

**dakio-api**
- `prisma/schema.prisma` + migration — InboxConversation 08 columns + index (Data model).
- `src/routes/novaInbox.js` — `POST /conversations/:id/handover`, `POST /conversations/:id/claim` (extends module 01/02's file).
- `src/routes/meta.js` — implicit-takeover tx in `/meta/send-message`; `takeover` / `release` / `nova` toggle routes.
- `src/routes/novaDashboard.js` — `PUT/GET /nova/inbox/tier`; approve route passes `body.keepThread` through to the executor context.
- `src/lib/inboxEscalationLexicon.js` (new) — NFC-normalized trigger lexicons + `hintsFor(text, tenantExtra)`; consumed by module 01's `handleMessage`.
- `src/lib/inboxHoldingTemplates.js` (new) — H1–H6/S1 defaults, per-tenant override merge from `platform['inbox.holdingTemplates']`, script-matching pick (bn/banglish/en), `{{signature}}` interpolation.
- `src/lib/novaCron.js` — 10-min SLA sweep (business-time due check, quiet-hours + window fire-time re-check, S1 system send, 24h feed-line ladder).
- `src/lib/novaInboxShadow.js` (new) — exit-criteria computation from Decision/Action counts (+ module 11's outcome conditions when it lands); promotion-Decision filing.

**nova-ai**
- `agent/tools/flag_handover.ts` — file owned by module 02; this module extends its server-side executor only.
- `agent/lib/nova/autonomy.ts` — inbox guardrail branches (fail-closed).
- `agent/lib/nova/authority.ts` — `FOUNDER_ONLY` += `refund_promise`.
- `agent/lib/duties.ts` — no new rows (5 inbox duty rows registered by modules 02/05, consumed here).
- `agent/instructions/50-customer-inbox.ts` — escalation/resume/failure-honesty sections (file owned by module 02).

**dakio-merchant**
- `src/context/NovaContext.jsx` — `conversation.escalated` switch branch → toast + `liveVersion` bump (`taken_over`/`handed_back` branches bump only). All other founder UI is module 10.

---

## Testing

**dakio-api** (node:test, files added to the package.json test list):

- `test/novaInboxHandover.test.js` —
  1. Given an open conversation, when `/handover` runs, then one transaction yields conversation fields + system holding InboxOutbound + prepared `escalation_draft` action + priority-1 escalation Decision, and a replayed `w()` call creates nothing new.
  2. Given an open escalation, when a second trigger fires, then no second Decision — brief updated, `alreadyEscalated:true`.
  3. Given `handledBy='founder'` via typed send, when Nova's reply POST arrives with a stale `inReplyToMessageId`, then 409 `concurrency:founder_active` and a blocked NovaAction row exists.
  4. Given a founder-approved `escalation_draft` where the customer double-texted after `inReplyToMessageId`, then approve 409s `concurrency:stale_reply` and the Decision stays open with refreshed `lastMessages`.
  5. Given a manual founder reply with an open escalation, then the Decision auto-settles `rejected (decidedBy:'founder_manual_reply')` and `novaLockedAt` is set in the same tx.
  6. Given release with `promises:[...]`, then handledBy/lock/escalation fields reset atomically, `conversation.handed_back` NovaInbox row enqueued with the exact dedupeKey, and the promise payload reaches the module-03 creation path.
  7. Given `claim` on a thread with `novaLockedAt` set, then 409 and no field changes.
- `test/inboxSlaSweep.test.js` — due escalation inside quiet hours sends nothing; outside quiet hours sends exactly one S1 then never again (`slaUpdatesSent` cap); voluntary takeover (lock set, `escalatedAt` null) is never selected.
- `test/inboxEscalationLexicon.test.js` — bn/banglish/en corpus per trigger row incl. NFC matra forms; `legal_threat_abuse` always hinted; "মালিক কে?" brand question yields hint (model-confirm layer's job to drop it).

**nova-ai** (repo suite + isolation suite):

- `agent/tests/inboxAuthority.test.ts` — **fail-closed invariant:** with an empty `platform`, every `inbox.*Auto`-gated verb verdicts `needs_approval`; `escalation_draft` purpose needs_approval at T3; `escalate_conversation` executes at T0; `refund_promise` refuses with `founder_only:refund_promise` at effective L4; T0 (`assisted` ceiling 2) drafts `send_inbox_reply` even for `inbox.autoIntents` members; T0 executes `link_customer_identity`/`schedule_follow_up`/`open_case`/`flag_courier_issue` (BOOKKEEPING_VERBS carve-out); duty minLevel 2 admits Shadow.
- Isolation: `flag_handover` under tenant-A principal cannot escalate tenant-B's conversation (404 path).
- CI eval (module 12 registry): guardrail-breach suite rows for the new rule strings; persona red-team asserting no "guardrail"/"bot" leakage in holding lines.

---

## Risks & trade-offs

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Worst customer failure — double reply**: founder answers on their phone while a Nova send is mid-flight | medium | metadata-stamped echo classification + cancel-on-takeover (`founder_takeover`) + staleness 409s; residual window is the seconds between Graph send and echo — monitor `founder_external` rows matching recent Nova sends (module 01 alarm) |
| Echo race misclassifies our own send as external takeover | medium | metadata-first classification + 2s delayed re-check (module 01); wrongly locked thread is recoverable via release — fail direction is safe (Nova silent, never doubled) |
| Lexicon false positives ("মালিক" in a brand question) → escalation spam erodes trust | medium | lexicon is a hint except `legal_threat_abuse`; model confirms; one-escalation-per-open cap |
| Shadow-week neglect: founder ignores drafts, customers get holding lines and silence | medium | onboarding copy sets the ritual ("week 1: you tap, Nova types"); sidebar dot + statusLine keep the queue visible; module 10's morning-review stack |
| Fail-closed dependency: a typo'd guardrail key silently reads `false` and drafts everything | low | that IS the safe direction; tested invariant pins it; tier route writes keys programmatically, never hand-edited |
| Session/lock divergence: eve session lags the DB lock | medium | DB is sole authority; server 409s are the guarantee; channel re-checks per turn |
| Single-instance SSE bus drops escalation toasts under multi-replica | low (single instance today) | escalations are never SSE-only: 60s presence poll + decision refetch are the reliable path |
| SLA S1 fires after the founder already replied externally but before echo lands | low | S1 selection re-checks `handledBy`/last-outbound actor at send time inside the sweep tx |

---

## Gate

**Scripted demo (non-builder, clean staging store, Messenger test page):**

1. Enable Nova-in-Inbox → verify tier shows T0 Shadow and the dial's T1+ positions are disabled with an honest reason.
2. Send "আসল মানুষ আছে?" as the customer → within seconds: holding line H1 arrives in Messenger (Bangla), a priority-1 escalation card appears on DecisionDesk AND the Support room AND as a toast, statusLine reads "1 customer waiting on you in Messenger".
3. Open the card → brief shows customer facts, last messages verbatim, factsChecked, a ready reply in Bangla. Tap SEND with a small edit → reply lands in Messenger once (verify no duplicate), thread state returns to Nova (hand-back), Decision shows approved-with-edits.
4. Customer writes again; while Nova is composing, type a reply in `/inbox` → your message sends, Nova's does not; the ledger shows a blocked row `concurrency:founder_active`; drafts keep appearing silently.
5. Reply from the Meta Business Suite app (outside Dakio) → within ~5s the thread shows founder-owned; Nova stays silent.
6. Tap "Hand back to Nova" with a promise quick-pick → Nova resumes on the customer's next message without re-greeting; the promise appears in the commitments view.
7. Attempt `PUT /nova/inbox/tier {tier:'T2'}` before exit criteria → 422 with bn+en reason.

**Measurable checks:** 0 customer-visible sends with `actor:'nova'` on any locked thread across the demo (SQL assert); every escalation has exactly one Decision; `test/novaInboxHandover.test.js` + `inboxAuthority.test.ts` green in CI; guardrail-breach eval suite green.

**Rollback (no deploy):** per-thread — `PATCH /meta/conversations/:id/nova {enabled:false}`; per-store — set `door:inbox` mode to `assisted` (everything drafts, T0 behavior) or flip the tenant kill switch (`requireTenant` gate stops all service traffic); per-capability — flip any `inbox.*Auto` key to `false` via a new guardrails version. Escalation/holding behavior itself is disabled by `novaEnabled:false` per thread or the kill switch; no code path requires a redeploy to silence Nova.
