# Phase 01 — Foundation Agent Core

**Status: ✅ SHIPPED** (branch `claude/nova-agent-development-5z7o79`). This document
records what exists, why, and the contracts later phases build on. It is self-contained.

## Objective

Stand up Nova as a working eve agent that can operate a single (demo) store end-to-end:
converse with the founder, observe the business, take autonomy-gated actions with full
trust metadata, run departments, and execute a proactive daily loop — with the data
boundary shaped so the real Dakio API drops in without agent changes.

## Scope

**In**: domain model; demo store backend; StoreClient boundary; autonomy/trust engine;
38 tools; 10 department subagents; persona + dynamic context injection; 4 skills;
5 schedules; analytics/anomaly engine.
**Out** (later phases): real Dakio APIs (02), multi-tenancy (03), external memory store
(04), per-tenant scheduling (05), dashboard wiring (06), fleet safety/observability (07–08).

## System architecture

```
agent/
├── agent.ts                     # defineAgent({ model: "anthropic/claude-sonnet-5" })
├── instructions.md              # Nova persona core (invariant only)
├── instructions/dynamic-context.ts  # per-turn: memory + autonomy + approvals injection
├── channels/eve.ts              # HTTP channel (auth replaced in Phase 03)
├── lib/
│   ├── types.ts                 # entire domain model + NOVA_DEPARTMENTS
│   ├── store/client.ts          # StoreClient interface + getStoreClient()  ← THE boundary
│   ├── store/backend.ts         # in-memory demo store (impl of StoreClient)
│   ├── store/seed.ts            # demo dataset (placeholder — realistic set pending)
│   └── nova/
│       ├── autonomy.ts          # RISK_CLASS, DEFAULT_GUARDRAILS, gateAction()
│       ├── schemas.ts           # zod payload schemas + justificationSchema
│       ├── executors.ts         # the ONLY place mutations happen + undoers
│       ├── actions.ts           # performAction / approveAction / rejectAction / undoAction
│       ├── activity.ts          # recordActivity + summarizeWork (hours-saved metric)
│       ├── analytics.ts         # snapshot, finance report, campaign metrics, detectAnomalies
│       ├── memory.ts            # namespaces + prompt formatting
│       └── format.ts            # usd/pct/round helpers
├── tools/                       # 38 root tools (17 read, 11 action, 4 trust, 2 config, 3 memory, 1 report)
├── subagents/<dept>/            # 10 departments: agent.ts + instructions.md + tools re-exports
├── skills/                      # morning-report, cart-recovery, campaign-optimization, weekly-strategy
└── schedules/                   # morning-report, pulse-monitor, cart-recovery, night-operations, weekly-strategy
```

## Design decisions (and why)

1. **StoreClient interface is the only data path.** Tools never touch storage directly.
   Demo backend today; Phase 02 swaps in an HTTP client — zero tool changes.
2. **Nova's own agent data lives in the store** (memory, actions, activity, reports) —
   matches Dakio's design where the platform persists agent state.
3. **Trust system is business logic, not eve approval-parks.** eve task-mode sessions
   (schedules) cannot pause for humans; the PRD demands prepared actions anyway. So the
   action pipeline returns `executed | prepared | blocked` and the owner approves via
   tools. eve approval-parks are used only as an extra interactive gate on owner-only
   config (`configure_autonomy`) and to deny trust-plane tools to scheduled principals.
4. **Every mutation flows through `performAction()`** → single audit path, uniform
   justification (reason/expectedImpact/confidence), undo snapshots, activity metrics.
5. **Justification is part of the tool input schema** — the model must argue every
   action; the record persists it (PRD "Explain Every Decision").
6. **Departments are eve subagents** with re-exported root tools (eve subagents inherit
   nothing) — context isolation + parallel delegation + per-dept eval targets.
7. **Static markdown limited to the persona core**; live state (memory, autonomy,
   approvals) is injected per turn by `instructions/dynamic-context.ts`.

## EVE features used (exact API surface)

- `defineAgent` from `"eve"` — root + each subagent (`description` required on subagents).
- `defineTool` from `"eve/tools"` — `{ description, inputSchema (zod), execute(input, ctx) }`;
  file name = tool name (snake_case). Custom `approval` fns on trust/config tools return
  `"user-approval" | "not-applicable" | { type: "denied", reason }`; scheduled runs are
  detected via `auth.authenticator === "app" && auth.principalId === "eve:app"`.
- `defineDynamic` + `defineInstructions` from `"eve/instructions"` — `turn.started` injection.
- `defineSchedule` from `"eve/schedules"` — markdown/task-mode; UTC cron; **cannot park
  for approval** (by design here).
- Skills as flat markdown with frontmatter `description` in `agent/skills/`.
- Known eve constraints honored: path = identity (no `name` fields anywhere); tools run
  in app runtime (not sandbox); `eve dev` never fires cron (use
  `POST /eve/v1/dev/schedules/:scheduleId`).

