# Human verification required

Things I cannot honestly verify myself. Each one is either **gated on a
credential/environment I don't have**, or **inherently requires a human** (the
PRD's own gates say so). Nothing below is claimed as done anywhere else in the
repo — capability reports and the matrix stay honest about these.

**Status key:** ⬜ waiting on you · ✅ you confirmed · ❌ you found a problem

Update the status column when you get to one. If you hit ❌, note what broke —
I'll pick it up from here.

---

## Blocking a phase gate

| # | Status | What to do | Why I can't | Blocks |
|---|---|---|---|---|
| H-1 | ⬜ | **Run the Stage 0 scripted demo as a non-builder.** PRD §15: create a coupon as Nova → it shows in the Coupons door + live feed within 3s with a receipt → undo removes it → ledger shows both the action and the undo. Record it, file the ledger export. | The PRD gate explicitly requires *someone who didn't build it* to run the script. Me running it proves nothing about whether it's usable. | Phase 06 sign-off |
| H-2 | ⬜ | **Run `scripts/stage0-gate.ts` against staging with a real merchant JWT.**<br>`NOVA_STORE_BACKEND=dakio NOVA_GATE_TENANT=<id> NOVA_GATE_MERCHANT_JWT=<jwt> npx -y tsx scripts/stage0-gate.ts` | Without the JWT the harness **skips** (loudly, never silently passes) the SSE ≤3s check, the door `novaActionId` check, and the merchant ledger export — i.e. 3 of the gate's most load-bearing assertions. | Phase 06 sign-off |
| H-3 | ⬜ | **Confirm the Nova migrations deployed to Railway** and the app came up clean. Three now: `20260722120000_nova_stage0_spine`, `20260723100000_nova_stage1_law`, `20260723140000_nova_department_rename`. | Applied to local Postgres (`:5433`) only — by design. Railway gets them through the deploy pipeline, which I don't run. `RELEASE_CHECKLIST.md` exists for exactly this; the 2026-07-01 P0 was an uncommitted migration. **The department rename UPDATEs existing rows**, so it's the one to watch. | Anything Nova does in production |
| H-9 | ⬜ | **Run the Stage 1 scripted demo as a non-builder.** PRD §15: a bulk refund is refused + escalated; an over-cap campaign is downgraded to a decision (not blocked); adding a no-touch lock freezes a pending decision. Then replay the same three as raw API writes and confirm all are rejected. | Same reason as H-1 — the gate wants someone who didn't build it. Every behaviour is unit-proven (63 authority checks + 8 integration checks), but "it works" and "a founder can follow the script" are different claims. | Phase 07 sign-off |
| H-11 | ⬜ | **Run the Stage 2 scripted demo as a non-builder.** PRD §15: one decision visible on desk + room + module; approve on the desk → it executes, flips the plan item, logs the feed; Later requeues to the back; adding a no-touch lock freezes it. One record, four surfaces, zero drift, zero manual DB pokes. | Same reason as H-1 and H-9. The behaviours are covered by 18 integration checks plus a real-browser approve round-trip, but "it works" and "a founder can follow the script" are different claims. **Note:** approve does not execute the linked action yet (phase 09) — the demo script needs that caveat or it will look like a failure. | Phase 08 sign-off |
| H-12 | ⬜ | **Decide the trust formula.** PRD §18 lists it as an open product decision and it is currently a documented placeholder (`src/lib/novaTrust.js`, `computeTrust`). | It is a product judgement about how Nova earns more rope, not an engineering one. The seam is isolated so changing it is a one-function edit, and the inputs are persisted so past scores can be recomputed against a new formula. | L4 promotion being meaningful |
| H-16 | ⬜ | **Run the Stage 3 scripted demo as a non-builder, on TWO stores.** PRD §15: night shift → 06:00 brief with a scale decision → approve → live in Campaign Manager → receipt → undo, twice, on two clean staging stores, no engineer touching anything after "run night shift". The gate is scripted: `NOVA_STORE_BACKEND=dakio NOVA_GATE_TENANT=<A> NOVA_GATE_TENANT_2=<B> NOVA_GATE_MERCHANT_JWT=<jwt> npx tsx scripts/stage3-gate.ts` (10/10 on a single store locally today). | Same reason as H-1/H-9/H-11 — the §15 gate wants someone who didn't build it, and a *second* clean store to prove operational isolation. Every step is machine-asserted by the gate script + covered by the night eval (13) and executor/brief hermetic tests (20); "it passes the script" and "a non-builder ran it on two real stores" are different claims. **Note:** on a store with no connected Facebook Page the publish path honestly prepares rather than publishes — that's correct, not a failure; the campaign door write + receipt + undo still complete. | Phase 09 sign-off (the company milestone) |
| H-10 | ⬜ | **Watch the first CI run.** `.github/workflows/gates.yml` (nova-ai) and `tests.yml` (dakio-api) are new and have never executed on GitHub. | I verified both locally, but a runner differs — Node version resolution, `npm ci` against the committed lockfile, and whether `npx eve build` works without the local `.eve` cache. If it goes red, it's the workflow, not the code. | Nothing — but a red badge is worth 5 minutes |

