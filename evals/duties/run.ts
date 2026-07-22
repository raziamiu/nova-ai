/**
 * Duty registry parity suite (PRD E-5, §6).
 *
 * The roster is a promise to the founder, so it gets checked like one. This
 * asserts the seed against the merchant prototype it was mined from (65 rows),
 * pins each deliberate curation edit so a future reader can tell an intentional
 * change from a drift, and — the part that actually matters — proves the
 * honesty mechanism: exactly four duties admit their door isn't built.
 *
 * Run:  npx -y tsx evals/duties/run.ts
 */

import { DUTIES, DOORS, DUTY_BY_KEY, NEEDS_DOOR_DUTIES, dutyStatus, dutyRollup } from "../../agent/lib/duties";
import { NOVA_DEPARTMENTS } from "../../agent/lib/types";

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

/** The prototype's per-department totals, after the documented curation edits. */
const EXPECTED_COUNTS: Record<string, number> = {
  ceo: 6,
  marketing: 10,
  sales: 8,
  support: 6,
  product_research: 7,
  inventory: 5,
  shipping: 5,
  finance: 7,
  operations: 5,
  growth: 6,
};

/** The PRD's four named NEEDS DOOR duties. Growing this list is a regression. */
const EXPECTED_NEEDS_DOOR = [
  "shipping.rate_compare",
  "shipping.rto_reduction",
  "finance.pnl_reports",
  "operations.rfq_compare",
];

