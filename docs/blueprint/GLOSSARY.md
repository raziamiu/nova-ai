# Nova Glossary — decoder ring

Every phase doc is written in shorthand: `E-8`, `§16.3`, `FR-2.4`, `L3`, "door",
"NEEDS DOOR", "the one rule". This page decodes all of it so you don't have to jump files
mid-sentence.

New here? Read [`TOUR.md`](./TOUR.md) first — it's the narrative. This is the dictionary.

---

## The five words that carry everything

Learn these and most of the jargon stops mattering.

### Duty
<a id="duty"></a>
One specific job Nova claims it can do — "reply to comments on ads", "flag slow-moving
stock". There are **65**, split across the 10 departments, and each one must point at a
**door**. Every duty carries an honest status, which is the product's anti-bullshit device:

| Status | Meaning |
|---|---|
| `ACTIVE` | Nova does this today, and you can see the output somewhere real |
| `NEEDS DOOR` | Nova can do it, but there's no screen to show it — so it doesn't count |
| `LOCKED Lx` | Needs more authority than the founder has granted |
| `PAUSED` | Founder switched it off |

Built in phase 07. Registry lives in `agent/lib/duties.ts` + a `NovaDuty` table.

### Door
<a id="door"></a>
The real Dakio screen where Nova's work lands, tagged **`by: nova`**. Not a Nova-only
inbox — the *actual* Coupons page, the *actual* Campaigns module. The rule is: if the
founder can't find the work in the product they already use, Nova didn't really do it.

Ten doors exist as merchant modules. Six of them shipped as **Grow Lab** in July 2026
(Campaigns, Content Studio, Broadcast, Research, Growth, Goals) with an empty **NovaLane**
in each, waiting to be wired. Four small analytics doors are still unbuilt and are the only
remaining `NEEDS DOOR` entries.

### Receipt
<a id="receipt"></a>
The proof attached to every single write Nova makes:

```
receipt {
  reason           — why, in plain language
  evidence[]       — what data led here
  before / after   — exact state change
  confidence       — how sure
  expected_impact  — what it should achieve
}
```

**A write without a receipt is a failed write** — the API returns 422. Not a lint rule, not
model goodwill. Enforced in dakio-api from phase 06.

### Ledger
<a id="ledger"></a>
The append-only record of everything Nova ever did: `NovaAction` (the action + receipt +
undo deadline) and `NovaActivity` (the human-readable feed line). Live in Dakio's Postgres
since phase 02. Exportable as NDJSON. Rows can never be edited or deleted — only new rows
with allowed status transitions.

Every number Nova ever states in chat, a brief, or a call must be traceable to this. That's
what "grounded" means throughout the docs.

### Authority
<a id="authority"></a>
The single server-side check every action passes before execution:

```
level × mode × guardrails × no-touch locks × founder-only verbs × per-duty minimum
```

