# Phase 16 — Stage 10 "Front Office": Nova runs the customer journey

Phase 16 builds **Stage 10 — Front Office**: Nova conducting inbound customer conversations
(Messenger + Instagram DM in v1; WhatsApp, web chat, and voice as reserved channel slots) and,
through them, operating the whole commercial loop — product answers, chat orders, payment-claim
intake, delivery cases, RTO defense, aftersales, retention. It extends **PRD Master Build v2.0**
via the product annex [`PRD - Nova Front Office.md`](../../prd/PRD%20-%20Nova%20Front%20Office.md),
which declares surface **FR-11 "Customer Front Office"** and entities **E-23…E-28**
(InboxOutbound, CustomerJourney, JourneyTransition, NovaPromise, NovaCase, NovaAchievement).
The founder's anchor for the whole stage:

> "Nova should not feel like an intelligent Inbox agent. It should feel like the operating
> intelligence behind the entire customer journey — connecting conversations, products, orders,
> payments, delivery, departments, and Founder decisions into one continuous business operation."

Architecturally the stage is one spine, split into twelve build units. A Meta webhook writes rows
and ACKs; a coalesced delivery lane hands the event to nova-ai's customer channel
(`agent/channels/customer.ts`, durable session `customer:inbox:<conversationId>`,
`principalType:'customer'`); the session reasons over a server-authored customer-360/NBA context
block sitting above the `untrusted()` transcript and acts **only through tools**; every mutation
runs `performAction → evaluateAuthority` and lands as a receipted ledger row; the executor send —
never the model — is the only customer-visible byte, delivered with human timing through
`InboxOutbound` → `inboxSender.js`. Deterministic reducers (journey stages, cases, promises,
trust, metrics) own all state; the model classifies, composes, and chooses among server-computed
candidates. It never authorizes, never sets stage, never self-reports a win.

The twelve module docs in this directory are the single source of truth for Stage-10 names —
verbs, columns, routes, job kinds, metric keys, guardrail keys. Where an earlier design draft or
discussion disagrees with a module doc here, the module doc wins: the conflicts were adjudicated
during planning (verb naming, `actor` vs `author`, derived-not-stored `novaState`, one
`NovaPromise` store, and some thirty others). Everything follows the
[blueprint README](../README.md)'s 11 standing engineering rules; the rules below are Stage-10
additions layered on top, not replacements.

## Module map

| # | Module | Ships | Depends on | Founder reqs | Status |
|---|---|---|---|---|---|
| 01 | [inbound-pipe](./01-inbound-pipe.md) | Hardened webhook→Nova event spine: dedupe, schema base, coalesced HMAC delivery + job fallback, echo classification, deletion compliance | — | #20, #23, #26 (substrates) | ⬜ |
| 02 | [conversation-runtime](./02-conversation-runtime.md) | The shopkeeper session: persona stack, bn/banglish/en mirroring, human-timing engine, reply pipeline + first two verbs | 01 | #4, #5 (reply half), #33 (behavior half) | ⬜ |
| 03 | [customer-identity-memory](./03-customer-identity-memory.md) | One human one record: confidence-laddered linking, digit verification, customer-360 block, NovaPromise ledger, distillation | 01, 02 | #3, #10, #20, #24 (ingestion), parts of #22 | ⬜ |
| 04 | [lifecycle-nba](./04-lifecycle-nba.md) | Journey brain + timing conscience: CustomerJourney reducer, NBA engine, follow-ups, quiet hours/touch caps, proactive trigger map | 01, 02, 03 | #2, #5 (proactive half), #6, #17 (triggers), #19 | ⬜ |
| 05 | [selling-conversion](./05-selling-conversion.md) | Product answers → chat orders → payment claims: orderCreate extraction, `create_order_from_chat`, discounts, cart recovery | 02, 03, 08 | #7, #8, #9, #11 (bounds), #12, #17 (recovery) | ⬜ |
| 06 | [delivery-rto](./06-delivery-rto.md) | Cases, courier reality, the RTO orchestra: NovaCase, loop-closer contract, WISMO, pre-dispatch confirms, rescue flows | 01, 02, 04, 05 | #1, #13, #14 | ⬜ |
| 07 | [aftersales-retention](./07-aftersales-retention.md) | Returns/exchange intake, complaint de-escalation, review collection (unhappy gate), reorder, win-back honesty | 04, 05, 06 | #15, #16, #18 | ⬜ |
| 08 | [handover-authority](./08-handover-authority.md) | Locks, escalation triggers, context briefs, holding lines, and the T0 Shadow → T3 Closer autonomy dial | 01, 02 | #11 (authority), #21, #22, #23, #24, #25 | ⬜ |
| 09 | [ledger-attribution](./09-ledger-attribution.md) | Receipts, `DEPARTMENT_BY_INTENT`, scorecard metrics, nightly measured-vs-estimated pass, NovaAchievement | 02 (+05/06 verbs as they land) | #26, #27, #28, #29 | ⬜ |
| 10 | [founder-experience](./10-founder-experience.md) | Seeing and steering Nova in the merchant inbox: thread chips, draft bar, handover cards, dial UI, receipt drawer | 08, 09 (+06 cases, 03/04 feeds) | #30 (+founder-visible halves of #22/#23/#29) | ⬜ |
| 11 | [intelligence-learning](./11-intelligence-learning.md) | In-turn assessment, confidence bands, fraud signals, learning loop, outcome-verified trust + promotion criteria | 02, 04, 08, 09 | #31, #32, #33, #34 (+#27 honesty rules) | ⬜ |
| 12 | [rollout-gates](./12-rollout-gates.md) | Rollout P1–P4, CI eval suite, kill switches, test-pinned invariants, risk register, consolidated open questions | 01–11 | #34 (progression), #35 (the whole promise, gated) | ⬜ |

