# PRD — Nova UI Build
## Nova V1 · Data & Functional Requirements

**Source of truth:** Nova HQ Prototype v5 (desktop) + mobile companion
**Purpose:** Backend / AI wiring contract
**Date:** 21 Jul 2026 · Confidential

---

## 1 · Purpose & scope

The v5 prototype is now the product spec. This document translates every behavior in it into **functional requirements** (FR-x), a **data model** (E-x), the **backend services** that must exist, and the **AI operator contract** — so engineering can judge, module by module, whether the real backend is ready to replace the prototype's mock state. Anything not listed here is not in V1.

At a glance:

- **7** surfaces (FR groups)
- **16** core entities
- **10** departments · 65 duties
- **6 + 4** doors + sub-views to build

---

## 2 · System model — the five load-bearing concepts

Everything in Nova reduces to five concepts. The backend must implement each as a first-class primitive, not UI decoration:

| Concept | Definition | Hard rule |
|---|---|---|
| **Duty** | One of 65 named responsibilities, each owned by a department and executed through exactly one **door** (a Dakio module). | A duty with no shipped door is `NEEDS DOOR` — Nova must never claim work on it. |
| **Door** | The Dakio surface where a duty's output lands and where the founder could do the same job manually. | Nova's output always lands as inspectable records (`by: nova`), never as invisible side effects. |
| **Action + Receipt** | Every state change Nova makes, logged with evidence, outcome, and (where applicable) an undo path. | No write without a receipt. Undoable actions carry a 24h reversal window. |
| **Decision** | A proposed action above Nova's current authority, queued to the founder with reason + receipt + approve/later. | Approval executes the linked action atomically and reflects everywhere (desk, room, module, chat). |
| **Authority** | Autonomy level L0–L4 × per-module mode (Manual / Assisted / Autonomous) × guardrails (spend cap, discount cap, no-touch list). | Checked server-side before every action. A refusal is itself a logged, explainable event. |

---

## 3 · Functional requirements

### FR-1 · Hire & onboarding

- **FR-1.1** — One-time hire ritual: intro → activation → enter HQ. Creates the Nova instance bound to one store, starting at **L3 Operator** with default guardrails (৳5,000/day spend, 15% max discount, seeded no-touch list).
- **FR-1.2** — Hired state persists; all Dakio nav pages show Nova presence markers (which modules Nova watches) once hired.

### FR-2 · Nova HQ

- **FR-2.1 Header vitals, live:** local clock (store timezone), on-duty timer, cumulative tasks-done-today counter, rotating "Nova is now…" status line reflecting the agent's actual current activity.
- **FR-2.2 Two views:** Desk (decision-first: queue of ≤3 decision cards with inline approve) and Command (10-department grid, each tile showing live status line + duty coverage fraction, e.g. `8/10`).
- **FR-2.3 Live feed:** reverse-chron stream of completed actions (last 8 shown), each linked to its ledger entry; new items pushed in real time and marked hot.
- **FR-2.4 Morning brief:** generated daily 06:00 store time — overnight summary, away-tiles, links to queued decisions. Openable on demand; read state tracked (receipt: "opened 06:12, 2 of 3 decisions actioned").
- **FR-2.5 Door tiles:** one tile per Nova door showing pending-approval count, mode, or build phase; opens the module.
- **FR-2.6 Share card:** exportable summary card (tasks done, carts recovered, hours on duty) for the founder to share.

### FR-3 · Decision desk

- **FR-3.1** — FIFO decision queue. Card shows: department tag + impact label, title, parameters line, one-sentence **why**, expandable **receipt** (evidence window, before/after metrics, guardrail check, reversibility). Actions: **Approve** / **Later** (requeues to back).
- **FR-3.2** — Approval executes the linked action (e.g. sets campaign live), removes the decision everywhere it is surfaced (desk, room plan, module row, chat), and logs to the ledger — one transaction.
- **FR-3.3** — Decisions are cross-surfaced: the same decision can appear as a module row (`AWAITING APPROVAL`), a room plan item (`WAITING ON YOU`), and a chat option set. All views resolve from one record.
- **FR-3.4 Trust meter:** score rises with approvals; at queue-clear + threshold, offer promotion L3 → L4 Acting CEO. Levels above earned level are locked in the selector.

