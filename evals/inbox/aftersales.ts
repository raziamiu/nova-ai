/**
 * Stage 10 module 07 — aftersales and retention.
 *
 * WHAT THIS SUITE IS FOR. Module 07 adds no verb, no job kind and no model. Its
 * substance is eligibility logic, one narrowed hard rule, and copy — so the
 * failures worth catching are not "does the gate deny", which `run.ts` and
 * `delivery.ts` already own, but "does the thing the copy depends on actually
 * exist, and does the copy still say the load-bearing sentence".
 *
 * That is precisely the class of failure this phase keeps shipping. Module 06
 * wrote five verbs into every table and no tool file. Module 07's own spec asked
 * for a stock check through a tool nobody built, a case through a tool nobody
 * built, and a refund block enforced by a verb that does not exist. A prompt is
 * only as true as the capability behind it, and nothing type-checks a sentence.
 *
 * ── WHY THE COPY CHECKS READ THE SOURCE FILE ──────────────────────────────
 * `run.ts` already proves the playbook RENDERS for a customer session and not a
 * founder one, and its slim-tool scan already proves every backticked token in
 * it is a real tool. This suite therefore asserts CONTENT, and reads the source
 * directly rather than rebuilding a session fixture to resolve it. That is
 * deliberate: module 06's delivery suite built an `AuthorityState` fixture,
 * cast it through `unknown`, got three field names wrong, and silently ran every
 * case at level 4. A fixture that can be wrong in a way the compiler cannot see
 * is worse than a text read that admits what it is.
 *
 * WIRING: exports {@link runAftersalesSuite} and self-runs when invoked directly
 * — the same shape as `selling.ts` and `delivery.ts`, so `run.ts` folds its
 * counts in without the import exiting the process.
 *
 * Run:  npx -y tsx evals/inbox/aftersales.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

import { executors } from "../../agent/lib/nova/executors";
import {
  CASE_KINDS,
  DEPARTMENT_BY_CASE_KIND,
  openCasePayload,
  sendInboxReplyPayload,
} from "../../agent/lib/nova/schemas";
import { CUSTOMER_SLIM_TOOLS } from "../../agent/lib/customer/session";
import { renderCustomerInbox } from "../../agent/instructions/50-customer-inbox";

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

const here = dirname(fileURLToPath(import.meta.url));
const playbook = readFileSync(join(here, "../../agent/skills/inbox-conversations.ts"), "utf8");
/**
 * The register AS THE MODEL RECEIVES IT. `HARD_RULES` is deliberately not
 * exported — a test is not a reason to widen a module's surface — and the
 * rendered string is the stronger assertion anyway: a rule that stopped being
 * rendered would still be present in the table.
 */
const register = renderCustomerInbox("(header)", "(persona)");

