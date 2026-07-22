# PRD — Nova (Master Build)
## The complete, canonical spec for Nova, the AI Business Operator on Dakio

- **Product:** Dakio · **Feature:** Nova · **Version:** Master v2.0 (through Horizon 2)
- **Status:** Canonical — supersedes conflicts in the V1 Vision doc and folds in the Feature Build staging annex
- **Owner:** Product (PM) · **Flows to:** AI Engineering, Backend Engineering, Design, QA
- **Date:** 22 Jul 2026 · Confidential
- **Source of truth for behavior:** the Nova HQ prototype (desktop + mobile) as built through H2. Where prose and prototype disagree, the prototype wins and this doc is corrected.

---

## 0 · How to read this document

This is the **one document the whole team builds from.** It fuses three earlier artifacts so nobody has to reconcile them:

| Earlier doc | Role now | Status |
|---|---|---|
| **V1 Vision PRD** | The *why* — vision, mission, personality, north star. Quoted in §1–§2 and §18. | Absorbed. Kept for narrative only; its stale specifics (see §17 reconciliation) are corrected here. |
| **UI Build PRD (v1.1)** | The *what* — FR-x requirements + E-x data model. | Absorbed into §5–§13. |
| **Feature Build PRD** | The *how/when* — staged delivery + test gates. | Absorbed into §15. |

If you read only this file, you have full context. Section ownership: **AI Engineering** lives in §4, §9, §12, §13, §15. **Backend Engineering** lives in §6–§8, §11, §12, §14, §15. **Everyone** reads §3 (the one rule) and §16 (cross-team rules).

---

## 1 · Vision, mission, promise

> Nova is not an AI assistant. Nova is a full-time digital employee that independently operates, grows, and optimizes an ecommerce business 24/7.

Every Dakio store gets one employee from day one. Online, asleep, or on vacation, the founder has an operator increasing revenue, cutting operational work, and improving customer experience.

- **Vision:** One founder. One AI employee. One profitable business.
- **Mission:** Let anyone start and scale ecommerce without hiring — Nova is the expert in every department instead of the founder learning all of them.
- **Positioning:** Not a chatbot, copilot, or assistant. An **AI Business Operator.**
- **Core promise:** *"Wake up to a business that kept working while you slept."*
- **Success metric:** not AI usage — **Business Hours Saved** (hours worked, tasks done, revenue influenced, founder time saved), reported weekly (see §11).

---

## 2 · Product philosophy & personality

Nova is **proactive** — it observes, thinks, plans, executes, learns, and reports without waiting for a prompt.

**Four principles (binding on every surface and prompt):**
1. **Proactive first** — not "Ask Nova," but "I found three opportunities."
2. **Context aware** — Nova remembers customers, orders, products, inventory, ads, suppliers, margins, shipping, support, conversations, analytics (see Memory, §10).
3. **Execution over suggestions** — prefer "I already prepared it" / "I already completed it" over "You should…" — bounded by authority (§4).
4. **Explain every decision** — e.g. *"I paused Campaign A because CPA rose 43% over three days."* No number without reproducible evidence.

**Personality:** calm, proactive, honest, data-driven, confident, transparent; never spammy, never overwhelming. Explains decisions; never surprises the founder.

**Communication style (drives AI generation + voice scripts):** state the action and its expected impact, not the raw observation.
- Not "There are 14 abandoned carts" → *"I prepared recovery messages for all 14 abandoned carts; expect 3–5 recoveries if sent today."*
- Not "Sales dropped" → *"Sales dropped because CTR fell, a supplier delayed deliveries, and two products went out of stock. Here's what I've already done…"*

---

## 3 · The one rule that never bends

**The AI/model layer never mutates Dakio directly.** Every state change flows through the action pipeline:

> **authority check → execute → append ledger entry with receipt → land behind a door**

If a capability can't honor that, it doesn't ship. This single invariant is what makes Nova auditable, reversible, and trustworthy — it is the product, not an implementation detail.

---

## 4 · The five load-bearing concepts

