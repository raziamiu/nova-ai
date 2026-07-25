/**
 * Stage 10 module 03 — the PRIVACY corpus (D10).
 *
 * The redaction boundary has two halves in two repos, and each half is
 * worthless alone. dakio-api decides what may be stored
 * (`src/lib/novaMemoryGuard.js`, called at both memory write routes). nova-ai
 * decides what the model is TOLD when the answer is no. A guard that rejects
 * correctly but reports opaquely produces a model that retries forever; a
 * beautiful refusal message in front of a guard that lets NIDs through is
 * theatre. This suite is the seam between them.
 *
 * Three gates:
 *
 *   [CORPUS]   The deny list, run against dakio-api's REAL guard across the
 *              repo boundary — the same trick `scripts/check-duty-seed-sync.ts`
 *              uses, and it SKIPS loudly (never fails) when the sibling repo is
 *              not checked out beside this one. Adversarial in both directions:
 *              every must-reject case is paired with a legitimate durable fact
 *              of the same SHAPE that must survive. A guard that ate order
 *              numbers, prices, years and phone numbers would pass every
 *              "does it catch an NID?" test ever written and make customer
 *              memory useless.
 *   [REFUSAL]  A guard rejection reaches the model as a named
 *              `MemoryWriteRefused` carrying the server's own sentence and an
 *              explicit don't-retry — through BOTH transport shapes, because
 *              `DakioStoreClient.upsertMemory` now declares `refusalOn: [422]`
 *              (so the 422 arrives pre-parsed as an `InboxSendRefused`) while
 *              `asMemoryRefusal` must still recognise the raw-transport shape.
 *              And the control: a 500 is an OUTAGE, not a refusal.
 *   [RECALL]   D-26 stays pinned. Per-customer memory — in BOTH the post-link
 *              `customer.<id>.<facet>` and pre-link
 *              `customer.psid.<platform>.<senderId>.<facet>` shapes the
 *              distiller writes — never reaches the founder's L3 recall, while
 *              shop-level rows in the same namespace still do. The filter
 *              shipped in the prologue; this keeps it pinned rather than
 *              rebuilding it.
 *
 * Deterministic by construction: no model, no network, no key.
 *
 * WIRING: this module exports {@link runPrivacySuite} instead of running on
 * import, so the integrator can fold it into `evals/inbox/run.ts` or give it
 * its own `test:inbox:privacy` script. It also self-runs when invoked directly
 * (`npx -y tsx evals/inbox/privacy.ts`).
 */

import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildRelevantMemory } from "../../agent/lib/context/layers";
import { MemoryWriteRefused, upsertVia } from "../../agent/lib/memory/service";
import { InboxSendRefused, type StoreClient } from "../../agent/lib/store/client";
import { resetStores, storeFor } from "../../agent/lib/store/resolve";

const AURORA = "store-aurora";

// --- assert framework (same shape as the sibling suites) --------------------

let passed = 0;
let failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

export interface PrivacyCase {
  /** What this row is testing, in one phrase. */
  label: string;
  /** The value as a customer or a founder would actually have written it. */
  value: string;
  /** `true` when the guard must refuse it. */
  reject: boolean;
  /** Why it is in the corpus — the failure this row exists to catch. */
  why: string;
}

/**
 * The deny list and, just as importantly, its negative space.
 *
 * The Bangla-digit rows are not decoration: Bangladeshi customers type ০-৯ and
 * 0-9 in the same sentence, and a guard that only reads Latin digits is a guard
 * a Bangla keyboard walks straight past.
 *
 * The phone rows are the sharpest edge in the whole file. `8801712345678` is
 * exactly thirteen digits, which is also an old-format NID — so an exemption
 * has to run BEFORE the NID check, and if it ever regresses the guard starts
 * refusing "always reachable on 8801712345678" while claiming it found a
 * national ID.
 */
