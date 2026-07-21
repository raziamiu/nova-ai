# Nova UI Build — Step 1: Action ledger + live feed · capability report

- **Status:** shipped
- **Repos / branches:** `dakio-api` @ `claude/nova-phase-2-dakio-integration` (uncommitted), `dakio-merchant` @ `main` (uncommitted)
- **Date:** 2026-07-21
- **Spec:** `docs/prd/PRD - Nova UI Build.md` §8 wiring order, step 1 ("Ledger + feed")

> A founder's own browser can now see Nova's real work for the first time — the
> actual pending decisions, actual completed-task feed, and actual hours-saved
> count for their store, updated live as Nova acts. Previously the entire Nova
> HQ UI in `dakio-merchant` ran on localStorage-persisted fake data; the ledger
> it was designed to eventually read already existed and was already being
> written to by the live Nova agent — nothing had ever exposed it to a browser.

## Real deviation from the PRD's own assumption

The PRD's §6 readiness matrix marks "Action ledger + receipts" as **BUILD** —
"Nothing else can honestly ship first." That was true of Dakio's pre-existing
systems, but false of what Nova itself had already built: `NovaAction` and
`NovaActivity` (Phase 01's action pipeline + activity ledger) have persisted
to real Postgres, written by the live Nova agent, since Phase 02. Auditing the
real call sites (`agent/lib/nova/actions.ts`, `agent/lib/store/dakio.ts`,
`dakio-api/src/routes/nova.js`) before designing — the same discipline that
caught Phase 2.3's and Phase 5's wrong blueprint assumptions — found this in
about twenty minutes and changed the whole shape of the work. **Zero new
Prisma tables or migrations were needed for this step.** The actual gap was
narrower than the PRD assumed: no merchant-facing (dakio-JWT-authed) read
route existed (agent-data routes are Nova-service-token-only, by design), and
no live-push transport existed. Both are now built; nothing about the ledger
itself changed shape.

## Gate

| Check | Result |
|---|---|
| dakio-api hermetic suite (`npm test`) | 55 fail / 251 pass — **identical failure count to the pre-existing baseline** (confirmed via `git stash` A/B comparison); all failures are a known ESM module-mock ordering issue unrelated to this work; 5/5 new `novaFeedBus.test.js` checks pass |
| dakio-api integration suite (real Postgres) | `novaDashboard.integration.test.js` — 6/6 pass, including a real end-to-end SSE push test |
| dakio-merchant `npm run build` | clean, before and after the adversarial-review fixes |
| Live smoke test, real dev tenant | see below |
| Independent adversarial review | 6 findings, 2 critical — all fixed and re-verified (see below) |
| Browser/visual check | ✅ done. No browser tool was available among this session's own tools, but a prior sibling session's `puppeteer-core` pattern (see `nova-merchant-integration` memory) was reusable: installed `puppeteer-core` ad hoc (`--no-save`, uninstalled after — package.json/lock untouched, confirmed via `git status`), pointed at the real local Chrome install, seeded `localStorage` with a JWT minted for the real dev tenant's actual owner user row, navigated to `/nova`. See screenshot walkthrough below. |

## New capabilities this step

- **Merchant-facing ledger reads** — `dakio-api/src/routes/novaDashboard.js`, mounted at `/api/nova/*`, authed with the same JWT as every other merchant route (`authenticate`+`requireTenant`, not the Nova service token). `GET /feed` (paginated `NovaActivity`), `GET /actions` (paginated `NovaAction`, with real `justification`/receipt fields), `GET /home` (tasksToday/hoursWorkedToday/revenueInfluencedToday, computed via a tenant-timezone-aware day boundary reusing Phase 05's `civilToUtc`/`localCivilFields`, plus a `pendingApprovals` list).
- **Live push, not polling** — `dakio-api/src/lib/novaFeedBus.js`, an in-process per-tenant `EventEmitter`, emitted from inside `nova.js`'s existing agent-data write handlers (`POST /activity`, `PATCH /activity/:id`, `POST /actions`, `PATCH /actions/:id`). `GET /api/nova/feed/stream` (SSE) subscribes and pushes within the same process — no new infra, no Redis, matching the "no new infra" instruction. Single-Railway-instance caveat is documented inline (`novaFeedBus.js` header) and currently accurate (no replica count configured).
- **Event granularity that survives attribution rewrites** — emits are split `activity.created` vs `activity.updated` (and `action.created`/`action.updated`) specifically so a client counting "new tasks today" doesn't double-count the nightly attribution pass rewriting an old row's `revenueInfluence` in place.
- **A browser-side SSE client that doesn't leak the JWT into logs** — `dakio-merchant/src/pages/nova/lib/novaFeedStream.js`, a hand-rolled `fetch()`+`ReadableStream` reader, because native `EventSource` cannot attach an `Authorization` header (the common workaround — a token in the URL query string — would put a long-lived merchant JWT in server access logs).
- **`NovaContext.jsx` feed/task-count wired to the above** — the ONLY parts of the pre-existing Nova HQ mock context touched. Decisions, autonomy, guardrails, chat, duty roster are untouched and remain fully mocked (later PRD steps — Decision service, Authority engine).

## PRD sections advanced

| PRD section | Before | After | Note |
|---|---|---|---|
| §6 Action ledger + receipts | BUILD (per PRD) | ✅ already existed; now merchant-readable | No new tables — a read surface, not new persistence |
| FR-2.3 Live feed | not real | 🟡 real feed data, mock decision cards still overlaid in the same UI | Feed panel now shows genuine `NovaActivity` rows; the Decision Desk panel beside it is still `DECISIONS`/mock (step 3) |
| FR-2.1 tasks-done-today counter | fake, random-incrementing | ✅ real (`tasksToday` from `NovaActivity`) | |

## Scenario walkthroughs

### Scenario 1 — A founder opens the dashboard and sees Nova's real pending decisions for the first time
Hitting `GET /api/nova/home` against the real dev tenant returned 3 genuine
`prepared` `NovaAction` rows the live agent had already generated — two ad
campaign proposals and a discount code, each with a real `justification`
(reason/expectedImpact/confidence) grounded in that store's actual inventory
and zero-sales state. Before this step, that data existed only in Postgres;
a founder had no way to see it except a raw DB query. `pendingApprovals` in
the home response surfaces it — read-only for now (approve/reject buttons are
step 3), but visible.

### Scenario 2 — A task Nova completes appears in the dashboard within a second, not on next refresh
POST a real activity row via the existing agent-data path
(`/api/v1/agent-data/activity`, the same endpoint the live agent already
calls after every executed action) while a browser tab holds
`/api/nova/feed/stream` open. The `activity.created` event arrives over the
SSE connection immediately — verified against the real running dev server,
not just the test harness (`curl -N .../feed/stream` captured the exact
frame within the same request lifetime as the POST).

### Scenario 3 — Watched live in an actual browser, against the real dev tenant
Seeded a real Chrome session (via an ad hoc `puppeteer-core` script, not committed)
with a JWT for the real dev tenant's actual owner user, opened `/nova` → Command
view. Initial render showed the honest empty state — "0 TASKS," no feed lines —
because this tenant had zero `NovaActivity` rows at that moment (its one prior
test row had already been cleaned up). Then, **with the page still open**, fired
a real `POST /api/v1/agent-data/activity` (the same call path the live agent
uses) from a separate terminal. Within under 2 seconds, with no page reload：
the task counter flipped to "1 TASKS" and "06:25 → Puppeteer live-push check"
appeared at the top of the Live Feed panel — the SSE push, rendering. The
Decision Desk panel beside it correctly stayed on its mock "0 WAITING / All
clear" data (seeded to an empty mock queue), confirming the scope boundary
holds visually, not just in code: real feed, still-mock decisions, in the same
screen, without either bleeding into the other.

### Scenario 4 — Attribution rewrites a week-old cart-recovery's revenue number without inflating "tasks today"
The nightly attribution job (Phase 04/05) patches `NovaActivity.revenueInfluence`
on an old row via `PATCH /activity/:id`. That emits `activity.updated`, which
the dashboard client explicitly ignores for the task counter/feed-prepend —
only `activity.created` bumps `tasksToday` or adds a feed line. Verified by
the integration test's home-aggregate assertions and by the deliberate
event-type split in both `nova.js` (emit side) and `NovaContext.jsx`
(consume side).

## Adversarial review — 6 findings, 2 critical, all fixed

An independent review (given no context about my design decisions, told to
be skeptical) found real bugs I would not have caught myself:

1. **Critical — infinite redirect loop.** The new feed/home fetches fired
   whenever the (pre-existing, logout-surviving) local `hired` flag was true,
   with no check for a valid token — unlike the SSE-stream open two lines
   later, which already had that guard. A user whose JWT expires anywhere in
   the app gets redirected to `/login` by `api.js`'s global 401 handler;
   `NovaProvider` (mounted at the app root, wrapping `/login` too) remounts
   with `hired` still `true`, fires the same unauthenticated calls, gets 401
   again, redirects again — forever. **Fixed**: both fetches are now gated on
   token presence, same as the stream already was.
2. **Critical — unhandled SSE socket error could crash the whole dakio-api
   process** (every tenant, every app sharing it), not just one connection.
   No `res.on('error', ...)` guard existed; a write against a socket that
   died before `req`'s `close` event fired would throw unhandled, and nothing
   in `index.js` catches that (Sentry's Express error handler doesn't cover
   async EventEmitter callbacks). **Fixed**: `res.on('error', cleanup)` plus
   a `safeWrite()` wrapper that no-ops once the response is ended/destroyed.
3. **High — a race let the slower REST snapshot silently overwrite a
   newer SSE-pushed count.** The initial `GET /feed`/`GET /home` and the SSE
   stream opened concurrently; if a live push landed before the (slower) home
   response, the stale snapshot's `tasksToday` would revert the already-correct
   visible count downward, permanently (the effect never re-runs). **Fixed**:
   the stream now opens only after the REST snapshot resolves — sequential,
   not concurrent. Trade-off: an activity created in the narrow window
   between the two GETs and the stream subscribing is picked up by the next
   live event instead of instantly; an honest small gap, not a silent wrong
   number.
4. **Medium — no reconnect on stream drop, and both REST failures were
   fully silent** (empty feed indistinguishable from "backend down").
   **Fixed**: fixed-delay (5s) reconnect on stream error; `console.error` on
   REST failures for basic debuggability. Did not build a toast/error-banner
   UI system — out of scope for a read-only step, and this repo has no
   existing toast convention to match.
5. **Low — `GET /actions` had no pagination**, unlike `/feed` and
   `pendingApprovals`. **Fixed**: same `limit`/max pattern as `/feed`.
6. **Low/theoretical — `dayStart`'s DST-gap fallback had no second
   fallback**, and a separate pre-existing gap (unrelated file,
   `auth.js`'s settings PATCH doesn't validate `timezone` against
   `isValidTimeZone()`) means an invalid zone could theoretically reach this
   code. Currently unreachable — the Settings UI only offers 3 non-DST zones.
   **Fixed the reachable half**: `dayStart` now falls back to a rolling 24h
   window instead of passing `null` into the Prisma query. Left the
   `auth.js` gap alone — unrelated file, pre-existing, not reachable today.

Two categories the review explicitly checked and found sound, not just
unreported: tenant isolation on the event bus (topic keyed strictly off
server-verified `req.tenantId`, never client input, both read and write
sides), and the SSE frame parser's handling of chunk-boundary splits,
multi-byte UTF-8 splits, and malformed frames.

The infinite-loop and process-crash fixes are code-reviewed and covered by
re-running the full test suite (no regression) but are **not** independently
reproduced under load (no test simulates an expired-JWT redirect loop or a
mid-write socket death) — this repo has no frontend test suite to add the
former to, and simulating a real socket-error mid-write is impractical in an
integration test. Flagging that gap rather than overclaiming coverage.

## Known limitations / not yet

- Decision Desk, autonomy levels, guardrails, chat, duty roster: **still
  fully mocked** — untouched by this step, arrives in later PRD steps
  (Authority engine, Decision service, Chat agent per §8).
- Multi-instance/horizontal scaling of `novaFeedBus`: a write landing on one
  Railway replica won't push to an SSE client connected to another. Currently
  moot (single instance, no replica count configured) but would need a real
  pub/sub (Postgres LISTEN/NOTIFY or similar) before scaling out.
- Per-department "Action history" (the `hist` arrays in each department
  room) is still `DEPT_ROOMS` mock data — a natural extension of this same
  ledger (filter `NovaActivity` by department) but explicitly out of this
  step's scope.

## Found, unrelated — two pre-existing bugs currently crash the ENTIRE dakio-merchant app

Discovered while setting up the browser check above, not caused by this
session's work (confirmed: both are present with this session's changes
fully stashed out, and both were already flagged by a plain `npm run lint`
diff taken before any of this session's edits). **Both are severe — the
whole app fails to render at all, not just Nova** — flagging prominently
rather than quietly leaving them for the next person to rediscover:

1. `src/App.jsx` references `<AutopilotProvider>` (wrapping the whole app)
   but never imports it — `AutopilotProvider` is exported from
   `src/context/AutopilotContext.jsx`, which exists and is otherwise
   complete, just never wired into `App.jsx`'s import list.
2. `src/components/layout/Sidebar.jsx:187` reads a bare `pendingCount`
   variable that's never defined anywhere in that file — it's meant to come
   from `useAutopilot()` (which exposes exactly a `pendingCount` field) but
   `Sidebar.jsx` never imports or calls that hook.

Both were fixed locally, verified (the app renders correctly with both one-line
import fixes), then **reverted** before finishing this session — fixing an
unrelated feature area (Autopilot) wasn't in scope for this step, and the
Autopilot feature's actual completion state is unknown (a half-finished
in-progress feature would want a different fix than a broken merge). Left
exactly as found; `git status`/`git diff` on `App.jsx` and `Sidebar.jsx` show
zero changes from this session.

## Matrix updates

Rows changed in `docs/prd/capability-matrix.md`: "Founder dashboard" (Dashboard
& long-term), "Business Hours Saved metric" (Metrics, reports & workflow).
