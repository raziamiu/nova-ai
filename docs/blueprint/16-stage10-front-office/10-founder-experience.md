# Module 10 — Founder Experience: seeing, steering, and trusting Nova in the inbox

**Phase:** 16 "Front Office" · **Depends on:** 08, 09 (+06 case surfaces, +03/04 promise/commitment feeds) · **Feeds:** 12
**Repos touched:** dakio-merchant | dakio-api
**Founder requirements covered:** #30 (+ the founder-visible halves of #22, #23, #29)

This module is the render layer of Stage 10: every founder-visible pixel that makes Nova's
inbox work observable, steerable, and auditable. It owns the extended `/meta/conversations`
response shapes, the server-side `novaState` derivation, `GET /nova/inbox-summary`, and all
new dakio-merchant components. It writes almost no state of its own — every state it renders
is a projection of rows owned by modules 01–09. Customer-visible output is never touched here:
all Nova markers are render-side metadata joined at read time.

## Already real vs to build

| Already real (recon file:line) | This module adds |
|---|---|
| Full poll-driven Messenger+IG inbox: two-pane layout, 6s list / 4s thread polls, optimistic send (recon-merchant-ui: `Inbox.jsx:243-275, 446-597, 600-786`, routed `App.jsx:225`) | Nova chrome on the same page: thread chips, bubbles, draft bar, banner, toggle, typing row, deep link `?c=` |
| Bubble render is direction-only — no author/agent concept exists (`Inbox.jsx:636-730`; recon §1 "no 'who sent the outbound message' concept") | `actor` branch: Nova orb avatar, `NOVA · time` meta line, `ByNovaDot` → receipt drawer |
| List preview hardcodes `You:` for outbound (`Inbox.jsx:570`) | `Nova:` (lime) prefix when `lastAuthor === 'nova'` |
| Platform tabs All/Messenger/Instagram (`Inbox.jsx:8-12, 476-503`) | `⚠ Needs you (n)` tab, needs-you sort-to-top |
| By-Nova attribution kit reusable as-is: `ByNovaChip`, `ByNovaDot`, `NovaReceiptDrawer` (`NovaReceipt.jsx:24-43, 51-67`; rules 7-21) | Drawer extension: `explanationBn` line + DETECTED/GROUNDED evidence formatting |
| Shared optimistic 409-safe decision verbs — settling anywhere clears everywhere (`NovaContext.jsx:226-239`) | `NovaDraftBar` and `InboxMorningReview` ride them unchanged |
| Escalation-as-NovaDecision renders on five surfaces with zero new code (`NovaCommand.jsx:564-630`, `NovaDesk.jsx:44-59`, `NovaDeptRoomPage.jsx:365-392`, `suggestions.js:80-106`, `NovaChat.jsx:48-103`) | Handover card CONTENT spec (renders module 08's brief payload) |
| Sidebar presence dot machinery: 60s poll, lime ping when `pending > 0` (`useNovaPresence.js:13-37`, `Sidebar.jsx:105-116`); Inbox nav item has no `novaDoor` (`Sidebar.jsx:29`) | One-line `novaDoor: 'inbox'` (server `DOOR_OF` entries land in module 09) |
| SSE switch silently drops unknown event types (`NovaContext.jsx:303-315`) | Four v1 branches: `conversation.escalated` (toast), `conversation.taken_over`, `conversation.handed_back`, `case.opened` |
| statusLine fallback chain feeds HQ ticker + Desk with zero UI change (`NovaContext.jsx:758-761`) | Inbox-aware statusLine format spec + dakio-api writer sharing the summary queries |
| `NovaPresence` drop-in orb, renders nothing until hired (`NovaPresence.jsx:16-31`); today mounted only by GrowTabs (`GrowTabs.jsx:123`); /inbox has zero Nova rendering (recon §3) | Mount on /inbox + `Inbox` surface in `deriveSuggestions` (`suggestions.js:64-123`) |
| Command surfaces: GrowLabTiles pattern (`NovaCommand.jsx:144-213`), MadeBySplit + `DOOR_OUTCOME` formatters + no-lift footer (`NovaCommand.jsx:227-309`), HoursTile (`483-497`), LiveFeed mono lines (`540-553`) | `InboxTile` (+cases/promises footer lines), `DOOR_OUTCOME.inbox` formatter, `FeedMilestoneRow` styling for `kind:'achievement'` |
| Dept-room AgentBar Manual/Assisted/Autonomous switch visuals (`NovaDeptRoomPage.jsx:110-150`) | Switch VISUALS reused as the v1 inbox autonomy dial — writes module 08's `PUT /api/nova/inbox/tier`, never the `:dept/mode` route — + mirrored tier chip in the Inbox header |
| WeeklyReportModal client-computed over the room's 7-day executed slice (`NovaDeptRoomPage.jsx:176-215`) | `INBOX` section grouping + summary line (pure client filter) |
| BriefCard renders the filed morning brief (`NovaCommand.jsx:499-538`) | "While you slept" line spec (data produced by module 09's night pass) |
| Honest-empty culture enforced: server-answered-empty beats fixture (`useNovaRoom.js:9-17`), no-lift footer (`NovaCommand.jsx:303-306`), no fake "Sent" (`Broadcast.jsx:20-23,70-72`) | Honest-empty rules applied to every new tile/tab/chip in this module |
| Support/Sales dept fixtures already name inbox doors — `DOOR_ROUTES Inbox: '/inbox'` (`NovaDeptRoomPage.jsx:65`, `novaData.js:157-158, 191-192`) | Nothing — real ledger rows (modules 02/05/09) fill these rooms |
| OUT: push/email/Telegram founder notification — no push infra exists in the merchant app (recon §3; design-handover §3.3 item 6) | Not built. v1 notification = five decision surfaces + sidebar dot + SSE toast + statusLine. Email-at-24h is v2 |
| OUT: per-intent autonomy dial — requires per-intent authority floors that do not exist in `evaluateAuthority` | v2 (see Scope). v1 risk surface is covered by the single dial + escalation rules |

## Objective

After this module ships, a founder on a staging store can: open `/inbox` and see, without
being told, which threads Nova is handling, which have a draft waiting, and which need them
personally; approve, edit, or discard any Nova draft from the thread itself or from a
two-minute morning review; take over and hand back any thread with one tap each; and answer
"what did Nova's inbox work do for me today?" from the HQ tile, the attribution split, the
morning brief, and the weekly report — with every number tracing to a ledger row they can
open. None of this changes a single byte the customer sees.

## Scope

**In:** extended `/meta/conversations(/:id)` response shapes; server-side `novaState` /
`novaDraft` / `novaComposing` derivation (`src/lib/novaInboxState.js`); `GET /nova/inbox-summary`;
consumption of module 08's `PATCH /meta/conversations/:id/nova` (route shipped there); the
inbox-aware statusLine writer; all new
dakio-merchant components (`NovaThreadChip`, `NovaTypingRow`, `NovaThreadToggle`,
`NovaDraftBar`, `NovaHandoverBanner`, `InboxMorningReview`, `InboxTile`, `FeedMilestoneRow`,
`NovaCommitmentsDrawer`); receipt-drawer transparency extension; Needs-you tab; nav badges;
NovaPresence + suggestions on /inbox; SSE branches for the four v1 event types; weekly-report
INBOX grouping; rendering of module 06's open-cases surface and modules 03/04's
promises/commitments feed; the v1 autonomy-dial UI.

**Out:** the escalation transaction, lock semantics, `/takeover` + `/release` route
implementations — module 08 (this module wires buttons to them). `NovaAchievement` model,
nightly evaluator, dept-room trophy strip, `/nova/attribution` inbox door server side,
`DOOR_OF` entries — module 09. `GET /api/nova/cases` + `openCaseId` production — module 06.
`GET /api/nova/followups` route — module 04 (this module extends its response shape).
`NovaPromise` rows — module 03. `inbox.updated` SSE event, confetti burst, per-intent dial,
auto-handback heuristics, bn statusLine column, live wait-timer tick, mobile numeric badge,
handover SLA push — all v2 (module 12 records them as deferred). Push notification of any
kind — v2.

## Design

Cross-cutting rules 7 (ledger-traceable numerics), 9 (founder always wins), and 18 (gate
discipline) from the phase README bind everything below. Four module-local principles
(design-founder-experience §0): **(1) customer-invisible, founder-obvious** — every Nova
marker is render-side metadata; the Meta payload carries no signature or watermark;
**(2) honesty contract** — every "Nova is X-ing" state derives from a real server row, no
timer-driven animation theater, server-answered-empty beats fixture; **(3) ride the existing
rails** — 4s/6s polls carry v1 liveness, escalations are NovaDecisions (five surfaces free),
feed lines are `activity.created`; **(4) bn+en everywhere the founder reads a reason**.

### D1. The data contract — one derivation module, consumed everywhere

All founder-visible inbox state is computed in **`src/lib/novaInboxState.js` (new,
dakio-api)** and consumed by three callers: `routes/meta.js` (conversation responses),
`GET /nova/inbox-summary`, and the statusLine writer. One source of truth; UI state is a
projection (canonical §2.2: `novaState` is NOT a column).

**`deriveNovaState(conv, { openEscalationDecision, openDraftDecision, composing })` →
`'idle' | 'handling' | 'draft_waiting' | 'needs_you' | 'founder'`**, precedence top-down:

1. `needs_you` — `escalatedAt != null` AND `handedBackAt == null` AND the escalation
   NovaDecision (`escalationDecisionId`) is still pending AND `novaLockedAt == null`.
2. `founder` — `novaLockedAt != null` OR `handledBy === 'founder'`. (A founder manual reply
   in an escalated thread auto-settles the escalation decision — module 08 — so the thread
   falls through 1 and lands here; no dual-state ambiguity.)
3. `draft_waiting` — a pending NovaDecision exists for a prepared `send_inbox_reply` targeting
   this conversation (`targetRef: inbox_conversation:<id>`).
4. `handling` — `handledBy === 'nova'`.
5. `idle` — otherwise (includes brand-new threads Nova has not yet touched).

`novaEnabled === false` does not change the derived state; the UI renders an `OFF` ghost chip
and suppresses Nova chrome (D3). Enforcement is server-side in module 02's reply guards
(`duty:thread_off` blocked rows) — the toggle is never the only gate.

**`deriveNovaComposing(conversationId)`** (canonical C-23): TRUE iff EITHER (a) unprocessed
`NovaInbox` `message.received` events exist for the conversation AND `inboxDelivery` has an
in-flight POST for it, OR (b) a `NovaJob{kind:'inbox_reply', status:'leased'}` with
`payload.conversationId` matches. Row-derived, never a timer. If composing ends without a
sent message (blocked/drafted/refused), the flag simply drops — and if a draft resulted, the
DraftBar is its own honest explanation.

**`novaDraft`**: latest pending prepared `send_inbox_reply` decision for the conversation →
`{ actionId, decisionId, text, chunks: [{text}], purpose, createdAt } | null`. `text` is the
chunks joined with `\n` for preview; approve/edit operate on the decision, never on this
projection.

**Response-shape additions** (exact JSON in APIs section): `GET /meta/conversations` rows
gain `handledBy, novaLockedAt, novaEnabled, novaState, lastIntent, escalatedAt, customerId,
openCaseId, needsYouSince, lastAuthor`; `GET /meta/conversations/:id` messages gain
`actor, novaActionId`, and the response gains `conversation{...}`, `novaDraft`,
`novaComposing`. `needsYouSince = escalatedAt` (no separate column). `lastAuthor` is the
`actor` of the newest message. Reasons shown to the founder come from `escalationReason` plus
the escalation decision's `explanation`/`explanationBn` — there are no stored
`novaStateReason` columns.

**`GET /nova/inbox-summary`** (new, `novaDashboard.js`): all counts from
NovaAction/NovaActivity/InboxConversation/NovaCase/NovaPromise, tenant-local midnight like
`/nova/home` (recon: `novaDashboard.js:759-794` pattern). Powers the HQ tile, the Needs-you
tab is NOT powered by it (that count rides the existing 6s list poll — no extra request).

```
InboxConversation cols (01/08/11) ─┐
pending NovaDecisions (02/05/08) ──┤→ novaInboxState.js ─→ meta.js responses ─→ 4s/6s polls ─→ Inbox chrome
NovaInbox events + NovaJob lease ──┘         │
NovaAction/Activity ledger (09) ────────────►├→ /nova/inbox-summary ─→ InboxTile · MorningReview entry
NovaCase (06) · NovaPromise (03) ───────────►└→ statusLine writer ─→ HQ/Desk ticker (zero UI change)
SSE: conversation.escalated / taken_over / handed_back / case.opened ─→ NovaContext toast + liveVersion
```

### D2. Inbox list row — `NovaThreadChip` + `Nova:` prefix + sort

Small pill on each list row (`Inbox.jsx:514-594`), same visual grammar as the dept-room
`ACTION_CHIP` map (`NovaDeptRoomPage.jsx:26-32`):

| `novaState` | Chip | Style |
|---|---|---|
| `handling` | `NOVA` | lime on ink, 2px pulsing dot — pulse only while state is `handling`, no animation theater |
| `draft_waiting` | `DRAFT READY` | amber, matches `prepared` chip |
| `needs_you` | `NEEDS YOU · 4m` | red/amber, `NovaPulseDot` ping (`Sidebar.jsx:108-116` idiom); elapsed from `needsYouSince`, rendered at poll time (live tick is v2) |
| `founder` | `YOU` | cream outline, neutral |
| `idle` | no chip | — |
| `novaEnabled: false` | `OFF` ghost | ghost outline |

List preview (`Inbox.jsx:570`): `lastAuthor === 'nova'` renders `Nova:` in lime instead of
`You:` — the highest-frequency "Nova is working" signal the founder gets. Sort: `needs_you`
threads float to the top within the active tab, oldest wait first.

### D3. Thread view — by-Nova bubbles, typing row, toggle, deep link

**Bubbles** (`Inbox.jsx:636-730` branch on `message.actor`): `actor === 'nova'` gets (a) a
16px Nova orb avatar left of the bubble cluster — Dak Stamp on ink with 1px lime ring, never
sent to Meta; (b) meta line `NOVA · 2:14 PM` in mono caps; (c) a `ByNovaDot`
(`NovaReceipt.jsx:51-67`, reused as-is) opening the receipt drawer for that `novaActionId`
(D11). `actor === 'founder'` renders unchanged; `founder_external` gets a small
`VIA MESSENGER APP` mono caption so the founder recognizes replies sent from their phone;
`system` (holding/SLA template sends) gets a `SYSTEM` caption. No full-bubble recolor — a
founder scans the conversation first, authorship second.

**`NovaTypingRow`**: rendered at thread bottom when `novaComposing === true` — orb + three-dot
shimmer + mono `NOVA IS REPLYING…`. Rides the 4s poll; disappears when the flag drops. A fast
reply can complete inside one poll window and never show the row — acceptable: the sent bubble
with the orb is itself the evidence.

**`NovaThreadToggle`** in the chat header (`Inbox.jsx:605-628`): compact `NOVA ON / OFF`
switch bound to `PATCH /meta/conversations/:id/nova`. Copy when OFF:
`Nova won't reply here — you have this thread` / bn
`নোভা এখানে রিপ্লাই দেবে না — থ্রেডটা আপনার` (Nova ekhane reply debe na — thread-ta apnar).
Optimistic flip, revert on error. Server logs `recordFounderAction` (verb
`toggle_inbox_nova`, targetRef `inbox_conversation:<id>`). Turning back ON does not clear
`novaLockedAt` — Nova re-engages per module 08's hand-back rules only.

**Deep link**: `/inbox?c=<conversationId>` auto-selects the conversation — the target for
every "OPEN CHAT →" across Nova surfaces. `/inbox?tab=needs_you` selects the tab.

### D4. `NovaDraftBar` — approve / edit / discard above the composer

When `novaDraft` is present, a bar docks above the composer:

```
┌───────────────────────────────────────────────┐
│ ◉ NOVA DRAFTED A REPLY            why? ⓘ      │
│ "Apu, apnar order #1042 kalke Pathao te       │
│  dispatch hobe — kal bikaler moddhe pabben."  │
│ [ SEND ]   [ EDIT ]   [ DISCARD ]             │
└───────────────────────────────────────────────┘
```

- **SEND** → `POST /nova/decisions/:decisionId/approve` — the existing conditional-claim +
  `runActionExecution` path (recon: `novaDashboard.js:420-480`); dakio-api
  `EXECUTORS.send_inbox_reply` (module 02) does the actual Meta send with lock/staleness
  re-check. At-most-once is inherited (`actionId @unique`, 409-safe). A 409 (customer
  double-texted since) surfaces as an honest toast `Customer replied since — Nova is
  refreshing the draft`, never a silent failure.
- **EDIT** → draft chunks load into the real composer as editable text; send button becomes
  `SEND EDITED` and calls approve with `body.edits { body: <newText> }` (customize-and-approve,
  applied before claim — already supported, `novaDashboard.js:430-441`). Edits persist on the
  decision → module 11's edit-distillation has real data.
- **DISCARD** → `POST /nova/decisions/:decisionId/reject` — settles `rejected`, feeds
  `learnFromRejection` + trust (×1.5) automatically.
- **why? ⓘ** → opens the receipt drawer on the prepared action pre-send (D11).
- All three go through the shared optimistic hooks (`NovaContext.jsx:226-239`) so settling
  here clears the Desk, room, chips, and chat cards instantly.
- Dismiss-proof by design (no ✕): a waiting draft is a real pending decision; LATER lives on
  the Desk. When the founder starts typing their own reply the bar collapses to a one-line
  `1 DRAFT WAITING` chip; sending their own reply triggers implicit takeover (module 08 sets
  `novaLockedAt`) and auto-settles the draft decision per module 08's concurrency rules.

### D5. Handover surfaces — banner, Needs-you tab, nav badges, card content

**`NovaHandoverBanner`** under the chat header when `novaState === 'needs_you'`:

```
⚠ NOVA HANDED THIS TO YOU · 4m ago
Reason: Customer is negotiating price below your floor
কারণ: কাস্টমার আপনার নির্ধারিত দামের নিচে দর কষাকষি করছেন
(karon: customer apnar nirdharito damer niche dor koshakoshi korchhen)
[ VIEW BRIEF ] ............... [ RESOLVE & HAND BACK ]
```

Reason lines come from the escalation decision's `explanation`/`explanationBn`. When
`novaState === 'handling'`, the banner is one quiet line: `◉ Nova is handling this — type to
take over` (typing + sending performs implicit takeover — no modal, no friction; mechanics in
module 08). When an open case exists (`openCaseId != null`), a compact chip renders beside
the header: `SHIPPING CASE · waiting on you` keyed on the server case status
(design-orchestration §8) linking to the case's decisions.

**Needs-you tab**: added to the platform tab row (`Inbox.jsx:8-12, 476-503`):
`All / Messenger / Instagram / ⚠ Needs you (2)`. Filters to `novaState === 'needs_you'`,
oldest-wait-first; count from the same 6s list payload. Honest-empty: tab hidden when count
is 0 and the tenant has no handover history — never a permanent empty tab.

**Nav badges**: `novaDoor: 'inbox'` on the Inbox nav item (`Sidebar.jsx:29`); the existing
`NovaPulseDot` pings when `pending > 0` within the 60s presence poll. The server-side
`DOOR_OF` entries (`inbox_conversation`/`inbox_message`/`case` → `'inbox'`) land in module 09;
prepared `send_inbox_reply` rows carry `targetRef: inbox_conversation:<id>` at prepare time
(module 02) so they group before execution. Mobile bottom nav gets the same dot (numeric
badge is v2).

**Handover card content** (rendered by the five existing decision surfaces; content authored
by module 08's brief payload — this module pins what every surface must show):

```
⚠ SUPPORT · NEEDS YOU                       waiting 4m
Rahima Akter · Messenger
─ CONTEXT ─────────────────────────────────
Last: "Vaia 1450 e diben? 2 ta nibo"
2nd-time customer · last order #1042 delivered ✓
Why: Price negotiation below your 10% floor
কেন: ১০% ছাড়ের সীমার নিচে দর চেয়েছেন (keno: 10% chharer simar niche dor cheyechhen)
─ NOVA SUGGESTS ───────────────────────────
"Apu 2 ta nile 1550 kore dite parbo, delivery free. Confirm korbo?"
─ OPEN PROMISES ───────────────────────────
"courier check kore janabo" · due 6:00 PM
[ SEND SUGGESTED ]  [ OPEN CHAT → ]  [ LATER ]
```

Title/`paramsLine`/`impactLabel`/`why` map onto the existing `decisionCard` shape (recon:
`novaDashboard.js:213-254`) — no new component. The context brief = last customer message
verbatim (trimmed 120 chars), one history line from real rows only, reason bn+en, open
promises (the founder inherits the debts — design-customer-memory §3.6). SEND SUGGESTED =
decision approve; OPEN CHAT → = `/inbox?c=<id>`; LATER = existing back-of-queue verb.

### D6. Resolve / hand back — explicit, trust-neutral

The banner's `RESOLVE & HAND BACK` button (bn label `Nova-কে ফিরিয়ে দিন`, Nova-ke firiye
din) calls **`POST /meta/conversations/:id/release`** (module 08's route; canonical C-9 —
there is no `/handback` alias). Module 08's transaction hands the thread back and settles the
open escalation decision as **`expired`** with note `Handled directly in chat` — deliberately
trust-NEUTRAL: reject would penalize Nova ×1.5 for a correct escalation, approve would
execute the suggested reply. v1 is explicit-button-only; auto-handback heuristics are v2.
**Ship-blocker check owned by this module:** a pinned regression test asserts `computeTrust`
excludes `expired` decisions (recon: `novaTrust.js:33-72`) — if that ever changes, correct
escalations would read as founder disapproval.

### D7. Ambient presence — orb, suggestions, statusLine, feed

**NovaPresence on /inbox**: mount `<NovaPresence context="Inbox" title="Inbox" />` (one line,
pattern `GrowTabs.jsx:123`; renders nothing until hired — gate inherited). Add an `Inbox`
surface to `deriveSuggestions` (`suggestions.js:64-123`): dept filter admits tags
`SUPPORT` + `SALES`, yielding real chips with zero model calls — pinned needs-you
(`"2 customers waiting on you"`), draft summary (`"3 drafts ready to review"`), and inbox
evergreens (`"How did chat sales do today?"`, bn `"কার সাথে কথা বলছো এখন?"` — kar shathe
kotha bolcho ekhon?).

**statusLine**: a dakio-api novaCron writer computes `NovaInstance.statusLine` from the SAME
queries as `/nova/inbox-summary` (rule: every number re-derivable from the endpoint at any
moment). Formats — active: `Replying to 3 customers · 2 orders taken today`; quiet:
`Inbox clear · 14 handled today`; escalated: `2 customers waiting on you in Messenger`.
Renders through the existing fallback chain (`NovaContext.jsx:758-761`) with zero UI change.
bn variants are v2 (need a statusLineBn column). **Precedence:** the cron inbox-summary
writer never overwrites a statusLine written by module 08's escalation transaction while
that escalation is unresolved — whenever the needs-you count is > 0 the cron defers;
escalation lines win.

**Feed**: inbox work emits standard `activity.created` rows with the canonical
`NovaActivity.kind` values (canonical §2.15 — `inbox_reply`, `chat_order`, `handover`,
`rto_save`, `case_opened`, `case_resolved`, `followup_scheduled`, `achievement`), which flow
into LiveFeed, the ticker, and HoursTile for free (`minutesSaved` per the canonical
MINUTES table). Feed line examples: `Replied to Rahima on Messenger · order status`
(support), `Order #1067 taken in chat · ৳2,340 COD` (sales), `Handed Karim's thread to you ·
price negotiation` (support).

**SSE**: v1 adds four branches to the `NovaContext.jsx:303-315` switch (canonical §2.10):
`conversation.escalated {conversationId, customerName, reason, decisionId}` → toast
`Customer waiting on you in Messenger — Rahima` linking `/inbox?c=<id>` + liveVersion bump;
`conversation.taken_over` / `conversation.handed_back` / `case.opened` → liveVersion bump
only. Unknown types keep dropping safely. `inbox.updated` (sub-second inbox liveness) is
explicitly v2 — the 4s/6s polls carry v1.

### D8. HQ Command — `InboxTile` + `DOOR_OUTCOME.inbox`

**`InboxTile`** (new, middle column of NovaCommand, exactly the GrowLabTiles pattern
`NovaCommand.jsx:144-213`) reads `GET /nova/inbox-summary`:

```
INBOX
14 handled · 3 orders · ৳6,120 booked
2 WAITING ON YOU →                (links /inbox?tab=needs_you)
3 open cases · oldest 6h →        (links /nova — cases list, module 06 data)
Promises: 3 kept · 1 due in 2h →  (opens NovaCommitmentsDrawer)
```

Footer lines render only when non-zero (honest-empty). Before any inbox action exists the
tile shows `Nova hasn't worked the inbox yet` — never zeros pretending activity. Revenue is
labeled `booked` (estimated until DELIVERED per cross-cutting rule 7 — never presented as
earned revenue).

**`NovaCommitmentsDrawer`** (new): lists `GET /api/nova/followups` rows —
`{dueAt, conversationSubject, reason, promise?}` — with per-row CANCEL (module 04's cancel
path, `cancelled:founder`) and open NovaPromise entries with status chips
(`open / kept / broken / released`). Header: `Nova has promised 4 customers an update ·
3 kept, 1 due in 2h`. Kept-rate detail lives in the Support room scorecard
(`case.promises_kept_pct`, module 09) — the drawer links there rather than recomputing.

**MadeBySplit**: `DOOR_OUTCOME.inbox = (d) => `${d.replies} replies · ${d.orders} orders ·
৳${fmt(d.codBooked)} COD booked`` added to the formatter map (`NovaCommand.jsx:227-239`).
The server `/nova/attribution` inbox door is module 09's; the existing footer "COUNTS AND
EACH DOOR'S OWN RECORDED OUTCOME — NOT AN ATTRIBUTED LIFT" (`NovaCommand.jsx:303-306`)
already carries the honesty framing.

### D9. Briefs, weekly report, achievement rows

**Morning brief**: module 09's night pass supplies the data; the brief assembler appends one
line when the overnight window (22:00–08:00 tenant tz) has inbox activity — en: `While you
slept: 6 customers answered · 1 order taken · ৳2,340 COD booked`; bn: `আপনি ঘুমানোর সময়:
৬ জন কাস্টমারকে উত্তর · ১টি অর্ডার · ৳২,৩৪০` (apni ghumanor somoy: 6 jon customer-ke uttor ·
1ti order · ৳2,340). Counts strictly from executed ledger rows in the window; the line is
omitted entirely when empty — no `While you slept: nothing` filler. Renders through the
existing BriefCard with zero UI change.

**Weekly report**: `WeeklyReportModal` is client-computed over the room's 7-day executed
slice (`NovaDeptRoomPage.jsx:176-215`); this module adds an `INBOX` section header grouping
rows whose `type` is an inbox verb, with a summary line (`23 replies · 4 orders · ৳9,870`)
computed from the same client slice — honestly scoped to the ≤15-action room slice with the
existing caveat styling. No new endpoint.

**`FeedMilestoneRow`**: feed entries with `kind === 'achievement'` (module 09's
NovaAchievement projection — evaluated nightly, once-ever per canonical C-20; there are no
immediate milestone writes) render as a distinct LiveFeed row: lime left rule, Dak Stamp
glyph, cream-on-ink, slightly larger, bn+en title from the achievement row. Confetti burst is
v2; the styled row is the moment.

### D10. `InboxMorningReview` — the T0 shadow ritual

Posture: Nova starts with `NovaAgentMode` scope `door:inbox` = `assisted` (T0 Shadow, ceiling
2 ⇒ every reply drafts). The ritual turns the draft pile into a two-minute morning habit:

- **Entry points**: a NovaDesk card `6 drafts from last night — review in 2 minutes →` and an
  inbox top banner when `draftsWaiting > 3` (from inbox-summary).
- **UI**: card stack, one draft per screen — customer's message verbatim → Nova's draft →
  `[ SEND ] [ EDIT ] [ SKIP ]`, progress `3 OF 6`. SEND/EDIT/SKIP = the same decision
  approve / customize-approve / later verbs through the shared optimistic hooks — settling
  here clears the in-thread DraftBar and Desk simultaneously. EDIT opens an inline textarea,
  sends with `edits`.
- **Approve-all guard**: after the founder has stepped through ≥3 cards this session, a
  `SEND ALL 3 REMAINING` button appears behind a confirm dialog (`Send 3 replies exactly as
  drafted?`). Implementation: sequential per-decision approve calls, 409-safe, partial
  failure reported honestly per card — never a fake bulk success.
- **Trust loop**: approvals/rejections/edits feed `computeTrust` automatically (rejections
  ×1.5, MIN_SAMPLE 5 — `novaTrust.js:33-72`). Promotion out of T0 is a founder-confirmed
  `NovaDecision {kind:'promotion'}` fired when module 08's exit criteria AND module 11's
  delivered-outcome conditions are met — never automatic, and never fired by this UI. The UI
  merely renders the promotion decision card like any other.

### D11. Receipt drawer — "why Nova said this"

Reuses `NovaReceiptDrawer`, opened from bubble `ByNovaDot`, DraftBar `why? ⓘ`, and dept-room
HISTORY rows. Content spec (populated by modules 02/09; this module renders):

- **WHY** — `receipt.reason` bn+en: `Customer asked where order #1042 is; status is
  'dispatched' with Pathao` / `কাস্টমার জানতে চেয়েছেন অর্ডার #১০৪২ কোথায়; স্ট্যাটাস
  'ডিসপ্যাচড', পাঠাও-তে`.
- **DETECTED** — evidence row `{source:'intent', value:'order_status', note:'confidence 0.92'}`
  rendered `DETECTED: ORDER STATUS · 0.92`.
- **GROUNDED ON** — evidence rows pointing at real records (`{source:'order',
  metric:'status', value:'dispatched', note:'#1042 · Pathao'}`). Every fact in the reply maps
  to an evidence row; a reply with zero grounding evidence should never have passed the
  pipeline (module 11's enforcement; this drawer makes a violation visible).
- **CONFIDENCE + AUTONOMY VERDICT** — `executed at T2 · low risk` / `drafted: shadow-mode
  ceiling`, from the receipt + AuthorityDecision rule string (canonical §2.12, each with
  `explanation` + `explanationBn`).
- Drawer extension: render `explanationBn` under the en explanation; format DETECTED/GROUNDED
  sections (small additions to the existing drawer).

### D12. Autonomy dial UI — one dial, tier chip, v2 per-intent

v1 reuses the Support room's `AgentBar` switch visuals (`NovaDeptRoomPage.jsx:110-150`), but
the dial's only write path is module 08's **`PUT /api/nova/inbox/tier`** — it must NOT write
through `PUT /nova/agents/:dept/mode` (that route rejects scope `door:inbox`). The server
enforces the shadow-exit criteria itself: it **422-refuses any T1+ position** until module
08's exit criteria pass, and the UI disables the T1+ positions to match — the disable is
courtesy, the 422 is the gate. A mirrored compact chip in the Inbox header overflow menu
calls the same route. The chip label is computed client-side from mode + guardrail keys (canonical §2.13
encoding), pure function `tierLabel(mode, guardrails)`:

| Condition | Label |
|---|---|
| mode `assisted` | `T0 SHADOW` |
| `autonomous` and `!inbox.orderAuto` | `T1 FRONT DESK` |
| `inbox.orderAuto` and `!(inbox.discountAuto && inbox.cancelAuto)` | `T2 ORDER TAKER` |
| `inbox.orderAuto && inbox.discountAuto && inbox.cancelAuto` | `T3 CLOSER` |

Tier promotions flip guardrail keys via `kind:'promotion'` decisions (module 08); the dial
itself only moves the tier through `PUT /api/nova/inbox/tier`. Dialing DOWN is always
allowed instantly (founder always wins);
missing guardrail keys read `false` ⇒ the label degrades honestly toward T1. The v2
per-intent dial (`Suggest / Draft / Auto` per intent, `refund_request` rendered permanently
locked to `Ask you` mirroring FOUNDER_ONLY styling) needs per-intent authority floors —
deferred, recorded in module 12.

### D13. Cross-module surfaces rendered here + the journey-stage open question

- **Open cases** (data module 06): `GET /api/nova/cases?status=open|waiting_founder` → the
  InboxTile cases footer line and a compact HQ list (`3 delivery cases · 1 payment
  verification · oldest waiting 6h`), each row linking its decisions + `/inbox?c=`.
  `waiting_founder` counts ride the same sidebar inbox dot via DOOR_OF (module 09).
- **Case chip** in the conversation header via `openCaseId` (D5).
- **Promises/commitments** (data modules 03/04): `NovaCommitmentsDrawer` (D8) — followup
  jobs + NovaPromise rows, founder cancel, kept/broken visibility. Handover cards always
  include open promises (D5).
- **Open question (founder)**: should the chat header show the linked customer's journey
  stage (`CustomerJourney.stage`, module 04) as a small chip (`REPEAT BUYER`)? Costs one
  join on the thread endpoint; risk is stage-chip clutter for unlinked threads. Deferred to
  module 12's consolidated open-questions list; the response shape reserves nothing for it.

### D14. Component inventory

**Extend:** `src/pages/meta/Inbox.jsx` (tabs, prefix, chips, bubble branch, deep-link,
mounts) · `src/components/layout/Sidebar.jsx:29` (one line) · `src/pages/nova/lib/suggestions.js`
(Inbox surface) · `src/pages/nova/components/NovaCommand.jsx` (InboxTile slot +
`DOOR_OUTCOME.inbox` + FeedMilestoneRow in LiveFeed) · `src/components/NovaReceipt.jsx`
(drawer extensions) · `src/pages/nova/NovaDeptRoomPage.jsx` (weekly INBOX grouping) ·
`src/context/NovaContext.jsx` (four SSE branches).
**Create (all dakio-merchant, colocated in `src/pages/meta/nova/`):** `NovaThreadChip`,
`NovaTypingRow`, `NovaThreadToggle`, `NovaDraftBar`, `NovaHandoverBanner`,
`InboxMorningReview`, `NovaCommitmentsDrawer`; plus `InboxTile` + `FeedMilestoneRow` inside
NovaCommand.
**Reuse untouched:** `NovaPresence`, `ByNovaChip`/`ByNovaDot`, decision verbs/hooks,
`AgentBar`, dept-room receipts, `BriefCard`, LiveFeed plumbing, presence dot, statusLine
ticker.

## Data model

This module owns **no new Prisma models and no migrations**. It binds to columns owned by
modules 01/03/08/11 — reproduced here (read-only reference) so an implementer can verify the
shapes they join against:

```prisma
// InboxMessage — columns consumed (owned by module 01)
//   actor          String?   // 'customer' | 'nova' | 'founder' | 'founder_external' | 'system'
//   novaActionId   String?   // joins ByNovaDot → NovaAction receipt
//   purpose        String?   // outbound reply purpose slug

// InboxConversation — columns consumed (base: 01 · handover: 08 · identity: 03 · assessment: 11)
//   handledBy             String?    // 'nova' | 'founder' | null
//   novaLockedAt          DateTime?  // hard human-takeover lock; only humans set it
//   novaEnabled           Boolean    @default(true)
//   escalatedAt           DateTime?
//   escalationReason      String?
//   escalationDecisionId  String?
//   handedBackAt          DateTime?
//   lastIntent            String?
//   customerId            String?
//   lastInboundAt         DateTime?

// NO novaState column. NO novaStateReason columns. NO needsYouSince column.
// All three are derived in src/lib/novaInboxState.js (D1). Reasons come from
// escalationReason + the escalation NovaDecision's explanation/explanationBn.
```

Migration notes: none here. The `actor` backfill (`direction:'in'`→`customer`,
`'out'`→`founder`) ships with module 01; this module's UI must render `actor == null` rows
(pre-backfill or race) exactly like `founder` rows — never crash, never mislabel as Nova.
Meta data-deletion hard-deletes conversations (module 01 cascade); every UI surface here must
tolerate a conversation id that 404s between polls (drop the row silently).

## APIs & interfaces

**dakio-api — merchant JWT (routes/meta.js), shapes owned by this module:**

`GET /meta/conversations` — each row gains:

```jsonc
{ "id": "…", /* existing fields */ 
  "handledBy": "nova", "novaLockedAt": null, "novaEnabled": true,
  "novaState": "handling",            // derived, D1
  "lastIntent": "order_status", "escalatedAt": null, "customerId": "c_…|null",
  "openCaseId": null,                  // produced by module 06
  "needsYouSince": null,               // = escalatedAt when needs_you
  "lastAuthor": "nova"                 // actor of newest message
}
```

`GET /meta/conversations/:id` — messages gain `actor`, `novaActionId`; response gains:

```jsonc
{
  "conversation": { "novaState": "draft_waiting", "novaEnabled": true,
                    "handledBy": "nova", "escalationReason": null,
                    "escalationExplanation": null, "escalationExplanationBn": null,
                    "openCaseId": null },
  "novaDraft": { "actionId": "na_…", "decisionId": "nd_…",
                 "text": "Apu, apnar order #1042…", "chunks": [{ "text": "…" }],
                 "purpose": "order_status", "createdAt": "…" },   // | null
  "novaComposing": false
}
```

`PATCH /meta/conversations/:id/nova` (module 08's route — consumed here) `{ "enabled": false }`
→ `{ ok, novaEnabled }` — logs `recordFounderAction`; enforcement stays in module 02's reply
guards (`duty:thread_off`).

`GET /nova/inbox-summary` (novaDashboard.js) →

```jsonc
{ "today": { "handled": 14, "replies": 31, "ordersCreated": 3, "codRevenueBdt": 6120,
             "needsYou": 2, "draftsWaiting": 6 },
  "cases":    { "open": 3, "waitingFounder": 1, "oldestOpenHours": 6 },
  "promises": { "open": 1, "keptToday": 3, "dueNext": "2026-07-25T18:00:00+06:00" },
  "hasActivity": true,                 // false ⇒ tile renders honest-empty copy
  "statusLine": "Replying to 3 customers · 2 orders taken today" }
```

**Consumed (owned elsewhere, listed for the implementer):**
`POST /meta/conversations/:id/takeover` + `POST /meta/conversations/:id/release` (module 08 —
canonical C-9; no `/handback`) · `POST /nova/decisions/:id/approve|reject` + `LATER`
(existing) · `GET /api/nova/followups` (+ cancel; module 04 route — this module extends the
response with `promise? {id, text, status, dueAt}` per row) · `GET /api/nova/cases`
(module 06) · `GET /nova/attribution` inbox door + `GET /nova/rooms/:key` `achievements[]`
(module 09) · `GET /nova/presence` doors (existing).

**nova-ai:** no tools, channels, or instruction changes in this module.

**SSE (merchant bus, consumed):** `conversation.escalated`, `conversation.taken_over`,
`conversation.handed_back`, `case.opened` — four new branches in the NovaContext switch;
producers are modules 01/06/08.

## Files touched

**dakio-api**
- `src/lib/novaInboxState.js` (new) — `deriveNovaState`, `deriveNovaComposing`, `novaDraft`
  projection, shared summary queries (single source for meta.js / inbox-summary / statusLine).
- `src/routes/meta.js` — extended `GET /conversations(/:id)` shapes (batched joins, no
  N+1: one grouped pending-decisions query + one composing probe per page).
  (`PATCH /conversations/:id/nova` is module 08's — consumed here, not added.)
- `src/routes/novaDashboard.js` — `GET /nova/inbox-summary`; `GET /api/nova/followups`
  response gains promise join.
- `src/lib/novaCron.js` — statusLine refresher entry (shares novaInboxState queries).
- `src/lib/novaInboxState.test.js` (new) + `src/routes/meta.nova-shapes.test.js` (new) —
  added to the `package.json` test list.
- `src/lib/novaTrust.test.js` — add the expired-decisions-excluded regression pin.

**dakio-merchant**
- `src/pages/meta/Inbox.jsx` — Needs-you tab, `Nova:` prefix, chip render, bubble actor
  branch, case chip, deep-link `?c=`/`?tab=`, mounts for all new components + NovaPresence.
- `src/pages/meta/nova/NovaThreadChip.jsx` (new) · `NovaTypingRow.jsx` (new) ·
  `NovaThreadToggle.jsx` (new) · `NovaDraftBar.jsx` (new) · `NovaHandoverBanner.jsx` (new) ·
  `InboxMorningReview.jsx` (new) · `NovaCommitmentsDrawer.jsx` (new) ·
  `novaInboxUi.js` (new — `tierLabel`, chip-state map; pure functions).
- `src/pages/nova/components/NovaCommand.jsx` — `InboxTile`, `DOOR_OUTCOME.inbox`,
  `FeedMilestoneRow` branch in LiveFeed.
- `src/components/NovaReceipt.jsx` — `explanationBn` + DETECTED/GROUNDED formatting.
- `src/components/layout/Sidebar.jsx` — `novaDoor: 'inbox'` (one line).
- `src/pages/nova/lib/suggestions.js` — `Inbox` surface context.
- `src/context/NovaContext.jsx` — four SSE branches.
- `src/pages/nova/NovaDeptRoomPage.jsx` — WeeklyReportModal `INBOX` grouping.
- `src/pages/meta/nova/novaInboxUi.test.js` (new) — run via a new `test:inbox` script
  (`node --test`, same pattern as the existing `test:nma` script).

## Testing

dakio-api (node:test, files added to the package.json test list):

1. **State precedence** (`novaInboxState.test.js`): given `escalatedAt` set + pending
   escalation decision + a pending draft, when derived, then `needs_you` (escalation beats
   draft); given the escalation decision settled + `novaLockedAt` set, then `founder`.
2. **Composing honesty** (`novaInboxState.test.js`): given a leased `inbox_reply` job for the
   conversation, then `novaComposing:true`; given the job completes with no send, then false
   on next derivation — never keyed on wall-clock.
3. **Draft projection** (`meta.nova-shapes.test.js`): given two prepared `send_inbox_reply`
   decisions (one settled, one pending), when `GET /conversations/:id`, then `novaDraft` is
   the pending one with `chunks[]` intact and `text` joined.
4. **Toggle audit + enforcement seam** (`meta.nova-shapes.test.js`): given
   `PATCH /nova {enabled:false}`, then a `recordFounderAction` row exists and the reply
   guard fixture returns `duty:thread_off` blocked (integration against module 02's guard).
5. **Summary traceability** (`meta.nova-shapes.test.js`): given a fixture ledger (2 executed
   replies, 1 chat order ৳2,340, 1 open escalation), then inbox-summary returns exactly those
   counts and `statusLine` numbers match the same queries; given an empty tenant, then
   `hasActivity:false` and zeroed counts (honest-empty contract).
6. **Trust-neutral hand-back pin** (`novaTrust.test.js`): given a decision settled `expired`,
   when `computeTrust` runs, then the sample is unchanged — regression-pinned per D6.
7. **Actor-null tolerance** (`meta.nova-shapes.test.js`): given pre-backfill messages with
   `actor:null`, then list/thread endpoints serialize without error and `lastAuthor`
   falls back to direction mapping.

dakio-merchant (`test:inbox`, node --test): 8. **Tier label** (`novaInboxUi.test.js`): given
mode/guardrail-key combinations including missing keys, then labels degrade fail-closed
(`assisted`→T0; `autonomous` with keys absent→T1; full flips→T3).

## Risks & trade-offs

| Risk | Likelihood | Mitigation |
|---|---|---|
| Worst customer-facing failure: DraftBar/MorningReview double-send of an irreversible message | low | inherited at-most-once conditional claim on `actionId @unique`; approve is 409-safe across all surfaces; test 3 + module 02's executor lock re-check |
| Approve-all bulk-sends a bad draft run (messages `undoable:false`) | medium | ≥3-cards-stepped-through minimum + confirm dialog + sequential per-card honest failure reporting; revisit after founder feedback |
| `expired` settle stops being trust-neutral after a trust refactor — correct escalations read as disapproval | low | pinned regression test 6; module 12 lists it as a test-pinned invariant |
| Derived `novaState` adds N+1 queries to the 6s list poll | medium | single grouped pending-decision query + composing probe per page in novaInboxState.js; measured budget in the gate (<150ms added P95) |
| Poll latency (4-6s) misses the "Nova typing" moment on fast replies | high, harmless | acceptable by design — the orb bubble is the evidence; `inbox.updated` SSE is v2 |
| Draft goes stale mid-approve (customer double-texted) and founder sees a 409 | medium | honest toast + auto-refresh of the draft; staleness is module 02's guard doing its job, never silent |
| Stale UI acts on a Meta-hard-deleted conversation | low | all surfaces tolerate 404 between polls (drop row); no client-side caching beyond poll state |
| Founder confusion between `OFF` (toggle) and `YOU` (lock) states | medium | distinct chip styles + toggle sub-copy bn+en; gate demo script checks a non-builder can articulate the difference |

## Gate

**Scripted demo (non-builder, clean staging store, Nova hired, `door:inbox` assisted):**

1. Seed 3 inbound conversations (script provided). Open `/inbox`: see `NOVA` chip pulsing on
   one, `DRAFT READY` on another, `Nova:` list prefix; open the drafted thread — DraftBar
   shows the draft; tap `why? ⓘ` and read WHY/DETECTED/GROUNDED with a bn line.
2. EDIT the draft, send edited — message lands as a Nova-orb bubble with `NOVA · time`;
   ByNovaDot opens the receipt showing the edit.
3. Trigger a price-negotiation escalation (scripted customer message): sidebar dot pings,
   SSE toast appears, `⚠ Needs you (1)` tab shows, banner renders reason bn+en, the same
   card is visible on the Decision Desk. Tap `RESOLVE & HAND BACK` — decision settles
   `expired`, chip returns to `NOVA`, trust sample count unchanged (checked via
   `/nova/agents`).
4. Toggle a thread OFF — `OFF` ghost chip appears; a forced Nova reply attempt lands as a
   `duty:thread_off` blocked ledger row, nothing sends.
5. Open HQ: InboxTile numbers match `/nova/inbox-summary`, which matches hand-counted ledger
   rows; MadeBySplit shows the inbox door with the counts-not-lift footer; run
   `InboxMorningReview` through 3+ cards and use approve-all for the rest.
6. Next morning (or simulated night pass): "While you slept" line appears in the brief;
   weekly modal groups INBOX rows; an achievement row renders as `FeedMilestoneRow`.

**Measurable checks:** every number on InboxTile/statusLine/brief re-derivable from
inbox-summary and ledger queries (spot-audited by the demo runner); `GET /meta/conversations`
added latency P95 < 150ms on a 30-row page against the staging DB; zero Nova markers in any
outbound Meta payload (assert on the send fixture); all 8 named tests green in CI.

**Rollback (no deploy):** config flag `NOVA_INBOX_SURFACES=off` (dakio-api env/config read by
meta.js + novaDashboard.js) omits all nova fields from responses and 404s inbox-summary — the
merchant UI is null-safe on every new field and renders the legacy inbox untouched. Finer
grains remain: per-thread `novaEnabled`, `door:inbox` mode revert to `assisted`, and tenant
kill switch (module 01) — none require touching this module's code.
