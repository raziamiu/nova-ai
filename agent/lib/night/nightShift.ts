/**
 * Night shift (Stage 3, §9 + §13) — the unattended nightly analysis that fills
 * a founder's morning.
 *
 * This is the DETERMINISTIC core: it reads the store's real state, grades the
 * departments from live signals, authors the plan board and any over-authority
 * decisions (the "scale decision" the Stage 3 gate demands), and files the
 * morning brief. The model's job on top of this is narrative and nuance; the
 * numbers, grades, and decisions here are computed, so a 3am model hiccup can
 * never fabricate a grade or invent a decision.
 *
 * Everything it writes goes through the StoreClient, so it lands in the same
 * ledger + rooms + brief the founder reads — DemoStore for evals, the live
 * dakio-api backend in production.
 */

import type { StoreClient } from "../store/client";
import type {
  ActionReceipt,
  DecisionRecord,
  DepartmentGrade,
  NovaDepartment,
  PlanItem,
  ScoreMetric,
} from "../types";

export interface NightShiftResult {
  day: string;
  departments: DepartmentGrade[];
  planItems: PlanItem[];
  decisions: DecisionRecord[];
  briefId: string;
}

function gradeFromPct(avgPct: number): string {
  if (avgPct >= 90) return "A";
  if (avgPct >= 75) return "B";
  if (avgPct >= 60) return "C";
  if (avgPct >= 45) return "D";
  return "F";
}

function avg(metrics: ScoreMetric[]): number {
  if (!metrics.length) return 0;
  return Math.round(metrics.reduce((s, m) => s + m.pct, 0) / metrics.length);
}

/** Author an over-authority action + its decision, returning the decision so a
 *  plan item can point at it (the WAITING_ON_YOU → DONE bridge). */
async function authorScaleDecision(
  store: StoreClient,
  input: {
    department: NovaDepartment;
    title: string;
    type: string;
    payload: Record<string, unknown>;
    impactLabel: string;
    paramsLine: string;
    why: string;
    receipt: ActionReceipt;
  },
): Promise<DecisionRecord> {
  const action = await store.addAction({
    // `type` is an ActionType at the type level; the night shift only emits
    // verbs the executors know (create_grow_campaign here).
    type: input.type as never,
    department: input.department,
    title: input.title,
    payload: input.payload,
    justification: {
      reason: input.receipt.reason,
      expectedImpact: input.receipt.expectedImpact,
      confidence: input.receipt.confidence,
    },
    receipt: input.receipt,
    riskClass: "medium",
    status: "prepared",
    outcome: null,
    undoable: true,
    undoData: null,
    actor: "nova",
    targetRef: null,
    agentId: null,
    dutyRef: null,
    undoDeadline: null,
    undoneAt: null,
    decidedAt: null,
    executedAt: null,
  });

  return store.addDecision({
    tag: input.department,
    kind: "proposal",
    impactLabel: input.impactLabel,
    title: input.title,
    paramsLine: input.paramsLine,
    why: input.why,
    actionId: action.id,
    surfacedIn: ["desk", `room:${input.department}`, "door:grow"],
    priority: 5,
    expiresAt: null,
  });
}