export async function runAftersalesSuite(): Promise<{ passed: number; failures: string[] }> {
  console.log("\n[aft-1] The returns lane has a way in — the module-06 failure, not repeated");
  {
    // The whole reason module 07 needed a 06.5. `damaged_item` is the one case
    // kind that can NEVER have a server producer: the courier reports DELIVERED,
    // so only the customer knows the thing arrived broken. If this tool ever
    // disappears again, the returns lane silently has no entry point.
    const toolsDir = join(here, "../../agent/tools");
    const openCaseTool = readFileSync(join(toolsDir, "open_case.ts"), "utf8");
    check("open_case has a tool file", openCaseTool.includes('type: "open_case"'));
    check(
      "…and it is on the customer slim set, because a returns conversation IS a customer conversation",
      CUSTOMER_SLIM_TOOLS.includes("open_case"),
    );
    // Comments stripped first: `open_case.ts`'s own docblock explains WHY it has
    // no founder gate, and a naive substring search reads that explanation as
    // the gate itself. Same reason `check-verb-reachability.ts` strips them.
    const openCaseCode = openCaseTool.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    check(
      "…with no requireFounderSession, or it would refuse in the only session that needs it",
      !openCaseCode.includes("requireFounderSession"),
    );
    // The other three module-06 write verbs, same reasoning.
    for (const verb of ["confirm_order_intent", "update_order_contact", "cancel_order_from_chat"]) {
      check(`${verb} is reachable from a customer thread`, CUSTOMER_SLIM_TOOLS.includes(verb));
    }
  }

  console.log("\n[aft-2] damaged_item routes to the room that owes the answer");
  {
    check("damaged_item is a real case kind", (CASE_KINDS as readonly string[]).includes("damaged_item"));
    check("…and it belongs to support", DEPARTMENT_BY_CASE_KIND.damaged_item === "support");
    // The mirror is only useful if it is TOTAL — a kind with no room would make
    // `open_case`'s tool hand `undefined` to `performAction` as a department.
    for (const kind of CASE_KINDS) {
      check(
        `every kind names a room — ${kind}`,
        typeof (DEPARTMENT_BY_CASE_KIND as Record<string, string>)[kind] === "string",
      );
    }
    // A restock wait is inventory's and a payment claim is finance's. If these
    // drift from dakio-api's `DEPARTMENT_BY_KIND` the case and its approval card
    // land on two different desks, which is silent.
    check("restock_wait is inventory's", DEPARTMENT_BY_CASE_KIND.restock_wait === "inventory");
    check("payment_unverified is finance's", DEPARTMENT_BY_CASE_KIND.payment_unverified === "finance");
    // The payload demands the customer's own words, because they are quoted back.
    const noFacts = openCasePayload.safeParse({
      kind: "damaged_item", conversationId: "c1", title: "Broken on arrival",
    });
    check("a case cannot be opened with no facts", !noFacts.success);
  }

  console.log("\n[aft-3] Refunds are blocked by ABSENCE, which is stronger than a set");
  {
    // The module doc says `refund_promise` is FOUNDER_ONLY. It is not a verb at
    // all, in any repo. The outcome the doc wants is real; the mechanism it
    // names is not. Adding the verb to make the sentence true would create a
    // capability where there was none — this pins the absence instead.
    check("there is no refund_promise executor", !("refund_promise" in executors));
    check(
      "…and no tool advertises one to a customer",
      !CUSTOMER_SLIM_TOOLS.some((t) => t.includes("refund")),
    );
    const rule20 = register;
    // Module 07 narrowed this clause. Both halves must survive: Nova may ROUTE a
    // refund question (or it is evasive at the worst moment, about a word the
    // customer just used) and may never GRANT one.
    check("rule 20 still forbids granting a refund", /refund/i.test(rule20) && /owner/i.test(rule20));
    check(
      "…but no longer forbids mentioning one, which collided with the approved returns script",
      !/never yours to mention/i.test(rule20),
    );
    check("rule 20 names answering FOR the owner as the forbidden act", /answering for them/i.test(rule20));
  }

  console.log("\n[aft-4] The review ask carries the order it is about");
  {
    // Without this the once-per-order rule has no key to write under, and the
    // gate reads a map that is always empty — which is what it did before
    // module 07.
    const withOrder = sendInboxReplyPayload.safeParse({
      chunks: [{ text: "apnar shawl ta kemon laglo?" }],
      inReplyToMessageId: "m1", conversationId: "c1", intent: "review_ask",
      language: "banglish", purpose: "review_ask", orderId: "ord-1",
    });
    check("a reply may carry an orderId", withOrder.success, JSON.stringify(withOrder.error?.issues ?? []));
    // Optional, or every ordinary reply in the product breaks.
    const withoutOrder = sendInboxReplyPayload.safeParse({
      chunks: [{ text: "ji bolun" }],
      inReplyToMessageId: "m1", conversationId: "c1", intent: "general", language: "banglish",
    });
    check("…and an ordinary reply still needs none", withoutOrder.success);
  }

  console.log("\n[aft-5] The playbook says the things the lane depends on");
  {
    // EXCHANGE FIRST. This is the module's commercial claim: a swap keeps the
    // sale and costs the shop the item rather than the whole order. If this
    // sentence goes, module 07 is a refund-routing feature.
    check("§14 leads with the exchange, not the money", /Lead with the exchange, not the money/.test(playbook));
    check("§14 opens a damaged_item case", /open_case\\` with kind damaged_item/.test(playbook));
    check(
      "§14 routes a refund to the owner rather than answering it",
      /শপ ওনার নিজে কনফার্ম করেন/.test(playbook),
    );
    // The photo must never become a condition of being believed.
    check("§14 asks for a photo without making it a gate", /never as a\s*\n?\s*condition/.test(playbook));

    // NEVER ASK AN UNHAPPY CUSTOMER FOR A REVIEW. The single most damaging
    // message this playbook could produce.
    check("§15 names unhappy_gate as a shop rule, not an obstacle", /unhappy_gate means this/.test(playbook));
    check("§15 forbids paying for a review", /No\s*\n?\s*incentive, ever/.test(playbook));

    // NO NAME, NO NUDGE. `productName` is null whenever the order read fails,
    // and D6's warning is precisely about improvising around that.
    check(
      "§16 refuses to nudge without a real product name",
      /you do not\s*\n?have the fact, so do not nudge/.test(playbook),
    );
    check("§16 does not chase the dormant", /Answer warmly when they come to you; do not chase/.test(playbook));

    // §10's floor still governs written policy — module 07 carved out the CASE
    // and the SWAP, not the policy statement.
    check(
      "an unwritten exchange policy is still a handover",
      /an\s*\n?unwritten rule is a handover, not a guess/.test(playbook),
    );
  }

  return { passed, failures };
}

async function main(): Promise<void> {
  console.log("Nova inbox — aftersales and retention (module 07)");
  const result = await runAftersalesSuite();
  console.log(`\n${"=".repeat(60)}`);
  if (result.failures.length === 0) {
    console.log(`INBOX AFTERSALES PASSED — ${result.passed} checks green.`);
  } else {
    console.log(
      `INBOX AFTERSALES FAILED — ${result.failures.length} of ${result.passed + result.failures.length} checks failed:`,
    );
    for (const f of result.failures) console.log(`  ✗ ${f}`);
  }
  process.exit(result.failures.length === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Inbox aftersales crashed:", err);
    process.exit(1);
  });
}
