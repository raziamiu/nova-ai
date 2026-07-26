# Module 08 — Handover & Authority: AS BUILT

**Status:** built, tests green, human verification pending (F-36…F-42 in
[`docs/HUMAN-VERIFICATION-REQUIRED.md`](../../HUMAN-VERIFICATION-REQUIRED.md)).
**Commits:** dakio-api `eb9c6b5` → `db569f0` → `f67b0f8` → `5bb7808` → `daf7b83` → `b62d963` → `ff41033`;
nova-ai `7f670c1` → `3199a10` → `da4a8de` → `a8c2c34` → `9a1fdb1`; dakio-merchant `e2b27d4` on **develop**.

> Read [`AS-BUILT-03.md`](./AS-BUILT-03.md) §1 first if you are new — it explains why these files exist.

---

## 1. The thing that nearly shipped

**All three adversarial reviewers found the same blocker independently.** That had not happened before in this
phase, and it was right:

**Tapping SEND on an escalation card delivered nothing to the customer, and reported success.**

A customer asks for a human → Nova escalates and marks the thread founder-owned → the founder taps SEND on the
drafted reply → the reply is queued, the Desk says executed → `fireOutbound` sees `handledBy:'founder'`,
correctly concludes a human took the thread, and cancels the message before Graph. **Every time.** It then
wrote *"Reply canceled: the founder took the thread over before it was due to send"* onto the very ledger row
the founder's own tap created — a false statement about the founder, in the audit trail.

**The cause:** the lock has **three** gates on one predicate. The prologue waived two (the rung-2 read guard,
the in-transaction claim) and missed the third at fire time.

**The lesson for module 05+, and it is the second time this phase:** *when you waive a guard, grep for every
site that restates its predicate.* Module 04's blocker was the same shape — a check that existed in more
places than the fix touched. A waiver that reads as complete and isn't is worse than no waiver, because the
tests around it go green.

**Why it survived to review:** no suite drove handover → approve → send end to end. The handover suite
deliberately mocks the send engine away to stay a "what gets written" test. Both halves were individually
correct; nothing exercised the seam. That end-to-end test now exists.

---

## 2. What shipped

Module 08 is **much smaller than its doc** — the recon found **13 things modules 01–04 had already built** that
the doc still lists as to-build. Notably: the entire 7-rung lock/staleness ladder, the founder-from-phone
takeover (the doc claims echoes are dropped and `message_echoes` is unsubscribed — **both stale and false**),
Decision authoring, system-template holding sends, and the escalation-draft never-auto-send rule.

**Escalation** — `dakio-api/src/lib/novaInboxHandover.js`. One transaction: stamp the reason and the SLA mark,
send the holding line as a deterministic `actor:'system'` row, write the prepared `escalation_draft` carrying
the brief, author one priority-1 Decision, store its id, set the status line. Anti-spam is the
`escalatedAt:null` claim — a second trigger updates the brief rather than stacking a card.

**Ownership** — `novaInboxOwnership.js`. Three doors, one lock: typing in Dakio (implicit), the takeover
button, and replying from the Meta Business Suite app (the echo path). All three settle any open escalation
Decision, each with its own `decidedBy` slug so the ledger records *which* door. `novaLockedAt` is never moved
once set; only an explicit release clears it.

**The T0–T3 dial** — `novaInboxTier.js` + `novaInboxShadow.js`. Encoded as a `door:inbox` `NovaAgentMode` plus
guardrail-key flips — zero new authority machinery. The mode write and the guardrails version write land in one
transaction. Shadow exit criteria compute from **rows**, never counters.

**The lexicon and the SLA sweep** — `inboxEscalationLexicon.js`, `inboxHoldingTemplates.js`,
`inboxSlaSweep.js`. `hintsFor` is pure and runs in the ingest transaction on every inbound of every tenant.
`legal_threat_abuse` is lexicon-**forced**: the model cannot override it.

---

## 3. Frozen contracts later modules call

**Service plane** (`/api/v1/inbox`): `POST /conversations/:id/handover` · `POST /conversations/:id/claim`.
**Merchant plane** (JWT): `POST /meta/conversations/:id/takeover` · `/release` ·
`GET`+`PUT /api/nova/inbox/tier`.

| Signature | Who calls it |
|---|---|
| `handoverHandler(req)` | the `escalate_conversation` executor — **the only escalation writer** |
| `settleOpenEscalation(tx, tenantId, conversationId, decidedBy, now?)` | every takeover door; **module 06** for case-driven handovers |
| `applyImplicitTakeover(tx, {...})` | the send-message path; any future founder-authored send |
| `buildEscalationBrief(db, tenantId, conv, input)` | **module 10** renders it; do not re-derive |
| `tierFor(mode, platform)` / `TIERS` | anything that must know the dial's position |
| `hintsFor(text)` | the ingest transaction — pure, keep it that way |
| `pickHoldingTemplate(key, script, {...})` | **null means DO NOT SEND** — never a silent empty message |
| `runSlaSweep(tx, tenantId, now)` | the `inbox_sla_sweep` server lane |
| `ESCALATION_REASONS` (9 slugs) | the closed set. `guardrail:<rule>` is written ONLY by the authority gate |

