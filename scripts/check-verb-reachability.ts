/**
 * CI check (Stage 10 module 07): every verb in `ActionType` must have a way IN.
 *
 * ── THE BUG THIS EXISTS TO PREVENT ────────────────────────────────────────
 * Module 06 shipped five verbs — `open_case`, `flag_courier_issue`,
 * `confirm_order_intent`, `update_order_contact`, `cancel_order_from_chat` —
 * into every table that takes a verb. `ActionType`, `executors` on both sides,
 * `RISK_CLASS`, `MINUTES_BY_ACTION`, `TARGET_TEXT`, zod payloads, `StoreClient`,
 * guardrails, duties, and a 41-check eval suite. All green.
 *
 * None of them got a tool file, and nothing minted an action row for them
 * either, so neither the model nor the founder-approve path could reach one.
 * The case system had no entry point at all: zero `NovaCase` rows, of any kind,
 * could be created in production. 1852 dakio-api tests and 778 inbox checks
 * stayed green throughout, because they call the routes and executors DIRECTLY
 * — the layer below the missing one.
 *
 * Every existing check runs along the wrong axis to catch this. `check:undo`
 * asks whether a verb's inverse exists. `tsc` forces the total `Record` tables.
 * The inbox eval's registry check proves every tool ON the slim list is
 * exercised — it cannot notice a verb that never became a tool. Reachability is
 * the one property nothing asserted, so this file asserts it.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 * A verb is reachable if EITHER:
 *   (a) some file in `agent/tools/` passes it to `performAction` as `type:`, or
 *   (b) it is listed in `NO_MODEL_TOOL` below with a reason and an owner.
 *
 * Both directions fail: an unreachable verb that is not declared, AND a declared
 * exemption that has since grown a tool. The second half is what keeps this file
 * from rotting into a list of excuses nobody rereads.
 *
 * Static by design, like `check-undo-coverage.ts`: it reads the tool sources
 * rather than importing them, because importing a tool pulls in eve's runtime
 * and a store client. Unlike that file it does NOT slice on comment position —
 * it matches `type: "<verb>"` inside a `performAction(` call, so a verb merely
 * NAMED in a doc comment does not count as reachable.
 *
 * Run:  npx -y tsx scripts/check-verb-reachability.ts   (wired into npm test)
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { executors } from "../agent/lib/nova/executors";

/**
 * Verbs with no model-facing tool, ON PURPOSE. Each needs a reason a reader can
 * check and an owner who would have to change it.
 *
 * "A later module will add the tool" is NOT a valid reason — that is exactly
 * what module 06 believed, and the belief lived only in a doc. If a verb is
 * meant to become callable, it becomes callable in the module that ships it.
 */
const NO_MODEL_TOOL: Readonly<Record<string, string>> = {
  // ── Reached by a NAMED SERVER PRODUCER, which is the other legitimate way ──
  //
  // This is the shape module 06's verbs were missing. The merge ask is minted
  // by dakio-api directly onto the founder's desk — `enqueueMergeAsk` in
  // `src/lib/customerLink.js` (the `addAction({type:'merge_customer_records'})`
  // calls at :1113 and :1141) — because the pair is found by a sweep comparing
  // two Customer rows, which is not a thing a conversation turn can see. It is
  // ALWAYS_DRAFT in both repos, so it always lands as a card.
  merge_customer_records: "server-produced: dakio-api's customerLink.js mints the ask from an identity sweep; ALWAYS_DRAFT, so it always lands as a founder card",

  // ── ALWAYS_DRAFT / advisory, produced by a job lane rather than a turn ────
  //
  // `flag_courier_issue` is ADVISORY in dakio-api and ALWAYS_DRAFT in nova-ai:
  // approving it contacts nobody, it puts a phone call in front of the founder.
  // Its intended producer is the `courier_intervention` job lane.
  //
  // HONEST STATUS: that lane has NO PRODUCER. `courier_intervention` appears in
  // `JOB_KINDS` and `PRIORITY_BY_KIND` and in comments, and nothing enqueues it,
  // so this verb is unreachable in production today. It is listed here rather
  // than given a tool because a founder-facing draft raised from inside a
  // customer turn is the wrong shape — the fix is the producer, which is module
  // 06's debt. Tracked in HUMAN-VERIFICATION-REQUIRED.md.
  flag_courier_issue: "ALWAYS_DRAFT founder briefing; belongs to the courier_intervention job lane, which still has no producer (module 06 debt, F-row filed)",
};

const here = dirname(fileURLToPath(import.meta.url));
const toolsDir = join(here, "../agent/tools");

/**
 * Which verbs the model can actually originate.
 *
 * Matches `type: "<verb>"` only where a `performAction(` call is in scope in the
 * same file — the single pipeline every mutation goes through. A verb named in a
 * comment, a type annotation or a string elsewhere does not count, which is the
 * whole point: module 06's verbs were named in plenty of places.
 */
const callable = new Map<string, string>();
for (const file of readdirSync(toolsDir).filter((f) => f.endsWith(".ts"))) {
  const source = readFileSync(join(toolsDir, file), "utf8");
  if (!source.includes("performAction(")) continue;
  // Strip block and line comments so a verb discussed in the header docblock is
  // not mistaken for a verb dispatched in the body.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const m of code.matchAll(/type:\s*["']([a-z_]+)["']/g)) {
    callable.set(m[1], file);
  }
}

let failed = false;
const verbs = Object.keys(executors).sort();

for (const verb of verbs) {
  const tool = callable.get(verb);
  const exemption = NO_MODEL_TOOL[verb];

  if (tool && exemption) {
    console.error(
      `✗ ${verb}: has a tool (${tool}) AND is declared in NO_MODEL_TOOL — delete the exemption, it now describes the opposite of what is true`,
    );
    failed = true;
  } else if (tool) {
    console.log(`✓ ${verb}: callable — ${tool}`);
  } else if (exemption) {
    console.log(`✓ ${verb}: no tool by design — ${exemption}`);
  } else {
    console.error(
      `✗ ${verb}: NO tool in agent/tools/ and NO entry in NO_MODEL_TOOL. The model cannot originate it and nothing else mints an action row for it, so its executor is unreachable. Either write the tool or declare why it has none.`,
    );
    failed = true;
  }
}

// An exemption for a verb that no longer exists is a stale excuse; the registry
// is the authority on what verbs there are.
for (const verb of Object.keys(NO_MODEL_TOOL)) {
  if (!(verb in executors)) {
    console.error(`✗ ${verb}: declared in NO_MODEL_TOOL but is not a verb in the executor registry`);
    failed = true;
  }
}

if (failed) {
  console.error("\nVERB REACHABILITY CHECK FAILED");
  process.exit(1);
}
console.log(
  `\nVERB REACHABILITY CHECK PASSED — ${verbs.length} verbs audited, ${callable.size} callable, ${Object.keys(NO_MODEL_TOOL).length} exempt by declaration.`,
);