Everything reduces to five primitives. Each is first-class in the backend, not UI decoration.

| Concept | Definition | Hard rule |
|---|---|---|
| **Duty** | One of 65 named responsibilities, owned by a department, executed through exactly one **door**. | No shipped door → status `NEEDS DOOR`; Nova never claims that work. |
| **Door** | The Dakio surface where a duty's output lands and where the founder could do the same job manually. | Output is always an inspectable record marked `by: nova`, never a hidden side effect. |
| **Action + Receipt** | Every state change, logged with evidence, before/after, outcome, confidence, and an undo path where reversible. | No write without a receipt. Undoable actions carry a 24h reversal window. |
| **Decision** | A proposed action above current authority, queued to the founder with reason + receipt + Approve/Later. | Approval executes the linked action atomically and updates every surface it appears on. |
| **Authority** | Autonomy level (L0–L4) × per-agent mode (Manual/Assisted/Autonomous) × guardrails. | Checked server-side before every action. A refusal is itself a logged, explainable event. |

---

## 5 · Authority model

### 5.1 Autonomy ladder (reconciled — canonical names, with the Vision doc's names mapped)

| Level | Canonical name | Vision-doc name | Behavior |
|---|---|---|---|
| **L0** | Observe | Observation Only | No actions; reports only. |
| **L1** | Suggest | Recommendations | Creates tasks/recommendations; needs approval. |
| **L2** | Draft | Prepared Actions | Prepares ads, products, posts, replies, discounts as drafts; founder approves. |
| **L3** | Operator | Autonomous | Executes low-risk actions within guardrails; notifies founder. **(Default at hire.)** |
| **L4** | Acting CEO | Business Operator | Runs daily operations with minimal supervision inside founder-set guardrails. |

Founder-selectable **up to the earned level**; higher levels are locked until trust is earned (§11). Each duty declares a minimum level; below it the duty shows `LOCKED Lx` and Nova skips it.

### 5.2 Per-agent mode
**Manual** (Nova observes, drafts held) · **Assisted** (everything lands as a draft awaiting approval — *default*) · **Autonomous** (executes within guardrails, receipts for everything). With H2, mode is **per department agent** (promote Marketing-Nova to Autonomous while Finance-Nova stays Assisted). Mode changes take effect immediately on that agent's pending items. Switchable from the room agent bar, the module header, or chat.

### 5.3 Guardrails
Daily spend cap (৳500–20,000, step 500), max discount % (0–50, step 5), and a **no-touch list** of freeform locks ("SAREE PRICING") addable from the panel or chat. A lock **freezes related pending decisions** immediately. Guardrails are versioned; every change is logged.

### 5.4 Founder-only verbs
Bulk refunds, guardrail edits, promotion acceptance, and **contract signing** can never be executed by any agent — only proposed. Requesting one produces a refusal + explanation + escalation decision card, on every path (UI, chat, voice).

---

## 6 · The organization — 10 departments, 65 duties, 11 agents

**Canonical departments (as built):** CEO Office · Marketing · Sales · Support · Product Research · Inventory · Shipping · Finance · Operations · Growth.