### FR-4 · Authority: autonomy, modes, guardrails

- **FR-4.1** — Global autonomy ladder **L0 Observe → L4 Acting CEO**, founder-selectable up to the earned level. Each duty declares its minimum level; below it the duty shows `LOCKED Lx` and Nova skips it.
- **FR-4.2** — Per-module mode: **Manual** (Nova observes, drafts held), **Assisted** (everything lands as draft, nothing goes out unapproved — default), **Autonomous** (executes within guardrails, receipts for everything). Mode changes take effect immediately on that module's pending items.
- **FR-4.3** — Editable guardrails: daily spend cap (৳500–20,000 step 500), max discount % (0–50 step 5), **no-touch list** (freeform locks, e.g. "SAREE PRICING") addable via panel or chat, removable via panel. A no-touch lock freezes related pending decisions.
- **FR-4.4** — Guardrail engine runs server-side pre-action. Violations either downgrade the action to a decision card (in Assisted/Auto) or refuse with explanation (founder-only actions, e.g. bulk refunds).

### FR-5 · Department rooms (10)

CEO Office, Marketing, Sales, Support, Product Research, Inventory, Shipping, Finance, Operations, Growth. Every room renders the same anatomy from live data:

- **FR-5.1 Grade + scorecard:** letter grade (A–C scale) computed from 3 scored metrics, each with value, target subtext, progress bar, and tone (good / warn / risk).
- **FR-5.2 Now / Next:** what Nova is doing in this department right now, and its next 2 queued items.
- **FR-5.3 Plan board:** items with status `DONE · IN PROGRESS · WAITING ON YOU · SCHEDULED · NEEDS DOOR`, progress %, and decision links (approving flips the item to IN PROGRESS · EXECUTING). "Waiting on you" count surfaced as a blocked banner.
- **FR-5.4 Action history:** per-department ledger view — time, action, outcome, expandable receipt.
- **FR-5.5 Duty roster:** one row per duty: name, status chip (`ACTIVE / NEEDS DOOR / LOCKED Lx / PAUSED`), door + last action, and an on/off toggle (disabled when locked or door-less). Coverage summary line per room and globally.
- **FR-5.6 Weekly report memo:** Nova-written narrative (memo + evidence bullets + current priority) openable per room.
- **FR-5.7 KPIs, tasks, delegate chips:** 3 live KPIs, latest task lines (done / alert / in-progress), and 3 one-tap delegation prompts feeding chat.

### FR-6 · Doors (Nova modules)

- **FR-6.1 Campaign Manager (built in v5):** KPI strip (active, spend today, blended ROAS, attributed revenue); tabs Overview / Campaigns / Calendar / Templates. Campaign rows: owner (NOVA/YOU), status chip (pending, draft, scheduled, live, paused, ended), channels, goal, dates, budget/day, spent, ROAS, revenue; actions pause, resume, duplicate-as-draft, approve (approve disabled in Manual). Filters by status. Overview: revenue-by-campaign bars, channel attribution, 3 Nova suggestions (one-tap apply in Assisted, auto-note in Auto, held in Manual). Calendar with campaign events. 6 templates that pre-fill the wizard.
- **FR-6.2 Campaign wizard:** 7 steps — Goal (5 options) → Channels (6 toggles) → Audience (5 named segments with live reach counts) → Budget (per-day + duration, total, projected reach + ROAS by goal, live guardrail check) → Creatives (Nova generates ×3 hooks / upload / from Content Studio) → Schedule → Review → creates a `scheduled` campaign owned by YOU.
- **FR-6.3 Content Studio (built in v5):** tabs Library / Calendar / Review queue / Brand assets. 8 content types; item card: type, title, excerpt, owner, status (draft, in review, scheduled, published — HELD in Manual), brand-voice score %, version count, channel, timing. Actions: approve→publish, request changes (back to Nova), publish draft, new version. Brand assets: tone words, palette, DO/DON'T voice rules — these feed generation. Composer: Type → Brief (topic + tone) → Nova-generated preview → save to review queue.
- **FR-6.4 Broadcast Center / Product Research Hub / Growth Lab / Goals & Strategy (framed in v5, full UI in build):** render the generic module shell — purpose line, 3 KPIs, capability chips, item list with the shared status chips, approve on pending items, mode banner, phase tag. Full capability lists are in §6 readiness matrix; backend contracts in §4 already cover their entities.
- **FR-6.5** — All modules share: `+ Create` entry (founder can always do the job manually), mode banner (FR-4.2), pending-count badges surfaced on HQ tiles and Dakio nav, toast confirmations for every mutation.

