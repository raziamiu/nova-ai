# Phase 06 — Dashboard Experience Integration

**Prereq: Phases 03 (auth/context) + 05 (jobs produce reports).** Self-contained: wiring
the ALREADY-BUILT Dakio dashboard UI to Nova — chat, streaming, approvals, task feed,
morning report, memory transparency, and the "hours saved" metrics — plus notifications.

## Objective

The founder experience from the PRD: open Dakio at 8:00, see "while you were away…",
approve with one click, chat with Nova about anything, and always see why Nova did what
it did. Milestone: full founder loop (report → approve → executed → undo) through the UI.

## Scope

**In**: chat session lifecycle + streaming; approval/undo UX APIs; dashboard data APIs
(task feed, metrics, reports, memory); page-context wiring; notification fan-out
(email/push digests); working-hours settings → job defs.
**Out**: new UI design (done), mobile apps (consume the same APIs).

## System architecture

```
Dashboard (existing UI)
 ├─ Chat panel ── POST /eve/v1/session (+JWT) ── eve channel ── Nova session
 │      └─ GET /eve/v1/session/:id/stream (NDJSON)  ← tokens, tool events, input requests
 ├─ Home widgets ─ Dakio BFF → agent-data reads (reports, activity, metrics, actions)
 ├─ Approve/Reject/Undo buttons ─ two paths (see decisions)
 └─ Settings (autonomy, guardrails, working hours, memory) ─ Dakio BFF → nova_config / job defs
Notification worker (Dakio): new report/prepared-action rows → email/push digests
```

## Design decisions

