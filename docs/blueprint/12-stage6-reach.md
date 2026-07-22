# Phase 12 — Stage 6 "Reach": Remaining Doors + Zero NEEDS DOOR

**PRD stage:** Stage 6 (PRD §15) · **Prereqs:** 08 (decisions), 09 (night shift authors
drafts, PlanItems), 10 (content types for broadcasts). Owners: Backend + AI. Self-
contained. Four Nova modules (Broadcast Center, Product Research Hub, Growth Lab,
Goals & Strategy) plus the four sub-view doors go real; the duty roster reaches **zero
`NEEDS DOOR`** — every one of the 65 duties has a door or an honest LOCKED/PAUSED state.

## Already real vs to build

| Capability | Today (repo audit / 02-findings) | This phase |
|---|---|---|
| Broadcasts | NOTHING — plus an upstream Dakio architecture gap: no `CustomerMessage` store; `InboxConversation` has no `Customer` link (messaging the wrong person risk); `StorefrontLead.recoveryMessage` field missing | E-13 + segment engine + SMS/email providers + opt-out; **named Dakio prerequisite: customer-identity join** |
| Research | PARTIAL — `import_product` tool + `DropshipProduct` marketplace reads; demand/competition scores have no source | E-14 scoring pipeline + trend feeds + review queue + page-draft handoff (to 10's product_desc type) |
| Growth Lab | PARTIAL — `NovaExperiment` + create/evaluate tools + reflection evaluator SHIPPED (Phase 04) | Extend: variants[], significance, ICE backlog, learnings archive surface |
| Goals | PARTIAL — `goals` memory namespace in L1 + `weekly_strategy` job kind | E-16 `NovaGoal` structured (target/pace/projection/risks) + weekly review + risk register |
| Sub-view doors | NOTHING — underlying data partially derivable (`CourierConsignment`, `Expense`, `Purchase`) per 02-findings §C | Rate Compare · RTO Analytics · P&L Reports · RFQ Compare |
| Door furniture | by:nova chip pattern (06, Coupons exemplar); tiles mock | FR-6.5 across doors: `+ Create` manual paths, mode banners, pending badges (HQ tiles + Dakio nav), toasts |
| Memory UI | Data model ready (source/provenance, 04); merchant Memory modal mock | Founder memory transparency UI (list/edit/delete with provenance) |

## Objective

PRD Stage 6 gate, per door: its duties flip `ACTIVE`, night-shift outputs land as
inspectable drafts behind it, and the founder completes one manual job through it.
Stage exits when **zero `NEEDS DOOR` remain** in the 07 registry.

## Scope

**In:** E-13 `NovaBroadcast` + `NovaSegment` (live counts) + SMS/email send path (floor)
+ WhatsApp upgrade hook (§18) + opt-out compliance + cart-recovery sends; E-14
`NovaResearchCandidate` + scoring + trend/competitor feeds + review queue + page-draft
handoff + import-to-product completion; E-15 extensions (variants, significance, ICE,
archive) + Growth Lab door; E-16 `NovaGoal` + pace/projection math + weekly review
generator + risk register + Goals door; 4 sub-view doors with their data derivations;
FR-6.5 furniture rollout across all doors; memory transparency UI; duty flips +
coverage rollups; night-shift contracts extended per department (research/growth/goals/
shipping/finance emit door-shaped drafts).
**Out:** WhatsApp Business API integration itself (upgrade lands when approved — §18);
image creative generation; benchmarks feeding research/goals (14).

## System architecture

```
night shift (09 contract, extended)
  ├─ research dept → NovaResearchCandidate drafts (scored) ─► Research Hub review queue
  ├─ growth dept   → experiment proposals (ICE-ranked)     ─► Growth Lab backlog
  ├─ marketing     → broadcast drafts (segment + content)  ─► Broadcast Center (decision-gated send)
  ├─ finance/ceo   → goal pace/projection + risks          ─► Goals & Strategy + weekly review
  └─ shipping/ops/finance data jobs ─► sub-view door aggregates (rate/RTO/P&L/RFQ tables)
founder manual jobs (the gate's second half): compose broadcast · import researched product ·
  start experiment · set goal — each via + Create, each an actor:'founder' ledger row
segment counts: live query over Customer/Order aggregates + opt-out registry
```

## Design decisions

1. **Broadcast sends need identity truth first (E-13).** The 02-findings gap is real:
   Dakio cannot yet join a `Customer` to a Meta conversation or a consented phone/email
   channel. This phase ships, in dakio-api, the **customer-channel registry**
   (`CustomerChannel {customerId, kind: sms|email|whatsapp|messenger, address,
   consent, optedOutAt}`) populated from orders (phone/email at checkout = transactional
   consent baseline) — the named prerequisite, built here because Broadcasts are dead
   without it. Meta-conversation joining stays out (deferred honestly, as in Phase 02.2).
2. **SMS/email are the floor; WhatsApp is an upgrade slot (§18).** Send path uses
   Dakio's existing providers (order-notification infra) behind a `BroadcastChannel`
   adapter; WhatsApp BSP lands later in the same adapter. Every send: opt-out check +
   suppression list + per-tenant daily send caps (guardrail-adjacent, authority-gated).
   Broadcast execution is always decision-gated at assisted mode; `results{}` ingests
   delivery/read/reply counts where the channel reports them.
3. **Segments are queries with live counts, not stored lists.** `NovaSegment` stores a
   filter AST (spend, recency, city, tags, cart-abandoned…); counts computed live
   (FR-6.4 "live counts") with a 60s cache; materialized only at send time into
   `BroadcastRecipient` rows (audit + idempotent delivery).
4. **Research scoring is transparent weights over named signals (E-14).**
   `score_100 = Σ weight_i · signal_i` — signals: marketplace demand proxy (dropship
   order velocity), margin estimate (supplier cost vs category price), trend_delta
   (search/social trend feed adapter — pluggable; ships with the marketplace-velocity
   signal and honest `n/a` for absent feeds), competition proxy. Weights visible on the
   card (E-14 `weights`); no black-box scores (§2.4). Import → existing `import_product`
   path + page draft handed to 10's `product_desc` generation; review queue statuses
   `candidate → shortlisted → imported|dismissed`.
5. **Growth Lab formalizes the shipped experiments (E-15).** Variants (A/B payloads +
   traffic split served via campaign/content/price fields), day counter, lift +
   two-proportion significance (deterministic math lib, no model), `ice_score` ranking
   the backlog; winners archive into `experiments` memory (already shipped) + a
   learnings view. Reflection's evaluator (04) upgrades from threshold-check to
   significance-check.
6. **Goals get math, memory keeps meaning (E-16).** `NovaGoal`: target (metric +
   value + window), pace (actual vs required run-rate), projection (trailing-window
   extrapolation + confidence band), risks[] (registry rows, each linkable to a
   decision/plan item). Weekly review = `weekly_strategy` job kind writing a structured
   review section into the brief + goal updates. `goals` memory namespace remains the
   narrative the model speaks; the entity is what the door renders.
7. **Sub-view doors are read-model deliveries (§14).** Rate Compare + RTO Analytics:
   nightly aggregation from `CourierConsignment`/order history into
   `CourierPerfDaily` (per courier: delivery %, RTO %, avg days, cost) — the
   02-findings "per-courier performance" gap, built as derived tables. P&L Reports:
   monthly statement from orders/COGS/expenses/ad spend (basis-labeled). RFQ Compare:
   supplier offer comparison over `Purchase` history + 14's negotiation rounds slot in
   later. Each door flips its NEEDS DOOR duty; `assign_courier`/PO duties gain their
   analytics surface.
8. **Furniture is a checklist, not per-door art (FR-6.5).** Every door (4 new + Campaign
   Manager + Content Studio + the 10 existing Dakio doors): `+ Create` manual path
   (degradation guarantee — founder can always do the job by hand), mode banner (07
   modes), pending badge (decision/draft counts on HQ tiles + Dakio nav), toast-confirmed
   mutations, by:nova chips (06 pattern). Tracked as a matrix in the phase test plan.
9. **Memory transparency UI closes the 04 loop.** List by namespace with
   source/provenance, edit/delete (hard delete honored), "learned this because" links
   to action refs — pairs with 13's receipted corrections.

## EVE features to use (exact surface)

- Night-shift typed contracts (09 `outputSchema` pattern) extended with per-department
  draft schemas (research candidates, broadcast drafts, goal updates).
- New job kinds via shipped dispatcher: `courier_aggregation` (nightly),
  `broadcast_send` (scheduled, idempotent per recipient), `experiment_tick` (daily
  variant stats + significance), `goal_review` (weekly — replaces bare
  `weekly_strategy` prompt).
- No new channels/sandboxes; trend-feed adapters are StoreClient/service-side, never
  model-direct (standing rule 2).

## External services

Dakio's existing SMS/email providers (send adapter); optional trend feed (pluggable,
phase ships without); no new infra otherwise.

