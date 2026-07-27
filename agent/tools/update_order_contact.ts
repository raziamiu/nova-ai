import { defineTool } from "eve/tools";
import { scopedConversationId } from "../lib/nova/inboxIntents";
import { performAction } from "../lib/nova/actions";
import { updateOrderContactFields, atLeastOneContactField, receiptSchema } from "../lib/nova/schemas";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

/**
 * Fix where a parcel is going — the `update_order_contact` verb.
 *
 * ── WHY THIS IS `medium` RISK AND GATED BY ITS OWN GUARDRAIL ──────────────
 * `inbox.addressEditAuto` ships FALSE, and that is deliberate rather than
 * cautious. The address is where a COD parcel physically goes. "Whoever is
 * typing in this thread" is not the same person as "whoever placed the order":
 * a thread can be a shared family account, a resold page, or an attacker who
 * has learned an order number. Redirecting a paid-on-delivery parcel is the
 * cheapest theft available on this platform, so it reaches a human first at
 * every tier until a founder deliberately opens it.
 *
 * ── CHANGING THE DISTRICT RE-PRICES THE ORDER ─────────────────────────────
 * Delivery charge is resolved from the district, not the city, so a district
 * edit changes what is due at the door. The server recomputes it; the model
 * must not quote a new total it worked out itself. Tell the customer the change
 * is being confirmed, and let the answer carry the number.
 *
 * ── PRE-DISPATCH ONLY, IN PRACTICE ────────────────────────────────────────
 * Once a parcel is with a courier none of the three we integrate can redirect
 * it — that is a case (`address_change_postdispatch`) and a phone call, not an
 * edit. The server enforces the boundary; do not promise a redirect on a parcel
 * that has already gone.
 */
export default defineTool({
  description:
    "Correct the delivery address, city, district or phone on an order the customer has already placed. Use it when they give you a corrected detail in the thread — a wrong flat number, a better landmark, a second number that actually rings. Changing the district changes what is due at the door, because delivery charge is worked out from it, so never quote a new total yourself: say the change is being confirmed and let the shop's own answer carry the figure. If the parcel is already with a courier, this is not an edit — no courier here can redirect a parcel in transit, so open a case and say plainly that somebody will try. Only change what they actually asked you to change.",
  // Built from the FIELDS, then re-refined: `updateOrderContactPayload` is a
  // `ZodEffects` (it carries the same `.refine`) and has no `.extend`. Dropping
  // the refinement here would let a no-op edit through the tool while the
  // executor still refused it — a refusal the customer would see as a failure.
  inputSchema: updateOrderContactFields
    .extend({ receipt: receiptSchema })
    .refine(atLeastOneContactField.check, { message: atLeastOneContactField.message }),
  async execute({ receipt, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    // The single most important line in this file. Without it, a crafted
    // `conversationId` lets one thread rewrite the destination of another
    // thread's COD parcel.
    scopedConversationId(ctx, payload.conversationId);

    const changed = [
      payload.address ? "address" : "",
      payload.city ? "city" : "",
      payload.district ? "district" : "",
      payload.phone ? "phone" : "",
    ].filter(Boolean);
    return performAction(client, {
      type: "update_order_contact",
      department: "shipping",
      // The card's headline says WHAT MOVED, not the new value: the founder
      // opens the card for the address itself, and a one-line summary that
      // carries a customer's home address travels into logs and lists nobody
      // re-audits. `create_order_from_chat`'s params line makes the same choice.
      title: `Change ${changed.join(" + ")} on an order`,
      payload,
      receipt,
      dutyRef: "shipping.delivery_cases",
    });
  },
});
