# Nova — Master System Architecture (v2)

**Document 00 of the Nova Engineering Blueprint** · Audience: architects & tech leads.
Phase documents are self-contained; this document is the map that connects them.
v2 aligns the architecture to the **Master Build PRD** (`docs/prd/PRD - Nova Master
Build.md`, canonical) and to what phases 01–05 actually shipped. Where v1 assumptions
were wrong (eve subagent auth, schedule parking, PRD §14 readiness verdicts), this
document records the corrections.

Nova is Dakio's AI Business Operator: one dedicated, proactive digital employee per
store — 10 department agents coordinated by CEO-Nova — operating 24/7 through
owner-controlled authority, for millions of tenant stores on one deployment.

---

## 1. The five load-bearing primitives (PRD §4) and where they live

Everything reduces to five concepts. Each is first-class in the backend, not UI
decoration:

| Primitive | Implementation | Repo | Phase |
|---|---|---|---|
| **Duty** (65, per department, one door each) | `NovaDuty` registry + seed `agent/lib/duties.ts`; statuses `ACTIVE / NEEDS DOOR / LOCKED Lx / PAUSED`; coverage rollups | dakio-api + nova-ai | 07 |
| **Door** (the Dakio surface where output lands, `by: nova`) | door registry (module key ↔ merchant route ↔ pending-badge query); visible attribution in door UIs; Nova modules (Campaign Manager, Content Studio, …) | dakio-merchant + dakio-api | 06 (attribution) → 09–12 (modules) |
| **Action + Receipt** (E-8) | shipped `NovaAction`/`NovaActivity` ledger, reshaped: `receipt{evidence[], before, after, confidence, expected_impact}`, `undo_deadline` (24h), `undone_at`, actor/verb/target_ref, append-only, exportable | dakio-api + `agent/lib/nova/actions.ts` | shipped, reshaped in 06 |
| **Decision** (E-9) | new `NovaDecision`, split out of `status=prepared` actions: FIFO queue, `surfaced_in[]` fan-out, Approve / Later / Reject / frozen / expired, `bundle_ref` | dakio-api | 08 |
| **Authority** (level × mode × guardrails) | `evaluateAuthority` seam extending shipped `gateAction`: L0–L4 ladder + earned level, per-agent/door mode, versioned guardrails + no-touch matcher, founder-only verbs, per-duty min level; refusals are logged, explainable events | nova-ai + dakio-api | shipped core, v2 in 07 |

**The one rule (PRD §3), restated as the pipeline every phase preserves:**
`authority check → execute → append ledger entry with receipt → land behind a door`.
The model layer never mutates Dakio directly; `performAction()` is the sole mutation
path and receipts are schema-enforced at the API layer (§16.2, phase 06).

## 2. System components

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ DAKIO PLATFORM                                                               │
│ ┌───────────────────┐ ┌──────────────────────────┐ ┌──────────────────────┐  │
│ │ dakio-merchant    │ │ dakio-api (Express+Prisma│ │ Voice stack (READY)  │  │
│ │ Nova HQ + doors   │ │  + Postgres): store APIs,│ │ ElevenLabs+Twilio    │  │
│ │ (desk, rooms,     │ │ agent-data, Nova* models,│ │ voiceCallService.js  │  │
│ │ chat, wizard…)    │ │ jobs, SSE feed bus       │ │ + post-call webhook  │  │
│ └───────┬───────────┘ └───────────┬──────────────┘ └──────────┬───────────┘  │
└─────────┼─────────────────────────┼───────────────────────────┼──────────────┘
   chat/stream/approve      tenant-scoped HTTPS          call sessions (13/14)
┌─────────▼─────────────────────────▼───────────────────────────▼──────────────┐
│ NOVA SERVICE (one eve app, serves ALL tenants)                               │
│  Channels: eve (JWT auth, L4 ctx) · internal (dispatcher receive)            │
│  Root agent = CEO-Nova ── 10 department subagents (typed outputSchema)       │
│  Context engine L0–L5 · dynamic skills (playbooks) · dynamic model tiering   │
│  Action pipeline: evaluateAuthority → execute/decision/refuse → receipt      │
│  Dispatcher schedule (1/min) → per-tenant NovaJob queue (tz-aware, leased)   │
└──────────────────────────────────────────────────────────────────────────────┘
   Postgres (Dakio-hosted Nova* tables: ledger, decisions, duties, memory,
   jobs, briefs, calls…) · embeddings outbox · SSE feed bus (LISTEN/NOTIFY at 15)
