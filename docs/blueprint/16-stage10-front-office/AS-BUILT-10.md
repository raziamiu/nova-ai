# Module 10 — Founder Experience: AS BUILT

Branch `feat/front-office` in `dakio-api`, `dakio-merchant` and `nova-ai`.

| Chunk | dakio-api | merchant |
|---|---|---|
| 1 ungraded room stops rendering the fixture; hours modal splits delivered vs still-out | — | `0032490` |
| 2+3 `case.opened` SSE, by-Nova chips + receipt drawer, ownership banner, `senderId` crash guard | — | `ff72f7c` |
| 4 thread endpoint projected (stops shipping `rawPayload`); `actor` into the list select | `7d9efaa` | — |
| 4b list preview says `Nova:` vs `You:` | — | `8e23b6f` |
| 5 `GET /nova/inbox-summary` + the Command inbox tile | `37ed322` | `b615d1b` |
| 6 the made-by split gets an inbox door | `622e22c` | `aaa532e` |
| 7 the draft bar | `17b6e37` | `efe10d0` |
| 8 the brief's inbox line + the status-line repair | `b5f11eb` | — |
| 9 `test:inbox`, this doc, F-rows | — | — |

---

## 1. What was actually broken

**F-69 was worse than it was filed.** An ungraded Support room rendered grade
**A**, `AVG RESPONSE 38s · TARGET <60S · BEATING`, `CSAT 4.8/5 · 52 RATINGS THIS
WEEK` and `84 REPLIES SENT TODAY` — to a store that had never received a single
message. **CSAT does not exist anywhere in this product**: no column, no
collection, no endpoint, nothing that could ever produce it. It was not a stale
number, it was an invented one, and the `PREVIEW — NO NIGHT-SHIFT GRADE YET`
caption above it made things worse rather than better. A caveat over precise
figures reads as "provisional data", not "fabricated data" — and a founder who
checks 38s against their own inbox stops believing the numbers that ARE real.

**`GET /meta/conversations/:id` was a bare `res.json(conv)` over an unselected
`include`.** Prisma returns every column it knows, so `InboxMessage.rawPayload`
— the entire raw Meta webhook envelope — was shipped to the merchant browser on
every four-second thread poll. Nothing rendered it and nothing ever had.

**The morning brief had zero inbox awareness.** It selected `minutesSaved` and
made no `NovaAction` query at all, so a morning where Nova answered thirty
customers and closed four orders in chat read exactly like a morning where it
did nothing.

**Escalations left the status line stale.** Fixed structurally by module 08 at
every transition the server performs; everything else — a conversation
hard-deleted by the Meta cascade, a manual edit, a process that died between the
claim and the write — had no owner until now.

## 2. Rulings

**R1 — `novaState` stays client-side.** Module 08 explicitly refused to derive
it server-side, in a comment, with a reason: doing so "would mint a second,
quieter definition of what Nova is doing on this thread." Module 10's spec
assigns exactly that to module 10. Honoured module 08's refusal. The thread
endpoint returns the raw columns (`handledBy`, `novaLockedAt`, `escalatedAt`,
`escalationReason`, `novaEnabled`) and the merchant derives the banner from
them. `novaInboxState.js` was NOT built.

**R2 — the inbox door splits OUTBOUND MESSAGES, not `NovaAction`.** The open
question was that `splitByAuthor` does not fit. The premise was right and the
row set was wrong. Every `NovaAction` is Nova's by definition, so reducing that
table gives an empty founder bucket by construction and the door would render
"Nova 100%" as a fact about the world rather than about the table it read.
`InboxMessage.actor` carries `'nova'`, `'founder'` and `'founder_external'` in
one column on one row set — exactly the shape the five Grow doors have.

**R3 — `/nova/inbox-summary` returns `{measured, estimated}`.** Doc 10 specifies
a single `codRevenueBdt`. That breaks module 09's cross-cutting rule 7 on a
brand-new endpoint the day after the module that wrote the rule.

**R4 — the `rawPayload` over-exposure was fixed in the same commit that extended
the handler**, and the whole response is now an explicit projection, so a future
column cannot leak by default.

**R5 — `GET /api/nova/cases` was NOT added to the merchant plane.** It mounts
only on the service-token router; `w()` semantics do not transfer. The three
D13 surfaces that depend on it are not built.

**R6 — no revenue split on the inbox door.** F-71.

**R7 — the promise-carrying draft gets NO edit button**, rather than a disabled
one or an empty form. See §4.

## 3. Frozen contracts

- **`novaInboxSummary.js` is the only definition of the inbox's five figures.**
  Four surfaces read it: the department scorecard, the status line, the Command
  tile, the morning brief. Do not add a sixth by writing the query again — a
  room saying 9 while the dashboard says 12 is a bug a founder can see and
  cannot diagnose.
- **That file imports the Prisma client and nothing else.** The obvious home was
  `novaInboxAttribution.js`, which already held the queries — but it imports
  `inboxSender.js`, so sharing from there would link the entire send path into
  `novaDashboard.js` at boot. `novaInboxStatusLine.js:7-22` records what that
  costs.
