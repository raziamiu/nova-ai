import { defineTool } from "eve/tools";
import { scopedConversationId } from "../lib/nova/inboxIntents";
import { performAction } from "../lib/nova/actions";
import { offerChatDiscountPayload, receiptSchema } from "../lib/nova/schemas";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

/**
 * Answer a haggle with a bounded, expiring coupon — the `offer_chat_discount`
 * verb.
 *
 * A CUSTOMER-PLANE tool (no `requireFounderSession` — see the note in
 * `create_order_from_chat.ts`), because "ektu kom hoy na bhai?" arrives
 * mid-sentence and an offer that had to leave the thread to be made is an offer
 * the customer has already stopped waiting for.
 *
 * ── A DISCOUNT IS ALWAYS A COUPON, NEVER A PRICE. ─────────────────────────
 * `update_price` is a store-wide act with its own margin guardrail. Answering
 * one buyer's haggle by repricing the product silently discounts every other
 * customer buying it that day, and no receipt anywhere records that it was
 * meant for one person. So this mints a `Coupon` row with one use and a
 * deadline, and nothing else can be reached from here.
 *
 * ── WHY `free_delivery` CARRIES NO AMOUNT. ────────────────────────────────
 * The model is not told the shop's delivery table, and it must not be: a
 * guessed ৳60 on an outside-Dhaka parcel is a discount the shop did not agree
 * to, in the direction the shop pays for. The executor resolves the real figure
 * from the shop's own settings. It is also the arm to reach for first — in BD
 * DM commerce free delivery closes more carts than a percentage and costs the
 * least margin.
 *
 * ── THE FREQUENCY GUARD NEEDS A NAME TO MATCH ON. ─────────────────────────
 * `Coupon` has NO `customerId` column, so the only record of who a Nova coupon
 * went to lives in `NovaAction.payload`. Supply `customerId` whenever the 360
 * block has one: without it the once-per-N-days rule has nothing to match and
 * silently passes every time, which is worse than no rule because it reads as
 * enforced. The thread id is accepted as the fallback key, because a
 * conversation is a person even before the identity join has earned them a
 * Customer row.
 *
 * `inbox.discountAuto` ships FALSE, so every offer is a Decision the owner
 * approves today. Say the offer is being confirmed, never that it is already
 * theirs.
 */
export default defineTool({
  description:
    "Offer this customer a bounded discount when they are haggling and a small concession is what closes the sale. DECLINE FIRST — hold the price once, warmly and with a reason, before you offer anything; a shop that discounts on the first ask teaches every buyer to ask. When you do offer, reach for free delivery first: it closes carts and costs the least. Never reprice the product and never quote a number you worked out yourself — this issues a single-use coupon code with a deadline, and the shop's ceiling is enforced on the server, so an offer over it is refused rather than quietly trimmed. Pass customerId from the customer block whenever the thread is linked; without it the shop's once-per-customer rule cannot see this offer at all. Tell the customer the code and when it expires, and say the owner is confirming it rather than that it is already theirs.",
  inputSchema: offerChatDiscountPayload.extend({
    receipt: receiptSchema,
  }),
  async execute({ receipt, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    // A customer session may only negotiate in its own thread — a coupon minted
    // against someone else's conversation is a discount attributed to a person
    // who never asked for one, and the frequency guard would then match on them.
    scopedConversationId(ctx, payload.conversationId);

    const offer =
      payload.mechanism === "percent"
        ? `${payload.percentOff}% off`
        : payload.mechanism === "fixed"
          ? `৳${payload.amount} off`
          : "free delivery";
    return performAction(client, {
      type: "offer_chat_discount",
      // Constant, for the same reason the order verb's is: giving margin away
      // is sales work regardless of what the thread was about a turn ago.
      department: "sales",
      // WHAT is being given and WHY, in that order — the two things a founder
      // weighs on the card. `reason` is Nova's own sentence about this
      // negotiation, and the payload carries no phone for it to leak.
      title: `Chat discount: ${offer} — ${payload.reason}`,
      payload,
      receipt,
      dutyRef: "sales.inbox_discounts",
    });
  },
});
