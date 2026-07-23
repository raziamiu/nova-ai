# Phase 13 — Stage 7: Presence · capability report

- **Status:** **deterministic core + voice-approval pipeline built and verified;
  live telephony/push/bake-off are honest remainder.** The watchdog engine, the
  voice script assembly + confirmation gate, planned-vs-done + hours-saved, and
  the NovaCallSession pipeline (a voice approval executes the same decision
  transaction as a tap) are done and tested. Real ElevenLabs/Twilio calls, FCM
  push, and the Bangla voice bake-off need the external accounts.
- **Branch / commits:** `develop` — nova-ai `e80ca65` (watchdog/voice/presence
  core); dakio-api `9d544d9` (call sessions + confirmation-gated approvals)
- **Date:** 2026-07-23
- **Blueprint:** `docs/blueprint/13-stage7-presence.md`

## Gate

| Check | Result |
|---|---|
| `tsc` (nova-ai) | ✅ clean |
| nova-ai suites | + **presence 19** — green |
| dakio-api hermetic | ✅ **766 pass / 0 fail** (+ novaVoice 6) |
| watchdog (eval) | ✅ seeded stockout on a live campaign fires; card always first in the ladder; critical→call→push, warning→push |
| confirmation gate (eval + live) | ✅ "confirm approve <item>" accepted; bare "yes" / wrong-item / Nova's own words fail safe; Bangla confirm ok |
| voice approval = tap (live) | ✅ finalize a call with a confirming transcript → decision APPROVED via voice through the same runActionExecution + plan-flip; bare "yes" → 0 approved, stays queued |

**PRD gate — substantially met on the reproducible half.** §15 Stage 7 wants a
zero-tap day: answer the 06:00 briefing call, approve one + defer one by voice;
seeded stockout → watchdog call → restock by voice; a taught rule changed the
morning draft. The **mechanics** are built + verified: watchdog fires
deterministically with a card-first ladder, and a confirmation-gated voice
approval executes the identical decision transaction (channel:voice). What needs
a **live run** (H-19) is the real telephony (ElevenLabs+Twilio) end to end, real
push, and the bn voice bake-off — none fakeable here.

## New capabilities this phase

- **Watchdog engine (FR-9.2).** Typed thresholds over ledger+metrics (spend
  spike, stockout on an active-campaign SKU, courier fail streak, revenue drop),
  pure + reproducible. A firing authors the decision CARD first, then escalates
  call (critical only) → push. `nextEscalation` walks the ladder.
- **Voice scripts + confirmation gate (FR-9.1/§14).** Brief + alert scripts
  rendered from rows (no live model on the call path); ৳ spoken not shown (en/bn);
  the confirmation-phrase gate accepts only an explicit founder "confirm approve
  <item>" that names the decision — everything else fails safe.
- **NovaCallSession pipeline (E-17).** A call is a ledger action; the session
  (transcript + approvals + recording) is its receipt. `finalize` runs the gate
  and executes confirmed approvals through the SAME `runActionExecution` path a
  tap uses (channel:voice); unconfirmed decisions stay queued + logged.
- **Planned-vs-done + hours-saved (FR-2.7/2.8).** Exact joins — the brief's
  planned/done tally and the weekly hours-saved report are reproducible by
  construction (auditor-ready).
- **Models.** NovaCallSession, NovaPushToken, NovaWatchdogRule, NovaMemory
  correctedAt/correctedBy (H1.2 receipted corrections).

## Known limitations / not yet (needs external accounts / live — H-19)

- **No real telephony wired end to end.** The pipeline is proven in mock; the
  ElevenLabs ConvAI + Twilio start-call + the post-call webhook → inbox → finalize
  loop needs the staging voice credentials + a test line.
- **Push is model+prefs, not a provider.** NovaPushToken + the 5-kind taxonomy +
  quiet hours logic land next to an FCM/APNs adapter.
- **Watchdog not yet on the `pulse` job.** The rules lib is done + tested;
  wiring it into the pulse cadence (+ the escalation ladder runner + FP counting)
  is the integration step.
- **Bangla voice bake-off** (native-speaker scored) is a human step; English-first
  fallback with bn text parity is the §18 plan.
- **Merchant voice UI** still uses the scripted call engine; wiring it to real
  NovaCallSession + live transcript is the frontend step.
- **Memory H1.2 pipeline routing** (teach/forget as `performAction` verbs with
  before/after receipts) — the model + `corrected_at` columns exist; the verb
  wiring is pending.

## Matrix updates

Stage 7 / Phase 13 → deterministic core + voice-approval pipeline built + verified
(presence 19, dakio-api 766, live voice-approval smoke); telephony/push/bake-off/UI
are the live remainder (H-19).