### FR-7 · Nova chat (persistent, context-aware)

- **FR-7.1** — One thread across every surface, labeled with current context (HQ / room / module). Suggested chips adapt to context (e.g. "Why is Inventory graded C+?" in HQ; room delegates inside a room).
- **FR-7.2 Answer intents demonstrated in v5, all backend-real in V1:** explain a grade (memo + scorecard receipt) · report metrics (stat blocks) · execute a command ("pause all ads" → immediate action + feed event + **undo, 24h window**) · propose options (e.g. 3 scale routes; picking one approves the linked decision) · guardrail refusal with escalation to a decision card (bulk refund) · set a no-touch lock · free delegation (anything else becomes a queued task, outcome logged to feed and next brief).
- **FR-7.3** — Chat actions are the same primitives as UI actions: they hit the ledger, decision queue, and guardrail engine identically. Undo in chat reverses the ledger action.

### FR-8 · Mobile companion

The mobile prototype mirrors HQ: brief, decision cards, feed, chat. Same API — no mobile-only endpoints. Push notification on: new decision, guardrail refusal, risk flag, morning brief ready.

---

## 4 · Data model

All entities are per-store, timestamped, soft-deleted. Currency minor units + display currency (৳); timezone from store profile (Asia/Dhaka in mocks).

| Entity | Fields (key ones) | Notes / relations |
|---|---|---|
| **E-1 NovaInstance** | store_id, hired_at, autonomy_level (0–4), earned_level, trust_score, status_line, on_duty_since, tasks_today | One per store. Trust score updated by approval/undo events. |
| **E-2 Guardrails** | daily_spend_cap, max_discount_pct, no_touch[] {label, created_via, created_at} | Versioned — every change logged (who, when). |
| **E-3 ModuleMode** | module_id, mode (manual \| assisted \| auto) | Per Nova door; default assisted. |
| **E-4 Department** | key, name, status_line, grade, kpis[3], now, next[], memo | Grade + memo are AI-computed nightly (see §5). |
| **E-5 Duty** | id, department, name, door_module, door_exists, min_level, enabled, last_action_ref | Seeded from the 65-duty PRD roster; enabled is founder-editable (FR-5.5). |
| **E-6 ScoreMetric** | department, label, value, target_text, pct, tone (g\|a\|r) | 3 per department; inputs to grade. |
| **E-7 PlanItem** | department, status (done\|now\|you\|sched\|blocked), title, detail, progress_pct, decision_ref | "you" items must reference a Decision. |
| **E-8 Action (ledger)** | id, ts, department, duty_ref, actor (nova\|founder), verb, target_ref, outcome, receipt {evidence[], before, after, model_confidence, expected_impact}, undoable, undo_deadline, undone_at | Append-only. Feeds live feed, room history, briefs, hours-saved report. |
| **E-9 Decision** | id, tag, impact_label, title, params_line, why, receipt, status (queued\|approved\|skipped\|frozen\|expired), linked_action, surfaced_in[] | Frozen when a no-touch lock covers it. One source of truth for desk, rooms, modules, chat. |
| **E-10 Campaign** | id, name, owner, status (pending\|draft\|scheduled\|live\|paused\|ended), decision_ref, channels[], goal, audience_segment, budget_per_day, duration_days, spent, roas, revenue, conversions, start, end, note, creative_source, template_ref | Status transitions only via ledger actions. Metrics synced from ad platforms. |
| **E-11 ContentItem** | id, type (8), title, body/asset_ref, excerpt, owner, status (draft\|review\|scheduled\|published), voice_score, versions[], channel, scheduled_at, campaign_ref | voice_score computed against E-12 on every version. |
| **E-12 BrandProfile** | tone_words[], palette[], rules[] {kind: do\|dont, text}, languages (bn, en) | Founder-editable; injected into every generation prompt. |
| **E-13 Broadcast** | id, kind (broadcast\|automation), channels[], segment_ref + size, trigger, template_ref, status, results {sent, recovered_amount, opt_out_rate} | Segments: all, repeat, cart-abandoners, lapsed-90d, lookalike (reach counts live). |
| **E-14 ResearchCandidate** | id, title, score_100, score_weights, est_margin_pct, trend_delta, suppliers_compared[], page_draft_ref, status | Import approval creates product + generated page via Content Studio. |
| **E-15 Experiment** | id, hypothesis, metric, variants[], day, total_days, lift, significance, status, ice_score, learning_ref | Winners archived with adoption record. |
| **E-16 Goal / Brief / Chat** | Goal: name, target, current, pace_pct, projection, gap_plan_ref, risks[]. Brief: date, narrative, tiles[], decisions[], opened_at, actions_taken. ChatMessage: role, text, receipt?, stats?, options[]?, action_ref?, lock_flag | Brief read-state feeds trust receipts (FR-2.4). Chat thread is persistent per store. |

