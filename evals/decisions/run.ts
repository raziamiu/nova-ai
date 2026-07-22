/**
 * Decision suite (PRD E-9, Stage 2 "Consent").
 *
 * The Stage 2 promise is "one record, four surfaces, zero drift". These checks
 * are mostly about the *drift* half — that a decision knows every surface it
 * was shown on, that deferring it doesn't lose it, and that the card never
 * claims more than the receipt supports.
 *
 * Run:  npx -y tsx evals/decisions/run.ts
 */

import { DemoStore } from "../../agent/lib/store/backend";
import { createSeed } from "../../agent/lib/store/seed";
import { performAction } from "../../agent/lib/nova/actions";
import { authorDecision, paramsLineFor, impactLabelFor, queueDigest } from "../../agent/lib/nova/decisions";
import type { ActionRecord, AuthorityState, AutonomyLevel, DecisionRecord, StoreSeed } from "../../agent/lib/types";
import { DUTIES, DOORS } from "../../agent/lib/duties";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const RECEIPT = {
  reason: "Lapsed buyers need a nudge before the Eid window closes.",
  expectedImpact: "+৳12,400/wk estimated from the last winback",
  confidence: 0.72,
  evidence: [{ source: "customers", note: "38 lapsed 60-90d, none messaged in 7d" }],
};

function storeAt(level: AutonomyLevel, overrides: Partial<AuthorityState> = {}): DemoStore {
  const seed: StoreSeed = createSeed(Date.UTC(2026, 6, 23, 12, 0, 0));
  const store = new DemoStore(seed);
  const state: AuthorityState = {
    level,
    earnedLevel: 4,
    guardrails: { version: 3, dailySpendCapMinor: 500_000, maxDiscountPct: 20, noTouch: [], platform: seed.autonomy.guardrails },
    modes: { store: "autonomous" },
    duties: Object.fromEntries(DUTIES.map((d) => [d.key, { key: d.key, minLevel: d.minLevel, enabled: true, doorExists: DOORS[d.door]?.exists ?? false }])),
    spentTodayMinor: 0,
    ...overrides,
  };
  (store as unknown as { getAuthority: () => Promise<AuthorityState> }).getAuthority = async () => state;
  return store;
}

const discount = {
  type: "create_discount" as const,
  department: "sales" as const,
  title: "Create 10% winback code WINBACK10",
  payload: { code: "WINBACK10", percentOff: 10, scope: "order" as const, expiresInDays: 7 },
  receipt: RECEIPT,
};