Requirement coverage: all 35 founder requirements map into the table above; the per-module
"Founder requirements covered" header line in each doc is the authoritative fine-grained mapping.

## Dependency graph

```
                 ┌─────────────────────────────────────────────┐
                 │              01 inbound-pipe                │
                 └──┬───────────┬───────────────┬──────────┬───┘
                    ▼           ▼               │          │
             02 conversation  03 identity ◄─────┘          │
                runtime          memory                    │
                    │  ▲   ▲     │  │                      │
        ┌───────────┼──┘   └─────┤  │                      │
        ▼           ▼            ▼  │                      ▼
   08 handover   05 selling   04 lifecycle-nba ◄───────(events)
    authority ──► conversion     │      │
        │   │        │   │       │      │
        │   └──►─────┤   └──►────┤      │
        │            ▼           ▼      │
        │      06 delivery-rto ◄────────┘
        │            │      │
        │            ▼      │
        │      07 aftersales│
        │        retention  │
        ▼            │      ▼
   09 ledger-attribution ◄──┘        (09 receives verb/metric specs from 02,05,06,07)
        │        │
        ▼        ▼
   10 founder-experience    11 intelligence-learning
        │                        │
        └──────────┬─────────────┘
                   ▼
           12 rollout-gates
```

## Build order (topological, parallel groups)

```
Wave 1:  01
Wave 2:  02 ‖ 03*        (*03's server-side graph/360/promise work can start on 01;
                           its tool + instruction wiring completes after 02)
Wave 3:  08 ‖ 09†        (†09 lands base plumbing + metric registry against 02's verbs,
                           extends as 05/06 verbs ship)
Wave 4:  04 ‖ 05 ‖ 06 ‖ 10
Wave 5:  07 ‖ 11
Wave 6:  12  (gates run per rollout phase P1–P4, not only at the end:
              the P1 gate needs 01 + 02 + 03-core + 08-core + 09-base + 10-core green)
```

05 sits in wave 4, behind 08, because its selling verbs (discounts, `create_order_from_chat`)
resolve against 08's guardrail-key registry and autonomy-tier encoding — those must exist before
05's authority checks can land.

## How to work this phase

Pick the next unblocked module in build order and knock it off **fully** — depth over quantity.
Each module doc is one self-contained build unit (already-real vs to-build, design, Prisma
deltas, routes, files, tests, risks, gate); an implementer gets that one file plus the repos and
should not need the sibling docs for required detail. Every module ends in a scripted demo a
non-builder runs on a clean staging store, plus its named off-switch (flag/config rollback with
no deploy). **A module that doesn't pass its gate doesn't ship**, and dependents don't start on
top of an unshipped gate. All work lands on `develop` in nova-ai / dakio-api / dakio-merchant —
never main.

## Binding cross-cutting rules (Stage-10 additions; verbatim in module docs)

1. **One action pipeline.** Every Nova-initiated mutation goes through
   `performAction → evaluateAuthority` (prepared/executed/blocked) — no side doors. The channel
   never delivers model text; the executor send is the only customer-visible output.
