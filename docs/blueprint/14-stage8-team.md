# Phase 14 — Stage 8 "Team" (H2): Agents, Playbooks, Negotiation, Benchmarks

**PRD stage:** Stage 8 (PRD §15) · **Prereqs:** 08 (bundle_ref reserved, promotion
verb), 09 (typed dept outputs, grades), 12 (RFQ Compare door, broadcasts for playbook
pieces), 13 (voice stack, watchdog ladder). Owners: AI + Backend. Self-contained.
Nova becomes a team: 10 named department agents + CEO-Nova with per-agent trust and
mode, seasonal playbooks approved as one decision, voice negotiation with founder-only
signing, and privacy-floored network benchmarks.

## Already real vs to build

| Capability | Today | This phase |
|---|---|---|
| Department execution | REAL — 10 subagent dirs (07 canonical org), typed night outputs (09), one ledger binds all (`department` on every action) | Agent IDENTITY: `NovaAgentInstance` (E-22), per-agent trust from own ledger slice, per-agent mode, board chips + agent bars |
| Promotion | `promotion_accept` founder-only verb classified (07); store-level promotion offers (08) | Per-agent promotion via chat with undo (FR-10.1/FR-7) |
| Playbooks | `NovaRoutine` = procedural skills (renamed 06); `bundle_ref` schema on decisions (08); merchant Eid playbook card MOCK | E-19 `NovaSeasonalPlaybook` + bundle executor + piece-wise rollback + seasonal calendar |
| Negotiation | `switch_supplier` verb + supplier reads; RFQ Compare door (12); Pathao negotiation card MOCK | E-20 `NovaNegotiation`: RFQ rounds, offer strategy, negotiation calls (FR-9.4) + live listen-in, founder-only signing |
| Benchmarks | NOTHING (mock BenchmarksPanel) | E-21 `NovaBenchmark`: anonymized aggregation, cohort privacy floor, feeds grades/suggestions/playbook timing |
| Chat H2 intents | Honest refusal stubs (11's intent table) | Real: promote agent, playbook approve, negotiation status/listen-in, benchmarks |

## Objective

PRD Stage 8 gate: promote Marketing-Nova in chat (undo works); one-tap approve the Eid
playbook and watch pieces execute with receipts; listen in on a negotiation round and
sign by voice; view cohort benchmarks — plus a signed-off privacy audit.

## Scope

**In:** E-22 agent instances + per-agent trust/mode + surfaces (board chips, agent
bars, "reports to CEO-Nova"); mode-change immediate effect on that agent's pending
decisions (§5.2); promote/demote with undo; E-19 playbook engine (bundle decision,
piece-by-piece executor + rollback, ≥3-week lead, seasonal calendar: Eid, Boishakh,
11.11); E-20 negotiation engine (RFQ rounds vs benchmark, offer strategy in guardrails,
negotiation calls on 13's stack, live listen-in, transcript+terms receipt, founder-only
`contract_sign`); E-21 benchmark pipeline (nightly anonymized aggregation, cohorting,
privacy floor, honest sample sizes, injection into grades/suggestions/playbook timing);
H2 chat intents filled in 11's table; CEO-Nova weekly merge of per-agent memos (09
extension); per-agent weekly memos; privacy audit.
**Out:** GA hardening/SLOs (15); cross-tenant learning beyond aggregates (never —
privacy rule); additional seasons beyond the calendar seed.

## System architecture

```
NovaAgentInstance (E-22): marketing…growth + ceo ── trust = f(own ledger slice) · mode (E-3 scope agent:<dept>)
   └─ authority: evaluateAuthority mode resolution order becomes agent → door → store (07 seam, one change)

playbook engine: benchmarks + history + calendar ─► CEO authors NovaSeasonalPlaybook (≥3wk ahead)
   items[]: campaigns (09) · POs (02) · content (10) · broadcasts (12)
   └─► ONE bundle decision (08 bundle_ref) ─ approve ─► executor: per-piece
        sequential execute → per-piece receipts → progress; piece failure → halt + decision
        rollback: reverse-order engineered inverses for executed pieces (06 undo registry)

negotiation: RFQ (target from benchmark + margin goal) ─► rounds[] via supplier channel
   voice rounds = NovaCallSession kind:negotiation (13) ─ founder live-listen (join stream)
   agreed terms ─► decision (verb contract_sign — founder-only, voice signing via 13's
   confirmation gate) ─► PO/supplier-switch executes on approval

benchmarks (nightly fleet job, service-side — not per-tenant sessions):
   per-metric aggregate over consenting tenants → cohort(size ≥ FLOOR) → NovaBenchmark rows
   → grades context (09), research/goal suggestions (12), playbook timing
```

