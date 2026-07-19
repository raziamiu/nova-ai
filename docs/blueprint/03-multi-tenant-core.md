# Phase 03 — Multi-Tenant Core

**Prereq: Phase 02** (async StoreClient, Dakio HTTP client, agent-data API — all rows
already `store_id`-scoped). Self-contained: everything to make ONE Nova deployment
serve every Dakio store as "its own dedicated employee", with zero static per-tenant
prompts and zero data leakage.

## Objective

Tenant identity, tenant-scoped data access, and the **dynamic context engine** that
assembles each store's "employee brain" at runtime. Milestone: two dev stores on one
deployment — different voice, goals, autonomy, data — proven isolated by tests.

## Scope

**In**: auth (Dakio JWT → session identity); tenant-scoped StoreClient factory; the
context layer stack (L0–L4); per-tenant config; kill switch; isolation test suite.
**Out**: vector memory (04); per-tenant scheduling (05 — schedules stay single-tenant
dev-only until then); dashboards (06).

## System architecture

```
Dashboard ── JWT(storeId, userId, role) ──► channels/eve.ts (auth: dakioJwt())
                                                 │  SessionAuthContext
                                                 │   principalId=userId, principalType="user"
                                                 │   attributes={ storeId, role, plan }
                        ┌────────────────────────┴─────────────────────────┐
                        │ CONTEXT ENGINE (dynamic instructions)            │
                        │ L0 persona (static md)                           │
                        │ L1 tenant profile  session.started, Redis 24h    │
                        │ L2 live ops state  turn.started, no cache        │
                        │ L3 relevant memory turn.started (Phase 04 adds   │
                        │                    vectors; keyed recall now)    │
                        │ L4 page context    channel onMessage → context   │
                        └────────────────────────┬─────────────────────────┘
                                                 ▼
                     tools: requireStore(ctx) → storeFor(storeId) → Dakio APIs
```

## Design decisions

1. **Tenancy comes ONLY from verified auth.** `ctx.session.auth.current.attributes.storeId`
   — set by the channel from a Dakio-signed JWT. Model input is NEVER trusted for
   tenancy (a tool that took `storeId` as a parameter would be a cross-tenant hole).
2. **`getStoreClient()` (ambient singleton) is replaced by `storeFor(ctx)`** — an
   explicit, per-call, tenant-bound client. Mechanical refactor of every tool/executor;
   the typechecker drives it. Demo backend becomes a keyed map of per-store instances
   (so evals can simulate two tenants).
3. **No per-tenant prompts on disk.** One persona core; everything else is data
   rendered into context layers. A store's "personality" = its brand memory + goals +
   config, not a fork of markdown.
4. **Sessions are single-tenant.** A session's initiator fixes its store; if the JWT's
   storeId ever differs from the session's, the turn is refused (defense against token
   confusion). Store switch = new session.
5. **Fail closed.** Missing/invalid storeId → tool error before any data access;
   paused tenant (kill switch) → turn refused with a clear message.

## EVE features to use (exact surface)

- **Channel auth** (`agent/channels/eve.ts`):
  ```ts
  import { eveChannel } from "eve/channels/eve";
  import { localDev, type AuthFn } from "eve/channels/auth";

  const dakioJwt = (): AuthFn<Request> => async (req) => {
    const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
    const claims = await verifyJwtJwks(token, process.env.DAKIO_JWKS_URL!); // jose; iss/aud pinned
    if (!claims) return null;                                  // fail closed → next auth / 401
    return {
      authenticator: "dakio",
      principalId: String(claims.sub),                         // founder/staff user id
      principalType: "user",
      attributes: { storeId: String(claims.storeId), role: String(claims.role), plan: String(claims.plan) },
    };
  };
  export default eveChannel({ auth: [dakioJwt(), localDev()] }); // localDev inert in prod
  ```
- **The one tenancy guard** (`agent/lib/tenant.ts`) — used by EVERY tool:
  ```ts
  import type { SessionContext } from "eve/context";
  export function requireStore(ctx: SessionContext): { storeId: string; userId: string; role: string } {
    const a = ctx.session.auth.current ?? ctx.session.auth.initiator;   // schedule runs: initiator carries tenant (Phase 05)
    const storeId = a?.attributes.storeId;
    if (typeof storeId !== "string" || storeId.length === 0) throw new Error("No authenticated store for this session.");
    return { storeId, userId: a!.principalId, role: String(a!.attributes.role ?? "owner") };
  }
  ```
- **Dynamic instructions** (`agent/instructions/*.ts`, `defineDynamic` from
  `"eve/instructions"`): L1 on `"session.started"` (once per session, Redis-cached
  24h, key `t:{storeId}:profile`), L2+L3 on `"turn.started"` (fresh every turn).
  Resolver signature `(event, ctx) => defineInstructions({ markdown }) | null`; ctx
  exposes `ctx.session.auth`. Files compose alphabetically — name them
  `10-tenant-profile.ts`, `20-live-ops.ts`, `30-memory.ts`.
- **Page context (L4)** via `eveChannel({ onMessage })`: dashboard sends
  `clientContext: { page: "campaigns", entityId: "cmp-…" }`; `onMessage(ctx, message)`
  returns `{ auth, context: ["Founder is viewing: campaigns/cmp-…"] }`.