export const PRIVACY_CORPUS: readonly PrivacyCase[] = [
  // ---- NID: 10 (Smart NID), 13 (old), 17 (birth-year prefixed) -------------
  {
    label: "NID · 17-digit",
    value: "customer sent nid 19901234567890123 for the courier form",
    reject: true,
    why: "a national ID in a memory row outlives the conversation by 18 months",
  },
  {
    label: "NID · 13-digit",
    value: "nid 1990123456789 diyeche parcel er jonno",
    reject: true,
    why: "the old-format NID, and the one a phone number is one exemption away from",
  },
  {
    label: "NID · 10-digit Smart NID",
    value: "smart nid card 1990123456",
    reject: true,
    why: "the shortest NID form — a length check that only looks for 13 misses it",
  },
  {
    label: "NID · Bangla digits",
    value: "nid ১৯৯০১২৩৪৫৬৭৮৯ diyeche",
    reject: true,
    why: "a Bangla-digit NID is still an NID",
  },

  // ---- Card PANs: Luhn is the evidence, length is only a shape -------------
  {
    label: "PAN · 16-digit, Luhn-valid",
    value: "paid with card 4111111111111111",
    reject: true,
    why: "the canonical test PAN; storing card digits is never acceptable",
  },
  {
    label: "PAN · printed 4-4-4-4",
    value: "card on file 4242 4242 4242 4242",
    reject: true,
    why: "cards are written the way they are printed, not as one run of digits",
  },
  {
    label: "PAN · Amex 4-6-5",
    value: "amex 3782 822463 10005 for the corporate order",
    reject: true,
    why: "15 digits in a third grouping — a 16-only pattern misses it",
  },
  {
    label: "PAN · 16-digit, Luhn-INVALID",
    value: "warehouse ref 4111111111111112 for the bulk order",
    reject: false,
    why: "the whole reason to run Luhn instead of counting digits — this is not a card",
  },

  // ---- OTP / PIN ----------------------------------------------------------
  {
    label: "OTP · Latin, labelled",
    value: "otp 123456 pathaisi",
    reject: true,
    why: "the code the customer was told never to share",
  },
  {
    label: "OTP · Bangla, labelled",
    value: "আপনার ওটিপি ৪৫৬৭৮৯ কাউকে দেবেন না",
    reject: true,
    why: "the same code in the script the warning itself is written in",
  },
  {
    label: "PIN · bKash",
    value: "bkash pin 12345 bolechilo",
    reject: true,
    why: "a payment PIN is the highest-value string a customer can paste",
  },
  {
    label: "OTP · bare pasted code",
    value: "483920",
    reject: true,
    why: "no durable fact reads like this; it is something pasted out of an SMS",
  },
  {
    label: "OTP · the word without the digits",
    value: "never asks for bkash pin, always pays cod",
    reject: false,
    why: "exactly the durable coaching note this module wants Nova to keep",
  },

  // ---- The negative space: durable facts of a dangerous shape --------------
  {
    label: "negative · order number",
    value: "order #100234 arrived late; gave free delivery on the next one",
    reject: false,
    why: "a complaint outcome is a D9 distill target — refusing it guts the feature",
  },
  {
    label: "negative · price sensitivity",
    value: "negotiates hard — bought at 1200 1500 1800 2000 2200 across five orders",
    reject: false,
    why: "13+ digits of space-separated prices; a loose PAN pattern eats this ~1 time in 10",
  },
  {
    label: "negative · a four-digit year",
    value: "customer since 2019, buys every eid",
    reject: false,
    why: "years look like short codes and are not",
  },
  {
    label: "negative · BD mobile, local form",
    value: "always reachable on 01712345678, prefers calls after 5pm",
    reject: false,
    why: "a logistics pattern is D9's second distill target",
  },
  {
    label: "negative · BD mobile, international form",
    value: "second number 8801712345678 for the office",
    reject: false,
    why: "THIRTEEN DIGITS — the phone exemption must run before the NID check",
  },
  {
    label: "negative · BD mobile, +88 form",
    value: "whatsapp +8801712345678, replies fastest there",
    reject: false,
    why: "the same number again, written the third way people write it",
  },
  {
    label: "negative · BD mobile in Bangla digits",
    value: "অফিসের নম্বর ০১৭১২৩৪৫৬৭৮, ৫টার পরে",
    reject: false,
    why: "latinizing digits must not turn a phone into an ID",
  },
  {
    label: "negative · a plain preference",
    value: "size XL; prefers navy and dark colours, never prints",
    reject: false,
    why: "the single most ordinary thing D9 exists to remember",
  },
] as const;

// ---------------------------------------------------------------------------
// [CORPUS] — the real guard, across the repo boundary
// ---------------------------------------------------------------------------

type GuardEntry = { namespace: string; key: string; value: string };
type GuardObjection = { error: string } | null;
type GuardFn = (entry: GuardEntry) => GuardObjection;