## Design decisions

1. **Agents are rows, execution stays subagents (E-22).** `NovaAgentInstance` adds
   identity/trust/mode per department — it does NOT change the execution topology
   (eve subagents, 07 org). Per-agent trust = 08's `computeTrust` over the agent's
   ledger slice (`department` filter — the column shipped in Phase 01 makes "own
   slice" free). One ledger, one desk, one no-touch list still bind all (FR-10.1):
   agents have no private queues or locks.
2. **Mode resolution gains one tier, the seam stays (§5.2).** `evaluateAuthority`
   resolution order: `agent:<dept>` → `door:<module>` → `store` → assisted. A mode
   change re-evaluates that agent's pending decisions in one transaction (promote
   Marketing-Nova to autonomous ⇒ its queued drafts within guardrails execute,
   receipted; demote ⇒ nothing retroactive, future verdicts change). That transaction
   IS the promotion's undo target.
3. **Promotion is a decision with an engineered inverse (FR-7).** `promote_agent`
   chat intent → decision (verb `promotion_accept`, founder-only — 07 classification
   finally executes) → approve applies the mode/trust-threshold change + re-evaluation;
   **undo** (24h window, 06) restores prior mode AND re-queues decisions that
   auto-executed under the promotion, undoing those still inside their own undo windows
   (documented limit: pieces past their window stay executed — stated in the undo
   receipt).
4. **Playbooks are bundles of existing verbs — nothing new executes (E-19, FR-10.2).**
   Items reference draft artifacts built by their own phases (campaign drafts, PO
   payloads, content items, broadcast drafts). The bundle executor walks `items[]`
   sequentially through `performAction` — per-piece receipts, `progress` on the
   playbook, halt-on-failure with an escalation decision. Rollback = reverse-order
   undo of executed pieces via the 06 inverse registry (pieces with `undoable:false`
   — e.g. sent broadcasts — halt rollback with an honest partial-rollback receipt).
   One approval runs the month; every step remains individually receipted (§15 gate).
   ≥3-week lead enforced at authoring (calendar seed: Eid, Boishakh, 11.11 + windows).
5. **Negotiation never signs (E-20, §5.4).** The engine runs rounds (offer strategy:
   target from benchmark × margin goal, concession ladder within guardrail bounds —
   deterministic strategy table, model drafts the language); each round is a message
   or a `kind:negotiation` call (13). Live listen-in = founder joins the call's
   transcript SSE stream (+ Twilio conference bridge where supported). Final terms
   land as a `contract_sign` decision — founder-only, approvable by tap or by voice
   through 13's confirmation gate. The signed decision's action executes the PO /
   supplier switch. Transcript + terms are the receipt (FR-10.3).
6. **Benchmarks are aggregates-only with a hard floor (E-21, FR-10.4, §18).** Nightly
   service-side job (not model, not per-tenant sessions): metric extractors (WhatsApp/
   SMS recovery rate, ROAS, courier rates by region, seasonal timing curves) → cohort
   keys (vertical × size band × region) → aggregate only where cohort size ≥ **20**
   (floor constant, privacy-audited); below floor ⇒ no row (never padded). Store reads
   return network value + own value + `sample_size` honestly (cold-start rule: UI
   states n; never fabricate). Raw cross-tenant values never leave the aggregation job;
   no per-store data in any other tenant's context, ever. Consent: benchmark
   participation is a tenant flag (default on, disclosed); non-participants neither
   contribute nor read.
