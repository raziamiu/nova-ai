import { defineTool } from "eve/tools";
import { scopedConversationId } from "../lib/nova/inboxIntents";
import { performAction } from "../lib/nova/actions";
import { cancelOrderPayload, receiptSchema } from "../lib/nova/schemas";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

/**
 * Let a customer call off an order in the thread they placed it in — the
 * `cancel_order_from_chat` verb.
 *
 * ── WHY A SHOP WANTS THIS OPEN RATHER THAN CLOSED ─────────────────────────
 * The alternative to cancelling in chat is not "the sale survives". It is a
 * parcel that goes out, gets refused at the door, and comes back as an RTO the
 * shop pays both legs on. A customer who says "lagbe na" and is ignored has
 * already cancelled; the only question is whether the shop finds out now or
 * after paying the courier. Cancelling early is the cheaper outcome, and the
 * one that leaves them willing to come back.
 *
 * ── BUT SAVE THE SALE FIRST, ONCE ─────────────────────────────────────────
 * `inbox.cancelAuto` ships FALSE, so this reaches a human at every tier until a
 * founder opens it. Before reaching for it at all: ask once, warmly, what
 * changed. A cancellation driven by a fixable thing — the wrong size, a
 * delivery charge they did not expect, a date they thought was sooner — is a
 * different conversation from one where they simply changed their mind. One
 * ask, not two; pressing a second time is how a cancelled order becomes a
 * blocked page.
 *
 * ── REVERSIBLE, AND THE ONLY MODULE-06 VERB THAT IS ───────────────────────
 * `undoers` carries `cancel_order_from_chat` (via the `uncancel_chat_order`
 * kind), so a mistaken cancellation inside the 24h window can be rolled back.
 * That is not licence to be casual with it: the customer has already been told.
 */
export default defineTool({
  description:
    "Cancel an order the customer no longer wants, in the thread they placed it in. Ask once — warmly, and only once — what changed, because a cancellation caused by a delivery charge they did not expect or a size they picked wrong is a fixable thing, and a second ask turns a cancelled order into a blocked page. If they still want it off, do it here rather than letting a cash-on-delivery parcel go out to be refused at the door: that costs the shop both legs of the courier bill and costs you the customer. Record the reason in their own words — it is the only record of why a sale went away, and the owner reads it. Confirm it plainly once it is done, and do not try to sell them something else in the same breath.",
  inputSchema: cancelOrderPayload.extend({
    receipt: receiptSchema,
  }),
  async execute({ receipt, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    // A cancellation scoped to another thread destroys a stranger's order on
    // the word of someone who never placed it.
    scopedConversationId(ctx, payload.conversationId);

    return performAction(client, {
      type: "cancel_order_from_chat",
      // Sales, not shipping: unwinding a sale is the same room's work as making
      // one, and a founder who paused chat orders would rightly expect chat
      // cancellations to be paused with them.
      department: "sales",
      title: `Cancel an order — ${payload.reason}`,
      payload,
      receipt,
      dutyRef: "sales.inbox_orders",
    });
  },
});