## Data models (dakio-api Prisma; all tenant-scoped, timestamped, soft-deleted)

```prisma
model CustomerChannel { customerId String; kind String; address String
  consent String        // transactional | marketing
  optedOutAt DateTime?; @@unique([tenantId, kind, address]) }
model NovaSegment { id; name String; filter Json; lastCount Int?; lastCountAt DateTime? }
model NovaBroadcast {  // E-13
  id; kind String      // campaign|recovery|announcement
  channels Json; segmentRef String; contentRef String?   // 10's item
  trigger String       // manual|scheduled|event
  status String        // draft|review|scheduled|sending|done
  decisionRef String?; scheduledAt DateTime?; results Json @default("{}") }
model BroadcastRecipient { broadcastId String; customerId String; address String
  status String; sentAt DateTime?; dedupeKey String @unique }
model NovaResearchCandidate {  // E-14
  id; title String; sourceRef String   // DropshipProduct id / url
  score100 Int; weights Json; signals Json; estMarginPct Decimal?; trendDelta Decimal?
  suppliers Json; pageDraftRef String?; status String  // candidate|shortlisted|imported|dismissed
  decisionRef String? }
// NovaExperiment (E-15) ALTER: variants Json, day Int, lift Decimal?, significance Decimal?, iceScore Int?
model NovaGoal {  // E-16 Goal
  id; metric String; targetValueMinor BigInt?; targetValue Decimal?; window Json
  paceStatus String; projection Json      // {value, confidence, basis}
  risks Json; status String }
model CourierPerfDaily { courier String; day DateTime; delivered Int; rto Int
  avgDays Decimal; costMinor BigInt; @@unique([tenantId, courier, day]) }
```