7. **CEO-Nova earns the title (FR-10.1).** Weekly: CEO merges per-agent memos (09's
   typed outputs) into the strategy review; board renders per-agent chips (trust %,
   mode, coverage fraction from 07 rollups); rooms get agent bars ("reports to
   CEO-Nova"). Chat replies were agent-signed since 11 — the identity rows now carry
   real trust numbers.

## EVE features to use (exact surface)

- **`Workflow` tool (root-only, `experimental_workflow()`)** enabled for the CEO in
  bounded contexts: playbook authoring (fan out per-item drafting to departments,
  `maxSubagents` as cost cap) and the weekly merge — programmatic fan-out with
  approval-safety; children never see `Workflow` (no recursion). Deterministic fleet
  work (benchmark aggregation) stays OUTSIDE the model in service jobs (canon:
  dispatcher/service for deterministic fan-out).
- Subagent `outputSchema` (09) for memo/round-strategy returns.
- 13's call stack for negotiation calls (`kind:'negotiation'`, listen-in over the
  transcript SSE; voice signing through the confirmation-phrase gate).
- Dynamic skills (`defineDynamic` + `defineSkill`, session.started keyed on tenant):
  serve the ACTIVE seasonal playbook's procedure/checklist as a per-tenant skill
  during its window — the eve-native per-tenant playbook mechanism (canon §4.9).
- No new channels; benchmark job is dakio-api service code.

## External services

Twilio conference (listen-in bridge) — optional, transcript-stream listen-in is the
floor. Supplier contact channels: email/SMS via 12's adapter (WhatsApp when approved).

## Data models

```prisma
model NovaAgentInstance {              // E-22
  tenantId String; department String   // + 'ceo'
  name String                          // "Marketing-Nova" (bn variant in prefs)
  trustScore Decimal?; trustInputs Json?
  mode String @default("assisted")     // resolution tier agent:<dept> (E-3 scope)
  reportsTo String @default("ceo")
  promotedAt DateTime?; createdAt DateTime; updatedAt DateTime
  @@unique([tenantId, department]) }
model NovaSeasonalPlaybook {           // E-19
  id String @id @default(cuid()); tenantId String
  season String; window Json           // {start, end}
  items Json                           // [{kind: campaign|po|content|broadcast, ref, status, actionRef?, order}]
  status String                        // proposed|approved|running|done|halted|rolled_back
  decisionRef String?; progress Int @default(0)
  benchmarkRefs Json; createdAt DateTime; updatedAt DateTime; deletedAt DateTime? }
model NovaNegotiation {                // E-20
  id String @id @default(cuid()); tenantId String
  counterparty String; subject String
  rounds Json                          // [{offerMinor, direction, ts, channel, callRef?}]
  targetMinor BigInt; benchmarkRef String?
  callRefs Json; finalTerms Json?
  decisionRef String?                  // contract_sign decision
  status String                        // open|agreed|signed|declined|abandoned
  createdAt DateTime; updatedAt DateTime; deletedAt DateTime? }
model NovaBenchmark {                  // E-21 — aggregates only; written by the fleet job
  metric String; cohort String; networkValue Decimal
  sampleSize Int; asOf DateTime
  @@unique([metric, cohort, asOf]) }   // NOTE: no tenantId — never per-store rows
// Tenant flag: benchmarksOptIn Boolean @default(true)
```

## APIs & interfaces

