import { defineTool } from "eve/tools";
import { scopedConversationId } from "../lib/nova/inboxIntents";
import { performAction } from "../lib/nova/actions";
import { receiptSchema, verifyPaymentSlipPayload } from "../lib/nova/schemas";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

/**
 * File what the customer CLAIMED about a payment — the `verify_payment_slip`
 * verb. Read the name honestly: it verifies nothing, and it must never be made
 * to look as though it did.
 *
 * A CUSTOMER-PLANE tool (no `requireFounderSession` — see the note in
 * `create_order_from_chat.ts`): a bKash screenshot arrives in the thread, often
 * as an attachment with no text at all, and the person who sent it is standing
 * there waiting to be told it landed somewhere.
 *
 * ── NOTHING IN THIS SYSTEM CAN READ A PAYMENT SLIP. ───────────────────────
 * Dakio has no payment-gateway API and Meta attachments are lossy. So this
 * writes no store record: `Order.paid` is untouched, no status advances, and no
 * money moves. The NovaAction row it lands on — the payload, the receipt and
 * the customer's own words — IS the filed claim, and the owner matching it
 * against a real statement is the only verification there is.
 *
 * ── ALWAYS A DRAFT, IN BOTH REPOS, AND `riskClass` IS NOT WHAT DOES IT. ───
 * `verdictForLevel` returns `execute` for EVERY risk class at level 4, and
 * level 4 is genuinely reachable — `novaTrust` promotes `earnedLevel` on a good
 * record. `high` therefore does NOT mean "always asks", whatever the module doc
 * says. `ALWAYS_DRAFT` in `nova/authority.ts` is the mechanism, and dakio-api's
 * mirror in `novaAuthority.js` is the layer that 403s an always-draft verb
 * recorded as executed. A store that auto-"verified" a payment would be telling
 * a customer their money arrived on the strength of a picture, and in a COD
 * market the correction lands at a doorstep with a courier holding a parcel
 * nobody will pay for.
 *
 * ── WHAT TO SAY WHILE IT IS WITH THE OWNER. ──────────────────────────────
 * "Peyechi, check kore janachchi" is true — the claim was received and is being
 * checked. "Payment confirm hoye geche" is not, and it is not yours to say
 * until a tool result says so.
 */
export default defineTool({
  description:
    "Record a payment the customer says they have made — a bKash/Nagad/Rocket/bank transfer, a screenshot, a transaction id. THIS VERIFIES NOTHING: the shop cannot read a screenshot, so what you are doing is putting their claim in front of the owner with the evidence attached, and the owner checks it against a real statement. Always. Copy the transaction id exactly as they typed it — never correct, pad or re-case it, because the owner matches that string by eye. Give their own words in customerStatement, not your summary of them, and omit the order id rather than guess: a claim filed against the wrong order is worse than an unmatched one. Then tell them it has been received and is being checked, and never that the payment is confirmed.",
  inputSchema: verifyPaymentSlipPayload.extend({
    receipt: receiptSchema,
  }),
  async execute({ receipt, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    // A customer session may only file a claim about its own thread. The
    // evidence here is one person's assertion about their own money; attaching
    // it to another conversation would put a stranger's transaction id in front
    // of the owner under someone else's name.
    scopedConversationId(ctx, payload.conversationId);

    return performAction(client, {
      type: "verify_payment_slip",
      // Finance, matching `DEPARTMENT_BY_INTENT.payment_claim` — a constant
      // rather than a lookup, for the same reason the other two selling verbs
      // use one: whose desk this lands on is a fact about the work, not about
      // whatever the thread was discussing a turn ago.
      department: "finance",
      // The card's title must not read as a confirmed receipt. It says CLAIM,
      // names the method, and carries the amount only as something asserted.
      title:
        `Payment CLAIM to check: ${payload.method}` +
        (payload.claimedAmount != null ? `, customer says ৳${payload.claimedAmount}` : "") +
        (payload.orderId ? ` — order ${payload.orderId}` : " — no order matched"),
      payload,
      receipt,
      // Rides `support.inbox_replies` rather than inventing a duty, exactly as
      // module 04's `schedule_follow_up` does. Module 05 registered three duties
      // and all three are `sales.*`; a payment claim is none of them, and
      // `finance.cod_reconciliation` is a back-office Accounts duty at minLevel
      // 3 — pausing "COD reconciliation" must not silently stop Nova filing a
      // customer's claim in the inbox. The founder's pause switch for inbox work
      // is `support.inbox_replies`, and this rides it. An off-roster `dutyRef`
      // is not a soft failure: it is `duty:unknown` → refuse plus an escalation,
      // 100% of the time, at every tier.
      dutyRef: "support.inbox_replies",
    });
  },
});
