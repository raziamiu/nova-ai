# Phase 10 — Stage 4 "Craft": Content Studio + Brand Voice

**PRD stage:** Stage 4 (PRD §15) · **Prereqs:** 08 (decisions/review verbs), 09 (night
shift authoring, brief). Owner: AI Engineering (per PRD §16), backend surface included
here. Self-contained. Nova produces founder-approvable content in the store's own voice —
Bangla and English — scored against a structured brand profile, revised on request, and
published on schedule through a real channel path.

## Already real vs to build

| Capability | Today (repo audit / 02-findings) | This phase |
|---|---|---|
| Social publishing | **GREENFIELD** — no model, no route, no Meta publish scope in dakio-api (02-findings §C); `publish_social_post` tool works against the demo backend only; `DakioStoreClient.createSocialPost/updateSocialPost` throw | `NovaContentItem` + review workflow + per-channel publisher (Meta pages/IG via dakio-api; propose-only fallback D2) |
| Brand voice | Memory `brand` namespace injected into L1 (Phases 01/04) — narrative only | Structured `NovaBrandProfile` (E-12): tone_words/palette/rules/languages; memory stays the narrative layer |
| Voice scoring | none | `scoreVoice(draft, profile, memory) → {score, violations[]}` + below-threshold flagging |
| Bangla | none anywhere (persona en; no bn generation) | bn+en generation + brand assets both languages (FR-6.3); ৳ done in 06 |
| Review loop | Decision service (08) approve/later/reject | Content-specific request-changes loop with versions[] (E-11) |
| Content Studio UI | Mock door tile only (`novaData.js`) | Library/Calendar/Review/Brand-assets views wired (FR-6.3) |

## Objective

The Stage 4 loop: a brief/night-shift item proposes content → draft generated **in the
store's voice** with a visible score → founder requests changes → v2 → approve →
publishes on schedule; a seeded off-voice draft is flagged below threshold. Content
duties flip `ACTIVE` in the 07 registry.

## Scope

**In:** E-11 `NovaContentItem` (8 types: post, reel script, story, caption set, email,
SMS, push, product description) + versions + statuses; E-12 `NovaBrandProfile` + brand
assets (bn+en) + seeding from brand memory; `scoreVoice` + threshold flag; generation
contract (§13 row: scored vs BrandProfile + Memory, revision loop); composer (manual
`+ Create` path, FR-6.5); scheduler (`scheduled_at` → publish job kind); per-channel
publisher for Meta page/IG feed via dakio-api (write scope investigation mirrors 09's
spike; propose-only fallback); Content Studio UI wiring; night-shift content authoring
(marketing dept emits content plan items/drafts).
**Out:** broadcast channels/segments (12 — email/SMS/push *types* exist here, mass
delivery is Broadcast Center's); creative image generation (wizard "Nova ×3" text/brief
slots only — image gen is an extension track); voice/call scripts (13).

## System architecture

```
night shift (09) / chat / composer
   └─ generate draft (dept: marketing) ── BrandProfile + brand/rules/preferences memory injected
        └─ scoreVoice(draft) ─ score < threshold? flag ─► NovaContentItem v1 (status: review)
              └─ decision card (kind: content_review) ─► founder: approve | request changes(note) | reject
                    approve ─► status scheduled ─ publish job kind at scheduled_at
                    request changes ─► generation v2 (note + violations fed back) ─► review again
publish job ─► performAction(publish_content) ─► dakio-api channel publisher (Meta / store blog)
   └─ receipt + by:nova + feed event; failure → honest retry/decision, never silent
```

## Design decisions

1. **Content items are versioned artifacts, decisions are their consent (E-11 + 08).**
   Each review round is a decision card carrying the draft + score; `request changes`
   is a content-specific verb (`POST .../request-changes {note}`) that spawns v(n+1)
   generation with the founder's note + prior violations in context — the §13 revision
   loop, receipted end-to-end (every version records its generation action).
2. **Publisher follows the 09 pattern: real writes if scope lands, propose-only
   otherwise.** Meta page/IG publishing needs `pages_manage_posts`-class scope
   (02-findings: greenfield). Same week-1 investigation + decision record; fallback =
   approved content lands `ready` with a one-tap "open in Meta composer" handoff and the
   founder-as-executor completion marking (actor:'founder'). Email/SMS/push types
   render + schedule but mass-send waits for Broadcast Center (12) — single-recipient
   transactional sends (e.g. cart recovery message body) are consumed by their duties.
