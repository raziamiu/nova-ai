# Module 09 — Ledger & Attribution: AS BUILT

Branch `feat/front-office` in `nova-ai`, `dakio-api` and now `dakio-merchant`
(the merchant branch was created this session from `develop` after resolving a
half-finished merge; merchant `develop` is 5 ahead and **not pushed**).

| Chunk | dakio-api | nova-ai | merchant |
|---|---|---|---|
| 1 basis reconciliation + escalation minutes | `2c3beb3` | `4c167a1` | — |
| 2 migration: `metricKey`, 4 indexes | `84f5f5f` | — | — |
| 3 the nightly sweep | `2b96bb8` | `351fa62` | — |
| 4 scorecard tiles | `758dbd0` | — | — |
| 5 measured/estimated split, export, doors | `9f18db7` | — | — |
| 6 `NovaAchievement` + evaluator | `fd242e9` | — | — |
| 7 milestone strip, Inbox door | — | — | `3812c4a` |

---

## 1. The spec was wrong in ~40 places. Five broke its design.

Verified by hand, not taken from recon:

1. **`kind:'chat_order'` does not exist.** Writers emit `order_created` (approve)
   or `action` (agent). D6's rewrite lookup, D7's `chat_revenue` and D9's revenue
   rules all keyed off a string nothing writes.
2. **`revenueBasis` contradicted itself for one verb.** Approve path wrote
   `'measured'` at creation; agent path wrote `'estimated'`. D6's idempotence is
   "fire only on `estimated`", so it would have skipped the commonest path.
3. **`night_ops` has no producer.** `PLATFORM_JOB_DEFS` holds five kinds and
   `night_ops` is not one; the file's own comment says a def-only lane "ships
   dark". D6's entire honesty engine would never have run once.
4. **`NovaScoreMetric` could not hold the registry.** No `metricKey` column, POST
   capped at 6/dept/day, room served 3 with no day filter.
5. **The NDJSON export streamed `NovaAction` only**, and every revenue field
   lives on `NovaActivity`. The module's headline promise and its own gate were
   unmeetable.

**And the spec cites a "canonical §2.5/§2.6/§2.8/§2.15/§2.17" document as its
authority for four closed sets. No such file exists anywhere under
`D:\Dakio Apps`.** Only `09-*.md:122` and `10-*.md:307` reference it. Treat every
"canonical §2.x" citation in the remaining module docs as unverified.

## 2. Three defects found that the spec never mentioned

- **Escalations were worth ZERO minutes** and filed as `recommendation_ack`.
  `escalate_conversation` had no `ADVISORY_NOTE` entry, so it fell through to the
  branch written for verbs that changed nothing. Knowing when to stop and call the
  founder is the most valuable thing Nova does in an inbox, and every escalation
  the product ever raised undercounted saved hours and landed in the wrong room.
- **`/nova/home` summed estimated and measured** into one scalar — the exact thing
  the module's own cross-cutting rule 7 forbids, on the endpoint the founder's
  dashboard reads.
- **The room scorecard could mix days.** `orderBy day desc, take 3` with no day
  filter renders three tiles from up to three different days as one picture.

## 3. Frozen contracts

- **Both writers emit `revenueBasis: 'estimated'` at creation.** Only the sweep
  may write `'measured'`. Do not reintroduce a caller-supplied basis — that is
  exactly how the two writers came to disagree.
- **`revenueProvenance: 'chat_order:<orderId>'` is the join key**, byte-identical
  on both sides. Matching on `NovaActivity.kind` is not viable: free text, 14+
  live values, no enum, and the two writers disagree about it.
- **`FAILED` counts as a return** alongside `RETURNED` and `CANCELLED`. Steadfast
  has no return string; RedX and Pathao map every return variant to `FAILED`.
  Reading only `RETURNED` leaves most RTO revenue claimed forever. Test-pinned.
- **An RTO save claims zero revenue.** The chat-order activity already claims that
  order's total; a save row claiming it again counts one parcel twice.
- **Achievement "once, ever" is the unique index**, not evaluator memory. Insert
  and swallow P2002.
- **`first_delivered_chat_revenue` requires revenue > 0.** A returned parcel is
  zeroed *and* `measured`, so "any measured row" would congratulate a shop for a
  parcel that came back.
- **The pass lives in `SERVER_SWEEPS`**, scheduled 05:00 after `journey_sweep` at
  04:30 — the reducer writes the stage the sweep reads.

## 4. Decisions

**R1 — server sweep, not a night_ops pre-step.** No producer, and a pre-step still
hands the turn to a model. This is arithmetic over the founder's own rows.

**R2 — both writers estimate; only the sweep measures.** Prerequisite for R1's
idempotence to mean anything.

**R3 — no invented `chat_order` kind.** Key on provenance.

**R4 — `metricKey` is a column, not `label`.** `label` is display copy, is
model-authored on the legacy path, and keying an upsert off it means one wording
change orphans a metric's history.

**R5 — ship the v1 tiles, file the ~40-key registry.** It has no storage and no
reader; building it would repeat module 07's F-61.

**R6 — five tiles deliberately not built**, reasons in `novaInboxAttribution.js`
rather than a doc. A tile that cannot be computed honestly is worse than a missing
one: a founder reads a zero as "this did not happen", not "nobody measured".

**R7 — the module's eval surface is the 14 integration tests, not a nova-ai
suite.** Every mechanism here is server-side arithmetic over Postgres rows; a
nova-ai eval could only assert that constants exist. The `Decimal` round trip and
the unique index's NULL semantics are precisely what a fake would imitate wrongly.

## 5. Known-not-built

See F-65…F-70. Headlines: the five uncomputable tiles; the ~40-key registry;
`conversation.taken_over` events have no drainer and accumulate forever
(`novaEvents.js:83-85` names module 09 as owner); `useNovaRoom` falls back to a
mock fixture for grade/score so an ungraded dept renders invented numbers;
`night_ops`/`morning_report`/`pulse`/`weekly_strategy`/`reflection` still have no
producer; nova-ai's `reflection` job runs a competing cart-recovery attribution
with a different provenance format.

## 6. Baselines at close

| | |
|---|---|
| dakio-api | **1872 pass / 0 fail**, 1 skipped |
| nova-ai `test:inbox` | 823 checks |
| `check:undo` / `check:reachability` / `check:duty-seed` | 25 / 25 / 72 |
| `tsc --noEmit` | clean |
| dakio-merchant | builds clean |
| Migrations | **two** this module (64 on disk); **9 unmerged** — F-19/F-50 |

## 7. If you are starting module 10

Module 10 is the render layer for what this module computes. Three things it
inherits:

1. **`/nova/home` now returns `revenueToday: {measured, estimated}`** alongside the
   legacy scalar. The scalar is kept for compatibility and must never be labelled
   "earned". Module 10 owns the render that consumes the split.
2. **The rooms payload carries `achievements[]`**, and `NovaMilestoneStrip`
   already renders it. What module 10 owns is `FeedMilestoneRow`, the `InboxTile`,
   the `DOOR_OUTCOME.inbox` formatter and the weekly INBOX verb-grouping.
3. **`MadeBySplit` will render the inbox door with a blank outcome line** until
   module 10 adds `DOOR_OUTCOME.inbox` — `NovaCommand.jsx:228-241` returns
   `undefined` for an unknown key. Degraded, not broken.

**What you must not break:** the estimated/measured separation on every surface;
provenance as the join key; zero-revenue RTO saves; honest-empty rendering (no
fixture fallback for achievements).
