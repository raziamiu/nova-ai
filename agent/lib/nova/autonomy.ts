/**
 * The autonomy gate — decides, for every action Nova wants to take, whether
 * it executes immediately, is queued for owner approval, or is blocked.
 *
 * PRD autonomy levels:
 *   0 observation only — no actions, only reports
 *   1 recommendations  — every action becomes an approval task
 *   2 prepared actions — Nova drafts the full action, owner approves
 *   3 autonomous       — low-risk actions run automatically, owner notified
 *   4 business operator — runs operations within owner-set guardrails
 */

import type {
  ActionType,
  AutonomyConfig,
  Guardrails,
  RiskClass,
} from "../types";
import type { StoreClient } from "../store/client";

/**
 * Guardrails come in two kinds, and the difference matters whenever the demo
 * data or a store's currency changes:
 *
 *  - PERCENTAGE guardrails are currency-invariant. They mean the same thing at
 *    any denomination.
 *  - MONEY guardrails are denominated in ৳ (BDT, Dakio's currency). They must
 *    be re-denominated in lockstep with the data they are compared against, or
 *    the gate silently changes behaviour — every purchase order flipping from
 *    "execute" to "needs approval" while every test still passes.
 *    `scripts/money-audit.ts` is the check for that.
 */
export const DEFAULT_GUARDRAILS: Guardrails = {
  // Percentages — currency-invariant.
  maxDiscountPct: 20,
  maxPriceChangePct: 15,
  maxBudgetChangePct: 50,
  minMarginPct: 25,
  // ৳ amounts — must move with the data.
  maxAutoPurchaseOrderTotal: 300_000,
  /**
   * NOT ENFORCED TODAY. There is no refund action in `ActionType`, and no
   * branch of `checkGuardrails` reads this, so setting it changes nothing —
   * it is a promise the code does not keep. Kept (and re-denominated) because
   * the owner-facing config already exposes it and dropping it would silently
   * discard a stored setting; wire it up when a refund action lands.
   */
  maxAutoRefundTotal: 12_000,
};

/** Inherent risk of each action type, before guardrails are considered. */
export const RISK_CLASS: Record<ActionType, RiskClass> = {
  send_customer_message: "low",
  resolve_ticket: "low",
  // Front Office. Both are `low` deliberately: the risk control on a customer
  // reply is the fail-closed guardrail branch below (safe-intent allowlist +
  // thread state), not a risk class that would force every "1250 tk" answer
  // through the founder. Escalation is low because stepping back is never the
  // dangerous move.
  send_inbox_reply: "low",
  escalate_conversation: "low",
  publish_social_post: "low",
  update_campaign: "medium",
  create_campaign: "medium",
  create_discount: "medium",
  update_price: "medium",
  import_product: "medium",
  assign_courier: "medium",
  create_purchase_order: "high",
  switch_supplier: "high",
  bulk_refund: "high",
};

export interface GateDecision {
  verdict: "execute" | "prepare" | "block";
  riskClass: RiskClass;
  /** Why this verdict — always safe to show the owner. */
  explanation: string;
}

type GuardrailCheck =
  | { result: "allow" }
  | { result: "needs_approval"; why: string; rule: string; whyBn?: string }
  | { result: "block"; why: string; rule: string; whyBn?: string };

/**
 * Hard business limits. "block" means Nova may never do it, even with
 * approval — the owner must change the guardrail itself. "needs_approval"
 * means the action is legitimate but exceeds what Nova may do alone.
 */