## APIs & interfaces

Merchant JWT door APIs: `GET/POST /api/nova/broadcasts` + `/segments` (+`/count`) +
send verbs (decision-gated) · `GET /api/nova/research` + `POST /:id/shortlist|import|
dismiss` · `GET/POST /api/nova/experiments` + backlog · `GET/POST /api/nova/goals` +
risk register · `GET /api/nova/doors/rate-compare|rto-analytics|pnl|rfq-compare` ·
`GET/PUT/DELETE /api/nova/memory` (transparency UI; hard-delete honored) ·
badge counts endpoint for HQ tiles + nav. Opt-out webhook/reply handling per channel
adapter. Service surface mirrors for night-shift writes. nova-ai: research/growth/goal
tool extensions (`score_research_candidates`, `propose_broadcast`, `update_goal_pace`),
night contracts, significance lib. Strings bn+en; money ৳ minor units; P&L/pace figures
carry `basis` labels.

## Implementation steps

1. CustomerChannel registry + opt-out + send adapter (SMS/email) + caps.
2. Broadcast/segment models + APIs + `broadcast_send` job + recipient idempotency +
   Broadcast Center UI (compose = founder manual job).
3. Research: scoring pipeline + signals + review queue + page-draft handoff + Hub UI.
4. Growth: E-15 ALTER + significance lib + `experiment_tick` + backlog/learnings UI.
5. Goals: model + pace/projection math + `goal_review` job + door UI + risk register.
6. Sub-view doors: `courier_aggregation` job + P&L statement builder + RFQ compare view
   + door UIs; flip the 4 NEEDS DOOR duties.