**nova-ai:** no new `ActionType`, no new `NEVER_GATED` or `FOUNDER_ONLY` members — the authority files changed
by **comments only**, which is correct and deliberate. `escalateConversationPayload.department` widened to all
five rooms. Hard rules **19** (ESCALATION AND RESUME) and **20** (NEVER INVENT). Rule 15 is still module 11's.

---

## 4. Decisions that bind later modules

1. **The escalation-draft waiver is carried on the ROW, not the request.** At fire time the request is gone, so
   the signal must be durable. It is stamped from an allowlist-built chunk array — nothing an HTTP caller
   writes can forge it, and the forgeable half alone still 409s at rung 2. **Any new send class that needs to
   pass the lock must do the same, and must waive only the `handledBy` half: `novaLockedAt` is a human lock and
   stays binding.**
2. **The doc gates three verbs that exist in NO repo** — `refund_promise`, `open_case`, `flag_courier_issue`
   (the latter two are module 06's). None were invented. `BOOKKEEPING_VERBS` is not a real mechanism; it is
   `NEVER_GATED`.
3. **The doc claims five inbox duties; two exist.** The other three are module 05's. Any authority matrix cell
   resting on them would have been fiction. An unknown `dutyRef` fails closed.
4. **Six guardrail keys are seeded for modules 05/06 whose verbs do not exist.** They are seeded *refusing* and
   marked as such — a key that reads as enforced while gating nothing is worse than an absent key.
5. **`inbox_sla_sweep` runs on the `PLATFORM_JOB_DEFS` + `SERVER_SWEEPS` lane**, like modules 03/04's sweeps. A
   leased job would hand `renderJobPrompt` an undefined prompt and fail nightly forever.

---

## 5. Known-not-built, with owners

| Gap | Owner | Note |
|---|---|---|
| **Design 7 auto-hand-back** | module 10 / whoever reads `ctx.keepThread` | After a tap-send the thread stays founder-owned. `keepThread` is plumbed through the approve path and **read by nobody**. The end-to-end test asserts today's behaviour, so building this must come past that assertion and change it deliberately. |
| T1→T2 and T2→T3 promotion | module 11 | Their outcome conditions are module 11's. The dial refuses honestly with `blockedBy` naming that, rather than inventing a threshold. |
| `fraud_risk` trigger (row 9) | module 11 | Slot reserved; no holding line by design (nothing is wrong from the customer's view). |
| Founder push/email notification | v2 | No push infra exists. The 24h SLA email nudge is v2. |
| Verbal commands ("take the thread back") | v2 | Needs a founder-channel tool. |
| Per-thread history table | v2 | The NDJSON ledger export covers audit in v1. |

---

## 6. Baselines

```bash
cd dakio-api && npm test            # 1499 tests, 1498 pass, 1 skipped, 0 fail
cd nova-ai   && npx tsc --noEmit    # 0 errors
cd nova-ai   && npm run test:inbox  # 647 checks
cd nova-ai   && npx eve info        # 0 errors, 0 warnings
cd nova-ai   && npm run check:undo  # 17 verbs
```

**dakio-merchant is on `develop`, not `feat/front-office`** — no such branch exists there. Module 08 touches
exactly one file in it. Check `git status` before staging; another session edits that repo live.

**THE STANDING HAZARD — now four instances.** Tests with fixtures pinned to a calendar date, judged against a
clock that keeps moving. Two in module 04, one in module 02 (fixed during this module), and the class is
explicitly hunted in every review brief now. The module-02 one was the worst: it reported *"typing_on never
fired"* when the real cause was an expired 24h window, sending anyone debugging it into the wrong subsystem.
**Pin every clock. Never seed one side of a comparison off `Date.now()` and judge it against a fixed instant.**

Also unchanged from module 03: `package.json` enumerates test files explicitly and `node --test` tolerates a
missing one **silently**; nova-ai's `npm test` is RED at isolation (F-20) and is an `&&` chain.

---

## 7. If you are starting module 05 (Selling & Conversion)

Module 05 is now **unblocked** — its dependency on 08 is satisfied. It also unblocks 06 and 07 behind it.

Waiting for you: the `inbox.*Auto`/cap guardrail keys are seeded and refusing, so wiring a verb is what makes
them real; four NBA candidates name your verbs (`offer_chat_discount`, `create_order_from_chat`,
`confirm_order_intent`) and are marked ineligible until they exist; `linkConversationToCustomer` for the
HIGH(a) identity link; `claimedPhone` seeded by module 03; the three `sales.inbox_*` duties the doc assumes
exist are **yours to register**.

What you must not break: the escalation-draft row waiver (§4.1), the `promiseId` supersession exemption
(module 03/04), `recheckBeforeFire` — any new proactive send lane must call it — and `hintsFor` staying pure.

Budget an hour to re-derive your doc's "already real" column. Every module so far has found it wrong.
