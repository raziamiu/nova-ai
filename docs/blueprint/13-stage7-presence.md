# Phase 13 — Stage 7 "Presence" (H1): Voice, Memory H1.2, Watchdog, Hours-Saved, Tonight's Plan

**PRD stage:** Stage 7 (PRD §15) · **Prereqs:** 08 (decisions — voice approves the same
records), 09 (brief — the briefing call speaks it), 10 (drafts — the taught-rule gate
step), 11 (chat — push/call routing shares the intent table). Owners: AI + Backend.
Self-contained. Nova gains presence: it calls, it listens, it remembers corrections with
receipts, and the founder can run an entire day without touching the screen.

## Already real vs to build

| Capability | Today (repo audit) | This phase |
|---|---|---|
| Voice infra | **READY, unwired** — `dakio-api/src/lib/voiceCallService.js`: ElevenLabs ConvAI + Twilio outbound (`ELEVENLABS_API_KEY/AGENT_ID/PHONE_NUMBER_ID`), mock mode, BD phone normalization, `deriveConfirmationState` machine, explicitly never mutates orders; `routes/webhooks.js POST /api/webhooks/elevenlabs/post-call` (HMAC over rawBody); admin/ops call routes. **Zero Nova wiring** (PRD §14: "wire, don't build" — confirmed) | Nova call kinds on the same pipeline; `NovaCallSession` (E-17); voice approvals |
| Watchdog | Detection half REAL — `detectAnomalies` (7 domains) + `pulse` job kind + event inbox | Escalation ladder: call first → push second → decision card always (FR-9.2) |
| Memory | REAL (04) — namespaces, provenance, forget hard-delete, rejection fast-path, L1/L3 injection | H1.2: corrections routed through the action pipeline (receipts + `corrected_at`), injection into call scripts, teach-by-voice/chat parity |
| Hours-saved | Daily aggregates live (`/api/nova/home`, tz-aware); `summarizeWork` | Weekly report (FR-2.8): per-dept breakdown, shareable, auditor script (§11) |
| Tonight's plan | `NovaPlanItem` (09) + night job cadence | Pre-shift intent generation (FR-2.7) + planned-vs-done scoring into the brief |
| Push | none (old-06 digest worker unbuilt) | FR-8 push taxonomy: new decision / refusal / risk flag / brief ready / incoming call |
| Merchant voice UI | MOCK — `NovaCallOverlay`/`NovaIncomingCall` scripted call engine, watchdog after 18s, voice approvals via local applyApproval | Wire to real call sessions + live transcript |

## Objective

PRD Stage 7 gate: the founder runs the day by voice — answers the 06:00 briefing call,
approves one decision and defers another by voice; a seeded stockout triggers a watchdog
call and a restock approval by voice; a rule taught the evening before visibly changed
that morning's draft. Zero taps.

## Scope

**In:** Nova call orchestration over `voiceCallService` (new call kinds `nova_brief`,
`nova_alert`, `nova_customer`); `NovaCallSession` (E-17) — every call is a ledger action,
recording + transcript are the receipt (FR-9.5); briefing call (FR-9.1: brief-to-script,
voice Approve/Later executing the same `NovaDecision` records, confirmation phrase,
live transcript in HQ); watchdog engine + alert calls (FR-9.2: threshold rules over
ledger + metrics, Answer / Send-to-desk, declined ⇒ decision stays queued); customer
calls (FR-9.3: cart recovery + delivery confirmation, extending the shipped order-
verification scripts); memory H1.2 (receipted teach/forget, `corrected_at`, call-script
injection, voice-teach intent); hours-saved weekly (FR-2.8 + §11 auditor script);
tonight's plan (FR-2.7); mobile companion enablement (FR-8: same APIs + push taxonomy);
Bangla voice pre-gate bake-off (§18); bn+en scripts (FR-9.6).
**Out:** negotiation calls + live listen-in (14, FR-9.4); WhatsApp voice; new voice
vendor work (the stack exists).

## System architecture

