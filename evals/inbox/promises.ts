/**
 * Stage 10 module 03 — the UNDECLARED-PROMISE gate (D7).
 *
 * "কুরিয়ারের সাথে কথা বলে কাল জানাবো" is a debt. dakio-api writes a
 * `NovaPromise` row for every promise the model DECLARES, sweeps it nightly and
 * grades it — so the ledger is honest about the debts it knows about, and blind
 * to the ones it does not. This suite is what closes that blind spot at build
 * time: outbound reply text that commits to a future action, sent WITHOUT the
 * `promise` field, is a debt nobody wrote down.
 *
 * Extraction is self-declared, never NLP-mined (D7): the model that just wrote
 * "kal janabo" is the only thing that knows what it meant by it, and a
 * production NLP pass would both miss debts and invent them. This regex is
 * therefore a CI gate over a fixed corpus, not a runtime detector — it fails the
 * build, it never rewrites a reply.
 *
 *   [RED]      ≥10 committing phrases with NO `promise` field. Every one MUST
 *              be flagged. This is the corpus the doc specifies.
 *   [GREEN]    the same sentences WITH a valid declared promise, plus ordinary
 *              non-committing replies. None may be flagged — a gate that fires
 *              on "dam 1250 taka" would teach the next builder to delete it.
 *   [NON-VAC]  every RED entry is asserted to match the phrase regex and to be
 *              a payload the real zod schema ACCEPTS. A red corpus of payloads
 *              the model could never emit is not coverage, it is decoration.
 *
 * ## What this suite can and cannot prove
 *
 * It proves the corpus and the detector agree, and that a declared promise is
 * shaped the way the server will accept it (`PROMISE_KINDS` is byte-shared with
 * `NovaPromise.kind`). It does NOT observe a live model. Production coverage
 * comes from the corpus growing by sampling real outbound text — and from the
 * fact that the broken-promise sweep still catches every DECLARED miss, so
 * kept-rate is honest either way: only declared promises are graded.
 *
 * ## Wiring — read this before believing it is a gate
 *
 * A corpus that is not in `package.json`'s `&&` chain is not a gate; it is a
 * file (D-33). This one IS in the chain: it exports {@link runPromisesSuite} and
 * does not exit at import, `evals/inbox/run.ts` imports and awaits it into the
 * same pass/fail totals and the same exit code, and `test:inbox` is one of the
 * `&&` links in `npm test`. It also still self-runs standalone
 * (`npx -y tsx evals/inbox/promises.ts`) for iteration.
 *
 * That paragraph used to say the opposite — that a standalone run was "the only
 * thing that runs it" — for the whole life of the integration commit that wired
 * it in. Section [promise-7] below pins the two together in BOTH directions, so
 * neither the sentence nor the wiring can rot without a red check.
 *
 * Deterministic by construction: no model, no network, no key.
 *
 * Run:  npx -y tsx evals/inbox/promises.ts
 */

import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { renderJobPrompt } from "../../agent/lib/jobs/prompts";
import { executors } from "../../agent/lib/nova/executors";
import { PROMISE_KINDS, sendInboxReplyPayload } from "../../agent/lib/nova/schemas";
import { DemoStore } from "../../agent/lib/store/backend";
import { resetStores, storeFor } from "../../agent/lib/store/resolve";
import type { NovaJob } from "../../agent/lib/types";

const AURORA = "store-aurora";
const HERE = dirname(fileURLToPath(import.meta.url));

// --- assert framework (same shape as the sibling suites) --------------------

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- the detector -----------------------------------------------------------

/**
 * The committing-phrase alternation from the module doc's D7, branch for
 * branch, in Banglish and in Bangla script.
 *
 * TWO DELIBERATE WIDENINGS of the doc's literal string, both recorded rather
 * than smuggled:
 *
 *  - `i('|)ll` also accepts the TYPOGRAPHIC apostrophe `’`. A model writing
 *    "I’ll get back to you" would walk straight through the doc's regex, and
 *    that is the single most likely English phrasing in the whole list.
 *  - matching runs over NFC-normalized text. Bangla conjuncts and matras have
 *    more than one Unicode spelling, so an NFD-decomposed "জানাবো" is a
 *    different byte string that means the same word — the same reason module
 *    02's no-touch lock matcher normalizes.
 *
 * Everything else is the doc's, verbatim in meaning and order. This is the
 * whole gate: if a phrase is not here, the build does not fail, and the debt is
 * caught only by a human reading the transcript.
 */
