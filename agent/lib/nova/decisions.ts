/**
 * Decision authoring (PRD E-9, Stage 2 "Consent").
 *
 * When the authority seam says `draft` or `suggest`, Nova has decided what it
 * WANTS to do but not that it may. That gap is a question for the founder, and
 * this turns it into one record they can answer from anywhere.
 *
 * The projection matters more than it looks. A prepared action carries a
 * receipt written for the ledger — precise, evidential, sometimes long. A
 * decision card has to be answerable in a few seconds on a phone. So this
 * derives a tight `impactLabel`, a `paramsLine` a human can scan, and a `why`
 * in the founder's terms — all from what the receipt already says. Nothing is
 * invented here: if the receipt doesn't support a claim, the card doesn't make
 * it. The full reasoning stays one tap away on the action.
 */

import type {
  ActionRecord,
  AuthorityDecision,
  DecisionRecord,
  NovaDepartment,
  RiskClass,
} from "../types";
import type { StoreClient } from "../store/client";
import { money } from "./format";

/**
 * How long an unanswered decision stays useful, by risk.
 *
 * A stale decision is worse than no decision: approving a week-old "pause this
 * campaign" acts on a situation that has moved. High-risk asks expire fastest
 * because they are the ones whose context shifts hardest.
 */
const TTL_HOURS: Record<RiskClass, number> = {
  high: 24,
  medium: 72,
  low: 168, // a week
};

/** Which door a department's work lands in, for the card's surface list. */
const DOOR_BY_DEPARTMENT: Partial<Record<NovaDepartment, string>> = {
  marketing: "campaigns",
  sales: "coupons",
  support: "inbox",
  product_research: "research",
  inventory: "products",
  operations: "purchases",
  shipping: "courier",
  finance: "accounts",
  growth: "growth",
};

/** A short, scannable parameter line: "10% off · order-wide · 7 days". */
export function paramsLineFor(type: string, payload: Record<string, unknown>): string {
  const parts: string[] = [];
  const p = payload as Record<string, string | number | undefined>;
  switch (type) {
    case "create_discount":
      if (p.percentOff != null) parts.push(`${p.percentOff}% off`);
      if (p.code) parts.push(String(p.code));
      if (p.scope) parts.push(p.scope === "order" ? "order-wide" : "product-scoped");
      if (p.expiresInDays != null) parts.push(`${p.expiresInDays} days`);
      break;
    case "create_campaign":
      if (p.name) parts.push(String(p.name));
      if (p.channel) parts.push(String(p.channel));
      if (p.dailyBudget != null) parts.push(`${money(Number(p.dailyBudget))}/day`);
      break;
    case "update_campaign":
      if (p.dailyBudget != null) parts.push(`budget → ${money(Number(p.dailyBudget))}/day`);
      if (p.status) parts.push(String(p.status));
      break;
    case "update_price":
      if (p.newPrice != null) parts.push(`new price ${money(Number(p.newPrice))}`);
      if (p.productId) parts.push(String(p.productId));
      break;
    case "create_purchase_order":
      if (p.quantity != null) parts.push(`${p.quantity} units`);
      if (p.unitCost != null) parts.push(`${money(Number(p.unitCost))}/unit`);
      if (p.quantity != null && p.unitCost != null) {
        parts.push(`total ${money(Number(p.quantity) * Number(p.unitCost))}`);
      }
      break;
    case "bulk_refund":
      if (Array.isArray(payload.orderIds)) parts.push(`${(payload.orderIds as string[]).length} orders`);
      break;
    default:
      // Unknown verb: say nothing rather than guess at its parameters.
      break;
  }
  return parts.join(" · ");
}

/**
 * The one-line impact.
 *
 * Prefers the receipt's own `expectedImpact` because Nova already had to argue
 * it. Falls back to naming the absence rather than inventing a number — a card
 * reading "+৳12,400/wk est." that nothing supports is worse than one admitting
 * the impact wasn't quantified.
 */
export function impactLabelFor(action: Pick<ActionRecord, "receipt">): string {
  const impact = action.receipt?.expectedImpact?.trim();
  if (impact) return impact.length > 90 ? `${impact.slice(0, 87)}…` : impact;
  return "Impact not quantified";
}

export interface AuthoredDecision {
  tag: NovaDepartment;
  kind: "proposal" | "escalation" | "promotion";
  impactLabel: string;
  title: string;
  paramsLine: string;
  why: string;
  actionId: string;
  priority: number;
  surfacedIn: string[];
  expiresAt: string | null;
}

/**
 * Project a gated action into the decision the founder answers.
 *
 * `kind` follows the verdict, not the risk: a refusal Nova wants the founder to
 * know about is an ESCALATION (something they may need to act on), while a
 * draft is a PROPOSAL (something they choose). Conflating them buries refusals
 * in a queue of ordinary asks.
 */
export function authorDecision(
  client: StoreClient,
  action: ActionRecord,
  authority: Pick<AuthorityDecision, "verdict" | "rule" | "riskClass">,
): AuthoredDecision {
  const isEscalation = authority.verdict === "refuse";
  const door = DOOR_BY_DEPARTMENT[action.department];
  const ttl = TTL_HOURS[authority.riskClass] ?? 72;

  return {
    tag: action.department,
    kind: isEscalation ? "escalation" : "proposal",
    impactLabel: impactLabelFor(action),
    title: action.title,
    paramsLine: paramsLineFor(action.type, action.payload),
    why: action.receipt?.reason ?? "No reason recorded",
    actionId: action.id,
    // Escalations and high-risk asks pin to the top; they are the ones a
    // founder most needs to see before the queue buries them.
    priority: isEscalation || authority.riskClass === "high" ? 1 : 5,
    surfacedIn: ["desk", `room:${action.department}`, ...(door ? [`door:${door}`] : [])],
    expiresAt: new Date(Date.parse(client.now()) + ttl * 3600 * 1000).toISOString(),
  };
}

/** A queue digest for the L2 context layer — what is waiting, in one line. */
export function queueDigest(decisions: DecisionRecord[]): string {
  const queued = decisions.filter((d) => d.status === "queued" || d.status === "later");
  const frozen = decisions.filter((d) => d.status === "frozen").length;

  // A frozen card is still waiting on the founder — to lift the lock. Reporting
  // "nothing waiting" while locks hold work back is the kind of quiet
  // inaccuracy that loses trust.
  if (queued.length === 0) {
    return frozen > 0
      ? `${frozen} frozen by a lock — nothing else waiting.`
      : "Nothing waiting on the founder.";
  }

  const pinned = queued.filter((d) => d.priority === 1).length;
  const bits = [`${queued.length} waiting`];
  if (pinned > 0) bits.push(`${pinned} pinned`);
  if (frozen > 0) bits.push(`${frozen} frozen by a lock`);
  return bits.join(" · ");
}