- **`handled` counts CONVERSATIONS, not messages.** Counting messages lets a
  chatty reply style inflate the headline number Nova is judged by.
- **`needsYou` is never window-scoped.** "Waiting on you" is a statement about
  right now; a window would quietly retire the oldest, worst-served customers.
- **`actor: 'system'` is credited to NEITHER side of the made-by split**, so the
  two columns do not add up to every reply sent. Test-pinned, so it cannot be
  "fixed" by folding it into one bucket. F-72.
- **An unstamped outbound row is the FOUNDER's**, both server-side
  (`inboxAuthorSplit`) and client-side (`previewAuthor`). Guessing "Nova" would
  credit Nova with the founder's own typing on every shop predating the column.
- **`editableWords` is a server flag, never re-derived on the client.**

## 4. The promise-carrying draft

`editableFieldsFor` returns `[]` for a `send_inbox_reply` whose payload declares
a promise (`novaDecisionEdit.js:136`), and it is not squeamishness:
`payload.promise` becomes a real `NovaPromise` row with a due date tonight's
sweep grades. A founder who rewrites the words and drops the commitment leaves
the debt behind the sentence that created it — the sweep breaks a promise the
customer was never made, and the founder wakes up to a priority-1 "promise
broken" card about a message that never promised anything. No validator can tell
whether edited Bangla still carries the commitment.

The naive draft bar renders EDIT anyway, the founder taps it, and the form opens
with nothing in it — on exactly the drafts that made a commitment, which are the
ones they most want to check.

So EDIT is **absent**, not disabled, and a notice quotes the promise and its due
date. A control that is absent and explained beats one that is present and
inert. `editableWords` is returned as its own flag rather than inferred from
`editable.length > 0`, because an empty array ALSO means "this verb has no edit
spec", and the two must not render the same.

## 5. The test that mattered most was the one that was green and did nothing

Chunk 8's status-line repair passed the full suite on its first run **while
doing nothing at all**: three test fakes had no `inboxConversation.count`, the
refresh threw into its own try/catch by design, and 1889 tests stayed green.
It was caught by grepping the suite output for the catch's own log line.

All three fakes are fixed, and three tests now assert the line is written from
the whole queue, cleared at zero, and repaired even when the SLA rollback lever
is down.

**The general rule this leaves behind:** a swallowed error plus an incomplete
fake is indistinguishable from a working feature. If a change adds a
`try/catch` that logs, grep the suite output for that log before believing the
green.

## 6. Merchant render rules moved out of `.jsx` so they could be tested

This repo has no DOM harness — `test:nma` is `node --test` over plain modules.
A rule inside a component therefore cannot be imported, and cannot be wrong in a
way anything notices. F-69 was live and wrong for two whole modules for exactly
that reason.

`src/lib/novaInboxView.js` now holds the five that decide whether a founder is
told something true: `mergeRoom`, `inboxTileState`, `doorOutcome`,
`previewAuthor`, `draftControls` (+ `rejectionFromPrompt`). 17 tests,
`npm run test:inbox`. Two were verified to bite by reverting the fix and
confirming red.

## 7. Known-not-built

F-71 … F-75, plus the R5 refusal. Headlines: the inbox door reports counts and
cannot honestly report revenue; `nova + founder` deliberately does not equal
every reply sent; `novaBrief.js` still hardcodes a +06 day because its dedupe key
is derived from the same function; the tile's window is fixed at 7 days with no
picker; `InboxMessage` has no index for the attribution door's query.

Still open from module 09 and not module 10's to close: the five producerless job
lanes (`night_ops`, `morning_report`, `pulse`, `weekly_strategy`, `reflection`),
and the `conversation.taken_over` event queue that has no drainer.

## 8. Baselines at close

| | |
|---|---|
| dakio-api | **1889 pass / 0 fail**, 1 skipped (1872 at module 09's close) |
| new integration tests | 10 (`novaInboxSummary.integration.test.js`, real Postgres, wired into `npm test`) |
| merchant `test:inbox` | **17 pass / 0 fail** — the repo's second test script |
| merchant build | clean |
| Migrations | **none** this module |

## 9. If you are starting module 11

1. **`novaInboxSummary.js` is where inbox numbers come from.** Anything that
   reports on the inbox reads it. Adding a query is how the drift starts.
2. **The draft bar is the only place a founder can approve a reply in context.**
   Module 11's promise work will want to make the promise itself editable — that
   is the `NOT-BUILT, WITH AN OWNER` note at `novaDecisionEdit.js:132`, and
   `editableWords` is the flag that flips when it lands.
3. **`/nova/attribution` now has a sixth door with a different reduction.** Do
   not assume `splitByAuthor` for anything new; ask first whether both
   populations exist in the row set.
4. **The status line has a repair on a ten-minute clock** (`inboxSlaSweep.js`).
   It runs before the SLA rollback lever, deliberately.

**What you must not break:** the estimated/measured separation on every surface;
`novaInboxSummary.js` as the single definition; honest-empty rendering (no
fixture fallback, no zeros standing in for a failed request or a disconnected
Page); the absent-not-disabled EDIT button on a promise-carrying draft.
