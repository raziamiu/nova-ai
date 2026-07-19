/**
 * Nova's analytics engine — the numbers behind every decision Nova makes.
 *
 * Pure read-side computation over the store: campaign performance windows,
 * the owner-facing business snapshot, the finance / P&L report, and the
 * anomaly scanner that powers Nova's proactive alerts. Nothing in here
 * mutates the store.
 */

import type {
  Campaign,
  CampaignDayStat,
  ExpenseEntry,
  Order,
  Product,
} from "../types";
import type { StoreClient } from "../store/client";
import { pct, pctChange, round2, signedPct, usd } from "./format";
import { summarizeWork } from "./activity";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Midnight UTC of the calendar day containing `iso`, in ms. */
function utcDayStartMs(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Whole calendar days between now's UTC day and a YYYY-MM-DD stat date. */
function daysAgo(nowIso: string, ymd: string): number {
  return Math.round((utcDayStartMs(nowIso) - Date.parse(`${ymd}T00:00:00Z`)) / DAY_MS);
}

function ymdOf(iso: string): string {
  return iso.slice(0, 10);
}

function sum(values: number[]): number {
  return values.reduce((total, v) => total + v, 0);
}

// ---------------------------------------------------------------------------
// Campaign metrics
// ---------------------------------------------------------------------------

export interface CampaignMetrics {
  campaignId: string;
  name: string;
  channel: string;
  status: string;
  dailyBudget: number;
  spend7d: number;
  revenue7d: number;
  conversions7d: number;
  roas7d: number | null;
  cpa7d: number | null;
  cpa3d: number | null;
  cpaPrior7d: number | null;
  cpaTrendPct: number | null;
  ctrPct7d: number | null;
}

/** Stats whose date falls between `from` and `to` days ago (inclusive). */
function statsWindow(
  stats: CampaignDayStat[],
  nowIso: string,
  from: number,
  to: number,
): CampaignDayStat[] {
  return stats.filter((s) => {
    const ago = daysAgo(nowIso, s.date);
    return ago >= from && ago <= to;
  });
}

function cpaOf(spend: number, conversions: number): number | null {
  return conversions > 0 ? spend / conversions : null;
}

export function computeCampaignMetrics(
  client: StoreClient,
  campaign: Campaign,
): CampaignMetrics {
  const now = client.now();

  const last7 = statsWindow(campaign.dailyStats, now, 0, 6);
  const last3 = statsWindow(campaign.dailyStats, now, 0, 2);
  const prior7 = statsWindow(campaign.dailyStats, now, 3, 9);

  const spend7d = sum(last7.map((s) => s.spend));
  const revenue7d = sum(last7.map((s) => s.revenue));
  const conversions7d = sum(last7.map((s) => s.conversions));
  const clicks7d = sum(last7.map((s) => s.clicks));
  const impressions7d = sum(last7.map((s) => s.impressions));

  const cpa3dRaw = cpaOf(sum(last3.map((s) => s.spend)), sum(last3.map((s) => s.conversions)));
  const cpaPrior7dRaw = cpaOf(
    sum(prior7.map((s) => s.spend)),
    sum(prior7.map((s) => s.conversions)),
  );
  const cpaTrend =
    cpa3dRaw !== null && cpaPrior7dRaw !== null ? pctChange(cpaPrior7dRaw, cpa3dRaw) : null;

  return {
    campaignId: campaign.id,
    name: campaign.name,
    channel: campaign.channel,
    status: campaign.status,
    dailyBudget: campaign.dailyBudget,
    spend7d: round2(spend7d),
    revenue7d: round2(revenue7d),
    conversions7d,
    roas7d: spend7d > 0 ? round2(revenue7d / spend7d) : null,
    cpa7d: conversions7d > 0 ? round2(spend7d / conversions7d) : null,
    cpa3d: cpa3dRaw !== null ? round2(cpa3dRaw) : null,
    cpaPrior7d: cpaPrior7dRaw !== null ? round2(cpaPrior7dRaw) : null,
    cpaTrendPct: cpaTrend !== null ? round2(cpaTrend) : null,
    ctrPct7d: impressions7d > 0 ? round2((clicks7d / impressions7d) * 100) : null,
  };
}

// ---------------------------------------------------------------------------
// Business snapshot
// ---------------------------------------------------------------------------

export interface BusinessSnapshot {
  asOf: string;
  revenue: {
    today: number;
    last7d: number;
    prior7d: number;
    last30d: number;
    deltaPct7d: number | null;
  };
  orders: { today: number; last7d: number; prior7d: number; deltaPct7d: number | null };
  aov7d: number | null;
  estProfit7d: number;
  pendingApprovals: number;
  openTickets: number;
  activeCampaigns: number;
  lowStockProducts: number;
  unrecoveredCarts: { count: number; value: number };
  topProducts7d: { name: string; units: number; revenue: number }[];
  work7d: { tasksCompleted: number; hoursWorked: number; revenueInfluenced: number };
}

function orderTotal(orders: Order[]): number {
  return sum(orders.map((o) => o.total));
}

/** Orders that count toward revenue: everything except cancelled + refunded. */
function revenueEligible(orders: Order[]): Order[] {
  return orders.filter((o) => o.status !== "cancelled" && o.status !== "refunded");
}

function placedWithinDays(order: Order, nowMs: number, days: number): boolean {
  return Date.parse(order.placedAt) >= nowMs - days * DAY_MS;
}

/** Sum of quantity × current product cost across the given orders' items. */
function cogsOf(orders: Order[], costByProductId: Map<string, number>): number {
  let total = 0;
  for (const order of orders) {
    for (const item of order.items) {
      total += item.quantity * (costByProductId.get(item.productId) ?? 0);
    }
  }
  return total;
}

export async function buildBusinessSnapshot(client: StoreClient): Promise<BusinessSnapshot> {
  const now = client.now();
  const nowMs = Date.parse(now);
  const today = ymdOf(now);

  const [
    allOrders,
    products,
    campaigns,
    expenses7d,
    cartsNone,
    cartsPrepared,
    pendingActions,
    openTickets,
    escalatedTickets,
    activeCampaigns,
    work,
  ] = await Promise.all([
    client.listOrders(),
    client.listProducts(),
    client.listCampaigns(),
    client.listExpenses(7),
    client.listAbandonedCarts("none"),
    client.listAbandonedCarts("message_prepared"),
    client.listActions("prepared"),
    client.listSupportTickets("open"),
    client.listSupportTickets("escalated"),
    client.listCampaigns("active"),
    summarizeWork(client, 7),
  ]);

  const nonCancelled = allOrders.filter((o) => o.status !== "cancelled");
  const eligible = revenueEligible(allOrders);

  const eligibleLast7 = eligible.filter((o) => placedWithinDays(o, nowMs, 7));
  const eligiblePrior7 = eligible.filter(
    (o) => placedWithinDays(o, nowMs, 14) && !placedWithinDays(o, nowMs, 7),
  );
  const revenue7d = orderTotal(eligibleLast7);
  const revenuePrior7d = orderTotal(eligiblePrior7);

  const ordersLast7 = nonCancelled.filter((o) => placedWithinDays(o, nowMs, 7)).length;
  const ordersPrior7 = nonCancelled.filter(
    (o) => placedWithinDays(o, nowMs, 14) && !placedWithinDays(o, nowMs, 7),
  ).length;

  // Cost of goods + ad spend + operating expenses over the same 7 days.
  const costByProductId = new Map(products.map((p) => [p.id, p.cost]));
  const cogs7d = cogsOf(eligibleLast7, costByProductId);
  const adSpend7d = sum(
    campaigns.flatMap((c) => statsWindow(c.dailyStats, now, 0, 6)).map((s) => s.spend),
  );
  const opEx7d = sum(
    expenses7d
      .filter((e) => e.category === "shipping" || e.category === "fees" || e.category === "refunds")
      .map((e) => e.amount),
  );

  // Top products by 7-day revenue.
  const byProduct = new Map<string, { name: string; units: number; revenue: number }>();
  for (const order of eligibleLast7) {
    for (const item of order.items) {
      const entry =
        byProduct.get(item.productId) ?? { name: item.productName, units: 0, revenue: 0 };
      entry.units += item.quantity;
      entry.revenue += item.quantity * item.unitPrice;
      byProduct.set(item.productId, entry);
    }
  }
  const topProducts7d = [...byProduct.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((p) => ({ name: p.name, units: p.units, revenue: round2(p.revenue) }));

  const unrecovered = [...cartsNone, ...cartsPrepared];

  const revenueDelta = pctChange(revenuePrior7d, revenue7d);
  const ordersDelta = pctChange(ordersPrior7, ordersLast7);

  return {
    asOf: now,
    revenue: {
      today: round2(orderTotal(eligible.filter((o) => ymdOf(o.placedAt) === today))),
      last7d: round2(revenue7d),
      prior7d: round2(revenuePrior7d),
      last30d: round2(orderTotal(eligible.filter((o) => placedWithinDays(o, nowMs, 30)))),
      deltaPct7d: revenueDelta !== null ? round2(revenueDelta) : null,
    },
    orders: {
      today: nonCancelled.filter((o) => ymdOf(o.placedAt) === today).length,
      last7d: ordersLast7,
      prior7d: ordersPrior7,
      deltaPct7d: ordersDelta !== null ? round2(ordersDelta) : null,
    },
    aov7d: eligibleLast7.length > 0 ? round2(revenue7d / eligibleLast7.length) : null,
    estProfit7d: round2(revenue7d - cogs7d - adSpend7d - opEx7d),
    pendingApprovals: pendingActions.length,
    openTickets: openTickets.length + escalatedTickets.length,
    activeCampaigns: activeCampaigns.length,
    lowStockProducts: products.filter((p) => p.status === "active" && p.stock <= p.reorderPoint)
      .length,
    unrecoveredCarts: {
      count: unrecovered.length,
      value: round2(sum(unrecovered.map((c) => c.value))),
    },
    topProducts7d,
    work7d: {
      tasksCompleted: work.tasksCompleted,
      hoursWorked: work.hoursWorked,
      revenueInfluenced: work.revenueInfluenced,
    },
  };
}

// ---------------------------------------------------------------------------
// Finance report
// ---------------------------------------------------------------------------

export interface FinanceReport {
  periodDays: number;
  revenue: number;
  cogs: number;
  adSpend: number;
  shipping: number;
  refunds: number;
  fees: number;
  software: number;
  other: number;
  grossProfit: number;
  grossMarginPct: number | null;
  netProfit: number;
  netMarginPct: number | null;
  dailyPnL: { date: string; revenue: number; spend: number; profit: number }[];
  bestMarginProducts: { name: string; marginPct: number }[];
  worstMarginProducts: { name: string; marginPct: number }[];
  note: string;
}

const NET_MARGIN_GOAL_PCT = 30;

function marginPctOf(product: Product): number {
  return ((product.price - product.cost) / product.price) * 100;
}

export async function buildFinanceReport(
  client: StoreClient,
  sinceDays: number,
): Promise<FinanceReport> {
  const now = client.now();

  const [ordersRaw, products, expenses] = await Promise.all([
    client.listOrders({ sinceDays }),
    client.listProducts(),
    client.listExpenses(sinceDays),
  ]);
  const orders = revenueEligible(ordersRaw);
  const costByProductId = new Map(products.map((p) => [p.id, p.cost]));
  const revenue = orderTotal(orders);
  const cogs = cogsOf(orders, costByProductId);

  const bucket = (category: ExpenseEntry["category"]): number =>
    sum(expenses.filter((e) => e.category === category).map((e) => e.amount));
  const adSpend = bucket("ads");
  const shipping = bucket("shipping");
  const refunds = bucket("refunds");
  const fees = bucket("fees");
  const software = bucket("software");
  const other = bucket("other");

  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - adSpend - shipping - refunds - fees - software - other;
  const grossMarginPct = revenue > 0 ? round2((grossProfit / revenue) * 100) : null;
  const netMarginPct = revenue > 0 ? round2((netProfit / revenue) * 100) : null;

  // Day-by-day P&L for the most recent min(sinceDays, 14) days, oldest first.
  const dailyPnL: FinanceReport["dailyPnL"] = [];
  const todayStart = utcDayStartMs(now);
  for (let back = Math.min(sinceDays, 14) - 1; back >= 0; back -= 1) {
    const date = ymdOf(new Date(todayStart - back * DAY_MS).toISOString());
    const dayOrders = orders.filter((o) => ymdOf(o.placedAt) === date);
    const dayRevenue = orderTotal(dayOrders);
    const dayCogs = cogsOf(dayOrders, costByProductId);
    const daySpend = sum(
      expenses.filter((e) => e.category === "ads" && e.date === date).map((e) => e.amount),
    );
    dailyPnL.push({
      date,
      revenue: round2(dayRevenue),
      spend: round2(daySpend),
      profit: round2(dayRevenue - dayCogs - daySpend),
    });
  }

  const rankable = products.filter((p) => p.status === "active" && p.price > 0);
  const byMarginDesc = [...rankable].sort((a, b) => marginPctOf(b) - marginPctOf(a));
  const toMarginRow = (p: Product): { name: string; marginPct: number } => ({
    name: p.name,
    marginPct: round2(marginPctOf(p)),
  });

  const note =
    netMarginPct === null
      ? `No revenue was recorded in the last ${sinceDays} days, so net margin cannot be measured against the ${NET_MARGIN_GOAL_PCT}% goal yet.`
      : netMarginPct >= NET_MARGIN_GOAL_PCT
        ? `Net margin came in at ${pct(netMarginPct)} over the last ${sinceDays} days, ahead of the ${NET_MARGIN_GOAL_PCT}% goal — there is room to reinvest in growth.`
        : `Net margin came in at ${pct(netMarginPct)} over the last ${sinceDays} days, below the ${NET_MARGIN_GOAL_PCT}% goal — trimming ad spend or thin-margin products would close the gap.`;

  return {
    periodDays: sinceDays,
    revenue: round2(revenue),
    cogs: round2(cogs),
    adSpend: round2(adSpend),
    shipping: round2(shipping),
    refunds: round2(refunds),
    fees: round2(fees),
    software: round2(software),
    other: round2(other),
    grossProfit: round2(grossProfit),
    grossMarginPct,
    netProfit: round2(netProfit),
    netMarginPct,
    dailyPnL,
    bestMarginProducts: byMarginDesc.slice(0, 3).map(toMarginRow),
    worstMarginProducts: byMarginDesc.slice(-3).reverse().map(toMarginRow),
    note,
  };
}

// ---------------------------------------------------------------------------
// Anomaly detection
// ---------------------------------------------------------------------------

export interface AnomalyFinding {
  id: string;
  severity: "critical" | "warning" | "info";
  domain: "ads" | "inventory" | "logistics" | "sales" | "support" | "carts" | "margin";
  title: string;
  evidence: string;
  suggestedAction: string;
}

/** Margin floor for the thin-margin scan (independent of owner guardrails). */
const THIN_MARGIN_PCT = 25;
/** Treat average daily sales below this as "not selling". */
const NEAR_ZERO_VELOCITY = 0.01;
const DEAD_STOCK_VELOCITY = 0.15;
const CART_RECOVERY_RATE = 0.25;
const SEVERITY_RANK: Record<AnomalyFinding["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export async function detectAnomalies(client: StoreClient): Promise<AnomalyFinding[]> {
  const now = client.now();
  const nowMs = Date.parse(now);
  const findings: AnomalyFinding[] = [];

  const [
    activeCampaigns,
    suppliers,
    activeProducts,
    couriers,
    recentRtoOrders,
    inTransitPOs,
    ordersLast14,
    openTickets,
    escalatedTickets,
    cartsNone,
    cartsPrepared,
  ] = await Promise.all([
    client.listCampaigns("active"),
    client.listSuppliers(),
    client.listProducts({ status: "active" }),
    client.listCouriers(),
    client.listOrders({ sinceDays: 30, status: "rto" }),
    client.listPurchaseOrders("in_transit"),
    client.listOrders({ sinceDays: 14 }),
    client.listSupportTickets("open"),
    client.listSupportTickets("escalated"),
    client.listAbandonedCarts("none"),
    client.listAbandonedCarts("message_prepared"),
  ]);

  // ---- Ads ----------------------------------------------------------------
  for (const campaign of activeCampaigns) {
    if (campaign.dailyStats.length < 6) continue;
    const m = computeCampaignMetrics(client, campaign);
    const last3 = statsWindow(campaign.dailyStats, now, 0, 2);
    const spend3d = round2(sum(last3.map((s) => s.spend)));
    const conversions3d = sum(last3.map((s) => s.conversions));

    if (conversions3d === 0 && spend3d > 50) {
      findings.push({
        id: `ads-${campaign.id}`,
        severity: "critical",
        domain: "ads",
        title: `"${campaign.name}" is burning spend with zero conversions`,
        evidence: `${usd(spend3d)} spent on ${campaign.channel} over the last 3 days with 0 conversions (7-day: ${usd(m.spend7d)} spend, ${usd(m.revenue7d)} revenue).`,
        suggestedAction: `Pause it now with the update_campaign tool (campaignId "${campaign.id}", status "paused"), then rework the audience or creative before restarting.`,
      });
    } else if (m.cpaTrendPct !== null && m.cpa3d !== null && m.cpaPrior7d !== null && m.cpaTrendPct >= 30) {
      findings.push({
        id: `ads-${campaign.id}`,
        severity: "warning",
        domain: "ads",
        title: `"${campaign.name}" cost per acquisition is climbing fast`,
        evidence: `CPA rose ${signedPct(m.cpaTrendPct)} — from ${usd(m.cpaPrior7d)} to ${usd(m.cpa3d)} — with ${usd(spend3d)} spent over the last 3 days.`,
        suggestedAction: `Trim the daily budget with the update_campaign tool (campaignId "${campaign.id}") and refresh the creative; pause it if CPA keeps climbing.`,
      });
    } else if (m.roas7d !== null && m.roas7d < 1 && m.spend7d > 100) {
      findings.push({
        id: `ads-${campaign.id}`,
        severity: "warning",
        domain: "ads",
        title: `"${campaign.name}" is running below break-even`,
        evidence: `7-day ROAS is ${m.roas7d} (${usd(m.revenue7d)} revenue on ${usd(m.spend7d)} spend) — every ad dollar returns less than a dollar.`,
        suggestedAction: `Cut the daily budget or pause via the update_campaign tool (campaignId "${campaign.id}") until targeting improves.`,
      });
    }

    if (m.roas7d !== null && m.roas7d >= 3 && campaign.status === "active") {
      findings.push({
        id: `ads-scale-${campaign.id}`,
        severity: "info",
        domain: "ads",
        title: `"${campaign.name}" is a scale candidate`,
        evidence: `7-day ROAS is ${m.roas7d} (${usd(m.revenue7d)} revenue on ${usd(m.spend7d)} spend) with ${m.conversions7d} conversions.`,
        suggestedAction: `Raise the daily budget from ${usd(campaign.dailyBudget)} with the update_campaign tool (campaignId "${campaign.id}"), staying within the budget-change guardrail.`,
      });
    }
  }

  // ---- Inventory ----------------------------------------------------------
  const suppliersById = new Map(suppliers.map((s) => [s.id, s]));
  for (const product of activeProducts) {
    const recentWeeks = product.weeklyVelocity.slice(-4);
    const dailyVelocity =
      recentWeeks.length > 0 ? sum(recentWeeks) / recentWeeks.length / 7 : 0;

    const supplier = suppliersById.get(product.supplierId);
    const offer = supplier?.offers.find((o) => o.productId === product.id);
    if (dailyVelocity > NEAR_ZERO_VELOCITY && supplier && offer) {
      const leadTime = offer.leadTimeDays + supplier.currentDelayDays;
      const daysOfCover = product.stock / dailyVelocity;
      if (daysOfCover < leadTime) {
        const reorderQty = Math.ceil(dailyVelocity * (leadTime + 14) - product.stock);
        findings.push({
          id: `inventory-${product.id}`,
          severity: "critical",
          domain: "inventory",
          title: `${product.name} will stock out before a reorder can arrive`,
          evidence: `${product.stock} units left selling ~${round2(dailyVelocity)}/day = ${Math.floor(daysOfCover)} days of cover, but ${supplier.name} needs ${leadTime} days to deliver${supplier.currentDelayDays > 0 ? ` (including ${supplier.currentDelayDays} days of current delay)` : ""}.`,
          suggestedAction: `Reorder ${reorderQty} units today with the create_purchase_order tool (supplierId "${supplier.id}", productId "${product.id}", quantity ${reorderQty}) to cover the lead time plus a 14-day buffer.`,
        });
      }
    }

    if (product.stock > 3 * product.reorderPoint && dailyVelocity < DEAD_STOCK_VELOCITY) {
      const tiedUpCash = round2(product.stock * product.cost);
      findings.push({
        id: `inventory-dead-${product.id}`,
        severity: "info",
        domain: "inventory",
        title: `${product.name} looks like dead stock`,
        evidence: `${product.stock} units on hand (reorder point ${product.reorderPoint}) selling only ~${round2(dailyVelocity)}/day — ${usd(tiedUpCash)} of cash tied up.`,
        suggestedAction: `Run a clearance offer with the create_discount tool or cut the price with the update_price tool (productId "${product.id}") to turn ${usd(tiedUpCash)} of stock back into cash.`,
      });
    }
  }

  // ---- Logistics ----------------------------------------------------------
  for (const courier of couriers) {
    if (courier.onTimeRate < 0.85) {
      const best = couriers
        .filter((c) => c.id !== courier.id)
        .sort((a, b) => b.onTimeRate - a.onTimeRate)[0];
      findings.push({
        id: `logistics-${courier.id}`,
        severity: "warning",
        domain: "logistics",
        title: `${courier.name} is missing delivery promises`,
        evidence: `${courier.name} delivers on time only ${pct(courier.onTimeRate * 100)} of the time (avg ${courier.avgDeliveryDays} days), below the 85% bar.`,
        suggestedAction: best
          ? `Route upcoming shipments to ${best.name} (${pct(best.onTimeRate * 100)} on-time) with the assign_courier tool.`
          : `Reassign upcoming shipments with the assign_courier tool once a better courier is available.`,
      });
    }
    if (courier.rtoRate > 0.08) {
      const affected = recentRtoOrders.filter((o) => o.courierId === courier.id).length;
      findings.push({
        id: `logistics-rto-${courier.id}`,
        severity: "warning",
        domain: "logistics",
        title: `${courier.name} has a high return-to-origin rate`,
        evidence: `${courier.name} returns ${pct(courier.rtoRate * 100)} of shipments to origin — ${affected} RTO order${affected === 1 ? "" : "s"} in the last 30 days.`,
        suggestedAction: `Move shipments in the affected regions to another courier with the assign_courier tool, and confirm addresses on high-value orders via send_customer_message.`,
      });
    }
  }
  for (const supplier of suppliers) {
    if (supplier.currentDelayDays > 0) {
      const affected = inTransitPOs.filter((po) => po.supplierId === supplier.id);
      findings.push({
        id: `logistics-supplier-${supplier.id}`,
        severity: "warning",
        domain: "logistics",
        title: `${supplier.name} is running ${supplier.currentDelayDays} day${supplier.currentDelayDays === 1 ? "" : "s"} late`,
        evidence: `${supplier.name} reports ${supplier.currentDelayDays} days of delay on open POs${affected.length > 0 ? ` — affected in-transit orders: ${affected.map((po) => po.id).join(", ")}` : " (no POs currently in transit)"}.`,
        suggestedAction: `Chase ${supplier.name} for updated ETAs; if delays persist, move affected products with the switch_supplier tool and warn waiting customers via send_customer_message.`,
      });
    }
  }

  // ---- Sales --------------------------------------------------------------
  const eligibleOrders = revenueEligible(ordersLast14);
  const salesLast7 = eligibleOrders.filter((o) => placedWithinDays(o, nowMs, 7));
  const salesPrior7 = eligibleOrders.filter((o) => !placedWithinDays(o, nowMs, 7));
  const revLast7 = orderTotal(salesLast7);
  const revPrior7 = orderTotal(salesPrior7);
  const salesChange = pctChange(revPrior7, revLast7);
  if (salesChange !== null && salesChange < -15) {
    const revByProduct = (orders: Order[]): Map<string, number> => {
      const map = new Map<string, number>();
      for (const order of orders) {
        for (const item of order.items) {
          map.set(item.productName, (map.get(item.productName) ?? 0) + item.quantity * item.unitPrice);
        }
      }
      return map;
    };
    const lastMap = revByProduct(salesLast7);
    const decliners = [...revByProduct(salesPrior7).entries()]
      .map(([name, prior]) => ({ name, decline: prior - (lastMap.get(name) ?? 0) }))
      .filter((d) => d.decline > 0)
      .sort((a, b) => b.decline - a.decline)
      .slice(0, 3);
    findings.push({
      id: "sales-revenue-drop",
      severity: "warning",
      domain: "sales",
      title: `Revenue is down ${pct(Math.abs(round2(salesChange)))} week over week`,
      evidence: `Last 7 days brought ${usd(revLast7)} vs ${usd(revPrior7)} the week before (${signedPct(salesChange)}). Biggest decliners: ${decliners.map((d) => `${d.name} (-${usd(d.decline)})`).join(", ") || "spread evenly across the catalog"}.`,
      suggestedAction: `Refresh ads for the declining products with the update_campaign tool, or test a limited create_discount to win demand back.`,
    });
  } else if (salesChange !== null && salesChange > 20) {
    findings.push({
      id: "sales-revenue-rise",
      severity: "info",
      domain: "sales",
      title: `Revenue is up ${pct(round2(salesChange))} week over week`,
      evidence: `Last 7 days brought ${usd(revLast7)} vs ${usd(revPrior7)} the week before (${signedPct(salesChange)}).`,
      suggestedAction: `Lean in: scale the winning campaigns with the update_campaign tool (within the budget guardrail) and check stock covers the extra demand.`,
    });
  }

  // ---- Support ------------------------------------------------------------
  const staleCutoffMs = nowMs - 12 * HOUR_MS;
  const staleTickets = [...openTickets, ...escalatedTickets].filter(
    (t) => Date.parse(t.openedAt) < staleCutoffMs,
  );
  if (staleTickets.length > 0) {
    const oldest = staleTickets.reduce((a, b) =>
      Date.parse(a.openedAt) <= Date.parse(b.openedAt) ? a : b,
    );
    const oldestHours = Math.floor((nowMs - Date.parse(oldest.openedAt)) / HOUR_MS);
    findings.push({
      id: "support-stale-tickets",
      severity: "warning",
      domain: "support",
      title: `${staleTickets.length} support ticket${staleTickets.length === 1 ? "" : "s"} waiting more than 12 hours`,
      evidence: `${staleTickets.length} open/escalated ticket${staleTickets.length === 1 ? " has" : "s have"} gone unanswered for over 12h; the oldest ("${oldest.subject}") has waited ${oldestHours}h.`,
      suggestedAction: `Work through them with the resolve_ticket tool, starting with ticket "${oldest.id}".`,
    });
  }

  // ---- Carts --------------------------------------------------------------
  const unrecoveredCarts = [...cartsNone, ...cartsPrepared];
  if (unrecoveredCarts.length > 0) {
    const cartValue = round2(sum(unrecoveredCarts.map((c) => c.value)));
    const expectedRecovery = round2(cartValue * CART_RECOVERY_RATE);
    findings.push({
      id: "carts-unrecovered",
      severity: "info",
      domain: "carts",
      title: `${unrecoveredCarts.length} abandoned cart${unrecoveredCarts.length === 1 ? "" : "s"} awaiting recovery`,
      evidence: `${unrecoveredCarts.length} cart${unrecoveredCarts.length === 1 ? "" : "s"} worth ${usd(cartValue)} have no recovery message sent yet; at a ${pct(CART_RECOVERY_RATE * 100)} recovery rate that is ~${usd(expectedRecovery)} of winnable revenue.`,
      suggestedAction: `Send personalised recovery messages with the send_customer_message tool (purpose "cart_recovery"), adding a small create_discount code on high-value carts.`,
    });
  }

  // ---- Margin -------------------------------------------------------------
  const thinMargin = activeProducts.filter(
    (p) => p.price > 0 && marginPctOf(p) < THIN_MARGIN_PCT,
  );
  if (thinMargin.length > 0) {
    findings.push({
      id: "margin-thin-products",
      severity: "info",
      domain: "margin",
      title: `${thinMargin.length} product${thinMargin.length === 1 ? "" : "s"} selling below a ${THIN_MARGIN_PCT}% margin`,
      evidence: `Below the ${THIN_MARGIN_PCT}% margin floor: ${thinMargin.map((p) => `${p.name} (${pct(marginPctOf(p))} at ${usd(p.price)})`).join(", ")}.`,
      suggestedAction: `Raise prices with the update_price tool or source cheaper with the switch_supplier tool for these products.`,
    });
  }

  return findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
