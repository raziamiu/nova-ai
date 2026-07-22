/**
 * Phase 04 memory & learning suite — the phase gate.
 *
 * Proves, on real tool + service OUTPUTS (no model, no network — the embed and
 * reflection backends run in their deterministic stub mode):
 *
 *   1. Retrieval unit tests   — cosine, scoring determinism, threshold.
 *   2. Semantic cross-session recall — a rule written in "session 1" is
 *      retrieved by similarity for a related query in a fresh "session 2".
 *   3. Rejection fast-path    — rejecting an action writes a standing objection
 *      synchronously; a repeated rejection keeps it in view.
 *   4. Reflection             — a golden day distills rejections into a semantic
 *      rule; ≤10 writes, every one carrying provenance; owner-visible.
 *   5. Experiments            — the evaluator measures, decides, and records
 *      an outcome with provenance.
 *   6. Attribution            — a recovered cart's influence becomes the real
 *      order total; an unrecovered cart keeps its estimate.
 *   7. Tenant isolation       — A's memory never enters B's recall/vectors.
 *   8. Context budget         — L3 (and L0–L3 total) stay within budget.
 *
 * Run with:  NOVA_DEV_STORE_ID=store-aurora npx -y tsx evals/memory/run.ts
 */

import remember from "../../agent/tools/remember";
import recall from "../../agent/tools/recall";
import rejectAction from "../../agent/tools/reject_action";

import { requireStore } from "../../agent/lib/tenant";
import { storeFor, resetStores } from "../../agent/lib/store/resolve";
import { DemoStore } from "../../agent/lib/store/backend";
import {
  buildTenantProfile,
  buildLiveOps,
  buildRelevantMemory,
  LAYER_BUDGET,
} from "../../agent/lib/context/layers";
import { retrieveRelevant, distill } from "../../agent/lib/memory/service";
import { reflect, MAX_REFLECTION_WRITES } from "../../agent/lib/memory/reflection";
import { attributeVia } from "../../agent/lib/memory/attribution";
import {
  createExperiment,
  evaluateExperiments,
  evaluateOutcome,
} from "../../agent/lib/memory/experiments";
import { cosine, scoreEntry, rankByRelevance, RETRIEVAL } from "../../agent/lib/memory/vector";
import { embedText, EMBED_DIM } from "../../agent/lib/memory/embed";
import type { ActionRecord, StoreSeed } from "../../agent/lib/types";

const AURORA = "store-aurora";
const BEACON = "store-beacon";

// --- tiny assert framework --------------------------------------------------

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

// --- synthetic verified contexts (a Dakio principal) ------------------------

type Ctx = Parameters<typeof remember.execute>[1];