```
triggers                        nova-ai                                dakio-api
06:00 brief ready ─► brief_call job ─► place_call tool ─► POST /agent-data/calls
watchdog rule hit ─► alert_call  ─►  (script assembled from   └─► voiceCallService.startCall
cart/delivery duty ─► customer_call    brief/decision/memory +      (ElevenLabs ConvAI + Twilio)
                                       BrandProfile, bn|en)              │
ElevenLabs post-call webhook (HMAC, exists) ─► NovaInbox event ─► call_result job
   └─► NovaCallSession finalized: transcript, recording_ref, approvals[], outcome
        ├─ voice approvals[] ─► SAME decision transactions as taps (08)  [confirmation phrase verified]
        ├─ call = NovaAction (verb by kind) + receipt {transcript, recording, duration}
        └─ feed event (duration + outcome, FR-9.5) · HQ live transcript via SSE
watchdog ladder: rule fires ─► (1) call ─ no answer/declined ─► (2) push ─► (3) decision card ALWAYS
```

## Design decisions

1. **Wire, don't build — and don't fork (§14).** `voiceCallService` gains Nova call
   kinds via a config table (script source, allowed voice verbs, language) rather than
   Nova-specific copies; `deriveConfirmationState`-style state machines per kind. The
   existing order-verification feature is untouched (regression suite proves it).
   Nova never dials Twilio directly — calls are StoreClient/service calls into
   dakio-api (standing rule 2; voice tokens stay in dakio-api env).
2. **Every call is a ledger action; the transcript is the receipt (FR-9.5).**
   `NovaCallSession` rows link a `NovaAction` (verb `place_call:<kind>`); receipt
   evidence = transcript ref + recording ref + duration + outcome. Voice approvals are
   entries in `approvals[]` referencing `NovaDecision` ids and executing **the same 08
   transactions** — a voice approve logs identically to a tap (decidedBy = founder,
   channel: voice). No parallel consent machinery.
3. **Confirmation phrase is a hard gate on voice approvals (§14 NFR).** The call agent
   must capture an explicit confirmation ("confirm approve <name>" / bn equivalent)
   before an approval lands in `approvals[]`; the post-call processor verifies the
   phrase marker exists in the transcript segment — otherwise the approval is dropped
   and the decision stays queued (logged as `voice_approval_unconfirmed`). Ambiguity
   fails safe.
4. **Watchdog is rules over the ledger, not a model on patrol (§13).**
   `agent/lib/watchdog/rules.ts`: typed thresholds over ledger + metrics (spend spike
   vs daily cap %, stockout on active-campaign SKU, courier failure streak) evaluated
   by the `pulse` job (shipped cadence). A firing rule authors the decision card FIRST
   (card always exists), then escalates: call (FR-9.2) → unanswered/declined → push →
   card remains queued. Declining on the call is `Later` semantics. Every rule firing
   is receipted; the false-positive metric (Stage 9 SLO <1/store/wk) counts from these
   rows.
5. **Memory corrections become ledger actions (H1.2, §10).** `remember`/`forget` (and
   new `teach` voice/chat intent) route through `performAction` (verbs `memory_teach`/
   `memory_forget`, low risk, auto-execute at any mode — the founder's own words are
   the authority) producing receipts with before/after belief text + `corrected_at`
   lineage on `NovaMemory`. Injection into call scripts: script assembly pulls
   BrandProfile + top-K brand/rules/preferences memory (same path 10 built for drafts)
   — the gate's "taught rule changed that morning's draft" and the call's tone both
   trace to the same rows. Forget stays a hard delete (04 ruling); the receipt records
   the deletion, not the content.
6. **Tonight's plan is authored pre-shift, scored post-shift (FR-2.7).** New
   `tonights_plan` job kind (~22:00 store time): per-department intent PlanItems
   (`night_shift_date = tomorrow`, status SCHEDULED) assembled from queues/goals/
   watchdog state — cheap tier, typed output (09 contract). The 06:00 brief computes
   `planned_vs_done` by diffing those items against the night's ledger (deterministic
   join, no model math) — E-16 Brief field finally populates.
7. **Hours-saved weekly is reproducible by construction (FR-2.8, §11).** Weekly job
   composes from `NovaActivity` only; the **auditor script**
   (`scripts/audit-hours-saved.ts`) recomputes the report from a ledger export and must
   match byte-for-byte — shipped with the report, not after (this is 15's grounding
   audit previewed on one metric). Share card follows 09's brief-card pattern.
   `on_duty_since` (E-1) starts at hire; "hours on duty" derives from it.
