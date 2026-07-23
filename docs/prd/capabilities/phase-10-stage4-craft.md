# Phase 10 — Stage 4: Craft · capability report

- **Status:** **COMPLETE — §15 Stage 4 gate signed (14/14 live).** Voice scoring,
  the content model + review loop, night-shift authoring, publish (10-D), the
  Content Studio review UI (10-F), and **model generation (10-C)** are all done
  and verified. `scripts/stage4-gate.ts` drives the whole §15 scenario end to end
  against the live API.
- **Branch / commits:** `develop` — nova-ai `9ede804` (voice) · `52db89c` (night content) · `c08e60e` (10-C generation); dakio-api `0056135` (models + review loop) · `89ff621` (publish) · `0cee534` (brand read); dakio-merchant `9a7abb1` (Content Studio review UI)
- **Date:** 2026-07-23
- **Blueprint:** `docs/blueprint/10-stage4-craft.md` (+ `grow-lab-reconciliation.md`)

> Stage 3 proved the loop; Stage 4 makes what runs through it **worth reading** —
> content in the store's own voice, in Bangla and English, scored against a
> structured brand profile, revised on request. The checkable half is done: a
> draft gets a real, cited score, and the review loop round-trips end to end.

## Gate

| Check | Result |
|---|---|
| `npx tsc --noEmit` (nova-ai) | ✅ clean |
| `npx eve build` | ✅ built, 0 diagnostics |
| nova-ai suites | prior suites + **voice 10** + night **13** — green |
| dakio-api hermetic | ✅ **737 pass / 0 fail / 1 win-skip** |
| review loop (live) | ✅ brand set → off-voice draft (50, flagged) → request-changes → v2 (90) → approve → 409 on double-approve |
| night → content (live) | ✅ night shift filed a scored draft into the review queue |
| publish (live) | ✅ approved post → organic FB (honest no-Page → scheduled); email → 422; in-review → 409 |
| Content Studio UI (CDP) | ✅ Nova lane renders the queue → review card shows score + cited violations + revisions → approve round-trips (2→1); flagged draft cites "cheap"/"limited time only" |
| generate suite | ✅ **generate 20** — in-voice clears + files; off-voice flagged + cited + guidance; re-file (same id) improves the score |
| **§15 Stage 4 gate** (live) | ✅ **stage4-gate 14/14, 0 skipped** — owner sets voice → off-voice draft flagged+cited → request changes → in-voice v2 clears the bar → approve → publish (honest outcome) |

**PRD gate — MET.** §15 Stage 4 wants: *brief → in-voice draft (score) → request
changes → v2 → approve → publishes on schedule; a seeded off-voice draft flagged.*
`scripts/stage4-gate.ts` drives exactly that against the live API and passes
**14/14, 0 skipped**: the owner sets a brand voice, Nova generates an off-voice
draft (flagged, citing "cheap"), the founder requests changes, Nova regenerates
in-voice (the score climbs past the threshold), the founder approves, and it
publishes through the organic-FB path with an honest no-Page outcome. The
model-generated draft (10-C) replaced the fixed exemplar; `generate_content`
scores the model's copy and files it, so "in-voice draft" is now genuinely
model-authored, not templated.

## New capabilities this phase (so far)

- **`scoreVoice` (10-A).** A deterministic rule pass grades a draft against the
  BrandProfile — language match, banned/required phrases, tone-word coverage,
  per-type length caps, emoji/hashtag policy. `score = 100 − Σ penalties`, and
  every penalty CITES the fragment it fired on (§2.4). **Bangla-aware**: NFC +
  combining-mark-preserving normalization, so a banned Bangla phrase is caught
  and matras aren't shredded — the Phase 07 lock bug, deliberately not repeated.
  Threshold 70 flags off-voice (the gate's seeded scenario).
- **BrandProfile (E-12).** Structured, founder-owned voice: tone words, palette,
  do/don't rules, languages, assets, tunable threshold. Memory stays the
  narrative layer; this is the checkable truth. `GET/PUT /nova/brand` (owner-only).
- **Content items + review loop (E-11, 10-B).** `NovaContentItem` — 8 types,
  versioned, each version carrying its score + violations. The review verbs
  (approve / reject / request-changes) are conditional transitions (a second tap
  → 409). `request-changes` appends a version + records the founder's note (DATA
  for regeneration, not an instruction) and moves to `changes`; Nova's next
  generation files v(n+1) back into `review` — the §13 revision loop.
- **Night-shift content authoring (10-E).** The night shift drafts a piece of
  content, scores it, and lands it in the review queue — the founder wakes to
  something to react to, not a blank composer.
- **Publish pipeline (10-D).** `POST /nova/content/:id/publish` sends an approved
  `post` to its channel by reusing the real organic-FB path (09-B): create a
  GrowPost, publish it. Honest about a missing Page (stays `scheduled`, says
  "connect a Page in Addons") — never a claimed send. 422 for non-post types
  (email/sms/push wait for Broadcast Center, Phase 12), 409 for non-approved.
- **Content Studio review UI (10-F).** The Content Studio's Nova lane now shows
  the overnight review queue (`GET /nova/content?view=review`), and a review card
  renders the copy, the cited voice score, and the revision history with the
  three verbs. `request-changes` reveals a note field whose text is DATA for
  Nova's next draft (§13). CDP-verified end to end against the live store.
- **Model generation — `generate_content` (10-C).** Nova writes the copy with the
  model; the tool scores it against the store's `BrandProfile` (deterministic,
  every deduction cited) and files it to review. A flagged draft comes back with
  guidance naming each violation so Nova rewrites and re-files with the same
  `contentId` — the founder only ever sees an in-voice draft. `getBrandProfile`
  (`GET /agent-data/brand`) feeds the real voice; `draftAndFileContent` is the
  eval-testable core; the `night_ops` job now drafts tomorrow's post this way
  (review-first, self-revise on a flag) instead of auto-scheduling a publish.

## Known limitations / not yet

- **The self-revise loop is prompted, not enforced (10-C).** `generate_content`
  hands the model revise guidance on a flag, and the deterministic core is
  eval-gated, but whether the model actually rewrites before filing is a runtime
  model behaviour (exercised by `stage4-gate.ts`'s scripted re-file, not by an
  unattended model run). A model eval that asserts the live model self-corrects
  is logged for a live run.
- **Publish is post-only, undoerless (10-D scope).** `publish` sends organic FB
  posts (honest no-Page fallback) but email/sms/push route to Broadcast Center
  (Phase 12), and there is no scheduled-publish job or `publish_content` undoer
  yet — a published post can't be pulled back through Nova.
- **Studio review UI is the review lane, not the full studio (10-F scope).** The
  Nova lane + review card are live in Content Studio; the Library/Calendar/
  Brand-assets *tabs* still render the merchant's own GrowPost data, not the Nova
  content model. Approve from the card reaches `approved`/`scheduled`; wiring the
  card's Approve to auto-invoke publish is a follow-up.
- **Content decisions not yet on the desk.** The review lane uses the content
  verbs directly; grouping content into a `content_review` decision card (≤3 desk
  rule) is still pending.

## Matrix updates

Rows changed in `docs/prd/capability-matrix.md`: Stage 4 / Phase 10 build-status
(**complete — gate signed**); E-11 Content; E-12 BrandProfile; voice scoring;
`generate_content`.