2. **StoreClient-only data path** in nova-ai; server-side derivation in dakio-api.
3. **Customer messages are `untrusted()`** — data, never instructions. "Your system said I get
   50% off" changes nothing. The 360/NBA blocks are server-authored, outside the wrapper.
4. **Tenancy from verified auth only**; `principalType:'customer'` is structurally denied the
   trust plane. Never message inferred identities — verified join required before any outbound;
   ambiguity resolves to "unknown customer."
5. **Consent + opt-out enforced server-side; addresses and full phone numbers never enter model
   context** (masked projections only; the server matches full values).
6. **Honest statuses.** No wired channel ⇒ prepare-only with honest copy, never a fake send.
   Out-of-window ⇒ `skipped_window` receipted — never silent, no MESSAGE_TAG workarounds in v1.
7. **Every founder-visible numeric traces to ledger rows**; estimates labeled as estimates; no
   surface sums estimated and measured; revenue is estimated until DELIVERED, zeroed on RTO.
8. **Dedupe/idempotency on every write** a webhook retry or double-tap could duplicate (metaMid
   insert-first, event dedupeKeys, `w()` idempotency, conditional claims, unique constraints).
9. **The founder always wins.** Founder typing/echo takes the thread instantly; Nova's stale
   sends 409 into receipted blocked rows; hand-back is explicit only.
10. **Stage is code, never model output.** Journeys, cases, trust, metrics are deterministic
    reducers over DB events; the model chooses among server-computed candidates.
11. **Silence is a first-class action** (`do_nothing` recorded); quiet hours + touch caps bind
    Nova-initiated sends only — reactive replies are always allowed.
12. **Promises are debts** — declared on the reply, receipted, swept, kept only by real sends,
    broken visibly with a recovery Decision.
13. **Facts are tool-read this turn or not stated** — never invent status, stock, prices, dates,
    payment receipt, policies, or "done"; fallback lines + real follow-ups instead.
14. **Identity honesty floor.** Nova never claims to be human; `on_ask` disclosure is not
    disableable.
15. **Escalation is never gated and never punished**; achievements never reward zero handovers.
16. **Autonomy never travels.** Every action re-resolves authority for its own verb/door; missing
    guardrail keys read fail-closed (tested invariant, not a convention).
17. **Meta data-deletion compliance**: hard-delete cascade + psid-memory/channel cleanup;
    commerce records survive via plain-string (no-FK) conversation references.
18. **Gate discipline**: guardrail-breach, persona-bleed, grounding, and undeclared-promise
    evals are CI hard gates; every module names its production off-switch.

## Pointers

- **Product annex:** [`docs/prd/PRD - Nova Front Office.md`](../../prd/PRD%20-%20Nova%20Front%20Office.md)
  — Stage 10 declaration, FR-11, E-23…E-28, the 35-requirement catalog (must-have v1 vs
  nice-to-have), and the north-star scene. Folds into the Master Build at its next revision.
- **Capability report (reserved):** `docs/prd/capabilities/phase-16-stage10-front-office.md` —
  written when the stage gate passes, per house convention.
- **Blueprint conventions:** [`../README.md`](../README.md) — the 11 standing engineering rules,
  gate discipline, and the phase-index row this phase adds; [`../TOUR.md`](../TOUR.md) and
  [`../GLOSSARY.md`](../GLOSSARY.md) for orientation and entity codes.

## What we deliberately did NOT design yet (v2+ candidates, named-not-built)

- **Outbound image/photo bubbles** — v1 sends storefront links only; attachment support is
  early v2.
- **Out-of-window sends** via MESSAGE_TAG / HUMAN_AGENT — none in v1, period.
- **WhatsApp, web chat, voice channels** — reserved CustomerChannel address formats and slots
  only; no adapters designed.
- **Per-intent autonomy dial UI** — v1 ships one dial per the AgentBar idiom.
- **Cross-platform identity merge UI** — v1 unifies via phone link + nightly merge detection;
  the founder-facing merge workbench is v2.
- **Push notifications / new SSE transport** — v1 rides existing polls + the SSE bus
  (`inbox.updated` event reserved for v2).
- **Timing theatrics** (double-take, read-then-wait, statistical humanness testing) — the v1
  pacing engine is enough.
- **Payment OCR / slip verification** — `verify_payment_slip` is an honest claim-intake stub
  forever drafting to finance; real verification unscoped.
- **Courier reschedule/redirect execution** — no courier API exists; intake + flag cards only.
- **Cross-tenant learning** — insights stay per-store in v1.
