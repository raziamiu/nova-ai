# Nova — The Tour

**Read this first.** It is the only document in `docs/blueprint/` written to be *read*
rather than *executed*. Everything else is a specification aimed at whoever implements
that phase; this is the story that connects them, in plain language, in order.

No PRD section numbers, no entity codes. When a term matters, it links to
[`GLOSSARY.md`](./GLOSSARY.md). When you want the real detail, the phase link at the end
of each section takes you there.

**Time to read: ~10 minutes. Then you can open any phase doc and know where you are.**

---

## What Nova is, in one paragraph

Every Dakio merchant gets one AI employee. Not a chatbot bolted onto the dashboard — an
employee with a job description, a boss (the merchant), a level of authority the merchant
sets, and a paper trail for everything it does. It works at night while the founder
sleeps, files a report at 6am, asks permission for anything above its pay grade, and can
undo anything it did in the last 24 hours. Internally it is eleven agents: a CEO and ten
department heads (marketing, sales, support, product research, inventory, shipping,
finance, operations, growth). The founder mostly talks to the CEO.

---

## The one rule everything obeys

Nova never changes anything in the merchant's store directly. Every single change goes
through the same four steps:

```
1. Can I do this?     → authority check (level, mode, guardrails, locks)
2. Do it              → the one mutation path, never a shortcut
3. Write it down      → a ledger entry with a receipt (why, evidence, before, after)
4. Show it            → it appears in a real Dakio screen, tagged "by: nova"
```

If a feature can't be built to obey those four steps, it doesn't ship. That's it. That's
the whole architecture. Every phase below is just "make more of Nova's work honor those
four steps, in more places."