## Needs a real external account

| # | Status | What to do | Why I can't |
|---|---|---|---|
| H-4 | ⬜ | **Publish one Grow post to a real connected Facebook Page** and confirm it appears, then confirm the stored `externalIds.fb` opens it. | Needs a connected Page + real page token. The refusal paths are tested (no Page → 409, IG-only → 409, never marks Published); the success path hits Graph and can't be faked without lying about a publish. |
| H-5 | ⬜ | **Decide the Meta ads posture.** Today: `ads_read` only, zero `ads_management`. Stage 3's live mutation is organic FB publish, which works. Paid-ads write is a separate app-review + scope decision. | Product/legal decision, not a code one. |

## Verification I attempted but couldn't complete

*(Populated as I go — each entry says exactly how far I got.)*

| # | Status | What to do | How far I got |
|---|---|---|---|
| H-6 | ⬜ | **Sanity-check the Coupons UI on a real screen** (yours, not headless) at desktop and phone width. | Mostly done, and further than expected. I drove headless Chrome against the local API with a seeded Nova-authored coupon and confirmed from the live DOM: the chip renders, the drawer opens with why / expected impact / 2 evidence rows with metrics / before→after diff / confidence / undo window / ledger id, and the nav dot lands on Coupons. It caught a real bug — the lime dot was invisible on the lime *active* nav item; fixed with a `color` prop (now ink-on-lime). Left for you: it's still a headless render at two fixed widths, so judgement calls (does the chip crowd the code on a small phone, is the drawer's density right) want human eyes. |
| H-8 | ⬜ | **Delete the seeded demo coupon when you're done looking at it.** Coupon `WINBACK10` ("Lapsed-buyer winback") + its NovaAction exist in your **local** DB (`localhost:5433`, tenant *Mayer Doya Store*) so the chip has something to attach to. Nothing was written to Railway. | Deliberately left in place so you can see the feature immediately. Delete the coupon in the UI and the action row with `DELETE FROM "NovaAction" WHERE title LIKE 'Create 10%% winback%%'`. |

## Pre-existing problems I found but did not touch