export const COMMITTING_PHRASE = new RegExp(
  [
    "janachchi",
    "janabo",
    "janiye dibo",
    "inform korbo",
    "update d(?:e|i)bo",
    "confirm kor(?:bo|chi)",
    "khoj nichchi",
    "dekhe bolchi",
    "kotha bole (?:bolchi|janabo)",
    "জানাচ্ছি",
    "জানাবো",
    "জানিয়ে দেবো",
    "আপডেট দেবো",
    "খোঁজ নিচ্ছি",
    "i(?:'|’|)ll (?:check|confirm|get back|let you know)",
    "will update you",
  ].join("|"),
  "iu",
);

/** Every bubble of a reply, joined — a promise can be split across chunks. */
function replyText(payload: { chunks?: Array<{ text?: string }> }): string {
  return (payload.chunks ?? []).map((c) => c?.text ?? "").join("\n").normalize("NFC");
}

/**
 * The gate itself. `true` means "this reply commits to something and declared
 * nothing" — a build failure.
 *
 * Note the asymmetry that makes it safe to run as a hard gate: it only ever
 * flags a MISSING declaration. It never inspects whether the declared promise
 * matches the sentence, because that judgement needs the model's intent and
 * this file does not have it.
 */
export function isUndeclaredPromise(payload: {
  chunks?: Array<{ text?: string }>;
  promise?: unknown;
}): boolean {
  if (payload.promise != null) return false;
  return COMMITTING_PHRASE.test(replyText(payload));
}

// --- fixtures ---------------------------------------------------------------

const BASE = {
  conversationId: "conv-promise-1",
  inReplyToMessageId: "m-1",
  intent: "order_status",
  language: "banglish",
} as const;

const one = (text: string, over: Record<string, unknown> = {}) => ({
  ...BASE,
  chunks: [{ text }],
  ...over,
});

/**
 * [RED] — the corpus the doc specifies. Sixteen entries, one per branch of the
 * alternation, each a sentence a shopkeeper really would type, each committing
 * to a future action, none carrying a `promise` field. All sixteen must fail.
 */
const RED: Array<{ label: string; payload: ReturnType<typeof one> }> = [
  { label: "janachchi", payload: one("ji bhai, courier er sathe check kore janachchi") },
  { label: "janabo", payload: one("kal sokale apnake janabo") },
  { label: "janiye dibo", payload: one("stock ashle janiye dibo") },
  { label: "inform korbo", payload: one("product ta ashle apnake inform korbo") },
  { label: "update debo", payload: one("kalke ekta update debo apnake") },
  { label: "update dibo", payload: one("bikale update dibo, tension korben na") },
  { label: "confirm korbo", payload: one("size ta dekhe confirm korbo") },
  { label: "confirm korchi", payload: one("ekhon warehouse e confirm korchi, ektu wait korun") },
  { label: "khoj nichchi", payload: one("apnar order er khoj nichchi") },
  { label: "dekhe bolchi", payload: one("stock ta dekhe bolchi apnake") },
  { label: "kotha bole janabo", payload: one("courier er sathe kotha bole janabo") },
  { label: "bn: জানাচ্ছি", payload: one("কুরিয়ারের সাথে কথা বলে জানাচ্ছি", { language: "bn" }) },
  { label: "bn: জানাবো", payload: one("কাল সকালে আপনাকে জানাবো", { language: "bn" }) },
  { label: "bn: আপডেট দেবো", payload: one("বিকেলে একটা আপডেট দেবো", { language: "bn" }) },
  { label: "bn: খোঁজ নিচ্ছি", payload: one("আপনার অর্ডারের খোঁজ নিচ্ছি", { language: "bn" }) },
  { label: "en: I'll get back to you", payload: one("Sure — I'll get back to you once the courier replies.", { language: "en" }) },
  { label: "en: I'll check", payload: one("I'll check with the warehouse now.", { language: "en" }) },
  { label: "en: will update you", payload: one("Noted — will update you by tomorrow morning.", { language: "en" }) },
  // The split-across-bubbles case. A commitment does not have to fit in one
  // bubble, and a per-chunk gate would miss exactly the reply that reads most
  // naturally.
  {
    label: "split across two bubbles",
    payload: { ...BASE, chunks: [{ text: "ekhon courier office bondho" }, { text: "kal janabo apnake" }] },
  },
  // The typographic apostrophe. This one is the reason for the widening
  // documented on COMMITTING_PHRASE: the doc's literal regex lets it through.
  { label: "en: I’ll confirm (typographic apostrophe)", payload: one("I’ll confirm the price with my supplier.", { language: "en" }) },
];