---

## 5 · AI operator contract — what the model layer must produce

| Capability | Contract | Cadence / trigger |
|---|---|---|
| **Night shift run** | Per-department analysis over Dakio data → executes in-guardrail actions (with receipts) → queues over-authority proposals as Decisions → writes PlanItems and department grades/memos. | Nightly batch + intraday event triggers |
| **Morning brief** | Narrative + away tiles + top decisions, grounded only in ledger entries (no unverifiable claims). | Daily 06:00 store time |
| **Decision authoring** | Every proposal carries: why (1 sentence), evidence window, before/after numbers, guardrail check result, reversibility statement, expected impact, confidence. | On any over-authority intent |
| **Content generation** | All 8 content types in brand voice (Bangla + English), scored against BrandProfile; revision loop on "request changes". | On demand + campaign needs |
| **Campaign optimization** | Bid adjust, pause weak sets, budget rebalance, scale proposals — each a ledger action with metric receipts. | Continuous within Autopilot/ads sync |
| **Chat agent** | Tool-calling over the same APIs as the UI: query metrics, explain (retrieve memo/scorecard), act (guardrail-checked), propose options, refuse + escalate, delegate to task queue, undo. | Real-time |
| **Forecast & grading** | Revenue projection (trend + seasonality, with stated confidence), department grades from ScoreMetrics, weekly memos, hours-saved report. | Nightly + weekly |

**Non-negotiables:** the model never mutates Dakio directly — it calls the action API, which enforces guardrails, writes the ledger, and lands output behind a door as a `by: nova` draft/record. Refusals and skipped duties are logged. Undo is an engineered reversal per action verb (stored inverse), not a model behavior.

---

## 6 · Backend readiness matrix

Verdict per subsystem: **READY** = exists in Dakio, wire it · **PARTIAL** = exists but missing Nova hooks · **BUILD** = does not exist.