8. **Push is taxonomy-driven and quiet-hours-bound (FR-8; canon §4.13).** Five event
   kinds only: new decision, guardrail refusal, risk flag, brief ready, incoming call.
   Digest philosophy retires; anti-spam survives as: watchdog thresholds (not every
   anomaly pushes), per-kind founder toggles, quiet hours (except watchdog-critical,
   founder-configurable), and consolidation (N decisions in an hour = one push).
   Mobile companion = the same APIs + push tokens; no separate backend.
9. **Bangla voice is gated by a bake-off, not hope (§18).** Pre-gate: scripted bn call
   corpus through the existing ElevenLabs voices, scored by native speakers. Below
   bar ⇒ calls launch English-first while HQ transcripts + briefs keep bn parity;
   the gate demo runs in the passing language, stated honestly.

## EVE features to use (exact surface)

- `place_call` action tool (standard pipeline; `undoable:false`; receipt via post-call
  processing) + `call_result`/`tonights_plan`/`hours_weekly` job kinds on the shipped
  dispatcher.
- Post-call ingestion rides the existing `NovaInbox` → job path (02.3/05) — the
  ElevenLabs webhook handler appends an inbox event; no new eve channel needed.
- Script assembly is authored TypeScript (`agent/lib/voice/scripts.ts`) rendering
  brief/decision/memory rows — the model drafts narrative segments where needed via the
  night session, never live on the call path (latency + grounding).
- HQ live transcript: `NovaCallSession` transcript segments stream over the existing
  SSE bus (`call.segment` events) — same single-instance caveat, 15 upgrades.

## External services

ElevenLabs + Twilio (existing accounts/config). Push provider: FCM/APNs via Dakio's
existing notification infra (or provider onboarding — flagged dependency). No other new
services.

## Data models

```prisma
model NovaCallSession {                 // E-17
  id String @id @default(cuid()); tenantId String
  kind String                           // brief|alert|customer   (negotiation in 14)
  parties Json; startedAt DateTime; duration Int?
  transcript Json                       // [{t, speaker, text, lang}]
  recordingRef String?
  approvals Json                        // [{decisionRef, verb, confirmedPhraseAt}]
  outcome String?; actionRef String     // the ledger action for this call
  language String                       // bn|en
  createdAt DateTime; updatedAt DateTime; deletedAt DateTime?
  @@index([tenantId, kind, startedAt])
}
model NovaPushToken { tenantId String; userId String; platform String; token String
  prefs Json; @@unique([tenantId, userId, platform]) }
// NovaMemory ALTER: correctedAt DateTime?, correctedBy String?
// NovaWatchdogRule (per-tenant overrides): key, threshold Json, enabled, callFirst Boolean
```

## APIs & interfaces

dakio-api: `POST /api/v1/agent-data/calls` (service — start call, kind + script + lang)
· post-call webhook (exists) extended to Nova kinds → inbox event ·
`GET /api/nova/calls/:id` (+ transcript stream) · `POST /api/nova/push/token` + prefs ·
`GET /api/nova/hours-report?week=` + `/card` · `GET /api/nova/tonights-plan` ·
watchdog rule CRUD (owner). Voice-callable verb allowlist per kind (brief: approve/
later; alert: approve/send-to-desk; customer: per-duty scripts) — enforced server-side
at post-call processing, not by the voice agent's goodwill.
nova-ai: `place_call` tool + script assembly + watchdog rules + `teach` intent (11's
table) + weekly/tonight job prompts. Merchant: call overlay + incoming-call wired to
real sessions + live transcript; brief modal gains "Hear it as a call" (FR-2.4). All
scripts + UI bn+en; ৳ spoken amounts formatted for speech.

## Implementation steps

1. Bake-off (week 1, parallel): bn corpus through existing stack → language decision
   record.
2. `NovaCallSession` + call-kind config in `voiceCallService` + post-call → inbox →
   `call_result` processor (transcript receipts, approval verification, feed events);
   order-verification regression suite.
3. Briefing call: script assembly from `NovaBrief` + decisions, voice verb capture,
   confirmation-phrase gate, HQ transcript stream, "Hear it as a call".
4. Watchdog: rules lib + pulse integration + ladder (call → push → card) + declined
   semantics + FP counting.
5. Customer calls: cart-recovery + delivery-confirmation scripts (extend shipped
   confirmation state machine) behind their duties + modes.
