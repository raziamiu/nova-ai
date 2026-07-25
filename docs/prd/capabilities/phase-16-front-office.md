# Phase 16 — Stage 10 "Front Office" · capability report

- **Status:** in progress (module 01 shipped · module 02 in build)
- **Branch / commit:** `feat/front-office` @ (open)
- **Date:** 2026-07-25
- **Blueprint:** `docs/blueprint/16-stage10-front-office/` (13-doc module suite)

> Front Office is the phase where Nova stops being the founder's operator and
> starts being the shop's front desk: a customer messages the store's Messenger
> or Instagram page, and Nova answers — in the customer's own script, at a
> human pace, under the same autonomy pipeline every other Nova action goes
> through. No customer-visible byte exists unless a `send_inbox_reply` action
> passed `evaluateAuthority` and dakio-api performed the Meta send.

> **This report is a stub, opened during the build.** Fill the gate table,
> matrix updates and scenario walkthroughs at the phase gate; do not mark a row
> done that the code can't back up.

## Gate (all must be green)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean (modules 01 + 02 integrated) |
| `npx eve build` | ✅ clean |
| `npx eve info` diagnostics | ✅ 0 errors, 0 warnings |
| `check:undo` / `check:duty-seed` | ✅ 14 verbs audited · 67 duties mirrored |
| This phase's suites | `test:inbox` 186 checks · `test:persona` 145 checks (+1 loudly skipped live pass) |
| Prior suites still green | `test:jobs` 39 · `test:spine` 33 · `test:memory` 40 · `test:duties` 39 · `test:authority` 66 · `test:decisions` 34 · night/voice/generate/conversation/reach/research/presence/team/launch all green · `test:isolation` 43/44 (pre-existing founder-stack context-budget failure, 2987 tok — unchanged by this module) |
| dakio-api | `npm test` — 846 tests, 845 pass, 0 fail, 1 skipped (806 before module 02) |

## Modules

| # | Module | Status | Evidence |
|---|---|---|---|
| 01 | **Inbound pipe** — webhook → `InboxMessage` → coalesced delivery to Nova, with the fallback job lane | shipped | dakio-api `src/routes/novaInbox.js`, `src/lib/inboxDelivery.js`, `src/lib/novaEvents.js`, `src/lib/novaIdempotency.js`; nova-ai `agent/channels/customer.ts` (HMAC route, busy-409, kill switch), `agent/lib/customer/principal.ts`, `agent/channels/internal.ts` (`inbox_reply` fallback), `evals/inbox/run.ts` |
| 02 | **Conversation runtime** — the shopkeeper session: persona stack, the customer register, the two verbs, the human-timing send engine | built, integrated (gate demo pending) | nova-ai `agent/instructions/50-customer-inbox.ts`, `agent/skills/inbox-conversations.ts`, `agent/lib/customer/{persona,language}.ts`, `agent/tools/{reply_in_thread,flag_handover,get_conversation}.ts`, `agent/lib/nova/inboxIntents.ts`, verb rows in `types.ts`/`schemas.ts`/`autonomy.ts`/`authority.ts`/`activity.ts`/`executors.ts`/`duties.ts`; dakio-api `src/lib/inboxSender.js`, `POST /api/v1/inbox/conversations/:id/{reply,typing,handover}` + `GET /conversations/:id` in `src/routes/novaInbox.js`, `EXECUTORS.send_inbox_reply` + `ADVISORY.escalate_conversation` in `src/lib/novaExecutors.js`, `ATTRIBUTABLE.inbox_message` in `src/lib/novaLedger.js` |

## New capabilities (module 02, as built)

- **One durable session per conversation** — `customer:inbox:<conversationId>`,
  minted from a verified HMAC call, `principalType:'customer'` so every
  trust-plane tool denies it structurally — `agent/lib/customer/principal.ts`.
- **The customer register loads only for customers** — `50-customer-inbox.ts`
  resolves on `authenticator === 'dakio-inbox'`; founder layers 10–40 return
  `null` on the same predicate. Regression net: the founder-bleed section of
  `evals/inbox/run.ts` (zero founder-plane markers in a customer prompt).
- **Per-tenant persona without per-tenant prompts** — registry + `brand` memory
  + six `inbox.persona` knobs, every field defaulted —
  `agent/lib/customer/persona.ts`.
- **Script mirroring, measurable** — deterministic bn/banglish/en detection
  (`agent/lib/customer/language.ts`) and the mirror gate over the blueprint's
  worked corpus — `evals/inbox/persona.ts`.
- **The twelve bot tells, as CI lints** — banned corporate register, markdown,
  question-echo, model-speak, "Dear", signatures, over-answering, ungrounded
  numbers — `evals/inbox/persona.ts`. Tell 1 (instant reply) is wall-clock and
  is owned by dakio-api's `inboxSender` pacing tests.
- **Identity honesty floor** — ~40 bot-question phrasings in three registers are
  recognized; the three approved disclosure lines render from the persona
  module and are asserted to claim no humanity, carry no model-speak, and never
  be volunteered unasked — `evals/inbox/persona.ts`.

- **Approval actually sends** — `EXECUTORS.send_inbox_reply` re-runs the reply
  route's own guard ladder (the same exported `enqueueInboxReply`, never a
  second copy) with `timing.mode:'instant'`, so a founder approving a draft
  cannot bypass "the customer wrote again since"; a 409 there reports
  `executed:false` and never a claimed send — `src/lib/novaExecutors.js`,
  `src/lib/novaExecutors.test.js`.
- **Every bubble resolves to its receipt** — `ATTRIBUTABLE.inbox_message` stamps
  the `InboxOutbound` (and any bubble already landed) with the real ledger row
  id, so the "BY NOVA" drawer in /inbox opens on the decision that authored the
  message — `src/lib/novaLedger.js`, `src/lib/novaLedger.test.js`.

## Known limitations / not yet

- `NOVA_CUSTOMER_TURNS_ENABLED` ships **default-off**; the founder flips it.
- **The D11 slim tool set is not enforced.** eve 0.25's `defineDynamic` ADDS to
  the authored tool set; there is no per-session subtraction, so a customer
  session can still see the founder's tools. The trust plane is safe regardless
  (`principalType:'customer'` is denied structurally) and the register now names
  only the five tools that exist and tells the model the rest belong to the
  owner's side — but that is an instruction, not a gate. Closing it means
  wrapping each founder tool file in the same `isCustomerSession` gate the
  instruction layers use. Tracked as the top open risk for enabling the flag.
- **`agent/instructions.md` is still the static founder root layer** (2566 tok),
  so a customer session would render it alongside the register. Moving it behind
  a founder gate is the module's own D11 audit item; it also fixes the
  pre-existing `test:isolation` context-budget failure, whose check reads that
  file by path.
- The register advertises only shipped tools; `link_customer` (03),
  `get_product`/`get_order_status`/`validate_coupon` (05) and
  `schedule_follow_up` (04) stay in `SLIM_TOOLS_PENDING` until their modules land
  — the inbox eval fails in both directions if the list and `agent/tools/`
  disagree.
- The live-model behavioral pass is opt-in (`npm run test:persona:live`) and
  needs a gateway credential; without one it skips loudly and says so.
- `POST /conversations/:id/handover` ships here and really escalates, but it
  authors no Decision (`decisionId:null`) and sends no holding line
  (`holdingSent:false`) — module 08 owns both, and the route says so rather than
  pretending. Outbound photo bubbles and IG `sender_action` GA are v2.

## Matrix updates

Pending — update `docs/prd/capability-matrix.md` at the phase gate.
