import { defineTool } from "eve/tools";
import { scopedConversationId } from "../lib/nova/inboxIntents";
import { performAction } from "../lib/nova/actions";
import { createOrderFromChatPayload, receiptSchema } from "../lib/nova/schemas";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

/**
 * Take the order the customer just agreed to — the `create_order_from_chat` verb.
 *
 * A CUSTOMER-PLANE tool, so like `link_customer` and `schedule_follow_up` it
 * deliberately does NOT open with `requireFounderSession`: closing a sale is the
 * one thing this conversation exists for, and a tool that refused the customer
 * plane would be unreachable from the only thread it belongs in. It joins
 * `CUSTOMER_SLIM_TOOLS` in the same change as this file, or three evals go red
 * on the file's mere existence (the registry walk, the `SLIM_TOOLS_PENDING`
 * check, and the per-file execution against a customer principal).
 *
 * DO NOT MODEL THIS ON `send_customer_message.ts`. That is a FOUNDER-plane tool
 * whose `execute` opens with `requireFounderSession(ctx)`; copying its shape
 * makes every call from a real customer turn throw `CustomerToolDenied`.
 *
 * ── THE SERVER PRICES IT, AND THAT IS THE WHOLE SAFETY ARGUMENT. ───────────
 * The payload carries no `discount`, no `paid`, no `unitPrice` and no `total`.
 * Nova names products, quantities and where the parcel goes; dakio-api prices
 * every line from the catalogue, refuses anything more than ±1 taka off the
 * listed price, resolves the delivery charge from the district, re-validates
 * any coupon, and decrements stock inside the same transaction. The merchant
 * order route accepts a raw client `discount` that flows unvalidated into the
 * total — that is exactly the lever this payload exists not to hand a model.
 *
 * ── WHAT IS NOT ACCEPTED, AND WHY IT MATTERS MOST. ────────────────────────
 * `confirmedByCustomer` is `z.literal(true)`. There is no false value: the
 * schema is unsatisfiable without it, so the tool cannot be called except as an
 * assertion that the customer was read the itemized total and said yes in their
 * own words. A COD parcel nobody agreed to is refused at the door and the shop
 * pays the return, which is why this is a schema constraint rather than a rule
 * in a prompt.
 *
 * ── WHAT HAPPENS TODAY. ───────────────────────────────────────────────────
 * `inbox.orderAuto` ships FALSE and `tierMoveDecision` refuses every upward
 * move to T2/T3 until module 11, so EVERY chat order becomes a Decision the
 * owner approves (FD-3). That is not a limitation to apologize for in the
 * thread: the customer is told the order is going in, and it does — after the
 * shop's own confirmation, exactly as it would in a shop where the owner is at
 * the counter.
 */
export default defineTool({
  description:
    "Place the COD order the customer has just confirmed. Call this ONLY after you have read back the items, the quantities, the delivery charge and the total in one bubble and they answered with an explicit yes — 'হ্যাঁ', 'ji', 'ok den'. An emoji, silence or 'hmm' is not a yes. You never send a price: the shop prices every line itself, works out the delivery charge from the district, checks any coupon and reserves the stock. Give it the product ids from your product read (never a name you matched yourself), the size or colour the customer picked, and the name, number, district, thana/upazila and address exactly as they typed them. If the order cannot be placed — out of stock, a coupon that does not hold — you are told why: say so plainly and never claim an order exists that does not.",
  inputSchema: createOrderFromChatPayload.extend({
    receipt: receiptSchema,
  }),
  async execute({ receipt, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    // A customer session may only sell into its own thread. The parcel's
    // address comes from this conversation, so a cross-thread order would ship
    // one person's goods to another person's door.
    scopedConversationId(ctx, payload.conversationId);

    const units = payload.items.reduce((sum, item) => sum + item.qty, 0);
    return performAction(client, {
      type: "create_order_from_chat",
      // A constant, like `link_customer`'s. Selling is the sales room's work
      // whatever the thread happened to be about a turn ago, and the intent
      // lookup `reply_in_thread` uses would route a COD confirmation into
      // shipping on the strength of the last question asked.
      department: "sales",
      // The founder reads this on the Decision card, and it says WHAT and WHERE
      // — the two things that decide whether they approve. No phone and no
      // street line: the title outlives the card, and the 360 masks a number
      // everywhere else precisely so it does not end up in a row like this one.
      title: `Chat order: ${units} item${units === 1 ? "" : "s"} to ${payload.customerCity}, ${payload.customerDistrict}`,
      payload,
      receipt,
      dutyRef: "sales.inbox_orders",
    });
  },
});