| Subsystem | Status | What's needed before wiring |
|---|---|---|
| **Action ledger + receipts** | BUILD | Append-only store (E-8), undo executor, live feed stream (SSE/WS). Nothing else can honestly ship first — every surface reads from it. |
| **Decision service** | BUILD | Queue, approve/skip/freeze transactions, cross-surface fan-out (E-9). |
| **Authority engine** | BUILD | Level × mode × guardrail check as one pre-action gate; no-touch matcher; trust/promotion logic. |
| **Duty registry** | BUILD | 65-duty seed (E-5), per-duty toggle API, coverage rollups. |
| **Campaign Manager** | PARTIAL | Autopilot has ad execution; needs campaign CRUD, statuses, templates, wizard API, attribution rollup, calendar (FR-6.1/6.2). |
| **Content Studio** | BUILD | Content CRUD + versioning, review workflow, scheduler/publisher per channel, brand profile + voice scoring (E-11/E-12). |
| **Broadcast Center** | BUILD | Channel providers (email, SMS, push, WhatsApp, Messenger), segment engine with live counts, trigger/automation runner, opt-out compliance. |
| **Product Research Hub** | PARTIAL | Dropshipping import exists; needs scoring pipeline, trend/competitor data feeds, review queue, page-generation handoff. |
| **Growth Lab** | BUILD | Variant serving/splitting, significance math, hypothesis backlog, learning archive (E-15). |
| **Goals & Strategy** | BUILD | Goal CRUD, pace/projection compute, weekly review generator, risk register (E-16). |
| **Sub-view doors** | BUILD | Rate Compare, RTO Analytics, P&L Reports, RFQ Compare — 4 duties stay `NEEDS DOOR` until these ship. |
| **Existing doors** | READY | Orders, Products, Inbox, Purchases, Delivery, Accounts, Reports, Coupons, Dropshipping, Store Studio — need only `by: nova` attribution + webhook events into the ledger. |
| **Chat / agent runtime** | BUILD | LLM orchestration with tool access to all APIs above, persistent thread store, context injection (current surface), scheduler for night shift + 06:00 brief. |

---

## 7 · Non-functional requirements

- **NFR-1** — Feed and decision updates reach open clients ≤ 3s (push, not poll). Vitals (clock, timers, counters) computed client-side from server timestamps.
- **NFR-2** — Auditability: 100% of Nova writes have a ledger entry with receipt; ledger is exportable and immutable.
- **NFR-3** — Reversibility: every undoable verb ships with a tested inverse; undo honored for the full stated window even across model versions.
- **NFR-4** — Grounding: briefs, memos, grades, and chat answers may only cite ledger + Dakio data; numeric claims must be reproducible from stored evidence.
- **NFR-5** — Localization: Bangla + English content generation; ৳ currency formatting; store-local timezone for all schedules (briefs, best-time posting, pickups).
- **NFR-6** — Safety: founder-only verbs (bulk refunds, guardrail edits, promotion acceptance) can never be executed by the model, only proposed.
- **NFR-7** — Degradation: if the model layer is down, doors keep working manually; Nova surfaces show "off duty" rather than stale claims.

---

## 8 · Wiring order & open questions

**Recommended order:**
1. Ledger + feed
2. Authority engine + duty registry
3. Decision service
4. Campaign Manager wired end-to-end (one full vertical: night shift → decision → approve → execute → receipt → undo)
5. Content Studio + brand voice
6. Chat agent over the same tools
7. Remaining doors by revenue order (Broadcasts → Research → Growth Lab → Goals)

**Open questions:**
1. Which ad platforms does Autopilot already have write access to (bids, budgets, pause)? Determines how much of FR-6.1 is wiring vs. building.
2. WhatsApp Business API status — cart recovery (the #1 demo moment) depends on it.
3. Is there a store-level event bus today, or do doors need webhooks added one by one?
4. Trust-score formula and L4 promotion threshold — product to define before FR-3.4 is coded.
5. Data feeds for trends/competitor pricing (Research Hub) — buy, scrape, or defer?

---

*Nova × Dakio · Data & Functional Requirements V1 · Prepared for engineering*
