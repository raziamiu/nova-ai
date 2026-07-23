/**
 * Team suite (Stage 8 "Team") — the DETERMINISTIC cores.
 *
 * The live negotiation calls, benchmark fleet job, and privacy audit need
 * infrastructure + a human sign-off; these checks pin what must hold exactly:
 * per-agent trust from its own ledger slice (with an events floor), mode
 * resolution order, playbook rollback ordering (reverse + halt on irreversible),
 * the negotiation concession ladder never breaching the guardrail, and the
 * benchmark privacy floor (zero below-floor rows, ever).
 *
 * Run:  npx -y tsx evals/team/run.ts
 */

import {
  agentTrust, resolveMode, planExecution, planRollback, nextOffer,
  aggregateCohort, buildBenchmarks, benchmarkView, BENCHMARK_COHORT_FLOOR,
} from "../../agent/lib/team/engine";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n[1] Per-agent trust from its own ledger slice");
check("under the events floor shows 'earning', no score", agentTrust({ approved: 2, rejected: 0, undone: 0, total: 2 }).earning === true);
const strong = agentTrust({ approved: 18, rejected: 1, undone: 0, total: 19 });
check("a clean slice scores high", (strong.score ?? 0) > 80, String(strong.score));
const weak = agentTrust({ approved: 3, rejected: 6, undone: 3, total: 12 });
check("rejections + undos erode trust", (weak.score ?? 100) < (strong.score ?? 0));

console.log("\n[2] Mode resolution — agent → door → store → default");
check("agent tier wins", resolveMode({ agent: "autonomous", store: "assisted" }).source === "agent");
check("falls to door when no agent mode", resolveMode({ door: "supervised", store: "assisted" }).source === "door");
check("falls to store", resolveMode({ store: "autonomous" }).mode === "autonomous");
check("defaults to assisted", resolveMode({}).mode === "assisted");

console.log("\n[3] Playbook execution + rollback ordering");
const items = [
  { ref: "c1", kind: "content" as const, order: 2, undoable: true },
  { ref: "camp", kind: "campaign" as const, order: 1, undoable: true },
  { ref: "bc", kind: "broadcast" as const, order: 3, undoable: false },
];
check("execution runs low→high order", planExecution(items).map((i) => i.ref).join(",") === "camp,c1,bc");
const rb = planRollback(planExecution(items));
check("rollback reverses executed order", rb.toReverse[0]?.ref === "c1" || rb.irreversible[0]?.ref === "bc");
check("rollback halts at an irreversible piece (sent broadcast)", rb.irreversible.some((i) => i.ref === "bc") && rb.clean === false);
const rbClean = planRollback([{ ref: "a", kind: "campaign", order: 1, undoable: true }, { ref: "b", kind: "content", order: 2, undoable: true }]);
check("all-reversible rollback is clean, reverse-ordered", rbClean.clean === true && rbClean.toReverse[0].ref === "b");

console.log("\n[4] Negotiation concession ladder stays within the guardrail");
const accept = nextOffer({ targetMinor: 100000, theirOfferMinor: 95000, ceilingMinor: 120000, round: 0 });
check("accept when their offer meets our target", accept.action === "accept");
const counter = nextOffer({ targetMinor: 100000, theirOfferMinor: 150000, ourLastMinor: 100000, ceilingMinor: 120000, round: 0 });
check("counter concedes toward them but never over the ceiling", counter.action === "counter" && counter.offerMinor <= 120000, String(counter.offerMinor));
check("never offers above what they asked", counter.offerMinor <= 150000);
const late = nextOffer({ targetMinor: 100000, theirOfferMinor: 200000, ourLastMinor: 118000, ceilingMinor: 120000, round: 5 });
check("a late round still respects the ceiling", late.offerMinor <= 120000);

console.log("\n[5] Benchmark privacy floor — zero below-floor rows, ever");
check("a cohort below the floor produces NO row", aggregateCohort({ metric: "roas", cohort: "fashion:sm:dhaka", values: Array(19).fill(2) }) === null);
const row = aggregateCohort({ metric: "roas", cohort: "fashion:sm:dhaka", values: Array(25).fill(3) });
check("a cohort at/over the floor aggregates", row !== null && row.sampleSize === 25 && row.networkValue === 3);
const built = buildBenchmarks([
  { metric: "roas", cohort: "a", values: Array(30).fill(2) },
  { metric: "roas", cohort: "b", values: Array(5).fill(9) }, // below floor → dropped
]);
check("build drops every below-floor cohort", built.length === 1 && built[0].cohort === "a");
check("floor constant is 20", BENCHMARK_COHORT_FLOOR === 20);
check("cold-start view is honest (no fabricated network value)", benchmarkView(2.5, null).available === false && benchmarkView(2.5, null).networkValue === null);

console.log(`\n${failures.length ? "✗" : "✓"} team suite: ${passed} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.error(`   - ${f}`)); process.exit(1); }