/**
 * [GREEN] — the same commitments, declared. `dueAtISO` is what makes the
 * promise gradeable at all: `promise_sweep` finds a debt past
 * `dueAt + graceHours`, so a promise with no due time can never be kept OR
 * broken, and dakio-api 422s it for that reason.
 */
const DECLARED = {
  text: "kal sokale courier er update janabo",
  kind: "courier_check",
  dueAtISO: new Date(Date.now() + 20 * 60 * 60_000).toISOString(),
};

const GREEN: Array<{ label: string; payload: Record<string, unknown> }> = [
  { label: "committing text WITH a declared promise", payload: { ...one("kal janabo apnake"), promise: DECLARED } },
  { label: "bn committing text WITH a declared promise", payload: { ...one("কাল সকালে জানাবো", { language: "bn" }), promise: DECLARED } },
  { label: "en committing text WITH a declared promise", payload: { ...one("I'll get back to you tomorrow.", { language: "en" }), promise: DECLARED } },
  // Non-committing replies. A gate that fires on these is a gate the next
  // builder deletes.
  { label: "a plain price answer", payload: one("ji bhai, eta 1250 taka") },
  { label: "a plain stock answer", payload: one("ha, M ar L duitai ache") },
  { label: "an answer that names a delivery window without promising to report", payload: one("Dhaka te 2-3 din e pouchabe") },
  { label: "an apology with no commitment", payload: one("dukkhito bhai, ei rong ta shesh hoye geche") },
  { label: "bn: a plain answer", payload: one("জি, এটার দাম ১২৫০ টাকা", { language: "bn" }) },
];

// --- the suite --------------------------------------------------------------

