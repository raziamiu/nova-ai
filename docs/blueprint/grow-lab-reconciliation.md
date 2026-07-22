# Grow Lab ↔ Blueprint v2 reconciliation

**Date:** 2026-07-22 (post-v2-rewrite). **Trigger:** Grow Lab shipped — dakio-api
`f58f9d1` (`/api/grow`: campaigns, posts, broadcasts, goals, ideas + real organic FB
publish) and dakio-merchant `a2d9360` (six modules wired live) + Nova Motion Ads
(`14a0123`, `beb83d1`). The PRD's "doors" now exist as the merchant-facing **Grow Lab**
— that is the product name; the blueprint's "door" vocabulary maps onto it. This doc
corrects the affected phase docs' "Already real vs to build" baselines; the phase docs
point here rather than restating.

## Naming: PRD door ↔ Grow Lab module ↔ blueprint phase

| PRD door (FR-6) | Grow Lab module (real name) | Backing | Phase that wires Nova onto it |
|---|---|---|---|
| Campaign Manager | **Campaigns** (`/grow/campaigns`) | `GrowCampaign` | 09 |
| Content Studio | **Content Studio** (`/grow/posts`, `/grow/content/ads`) | `GrowPost` + Nova Motion Ads | 09 (publish path) / 10 (voice, review loop, ads API-ification) |
| Broadcast Center | **Broadcast** (`/grow/broadcasts`) | `GrowBroadcast` | 12 |
| Product Research Hub | **Research** (`/grow/ideas`) | `GrowIdea` (+ real import→Product) | 12 |
| Growth Lab | **Growth** (`/grow/opportunities`) | live heuristics (read-only) | 12 |
| Goals & Strategy | **Goals** (`/grow/goals`) | `GrowGoal` (pace/forecast from real orders) | 12 |

UI ground truth: all six modules are LIVE against `/api/grow` (no mock data layer).
Every Grow room renders an **empty `NovaLane`** ("Nova isn't wired into X yet…" —
honest empty states, `src/pages/grow/components/shared.jsx:167`), and every Grow model
carries `createdBy: "founder"|"nova"` from day one (schema preamble says exactly this).
The seams for Nova are pre-cut; nothing crosses them yet.

## Corrected capability baseline (supersedes the phase docs' tables where they differ)

| Blueprint assumption (v2 as written) | Grow Lab reality | Verdict change |
|---|---|---|
| 09: `Campaign` model is a HARD-GAP greenfield build | `GrowCampaign` exists: Draft/Scheduled/Live/Paused/Ended machine, goal, channels[], budget (stored, never spent), date-window order "results" | **BUILD → EXTEND** (add novaActionId/decisionRef, day stats, attribution) |
| 09: campaign writes impossible (no Meta write scope) | Still true for **paid ads** — `ads_read` only, zero `ads_management`/budget-write code (test-enforced scope separation). But **organic FB Page publish is REAL** (`POST /grow/posts/:id/publish`, Graph v21, Page token; IG honestly refused) | Stage 3 vertical can run **organic-first**: a real outbound mutation exists TODAY. Paid-ads spike (§18) unchanged |
| 10: social publishing greenfield; `ContentItem` net-new | `GrowPost` exists (5 types, scheduling, externalIds, metrics columns w/o ingester) + real publish + Nova Motion Ads creative engine (localStorage-only persistence, "pending API") | **BUILD → EXTEND** (versioning/review loop/voice scoring on GrowPost; API-ify nova-ads drafts) |
| 12: Broadcast Center net-new incl. segment engine | `GrowBroadcast` exists: audience resolution, 7-day cool-off, recipient snapshots, preview counts — **and deliberately NO send** (`channelConnected:false`; no merchant→customer WA/SMS/Email channel exists in the product) | Segment/store half EXISTS; the send channel remains the product gap 02-findings named. 12's `CustomerChannel` + provider work stands |
| 12: `ResearchCandidate`/`Goal` net-new | `GrowIdea` (saved/queued/imported + real import→DRAFT Product) and `GrowGoal` (month targets + live pace/forecast) exist | **BUILD → EXTEND** (scoring pipeline, projection confidence, risk register on top) |
| 07: door registry — 6 Nova-module doors `doorExists:false` until 09–12 | Six Grow modules are live founder surfaces NOW | `doorExists:true` at 07 seed time for all six (duty statuses stop under-reporting); the 4 sub-view doors (Rate Compare, RTO Analytics, P&L, RFQ Compare) remain the only NEEDS DOOR |
| 00 §12: "Campaign Manager PARTIAL (Autopilot)" correction | Refined: Grow Lab PARTIAL — organic real, paid absent, attribution absent | — |