async function main(): Promise<void> {
  console.log("\n[1] A gated action becomes a decision the founder can answer");
  const store = storeAt(2);
  const result = await performAction(store, discount);
  check("level-2 prepares the action", result.status === "prepared", result.detail);
  const decisions = await store.listDecisions();
  check("exactly one decision was authored", decisions.length === 1, String(decisions.length));

  const d = decisions[0];
  check("it links the action, so payload/receipt/undo stay in one place", d.actionId === result.actionId);
  check("it starts queued", d.status === "queued");
  check("it is tagged with the department (its room)", d.tag === "sales");
  check("kind is a proposal, not an escalation", d.kind === "proposal");
  check("it carries the founder-facing title", d.title === discount.title);

  console.log("\n[2] The card says what the receipt supports — and no more");
  check("impact comes from the receipt's expected impact", d.impactLabel.includes("12,400"), d.impactLabel);
  check("why comes from the receipt's reason", d.why === RECEIPT.reason);
  check("params are scannable", d.paramsLine.includes("10% off") && d.paramsLine.includes("7 days"), d.paramsLine);
  check(
    "an unquantified impact says so rather than inventing a number",
    impactLabelFor({ receipt: { ...RECEIPT, expectedImpact: "" } } as unknown as ActionRecord) === "Impact not quantified",
  );
  check(
    "an unknown verb produces an empty params line, not a guess",
    paramsLineFor("some_new_verb", { anything: 1 }) === "",
  );
  check("a long impact is truncated, not dropped", impactLabelFor({ receipt: { ...RECEIPT, expectedImpact: "x".repeat(200) } } as unknown as ActionRecord).endsWith("…"));

  console.log("\n[3] One record, every surface");
  check("it lists the desk", d.surfacedIn.includes("desk"));
  check("it lists its department room", d.surfacedIn.includes("room:sales"));
  check("it lists its door module", d.surfacedIn.includes("door:coupons"), JSON.stringify(d.surfacedIn));
  check("three surfaces from one record", d.surfacedIn.length === 3);

  console.log("\n[4] Queue semantics");
  const many = storeAt(2);
  const first = await performAction(many, { ...discount, title: "First" });
  const second = await performAction(many, { ...discount, title: "Second" });
  const q = await many.listDecisions();
  check("FIFO: first asked, first in the queue", q[0].title === "First" && q[1].title === "Second", q.map((x) => x.title).join(","));

  const firstDecision = q[0];
  await many.updateDecision(firstDecision.id, { status: "later" });
  const afterLater = await many.listDecisions();
  const later = afterLater.find((x) => x.id === firstDecision.id)!;
  check("'Later' keeps the card — it is deferred, not declined", later.status === "later");
  check("and sends it to the BACK of the queue", later.queuePos > afterLater.find((x) => x.title === "Second")!.queuePos, `${later.queuePos}`);

  console.log("\n[5] Pinning — urgent asks are not buried");
  const risky = storeAt(2);
  await performAction(risky, {
    type: "create_purchase_order",
    department: "operations",
    title: "Reorder 500 units",
    payload: { supplierId: "sup-lotus", productId: "prod-yogamat", quantity: 500, unitCost: 1320 },
    receipt: RECEIPT,
  });
  await performAction(risky, { ...discount, title: "Ordinary ask" });
  const riskyQueue = await risky.listDecisions();
  check("the high-risk ask is pinned to priority 1", riskyQueue[0].priority === 1, JSON.stringify(riskyQueue.map((x) => [x.title, x.priority])));
  check("and sorts ahead of an older ordinary ask", riskyQueue[0].title.includes("Reorder"), riskyQueue[0].title);

  console.log("\n[6] Refusals that need a human become escalations");
  const locked = storeAt(4, { guardrails: { version: 3, dailySpendCapMinor: 500_000, maxDiscountPct: 20, noTouch: ["WINBACK10"], platform: createSeed(0).autonomy.guardrails } });
  const refused = await performAction(locked, discount);
  check("the action is blocked", refused.status === "blocked", refused.detail);
  const escalations = await locked.listDecisions();
  check("an escalation card was raised", escalations.length === 1 && escalations[0].kind === "escalation", JSON.stringify(escalations.map((e) => e.kind)));
  check("escalations pin to the top", escalations[0].priority === 1);

  console.log("\n[7] Decisions expire, because a stale ask is worse than none");
  check("a decision carries an expiry", !!d.expiresAt);
  const hours = (Date.parse(d.expiresAt!) - Date.parse(d.createdAt)) / 3600000;
  check("medium risk expires in ~72h", Math.round(hours) === 72, String(hours));
  const highRisk = riskyQueue.find((x) => x.priority === 1)!;
  const highHours = (Date.parse(highRisk.expiresAt!) - Date.parse(highRisk.createdAt)) / 3600000;
  check("high risk expires sooner (24h) — its context moves fastest", Math.round(highHours) === 24, String(highHours));

  console.log("\n[8] Queue digest for the context layer");
  check("an empty desk says so", queueDigest([]) === "Nothing waiting on the founder.");
  const digest = queueDigest(await risky.listDecisions());
  check("the digest counts what is waiting", digest.includes("2 waiting"), digest);
  check("and flags pinned items", digest.includes("pinned"), digest);
  const frozenDigest = queueDigest([{ status: "frozen", priority: 5 } as DecisionRecord]);
  check("and names frozen ones", frozenDigest.includes("frozen"), frozenDigest);

  console.log("\n[9] Executed actions do not ask permission");
  const auto = storeAt(4);
  const executed = await performAction(auto, {
    type: "resolve_ticket",
    department: "support",
    title: "Reply to ticket",
    payload: { ticketId: "tick-01", reply: "Sorted — thanks for waiting.", newStatus: "resolved" as const },
    receipt: RECEIPT,
  });
  check("an executed action just happens", executed.status === "executed", executed.detail);
  check("and authors NO decision — there is nothing to ask", (await auto.listDecisions()).length === 0);

  console.log("\n" + "=".repeat(60));
  if (failures.length > 0) {
    console.error(`DECISION SUITE FAILED — ${failures.length} failing, ${passed} passing.`);
    process.exit(1);
  }
  console.log(`DECISION SUITE PASSED — ${passed} checks green.`);
}

main().catch((error) => {
  console.error("Suite crashed:", error);
  process.exit(1);
});
