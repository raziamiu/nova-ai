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

/**
 * Per-VERB door overrides, consulted before `DOOR_BY_DEPARTMENT`.
 *
 * Stage 10 module 05 opened this, and the reason is a mismatch both the recon
 * and two build streams flagged rather than fixed, because neither could fix it
 * from inside its own lane: a chat order's department is `sales` (it is a sale,
 * wherever the conversation started), and `sales` maps to the Coupons door — so
 * "approve this order" surfaced under Coupons. The founder looking for it goes
 * to Orders, finds nothing, and the card ages out.
 *
 * It cannot be fixed by changing the verb's department: the map is per-department
 * and moving `sales` would move every coupon card with it. So the exception is
 * expressed as an exception, one row, rather than bent into the general rule.
 *
 * `door:*` is a free string that is stored on `NovaDecision.surfacedIn` and
 * re-emitted; nothing filters on it server-side and dakio-merchant does not read
 * it yet (module 10 builds the door queues). So this is inert TODAY and correct
 * the day it stops being inert — which is the only order in which it can be got
 * right, because by then the cards are already written.
 *
 * `offer_chat_discount` is deliberately NOT here: a coupon in the Coupons door is
 * where it belongs. `verify_payment_slip` is `finance` → `accounts`, also right.
 */
const DOOR_BY_ACTION_TYPE: Record<string, string> = {
  create_order_from_chat: "orders",
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
    // Module 03. The merge card's headline — two names, two order counts —
    // comes from the tool-authored `title`, NOT from here: this function only
    // ever sees the payload, and that payload deliberately carries no names and
    // no digits. All it can honestly render is why the two rows were paired.
    // Without this case the card's params line renders BLANK.
    case "merge_customer_records":
      if (p.basis) {
        parts.push(p.basis === "phone_variant" ? "same number, two records" : "matched at link time");
      }
      break;
    // Rarely drafted (link_customer_identity is never-gated, so it normally
    // executes) — but a paused duty or a no-touch lock can still route it to a
    // card, and a card with no params line is a card the founder cannot judge.
    case "link_customer_identity":
      if (p.conversationId) parts.push(`thread ${p.conversationId}`);
      parts.push(p.verify ? "digit check" : "self-stated number");
      break;
    // Module 04. Drafted more often than the link above, because
    // `schedule_follow_up` is deliberately NOT never-gated (OD-6) — at T0
    // Shadow every one of these becomes a card. The two things a founder needs
    // to answer it in three seconds are WHEN and WHY, so both are here; the
    // conversation id is not, because it tells them nothing they can read.
    case "schedule_follow_up":
      if (p.delay) parts.push(`in ${p.delay}`);
      if (p.reason) parts.push(String(p.reason));
      break;
    // Module 05. This is the card that spends the customer's money, and at T0/T1
    // — the only tiers that exist (`inbox.orderAuto` is seeded false and
    // `tierMoveDecision` refuses every move to T2/T3 until module 11) — EVERY
    // chat order becomes one of these. So the params line is not a nicety: it is
    // the whole of what the founder reads before a COD parcel goes on the road.
    //
    // WHAT IS HERE: the goods and the destination — the two facts that decide
    // "yes, send that" or "no". `productName` is on the payload precisely because
    // a cuid tells a founder nothing (it is also what a no-touch lock matches on,
    // authority.ts's TARGET_TEXT). District, not city, because district is what
    // the delivery charge is actually resolved from.
    //
    // WHAT IS DELIBERATELY NOT HERE: the phone, the address line and the customer
    // name. This function's output is a short scannable string that travels with
    // the card; `link_customer_identity` above renders the thread id rather than
    // the number and `merge_customer_records` renders no names at all, for the
    // same reason. The founder opens the card for the address; they do not need
    // it in the one-line summary, and the summary is the copy that gets logged,
    // listed and re-rendered in places nobody re-audits.
    case "create_order_from_chat": {
      const items = Array.isArray(payload.items) ? (payload.items as Record<string, unknown>[]) : [];
      const named = items
        .map((it) => {
          const name = typeof it?.productName === "string" ? it.productName.trim() : "";
          if (!name) return "";
          const qty = Number(it?.qty);
          return Number.isFinite(qty) && qty > 1 ? `${name} ×${qty}` : name;
        })
        .filter(Boolean);
      // Two names then a count, rather than a wall: a five-line order still has
      // to read in three seconds, and the card's own body lists every item.
      if (named.length > 2) parts.push(`${named.slice(0, 2).join(", ")} +${named.length - 2} more`);
      else if (named.length) parts.push(named.join(", "));
      else if (items.length) parts.push(`${items.length} item${items.length === 1 ? "" : "s"}`);
      if (p.customerDistrict) parts.push(`to ${p.customerDistrict}`);
      // Named because it is the ONLY way anything on this path sells below list
      // — `POST /api/v1/store/orders` refuses `discount` and `paid` outright — so
      // a coupon on a chat order is a fact the founder is entitled to see first.
      if (p.couponCode) parts.push(`coupon ${p.couponCode}`);
      break;
    }
    // Module 05. `free_delivery` carries no amount by design (the server resolves
    // the store's own delivery charge; the model is never told the table), so the
    // mechanism has to speak for itself rather than render a blank number.
    // `reason` is last and unabridged: the ceiling and the frequency window are
    // already enforced server-side, so the only thing left for a human to judge
    // is whether this customer had earned it.
    case "offer_chat_discount":
      if (p.mechanism === "percent" && p.percentOff != null) parts.push(`${p.percentOff}% off`);
      else if (p.mechanism === "fixed" && p.amount != null) parts.push(`${money(Number(p.amount))} off`);
      else if (p.mechanism === "free_delivery") parts.push("free delivery");
      else if (p.mechanism) parts.push(String(p.mechanism));
      if (p.expiresHours != null) parts.push(`expires in ${p.expiresHours}h`);
      if (p.reason) parts.push(String(p.reason));
      break;
    // Module 05. ALWAYS_DRAFT in both repos, so this card is the only form this
    // verb ever takes. It files a CLAIM and marks nothing paid — the amount below
    // is what the CUSTOMER SAID, and the wording says so, because a founder who
    // reads "৳1,200" as a confirmed receipt will approve a card that confirms
    // nothing. The trx id is rendered when present because it is the string they
    // will paste into their own bKash app, which is the actual verification.
    case "verify_payment_slip":
      if (p.method) parts.push(String(p.method));
      if (p.claimedAmount != null) parts.push(`claims ${money(Number(p.claimedAmount))}`);
      if (p.trxId) parts.push(`trx ${p.trxId}`);
      else parts.push("no trx id given");
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
  const door = DOOR_BY_ACTION_TYPE[action.type] ?? DOOR_BY_DEPARTMENT[action.department];
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