function ctxFor(storeId: string, opts: { role?: string } = {}): Ctx {
  const principal = {
    authenticator: "dakio",
    principalId: "user-1",
    principalType: "user",
    subject: "user-1",
    attributes: { storeId, role: opts.role ?? "owner", plan: "growth" },
  };
  return { session: { id: "ses-test", auth: { current: principal, initiator: principal } } } as unknown as Ctx;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** E-8 boilerplate for directly-seeded eval fixtures. */
const fixtureActionFields = (j: { reason: string; expectedImpact: string; confidence: number }) => ({
  justification: j,
  receipt: {
    ...j,
    evidence: [{ source: "eval-fixture", note: j.reason }],
    before: null,
    after: null,
  },
  actor: "nova" as const,
  targetRef: null,
  agentId: null,
  dutyRef: null,
  undoDeadline: null,
  undoneAt: null,
});

/** Seed a prepared action directly so we can drive the reject path. */
async function seedPreparedPO(storeId: string, title: string): Promise<ActionRecord> {
  return storeFor(storeId).addAction({
    type: "create_purchase_order",
    department: "supplier_manager",
    title,
    payload: { supplierId: "sup-x", productId: "prod-y", quantity: 100 },
    ...fixtureActionFields({ reason: "restock", expectedImpact: "avoid stockout", confidence: 0.6 }),
    riskClass: "medium",
    status: "prepared",
    outcome: null,
    undoable: false,
    undoData: null,
    decidedAt: null,
    executedAt: null,
  });
}

// --- the suite --------------------------------------------------------------

async function main(): Promise<void> {
  resetStores();

  // 1. Retrieval unit tests: cosine, scoring, threshold, determinism.
  console.log("\n[1] Retrieval unit tests (cosine, scoring, threshold)");
  const eA = await embedText("never discount over fifteen percent");
  const eA2 = await embedText("never discount over fifteen percent");
  const eB = await embedText("Meridian Express is the fastest courier up north");
  check("embedding has the fixed dimension", eA.length === EMBED_DIM);
  check("embedding is deterministic (same text → same vector)", cosine(eA, eA2) > 0.9999);
  check("identical text cosine ≈ 1", Math.abs(cosine(eA, eA2) - 1) < 1e-9);
  check("unrelated texts have lower cosine than identical", cosine(eA, eB) < cosine(eA, eA2));
  const nowMs = Date.now();
  const scored = scoreEntry(
    { namespace: "rules", key: "k", value: "v", updatedAt: new Date(nowMs).toISOString(), weight: 1, embedding: eA },
    eA,
    nowMs,
  );
  check(
    "score of a fresh, identical, full-weight entry ≈ 1",
    Math.abs(scored.score - 1) < 1e-6,
    `got ${scored.score}`,
  );
  const belowThreshold = rankByRelevance(
    [{ namespace: "insights", key: "old", value: "x", updatedAt: new Date(nowMs - 3650 * 864e5).toISOString(), weight: 0, embedding: eB }],
    eA,
    nowMs,
  );
  check("an unrelated, ancient, zero-weight entry is dropped by the threshold", belowThreshold.length === 0);
  check("threshold + K constants match the blueprint", RETRIEVAL.threshold === 0.35 && RETRIEVAL.k === 8);
  // A recent, full-weight, UN-embedded entry must NOT leak on recency+weight
  // alone (0.25+0.15=0.40 would clear the 0.35 threshold without this guard).
  const unembedded = rankByRelevance(
    [{ namespace: "insights", key: "pending", value: "x", updatedAt: new Date(nowMs).toISOString(), weight: 1, embedding: null }],
    eA,
    nowMs,
  );
  check("a recent, full-weight, un-embedded entry does not leak (semantic match required)", unembedded.length === 0);

  // 2. Semantic cross-session recall.
  console.log("\n[2] Semantic cross-session recall (write session 1 → read session 2)");
  // Session 1: the owner states a policy and an unrelated logistics note.
  await remember.execute(
    { namespace: "rules", key: "discount-cap", value: "We never discount over 15% now, on any order or promo." },
    ctxFor(AURORA),
  );
  await remember.execute(
    { namespace: "insights", key: "north-courier", value: "Meridian Express is our fastest courier in the northern region." },
    ctxFor(AURORA),
  );
  // Session 2 (fresh ctx, same tenant): a discount-related question.
  const results = await retrieveRelevant(AURORA, "should we run a 25% off discount promo this weekend?");
  const topKeys = results.map((r) => r.entry.key);
  check("discount question recalls the discount rule", topKeys.includes("discount-cap"));
  const capScore = results.find((r) => r.entry.key === "discount-cap")?.score ?? 0;
  const courierScore = results.find((r) => r.entry.key === "north-courier")?.score ?? 0;
  check("the discount rule outranks the unrelated courier note", capScore > courierScore);
  const l3 = await buildRelevantMemory(AURORA, "propose a discount for the weekend");
  check("L3 context includes the recalled 15% rule verbatim", l3.includes("15%"));

  // 3. Rejection fast-path — rejecting teaches immediately.
  console.log("\n[3] Rejection fast-path (reject twice → standing objection in view)");
  const po1 = await seedPreparedPO(AURORA, "Reorder 100 × Widget from Supplier X");
  const r1 = await rejectAction.execute(
    { actionId: po1.id, reason: "Supplier X is unreliable — do not reorder from them." },
    ctxFor(AURORA),
  );
  check("first rejection succeeds", !("error" in r1));
  const afterFirst = await recall.execute({ namespace: "preferences" }, ctxFor(AURORA));
  const prefKeys1 = "entries" in afterFirst ? afterFirst.entries.map((e) => e.key) : [];
  check("rejection wrote a preferences standing objection", prefKeys1.includes("rejected-create_purchase_order"));
  const po2 = await seedPreparedPO(AURORA, "Reorder 200 × Widget from Supplier X");
  await rejectAction.execute(
    { actionId: po2.id, reason: "Still unreliable — sourcing elsewhere." },
    ctxFor(AURORA),
  );
  const l3AfterReject = await buildRelevantMemory(AURORA, "should I create a purchase order to restock the widget?");
  check(
    "a third PO proposal sees the standing objection in context",
    l3AfterReject.toLowerCase().includes("rejected") && l3AfterReject.includes("create_purchase_order"),
  );

  // 4. Reflection — golden day distills rejections into a semantic rule.
  console.log("\n[4] Reflection (rejections → semantic rule; ≤10 writes; provenance)");
  const input = await distill(AURORA, 1);
  check("distill picks up both rejections in the window", input.rejections.length >= 2);
  const reflection = await reflect(AURORA, 1);
  check(`reflection emits ≤ ${MAX_REFLECTION_WRITES} writes`, reflection.writes.length <= MAX_REFLECTION_WRITES);
  check(
    "every reflection write carries provenance",
    reflection.writes.length > 0 && reflection.writes.every((w) => (w.provenance?.actionIds?.length ?? 0) > 0),
  );
  const rule = (await recall.execute({ namespace: "rules" }, ctxFor(AURORA)));
  const ruleEntries = "entries" in rule ? rule.entries : [];
  const distilledRule = ruleEntries.find((e) => e.key === "avoid-create_purchase_order");
  check("reflection distilled a standing rule for the rejected action type", distilledRule !== undefined);
  check("the distilled rule is sourced to reflection", distilledRule?.source === "reflection");
  check(
    "the rule's provenance links both rejected action ids",
    !!distilledRule?.provenance?.actionIds?.includes(po1.id) && !!distilledRule?.provenance?.actionIds?.includes(po2.id),
  );
  const activity = await storeFor(AURORA).listActivity();
  check(
    "reflection recorded an owner-visible 'what I learned' note",
    activity.some((a) => a.title === "Reflection: what I learned"),
  );
  // n1: the distilled rule supersedes the fast-path preference candidate.
  const prefsAfter = await recall.execute({ namespace: "preferences" }, ctxFor(AURORA));
  const prefKeysAfter = "entries" in prefsAfter ? prefsAfter.entries.map((e) => e.key) : [];
  check(
    "reflection removed the now-superseded fast-path preference (deduped)",
    !prefKeysAfter.includes("rejected-create_purchase_order"),
  );

  // 5. Experiments — evaluator measures, decides, records with provenance.
  console.log("\n[5] Experiments (evaluate → outcome memory with provenance)");
  check("evaluateOutcome: roas above target is a win", evaluateOutcome("roas7d", 1, 2, 3) === "won");
  check("evaluateOutcome: roas below baseline is a loss", evaluateOutcome("roas7d", 1, 2, 0.5) === "lost");
  check("evaluateOutcome: cpa is lower-is-better", evaluateOutcome("cpa7d", 40, 25, 20) === "won");
  check("evaluateOutcome: null actual is inconclusive", evaluateOutcome("roas7d", 1, 2, null) === "inconclusive");
  // Tie an experiment to a real seeded campaign action so `measure` finds stats.
  const campaignAction = await storeFor(AURORA).addAction({
    type: "update_campaign",
    department: "marketing",
    title: "Scale Blender Summer Push",
    payload: { campaignId: "cmp-blender" },
    ...fixtureActionFields({ reason: "roas strong", expectedImpact: "more revenue", confidence: 0.7 }),
    riskClass: "low",
    status: "executed",
    outcome: "scaled",
    undoable: true,
    undoData: { campaignId: "cmp-blender" },
    decidedAt: storeFor(AURORA).now(),
    executedAt: storeFor(AURORA).now(),
  });
  await createExperiment(AURORA, {
    hypothesis: "Blender push holds ROAS after scaling.",
    metric: "roas7d",
    baseline: 0,
    target: 0,
    actionIds: [campaignAction.id],
  });
  const evaluated = await evaluateExperiments(AURORA);
  check("the open experiment was evaluated", evaluated.length >= 1);
  const outcome = evaluated[0];
  check("the evaluated experiment has a measured actual", outcome?.experiment.actual !== null);
  check("the outcome memory carries provenance to the campaign action", !!outcome?.memory.provenance?.actionIds?.includes(campaignAction.id));

  // 6. Attribution — recovered cart → real order total; unrecovered keeps estimate.
  console.log("\n[6] Attribution (recovered cart → order total)");
  const attrStore = new DemoStore(attributionSeed());
  const attribution = await attributeVia(attrStore);
  const attrActivity = await attrStore.listActivity();
  const recovered = attrActivity.find((a) => a.id === "act-recovered");
  const unrecovered = attrActivity.find((a) => a.id === "act-unrecovered");
  check("attribution rewrote the recovered cart's influence to the order total", recovered?.revenueInfluence === 150);
  check("the rewritten influence is marked measured with provenance", recovered?.revenueBasis === "measured" && !!recovered?.revenueProvenance);
  check("the unrecovered cart keeps its estimate (not overwritten)", unrecovered?.revenueInfluence === 20 && unrecovered?.revenueBasis === "estimated");
  check("attribution reports the measured recovered revenue", attribution.measuredRevenue === 150);

  // 7. Tenant isolation of recall / vectors.
  console.log("\n[7] Tenant isolation (A's memory never in B's recall)");
  await remember.execute(
    { namespace: "insights", key: "aurora-vector-secret", value: "Aurora-only: our best-selling SKU is the amber candle." },
    ctxFor(AURORA),
  );
  const bRecall = await retrieveRelevant(BEACON, "what is our best selling candle sku and discount policy?");
  check("B's semantic recall contains no Aurora keys", bRecall.every((r) => r.entry.key !== "aurora-vector-secret" && r.entry.key !== "discount-cap"));
  const bL3 = await buildRelevantMemory(BEACON, "discount policy and best sellers");
  check("B's L3 context contains no Aurora secret", !bL3.includes("amber candle") && !bL3.includes("15%"));
  const aRecall = await retrieveRelevant(AURORA, "best selling candle sku");
  check("A's own recall does surface its secret", aRecall.some((r) => r.entry.key === "aurora-vector-secret"));

  // 8. Context budgets (L3 and L0–L3 total stay within budget WITH a hint).
  console.log("\n[8] Context budget (L3 ≤ budget; total ≤ 2.5k)");
  const l3Hinted = await buildRelevantMemory(AURORA, "discount promo purchase order restock candle courier vip shipping");
  const t3 = estimateTokens(l3Hinted);
  check(`L3 relevant memory ≤ ${LAYER_BUDGET.relevantMemory} tok (got ${t3})`, t3 <= LAYER_BUDGET.relevantMemory);
  const [p, ops] = await Promise.all([buildTenantProfile(AURORA), buildLiveOps(AURORA)]);
  const total = estimateTokens(p) + estimateTokens(ops) + t3;
  check(`L1–L3 total ≤ 2200 tok (got ${total})`, total <= 2200);

  // 9. Reflection write budget is enforced across BOTH steps (rejections +
  //    experiments), not just the rejection loop — with many open experiments a
  //    run must still emit ≤ MAX_REFLECTION_WRITES durable writes.
  console.log("\n[9] Reflection write budget with many experiments (≤10)");
  for (let i = 0; i < 15; i += 1) {
    const a = await storeFor(AURORA).addAction({
      type: "update_campaign",
      department: "marketing",
      title: `Tweak Blender push ${i}`,
      payload: { campaignId: "cmp-blender" },
      ...fixtureActionFields({ reason: "test", expectedImpact: "test", confidence: 0.5 }),
      riskClass: "low",
      status: "executed",
      outcome: "done",
      undoable: true,
      undoData: { campaignId: "cmp-blender" },
      decidedAt: storeFor(AURORA).now(),
      executedAt: storeFor(AURORA).now(),
    });
    await createExperiment(AURORA, {
      hypothesis: `Budget-test hypothesis ${i}`,
      metric: "roas7d",
      baseline: 0,
      target: 0,
      actionIds: [a.id],
    });
  }
  const runningBefore = (await storeFor(AURORA).listExperiments("running")).length;
  const budgeted = await reflect(AURORA, 1);
  check(`reflection stays ≤ ${MAX_REFLECTION_WRITES} writes despite ${runningBefore} open experiments`, budgeted.writes.length <= MAX_REFLECTION_WRITES);
  const runningAfter = (await storeFor(AURORA).listExperiments("running")).length;
  check("the write cap left some experiments unevaluated (cap actually bit)", runningAfter > 0 && runningAfter < runningBefore);

  // --- report ---
  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`MEMORY & LEARNING SUITE PASSED — ${passed} checks green.`);
  } else {
    console.log(`MEMORY & LEARNING SUITE FAILED — ${failures.length} of ${passed + failures.length} checks failed:`);
    for (const f of failures) console.log(`  ✗ ${f}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

/**
 * A controlled seed for the attribution test: one recovered cart (a later order
 * exists for its customer) and one unrecovered cart (no order). Only the fields
 * attribution reads are populated; the rest are empty.
 */
function attributionSeed(): StoreSeed {
  const now = Date.now();
  const iso = (daysAgo: number) => new Date(now - daysAgo * 864e5).toISOString();
  return {
    products: [],
    trendingProducts: [],
    customers: [
      { id: "cust-A", name: "Ann", email: "a@x.com", segment: "repeat", ordersCount: 2, lifetimeValue: 300, lastOrderAt: iso(1), notes: "", createdAt: iso(60) },
      { id: "cust-B", name: "Bo", email: "b@x.com", segment: "new", ordersCount: 0, lifetimeValue: 0, lastOrderAt: null, notes: "", createdAt: iso(40) },
    ],
    orders: [
      { id: "ord-A", customerId: "cust-A", items: [], subtotal: 150, discount: 0, shipping: 0, total: 150, status: "paid", courierId: null, placedAt: iso(1), deliveredAt: null, region: "north" },
    ],
    abandonedCarts: [
      { id: "cart-recovered", customerId: "cust-A", items: [], value: 120, abandonedAt: iso(3), recoveryState: "message_sent", recoveryMessage: "come back" },
      { id: "cart-unrecovered", customerId: "cust-B", items: [], value: 80, abandonedAt: iso(3), recoveryState: "message_sent", recoveryMessage: "come back" },
    ],
    campaigns: [],
    socialPosts: [],
    discounts: [],
    supportTickets: [],
    customerMessages: [],
    suppliers: [],
    purchaseOrders: [],
    couriers: [],
    expenses: [],
    autonomy: {
      level: 2,
      guardrails: {
        maxDiscountPct: 20,
        maxPriceChangePct: 25,
        maxBudgetChangePct: 50,
        minMarginPct: 20,
        maxAutoPurchaseOrderTotal: 500,
        maxAutoRefundTotal: 100,
      },
      updatedAt: iso(10),
    },
    memory: [],
    activity: [
      { id: "act-recovered", at: iso(3), department: "sales", kind: "action", title: "Cart recovery to Ann", detail: "sent", minutesSaved: 8, revenueInfluence: 30, actionId: null, relatedId: "cart-recovered", revenueBasis: "estimated" },
      { id: "act-unrecovered", at: iso(3), department: "sales", kind: "action", title: "Cart recovery to Bo", detail: "sent", minutesSaved: 8, revenueInfluence: 20, actionId: null, relatedId: "cart-unrecovered", revenueBasis: "estimated" },
    ],
    actions: [],
    reports: [],
  };
}

main().catch((err) => {
  console.error("Memory suite crashed:", err);
  process.exit(1);
});