```

| Component | Responsibility | Status |
|---|---|---|
| Nova Agent Core (eve) | persona, CEO-Nova routing, 10 dept subagents, 43+ tools | shipped |
| StoreClient layer | ONLY data path; demo + live Dakio HTTP impls | shipped (campaign/social/messaging writes land 09/10/12) |
| Action pipeline | authority gate → executed/decision/refused; receipts; undo | shipped, E-8/E-9 reshape 06–08 |
| Duty & door registry | 65 duties, statuses, coverage; door bindings + badges | 07 |
| Decision service | queue, approve/later/freeze transactions, fan-out, bundles | 08 |
| Context engine | per-tenant L0–L5 assembly, no static tenant prompts | shipped |
| Memory service | semantic/episodic/procedural + reflection + attribution | shipped; receipted corrections + call injection 13 |
| Proactive engine | dispatcher + per-tenant jobs + event inbox | shipped; night shift v2 outputs 09 |
| Voice stack | wire Dakio's live ElevenLabs pipeline; `NovaCallSession` receipts | 13 (negotiation calls 14) |
| Trust plane | trust/earned levels, promotion offers, per-agent trust | 08 → 14 |
| Observability & economics | OTel, per-tenant metering, SLOs | 15 |

## 3. Agent orchestration (v2 corrections included)

- **Root agent IS CEO-Nova** (PRD's 11th agent): owns the founder conversation, routes
  chat to departments, merges night-shift reports, owns E-1 identity. The v1 `ceo`
  subagent folds into root instructions (phase 07).
- **10 department subagents** (canonical org, phase 07 rename): `marketing, sales,
  support, product_research, inventory, shipping, finance, operations, growth` + root.
  Subagent `description` fields are the routing table; the built-in `agent` self-copy
  tool is disabled on root so all delegation goes through named departments (11).
- **Typed handoffs:** subagent calls pass `outputSchema` so department runs return
  structured results (PlanItems, grades, memos, research scores) — no prose parsing.
  v1 under-used this; night shift v2 (09) depends on it.
- **Programmatic fan-out:** eve's root-only `Workflow` tool (QuickJS orchestration,
  `maxSubagents` cap, approval-safe, one durable step) is available for night-shift
  per-department fan-out and benchmark map-reduce (09/14). Deterministic cross-tenant
  fan-out stays OUTSIDE the model in the dispatcher (shipped).
- **eve reality (corrected):** subagents inherit nothing — tools by re-export,
  procedures via `lib/`, guardrails re-declared per agent dir; delegation is NOT a
  security boundary. **And: `ctx.session.auth.current/.initiator` are BOTH null inside
  declared-subagent sessions** (internal runtime path — eve auth guide). v1's claim
  that auth flows to subagents is wrong; see §6 for the tenancy fix.

## 4. Context management (unchanged core, new layers)

| Layer | Content | Refresh | Phase |
|---|---|---|---|
| L0 persona core | CEO-Nova identity, principles, authority contract, ৳/bn-en style | deploy | shipped (৳ in 06) |
| L1 tenant profile | store, vertical, currency, brand voice, goals | session, cached 24h | shipped |
| L2 live ops | authority state (level/mode/guardrails/locks), decision queue digest, alerts | per turn | shipped, extends 07/08 |
| L3 relevant memory | top-K semantic + episodic recall | per turn | shipped |
| L4 page/task context | `x-dakio-client-context` (page, entity, selection) + adaptive chips | per message | shipped, chips 11 |
| L5 everything else | tools, on demand | live | shipped |
| Dynamic skills | per-tenant seasonal playbooks, promoted routines | session | 13/14 |

All injected values are labeled data-not-instructions (prompt-injection boundary).

## 5. Data flow

- **Interactive turn:** dashboard → eve channel (Dakio JWT → `storeId/role/plan`
  attributes) → context L0–L4 → CEO-Nova → dept delegation / tools → mutations through
  the action pipeline → receipts → SSE fan-out to feed/desk/doors → streamed reply.
- **Proactive (night shift, PRD §9):** dispatcher (the one authored schedule) claims
  due per-tenant `NovaJob`s → `receive()` into the internal channel per job → night
  session: CEO-Nova fans out per-department analysis (typed outputs) → in-guardrail
  actions with receipts, over-authority proposals as **decisions**, PlanItems, grades,
  memos → 06:00 store-time brief assembles from the ledger. Tonight's plan (13)
  previews it; the next brief scores planned-vs-done.
- **Event-driven:** Dakio mutations emit into `NovaInbox` (same-process, ~20 call
  sites) → debounced into jobs → same pipeline. Webhooks never invoke the model
  synchronously.
- **Voice (13/14):** call tools → dakio-api voiceCallService (ElevenLabs+Twilio,
  live today for order verification) → post-call webhook → `NovaCallSession` →
  every call is a ledger action; recording + transcript are the receipt; voice
  Approve/Later executes the same `NovaDecision` records as taps.

## 6. Multi-tenant isolation (with the v2 tenancy fix)

- Tenancy ONLY from verified auth (`requireStore`), never model input. Shipped:
  Dakio-JWT channel auth, session-tenant pinning hook, kill switch (fail-closed,
  enforced at turn start AND job claim).
- **Subagent tenancy fix (06):** because eve gives subagent sessions no auth, a
  server-side **session→tenant registry** is written at root session start; inside a
  subagent, `requireStore` resolves via `ctx.session.parent.rootSessionId` lookup.
  The `NOVA_DEV_STORE_ID` dev fallback stops masking this in dev; a regression test
  proves department delegation resolves tenancy with the fallback unset.
- eve route auth does NOT enforce session ownership (any principal may POST to any
  sessionId) — the pinning hook is the enforcement and stays under test.
- Data: every Nova table `tenantId`-keyed (+ RLS as defense-in-depth at 15); per-tenant
  budgets/rate caps in the tool layer + dispatcher (15); per-tenant kill switch.

## 7. Authority & trust plane (PRD §5, §11)

- **Ladder:** L0 Observe / L1 Suggest / L2 Draft / L3 Operator / L4 Acting CEO
  (canonical names over the shipped 0–4 semantics; L1 and L2 get distinct behavior).
  **Default at hire = L3** (FR-1) with `earned_level` locking L4 until trust is earned
  from the ledger — this supersedes v1's level-2 default and old phase 08's
  L2-default rollout; platform caution lives in earned levels, not lower defaults.
- **Per-agent mode** (Manual / Assisted / Autonomous, default Assisted): per door in
  07, per department agent in 14; mode changes act immediately on pending decisions.
- **Guardrails (E-2):** versioned rows; canonical trio (daily spend cap ৳500–20,000,
  max discount %, no-touch lock list) + the shipped six caps as platform superset.
  A no-touch lock freezes matching pending decisions immediately.
- **Founder-only verbs** (bulk refunds, guardrail edits, promotion acceptance,
  contract signing): propose-only at every level on every path; refusal = logged
  explainable event + escalation decision card.
- **Trust** is computed from the ledger (approvals-weighted with undo penalties —
  placeholder per PRD §18; formula is an open product decision due before 08 ships).
  Queue-clear + threshold → Nova offers its own L3→L4 promotion. Per-agent trust from
  each agent's ledger slice in 14.

## 8. Memory & learning (shipped; H1.2 deltas)

Shipped (04): namespaced semantic memory + embeddings, reflection, rejection
fast-path, experiments, attribution. v2 deltas: teach/forget routed through the action
pipeline so **corrections are receipted** (13); memory + BrandProfile injected into
**call scripts** (13); founder memory UI (12/13); `NovaPlaybook` (procedural skill
promotions) renamed **`NovaRoutine`** in 06 to free "playbook" for PRD E-19 seasonal
bundles. Owner memory deletes stay HARD deletes (privacy ruling; documented deviation
from PRD §12's blanket soft-delete — all new entities do get soft-delete).

## 9. EVE capability map (v2 — corrected verdicts)

| Need | eve fit | Verdict |
|---|---|---|
| Durable sessions, streaming, subagent event proxying | native | ✅ shipped on |
| Typed tools + approval fns | native | ✅ shipped on |
| Department agents + typed results | subagents + `outputSchema` | ✅ use (outputSchema new in v2 plans) |
| Programmatic fan-out | root-only `Workflow` tool | ✅ new — use in 09/14 |
| Dynamic per-tenant context/skills/models/tools | `defineDynamic` | ✅ core of tenancy; dynamic tools = authority hard-gating option |
| Auth in subagent sessions | ❌ null (`auth.current`/`initiator`) | build: session→tenant registry (06) |
| Approval parks in background runs | markdown schedules can't; **handler-form sessions CAN park** | keep decision queue anyway (product needs it); v1's "eve can't park" rationale corrected |
| Per-tenant scheduling | ❌ static root-only crons | shipped: dispatcher + `NovaJob` (eve's documented pattern) |
| Cross-session memory / vectors | ❌ none | shipped: memory service |
| Per-tenant metering | ❌ per-session limits only | build (15): OTel `step.started` runtimeContext tenant stamping + ledger |
| Remote agents | `defineRemoteAgent` (park-until-callback) | optional escape hatch for heavy/voice services |
| Self-host (Railway) | `eve start` Nitro cron; proxy `/.well-known/workflow/`; `@workflow/world-postgres@5.0.0-beta.x` pin | 15 runbook |

## 10. Stage ↔ phase roadmap

| Phase | PRD Stage | Gate (abbreviated; full text in each doc) |
|---|---|---|
| 06 Spine | 0 | coupon-as-Nova → door+feed ≤3s w/ receipt → undo; export |
| 07 Law | 1 | refusal + downgrade + freeze, all server-enforced; 65 duties live |
| 08 Consent | 2 | one decision record, every surface, zero drift; Later/freeze |
| 09 Proof | 3 | night shift → brief → approve → live campaign → undo; ×2 stores — **milestone** |
| 10 Craft | 4 | in-voice draft → revise → approve → scheduled publish |
| 11 Conversation | 5 | 10/10 grounded chat, one refusal escalated |
| 12 Reach | 6 | all doors live; zero `NEEDS DOOR` |
| 13 Presence | 7 | the founder's whole day by voice, zero taps |
| 14 Team | 8 | promote agent, Eid playbook one-tap, negotiation listen-in, benchmarks |
| 15 Launch | 9 | 30-day ≥20-store pilot at GA criteria |

Sequential 06→08 (each is the next one's substrate); from 09 ≤50% overlap allowed but
no gate demo may depend on unfinished later work (PRD §15).

## 11. Naming reconciliation (v1 ↔ PRD)

| Shipped v1 name | PRD concept | Disposition |
|---|---|---|
| `ActionRecord` / `NovaAction`+`NovaActivity` | E-8 Action + receipt / feed line | reshape (06) |
| prepared action + approve/reject tools | E-9 Decision + desk | split into `NovaDecision` (08); Reject kept alongside Later |
| autonomy levels 0–4 | L0–L4 named ladder | rename + earned levels (07) |
| `DEFAULT_GUARDRAILS` six caps | E-2 trio + platform superset | versioned `NovaGuardrails` (07) |
| `supplier_manager` / `courier_manager` subagents | Operations / Shipping departments | rename + data migration (07) |
| `ceo` subagent | CEO-Nova (root) | fold into root (07) |
| night/reflection job kinds | night shift (§9) | keep as scheduler slots; typed outputs (09) |
| `NovaReport` kind=morning | E-16 Brief | structured `NovaBrief` (09) |
| `NovaPlaybook` (procedural promotions) | — (collides with E-19) | rename `NovaRoutine` (06) |
| `nova_experiments` | E-15 Experiment | extend (12) |
| brand/goals memory namespaces | E-12 BrandProfile / E-16 Goal | structured entities (10/12), memory stays the narrative layer |
| `detectAnomalies` + pulse | §13 watchdog (detection half) | escalation ladder call/push/card (13) |
| `usd()` formatting | ৳ minor units, store display currency | `money()` refactor (06) |

## 12. Corrections to PRD §14 readiness verdicts (ground truth wins)

The PRD's backend matrix audited only Dakio's pre-existing systems. Against the whole
codebase: **Action ledger + receipts** — not BUILD; shipped and merchant-live
(`nova-ui-build-01` documented this exact error). **Memory store** — shipped (04)
minus receipted corrections + call injection. **Chat/agent runtime** — substrate
shipped (eve sessions, 10 subagents, dispatcher); router identity/signing/intents
remain. **Authority engine** — level+guardrail gate shipped; mode axis, no-touch,
earned levels, founder-only classification remain. **Campaign Manager** — the PRD's
"Autopilot executes ads" PARTIAL is contradicted by `02-findings` (Meta `ads_read`
only, no stored Campaign model, no ROAS source); phase 09 opens with the §18
discovery spike and a designed propose-only fallback. Voice stack READY is confirmed
(ElevenLabs+Twilio live in dakio-api for order verification, zero Nova wiring).

**Post-rewrite correction (2026-07-22):** the doors then shipped as the merchant
**Grow Lab** (`/api/grow` — GrowCampaign/GrowPost/GrowBroadcast/GrowIdea/GrowGoal +
real organic FB publish; six live modules with `createdBy:'nova'` columns and empty
NovaLane slots pre-cut for Nova). Paid ads and customer-send channels remain absent.
See [`grow-lab-reconciliation.md`](./grow-lab-reconciliation.md) — it re-baselines
phases 07/09/10/12 and binds the Grow↔Nova integration architecture (Nova writes
through the action pipeline into Grow tables via a shared `growService`, with
`novaActionId` attribution and NovaLane as the door's decision surface).