> **Reconciliation with the Vision doc:** the vision listed "Supplier Manager" and "Courier Manager" as top-level departments. In the build these are **duties** — supplier compare/negotiate/quality/switch live under **Operations**; courier selection/RTO/delay/cost live under **Shipping**. Same responsibilities, cleaner org. Currency is **৳** (display currency comes from the store profile; the vision doc's `$` was illustrative).

**Duty coverage today:** 61 of 65 duties are `ACTIVE` or honestly `LOCKED`; 4 remain `NEEDS DOOR` pending sub-view doors: Rate Compare, RTO Analytics, P&L Reports, RFQ Compare.

**H2 agents:** 10 named department agents (Marketing-Nova, Sales-Nova, … Research-Nova) + **CEO-Nova** who coordinates them. Per-agent trust + mode; **one ledger, one desk, one no-touch list** bind them all.

Department charters (what each is responsible for):
- **CEO** — overview, growth planning, revenue forecasting, goal tracking, morning report, weekly strategy.
- **Marketing** — campaigns, reels/posts/stories, email/SMS/push, seasonal promotions, trend analysis, performance optimization.
- **Sales** — customer replies, negotiation, discounts, upsell/cross-sell/bundles, cart recovery, objection handling.
- **Support** — FAQs, order tracking, replacements, refund workflows, escalation, tone of voice.
- **Product Research** — trending products, competition, demand, pricing, page generation, creatives, import.
- **Inventory** — stock prediction, reorder, dead stock, bundle suggestions, supplier switching.
- **Shipping** — courier selection, delay prediction, RTO reduction, shipping-cost optimization.
- **Finance** — profit, cashflow, ad spend, taxes, margins, forecasting, expense alerts.
- **Operations** — supplier compare/negotiate/quality/delay/switch, POs, pickups, RFQs.
- **Growth** — new channels, products, bundles, influencers, affiliates, pricing experiments.

---

## 7 · Surfaces & functional requirements

### FR-1 · Hire & onboarding
One-time ritual (intro → activation → HQ). Creates the Nova instance bound to one store at **L3 Operator**, defaults ৳5,000/day spend, 15% max discount, seeded no-touch list. Hired state persists; Dakio nav shows presence markers on watched modules.

### FR-2 · Nova HQ
- **2.1 Header vitals (live):** local clock, on-duty timer, tasks-done counter, rotating "Nova is now…" status. Header actions **☎ Call Nova** and **Memory**.
- **2.2 Two views:** Desk (≤3 decision cards, inline approve) and Command (10-agent department board with per-agent mode chip + coverage fraction).
- **2.3 Live feed:** reverse-chron completed actions (last 8), pushed ≤3s, each linked to its ledger receipt.
- **2.4 Morning brief:** daily 06:00 store time; overnight narrative + away tiles + queued decisions; read-state tracked; **"Hear it as a call"** starts the briefing call (FR-9).
- **2.5 Door tiles:** pending count / mode / build phase per door.
- **2.6 Share card:** exportable shift summary.
- **2.7 Tonight's plan:** pre-shift per-department intent list; tomorrow's brief reports planned vs. done.
- **2.8 Hours-saved report:** weekly modal — hours on duty, founder hours saved, revenue influenced, tasks done, per-department breakdown; shareable.

### FR-3 · Decision desk
FIFO queue; card = department tag + impact label + title + params + one-sentence why + expandable receipt (evidence window, before/after, guardrail check, reversibility). Approve executes the linked action and clears it from every surface (desk, room plan, module row, chat, voice) in one transaction; Later requeues to back. Decisions cross-surface from **one record**. Trust meter rises with approvals; queue-clear + threshold offers L3→L4 promotion.

### FR-4 · Authority UI
Exposes §5: ladder selector (locked above earned), per-agent mode switches, guardrail editors, no-touch panel. Refusals surface as explainable events.

### FR-5 · Department rooms (×10)
Shared anatomy, all live: grade + 3-metric scorecard · Now/Next · plan board (`DONE · IN PROGRESS · WAITING ON YOU · SCHEDULED · NEEDS DOOR`) · action history with receipts · 65-duty roster with toggles and status chips (`ACTIVE / NEEDS DOOR / LOCKED Lx / PAUSED`) + coverage rollups · weekly memo · KPIs + task lines + delegate chips · **agent bar** (agent name, own trust %, own mode switch, "reports to CEO-Nova").

### FR-6 · Doors (Nova modules)
- **6.1 Campaign Manager (built):** KPI strip; Overview/Campaigns/Calendar/Templates; rows (owner, status, channels, budget, spent, ROAS, revenue); pause/resume/duplicate/approve; 3 mode-aware suggestions; 6 templates.
- **6.2 Campaign wizard (built):** Goal → Channels → Audience (live reach) → Budget (live guardrail check) → Creatives (Nova ×3 / upload / library) → Schedule → Review → creates a scheduled campaign owned by YOU.
- **6.3 Content Studio (built):** Library/Calendar/Review/Brand assets; 8 content types; brand-voice score; approve→publish, request-changes loop, composer; brand assets (Bangla + English) feed generation.
- **6.4 Broadcast Center / Product Research Hub / Growth Lab / Goals & Strategy:** generic module shell until full build (§15 Stage 6).
- **6.5 Shared:** `+ Create` manual path, mode banner, pending badges on HQ tiles + Dakio nav, toast-confirmed mutations.

### FR-7 · Nova chat (one thread, agent-routed)
One persistent thread everywhere, context-labeled with adaptive chips. **CEO-Nova routes each message to the right department agent; every reply is signed with its agent tag.** Intents (all backend-real): explain grade (+ receipt) · report metrics · execute + 24h undo · propose options that approve linked decisions · guardrail refusal + escalation · set no-touch lock · **approve the seasonal playbook** · **negotiation status / ☎ listen-in live** · **network benchmarks** · **promote an agent (with undo)** · free delegation → queued task. Chat verbs are the same primitives as UI verbs.

### FR-8 · Mobile companion
Mirrors HQ (brief, decision cards, feed, chat); same API. Push on: new decision, guardrail refusal, risk flag, brief ready, incoming Nova call.

### FR-9 · Nova Voice (H1)
Rides Dakio's **existing ElevenLabs voice-call pipeline** (live for order verification) — wire, don't build.
- **9.1 Briefing call** — founder-initiated; Nova speaks the brief; decision points offer **voice Approve/Later** executing the same decision records; live transcript renders.
- **9.2 Alert calls (watchdog)** — Nova calls first on spend spike / stockout / courier failure; Answer / Send to desk; declining keeps the decision queued.
- **9.3 Customer calls** — order verification extended to cart recovery + delivery confirmation (Sales/Support duties).
- **9.4 Negotiation calls (H2)** — Nova negotiates by voice; founder can listen in live; **signing is founder-only**.
- **9.5** — Every call is a ledger action; recording + transcript are the receipt; voice approvals log identically to taps; duration + outcome hit the feed.
- **9.6** — Bangla + English.

### FR-10 · The team & network (H2)
- **10.1 Department agents** — per-agent trust + mode; board chips; agent bars; agent-signed chat; CEO-Nova merges reports; one ledger/desk enforced.
- **10.2 Seasonal playbooks** — proposed ≥3 weeks ahead (Eid, Boishakh, 11.11): campaigns + POs + content + broadcasts as **one bundle decision**; one approval runs the month; executes and rolls back piece-by-piece; each step receipted.
- **10.3 Negotiation** — RFQ rounds (e.g. ৳75→৳71→৳68) vs benchmark; live-listen; transcript + terms as receipt; founder-only signing.
- **10.4 Network benchmarks** — anonymized cohort aggregates (WhatsApp recovery, ROAS, courier rates, seasonal timing) feeding grades, suggestions, playbook timing. **Aggregates only — a store's data never leaves it.**

---

## 8 · Dashboard "while you were away" (the FR-2 brief, spelled out)

Home reads as a report, not a console:

> **Good morning, Founder** 👋 While you were away…

Revenue · orders · messages answered · posts published · recovered carts · new products found · inventory alerts solved · profit · **hours Nova worked** — each figure linking to its ledger evidence. Below it, a **task feed** of completed work (imported trending products, updated prices, replied to customers, generated creatives, optimized shipping, scheduled campaigns, negotiated supplier pricing, forecast inventory), each with a receipt.

---

## 9 · Daily workflow (grounds the vision's rhythm in real mechanics)

- **Morning (06:00 store time):** brief generated (FR-2.4) — summary, priorities, urgent alerts, opportunities; optionally delivered as a briefing call (FR-9.1).
- **Throughout the day:** monitor → analyze → execute (in-guardrail) → learn → optimize; watchdog (FR-9.2) interrupts only when something breaks.
- **Night shift (00:00–06:00):** per-agent deep analysis, trend detection, campaign preparation, content generation, inventory + growth planning, and morning-report prep — producing the actions, decisions, PlanItems, grades, and memos the founder sees at 06:00. **Tonight's plan (FR-2.7)** previews it; tomorrow's brief scores planned vs. done.

---

## 10 · Memory system (H1.2)

Nova never forgets. Stored, founder-editable beliefs across: business goals, brand voice, preferred suppliers, preferred couriers, discount rules, customer history, high-value customers, previous campaigns, failures, successful experiments, owner preferences. Founder can **forget** any belief or **teach** a new rule; every correction is receipted and injected into subsequent generations and call scripts.

---

## 11 · Trust system & success metric

Every action carries a **confidence score, reason, expected impact, undo button, and owner-approval requirement** (if above authority). Trust rises with clean approvals and receipts; undo events and refusals feed it too — **trust is earned from the ledger, not asserted.** At threshold + cleared queue, Nova offers its own promotion. With H2, trust is tracked **per agent** from that agent's ledger slice.

**Success metric — Business Hours Saved**, reported weekly (worked / tasks done / revenue influenced / time saved), computed from the ledger and reproducible by an auditor script.

---

## 12 · Data model (22 entities)

All entities per-store, timestamped, soft-deleted. Currency minor units + display (৳); store-local timezone.

| Entity | Key fields | Notes |
|---|---|---|
| **E-1 NovaInstance** | store_id, hired_at, autonomy_level, earned_level, trust_score, status_line, on_duty_since, tasks_today | CEO-Nova identity; one per store. |
| **E-2 Guardrails** | daily_spend_cap, max_discount_pct, no_touch[] | Versioned; changes logged. |
| **E-3 AgentMode** | agent_id, mode (manual/assisted/auto) | Per department agent and per door; default assisted. |
| **E-4 Department** | key, name, status_line, grade, kpis[3], now, next[], memo | Grade + memo AI-computed nightly. |
| **E-5 Duty** | id, department, name, door_module, door_exists, min_level, enabled, last_action_ref | 65-duty seed; founder-toggleable. |
| **E-6 ScoreMetric** | department, label, value, target_text, pct, tone | 3 per department; grade inputs. |
| **E-7 PlanItem** | department, status, title, detail, progress_pct, decision_ref, night_shift_date | Powers plan board + Tonight's Plan. |
| **E-8 Action (ledger)** | id, ts, department, agent_id, duty_ref, actor, verb, target_ref, outcome, receipt{evidence[],before,after,confidence,expected_impact}, undoable, undo_deadline, undone_at | Append-only. Feeds feed, history, briefs, hours-saved, trust. |
| **E-9 Decision** | id, tag, impact_label, title, params_line, why, receipt, status, linked_action, surfaced_in[], bundle_ref | One record, many surfaces. |
| **E-10 Campaign** | id, name, owner, status, decision_ref, channels[], goal, audience, budget_per_day, spent, roas, revenue, … | Transitions only via actions. |
| **E-11 ContentItem** | id, type, title, body, owner, status, voice_score, versions[], channel, scheduled_at | Scored vs E-12 per version. |
| **E-12 BrandProfile** | tone_words[], palette[], rules[], languages | Injected into generation + call scripts. |
| **E-13 Broadcast** | id, kind, channels[], segment_ref, trigger, status, results{} | Segments with live counts. |
| **E-14 ResearchCandidate** | id, title, score_100, weights, est_margin, trend_delta, suppliers[], page_draft_ref, status | Import → product + page. |
| **E-15 Experiment** | id, hypothesis, metric, variants[], day, lift, significance, status, ice_score | Winners archived as learnings. |
| **E-16 Goal/Brief/Chat** | Goal: target, pace, projection, risks. Brief: narrative, tiles, decisions, opened_at, planned_vs_done. ChatMessage: role, agent_id, text, receipt?, stats?, options[]?, action_ref? | Chat carries the answering agent. |
| **E-17 CallSession** | id, kind (brief/alert/customer/negotiation), parties[], started_at, duration, transcript[], recording_ref, approvals[], outcome, action_ref | Receipt for FR-9; voice approvals ref E-9. |
| **E-18 Memory** | id, kind (brand_voice/rule/preference/learning), text, source, created_via, corrected_at | Forget/teach; corrections receipted. |
| **E-19 Playbook** | id, season, window, items[]{kind,ref,status}, status, decision_ref, progress | One decision approves the bundle. |
| **E-20 NegotiationSession** | id, counterparty, subject, rounds[]{offer,ts}, target, benchmark_ref, call_refs[], final_terms, decision_ref, status | Signing founder-only via E-9. |
| **E-21 Benchmark** | metric, cohort, network_value, store_value, sample_size, as_of | Aggregates only; min cohort floor. |
| **E-22 AgentInstance** | id, department, name, trust_score, mode, reports_to | Trust from own ledger slice. |

---

## 13 · AI operator contract (AI Engineering's bible)

| Capability | Contract | Cadence |
|---|---|---|
| Night shift | Per-agent analysis → in-guardrail actions with receipts → over-authority proposals as decisions → PlanItems, grades, memos; CEO-Nova merges. | Nightly + event triggers |
| Tonight's plan | Pre-shift intent list per department. | Daily pre-shift |
| Morning brief | Narrative + tiles + top decisions, grounded only in ledger; voice-readable. | Daily 06:00 |
| Decision authoring | Why, evidence window, before/after, guardrail result, reversibility, expected impact, confidence — on every proposal. | On over-authority intent |
| Content generation | 8 types, brand voice (bn+en), scored vs BrandProfile + Memory; revision loop. | On demand |
| Campaign optimization | Bid adjust, pause weak sets, rebalance, scale — all ledger actions. | Continuous |
| Chat agent | CEO-Nova router + department agents, tool-calling over the same APIs as the UI; every answer attributed. | Real-time |
| Voice agent | Same tools over the ElevenLabs pipeline; voice approvals = decision approvals; transcript receipts. | Real-time + triggered |
| Watchdog | Threshold rules over ledger + metrics → call first, push second, decision card always. | Continuous |
| Negotiation | Multi-round strategy in guardrails, benchmark-informed; never signs — proposes. | Per RFQ |
| Playbook planning | Seasonal bundles ≥3 weeks ahead from benchmarks + history. | Seasonal calendar |
| Forecast & grading | Revenue projection with confidence, per-agent grades, weekly memos, hours-saved. | Nightly + weekly |

**Non-negotiables:** never mutate Dakio directly (§3); refusals and skipped duties logged; undo is an engineered inverse per verb (not a model behavior); founder-only verbs are propose-only; no claim not reproducible from stored evidence.

---

## 14 · Backend services & readiness matrix (Backend Engineering's bible)

READY = exists in Dakio, wire it · PARTIAL = exists, missing Nova hooks · BUILD = new.

| Subsystem | Status | Needed |
|---|---|---|
| Action ledger + receipts | BUILD | Append-only store (E-8), undo executor, real-time feed. Ships first — everything reads from it. |
| Decision service | BUILD | Queue, approve/skip/freeze transactions, cross-surface fan-out, bundle support (playbooks). |
| Authority engine | BUILD | Level × per-agent mode × guardrails as one pre-action gate; no-touch matcher; per-agent trust. |
| Duty registry | BUILD | 65-duty seed, toggle API, coverage rollups. |
| **Voice stack** | **READY** | ElevenLabs order-verification pipeline is live. Add: call sessions (E-17), transcript receipts, voice-approval hook into decisions, watchdog triggers, scripts. |
| Campaign Manager | PARTIAL | Autopilot executes ads; needs CRUD, statuses, templates, wizard API, attribution, calendar. |
| Content Studio | BUILD | Content CRUD + versioning, review workflow, per-channel publisher, brand profile + voice scoring. |
| Broadcast Center | BUILD | Channel providers, segment engine w/ live counts, automation runner, opt-out compliance. |
| Product Research Hub | PARTIAL | Import exists; needs scoring pipeline, trend/competitor feeds, review queue, page handoff. |
| Growth Lab | BUILD | Variant serving, significance math, backlog, learning archive. |
| Goals & Strategy | BUILD | Goal CRUD, pace/projection, weekly review generator, risk register. |
| Memory store | BUILD | E-18 CRUD, correction receipts, injection into generation + calls. |
| Playbook engine | BUILD | Bundle model, piece-by-piece executor + rollback. |
| Negotiation engine | BUILD | RFQ rounds, offer strategy, live-listen bridge on the voice stack, founder-only signing. |
| Benchmark pipeline | BUILD | Anonymized aggregation, cohorting, privacy floor. |
| Sub-view doors | BUILD | Rate Compare, RTO Analytics, P&L Reports, RFQ Compare. |
| Existing doors | READY | Orders, Products, Inbox, Purchases, Delivery, Accounts, Reports, Coupons, Dropshipping, Store Studio — need `by: nova` attribution + events into the ledger. |
| Chat/agent runtime | BUILD | CEO-Nova router + department agents, tool access, persistent thread, context injection, schedulers. |

**NFRs:** feed/decisions ≤3s push · 100% receipt coverage, immutable + exportable ledger, call recording + transcript · tested inverse per undoable verb · grounding (only ledger + Dakio data; numbers reproducible) · localization (bn+en text **and voice**, ৳, store timezone) · safety (founder-only verbs propose-only; voice approvals need a confirmation phrase) · degradation (model down → "off duty" + manual doors; voice down → push + desk) · privacy (benchmarks aggregate-only, cohort floor enforced).

---

## 15 · Staged delivery plan (with gates)

Sequential 0→2 (each is the substrate of the next); from Stage 3, ≤50% overlap, but **no gate demo may depend on unfinished later work.** Every gate is a scripted demo on a clean staging store, run by someone who didn't build the stage. **A stage that doesn't pass doesn't ship, and the next doesn't start.**

| Stage | Name | Ships | Owner | Exit gate (pass = all steps, zero manual DB pokes) |
|---|---|---|---|---|
| **0** | Spine | Ledger, receipts, undo, live feed, `by: nova` in existing doors | Backend | Create a coupon "as Nova" via harness → shows in door + feed ≤3s with receipt → undo removes it, ledger shows action + undo. |
| **1** | Law | Authority engine + 65-duty registry | Backend | Bulk-refund attempt refused + escalated; over-cap campaign downgraded to a decision; adding a no-touch lock freezes a pending decision — all server-enforced. |
| **2** | Consent | Decision service (+ bundle support) | Backend | One authored decision on desk+room+module; approve on desk → executes, flips plan item, logs feed; skip requeues; freeze on lock. One record, four surfaces, zero drift. |
| **3** | Proof | **Campaign vertical end-to-end** + night shift v1 + brief v1 | Backend + AI | Run twice on two stores: night shift → 06:00 brief with a scale decision → approve → live in Campaign Manager → receipt → undo reverts. No engineer touches anything after "run night shift." **Company milestone — we don't call Nova "working" until this passes.** |
| **4** | Craft | Content Studio + brand voice | AI | Brief → in-voice draft (score) → request changes → v2 → approve → publishes on schedule; a seeded off-voice draft is flagged below threshold. |
| **5** | Conversation | Chat agent | AI | 10 mixed asks/commands live: every answer grounded, every action receipted, one over-authority ask refused + escalated. 10/10, no hallucinated numbers (spot-audited vs ledger). |
| **6** | Reach | Broadcasts → Research → Growth Lab → Goals + 4 sub-view doors | Backend + AI | Per door: duties flip to `ACTIVE`, night-shift outputs land as inspectable drafts, founder completes one manual job. Stage exits when **zero `NEEDS DOOR` remain.** |
| **7** | Presence (H1) | Voice, memory, hours-saved, tonight's plan, watchdog | AI + Backend | "Run the day by voice": answer 06:00 briefing call, approve one + defer one by voice; seeded stockout → watchdog call → approve restock by voice; a taught memory rule visibly changed that morning's draft. Entire founder day, zero taps. |
| **8** | Team (H2) | Agents, playbooks, negotiation, benchmarks | AI + Backend | Promote Marketing-Nova in chat (undo works); one-tap approve the Eid playbook (pieces execute with receipts); listen in on a negotiation round + sign by voice; view cohort benchmarks. Plus privacy audit signed off. |
| **9** | Launch hardening | GA criteria | All | 30 days on ≥20 pilot stores: 100% receipt coverage, zero guardrail breaches, zero founder-only executions, undo 100% in-window, feed p95 ≤3s, watchdog false-positive <1/store/week; degradation drills pass; grounding audit ≥99% reproducible. |

---

## 16 · Cross-team rules (PM enforcement)

1. **Gate demos run on clean staging stores by someone who didn't build the stage.** Rehearsed demos on groomed data don't count.
2. **Receipts are schema-enforced, not best-effort.** A write missing its receipt is a failed write — in every stage, forever.
3. **No stage adds a capability the authority engine can't gate.** New verb → gate-table entry + inverse (if undoable) + founder-only classification, before merge.
4. **AI evals run in CI; guardrail-breach evals are hard gates** — one breach fails the build.
5. **Scope cuts are allowed; gate cuts are not.** Shrink features and shrink the demo honestly; never weaken pass criteria.
6. **Every stage ends with a founder-visible artifact** (demo recording + the ledger export from it) filed in the project — the paper trail of "what we said vs. what we got."

**Ownership at a glance:** AI Eng owns the model contract (§13) and Stages 3–5, 7, 8's AI scope. Backend Eng owns services (§14) and Stages 0–2, 3, 6, 8's platform scope. Both share the action-API contract; neither ships around it. Design owns fidelity to the prototype. QA owns the gate scripts and the grounding/breach audits.

## 17 · Reconciliation log (what changed from the V1 Vision doc)

- **Currency:** `$` → **৳** (store-profile display currency; Dhaka in mocks).
- **Departments:** vision's top-level *Supplier Manager* and *Courier Manager* → **duties** under Operations and Shipping; canonical list is the 10 in §6.
- **Autonomy names:** mapped in §5.1 (Observe/Suggest/Draft/Operator/Acting CEO).
- **Added since vision:** doors + receipts + decision desk (the mechanics that make it auditable), H1 voice/memory/watchdog/hours-saved/tonight's plan, H2 agents/playbooks/negotiation/benchmarks.
- **Metric kept:** Business Hours Saved (§11), now ledger-computed.

## 18 · Risks & mitigations

- **Ad-platform write access narrower than assumed** → Stage 3 discovery spike week 1; fallback "propose-only Marketing" still passes the loop with founder as executor.
- **WhatsApp Business API delays** → Stage 6 cart recovery falls back to SMS/email; WhatsApp added on approval.
- **Bangla voice quality** → Stage 7 pre-gate bake-off on the existing stack; if below bar, briefing calls launch English-first with Bangla text parity.
- **Benchmark cold start** → cohort floors mean sparse early benchmarks; UI states sample size honestly; never fabricate network numbers.
- **Trust-formula ambiguity** → product decision due before Stage 2; placeholder = approvals-weighted with undo penalties, revisited with pilot data.

## 19 · North-star scene (definition of done, felt)

> A founder opens Dakio at 8:00 AM. Nova: *"Good morning. While you slept I replied to 84 customer messages, recovered 11 abandoned carts, published 2 posts, found 7 trending products, paused an underperforming campaign, adjusted prices on 14 SKUs from competitor moves, and prepared tomorrow's marketing plan. Today's focus: scale the Portable Blender campaign — if approved, I estimate +12–18% daily profit over 7 days."*

The founder's reaction isn't "useful AI feature." It's **"I don't know how I ran my business before Nova."** Every claim in that paragraph traces to a ledger receipt — that's the difference between this product and a demo.

---

*Nova × Dakio · Master Build PRD v2.0 (through H2) · One document, one team, one source of truth. We ship what passes the gate — nothing else.*