7. Furniture matrix rollout (+ Create, banners, badges, toasts, chips) + memory UI.
8. Night-shift contract extensions + duty flips + coverage rollups; gate script +
   per-door founder manual-job demo; artifacts.

## Dependencies

08–10 shipped. Dakio product sign-off on marketing-consent policy (transactional-vs-
marketing baseline, D1) and send-cap defaults. Trend feed optional. WhatsApp BSP
approval is explicitly NOT a dependency (§18 fallback is the plan).

## Risks & trade-offs

| Risk | Mitigation |
|---|---|
| Marketing consent baseline too aggressive (spam risk, brand risk) | consent field distinguishes transactional vs marketing; marketing sends require explicit opt-in flag per tenant policy; caps + opt-out honored server-side; compliance review in gate |
| Wrong-person sends | sends only to CustomerChannel rows (verified addresses from orders), never inferred Meta identities (deferred gap stays deferred) |
| Trend feed absent → research scores look thin | weights renormalize over available signals; card shows which signals were n/a — honesty over fabrication (§18 benchmark rule previewed) |
| Significance math misused (peeking) | fixed evaluation cadence (experiment_tick), minimum sample floor, UI labels "inconclusive" honestly |
| Sub-view aggregates disagree with courier ledger | daily job is idempotent + re-runnable; figures carry basis + as-of; reconciliation test vs raw consignments |
| Furniture rollout drags across 16 doors | checklist matrix in CI (per-door snapshot test); §16.5 — shrink scope honestly (a door without badges fails the matrix, not the gate demo silently) |
| Broadcast job storms providers | per-tenant send rate caps + provider backoff + recipient dedupe |

## Testing strategy

Unit: segment AST → SQL, scoring weights, significance vectors, pace/projection math,
P&L statement builder. Integration: send path end-to-end with opt-out + dedupe + caps;
research import handoff; experiment lifecycle; goal review job; courier aggregation
reconciliation. Per-door gate rehearsal: night-shift drafts land → duty flips ACTIVE →
founder manual job (compose/import/start/set) each producing actor:'founder' ledger
rows. Evals: night-shift draft quality per new contract. Prior suites green.

## Performance

Segment counts cached 60s; sends batched with provider limits; aggregation jobs nightly
off-peak; door reads over derived tables (indexed). Badge endpoint one composed query.

## Security

Opt-out enforced server-side on every send (never model-checked); addresses never enter
model context (segment previews show counts + masked samples); broadcast execution
decision-gated; consent + suppression audited in the ledger. P&L/financial reads
owner/admin role. Memory deletes remain hard deletes (04 ruling).

## Success & exit criteria

**PRD §15 Stage 6 gate (verbatim):** *Per door: duties flip to ACTIVE, night-shift
outputs land as inspectable drafts, founder completes one manual job. Stage exits when
zero `NEEDS DOOR` remain.*
**Standing gates** + **§16 discipline** (clean staging store, non-builder, recordings +
ledger export filed).
**Phase-specific:** duty registry reports 65/65 doored (or LOCKED/PAUSED — zero NEEDS
DOOR) · furniture matrix green across doors · broadcast send respects opt-out + caps in
integration proof · research score weights visible on every card · memory UI edits
carry provenance.

## Deliverables

CustomerChannel registry + send adapter; Broadcast Center (models/APIs/UI/job);
Research Hub (scoring/queue/handoff/UI); Growth Lab (E-15 ext/backlog/learnings);
Goals & Strategy (model/math/review/UI); 4 sub-view doors + aggregation jobs; furniture
matrix + memory transparency UI; night-shift contract extensions; gate script +
artifacts; capability report `phase-12-stage6-reach.md` + matrix updates.