3. **BrandProfile is structured truth, memory is nuance (E-12).** `tone_words[]`,
   `rules[]` (do/don't), `palette[]`, `languages` (bn, en, or both), assets (logo refs,
   boilerplate bn+en). Seeded once from the `brand` memory namespace + a founder
   onboarding pass in the Brand-assets view; edits are founder-owned (owner JWT).
   Generation prompts inject profile + top-K brand/preference/rules memory — a rule
   taught via chat (§10) visibly changes the next draft (Stage 7 gate depends on
   exactly this path; built here).
4. **`scoreVoice` is deterministic-first, model-second.** Pass 1: rule checks
   (banned/required phrases, tone_word coverage, language match, length caps, emoji/
   hashtag policy) — cheap, reproducible, cited violations. Pass 2: model grader
   (cheap tier) for tone similarity, returning a 0–100 with quoted evidence. Final
   score = min(rule gate, graded); threshold 70 flags `off-voice` (the Stage 4 seeded
   test). Violations are the receipt's evidence — no unexplained scores (§2.4).
5. **Bangla is a first-class generation target, not a translation pass (§14 NFR).**
   Profile `languages` drives per-item language; bn drafts generated natively with
   bn brand assets; mixed bn/en (common in BD commerce) allowed by rule config. Eval
   corpus includes bn fixtures; the voice scorer's rule pass is NFC/Bangla-aware
   (07's matcher utilities reused).
6. **8 types, one table, per-type schemas.** `type`-discriminated `body Json` (e.g.
   reel script = scenes[], email = subject/preheader/blocks[]) validated by zod per
   type in nova-ai and mirrored in the API layer — §16.2 receipts discipline applied
   to content payloads.
7. **Scheduling rides the dispatcher (05).** `content_publish` job kind; publishing is
   an action (`publish_content`) through the full pipeline — authority-checked (mode/
   level can hold publishes as drafts), receipted, undoable where the channel allows
   (Meta post delete = engineered inverse; email/SMS sends are `undoable:false`).

## EVE features to use (exact surface)

- **Skills:** `agent/skills/content-generation.md` (+ per-type reference files as a
  packaged skill dir) — procedure + type schemas as versioned content; loaded via
  `load_skill` in generation runs. Brand data itself is NEVER a skill (per-tenant data
  lives in rows; canon: no per-tenant files on disk).
- **Dynamic model:** grader pass pinned to the cheap tier at `session.started` via the
  shipped job-kind hint; generation stays on the core tier.
- **Subagent `outputSchema`:** marketing-department generation returns
  `{draft, language, typePayload}` typed (09 pattern).
- **Approval fns:** `publish_content` carries the standard pipeline; no eve-approval
  parks (consent = decisions, 08).

## External services

Meta Graph publish scope (investigation; D2 fallback works without). Existing email/SMS
providers are NOT wired this phase (12). No new infra.

## Data models

```prisma
model NovaBrandProfile {                 // E-12 — one per tenant, founder-owned
  tenantId String @id
  toneWords Json; palette Json; rules Json      // rules: [{kind:'do'|'dont', text, textBn?}]
  languages Json                                 // ['bn','en']
  assets Json                                    // {logoRef?, boilerplateEn?, boilerplateBn?, hashtags[]}
  updatedBy String; createdAt DateTime; updatedAt DateTime
}
model NovaContentItem {                  // E-11
  id String @id @default(cuid()); tenantId String
  type String                            // post|reel|story|captions|email|sms|push|product_desc
  title String; language String          // 'bn'|'en'|'mixed'
  body Json                              // per-type schema
  status String @default("review")       // draft|review|changes|approved|scheduled|published|rejected
  voiceScore Int; violations Json        // scoreVoice receipt
  versions Json                          // [{v, body, score, violations, note?, actionRef, at}]
  channel String?; scheduledAt DateTime?; publishedAt DateTime?
  decisionRef String?; novaActionId String?
  createdAt DateTime; updatedAt DateTime; deletedAt DateTime?
  @@index([tenantId, status, scheduledAt])
}
```

## APIs & interfaces

Merchant JWT: `GET /api/nova/content?view=library|calendar|review` ·
`POST /api/nova/content` (composer, founder-actor) · `POST /api/nova/content/:id/
approve|reject` (through decision verbs) · `POST /api/nova/content/:id/request-changes
{note}` · `GET/PUT /api/nova/brand` (profile + assets, owner role).
Service: content CRUD + version append (`/agent-data/content`), publish-result callback.
nova-ai: `generate_content` (typed, per-type), `score_voice` (exposed for "why flagged"
chat asks), `publish_content` action tool + executor/undoer (Meta delete inverse);
`content_publish` job kind + prompt template; night-shift marketing contract extended
with content items. Merchant UI: Library/Calendar/Review/Brand-assets views (prototype
shells exist), review card with score + violations, composer. All strings bn+en.

## Implementation steps

1. Models + APIs + per-type zod schemas (both repos); profile seeding from brand memory
   + Brand-assets onboarding view.
2. `scoreVoice` (rule pass + grader) + threshold flag + violation receipts; bn-aware
   rule utilities.
3. Generation path: skill + typed tool + memory/profile injection; request-changes
   regeneration loop.
4. Publish pipeline: action type + executor/undoer, `content_publish` job kind, Meta
   scope investigation → real publisher or handoff fallback (decision record filed).
5. Night-shift marketing extension (content plan items + drafts land in review).
6. Studio UI wiring (4 views + review loop + composer); delete mock content veins.
7. Eval corpus (bn+en, on-voice/off-voice fixtures) + gate script + staging demo.

## Dependencies

08/09 shipped (decisions, night shift, job kinds). Meta publish scope investigation
(fallback designed). Founder input for initial brand profiles on staging stores.

## Risks & trade-offs

| Risk | Mitigation |
|---|---|
| Voice score feels arbitrary → founders distrust flags | deterministic rule pass cited first; violations quote the draft; threshold tunable per tenant later |
| bn generation quality below bar | bn eval fixtures gate the phase; §18 pattern: en-first fallback per item with bn parity flagged honestly, never silent translation |
| Meta publish scope denied | D2 handoff fallback passes the gate (approve→publish-on-schedule is satisfied by scheduled handoff + founder completion for Meta; store-blog/product-description channels publish fully autonomously) |
| Version bloat | versions capped (keep last 10, receipts persist in ledger regardless) |
| Content decisions flood the desk | content cards group under one desk card per day-batch ("3 drafts await review") linking the Review view; ≤3 desk rule (08) preserved |
| Scheduled publish fires after content became stale | publish job re-checks item status + campaign/product still live; mismatch → decision, not silent publish |

## Testing strategy

Unit: per-type schema validation, rule-pass vectors (bn NFC, banned phrases, length),
score determinism, version append. Integration: review loop end-to-end (draft→changes→
v2→approve→scheduled→published + receipts at each step), publish job idempotency,
profile edit → next generation reflects it. Evals (CI): on-voice fixture ≥ threshold,
seeded off-voice fixture flagged (the gate's own scenario), taught-rule-changes-draft
(pre-building the Stage 7 memory gate), bn generation fixture. Prior suites green.

## Performance

Rule pass <5ms; grader on cheap tier, one call per version. Library/calendar reads
indexed. Generation batched in night shift (no founder-facing latency); composer
generation streams via the normal chat channel.

## Security

Profile edits owner-only; generated content is model output — publisher path re-checks
authority + outbound-content rules (no URLs off the store's domains, length caps —
pulled forward from old-07's outbound checks for the publish surface only; full
injection-defense sweep stays 15). Meta publish tokens live in dakio-api env. Founder
notes in request-changes are data, not instructions, in regeneration prompts (labeled).

## Success & exit criteria

**PRD §15 Stage 4 gate (verbatim):** *Brief → in-voice draft (score) → request changes →
v2 → approve → publishes on schedule; a seeded off-voice draft is flagged below
threshold.* Zero manual DB pokes.
**Standing gates** + **§16 discipline** (clean staging store, non-builder, recording +
ledger export filed).
**Phase-specific:** all 8 types round-trip their schemas · bn fixture passes · every
version carries score + violations + action ref · content duties `ACTIVE` in the 07
roster (coverage rollup moves) · publish path honest about mode (real Meta vs handoff)
in UI copy and receipts.

## Deliverables

E-11/E-12 models + APIs; scoreVoice + bn-aware rules; generation skill + typed tools +
revision loop; publish action + job kind + channel path (or handoff); Studio UI (4
views) wired; night-shift content authoring; bn+en eval corpus; gate script + artifacts;
capability report `phase-10-stage4-craft.md` + matrix updates.