**Unchanged hard truths:** no per-order campaign attribution (grow.js says so in
comments — 09's attribution v1 still needed); `GrowPost.metrics`/broadcast result
counters have **no ingester** (Reports' `ads_read` insights fetcher exists but Grow
never calls it — wire in 09); `GrowCampaign.budget` is inert; MP4 export in nova-ads
is blocked on a render worker; IG publish unbuilt.

## Integration architecture (binding for phases 06–12)

1. **Grow writes by Nova go through the action pipeline, land in Grow tables.**
   `StoreClient` gains grow methods (`listGrowCampaigns`, `createGrowPost`,
   `publishGrowPost`, …) → dakio-api `/api/v1/agent-data`-style service surface that
   calls the SAME service logic as `/api/grow` (extract grow.js handlers into
   `src/lib/growService.js`, both routers call it) with `createdBy:'nova'` +
   `novaActionId`. The merchant router stays founder-actor. One rule preserved:
   authority check → execute → receipt → lands in Grow Lab.
2. **`novaActionId` columns on Grow models (06)** — the by:nova attribution the schema
   preamble anticipated; `createdBy` alone can't link to a receipt.
3. **NovaLane = the door's decision/draft surface (08).** Each Grow room's NovaLane
   renders that module's queued `NovaDecision`s + Nova-authored drafts
   (`createdBy:'nova'`), from the 08 decision API filtered by door module —
   `surfaced_in` gains `grow:<module>` targets. 'BY NOVA' chips switch from static
   theater to receipt-linked (click → receipt drawer, 06 pattern).
4. **Founder Grow mutations emit ledger rows** (06's `actor:'founder'` direction) so
   briefs/plan boards see the whole picture — Grow module writes join the coupons
   exemplar.
5. **Nova Motion Ads persistence lands as `GrowPost` drafts + an asset store (10)** —
   replacing the `dakio-nma-*` localStorage seams; "PREPARED BY NOVA" projects become
   real Nova-authored drafts with receipts.
6. **Duty registry seed (07):** door_module keys = grow module keys; broadcast duties
   whose verb is *send* are honest about prepare-only until 12's channel lands
   (status ACTIVE, capability copy "prepares — sending awaits a channel").

## Effect on the phase sequence

Order is unchanged — **06 → 07 → 08 → 09** (spine/law/consent remain the substrate the
PRD mandates before any vertical). What changes is cost and payoff:

- **06** gains: Grow `novaActionId` migration + grow service extraction + StoreClient
  grow reads. (Small — the door-attribution convention just targets 6 more tables.)
- **07** gains: doorExists flips for six modules; loses nothing.
- **08** gains: NovaLane as a real fan-out surface (desk + room + **grow lane** = the
  Stage 2 "three surfaces" demo gets its third surface for free).
- **09** shrinks materially: campaign vertical reuses GrowCampaign/GrowPost; the live
  mutation of the Stage 3 gate is **organic FB publish** (real, exists, has an
  engineered inverse — Graph API post delete within the 24h window); wizard work
  becomes Grow-UI extension, not greenfield; stat ingestion wires Reports' existing
  `ads_read` insights fetcher into `CampaignDayStat`. Paid ads stay the §18 spike with
  propose-only fallback — now genuinely optional to the gate.
- **10** rescopes to: review loop + brand voice + versioning on GrowPost, bn+en, and
  nova-ads API-ification. **12** rescopes to: the send channel (`CustomerChannel` +
  providers) + research scoring + goal projection/risks + the 4 sub-view doors.
