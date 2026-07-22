# Phase 11 — Stage 5 "Conversation": The Chat Agent

**PRD stage:** Stage 5 (PRD §15) · **Prereqs:** 07 (authority/no-touch verbs), 08
(decision verbs), 09 (grades/rooms — "explain grade" needs persisted metrics), 10
(content review verbs referenced in options). Owner: AI Engineering. Self-contained.
One persistent, agent-signed chat thread everywhere — CEO-Nova routes, department
agents answer, every number is grounded in the ledger, and chat verbs are the same
primitives as UI verbs (FR-7).

## Already real vs to build

| Capability | Today (repo audit) | This phase |
|---|---|---|
| Chat substrate | REAL — eve durable sessions + NDJSON streaming; `channels/eve.ts` Dakio-JWT auth + L4 `x-dakio-client-context`; root→10-subagent delegation | Router identity, thread abstraction, UI wiring |
| Merchant chat UI | MOCK — `NovaChat` dock with scripted `buildChatReply` router, fake agent signatures, option chips, mock undo | Wire to real eve stream; delete the script |
| Agent-signed replies | none (subagent outputs merge into root prose) | `NovaChatMessage` (E-16) with `agent_id`; signature rendering |
| Persistent thread | old-06 design was session-per-day (conflict) | `NovaChatThread` abstraction over rotated eve sessions (canon §4.12) |
| Intents | execute/approve/memory tools exist; no-touch tool (07); decision verbs (08) | Full FR-7 intent surface + option-chip decisions + delegation-to-job + grounding audit |
| Subagent tenancy | 06 registry + `requireStore` lineage fallback | consumed here at scale (every routed reply) |

## Objective

PRD Stage 5 gate: 10 mixed asks/commands live — every answer grounded, every action
receipted, one over-authority ask refused + escalated — 10/10, with zero hallucinated
numbers under spot-audit against the ledger.

## Scope

**In:** CEO-Nova router (root agent identity + routing contract + `disableTool()` on the
built-in `agent`); agent-signed persisted `NovaChatMessage`s; `NovaChatThread` (one
thread per store, sessions rotated beneath it); adaptive context chips (L4 extension);
FR-7 intents shipping now: explain grade (+E-6 receipt), report metrics, execute + 24h
undo, propose options → approving executes linked decisions, guardrail refusal +
escalation card, set no-touch lock, free delegation → queued task; forward-compat
refusal stubs for H2 intents (playbook approve, negotiation status/listen-in,
benchmarks, promote agent — honest "arrives with the Team stage" replies routed through
the same intent table); merchant chat wiring (stream reducer, `input.requested`,
token persistence/recovery); grounding audit harness + the 10-intent scripted gate.
**Out:** voice approvals (13 — same decision records by design); H2 intents' real
implementations (14); mobile chat surface (13, same APIs).

## System architecture

```
merchant NovaChat ── POST /api/nova/chat (BFF attaches JWT + clientContext) ─► eve channel
   │ GET /eve/v1/session/:id/stream (browser direct, JWT)                        │
   ▼                                                                             ▼
NovaChatThread (store-scoped)                                    root session = CEO-Nova
   ├─ messages: NovaChatMessage (role, agent_id, receipt?,          ├─ route: dept subagent (typed reply envelope)
   │            stats?, options[]?, action_ref?)                    ├─ answer self (quick lookups)
   └─ sessions: [{sessionId, continuationToken, status}]            └─ tools: SAME primitives as UI verbs
                                                                        (decisions 08 · authority 07 · memory 04 · jobs 05)
grounding: every numeric claim carries a stat ref {tool, query, value} → audit harness re-runs → match?
```

## Design decisions