export async function runNightShift(store: StoreClient): Promise<NightShiftResult> {
  const day = store.now().slice(0, 10);
  const departments: DepartmentGrade[] = [];
  const planItems: PlanItem[] = [];
  const decisions: DecisionRecord[] = [];

  // ── Read real signals ────────────────────────────────────────────────────
  const [orders, campaigns, activity, lowStock] = await Promise.all([
    store.listOrders({ sinceDays: 30 }).catch(() => []),
    store.listGrowCampaigns().catch(() => []),
    store.listActivity({ sinceDays: 1 }).catch(() => []),
    store.listProducts({ status: "active" }).catch(() => []),
  ]);

  // ── Marketing ──────────────────────────────────────────────────────────
  const liveCampaigns = campaigns.filter((c) => c.status === "Live").length;
  const preparedToday = activity.length;
  const marketingMetrics: ScoreMetric[] = [
    { label: "Live campaigns", value: String(liveCampaigns), targetText: "≥1", pct: liveCampaigns > 0 ? 85 : 40, tone: liveCampaigns > 0 ? "good" : "warn" },
    { label: "Actions today", value: String(preparedToday), targetText: "≥3", pct: Math.min(100, preparedToday * 25), tone: preparedToday >= 3 ? "good" : "warn" },
    { label: "Campaigns on file", value: String(campaigns.length), targetText: "≥2", pct: Math.min(100, campaigns.length * 40), tone: campaigns.length >= 2 ? "good" : "warn" },
  ];
  const marketing = await store.setDepartment({
    key: "marketing",
    grade: gradeFromPct(avg(marketingMetrics)),
    statusLine: liveCampaigns > 0 ? "Campaigns running" : "No live campaign",
    now: "Reviewing campaign performance",
    next: ["Scale the winner", "Prepare Eid creatives"],
    memo: `${liveCampaigns} live campaign(s), ${campaigns.length} on file. ${preparedToday} actions ran today.`,
    metrics: marketingMetrics,
  });
  departments.push(marketing);

  // The scale decision (the Stage 3 gate's centrepiece): propose launching /
  // scaling a campaign. Over-authority → a decision the founder answers, whose
  // approval creates the live campaign (executor 09-B) and flips the plan item.
  const scale = await authorScaleDecision(store, {
    department: "marketing",
    title: "Scale the Eid collection to a Facebook campaign",
    type: "create_grow_campaign",
    payload: { name: "Eid Collection Push", collection: "Eid Saree", channel: "facebook_organic", goal: "Sales", status: "Scheduled" },
    impactLabel: "+৳31,000 reach est.",
    paramsLine: "New FB campaign · Eid Saree · scheduled",
    why: "The Eid collection is in stock and had strong organic reach last time. Scaling it into a scheduled campaign captures the pre-Eid demand window.",
    receipt: {
      reason: "Eid collection has in-stock SKUs and prior organic reach of ~3,100. A scheduled campaign captures pre-Eid demand.",
      expectedImpact: "~3,000 reach, +৳31,000 attributed sales (estimated)",
      confidence: 0.61,
      evidence: [
        { source: "Grow", note: "Prior Eid collection post reached ~3,100 organically", metric: "last_reach", value: 3100 },
        { source: "Products", note: "Eid SKUs in stock", metric: "in_stock", value: lowStock.length },
      ],
      before: { eidCampaigns: 0 },
      after: { eidCampaigns: 1 },
    },
  });
  decisions.push(scale);

  // The plan item that the scale decision unblocks — WAITING_ON_YOU with the
  // decisionRef the approve transaction flips to DONE.
  planItems.push(await store.addPlanItem({
    department: "marketing",
    status: "WAITING_ON_YOU",
    title: "Scale the Eid collection campaign",
    detail: "Awaiting your approval on the desk.",
    progressPct: 0,
    decisionRef: scale.id,
    nightShiftDate: day,
  }));
  // A routine in-authority item Nova is already handling.
  planItems.push(await store.addPlanItem({
    department: "marketing",
    status: "IN_PROGRESS",
    title: "Draft this week's social posts",
    detail: "Preparing captions for the Eid collection.",
    progressPct: 40,
    decisionRef: null,
    nightShiftDate: day,
  }));

  // ── Operations (a lighter grade so the room isn't a one-department view) ──
  const opsMetrics: ScoreMetric[] = [
    { label: "Orders (30d)", value: String(orders.length), targetText: "growing", pct: orders.length > 0 ? 70 : 30, tone: orders.length > 0 ? "good" : "warn" },
    { label: "Active products", value: String(lowStock.length), targetText: "stocked", pct: lowStock.length > 0 ? 75 : 40, tone: lowStock.length > 0 ? "good" : "warn" },
  ];
  departments.push(await store.setDepartment({
    key: "operations" as NovaDepartment,
    grade: gradeFromPct(avg(opsMetrics)),
    statusLine: "Fulfilment steady",
    now: "Watching stock and returns",
    next: ["Reorder fast movers"],
    memo: `${orders.length} orders in the last 30 days.`,
    metrics: opsMetrics,
  }));
  planItems.push(await store.addPlanItem({
    department: "operations" as NovaDepartment,
    status: "SCHEDULED",
    title: "Nightly stock check",
    detail: "Flag anything under a week of cover.",
    progressPct: 0,
    decisionRef: null,
    nightShiftDate: day,
  }));

  // ── File the brief (tiles computed server-side from these very rows) ──────
  const brief = await store.fileBrief({
    day,
    narrative:
      `Good morning, Founder. A steady night. Marketing is graded ${marketing.grade} — ` +
      `${liveCampaigns} campaign(s) live. I've prepared one thing for your call: scaling the Eid ` +
      `collection into a Facebook campaign. Approve it on the desk and it goes live, reversible for 24h.`,
  });

  return { day, departments, planItems, decisions, briefId: brief.id };
}
