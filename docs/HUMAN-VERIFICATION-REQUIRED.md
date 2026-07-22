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
| H-3 | ⬜ | **Confirm migration `20260722120000_nova_stage0_spine` deployed to Railway** and the app came up clean. | Applied to local Postgres (`:5433`) only — by design. Railway gets it through the deploy pipeline, which I don't run. `RELEASE_CHECKLIST.md` exists for exactly this; the 2026-07-01 P0 was an uncommitted migration. | Anything Nova does in production |

## Needs a real external account

| # | Status | What to do | Why I can't |
|---|---|---|---|
| H-4 | ⬜ | **Publish one Grow post to a real connected Facebook Page** and confirm it appears, then confirm the stored `externalIds.fb` opens it. | Needs a connected Page + real page token. The refusal paths are tested (no Page → 409, IG-only → 409, never marks Published); the success path hits Graph and can't be faked without lying about a publish. |
| H-5 | ⬜ | **Decide the Meta ads posture.** Today: `ads_read` only, zero `ads_management`. Stage 3's live mutation is organic FB publish, which works. Paid-ads write is a separate app-review + scope decision. | Product/legal decision, not a code one. |

## Verification I attempted but couldn't complete

*(Populated as I go — each entry says exactly how far I got.)*

| # | Status | What to do | How far I got |
|---|---|---|---|
| H-6 | ⬜ | **Visually check the merchant Coupons page**: `by:nova` chip renders on Nova-authored coupons, clicking it opens the receipt drawer with evidence/before/after, and the sidebar presence dots appear. | *Pending — I'll fill in what I could and couldn't verify when I build it.* |

## Pre-existing problems I found but did not touch

| # | Status | What | Detail |
|---|---|---|---|
| H-7 | ⬜ | **`dakio-api/src/routes/store.shipping.test.js` fails 3 checks.** | Not caused by Nova work — verified by stashing my changes and re-running at HEAD (3 failures before, 3 after). Root cause: `src/lib/studioCatalog.js` imports `prisma.js` under `--experimental-test-module-mocks` and gets *"The requested module './prisma.js' does not provide an export named 'default'"*. Someone should decide whether to fix the mock or drop the file from the hermetic list — it's red in CI either way. |

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

## Standing context for whoever picks this up

- **Local DB is safe to seed** (`localhost:5433`). Railway prod URL is line 1 of
  `.env` and is **commented out**; dotenv is first-wins. Verify that before any
  migration or seed command.
- **Receipt rule (PRD §16.2):** a write missing its receipt is a failed write.
  The API enforces it with a 422 on every status, including `blocked`.
- **Attribution is metadata, never authority.** A door row with a null
  `novaActionId` is still a valid row; the NovaAction ledger row is the truth.
- **Tenancy comes only from verified auth**, never from model input.