A refusal is never silence — it's a logged, explainable, founder-visible event, usually
escalated as a card. See [ladder](#the-authority-ladder-l0l4) below.

---

## The authority ladder (L0–L4)

Set by the founder. Named in phase 07 (before that, the shipped code just used 0–4).

| | Name | Nova may… |
|---|---|---|
| **L0** | Observe | watch and report only |
| **L1** | Suggest | propose ideas |
| **L2** | Draft | prepare complete work, execute nothing |
| **L3** | Operator | execute inside guardrails, ask for anything above them |
| **L4** | Acting CEO | broad execution — but never founder-only verbs |

**Default at hire is L3**, with L4 locked behind an **earned level** computed from Nova's
own ledger track record. Caution lives in earned levels, not in a timid default.

**Mode** is a separate axis, set per door (and per agent in phase 14):
**Manual** / **Assisted** (default) / **Autonomous**.

**Founder-only verbs** are forbidden at every level, forever: bulk refunds, editing
guardrails, accepting a promotion offer, signing contracts.

**No-touch lock:** a founder-defined list ("never touch the Eid collection"). Locking
something instantly freezes anything already pending that matches.

---

## Decision
<a id="decision"></a>
A card asking the founder for consent. Split out of the ledger into its own record in phase
08. Three verbs:

- **Approve** — executes the linked action, everywhere, in one transaction
- **Later** — back of the queue, writes **nothing** to memory (deferral ≠ disagreement)
- **Reject(reason)** — Nova *does* learn from this

The design promise is **one record, every surface, zero drift** — the same decision renders
on the Decision Desk, its department room, its door, chat, and voice. Approve it anywhere,
it clears everywhere.

---

## Entity codes (E-1 … E-22)

The PRD's 22 data entities. Phase docs cite them constantly.

| Code | Entity | Lands in |
|---|---|---|
| E-1 | NovaInstance — the hired employee: level, earned level, trust, status line | shipped / 07–08 |
| E-2 | Guardrails — versioned spend caps, max discount, no-touch list | 07 |
| E-3 | AgentMode — Manual/Assisted/Autonomous, per door or agent | 07 |
| E-4 | Department — the 10, with grades | 09 |
| E-5 | Duty — the 65 | 07 |
| E-6 | ScoreMetric — how a department grade was computed | 09 |
| E-7 | PlanItem — a line on the night-shift plan board | 09 |
| E-8 | **Action (ledger)** — the action + [receipt](#receipt) + undo window | shipped, reshaped in 06 |
| E-9 | **Decision** — the consent card | 08 |
| E-10 | Campaign | 09 (extends Grow Lab's `GrowCampaign`) |
| E-11 | ContentItem — 8 content types + versions | 10 (extends `GrowPost`) |
| E-12 | BrandProfile — structured tone/rules/languages | 10 |
| E-13 | Broadcast + segments | 12 (extends `GrowBroadcast`) |
| E-14 | ResearchCandidate | 12 (extends `GrowIdea`) |
| E-15 | Experiment | shipped (04), extended in 12 |
| E-16 | Goal / Brief / Chat message+thread | 09 (brief), 11 (chat), 12 (goal) |
| E-17 | CallSession | 13 |
| E-18 | Memory | shipped (04), receipted corrections in 13 |
| E-19 | Playbook — seasonal bundles (Eid, Boishakh, 11.11) | 14 |
| E-20 | NegotiationSession | 14 |
| E-21 | Benchmark — anonymized cohort stats | 14 |
| E-22 | AgentInstance — per-agent identity, trust, mode | 14 |

> **Name collision, resolved:** the shipped `NovaPlaybook` table held *procedural skill
> promotions*, not seasonal bundles. It was renamed **`NovaRoutine`** in phase 06 so E-19
> could take the "Playbook" name.

---

## Requirement codes (FR-1 … FR-10)

The PRD's surface requirements — what the founder sees.

| Code | Surface |
|---|---|
| FR-1 | Hire & onboarding |
| FR-2 | Nova HQ (the dashboard, incl. the 6am brief) |
| FR-3 | Decision desk |
| FR-4 | Authority UI |
| FR-5 | Department rooms (×10) |
| FR-6 | Doors / Nova modules |
| FR-7 | Nova chat — one thread, agent-routed |
| FR-8 | Mobile companion |
| FR-9 | Nova Voice (H1) |
| FR-10 | The team & network (H2) |

## PRD section numbers (§)

`§n` always means a section of `docs/prd/PRD - Nova Master Build.md`. The ones cited most:

| § | What's there |
|---|---|
| §3 | **the one rule that never bends** |
| §4 | the five load-bearing concepts |
| §5 | authority model |
| §6 | the org — 10 departments, 65 duties, 11 agents |
| §9 | daily workflow / the night shift |
| §11 | trust system & success metric |
| §12 | the 22-entity data model |
| §13 | AI operator contract (the authoring rules for decisions) |
| §14 | backend readiness matrix — **partly wrong**, corrected in `00-master-architecture.md` §12 |
| §15 | the staged delivery plan + every stage's gate demo |
| §16 | cross-team rules — §16.2 receipts, §16.3 new-verb checklist, §16.4 breach evals as CI gates |
| §18 | risks & open spikes (paid-ads write scope, Bangla voice, trust formula) |

---

## Structural terms

**Stage vs phase.** The PRD ships in **Stages 0–9**. The blueprint implements them as
**phases 06–15**, one per stage. Phases 01–05 predate the Master Build PRD and are shipped
history. So: *Stage 3 = phase 09*, always.

**Gate demo.** Every phase ends with a scripted demo from PRD §15, on a **clean staging
store**, run by **someone who didn't build the stage**, with zero manual DB pokes, filed as
an artifact (recording + the ledger export from that run). Scope cuts are allowed; gate
cuts never are.

**"Already real vs to build."** The first table in every phase doc. Left column = what a
repo audit actually found in the code today (with file paths). Right column = what the
phase adds. It exists because the PRD was written against Dakio's pre-existing systems and
got several readiness verdicts wrong — the tables are ground truth and win any conflict.

**Night shift.** Nova's unattended overnight run: per-department analysis → in-guardrail
actions with receipts → over-authority proposals as decisions → the 6am brief.

**Brief.** The 6am report. Narrative + tiles + the decisions waiting.

**Door registry / presence markers / by:nova chip.** The plumbing that makes Nova's work
visible in Dakio's own navigation: which module key maps to which merchant route, the
pending-count badges, and the visible attribution chip on rows Nova created.

**The 4 sub-view doors.** Rate Compare, RTO Analytics, P&L Reports, RFQ Compare — the only
screens still marked `NEEDS DOOR`. Cleared in phase 12.

---

## Platform / framework terms

**eve.** The agent framework Nova is built on (`defineAgent` / `defineTool` /
`defineSchedule` / `defineDynamic`). Gives durable sessions, streaming, subagents, tool
approval. Notably does **not** give: per-tenant scheduling, cross-session memory, per-tenant
metering, or auth inside subagent sessions — all four are built on top. See
`00-master-architecture.md` §9 for the full capability verdict table.

**Subagent.** A declared department agent. Inherits **nothing** from root — tools are
re-exported, procedures live in `lib/`, guardrails are re-declared per directory. Delegation
is not a security boundary. And `ctx.session.auth` is **null** inside one, which is why
phase 06 adds a server-side session→tenant registry.

**CEO-Nova.** The root agent. Owns the founder conversation, routes to departments, merges
the night shift. The old separate `ceo` subagent folds into root in phase 07.

**StoreClient.** The *only* path to store data. Two implementations: `DemoStore` (in-memory,
the default) and `DakioStoreClient` (live HTTP against dakio-api). Tools never touch HTTP or
storage directly — this is standing rule #2.

**Dispatcher.** The single authored eve schedule, running every minute. Loops active
tenants and claims their due `NovaJob`s through each tenant's own service token. Replaced
six static UTC crons in phase 05.

**NovaJob / NovaInbox.** The per-tenant, timezone-aware job queue (leased, fenced), and the
event inbox Dakio mutations write into (~20 call sites) which drains into jobs.

**Feed bus / SSE.** In-process per-tenant pub/sub in dakio-api pushing ledger and decision
events to the merchant UI in under 3 seconds. Becomes Postgres LISTEN/NOTIFY at phase 15.

**Grow Lab.** The six live merchant modules under `/api/grow` that turned out to *be* the
PRD's doors. Every Grow table has a `createdBy: 'founder' | 'nova'` column and every Grow
room renders an empty **NovaLane** — the seams are pre-cut, nothing crosses them yet. See
[`grow-lab-reconciliation.md`](./grow-lab-reconciliation.md).

**৳ / minor units.** Money is BDT, stored in minor units, formatted with lakh grouping.
The old `usd()` helper became `money()` in phase 06. Load-bearing, not cosmetic — the
guardrail numbers are ৳-denominated.