1. **Root = CEO-Nova; routing is the root's only job on department questions.** Root
   instructions (07 merged the `ceo` dir in) gain the routing contract: match intent →
   delegate to the department subagent whose `description` covers it, with a **typed
   reply envelope** `outputSchema: {agentId, text, stats[], optionRefs[], actionRef?}` —
   the signature is data, not prose convention. Quick founder lookups (snapshot, one
   metric) the root answers itself, signed `ceo`. The built-in `agent` self-copy tool is
   **disabled** (`agent/tools/agent.ts` → `disableTool()`) so delegation always flows
   through the 10 named departments (PRD's 11-agent org, mechanically enforced).
2. **One thread, rotated sessions (canon §4.12 — resolves old-06 vs FR-7).** eve
   sessions are finite (compaction, cost); the founder's thread is not. `NovaChatThread`
   (one per store) maps messages to whichever eve session carried them; rotation on
   `session.completed`/compaction-pressure/7-day age. Continuity across rotation =
   memory (04) + L1–L3 context + a rolling thread summary injected on `session.started`
   of the successor. Tokens: server persists `{threadId → active sessionId,
   continuationToken}`; recovery via stream `startIndex:-1` (old-06 salvage).
3. **Every message persists with its evidence (E-16 ChatMessage).** Assistant messages
   store `agent_id`, optional `receipt` (action ref), `stats[]` (grounding refs:
   `{label, value, source: {tool, params}}`), `options[]` (each = a decision ref —
   choosing one approves that decision through 08, nothing bespoke), `action_ref`.
   The UI renders signatures, receipts, and option chips from THESE rows — the mock
   `buildChatReply` shapes were the design spec; now they're real columns.
4. **Grounding is an auditable contract, not a vibe (§13 chat row, Stage 5 gate).**
   Persona + reply envelope require: any numeric claim must carry a `stats[]` ref
   naming the tool + params that produced it. The **audit harness**
   (`evals/conversation/audit.ts`) re-executes each ref against the same store and
   diffs values (tolerance for time-moving metrics) — the "spot-audited vs ledger"
   gate step, automated. Unattributed numbers fail the eval.
5. **Intents are a table, not a vibe.** `agent/lib/chat/intents.ts` enumerates FR-7
   intents → owning department + primitive verbs; the router prompt is generated from
   it, and H2 intents ship as honest refusals ("Negotiation arrives with the Team
   stage") from the same table — adding Stage 8 fills rows, no router rewrite.
   Free delegation ("find me a cheaper courier") → `delegate_task` tool → NovaJob
   (kind `founder_task`, 05 infra) + PlanItem `SCHEDULED` + confirmation with the job
   ref — the FR-7 "queued task" contract.
6. **Chips are contextual verbs, not canned FAQs.** L4 already carries page/entity;
   the thread API returns `chips[]` computed from live state (pending decisions count,
   flagged content, page context) — e.g. viewing a bleeding campaign yields "why is
   this down?" / "pause it". Chips are suggestions only; they submit ordinary messages.
7. **Refusal UX completes the 07 loop.** Over-authority ask → `evaluateAuthority`
   refusal → reply names the rule + an **escalation decision card** ref (08) inline —
   the gate's "one refused + escalated" step, same records as every other surface.

## EVE features to use (exact surface)

- `disableTool()` from `"eve/tools"` at `agent/tools/agent.ts` (root-only built-in
  removal — subagents never had it).
- Subagent delegation with `outputSchema` (typed reply envelope) — same surface as 09.
- Stream events consumed by the UI (old-06 table, verified against current docs):
  `message.appended` deltas · multiple `message.completed` per turn (narration around
  tool calls — render by `finishReason`) · `actions.requested`/`action.result` (activity
  indicators: "Marketing-Nova is checking ads…" from `subagent.called`) ·
  `input.requested` → `inputResponses: [{requestId, optionId}]` (used by
  `configure_autonomy`'s interactive gate) · `session.waiting` (persist fresh
  `continuationToken` — stale tokens are rejected) · `turn.failed`/`session.failed`.
- `subagent.called`/`subagent.completed` control events drive the "which agent is
  working" indicator; `authorization.required` proxying surfaces subagent-raised
  approvals on the root stream.
- Session ownership: eve does NOT ACL sessions — the shipped tenant-pinning hook +
  thread-table session binding are the enforcement (06/03).

## External services

None new.

## Data models

```prisma
model NovaChatThread {
  tenantId String @id                       // one persistent thread per store (FR-7)
  activeSessionId String?; continuationToken String?
  summary String?                           // rolling context for session rotation
  rotatedAt DateTime?; createdAt DateTime; updatedAt DateTime
}
model NovaChatMessage {                     // E-16 ChatMessage
  id String @id @default(cuid()); tenantId String
  role String                               // founder | agent
  agentId String?                           // ceo|marketing|…  (signature)
  text String
  stats Json?                               // [{label, value, source:{tool, params}}] — grounding refs
  receipt Json?; actionRef String?; options Json?   // [{decisionRef, label}]
  sessionId String; turnId String?
  createdAt DateTime
  @@index([tenantId, createdAt])
}
```

## APIs & interfaces

Merchant JWT: `GET /api/nova/chat/thread?cursor=` (messages + chips) ·
`POST /api/nova/chat` (message; BFF creates/continues the eve session with JWT +
`x-dakio-client-context`, returns sessionId for the browser's direct stream attach) ·
`POST /api/nova/chat/rotate` (internal, on session end). Browser consumes the eve
stream directly with the merchant JWT (BFF never proxies streams — old-06 rule).
nova-ai: routing contract in root instructions; `intents.ts`; `delegate_task` tool;
reply-envelope schemas; message persistence via a `turn.completed` hook on root
(+ shared tool-code fallback for subagent-authored actions — parent hooks don't see
subagent turns, canon §4.5, so the envelope returns to root which persists).
Chips endpoint composes from decisions/content/page state. All strings bn+en; the
thread accepts Bangla input (persona already bilingual from 06/10 work).

## Implementation steps

1. Thread + message models/APIs; message persistence hook + envelope plumbing.
2. Router: intent table, routing contract in root instructions, `disableTool` on
   `agent`, typed envelopes across the 9 dept subagents, H2 refusal rows.
3. Intents: explain-grade (reads E-4/E-6 + cites), metrics (stats refs), execute+undo
   (24h window messaging), options→decisions, refusal+escalation inline card, no-touch
   via `set_no_touch_lock`, `delegate_task`→NovaJob+PlanItem.
4. Chips computation + L4 extension.
5. Merchant wiring: stream reducer package (fixture-tested, old-06 salvage), NovaChat
   dock → real thread APIs + stream; delete `buildChatReply` + mock chat state.
6. Grounding audit harness + 10-intent eval corpus (incl. bn asks) + gate script.
7. Staging demo by non-builder; artifacts.

## Dependencies

07/08/09 shipped (verbs + persisted grades). 10 for content-review option refs (soft —
intent degrades to "no drafts pending"). Thread UX copy (bn+en) from design.

## Risks & trade-offs

| Risk | Mitigation |
|---|---|
| Router misroutes → wrong-department answers | intent table generates the prompt; routing eval per intent row; misroute = eval failure, not vibes |
| Session rotation loses context mid-conversation | rolling summary + L1-L3 injection; rotation only at turn boundaries; eval: cross-rotation follow-up answers correctly |
| Grounding refs bloat replies | stats[] persisted, UI renders footnote-style; envelope caps stats at 8/message |
| Multiple message.completed frames break UI | shared stream-reducer with recorded NDJSON fixtures (old-06 mitigation, kept) |
| Subagent latency makes chat feel slow | root answers quick lookups itself; `subagent.called` indicators; department calls stream progress |
| Hook-based persistence misses subagent detail | envelopes return through root (single persistence point); action receipts already persist via pipeline regardless |
| Stale continuationToken on approval chips | tokens re-read from latest `session.waiting`; 409-refetch pattern (08) on decision verbs |

## Testing strategy

Evals (the core of this phase, CI): 10-intent corpus ×2 languages — each asserts routed
department (`subagent.called`), signature, grounded stats (audit harness re-run), and
receipts on actions; over-authority ask asserts refusal rule + escalation card; H2
intents assert honest deferral. Stream-reducer unit tests on fixtures. Integration:
thread rotation, token recovery, message persistence, chips. Prior suites green.
Grounding audit run counts as the "spot-audited" gate evidence.

## Performance

First-token p95 < 3.5s (08's SLO preview): root-answered lookups skip delegation;
context layers cached (03); envelope schema keeps subagent outputs small. Thread reads
cursor-paged.

## Security

Session ownership enforced by pinning hook + thread binding (eve doesn't ACL sessions).
Trust-plane verbs keep owner-role checks in chat exactly as in UI (03/08). Founder text
and page context are data in prompts; option execution only through decision refs the
server authored (a hallucinated optionId matches nothing). Envelope `agentId` is
validated against `NOVA_DEPARTMENTS` before persistence.

## Success & exit criteria

**PRD §15 Stage 5 gate (verbatim):** *10 mixed asks/commands live: every answer
grounded, every action receipted, one over-authority ask refused + escalated. 10/10,
no hallucinated numbers (spot-audited vs ledger).* Audit harness output is the
spot-audit artifact.
**Standing gates** + **§16 discipline** (clean staging store, non-builder, recording +
ledger export + audit report filed).
**Phase-specific:** every assistant message persisted with agentId + grounding refs ·
mock chat script deleted · thread survives session rotation in the demo · H2 intents
answer honestly · bn asks pass the same corpus.

## Deliverables

Thread/message models + APIs; router + intent table + typed envelopes + `disableTool`;
FR-7 intent implementations + chips; merchant chat wiring + stream reducer; grounding
audit harness + eval corpus (bn+en); gate script + artifacts; capability report
`phase-11-stage5-conversation.md` + matrix updates.