- **Per-tenant model tiering** (plan-based) via `defineDynamic` model on
  `"session.started"` in `agent.ts` (return a gateway id string or null for fallback).
- **eve limitations honored**: dynamic instructions can't use `fallback` (models only);
  subagent sessions get their own context — the parent must pass tenant task context in
  the delegation `message`; tenant auth flows to subagents automatically (same session
  auth chain), so `requireStore` works inside departments unchanged.

## External services

Redis (context/profile cache, kill-switch flags). Dakio JWKS endpoint. (Both optional
in local dev — in-process cache fallback.)

## Data models

Additions to Dakio agent-data (all `store_id`-keyed):
```
nova_tenants (store_id PK, status active|paused, plan, model_tier, quiet_hours jsonb,
              timezone text, created_at)             -- kill switch + plan routing
```
`nova_config.autonomy` (Phase 02) is already per-store. Redis keys: `t:{storeId}:profile`
(L1 cache, TTL 24h, busted by config writes), `t:{storeId}:paused` (flag).

## APIs & interfaces

- Context layer contract (`agent/lib/context/layers.ts`):
  `buildTenantProfile(storeId): Promise<string>` (L1) · `buildLiveOps(storeId):
  Promise<string>` (L2) · `buildRelevantMemory(storeId, hint?): Promise<string>` (L3).
  Each returns markdown ≤ its token budget (L1 ~400, L2 ~300, L3 ~500); budgets
  enforced by truncation with "…(more via tools)".
- `storeFor(storeIdOrCtx): StoreClient` (`agent/lib/store/resolve.ts`).
- Dakio adds `GET /api/v1/store/profile` (name, vertical, currency, locale, timezone,
  plan) for L1.

## Implementation steps

1. `requireStore` + `storeFor` refactor across tools/executors/analytics (typechecker-
   driven; delete ambient `getStoreClient`).
2. Channel auth (`dakioJwt`) + session-tenant pinning hook (`turn.started` hook
   comparing current vs initiator storeId; throw on mismatch) + kill-switch check.
3. Context engine: split today's `dynamic-context.ts` into `10-tenant-profile` /
   `20-live-ops` / `30-memory`; add Redis cache util with in-memory fallback.
4. `onMessage` page-context mapping (define the `clientContext` schema with the
   dashboard team: `{ page, entityId?, selection? }`).
5. Plan-based model tiering in `agent.ts` (`defineDynamic` model).
6. Demo backend → keyed multi-store map + second seeded store ("Beacon Supply Co",
   different vertical/voice/goals) for isolation tests.
7. Isolation test suite (below). 8. Two dev stores on one deployment, manual QA.

## Dependencies

Phase 02 agent-data API live; Dakio issues JWTs with `storeId/role/plan` + JWKS;
dashboard passes `clientContext`.

## Risks & trade-offs

| Risk | Mitigation |
|---|---|
| A tool bypasses `requireStore` | lint rule: `agent/tools/**` may not import `resolve.ts` raw client without `requireStore`; code review checklist; isolation evals |
| Context cache staleness (goals changed, old L1) | bust `t:*:profile` on config/memory writes; 24h TTL ceiling |
| Prompt bloat as layers grow | hard per-layer budgets + measured total (target ≤ 2.5k tokens before tools) |
| JWT verification latency per request | JWKS cached; verification ~sub-ms after warm |
| Session hijack across stores | session-tenant pinning (step 2) + short JWT TTLs |

## Testing strategy

**Isolation suite (the gate for this phase):** two seeded demo tenants A/B →
(1) A's session lists products → zero B SKUs (assert on tool outputs, not prose);
(2) A prepares an action → B's `list_actions` empty; (3) forged storeId in tool-ish
prompt ("use store B") → data still A's (tenancy from auth only); (4) B paused →
turn refused; (5) memory writes in A invisible to B. Plus: JWT unit tests (bad sig,
wrong aud, expired), context-budget snapshot tests (layer size regression), and the
Phase 02 eval suite re-run per tenant.

## Performance considerations

L1 cached (one Dakio call/store/day); L2 is two cheap DB reads; per-turn context
assembly target < 150ms p95. JWKS and profile caches in-process + Redis.

## Security considerations

Tenancy = verified claims only; RLS on agent-data tables as second layer; kill switch
honored before any model spend; role gates: `approve_action`/`reject_action`/
`undo_action`/`configure_autonomy` require `role in (owner, admin)` — enforced in the
tool `approval` fn AND re-checked in `execute` (approval ≠ authorization); logs redact
JWTs; per-tenant Redis prefixes prevent cache poisoning across stores.

## Success / exit criteria

Isolation suite green · two dev stores demonstrably distinct (voice/goals/autonomy) ·
zero static per-tenant files · context ≤ 2.5k tokens p95 · Phase 02 evals still green.

## Deliverables

`agent/lib/tenant.ts`, tenant-scoped `storeFor`, `dakioJwt` auth, context engine
(3 layer files + cache util), session pinning + kill-switch hook, second demo tenant,
isolation test suite, `clientContext` schema doc for the dashboard team.