1. **Widgets read the database, not the model.** Task feed, hours saved, reports,
   pending approvals are plain queries over `nova_activity/nova_actions/nova_reports`
   — instant, cheap, deterministic. The model is only in the loop for conversation and
   jobs. (PRD dashboard = a VIEW over Nova's ledger.)
2. **Approvals have two equivalent paths, same engine:**
   (a) **Button path (primary)**: dashboard → Dakio BFF → `POST /api/v1/agent-data/
   actions/:id/approve|reject` → executes `approveAction/rejectAction` server-side
   (shared library or thin Nova-internal endpoint) with the acting user recorded.
   No model call, sub-second, works even if chat is closed.
   (b) **Chat path**: "approve action-8001" in conversation → `approve_action` tool.
   Both paths converge on the SAME action pipeline row + audit trail.
3. **One long-lived chat session per (store,user) day**, resumed via stored
   `continuationToken`; server keeps the token↔user binding; a lost token is recovered
   from the stream (`startIndex: -1`). New day or `session.completed` → new session.
4. **Page context on every message** (Phase 03 L4): the chat client attaches
   `clientContext: { page, entityId }` so "pause this campaign" resolves without
   naming it.
5. **Notifications are digests, not events** (PRD: never spammy): worker batches new
   rows per tenant into at most: 1 morning push, 1 midday digest if criticals, real-time
   push ONLY for `priority=1` approvals (e.g. big PO). Quiet hours respected.

## EVE features to use (exact surface)

- **eve HTTP channel routes** (already authed by `dakioJwt`, Phase 03):
  `POST /eve/v1/session` `{ message }` → `{ sessionId, continuationToken }` ·
  `POST /eve/v1/session/:sessionId` `{ continuationToken, message, inputResponses? }` ·
  `GET /eve/v1/session/:sessionId/stream?startIndex=` (NDJSON; `-1` tail recovers
  token from `session.waiting`) · `POST …/cancel`.
- **Stream events the UI must handle**: `message.appended` (deltas; `message.completed`
  can fire MULTIPLE times per turn — narration before tool calls; render by
  `finishReason`), `actions.requested`/`action.result` (tool activity indicators →
  "Nova is checking campaigns…"), `input.requested` (render eve-native approval/question
  buttons; reply via `inputResponses: [{ requestId, optionId }]` — used by
  `configure_autonomy`'s interactive gate), `session.waiting` (carries next
  `continuationToken` — persist it), `turn.failed`/`session.failed` (error UX).
- **TypeScript client** (`eve/client`) in the Dakio BFF for server-side calls:
  `new Client({ host, auth }).session(savedState).send(...)`; browser talks to the
  stream directly with the JWT.
- **eve limitation honored**: eve has no REST surface for "list my prepared actions"
  etc. — that's our agent-data API (by design; the DB is the source of truth).

## External services

Email/push provider (Dakio's existing); no new infra.

## Data models

Additions:
```sql
ALTER TABLE nova_actions ADD COLUMN decided_by text;        -- user id for approve/reject
ALTER TABLE nova_reports ADD COLUMN read_at timestamptz;    -- unread badge
CREATE TABLE nova_chat_sessions (store_id, user_id, session_id, continuation_token,
  created_at, last_active_at, status, PRIMARY KEY(store_id, user_id, session_id));
CREATE TABLE nova_notifications (id, store_id, kind, payload jsonb, digest_key,
  scheduled_for, sent_at, channel email|push);
```

## APIs & interfaces (Dakio BFF → dashboard)

```
GET  /api/nova/home            → { snapshotCards, hoursWorked, tasksCompleted,
                                   revenueInfluenced, unreadReport, pendingApprovals[] }
GET  /api/nova/feed?cursor     → activity entries (task feed ✓ lines)
GET  /api/nova/reports/:id     → markdown body (morning report render)
POST /api/nova/actions/:id/approve | /reject {reason} | /undo
GET  /api/nova/actions?status  → trust center list (justification, confidence, risk)
GET/PUT /api/nova/settings     → autonomy, guardrails, working hours (→ upsertJobDef),
                                 quiet hours, notification prefs
GET/PUT/DELETE /api/nova/memory→ memory transparency UI (namespace lists, provenance)
POST /api/nova/chat            → proxy to eve session create/continue (attaches JWT + clientContext)
```
Semantics: approve/reject/undo are idempotent (repeat → 409 with current status);
all writes record `decided_by`; settings PUT busts the L1 context cache (Phase 03).

## Implementation steps

1. Agent-data read APIs + home/feed/report endpoints (pure DB).
2. Approve/reject/undo endpoints calling the shared action-pipeline library; wire
   buttons; optimistic UI with status reconciliation.
3. Chat: session manager (token persistence/recovery), stream renderer (event
   handling table above), `clientContext` attachment, `input.requested` button UX.
4. Settings ↔ `nova_config`/`nova_job_defs`/quiet hours; memory UI (list/edit/delete
   with provenance display).
5. Notification worker: digest builder over new rows; quiet hours; unsubscribe prefs.
6. E2E founder-loop test + demo script.

## Dependencies

Dashboard team (UI is built; needs API contracts above), Dakio BFF, Phases 03/05 rows
flowing.

## Risks & trade-offs

| Risk | Mitigation |
|---|---|
| Stream handling bugs (multi `message.completed`) | shared TS stream-reducer package + fixture streams in tests |
| Token loss → orphaned sessions | recovery via `startIndex:-1`; server-side token store; daily session rotation |
| Approve raced by undo/expiry | optimistic-lock on status transition (409), UI reconciles |
| Notification fatigue | digest-only policy + per-tenant prefs + measured opt-out rate |
| BFF double-proxying streams | browser connects to eve stream directly (JWT), BFF only creates sessions |

## Testing strategy

Contract tests on every BFF endpoint; stream-reducer unit tests against recorded NDJSON
fixtures (incl. mid-turn tool narration, input.requested, waiting); E2E (Playwright):
morning report → approve action-8001 → status executed in trust center → undo →
undone; settings change reflected in next turn's context (autonomy line) and next
day's job time.

## Performance considerations

Home endpoint one round-trip (composed query, target <150ms p95); feed cursor-paged;
report bodies cached (immutable rows); streams are pass-through (no buffering).

## Security considerations

Every BFF endpoint re-verifies JWT + storeId match (never trusts client store ids);
approve/undo require `role in (owner, admin)`; action ids are unguessable (uuid) but
authz never relies on that; memory UI deletes are hard deletes (Phase 04); CSP on
rendered report markdown (sanitize — reports may quote customer text).

## Success / exit criteria

E2E founder loop green · dashboard home renders entirely from ledger reads (no model
calls) · approval p95 < 1s · notification digests respect quiet hours · PRD north-star
demo runnable end-to-end on a dev tenant.

## Deliverables

BFF API set + contracts, chat session manager + stream reducer package, approval/undo
wiring, settings + memory transparency UI integration, notification worker, E2E suite.