Merchant JWT: `GET /api/nova/agents` (board data) · `PUT /api/nova/agents/:dept/mode`
(owner; same three switch surfaces rule — room bar, module header, chat) ·
`GET/POST /api/nova/playbooks` + `/:id/rollback` (owner) · `GET /api/nova/negotiations`
+ `/:id` (rounds + live listen-in stream ref) · `GET /api/nova/benchmarks?metric=`
(own value + network + n). Chat intents (11's table rows filled): `promote_agent`,
`approve_playbook` (→ the bundle decision), `negotiation_status`/`listen_in`,
`show_benchmarks`. Service: playbook executor, negotiation round runner, benchmark
job (aggregation + floor). nova-ai: offer-strategy lib, playbook authoring
(Workflow-fanned), per-agent trust in L2 context. Strings bn+en; ৳ minor units
throughout (rounds, targets).

## Implementation steps

1. E-22 rows + per-agent trust (computeTrust slices) + mode tier in `evaluateAuthority`
   + re-evaluation transaction; board/room/chat mode surfaces.
2. Promotion decision + inverse (mode restore + auto-executed re-queue) + chat intent.
3. Playbook: calendar seed + authoring (benchmark/history inputs, ≥3wk enforcement,
   Workflow fan-out to departments for item drafts) + bundle decision + executor +
   rollback + HQ card wiring (mock Eid card deleted).
4. Negotiation: strategy table + round runner (email/SMS channel + negotiation calls)
   + listen-in + `contract_sign` flow + RFQ Compare door integration (12).
5. Benchmarks: extractors + cohorting + floor + opt-in flag + reads + injection into
   grade context/research suggestions/playbook timing + BenchmarksPanel wiring.
6. CEO weekly merge + per-agent memos; H2 intents live; per-agent trust in trust UI.
7. **Privacy audit** (external or security team): benchmark pipeline data-flow review,
   floor verification, opt-out path, no-raw-egress proof — signed report is a gate
   artifact.
8. Gate rehearsal + staging demo (non-builder); artifacts.

## Dependencies

08/09/12/13 shipped. Seasonal calendar + concession-ladder policy from product.
Privacy audit resourcing. Supplier-side contact data quality (Operations duties).

## Risks & trade-offs

| Risk | Mitigation |
|---|---|
| Promotion undo can't fully reverse executed pieces | documented window semantics in the undo receipt; re-evaluation transaction logs exactly what executed; gate demo shows undo working within windows |
| Playbook partial failure mid-month | halt + escalation decision; progress + per-piece receipts make state legible; rollback receipt lists irreversible pieces honestly |
| Negotiation counterparty is a human — model tone risk | strategy table bounds offers; language drafts pass the 10 voice scorer (professional register profile); every round receipted; founder can listen live and abort |
| Benchmark deanonymization (small cohorts) | floor ≥20 + no below-floor rows + audit; cohort keys coarse (vertical × band × region); aggregation job is the only reader of cross-tenant raws |
| Cold-start benchmarks useless | honest n + "network value unavailable" states (§18); playbook timing falls back to calendar + own history |
| Workflow fan-out cost | maxSubagents cap + playbook authoring is seasonal (rare); departments on cheap tier |
| Per-agent trust volatility (small slices) | minimum-events floor before a per-agent score displays (shows "earning trust · n events" below it) |

## Testing strategy

Unit: strategy-table concession bounds, floor math (cohort edge cases), playbook
ordering/rollback ordering, mode-resolution tier, promotion re-evaluation matrix.
Integration: bundle approve → pieces execute with receipts → rollback reverse-order;
negotiation round → call session → terms → founder-only sign refusal for agent paths;
benchmark job produces zero below-floor rows (property test); opt-out excludes both
directions. Evals: H2 chat intents (11 corpus extended), playbook authoring ≥3wk +
grounded items, negotiation language register. Privacy audit checklist. Prior suites
green.

## Performance

Benchmark job off-peak, fleet-wide batched (no per-tenant model spend). Playbook
executor sequential by design (auditability over speed; a month executes in minutes).
Listen-in rides existing SSE. Per-agent trust recompute piggybacks nightly reflection.

## Security

`contract_sign` founder-only on every path (07 classification + 13 voice confirmation).
Benchmark raws confined to the aggregation job (separate DB role, 15 hardens grants);
aggregates carry no tenant ids. Negotiation counterparty messages are untrusted data in
prompts (injection framing). Mode changes owner-only; agent trust has no write API.
Playbook items validate against their owning phase's schemas before execution.

## Success & exit criteria

**PRD §15 Stage 8 gate (verbatim):** *Promote Marketing-Nova in chat (undo works);
one-tap approve the Eid playbook (pieces execute with receipts); listen in on a
negotiation round + sign by voice; view cohort benchmarks. Plus privacy audit signed
off.*
**Standing gates** + **§16 discipline** (clean staging store, non-builder, recordings +
ledger export + signed privacy audit filed).
**Phase-specific:** per-agent trust reproducible from that agent's ledger slice ·
mode-change re-evaluation transaction receipted · playbook rollback leaves a complete
honest receipt trail · zero below-floor benchmark rows in production data · H2 chat
intents replace all 11-era stubs.

## Deliverables

E-22 + per-agent trust/mode + surfaces; promotion with undo; playbook engine
(calendar, authoring, bundle executor, rollback) + HQ wiring; negotiation engine +
calls + listen-in + signing flow; benchmark pipeline + floor + reads + injections;
CEO weekly merge; H2 intents; privacy audit report; gate artifacts; capability report
`phase-14-stage8-team.md` + matrix updates.