6. Memory H1.2: pipeline-routed teach/forget + `corrected_at` + call-script injection
   + voice-teach intent (draft-change eval from 10 re-run as the gate's memory step).
7. Push: taxonomy events + tokens + prefs + quiet hours + consolidation; mobile
   enablement pass over the APIs.
8. Tonight's plan + planned-vs-done; hours-saved weekly + auditor script + share card.
9. Wire merchant voice UI (delete scripted call engine); gate rehearsal + staging demo
   (non-builder, zero taps); artifacts.

## Dependencies

08–11 shipped. ElevenLabs/Twilio staging credentials + a test phone line. Push provider
onboarding. Native bn speakers for the bake-off. Product: watchdog default thresholds +
quiet-hour exceptions.

## Risks & trade-offs

| Risk | Mitigation |
|---|---|
| Voice recognition mis-approves | confirmation-phrase hard gate + post-call verification + drop-to-queued on ambiguity; approvals auditable in transcript receipts |
| Bangla voice below bar | bake-off pre-gate + English-first fallback with bn text parity (§18) — stated in the demo, not hidden |
| Call latency/awkward scripts | scripts pre-assembled from rows (no live model on the call critical path); ConvAI handles turn-taking (already proven for order verification) |
| Watchdog call fatigue | card-always + thresholds + quiet hours + per-kind toggles; FP metric tracked from day one against the Stage 9 SLO |
| Post-call webhook loss | inbox dedupe + Twilio/ElevenLabs status polling fallback job; unprocessed call sessions flagged in ops |
| Push provider delays | push is layer 2 of the ladder — desk card (layer 3) always exists; gate can pass with calls + cards while provider onboards (§16.5 honest shrink) |
| Memory-teach abuse via voice (household member) | teach verbs execute only on calls initiated to the founder's verified number + confirmation phrase; corrections receipted and visible in memory UI (12) |

## Testing strategy

Unit: script assembly (bn/en vectors, ৳ speech formatting), confirmation-phrase parser,
watchdog rule math, planned-vs-done join, auditor script determinism. Integration:
call lifecycle end-to-end in voiceCallService **mock mode** (exists) — start → webhook
→ session finalized → approvals executed → receipts + feed; order-verification
regression; push taxonomy + quiet hours. Live rehearsal on staging with real calls
(recorded). Evals: teach-rule-changes-draft (10's eval as the gate's memory step),
watchdog scenario (seeded stockout → rule → ladder). Prior suites green.

## Performance

Call setup <5s from trigger (pre-assembled scripts); transcript SSE segments near-real-
time; post-call processing async (inbox path); brief call available at 06:00 ±5m
(existing cadence). Push p95 <5s from event.

## Security

Voice verbs allowlisted per call kind, verified server-side post-call. Founder phone
verified at hire settings; approvals only on founder-line calls with confirmation
phrase. Recordings/transcripts tenant-scoped; PII in transcripts redacted in traces
(15). Webhook HMAC already enforced over rawBody (exists). Push tokens per user;
prefs owner-editable. Teach/forget receipts never contain deleted content (record of
deletion only).

## Success & exit criteria

**PRD §15 Stage 7 gate (verbatim):** *"Run the day by voice": answer the 06:00 briefing
call, approve one + defer one by voice; seeded stockout → watchdog call → approve
restock by voice; a taught memory rule visibly changed that morning's draft. Entire
founder day, zero taps.*
**Standing gates** + **§16 discipline** (clean staging store, non-builder, recording —
including the call recordings — + ledger export filed).
**Phase-specific:** every call in the demo has a `NovaCallSession` + ledger action +
transcript receipt · voice approvals byte-identical in the ledger to tap approvals
(channel field aside) · watchdog card existed before the call was placed · hours-saved
weekly matches the auditor script on the export · planned-vs-done appears in the brief
· bake-off decision record filed · push taxonomy fires on the five kinds only.

## Deliverables

Nova call kinds + `NovaCallSession` + post-call pipeline; briefing/alert/customer call
flows + confirmation gate; watchdog rules + ladder; memory H1.2 (receipted corrections,
call injection, voice teach); push taxonomy + mobile enablement; tonight's plan +
planned-vs-done; hours-saved weekly + auditor script + share card; merchant voice UI
wired; bn bake-off report; gate artifacts; capability report
`phase-13-stage7-presence.md` + matrix updates.
