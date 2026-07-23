/**
 * Authority seam suite (PRD §4, §5) — Stage 1's breach corpus.
 *
 * This is the file that has to be adversarial. Every check below is an attempt
 * to get Nova to do something the founder forbade, and the assertion is that it
 * refused AND said which rule stopped it. A gate that refuses for the wrong
 * reason is nearly as bad as one that doesn't refuse: the founder can't fix
 * what they can't identify.
 *
 * Run:  npx -y tsx evals/authority/run.ts
 */

import { DemoStore } from "../../agent/lib/store/backend";
import { createSeed } from "../../agent/lib/store/seed";
import {
  evaluateAuthority,
  lockMatches,
  normalizeForMatch,
  resolveMode,
  effectiveLevel,
  targetTextFor,
  FOUNDER_ONLY,
  TARGET_TEXT,
  SPEND_MINOR,
} from "../../agent/lib/nova/authority";
import { performAction } from "../../agent/lib/nova/actions";
import type { AuthorityState, AutonomyLevel, NovaMode, StoreSeed } from "../../agent/lib/types";
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
  reason: "Authority suite: exercising the seam deterministically.",
  expectedImpact: "None — test artifact.",
  confidence: 0.9,
  evidence: [{ source: "authority-suite", note: "fixture receipt" }],
};

/** A store whose authority state we control precisely. */
function storeWith(overrides: {
  level?: AutonomyLevel;
  earnedLevel?: AutonomyLevel;
  noTouch?: string[];
  modes?: Record<string, NovaMode>;
  maxDiscountPct?: number;
  dailySpendCapMinor?: number;
  spentTodayMinor?: number;
  duties?: Record<string, { key: string; minLevel: number; enabled: boolean; doorExists: boolean }>;
}): DemoStore {
  const seed: StoreSeed = createSeed(Date.UTC(2026, 6, 23, 12, 0, 0));
  const store = new DemoStore(seed);
  const base: AuthorityState = {
    level: overrides.level ?? 4,
    earnedLevel: overrides.earnedLevel ?? 4,
    guardrails: {
      version: 7,
      dailySpendCapMinor: overrides.dailySpendCapMinor ?? 500_000,
      maxDiscountPct: overrides.maxDiscountPct ?? 20,
      noTouch: overrides.noTouch ?? [],
      platform: seed.autonomy.guardrails,
    },
    modes: overrides.modes ?? { store: "autonomous" },
    duties:
      overrides.duties ??
      Object.fromEntries(
        DUTIES.map((d) => [d.key, { key: d.key, minLevel: d.minLevel, enabled: true, doorExists: DOORS[d.door]?.exists ?? false }]),
      ),
    spentTodayMinor: overrides.spentTodayMinor ?? 0,
  };
  // Override the composed read so each case is exact.
  (store as unknown as { getAuthority: () => Promise<AuthorityState> }).getAuthority = async () => base;
  return store;
}