| # | Status | What | Detail |
|---|---|---|---|
| H-7 | ✅ RESOLVED | ~~`dakio-api` `npm test` broadly red~~ | **Fixed — 55 failures to 0** (commit `b68d0b2`). Root cause: `t.mock.module` was called with an `exports:` key that Node ignores (it wants `namedExports:` / `defaultExport:`), so every prisma-mocking test received an empty mock and died at import. 170 call sites across 37 files converted, each file verified on its own. Two genuine failures fixed separately: an NTFS-impossible `0600` permission assertion now skips loudly on Windows (the guarantee is real on the Linux deploy target), and the OTP fail-closed test now asserts both real contracts instead of one the product had superseded — see **J-1**. |
| H-13 | ⬜ | **`eve dev` and local `eve eval` startup are broken (eve 0.25.2).** The generated dev-host `.eve/dev-hosts/<id>/nitro/dev/index.mjs` imports `src/internal/authored-module-map-loader.ts` — a path this project (source lives in `agent/`, there is no `src/`) never has, and that eve does not generate. Every run dies `ERR_MODULE_NOT_FOUND` before Nova processes anything (`observed tools: []`). Clearing `.eve/dev-hosts`/`dev-runtime`/`locks` and rebuilding did NOT fix it — eve regenerates the same broken import. **Workaround that works today:** `eve start --port 2010` (production `.output` build — comes up clean) then `eve eval --url http://localhost:2010 …` and the browser console at `http://localhost:2010`. Against that running server the agent is healthy: `nova/business-pulse` 5/5, `nova/autonomy-gating` 4/4 (blocks a 35% discount over the 20% cap, honestly). Needs an eve-side fix or a version bump; it is an eve dev-host generation bug, not Nova code. |
| H-14 | ⬜ | **`nova/morning-report` eval is stale.** It calls schedule id `morning-report`, but the agent now exposes a single `dispatcher` schedule (`404 Unknown schedule "morning-report"`), and `dispatchSchedule()` also needs dev routes — which only the (broken, H-13) dev-host provides, so it can't run against `eve start` either. Update the eval to dispatch `dispatcher`, or restore a named `morning-report` schedule. `nova/cart-recovery` scored 4/5 for a possibly-correct reason: Nova swept the carts and checked discounts but did **not** call `send_customer_message` — consistent with the honest "no real send channel" rule, so the eval's expectation may be what's wrong, not Nova. Both are eval-harness drift, not shipped-behavior bugs. |
| H-15 | ✅ RESOLVED | ~~Merchant `/login` infinite reload loop~~ | **Fixed** (`dakio-merchant` develop `ae5fa57`). The 401 response interceptor hard-set `window.location.href='/login'` even when already on `/login`; a stale token in localStorage made a provider (`AuthContext`/`GrowContext`) fire an authed call on mount → 401 → reload → remount → loop. Guarded the redirect on public auth pages (mirroring the `/plan-expired` branch that already did this). Reproduced + confirmed via headless CDP: 5 reloads → 1. Same commit also hydrates client `hired` from `GET /nova/instance` so a fresh browser reaches HQ instead of bouncing to `/nova/onboarding` (FR-1 server truth). |

---

## Where the code is (branch split)

From 2026-07-23, Nova work goes to a **`develop`** branch in every repo it
touches, so `main` stays reviewable and production-safe until you merge.

| Repo | `main` has | `develop` has |
|---|---|---|
| `nova-ai` | phase 06 chunks A–H + D2 (7 commits) | everything from chunk I onward |
| `dakio-api` | phase 06 backend (4 commits, **includes a migration**) | everything from chunk I onward |
| `dakio-merchant` | untouched by Nova work so far | all Nova merchant UI |

⚠️ **The dakio-api phase-06 commits are already on `main`** — pushed under the
standing commit-and-push instruction, before the branch policy existed. That
includes migration `20260722120000_nova_stage0_spine`. If Railway auto-deploys
`main`, it has already been applied there; **H-3 is how you confirm it.**
Nothing has been pushed to `main` in any repo since the policy took effect.

`nova-ai` and its demo seeds have no production surface, which is why D2
(demo/eval data only) was allowed to finish on `main` before the split.

---

## Judgement calls I made that you may want to revisit

These were mine to make to keep moving, but they are the kind of call you might
decide differently. Nothing here is blocking.

| # | What | My reasoning |
|---|---|---|
| J-1 | **The OTP dev bypass is now pinned by a test rather than flagged as a bug.** In any environment where `NODE_ENV` is not exactly `"production"`, a failed verification email returns the OTP inline (HTTP 200) and leaves the `EmailOtp` record live, instead of failing closed. `src/routes/auth.js:104-118`. | Judged intentional and internally consistent rather than a leak: the SUCCESS path already returns `devOtp` in non-production, so the failure branch discloses nothing the success branch doesn't in the same environment; and deleting a record whose code *was* delivered (inline, in the response) would break the very flow the bypass exists to enable. Git backs this — the test predates the bypass (`1954c8e`), and `d0bd276` added it deliberately under its own feature name. `NODE_ENV=production` is load-bearing, documented deploy config. **But** it is a security-shaped guarantee resting on a single env var, so if you'd rather it fail closed everywhere, that's a one-line inversion — say the word. The test now pins BOTH paths, so neither can drift unnoticed. |

## Standing context for whoever picks this up

- **Local DB is safe to seed** (`localhost:5433`). Railway prod URL is line 1 of
  `.env` and is **commented out**; dotenv is first-wins. Verify that before any
  migration or seed command.
- **Receipt rule (PRD §16.2):** a write missing its receipt is a failed write.
  The API enforces it with a 422 on every status, including `blocked`.
- **Attribution is metadata, never authority.** A door row with a null
  `novaActionId` is still a valid row; the NovaAction ledger row is the truth.
- **Tenancy comes only from verified auth**, never from model input.
