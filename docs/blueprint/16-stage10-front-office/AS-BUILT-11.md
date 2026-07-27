# Module 11 — Front Office Inbox UI (the prototype build): AS BUILT

Contract: `Nova Inbox - Front Office.dc.html` (user-supplied zip, visuals) +
PRD FR-11.9 (behavior). PRD won behavior, prototype won visuals, and where the
prototype's fixtures promised data the product does not have, honesty won over
both — each such case is an F-row.

Branch `feat/front-office` in `dakio-api` and `dakio-merchant`.

| Chunk | dakio-api | merchant |
|---|---|---|
| 1 thread `context` + list `draftWaiting` + confirms/rtoSaves into the shared lib | `d868845` + fix-up `0c303f1` | — |
| 2 state chips, Needs-you tab, today-strip | — | `0725018` |
| 3 header identity/journey/NOVA-switch, hand-back, in-thread cards | — | `8f1e967` |
| 4 silent draft on held threads | — | `c4a1b54` |
| 5 the 360 rail | — | `a3592fd` |
| 6 the autonomy dial | — | `3c60cef` |
| 7 tests + this doc + F-rows | — | (chunk-7 commit) |

## 1. What this module actually was

Modules 01–10 built the machine; the founder could not see most of it. Module
11 is the render layer: every state the server already tracked — ownership,
escalation, drafts, identity links, journey stages, promises, cases, the tier —
now has exactly one founder-visible projection, and every projection reads real
rows.

## 2. Decisions

**R1 — chips derive client-side, in `novaInboxView.js`, in the BANNER's
precedence order.** Module 08 refused a server-side `novaState` (meta.js C-5)
and module 10's R1 honoured it; this module keeps honouring it. The prototype's
`chipOf` put YOURS-LOCKED first; the shipped order is NEEDS YOU > NOVA OFF >
LOCKED > DRAFT > HANDLING, because the thread banner has used that order since
module 10 with a written reason (escalated is the only state meaning a customer
is waiting on a human), and a list chip disagreeing with the banner under it is
two answers to one question.

**R2 — one `context` object on the thread endpoint, not four new endpoints.**
Identity + link provenance, journey stage, orders (each with its own
`revenueBasis`), promises, conversation-scoped cases, and the escalation brief
read back from the decision module 08 filed. Four separate polls would race
into four snapshots of one thread. The R5 refusal (no merchant-plane case LIST)
stands — these are this conversation's cases, not a case browser.

**R3 — `draftWaiting` is a boolean on list rows; the words stay off the poll.**
The prototype previews draft text in the list. Deliberately not shipped:
unapproved copy on a 6-second poll is unapproved copy everywhere.

**R4 — the silent draft.** The server blocks Nova sends on founder-held threads
(`inboxSender.js:707`) with one waiver (founder-approved escalation draft). So
on a held thread the draft bar offers USE-only for ordinary drafts — a Send-it
there would mint a receipted blocked row and send nothing — while escalation
drafts keep Send-it, because that is the waiver the server actually honours.

**R5 — the dial renders the server's words.** `GET /nova/inbox/tier` already
returned `positions[]` with `allowed` + `reason` per rung and had zero
consumers. T2/T3 (refused always, server-side) still render so the ladder is
visible, each carrying the server's own sentence; tapping shows that sentence,
no fake toast.

**R6 — in-thread cards render after the transcript, not interleaved.** The
prototype splices order/brief/case cards between messages. The merchant list
merges polled messages with optimistic sends; splicing synthetic rows into that
merge lets a poll reorder the conversation under the founder's cursor. Cards
carry their own timestamps instead.

## 3. Honest deviations (the fixture promised data that does not exist)

- **EN gloss toggle — NOT BUILT.** The prototype's English glosses are fixture
  strings; nothing in the product produces a translation of a message. F-76.
- **NOVA REMEMBERS facts — NOT BUILT.** Per-customer evidence-cited facts have
  no merchant-plane read today. F-77.
- **☎ NOVA CALLS in the thread header — NOT BUILT.** Voice lives in Nova HQ;
  duplicating the entry point was not module 11's call to make. F-78.
- **Draft text in list previews — refused** (R3 above).

## 4. The partial-batch failure worth remembering

Chunk 1's test-fake patch was a three-file batch script with per-file
assertions. It died on file two's assertion AFTER writing file one — and the
run output said "patched" for the file it never reached. The full suite came
back 1873/15 hours later. Both broken files were fakes missing models the
routes now touch; one of them (`novaBrief`) would also have let the new
confirm_order_intent count silently inherit the escalations figure, because its
fake answered the escalation number for ANY unrecognized verb.

Rules this leaves behind: batch scripts over N files must verify all N at the
END (not assert mid-way), and a fake's dispatch-by-where must answer zero for
unknown queries, never another figure's value.

## 5. Baselines at close

| | |
|---|---|
| dakio-api | **1889 pass / 0 fail**, 1 skipped |
| merchant `test:inbox` | **25 pass / 0 fail** |
| merchant build | clean |
| Migrations | none this module |

## 6. If you are starting module 12

Module 12 is the perf/hardening gate. Things this module left it:

1. `GET /meta/conversations` now runs one extra query per poll (prepared
   replies) and the thread endpoint runs six context reads per open — both fine
   at current scale, both worth measuring at 12's load targets. F-75 (no
   `InboxMessage` index for the attribution door) is still open too.
2. The meta test suites are slow when run together on a loaded machine —
   minutes, not seconds. They pass. A 12-scope look at why (server-per-test
   ports, module-mock reloads) would pay for itself.
3. The tier dial consumes `positions[]`; if 12 unlocks T2/T3 the dial needs
   zero changes — the server's `allowed`/`reason` are the contract.
