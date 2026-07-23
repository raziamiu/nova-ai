# Phase 10 — Stage 4: Craft · capability report

- **Status:** core **in progress** — the voice-scoring engine, the content model
  + review loop, and night-shift content authoring are **built and verified**.
  Model generation (10-C), the publish pipeline (10-D), and the Studio UI (10-F)
  are the remaining pieces before the §15 Stage 4 gate can be signed.
- **Branch / commits:** `develop` — nova-ai `9ede804` (voice) · `52db89c` (night content); dakio-api `0056135` (models + review loop)
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

**PRD gate — NOT met.** §15 Stage 4 wants: *brief → in-voice draft (score) →
request changes → v2 → approve → publishes on schedule; a seeded off-voice draft
flagged.* The score + review + regenerate + approve half is real and tested; the
**model-generated draft** (today the night shift uses a fixed exemplar) and the
**scheduled publish** are 10-C/10-D. Not signed off.

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

## Known limitations / not yet

- **Generation is a fixed exemplar, not the model yet (10-C).** The night shift
  files a real, scored draft, but the text is a template. Wiring the typed
  `generate_content` tool (per-type schemas, brand+memory injection, streaming in
  the composer) is the next chunk — the review loop it feeds is already real.
- **No publish pipeline yet (10-D).** Approved content reaches `approved`/
  `scheduled` but there is no `publish_content` action/job/undoer yet. The Meta
  publish-scope question (organic FB works today via 09-B; a content-typed
  publisher + handoff fallback) rides here.
- **Content Studio UI not wired (10-F).** Library/Calendar/Review/Brand-assets
  views + the review card with score/violations still render mock veins; the APIs
  (`/nova/content`, `/nova/brand`) are live and ready.
- **Content decisions not yet on the desk.** The review loop uses the content
  verbs directly; grouping content into a `content_review` decision card (≤3 desk
  rule) lands with 10-F.

## Matrix updates

Rows changed in `docs/prd/capability-matrix.md`: Stage 4 / Phase 10 build-status
(in progress); E-11 Content; E-12 BrandProfile; voice scoring.