function main(): void {
  console.log("\n[1] Roster shape");
  check("65 duties total", DUTIES.length === 65, `got ${DUTIES.length}`);
  check(
    "per-department counts match the curated prototype",
    Object.entries(EXPECTED_COUNTS).every(([d, n]) => DUTIES.filter((x) => x.department === d).length === n),
    JSON.stringify(Object.fromEntries(Object.keys(EXPECTED_COUNTS).map((d) => [d, DUTIES.filter((x) => x.department === d).length]))),
  );
  check(
    "counts sum to 65",
    Object.values(EXPECTED_COUNTS).reduce((a, b) => a + b, 0) === 65,
  );
  check("every department is a real NOVA_DEPARTMENTS key", DUTIES.every((d) => (NOVA_DEPARTMENTS as readonly string[]).includes(d.department)));
  check("every department has at least one duty", NOVA_DEPARTMENTS.every((d) => DUTIES.some((x) => x.department === d)));

  console.log("\n[2] Keys are stable identity");
  const keys = DUTIES.map((d) => d.key);
  check("keys are unique", new Set(keys).size === keys.length);
  check("keys are <department>.<snake_case>", keys.every((k) => /^[a-z_]+\.[a-z0-9_]+$/.test(k)));
  check("key prefix matches the duty's department", DUTIES.every((d) => d.key.startsWith(`${d.department}.`)));
  check("lookup map covers every duty", DUTY_BY_KEY.size === DUTIES.length);

  console.log("\n[3] Doors");
  check("every duty points at a registered door", DUTIES.every((d) => DOORS[d.door] !== undefined), DUTIES.filter((d) => !DOORS[d.door]).map((d) => d.door).join(", "));
  check("every registered door is actually used", Object.keys(DOORS).every((door) => DUTIES.some((d) => d.door === door)), Object.keys(DOORS).filter((door) => !DUTIES.some((d) => d.door === door)).join(", "));
  check("doors that don't exist declare the phase that builds them", Object.values(DOORS).every((s) => s.exists || !!s.buildPhase));
  check("the six Grow Lab modules all exist (they shipped ahead of Nova)", ["Campaigns", "Content Studio", "Broadcast", "Research", "Growth", "Goals"].every((d) => DOORS[d]?.exists === true));

  console.log("\n[4] The honesty mechanism — NEEDS DOOR is exactly the PRD's four");
  const needsDoor = NEEDS_DOOR_DUTIES.map((d) => d.key).sort();
  check(
    "exactly 4 duties have no door",
    needsDoor.length === 4,
    `got ${needsDoor.length}: ${needsDoor.join(", ")}`,
  );
  check(
    "they are the four the PRD names",
    JSON.stringify(needsDoor) === JSON.stringify([...EXPECTED_NEEDS_DOOR].sort()),
    needsDoor.join(", "),
  );
  check(
    "no OTHER duty silently points at an unbuilt door",
    DUTIES.filter((d) => !DOORS[d.door]?.exists).length === 4,
  );

  console.log("\n[5] Curation edits are deliberate, not drift");
  check("finance.pnl_reports exists (merged Weekly P&L + Cashflow forecast)", DUTY_BY_KEY.has("finance.pnl_reports"));
  check("operations.rfq_compare exists (merged Quote comparison + Supplier scorecards)", DUTY_BY_KEY.has("operations.rfq_compare"));
  check(
    "the merged RFQ duty keeps the LOWER minLevel (scorecards are a read)",
    DUTY_BY_KEY.get("operations.rfq_compare")?.minLevel === 1,
    String(DUTY_BY_KEY.get("operations.rfq_compare")?.minLevel),
  );
  check("operations.supplier_switching was ADDED (switch_supplier is a shipped verb)", DUTY_BY_KEY.has("operations.supplier_switching"));
  check("shipping.delay_prediction was ADDED (PRD §6 charter)", DUTY_BY_KEY.has("shipping.delay_prediction"));
  check(
    "support.review_responses was re-doored to Inbox (Reviews screen doesn't exist)",
    DUTY_BY_KEY.get("support.review_responses")?.door === "Inbox",
  );
  check(
    "marketing's two ad duties were re-doored to Campaigns",
    DUTY_BY_KEY.get("marketing.ad_budget_optimization")?.door === "Campaigns" &&
      DUTY_BY_KEY.get("marketing.pause_weak_ad_sets")?.door === "Campaigns",
  );
  check("no duty named 'Weekly P&L' survives the merge", !DUTIES.some((d) => d.name === "Weekly P&L"));

  console.log("\n[6] Bangla roster (bn+en, §14)");
  check("every duty has a Bangla name", DUTIES.every((d) => d.nameBn.trim().length > 0));
  check(
    "Bangla names actually contain Bengali script",
    DUTIES.every((d) => /[ঀ-৿]/.test(d.nameBn)),
    DUTIES.filter((d) => !/[ঀ-৿]/.test(d.nameBn)).map((d) => d.key).join(", "),
  );
  check("Bangla names are not copies of the English", DUTIES.every((d) => d.nameBn !== d.name));

  console.log("\n[7] Levels");
  check("minLevel is within the 0–4 ladder", DUTIES.every((d) => d.minLevel >= 0 && d.minLevel <= 4));
  check(
    "the two irreversible money duties sit at L4",
    DUTY_BY_KEY.get("support.refund_processing")?.minLevel === 4 &&
      DUTY_BY_KEY.get("operations.payment_terms_negotiation")?.minLevel === 4,
  );
  check("read-only watch duties sit at L0", DUTIES.filter((d) => d.minLevel === 0).every((d) => /monitor|alert|oversight/i.test(d.name)));

  console.log("\n[8] Status is computed, and honest");
  const rateCompare = DUTY_BY_KEY.get("shipping.rate_compare")!;
  check(
    "no door beats level: NEEDS_DOOR even at L4",
    dutyStatus(rateCompare, { effectiveLevel: 4 }) === "NEEDS_DOOR",
    "raising autonomy must not imply an unbuilt screen became usable",
  );
  const refund = DUTY_BY_KEY.get("support.refund_processing")!;
  check("L4 duty is LOCKED at L3", dutyStatus(refund, { effectiveLevel: 3 }) === "LOCKED");
  check("L4 duty is ACTIVE at L4", dutyStatus(refund, { effectiveLevel: 4 }) === "ACTIVE");
  check("disabled duty reads PAUSED", dutyStatus(refund, { effectiveLevel: 4, enabled: false }) === "PAUSED");
  check("a built-door duty within level is ACTIVE", dutyStatus(DUTY_BY_KEY.get("inventory.stock_monitoring")!, { effectiveLevel: 0 }) === "ACTIVE");

  console.log("\n[9] Rollups");
  const rollupL4 = dutyRollup(DUTIES, 4);
  check("rollup covers all 10 departments", Object.keys(rollupL4).length === 10);
  check(
    "rollup totals sum to 65",
    Object.values(rollupL4).reduce((s, r) => s + r.total, 0) === 65,
  );
  check(
    "at L4, active = 65 minus the 4 unbuilt doors",
    Object.values(rollupL4).reduce((s, r) => s + r.active, 0) === 61,
    String(Object.values(rollupL4).reduce((s, r) => s + r.active, 0)),
  );
  const rollupL0 = dutyRollup(DUTIES, 0);
  check(
    "at L0 far fewer duties are active than at L4",
    Object.values(rollupL0).reduce((s, r) => s + r.active, 0) <
      Object.values(rollupL4).reduce((s, r) => s + r.active, 0),
  );

  console.log("\n" + "=".repeat(60));
  if (failures.length > 0) {
    console.error(`DUTY REGISTRY SUITE FAILED — ${failures.length} failing, ${passed} passing.`);
    process.exit(1);
  }
  console.log(`DUTY REGISTRY SUITE PASSED — ${passed} checks green.`);
}

main();