async function checkGuardrails(
  client: StoreClient,
  guardrails: Guardrails,
  type: ActionType,
  payload: Record<string, unknown>,
): Promise<GuardrailCheck> {
  switch (type) {
    case "create_discount": {
      const percentOff = Number(payload.percentOff ?? 0);
      if (percentOff > guardrails.maxDiscountPct) {
        return {
          result: "block",
          rule: "max_discount_pct",
          why: `Discount of ${percentOff}% exceeds the ${guardrails.maxDiscountPct}% guardrail.`,
        };
      }
      return { result: "allow" };
    }
    case "update_price": {
      const productId = String(payload.productId ?? "");
      const newPrice = Number(payload.newPrice ?? 0);
      const product = await client.getProduct(productId);
      if (!product) {
        return { result: "block", rule: "unknown_product", why: `Unknown product: ${productId}` };
      }
      const changePct = Math.abs((newPrice - product.price) / product.price) * 100;
      if (changePct > guardrails.maxPriceChangePct) {
        return {
          result: "needs_approval",
          rule: "max_price_change_pct",
          why: `Price change of ${changePct.toFixed(1)}% exceeds the ${guardrails.maxPriceChangePct}% autonomous limit.`,
        };
      }
      const marginPct = ((newPrice - product.cost) / newPrice) * 100;
      if (marginPct < guardrails.minMarginPct) {
        return {
          result: "block",
          rule: "min_margin_pct",
          why: `New price leaves ${marginPct.toFixed(1)}% margin, below the ${guardrails.minMarginPct}% floor.`,
        };
      }
      return { result: "allow" };
    }
    case "update_campaign": {
      const budget = payload.dailyBudget;
      if (budget === undefined || budget === null) return { result: "allow" };
      const campaign = await client.getCampaign(String(payload.campaignId ?? ""));
      if (!campaign) {
        return { result: "block", rule: "unknown_campaign", why: `Unknown campaign: ${String(payload.campaignId)}` };
      }
      const changePct =
        campaign.dailyBudget > 0
          ? (Math.abs(Number(budget) - campaign.dailyBudget) / campaign.dailyBudget) * 100
          : 100;
      if (changePct > guardrails.maxBudgetChangePct) {
        return {
          result: "needs_approval",
          rule: "max_budget_change_pct",
          why: `Budget change of ${changePct.toFixed(0)}% exceeds the ${guardrails.maxBudgetChangePct}% autonomous limit.`,
        };
      }
      return { result: "allow" };
    }
    /**
     * Front Office reply gate (module 02 D9). Four checks, EVERY read fail
     * closed — a missing platform key reads as absent and downgrades to
     * approval, never up to autosend. This is the branch that makes "the model
     * never sends" true at the tier dial rather than only at the route.
     *
     * Thread state is read from the SERVER, never from the payload: the model
     * writes the payload, and a payload that could assert "the founder isn't
     * here" would be a lock the model can talk its way past.
     */
    case "send_inbox_reply": {
      // 1. An escalation draft is a message for the founder to look at, not to
      //    send. It can never auto-execute — at any tier, in any mode.
      if (String(payload.purpose ?? "") === "escalation_draft") {
        return {
          result: "needs_approval",
          rule: "guardrail:inbox_escalated",
          why: "This reply is attached to an escalation, so the founder sends it — Nova never auto-sends an escalation draft.",
          whyBn: "এই উত্তরটি একটি এস্কেলেশনের অংশ, তাই এটি আপনি পাঠাবেন — নোভা নিজে থেকে পাঠায় না।",
        };
      }
      // 2. Safe-intent allowlist. Missing/!Array key ⇒ nothing is auto.
      const intent = String(payload.intent ?? "");
      const autoIntents = guardrails["inbox.autoIntents"];
      const isAuto = Array.isArray(autoIntents) && autoIntents.some((i) => String(i) === intent);
      if (!isAuto) {
        return {
          result: "needs_approval",
          rule: "guardrail:inbox_intent_not_auto",
          why: `"${intent || "unclassified"}" isn't on your auto-reply list, so Nova wrote the reply and left the send to you.`,
          whyBn: `"${intent || "unclassified"}" আপনার স্বয়ংক্রিয় উত্তরের তালিকায় নেই, তাই নোভা উত্তরটি লিখে আপনার জন্য রেখেছে।`,
        };
      }
      // 3. Thread state, read fresh. Unreadable ⇒ draft (fail closed): we
      //    cannot prove the founder isn't mid-conversation.
      const conversationId = String(payload.conversationId ?? "");
      let thread: Awaited<ReturnType<StoreClient["getInboxConversation"]>>;
      try {
        thread = await client.getInboxConversation(conversationId, { messages: 1 });
      } catch {
        thread = null;
      }
      if (!thread) {
        return {
          result: "needs_approval",
          rule: "guardrail:inbox_thread_unreadable",
          why: `Nova couldn't read the state of conversation ${conversationId}, so it prepared the reply instead of sending it.`,
          whyBn: `নোভা এই কথোপকথনের অবস্থা পড়তে পারেনি, তাই উত্তরটি না পাঠিয়ে প্রস্তুত করে রেখেছে।`,
        };
      }
      // 4. Per-thread switch is a refusal, not a downgrade: the founder said
      //    "not this thread", and a draft would still ask them about it.
      if (thread.conversation.novaEnabled !== true) {
        return {
          result: "block",
          rule: "duty:thread_off",
          why: "You switched Nova off for this conversation, so it wrote nothing.",
          whyBn: "আপনি এই কথোপকথনে নোভা বন্ধ রেখেছেন, তাই এটি কিছু লেখেনি।",
        };
      }
      // 5. Founder-held thread: draft silently, never send. The server's lock
      //    check is the guarantee; this just avoids the doomed attempt.
      if (thread.conversation.novaLockedAt !== null || thread.conversation.handledBy === "founder") {
        return {
          result: "needs_approval",
          rule: "guardrail:inbox_founder_active",
          why: "You have this conversation, so Nova drafted the reply instead of sending it.",
          whyBn: "এই কথোপকথনটি এখন আপনার হাতে, তাই নোভা উত্তরটি খসড়া হিসেবে রেখেছে।",
        };
      }
      return { result: "allow" };
    }
    case "create_purchase_order": {
      const quantity = Number(payload.quantity ?? 0);
      const unitCost = Number(payload.unitCost ?? 0);
      const total = quantity * unitCost;
      if (total > guardrails.maxAutoPurchaseOrderTotal) {
        return {
          result: "needs_approval",
          why: `PO total ৳${total.toFixed(2)} exceeds the ৳${guardrails.maxAutoPurchaseOrderTotal} autonomous limit.`, rule: "max_auto_purchase_order_total",
        };
      }
      return { result: "allow" };
    }
    default:
      return { result: "allow" };
  }
}