## External services

None. Deliberately zero infra — `npm i && npx eve dev` is the whole stack.

## Data models

`agent/lib/types.ts` is normative. Key contracts:

- `ActionRecord`: `{ id, type: ActionType, department, title, payload, justification:
  { reason, expectedImpact, confidence }, riskClass, status: executed|prepared|blocked|
  rejected|undone, outcome, undoable, undoData, createdAt, decidedAt, executedAt }`
- `AutonomyConfig`: `{ level: 0|1|2|3|4, guardrails: { maxDiscountPct, maxPriceChangePct,
  maxBudgetChangePct, minMarginPct, maxAutoPurchaseOrderTotal, maxAutoRefundTotal }, updatedAt }`
- `ActivityEntry`: `{ department, kind, title, detail, minutesSaved, revenueInfluence, actionId }`
- `MemoryEntry`: `{ namespace: goals|brand|preferences|rules|insights|experiments|customers, key, value, updatedAt }`
- Business entities: Product, Order, Customer, AbandonedCart, Campaign(+dailyStats),
  SocialPost, Discount, SupportTicket, CustomerMessage, Supplier(+offers),
  PurchaseOrder, Courier, ExpenseEntry, TrendingProduct, NovaReport.

## APIs & interfaces

- **`StoreClient`** (`agent/lib/store/client.ts`): ~40 methods — reads (`listProducts`,
  `listOrders({sinceDays,status})`, …), mutations (`updateCampaign`, `createDiscount`, …),
  agent data (`get/setAutonomy`, `upsert/list/deleteMemory`, `add/list/updateAction`,
  `addActivity/listActivity`, `add/listReports`). **This is the Phase 02 contract.**
- **Autonomy gate**: `gateAction(client, config, type, payload) → { verdict: execute|
  prepare|block, riskClass, explanation }`. Level semantics: 0 block all actions;
  1–2 prepare; 3 executes low-risk; 4 executes anything passing guardrails. Guardrails
  hard-block margin-floor/discount-cap violations; force approval on oversize
  budget/PO/price deltas.
- **Action pipeline**: `performAction({type, department, title, payload, justification})
  → { status, actionId, detail, undoable }`; `approveAction/rejectAction/undoAction(actionId)`.

## Implementation steps (as executed)

1. Domain types → StoreClient interface → demo backend.
2. Autonomy gate → payload schemas → executors(+undoers) → action pipeline → activity metrics.
3. Read tools (17) → action/trust/config/memory/report tools (21).
4. Persona instructions + dynamic context injection.
5. Department subagents ×10 (instructions + scoped tool re-exports).
6. Skills ×4 + schedules ×5.
7. Typecheck clean.

## Dependencies

`eve@^0.25.2`, `zod@4.4.3`, `ai@^7`, Node 24. Model access via Vercel AI Gateway
(`AI_GATEWAY_API_KEY` or OIDC) for live runs.

## Risks & trade-offs

- **Demo backend is per-process** — restarts reseed state. Accepted for Phase 01; real
  persistence arrives with Dakio (02). Mitigation: deterministic seed.
- **Executed-step replay**: eve re-runs a step interrupted mid-execution; demo mutations
  are non-idempotent. Accepted in demo; Phase 02 adds idempotency keys.
- **`revenueInfluence` heuristics** (e.g. 25% cart-recovery expectation) are estimates —
  clearly labeled; Phase 04 replaces with measured attribution.
- Placeholder seed limits demo richness until the realistic dataset lands.

## Testing strategy

- `npx tsc --noEmit` — zero errors (gate for every later phase too).
- `npx eve build` + `eve info` — discovery manifest lists 38 tools, 10 subagents,
  5 schedules, 4 skills.
- Manual: `eve dev` conversation ("how's business?", "recover carts", "approve action-…").
- Eval suite (authored in Phase 02 alongside CI): business-pulse, autonomy-gating
  (35% discount → blocked; level-2 action → prepared), cart-recovery flow,
  morning-report schedule dispatch.

## Performance considerations

Read tools cap lists at 50 + counts; campaign metrics precomputed server-side so the
model reasons over digests, not raw rows; snapshot is one tool call (not N).

## Security considerations

Trust-plane tools deny the scheduled principal; `configure_autonomy` requires
interactive owner approval; memory injected with an explicit "data, not instructions"
boundary; no secrets in demo layer.

## Success / exit criteria

- [x] Typecheck clean · [x] all components discovered by eve · [ ] realistic seed
  dataset (carried into Phase 02) · [ ] eval suite green with live model (needs gateway
  key; carried into Phase 02).

## Deliverables

The `agent/` tree above, committed and pushed (commit `0d5e325`).