export async function runPromisesSuite(): Promise<{ passed: number; failures: string[] }> {
  console.log("\n[promise-1] RED corpus — a commitment with no declaration fails the build");
  {
    // The doc asks for ≥10. Asserted, so trimming the corpus is a visible edit
    // rather than a quiet one.
    check(`red corpus has at least 10 committing phrases (has ${RED.length})`, RED.length >= 10);

    for (const { label, payload } of RED) {
      check(`undeclared: ${label}`, isUndeclaredPromise(payload), JSON.stringify(replyText(payload)));
    }
  }

  console.log("\n[promise-2] NON-VACUITY — every red entry is a payload the model could really emit");
  {
    // A red corpus made of payloads zod rejects would pass this gate forever
    // while proving nothing: the model can never send them, so the detector is
    // never exercised on anything real.
    for (const { label, payload } of RED) {
      const parsed = sendInboxReplyPayload.safeParse(payload);
      check(`schema-valid: ${label}`, parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues[0]));
      check(`carries no promise field: ${label}`, (payload as { promise?: unknown }).promise === undefined);
    }
  }

  console.log("\n[promise-3] GREEN corpus — declared promises and ordinary answers pass");
  {
    for (const { label, payload } of GREEN) {
      check(`clean: ${label}`, !isUndeclaredPromise(payload as { chunks?: Array<{ text?: string }> }));
    }
    // …and the declarations themselves have to be acceptable to the server, or
    // the "declare it" instruction is advice the wire refuses.
    for (const { label, payload } of GREEN) {
      if (!(payload as { promise?: unknown }).promise) continue;
      const parsed = sendInboxReplyPayload.safeParse(payload);
      check(`declared promise is schema-valid: ${label}`, parsed.success,
        parsed.success ? "" : JSON.stringify(parsed.error.issues[0]));
    }
  }

  console.log("\n[promise-4] The declared kind is the shared taxonomy, not a free-form label");
  {
    // `PROMISE_KINDS` is byte-shared with the `NovaPromise.kind` column and with
    // `PromiseKind` in types.ts — three copies of one taxonomy, because the
    // model names the kind, zod rejects anything else, and Postgres stores the
    // string. A value that exists in only two of the three is a promise that
    // either cannot be declared or cannot be written.
    check("the taxonomy is the doc's nine", PROMISE_KINDS.length === 9);
    check("DECLARED.kind is one of them", (PROMISE_KINDS as readonly string[]).includes(DECLARED.kind));

    const invented = sendInboxReplyPayload.safeParse({
      ...one("kal janabo"),
      promise: { ...DECLARED, kind: "restock_notice" },
    });
    check("an invented kind is rejected by zod", !invented.success);

    const noDue = sendInboxReplyPayload.safeParse({
      ...one("kal janabo"),
      promise: { text: DECLARED.text, kind: DECLARED.kind },
    });
    check("a promise with no dueAtISO is rejected — it could never be kept or broken", !noDue.success);
  }

  console.log("\n[promise-5] The detector itself is not vacuous");
  {
    // Prove the regex can say no. If someone widened it to `.*` every check
    // above would still be green and the suite would be worthless.
    check("plain text does not match the phrase regex", !COMMITTING_PHRASE.test("ji bhai, eta 1250 taka"));
    check("committing text does match it", COMMITTING_PHRASE.test("kal janabo"));
    // And that the `promise` field is what clears it — not the wording.
    const same = one("kal janabo apnake");
    check("the same sentence flips on the presence of the field",
      isUndeclaredPromise(same) && !isUndeclaredPromise({ ...same, promise: DECLARED }));
  }

  console.log("\n[promise-6] A fulfilment reply SETTLES the debt it pays back");
  {
    // Declaring a debt and paying one are the two halves of one ledger, and
    // this suite used to pin only the first. `open → kept` needs a
    // `keptActionId`, that id is written by exactly one call —
    // `settlePromise` — and until the reply executor made it, nothing in either
    // repo ever moved a promise out of `open`: every declared debt aged past
    // its grace window, `runPromiseSweep` marked it `broken`, the founder's
    // desk filled with "Promise broken — X is still waiting" cards about
    // promises answered on time, and `inbox.promise.kept_rate` (D-37) read 0%
    // structurally.
    resetStores();
    const demo = storeFor(AURORA) as DemoStore;
    const CONV = "conv-promise-fulfil";
    demo.seedInboxConversation({
      id: CONV,
      customerId: "cus-nusrat-1",
      messages: [{ direction: "in", actor: "customer", text: "courier er khobor ki?", id: "m-in-1" }],
    });
    const debt = demo.seedPromise({
      id: "prm-fulfil-1",
      conversationId: CONV,
      customerId: "cus-nusrat-1",
      text: "courier er sathe kotha bole kal janabo",
      kind: "courier_check",
    });
    check("the debt starts open", debt.status === "open");

    // Called the way `performAction` calls it: with the STORED payload object,
    // not a zod-parsed one. `promiseId` rides that object — see the OWNER note
    // in `send_inbox_reply` for the hops that still have to land before a model
    // can put it there, which is why this corpus is the thing exercising it.
    const paid = await executors.send_inbox_reply(demo, {
      ...one("courier bollo kal delivery hobe"),
      conversationId: CONV,
      inReplyToMessageId: "m-in-1",
      promiseId: debt.id,
    });

    const kept = (await demo.listPromises({ status: "kept" })).find((p) => p.id === debt.id);
    check("the debt leaves `open` — nothing else in either repo can move it", kept !== undefined);
    check("it settles KEPT rather than waiting to be swept broken", kept?.status === "kept");
    check("the ledger outcome names the promise this reply paid", paid.outcome.includes(debt.id), paid.outcome);
    check(
      "and the receipt records which debt it answered",
      (paid.after as Record<string, unknown> | null)?.fulfilsPromiseId === debt.id,
    );

    // The control. A reply that pays nothing back must settle nothing — a
    // settle that fired on every send would keep debts no message answered,
    // which is the same lie in the flattering direction.
    const OTHER = "conv-promise-plain";
    demo.seedInboxConversation({
      id: OTHER,
      messages: [{ direction: "in", actor: "customer", text: "dam koto?", id: "m-in-1" }],
    });
    const untouched = demo.seedPromise({
      id: "prm-untouched-1",
      conversationId: OTHER,
      text: "stock ashle janabo",
      kind: "restock_notify",
    });
    const plain = await executors.send_inbox_reply(demo, {
      ...one("ji bhai, eta 1250 taka"),
      conversationId: OTHER,
      inReplyToMessageId: "m-in-1",
    });
    const still = (await demo.listPromises({ status: "open" })).find((p) => p.id === untouched.id);
    check("a reply with no promiseId settles nothing", still?.status === "open");
    check("and its outcome claims nothing about a promise", !/promise/i.test(plain.outcome), plain.outcome);

    // A refused settle must NOT un-send the reply. The bubbles are queued; a
    // 409 (usually "the sweep got there first") is an answer about the ledger,
    // and recording the action as failed would say a delivered message was
    // never sent — the mirror of the rule the executor exists to keep.
    const settledAlready = demo.seedPromise({
      id: "prm-already-1",
      conversationId: CONV,
      text: "kal janabo",
      kind: "follow_up_info",
      status: "broken",
    });
    const anyway = await executors.send_inbox_reply(demo, {
      ...one("ekhon o courier reply kore nai"),
      conversationId: CONV,
      inReplyToMessageId: "m-in-1",
      promiseId: settledAlready.id,
    });
    check("a refused settle still reports the reply as queued", anyway.outcome.startsWith("Queued"));
    check("and says plainly that the debt is still on the books", /NOT settled/.test(anyway.outcome), anyway.outcome);
  }

  console.log("\n[promise-7] The wiring paragraph and the wiring agree (D-33)");
  {
    // This file's header is titled "read this before believing it is a gate",
    // and for the whole life of the integration commit it told the reader the
    // opposite of the truth: that a standalone `npx tsx` run was the only thing
    // that ran the corpus. Pinned in BOTH directions, because either half can
    // rot: unwire the runner and the first check fails; re-introduce the "only
    // thing that runs it" sentence and the second does.
    const runner = readFileSync(resolvePath(HERE, "run.ts"), "utf8");
    check("evals/inbox/run.ts imports runPromisesSuite", runner.includes("runPromisesSuite"));
    const self = readFileSync(resolvePath(HERE, "promises.ts"), "utf8");
    const header = self.slice(0, self.indexOf("import "));
    check(
      "and this file's header no longer claims nothing runs it",
      !header.includes("is the only thing that\n * runs it") && !header.includes("is the only thing that runs it"),
    );
  }

  console.log("\n[promise-8] The nightly promise lane belongs to the server, and the prompt registry says so");
  {
    // `promise_sweep` is what GRADES every row this suite is about, so what
    // nova-ai tells a model about that lane is a promise-ledger fact. All three
    // module-03 sweeps are checked together because one mechanism kills them
    // all: dakio-api's `leaseServerSweeps` claims these kinds inside the claim
    // transaction, before the candidates query, so the dispatcher can never be
    // handed one.
    //
    // The templates used to carry plausible instructions for work that cannot
    // be done from here — "mark each one broken" against a route that answers
    // 409 SWEEP_ONLY to exactly that claim, "propose a merge decision" with no
    // merge tool in `agent/tools/`, "write memory updates" with `remember`
    // founder-only under D-24 — under a comment asserting the three lanes
    // "really do run as `job:<id>` founder-plane sessions".
    const asJob = (kind: NovaJob["kind"]): NovaJob => ({
      id: "job-x",
      kind,
      payload: {},
      dueAt: new Date().toISOString(),
      priority: 6,
      status: "due",
      attempts: 0,
      lastError: null,
      dedupeKey: `${kind}:2026-07-20T03:00:00.000Z`,
      leaseUntil: null,
      leaseToken: null,
    });

    const sweep = renderJobPrompt(asJob("promise_sweep"));
    check("the promise_sweep template names the server as the executor", /server-side/i.test(sweep), sweep);
    check(
      "and no longer tells a model to mark promises broken — the route answers 409 SWEEP_ONLY to that claim",
      !/broken/i.test(sweep),
      sweep,
    );
    for (const kind of ["promise_sweep", "identity_merge_sweep", "conversation_distill"] as const) {
      const text = renderJobPrompt(asJob(kind));
      check(`${kind}: reads as a routing tripwire, not as work`, /routing broke/i.test(text), text);
    }
    // Non-vacuity: a lane that really IS model work still reads as instructions,
    // so this section cannot pass by the templates having gone empty.
    check(
      "a genuinely model-run lane still gets real instructions",
      /Load the morning-report skill/.test(renderJobPrompt(asJob("morning_report"))),
    );
  }

  return { passed, failures };
}

async function main(): Promise<void> {
  console.log("Nova inbox — undeclared-promise gate (module 03 D7)");
  const result = await runPromisesSuite();

  console.log(`\n${"=".repeat(60)}`);
  if (result.failures.length === 0) {
    console.log(`INBOX PROMISE GATE PASSED — ${result.passed} checks green.`);
  } else {
    console.log(`INBOX PROMISE GATE FAILED — ${result.failures.length} of ${result.passed + result.failures.length} checks failed:`);
    for (const f of result.failures) console.log(`  ✗ ${f}`);
  }
  process.exit(result.failures.length === 0 ? 0 : 1);
}

// Self-running when invoked directly (`npx tsx evals/inbox/promises.ts`), inert
// when imported — same shape as `c360.ts`, so the integrator can call
// `runPromisesSuite()` from the inbox runner without the import exiting the
// process out from under it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Inbox promise gate crashed:", err);
    process.exit(1);
  });
}
