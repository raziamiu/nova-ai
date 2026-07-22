/**
 * Money audit — the hard check behind the ৳ re-denomination (blueprint D2).
 *
 * Re-denominating the demo seeds is dangerous in one specific way: the
 * autonomy gate mixes currency-INVARIANT guardrails (maxDiscountPct,
 * maxPriceChangePct, maxBudgetChangePct, minMarginPct) with currency-DEPENDENT
 * ones (maxAutoPurchaseOrderTotal). Scale the seed without scaling the caps and
 * every purchase order silently flips from "execute" to "needs approval" —
 * the demo still runs, the evals still pass, and the behaviour has changed.
 *
 * So this script prints two things:
 *
 *  1. RATIOS — per-product margin, order shipping share, expense mix. These
 *     must be IDENTICAL before and after (a pure scale preserves them).
 *  2. GATE VERDICTS — a battery of actions expressed RELATIVE to prices and
 *     caps (e.g. "a PO at 90% of the cap", "a price leaving 11% margin").
 *     Relative inputs make the battery scale-invariant by construction, so an
 *     identical verdict list is proof the gate behaves the same at the new
 *     denomination. Absolute values are printed too — those SHOULD change.
 *
 * Usage:
 *   npx -y tsx scripts/money-audit.ts > /tmp/before.txt   # pre-change
 *   …make the change…
 *   npx -y tsx scripts/money-audit.ts > /tmp/after.txt
 *   diff /tmp/before.txt /tmp/after.txt
 *
 * Expected diff: only the ABSOLUTE block changes. Any change in the RATIOS or
 * VERDICTS block is a bug in the re-denomination, not an acceptable delta.
 */

import { createSeed } from "../agent/lib/store/seed";
import { createBeaconSeed } from "../agent/lib/store/seed-beacon";
import { DemoStore } from "../agent/lib/store/backend";
import { gateAction } from "../agent/lib/nova/autonomy";
import type { AutonomyConfig, StoreSeed } from "../agent/lib/types";

// Fixed clock: the seeds are deterministic from nowMs, so pinning it makes the
// whole report byte-stable across runs.
const FIXED_MS = Date.UTC(2026, 6, 22, 12, 0, 0);

const n2 = (x: number): string => x.toFixed(2);
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

function ratios(label: string, seed: StoreSeed): void {
  console.log(`\n### RATIOS — ${label}`);

  // Per-product margin. Currency-invariant: a pure scale must not move these.
  console.log("  product margins (%):");
  for (const p of seed.products) {
    const margin = p.price > 0 ? ((p.price - p.cost) / p.price) * 100 : 0;
    const markup = p.cost > 0 ? p.price / p.cost : 0;
    console.log(`    ${p.id.padEnd(20)} margin=${n2(margin).padStart(6)}  markup=${n2(markup)}x`);
  }

  // Order composition as shares of subtotal.
  const orders = seed.orders;
  const subtotals = sum(orders.map((o) => o.subtotal));
  const shippings = sum(orders.map((o) => o.shipping));
  const freeShip = orders.filter((o) => o.shipping === 0).length;
  console.log(`  orders: n=${orders.length} freeShipping=${freeShip}/${orders.length}`);
  console.log(`    shipping as % of subtotal = ${n2(subtotals > 0 ? (shippings / subtotals) * 100 : 0)}`);

  // Expense mix by category, as shares of total.
  const byCat = new Map<string, number>();
  for (const e of seed.expenses) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
  const totalExp = sum([...byCat.values()]);
  console.log("  expense mix (% of total):");
  for (const [cat, amt] of [...byCat.entries()].sort()) {
    console.log(`    ${cat.padEnd(12)} ${n2(totalExp > 0 ? (amt / totalExp) * 100 : 0).padStart(6)}`);
  }
}

