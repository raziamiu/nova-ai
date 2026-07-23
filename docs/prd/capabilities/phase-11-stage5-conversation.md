# Phase 11 — Stage 5: Conversation · capability report

- **Status:** **foundation built and verified; live-model wiring pending.** The
  deterministic spine of the chat agent — the intent table, the typed reply
  envelope, the thread/message data model + persistence, contextual chips, the
  routing contract, and the org lock — is done and tested. The half that only a
  live model can prove (routed replies across the 9 department subagents, the
  real eve stream in the merchant dock, the 10-intent live corpus + grounding
  audit) is **not** signed and is called out below honestly.
- **Branch / commits:** `develop` — nova-ai `9d1b48e` (intent table + envelope) ·
  `13409f9` (routing contract + disableTool); dakio-api `b4786e2` (thread/message
  models + persistence + chips)
- **Date:** 2026-07-23
- **Blueprint:** `docs/blueprint/11-stage5-conversation.md`

> Stage 5 is the chat agent: one persistent thread where the founder talks to
> Nova, CEO-Nova routes to the right department, every number is grounded in the
> ledger, and chat verbs are the same primitives as UI verbs. This phase built
> everything that can be made true and checkable WITHOUT a model in the loop, so
> the model-driven half lands on a verified, honest base.

## Gate

| Check | Result |
|---|---|
| `npx tsc --noEmit` (nova-ai) | ✅ clean |
| `npx eve build` / `eve info` | ✅ built, **0 diagnostics** (routing compiled in, built-in `agent` tool disabled) |
| nova-ai suites | prior suites + **conversation 17** — green |
| dakio-api hermetic | ✅ **745 pass / 0 fail** (+8 novaChat) |
| chat persistence (live) | ✅ founder msg 201, agent reply 201, bad signature 422, ungrounded number 422, thread returns both + chips |

**PRD gate — NOT met (by design of this chunk).** §15 Stage 5 wants *10 mixed
asks/commands live: every answer grounded, every action receipted, one
over-authority ask refused + escalated — 10/10, no hallucinated numbers
(spot-audited vs ledger).* That is a **live-model** gate: it needs the routed
subagents answering real asks and the grounding audit re-running their numbers.
This phase delivered the substrate that gate runs ON; the gate itself is the
next chunk (11-D/E) and is unsigned.

## New capabilities this phase

- **Intent table (FR-7).** `agent/lib/chat/intents.ts` — every founder ask is a
  ROW: intent → owning department → the primitive verbs it uses (the SAME tools
  the UI verbs call). The routing prompt is GENERATED from the table, so it can't
  drift from what's supported. H2 intents (playbook approve, negotiation,
  benchmarks, promote-agent) ship now as honest deferrals from the same table —
  the model answers "that arrives with the Team stage", never improvises.
- **Typed reply envelope.** `agent/lib/chat/envelope.ts` — a department subagent
  returns `{agentId, text, stats[], optionRefs[], actionRef?}`, validated before
  persistence: the signature must be a real department, every number names the
  tool+params that produced it (grounding, capped at 8), chips ≤3. `parseEnvelope`
  rejects a hallucinated signature / ungrounded number / over-cap array.
- **Thread + message model + persistence.** `NovaChatThread` (one persistent
  thread per store; eve sessions rotate beneath it) + `NovaChatMessage` (E-16,
  with signature + grounding + chips). Merchant `GET /chat/thread` (cursor-paged
  + chips) and `POST /chat/messages` (founder message durable first); agent-data
  `POST /chat/messages` (agent reply from the envelope, validated server-side)
  and `POST /chat/rotate` (session handle across rotation).
- **Contextual chips.** `computeChips` builds suggestion verbs from live state
  (pending decisions, flagged drafts) + a safe default — not canned FAQs.
- **Router enforcement.** The routing contract lives in the root instructions,
  generated from the intent table; `disableTool()` removes the built-in `agent`
  self-copy so every delegation flows through one of the 10 named departments
  (the 11-agent org, mechanically enforced).

## Known limitations / not yet (the live-model half — 11-D/E)

- **Subagents don't yet return the typed envelope.** `outputSchema` on the 9
  department subagents + the `turn.completed` persistence hook is the wiring that
  turns a routed reply into a persisted `NovaChatMessage`. It's config that only
  a live model exercises meaningfully, so it lands with the stream (11-D), not
  compiled blind here.
- **Merchant chat is still the mock dock.** `NovaChat`'s scripted `buildChatReply`
  is untouched; wiring it to the real thread APIs + the eve stream (stream reducer,
  `input.requested`, token recovery) and deleting the script is 11-D.
- **No grounding audit harness yet.** `evals/conversation/audit.ts` (re-run each
  stat ref against the store, diff values) is the gate's spot-audit evidence — it
  needs real routed replies to audit, so it lands with the live corpus (11-E).
- **The 10-intent live corpus (bn+en) is unwritten.** The §15 gate itself.

## Matrix updates

Rows changed in `docs/prd/capability-matrix.md`: Stage 5 / Phase 11 build-status
(foundation built — chat substrate, intent table, envelope, persistence,
routing; live-model gate pending).