/**
 * The platform superset, exposed to the Stage 1 authority seam.
 *
 * These six numeric caps predate the canonical guardrail trio and remain the
 * outermost bound a tenant cannot loosen past. `evaluateAuthority` calls this
 * LAST, inside itself — deliberately not as a second gate running alongside,
 * which is how two gates drift into disagreeing about the same action.
 */
export async function checkGuardrailsForAuthority(
  client: StoreClient,
  guardrails: Guardrails,
  type: ActionType,
  payload: Record<string, unknown>,
): Promise<GuardrailCheck> {
  return checkGuardrails(client, guardrails, type, payload);
}

/**
 * Decide what happens to an action under the current autonomy config.
 *
 * @deprecated Stage 1 replaced this with `evaluateAuthority` in `authority.ts`,
 * which judges level × mode × guardrails × no-touch × founder-only verb × duty
 * in one place and names the rule that fired. Kept while the older callers and
 * the demo-backend path migrate; do not add new callers.
 */
export async function gateAction(
  client: StoreClient,
  config: AutonomyConfig,
  type: ActionType,
  payload: Record<string, unknown>,
): Promise<GateDecision> {
  const riskClass = RISK_CLASS[type];
  const guardrail = await checkGuardrails(client, config.guardrails, type, payload);

  if (guardrail.result === "block") {
    return { verdict: "block", riskClass, explanation: guardrail.why };
  }

  if (config.level === 0) {
    return {
      verdict: "block",
      riskClass,
      explanation:
        "Autonomy level 0 (observation only): Nova reports and recommends but takes no actions. Raise the autonomy level to enable actions.",
    };
  }

  if (guardrail.result === "needs_approval") {
    return {
      verdict: "prepare",
      riskClass,
      explanation: `${guardrail.why} Prepared for owner approval.`,
    };
  }

  const autoExecute =
    (config.level === 3 && riskClass === "low") || config.level === 4;

  if (autoExecute) {
    return {
      verdict: "execute",
      riskClass,
      explanation: `Within autonomy level ${config.level} and all guardrails.`,
    };
  }

  return {
    verdict: "prepare",
    riskClass,
    explanation: `Autonomy level ${config.level} requires owner approval for ${riskClass}-risk actions.`,
  };
}