function absolutes(label: string, seed: StoreSeed): void {
  console.log(`\n### ABSOLUTE (expected to change) — ${label}`);
  const prices = seed.products.map((p) => p.price);
  console.log(`  price      min=${n2(Math.min(...prices))} max=${n2(Math.max(...prices))} sum=${n2(sum(prices))}`);
  console.log(`  cost       sum=${n2(sum(seed.products.map((p) => p.cost)))}`);
  console.log(`  orders     subtotal=${n2(sum(seed.orders.map((o) => o.subtotal)))} total=${n2(sum(seed.orders.map((o) => o.total)))}`);
  console.log(`  carts      value=${n2(sum(seed.abandonedCarts.map((c) => c.value)))}`);
  console.log(`  expenses   total=${n2(sum(seed.expenses.map((e) => e.amount)))}`);
  console.log(`  campaigns  dailyBudget=${n2(sum(seed.campaigns.map((c) => c.dailyBudget)))}`);
  console.log(`  POs        total=${n2(sum(seed.purchaseOrders.map((p) => p.total)))}`);
  console.log(`  activity   revenueInfluence=${n2(sum(seed.activity.map((a) => a.revenueInfluence)))}`);
  console.log(`  trending   suggestedPrice=${n2(sum(seed.trendingProducts.map((t) => t.suggestedPrice)))}`);
  console.log(`  guardrails maxAutoPO=${seed.autonomy.guardrails.maxAutoPurchaseOrderTotal} maxAutoRefund=${seed.autonomy.guardrails.maxAutoRefundTotal}`);
}

/**
 * Every input here is derived from the seed's own numbers, so the battery
 * means the same thing at any denomination. Identical verdicts before and
 * after = the gate did not silently change behaviour.
 */
async function verdicts(label: string, seed: StoreSeed): Promise<void> {
  console.log(`\n### GATE VERDICTS (must NOT change) — ${label}`);
  const store = new DemoStore(seed);
  const g = seed.autonomy.guardrails;
  const product = seed.products[0];
  const campaign = seed.campaigns[0];
  const cap = g.maxAutoPurchaseOrderTotal;

  const cases: { name: string; type: Parameters<typeof gateAction>[2]; payload: Record<string, unknown> }[] = [
    // Currency-dependent: the PO cap. These are the ones re-denomination breaks.
    { name: "PO at 50% of cap", type: "create_purchase_order", payload: { quantity: 1, unitCost: cap * 0.5 } },
    { name: "PO at 99% of cap", type: "create_purchase_order", payload: { quantity: 1, unitCost: cap * 0.99 } },
    { name: "PO at 101% of cap", type: "create_purchase_order", payload: { quantity: 1, unitCost: cap * 1.01 } },
    { name: "PO at 500% of cap", type: "create_purchase_order", payload: { quantity: 1, unitCost: cap * 5 } },
    // Currency-invariant, but they read seed prices — a bad rescale of cost
    // relative to price would move the margin verdict.
    { name: "price +5% of current", type: "update_price", payload: { productId: product.id, newPrice: product.price * 1.05 } },
    { name: "price +50% of current", type: "update_price", payload: { productId: product.id, newPrice: product.price * 1.5 } },
    { name: "price leaving 30% margin", type: "update_price", payload: { productId: product.id, newPrice: product.cost / 0.7 } },
    { name: "price leaving 11% margin", type: "update_price", payload: { productId: product.id, newPrice: product.cost / 0.89 } },
    { name: "budget +30%", type: "update_campaign", payload: { campaignId: campaign.id, dailyBudget: campaign.dailyBudget * 1.3 } },
    { name: "budget +80%", type: "update_campaign", payload: { campaignId: campaign.id, dailyBudget: campaign.dailyBudget * 1.8 } },
    { name: "discount 10%", type: "create_discount", payload: { percentOff: 10 } },
    { name: "discount 25%", type: "create_discount", payload: { percentOff: 25 } },
  ];

  for (const level of [2, 3, 4] as const) {
    const config: AutonomyConfig = { ...seed.autonomy, level, guardrails: g };
    for (const c of cases) {
      const decision = await gateAction(store, config, c.type, c.payload);
      console.log(`  L${level} ${c.name.padEnd(28)} → ${decision.verdict.padEnd(8)} (${decision.riskClass})`);
    }
  }
}

async function main(): Promise<void> {
  const aurora = createSeed(FIXED_MS);
  const beacon = createBeaconSeed(FIXED_MS);
  for (const [label, seed] of [["Aurora", aurora], ["Beacon", beacon]] as const) {
    ratios(label, seed);
    absolutes(label, seed);
    await verdicts(label, seed);
  }
}

main().catch((error) => {
  console.error("Audit crashed:", error);
  process.exit(1);
});