/**
 * dakio-api is a SEPARATE repo checked out beside this one — the same
 * assumption `scripts/check-duty-seed-sync.ts` makes, and the same honest
 * outcome when it is wrong: skip loudly, never fail. A CI runner that has only
 * nova-ai cannot verify a file that was never supposed to be there.
 */
const GUARD_PATH = resolvePath(
  dirname(fileURLToPath(import.meta.url)),
  "../../../dakio-api/src/lib/novaMemoryGuard.js",
);

async function loadGuard(): Promise<GuardFn | null> {
  if (!existsSync(GUARD_PATH)) return null;
  // A computed specifier, so tsc does not try to resolve a JS module in another
  // repo (and `allowJs` stays off). The shape is asserted, not inferred.
  const mod = (await import(pathToFileURL(GUARD_PATH).href)) as { guardMemoryValue?: GuardFn };
  return typeof mod.guardMemoryValue === "function" ? mod.guardMemoryValue : null;
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

export async function runPrivacySuite(): Promise<{ passed: number; failures: string[] }> {
  passed = 0;
  failures = [];

  // --- [CORPUS] ------------------------------------------------------------
  console.log("\n[PRIVACY 1] Redaction corpus against dakio-api's real guard");
  const guard = await loadGuard();
  if (!guard) {
    console.warn(`  ○ SKIPPED: ${GUARD_PATH} not present (dakio-api not checked out beside this repo).`);
    console.warn("    The corpus is only runnable in a full local workspace; dakio-api's");
    console.warn("    src/lib/novaMemoryGuard.test.js runs the same strings on its own side.");
  } else {
    for (const c of PRIVACY_CORPUS) {
      const objection = guard({
        namespace: "customers",
        key: "customer.cus-77.notes",
        value: c.value,
      });
      check(
        `${c.reject ? "refuses" : "stores"}: ${c.label}`,
        c.reject ? objection !== null : objection === null,
        c.reject ? `expected a refusal — ${c.why}` : `unexpectedly refused (${objection?.error}) — ${c.why}`,
      );
    }
    // The corpus itself is part of the gate: a file that quietly lost its
    // negative half would still pass every assertion above.
    check(
      "the corpus keeps both halves — a guard that refused everything must fail here",
      PRIVACY_CORPUS.some((c) => c.reject) && PRIVACY_CORPUS.filter((c) => !c.reject).length >= 8,
      `${PRIVACY_CORPUS.filter((c) => !c.reject).length} negatives`,
    );
    check(
      "…including a phone in all three written forms, Latin and Bangla",
      PRIVACY_CORPUS.filter((c) => !c.reject && /mobile/i.test(c.label)).length === 4,
    );
  }

  // --- [REFUSAL] -----------------------------------------------------------
  console.log("\n[PRIVACY 2] A rejection reaches the model as a refusal, not a retryable fault");
  {
    // The server's own sentence, taken from the real guard where it is
    // available, so this asserts the END-TO-END string rather than a fixture
    // that could drift from what dakio-api actually answers.
    const serverReason =
      guard?.({ namespace: "customers", key: "customer.cus-77.notes", value: "nid 1990123456789" })?.error ??
      "value looks like an NID number (a 10-, 13- or 17-digit national ID)";

    // Shape 1 — the one `refusalOn: [422]` on `DakioStoreClient.upsertMemory`
    // now produces: the client parses the body and throws a typed refusal.
    const declaringClient = {
      upsertMemory: async () => {
        throw new InboxSendRefused(serverReason, `Dakio POST /api/v1/agent-data/memory refused: ${serverReason}`, 422);
      },
    } as unknown as StoreClient;

    // Shape 2 — the raw transport error, which is what arrives if that flag is
    // ever dropped. Both must map to the same refusal, or the behaviour depends
    // on a boolean in another file and the failure mode is a silent retry loop.
    const rawClient = {
      upsertMemory: async () => {
        throw new Error(
          `Dakio POST /api/v1/agent-data/memory → 422: {"error":${JSON.stringify(serverReason)}}`,
        );
      },
    } as unknown as StoreClient;

    for (const [shape, client] of [
      ["declared refusal (refusalOn: [422])", declaringClient],
      ["raw transport 422", rawClient],
    ] as const) {
      let caught: unknown;
      try {
        await upsertVia(client, {
          namespace: "customers",
          key: "customer.cus-77.notes",
          value: "nid 1990123456789",
          source: "nova",
        });
      } catch (err) {
        caught = err;
      }
      const message = String((caught as Error | undefined)?.message ?? "no error thrown");
      check(`${shape}: surfaces as MemoryWriteRefused`, caught instanceof MemoryWriteRefused, message);
      check(`${shape}: carries the server's own reason`, /NID number/i.test(message), message);
      check(`${shape}: tells the model plainly not to retry`, /Do not retry it/.test(message), message);
    }

    // The control that keeps the above from collapsing into "writes fail
    // loudly". An outage SHOULD be retried, and calling it a refusal would
    // teach the model to abandon a write that was only ever late.
    const brokenClient = {
      upsertMemory: async () => {
        throw new Error("Dakio POST /api/v1/agent-data/memory → 500: upstream unavailable");
      },
    } as unknown as StoreClient;
    let outage: unknown;
    try {
      await upsertVia(brokenClient, { namespace: "insights", key: "k1", value: "v1", source: "nova" });
    } catch (err) {
      outage = err;
    }
    check(
      "control: a 500 stays an ordinary error — an outage is not a refusal",
      outage instanceof Error && !(outage instanceof MemoryWriteRefused),
    );
  }

  // --- [RECALL] ------------------------------------------------------------
  console.log("\n[PRIVACY 3] Per-customer memory never reaches the founder's prompt (D-26)");
  {
    resetStores();
    const client = storeFor(AURORA);

    // Both key shapes the distiller writes. `run.ts` pins the post-link form;
    // the PRE-LINK form is the one `conversation_distill` writes first, for
    // every thread that has not earned a customer link yet — and it is exactly
    // as much a named person's notes as the other.
    await client.upsertMemory({
      namespace: "customers",
      key: "customer.cus-77.prefs",
      value: "size XL, prefers navy, receives parcels after 5pm in chattogram",
      source: "nova",
    });
    await client.upsertMemory({
      namespace: "customers",
      key: "customer.psid.messenger.9988776655.complaints",
      value: "chattogram delivery was late twice, threatened to stop ordering",
      source: "nova",
    });
    // The control. Shop-level customer knowledge lives in the SAME namespace
    // and must still reach the founder — otherwise this gate would pass just as
    // well against a filter that dropped the namespace wholesale, or against a
    // recall that never looked there at all.
    await client.upsertMemory({
      namespace: "customers",
      key: "chattogram_cod_rate",
      value: "chattogram cod orders convert 18% better when delivered after 5pm",
      source: "nova",
    });

    const recalled = await buildRelevantMemory(AURORA, "chattogram delivery after 5pm");
    check(
      "control: founder recall really does sweep the customers namespace",
      recalled.includes("chattogram_cod_rate"),
      recalled,
    );
    check(
      "post-link customer.<id>.<facet> notes stay out of the founder's prompt",
      !recalled.includes("customer.cus-77") && !recalled.includes("prefers navy"),
      recalled,
    );
    check(
      "pre-link customer.psid.* notes stay out too — same person, earlier key",
      !recalled.includes("customer.psid") && !recalled.includes("threatened to stop ordering"),
      recalled,
    );
    resetStores();
  }

  return { passed, failures };
}

// --- standalone entry point -------------------------------------------------

async function main(): Promise<void> {
  const result = await runPrivacySuite();
  console.log(`\n${"=".repeat(60)}`);
  if (result.failures.length === 0) {
    console.log(`INBOX PRIVACY SUITE PASSED — ${result.passed} checks green.`);
  } else {
    console.log(
      `INBOX PRIVACY SUITE FAILED — ${result.failures.length} of ${result.passed + result.failures.length} checks failed:`,
    );
    for (const f of result.failures) console.log(`  ✗ ${f}`);
  }
  process.exit(result.failures.length === 0 ? 0 : 1);
}

// Self-run ONLY when invoked directly. Importing this module (which the
// integrator does, to fold these checks into the inbox suite) must not exit the
// host process — `run.ts` and `persona.ts` call `process.exit` at the bottom of
// their own `main`, and a second one firing on import would truncate theirs.
const invokedDirectly =
  process.argv[1] !== undefined && resolvePath(process.argv[1]) === resolvePath(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    console.error("Inbox privacy suite crashed:", err);
    process.exit(1);
  });
}