async function main(): Promise<void> {
  // ── 1. Founder-only verbs ───────────────────────────────────────────────
  console.log("\n[1] Founder-only verbs are propose-only at EVERY level");
  for (const level of [0, 1, 2, 3, 4] as AutonomyLevel[]) {
    const d = await evaluateAuthority(storeWith({ level, earnedLevel: 4 }), {
      type: "bulk_refund",
      payload: { orderIds: ["ord-1", "ord-2"], reason: "batch" },
    });
    check(
      `bulk_refund refused at L${level}`,
      d.verdict === "refuse" && d.rule === "founder_only:bulk_refund",
      `${d.verdict} / ${d.rule}`,
    );
  }
  const escalated = await evaluateAuthority(storeWith({ level: 4 }), {
    type: "bulk_refund",
    payload: { orderIds: ["ord-1"], reason: "x" },
  });
  check("the refusal is escalated, not silently dropped", !!escalated.escalation, JSON.stringify(escalated.escalation));
  check("escalation carries the rule that fired", escalated.escalation?.rule === "founder_only:bulk_refund");
  check("every founder-only verb is classified", ["bulk_refund", "guardrail_edit", "promotion_accept", "contract_sign"].every((v) => FOUNDER_ONLY.has(v)));

  // ── 2. No-touch locks ───────────────────────────────────────────────────
  console.log("\n[2] No-touch locks");
  check("normalize folds case and punctuation", normalizeForMatch("SAREE — Pricing!") === "saree pricing");
  check("NFC: composed and decomposed Bangla compare equal", normalizeForMatch("শাড়ি".normalize("NFD")) === normalizeForMatch("শাড়ি".normalize("NFC")));
  // Regression: the normalizer once stripped combining marks (\p{M}), which
  // shredded Bangla into single letters — every token then dropped as noise, so
  // a Bangla lock silently protected NOTHING. Caught by the shared vectors.
  check("Bangla survives normalization intact (matras are marks, not letters)", normalizeForMatch("শাড়ির দাম") === "শাড়ির দাম", normalizeForMatch("শাড়ির দাম"));
  check("a Bangla lock actually matches Bangla text", lockMatches("শাড়ির দাম", "শাড়ির দাম পরিবর্তন"));
  check("and does not fire on unrelated English", !lockMatches("শাড়ির দাম", "shirt price change"));
  check("all lock tokens must appear (AND, not OR)", lockMatches("saree pricing", "saree pricing update") && !lockMatches("saree pricing", "saree restock"));
  check("token order doesn't matter", lockMatches("saree pricing", "pricing for the saree"));
  check("a near-miss does not fire", !lockMatches("saree pricing", "shirt pricing"));
  check("single-char noise is ignored", !lockMatches("a", "anything"));

  const locked = await evaluateAuthority(storeWith({ level: 4, noTouch: ["SAREE PRICING"] }), {
    type: "update_price",
    payload: { productId: "saree-01", productName: "Silk Saree", newPrice: 5000 },
  });
  check("a matching lock refuses", locked.verdict === "refuse", `${locked.verdict} / ${locked.rule}`);
  check("the rule names the lock", locked.rule.startsWith("no_touch:"), locked.rule);
  check("the explanation quotes the founder's own words", locked.explanation.includes("SAREE PRICING"));

  const unrelated = await evaluateAuthority(storeWith({ level: 4, noTouch: ["SAREE PRICING"] }), {
    type: "resolve_ticket",
    payload: { ticketId: "tick-1", reply: "Sorted, thanks for waiting.", newStatus: "resolved" },
  });
  check("an unrelated action is not caught by the lock", unrelated.verdict !== "refuse", unrelated.rule);

  // The important one: a verb with no extractor cannot be proven safe.
  const unverifiable = await evaluateAuthority(storeWith({ level: 4, noTouch: ["SAREE PRICING"] }), {
    type: "some_unregistered_verb",
    payload: { anything: "saree pricing" },
  });
  check(
    "an unlockable verb refuses while locks exist (ambiguity → refusal)",
    unverifiable.verdict === "refuse" && unverifiable.rule === "no_touch:unverifiable",
    `${unverifiable.verdict} / ${unverifiable.rule}`,
  );
  check("with NO locks set, the same verb is not refused for that reason", (await evaluateAuthority(storeWith({ level: 4 }), { type: "some_unregistered_verb", payload: {} })).rule !== "no_touch:unverifiable");
  check("every shipped action verb has a targetText extractor", ["update_price", "create_discount", "create_campaign", "update_campaign", "publish_social_post", "send_customer_message", "resolve_ticket", "create_purchase_order", "switch_supplier", "assign_courier", "import_product"].every((v) => typeof TARGET_TEXT[v] === "function"));
  check("an unregistered verb yields null target text", targetTextFor("nope", {}) === null);

  // ── 3. Mode is a ceiling, never a promotion ─────────────────────────────
  console.log("\n[3] Mode × level composes as min(), not max()");
  check("door mode beats store mode", resolveMode({ store: "autonomous", "door:Coupons": "manual" }, "Coupons") === "manual");
  check("store mode applies when no door row", resolveMode({ store: "manual" }, "Coupons") === "manual");
  check("assisted is the default when nothing is set", resolveMode({}, null) === "assisted");
  const st = (level: AutonomyLevel, mode: NovaMode): AuthorityState =>
    ({ level, earnedLevel: 4, modes: { store: mode }, guardrails: { version: 1, dailySpendCapMinor: 0, maxDiscountPct: 0, noTouch: [], platform: {} as never }, duties: {}, spentTodayMinor: 0 });
  check("manual caps a L4 store at 1 (suggest)", effectiveLevel(st(4, "manual"), null) === 1);
  check("assisted caps a L4 store at 2 (draft)", effectiveLevel(st(4, "assisted"), null) === 2);
  check("autonomous imposes no ceiling", effectiveLevel(st(4, "autonomous"), null) === 4);
  check("mode never RAISES a low level", effectiveLevel(st(1, "autonomous"), null) === 1);
  check("earnedLevel caps the configured level", effectiveLevel({ ...st(4, "autonomous"), earnedLevel: 3 }, null) === 3);

  // ── 4. Level semantics, with L1 and L2 observably different ─────────────
  console.log("\n[4] Level semantics — L1 suggests, L2 drafts");
  const lowRisk = { type: "resolve_ticket", payload: { ticketId: "t", reply: "hello there", newStatus: "resolved" } };
  check("L0 refuses everything", (await evaluateAuthority(storeWith({ level: 0 }), lowRisk)).verdict === "refuse");
  check("L1 suggests", (await evaluateAuthority(storeWith({ level: 1 }), lowRisk)).verdict === "suggest");
  check("L2 drafts", (await evaluateAuthority(storeWith({ level: 2 }), lowRisk)).verdict === "draft");
  check("L3 executes a LOW-risk action", (await evaluateAuthority(storeWith({ level: 3 }), lowRisk)).verdict === "execute");
  check(
    "L3 only drafts a HIGH-risk action",
    (await evaluateAuthority(storeWith({ level: 3 }), { type: "create_purchase_order", payload: { supplierId: "s", productId: "p", quantity: 1, unitCost: 10 } })).verdict === "draft",
  );
  check(
    "L4 executes the same high-risk action",
    (await evaluateAuthority(storeWith({ level: 4 }), { type: "create_purchase_order", payload: { supplierId: "s", productId: "p", quantity: 1, unitCost: 10 } })).verdict === "execute",
  );

  // ── 5. Duties ───────────────────────────────────────────────────────────
  console.log("\n[5] Duty gating");
  const unknownDuty = await evaluateAuthority(storeWith({ level: 4 }), { ...lowRisk, dutyKey: "support.not_a_duty" });
  check("an unknown duty key fails closed", unknownDuty.verdict === "refuse" && unknownDuty.rule === "duty:unknown");
  const paused = await evaluateAuthority(
    storeWith({ level: 4, duties: { "support.customer_replies": { key: "support.customer_replies", minLevel: 2, enabled: false, doorExists: true } } }),
    { ...lowRisk, dutyKey: "support.customer_replies" },
  );
  check("a paused duty is skipped, and says so", paused.verdict === "refuse" && paused.rule === "duty:paused");
  const belowMin = await evaluateAuthority(storeWith({ level: 2 }), {
    type: "resolve_ticket",
    payload: { ticketId: "t", reply: "hello there", newStatus: "resolved" },
    dutyKey: "support.refund_processing",
  });
  check("a duty above the effective level is refused", belowMin.verdict === "refuse" && belowMin.rule === "duty:min_level", `${belowMin.verdict} / ${belowMin.rule}`);
  // Stage 6 shipped the last four doors, so shipping.rate_compare is no longer a
  // NEEDS DOOR duty — it must NOT be refused for lacking a door now (the door
  // exists on the Reach page). The needs_door refusal mechanism itself stays in
  // evaluateAuthority for any future undoored duty; today there are none.
  const nowDoored = await evaluateAuthority(storeWith({ level: 4 }), {
    type: "assign_courier",
    payload: { orderId: "o", courierId: "c" },
    dutyKey: "shipping.rate_compare",
  });
  check("a now-doored duty is not refused for lacking a door", nowDoored.rule !== "duty:needs_door", `${nowDoored.rule}`);

  // ── 6. Guardrails ───────────────────────────────────────────────────────
  console.log("\n[6] Guardrails");
  const overDiscount = await evaluateAuthority(storeWith({ level: 4, maxDiscountPct: 20 }), {
    type: "create_discount",
    payload: { code: "MEGA35", percentOff: 35, scope: "order", expiresInDays: 7 },
  });
  check("a 35% discount over a 20% cap is refused", overDiscount.verdict === "refuse" && overDiscount.rule === "guardrail:max_discount_pct");
  check("that refusal escalates", !!overDiscount.escalation);
  check(
    "a discount inside the cap passes",
    (await evaluateAuthority(storeWith({ level: 4, maxDiscountPct: 20 }), { type: "create_discount", payload: { code: "OK10", percentOff: 10, scope: "order", expiresInDays: 7 } })).verdict === "execute",
  );

  // Cumulative day spend — the check a per-action cap cannot make.
  const capMinor = 500_000; // ৳5,000
  const underCap = await evaluateAuthority(storeWith({ level: 4, dailySpendCapMinor: capMinor, spentTodayMinor: 0 }), {
    type: "create_campaign",
    payload: { name: "Eid", channel: "meta", dailyBudget: 3000, productIds: ["p"], startNow: true, notes: "n" },
  });
  check("a campaign inside the day cap executes", underCap.verdict === "execute", `${underCap.verdict} / ${underCap.rule}`);
  const overCap = await evaluateAuthority(storeWith({ level: 4, dailySpendCapMinor: capMinor, spentTodayMinor: 400_000 }), {
    type: "create_campaign",
    payload: { name: "Eid", channel: "meta", dailyBudget: 3000, productIds: ["p"], startNow: true, notes: "n" },
  });
  check(
    "the SAME campaign is caught once today's spend is counted",
    overCap.rule === "guardrail:daily_spend_cap",
    `${overCap.verdict} / ${overCap.rule}`,
  );
  check(
    "over-cap is DOWNGRADED to a decision, not blocked (the spend is legitimate)",
    overCap.verdict === "draft",
    overCap.verdict,
  );
  check("the explanation shows the projected total in ৳", /৳/.test(overCap.explanation), overCap.explanation);
  check(
    "lowering a budget spends nothing",
    (SPEND_MINOR.update_campaign?.({ dailyBudget: 10, previousDailyBudget: 50 }) ?? -1) === 0,
  );

  // ── 7. Order of evaluation — first refusal wins ─────────────────────────
  console.log("\n[7] First refusal wins, and it's the RIGHT one");
  const both = await evaluateAuthority(storeWith({ level: 0, noTouch: ["MEGA35"], maxDiscountPct: 5 }), {
    type: "create_discount",
    payload: { code: "MEGA35", percentOff: 35, scope: "order", expiresInDays: 7 },
  });
  check(
    "no-touch beats level and guardrail when all three would refuse",
    both.rule.startsWith("no_touch:"),
    both.rule,
  );
  const founderBeatsAll = await evaluateAuthority(storeWith({ level: 0, noTouch: ["REFUND"] }), {
    type: "bulk_refund",
    payload: { orderIds: ["o"], reason: "refund" },
  });
  check("founder-only beats even a no-touch hit", founderBeatsAll.rule === "founder_only:bulk_refund", founderBeatsAll.rule);

  // ── 8. Fail closed ──────────────────────────────────────────────────────
  console.log("\n[8] Fail closed");
  const broken = new DemoStore(createSeed(Date.UTC(2026, 6, 23, 12, 0, 0)));
  (broken as unknown as { getAuthority: () => Promise<AuthorityState> }).getAuthority = async () => {
    throw new Error("backend down");
  };
  const failed = await evaluateAuthority(broken, { type: "resolve_ticket", payload: { ticketId: "t", reply: "hello there", newStatus: "resolved" } });
  check("an unreadable authority state refuses", failed.verdict === "refuse" && failed.rule === "authority:unavailable");
  check("and escalates, so the outage is visible", !!failed.escalation);

  // ── 9. Every decision is explainable, in both languages ─────────────────
  console.log("\n[9] Explanations");
  const samples = [locked, overDiscount, belowMin, paused, escalated, overCap];
  check("every decision names a rule", samples.every((d) => d.rule.length > 0));
  check("every decision has an English explanation", samples.every((d) => d.explanation.trim().length > 10));
  check("every decision has a Bangla explanation", samples.every((d) => /[ঀ-৿]/.test(d.explanationBn)), samples.filter((d) => !/[ঀ-৿]/.test(d.explanationBn)).map((d) => d.rule).join(", "));
  check("every decision records the guardrail version that judged it", samples.every((d) => typeof d.guardrailsVersion === "number"));

  // ── 10. End-to-end through performAction ────────────────────────────────
  console.log("\n[10] The pipeline honours the seam");
  const pipelineStore = storeWith({ level: 4, noTouch: ["DIFFUSER"] });
  const refused = await performAction(pipelineStore, {
    type: "update_price",
    department: "finance",
    title: "Reprice diffuser",
    payload: { productId: "prod-diffuser", productName: "Diffuser", newPrice: 3480 },
    receipt: RECEIPT,
  });
  check("a locked action is blocked by the pipeline", refused.status === "blocked", refused.detail);
  const blockedRecord = await pipelineStore.getAction(refused.actionId);
  check("the blocked record is receipted", !!blockedRecord?.receipt.evidence.length);
  check(
    "the receipt's evidence carries the rule that fired",
    blockedRecord?.receipt.evidence.some((e) => e.source === "authority_gate" && String(e.value ?? "").startsWith("no_touch:")) === true,
    JSON.stringify(blockedRecord?.receipt.evidence),
  );

  const suggestStore = storeWith({ level: 1 });
  const suggested = await performAction(suggestStore, {
    type: "resolve_ticket",
    department: "support",
    title: "Reply to ticket",
    payload: { ticketId: "tick-01", reply: "Thanks for waiting — sorted.", newStatus: "resolved" },
    receipt: RECEIPT,
  });
  check("L1 produces a prepared record", suggested.status === "prepared", suggested.detail);
  const suggestedRecord = await suggestStore.getAction(suggested.actionId);
  check("L1's record is marked a suggestion, not a draft", suggestedRecord?.outcome === "suggestion", String(suggestedRecord?.outcome));
  const draftStore = storeWith({ level: 2 });
  const drafted = await performAction(draftStore, {
    type: "resolve_ticket",
    department: "support",
    title: "Reply to ticket",
    payload: { ticketId: "tick-01", reply: "Thanks for waiting — sorted.", newStatus: "resolved" },
    receipt: RECEIPT,
  });
  const draftedRecord = await draftStore.getAction(drafted.actionId);
  check("L2's record is NOT marked a suggestion", draftedRecord?.outcome !== "suggestion");
  check("L1 and L2 are observably different records", suggestedRecord?.outcome !== draftedRecord?.outcome);

  console.log("\n" + "=".repeat(60));
  if (failures.length > 0) {
    console.error(`AUTHORITY SUITE FAILED — ${failures.length} failing, ${passed} passing.`);
    process.exit(1);
  }
  console.log(`AUTHORITY SUITE PASSED — ${passed} checks green.`);
}

main().catch((error) => {
  console.error("Suite crashed:", error);
  process.exit(1);
});