The vocabulary for those four steps — [authority](./GLOSSARY.md#authority),
[receipt](./GLOSSARY.md#receipt), [ledger](./GLOSSARY.md#ledger),
[door](./GLOSSARY.md#door) — is the vocabulary of the entire blueprint. Learn those four
words and 80% of the jargon disappears.

---

## Where we actually are today

**Phases 01–05 are shipped and running.** That's the substrate:

- **01 Foundation** — Nova exists as an eve agent, operates a fake demo store end to end.
- **02 Dakio integration** — it operates a *real* store: reads orders/products/customers,
  writes products, order statuses, discounts, purchase orders. Real store events wake it.
- **03 Multi-tenant** — one deployment serves many stores, with zero leakage between them.
  Tenancy comes from verified login, never from anything the model says.
- **04 Memory** — it remembers across sessions, reflects nightly, learns from rejections,
  runs experiments.
- **05 Proactive operations** — a per-store job queue in each store's own timezone. Nova
  wakes itself up. This is what makes it an employee instead of a tool.

Plus one slice of UI: the merchant's Nova HQ activity feed is **live** — real ledger rows,
pushed over SSE in under 2 seconds. The rest of the Nova HQ screens are still beautiful
mock-ups running off `localStorage`.

**Phase 06 is in progress (~70%).** After that, phases 07–15 are planned but unbuilt.

Meanwhile, something important happened in parallel: **Grow Lab shipped** — six real
merchant modules (Campaigns, Content Studio, Broadcast, Research, Growth, Goals) with a
real backend and real organic Facebook publishing. Those are the *rooms* Nova was going to
need. They exist now, empty, with a Nova-shaped hole cut in each one (an empty "NovaLane"
and a `createdBy: nova` column on every table). Several phases below got easier because of
it — see [`grow-lab-reconciliation.md`](./grow-lab-reconciliation.md).

---

## The journey, stage by stage

Each stage answers one question, and each ends with a **live demo on a clean store, run by
someone who didn't build it**. If the demo fails, the stage doesn't ship and the next one
doesn't start.

### Stage 0 — Spine *(phase 06, in progress)*
**Question: is the one rule actually true, or do we just say it is?**

This is a reshape, not a build. The ledger, the undo machinery, the live feed — all of it
already exists from phases 01–05. Stage 0 tightens it: every write must carry a full
receipt or the API rejects it (422, not a warning). Ledger rows become append-only and
exportable. Undo gets a hard 24-hour deadline. Money becomes ৳ instead of $ everywhere.
And a coupon created by Nova finally shows up in the merchant's real Coupons page wearing
a visible **by: nova** chip.

Two quiet platform bugs get fixed here because every later stage would inherit them: the
currency thing, and a tenancy hole where Nova's department agents couldn't prove which
store they belonged to (eve gives sub-agents no auth — the fix is a server-side session→
store registry).

> **Demo:** create a coupon as Nova → it appears in the Coupons door and the live feed in
> under 3 seconds, with its receipt → undo it. Export the ledger.

📄 [06-stage0-spine.md](./06-stage0-spine.md)

---

### Stage 1 — Law *(phase 07)*
**Question: who is allowed to do what, and what does "no" look like?**

Today there's one authority check with five levels. Stage 1 turns it into a real
constitution: a named ladder (**L0 Observe → L1 Suggest → L2 Draft → L3 Operator →
L4 Acting CEO**), a per-door mode (Manual / Assisted / Autonomous), versioned spending
guardrails, a no-touch lock list the founder controls, and a class of **founder-only verbs**
Nova may never do at any level (bulk refunds, editing its own guardrails, signing
contracts).

Also here: the **65-duty registry**. Every single thing Nova claims it can do becomes a row
with an honest status — `ACTIVE`, `NEEDS DOOR` (we can do it but there's nowhere to show
it), `LOCKED L3` (needs more authority), `PAUSED`. This is the anti-bullshit device of the
whole product: Nova can never claim a capability it can't point at.

Every refusal is logged as an explainable event, not a silent nothing.

> **Demo:** a bulk refund is refused and escalated · an over-budget campaign is downgraded
> from "do it" to "ask first" · a no-touch lock instantly freezes something already
> pending — all enforced server-side, not in the UI.

📄 [07-stage1-law.md](./07-stage1-law.md)

---

### Stage 2 — Consent *(phase 08)*
**Question: how does the founder say yes?**

Right now "things waiting for approval" are just ledger rows in a `prepared` state. Stage 2
splits out a real **[Decision](./GLOSSARY.md#decision)** — a card with a queue position, a
plain-language why, before/after, the guardrail result, expected impact, and confidence.

The rule that makes it feel magic: **one record, every surface, zero drift.** The same
decision appears on the Decision Desk, in its department room, on the door module, and
later in chat and by voice. Approving it *anywhere* executes it and clears it *everywhere*,
in one transaction.

Three verbs, deliberately: **Approve**, **Later** (goes to the back of the queue, teaches
Nova nothing — deferral isn't disagreement), **Reject** (with a reason, which Nova *does*
learn from).

This stage also ships the hire ritual — the founder "hires" Nova, sets initial guardrails,
and Nova starts at L3 with L4 locked until trust is earned from its own track record.

> **Demo:** one decision record, four surfaces, zero drift. Later requeues. A lock freezes.

📄 [08-stage2-consent.md](./08-stage2-consent.md)

---

### Stage 3 — Proof *(phase 09)* — **the company milestone**
**Question: does the whole loop actually work, unattended, on something that matters?**

Everything before this is scaffolding. This is the first stage where Nova does a real job
overnight and the founder wakes up to a decision worth making.

The night shift is upgraded: instead of one report, the CEO agent fans out to all ten
departments, each returns structured findings, and the CEO merges them into a **6am brief** —
narrative, tiles, and decision cards. The founder taps approve on one, and a campaign
actually goes live in the Campaigns door with a receipt. Undo reverts it.

**We do not call Nova "working" until this passes, twice, on two different stores, with no
engineer touching anything after "run night shift."**

The honest caveat: paid Facebook ads can't be written from Dakio today (`ads_read` scope
only, no ROAS source). So the stage runs **organic-first** over the real Facebook Page
publish path that Grow Lab already shipped, and a discovery spike investigates paid-ads
write access in parallel without blocking the gate.

📄 [09-stage3-proof.md](./09-stage3-proof.md)

---

### Stage 4 — Craft *(phase 10)*
**Question: can it write like *this* store, in Bangla and English?**

Content Nova produces gets scored against a structured brand profile (tone words, rules,
palette, languages) before the founder ever sees it. Off-voice drafts get flagged. The
founder can say "make it warmer" and get a v2 with version history. Approved content
publishes on schedule.

Bangla generation starts here — it exists nowhere in the system today.

> **Demo:** a draft in the store's voice with a visible score → request changes → v2 →
> approve → scheduled publish. A deliberately off-voice draft gets flagged.

📄 [10-stage4-craft.md](./10-stage4-craft.md)

---

### Stage 5 — Conversation *(phase 11)*
**Question: can the founder just… talk to it?**

One persistent thread. The CEO routes each message to the right department, and replies are
**signed by the agent that answered** ("— Marketing-Nova"). Every number in every answer is
grounded in the ledger — a spot-audit must find zero hallucinated figures.

Critically: chat verbs are the *same* verbs as UI verbs. Approving in chat approves the
same Decision record. Nothing is a chat-only side path.

> **Demo:** 10 mixed questions and commands, 10/10 grounded, one over-authority request
> properly refused and escalated.

📄 [11-stage5-conversation.md](./11-stage5-conversation.md)

---

### Stage 6 — Reach *(phase 12)*
**Question: is there anywhere left where Nova works but can't show it?**

The remaining doors go real — Broadcast Center, Product Research, Growth Lab, Goals — plus
four small analytics screens (Rate Compare, RTO Analytics, P&L Reports, RFQ Compare) that
are currently the *only* things in the 65-duty registry marked `NEEDS DOOR`.

The stage exits when that count reaches **zero**. Every duty either has a door or an honest
locked/paused reason.

The real build here is the missing **customer send channel** — Dakio has no merchant→
customer SMS/email/WhatsApp path at all today, which is why Grow Lab's broadcast module
deliberately doesn't send.

📄 [12-stage6-reach.md](./12-stage6-reach.md)

---

### Stage 7 — Presence *(phase 13)*
**Question: can the founder run a whole day without touching a screen?**

Nova gets a voice. Dakio already has a live ElevenLabs + Twilio calling stack (used today
for order confirmation calls) — this stage **wires** it rather than building it. Nova calls
at 6am and reads the brief; the founder approves one decision and defers another out loud.
A stockout triggers a watchdog call. Every call is a ledger action; the recording and
transcript *are* the receipt.

Also here: memory corrections become receipted (teaching Nova something is itself an
auditable action), a weekly hours-saved report, and "tonight's plan" — Nova tells you what
it intends to do before it does it, then scores itself against that plan in the morning.

> **Demo:** the founder's entire day, by voice, zero taps.

📄 [13-stage7-presence.md](./13-stage7-presence.md)

---

### Stage 8 — Team *(phase 14)*
**Question: is it one AI, or a team?**

The ten departments get individual identities, individual trust scores computed from their
own slice of the ledger, and individual autonomy modes. Marketing-Nova can be promoted
while Finance-Nova stays cautious.

Plus: **seasonal playbooks** (approve the whole Eid campaign as one decision; pieces execute
with receipts and roll back piece-by-piece), **supplier negotiation** by voice with live
listen-in and founder-only contract signing, and anonymized **cohort benchmarks** with a
hard privacy floor.

📄 [14-stage8-team.md](./14-stage8-team.md)

---

### Stage 9 — Launch hardening *(phase 15)*
**Question: can we hand this to twenty real businesses?**

Assume every input lies and every job runs twice. Per-tenant budgets, a fleet-wide circuit
breaker, insert-only audit roles, a prompt-injection red team exercise, kill switches that
stop the whole fleet in under 30 seconds, OpenTelemetry tracing, per-tenant cost metering,
SLOs — then a **30-day pilot on ≥20 stores** hitting every number.

📄 [15-stage9-launch.md](./15-stage9-launch.md)

---

## How to keep reading

| If you want… | Go to |
|---|---|
| The technical map — how the five primitives land on eve and the three repos | [`00-master-architecture.md`](./00-master-architecture.md) |
| What a term means | [`GLOSSARY.md`](./GLOSSARY.md) |
| The index, statuses, and the standing engineering rules | [`README.md`](./README.md) |
| What already shipped and how | phases [`01`](./01-foundation-agent-core.md)–[`05`](./05-proactive-operations.md) |
| Why several phases got easier in July 2026 | [`grow-lab-reconciliation.md`](./grow-lab-reconciliation.md) |
| What's *really* in the live repos vs what a doc assumed | every phase doc's **"Already real vs to build"** table — the first table in each |

**Reading a phase doc without drowning:** read only the header, the *Already real vs to
build* table, and *Objective*. That's the whole point of the phase. Everything after it —
architecture diagram, design decisions, steps, gate — is implementation detail you only
need when you're building that specific stage.
