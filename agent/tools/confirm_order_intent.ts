import { defineTool } from "eve/tools";
import { scopedConversationId } from "../lib/nova/inboxIntents";
import { performAction } from "../lib/nova/actions";
import { confirmOrderIntentPayload, receiptSchema } from "../lib/nova/schemas";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

/**
 * Record that a human said yes before the parcel goes on the road — the
 * `confirm_order_intent` verb.
 *
 * ── WHAT THIS IS WORTH IN BD COD ──────────────────────────────────────────
 * Almost every order here is cash on delivery, so an unconfirmed parcel is the
 * shop fronting the delivery charge on a maybe. A pre-dispatch confirmation is
 * the single cheapest thing that moves RTO, and it only works if it happens in
 * the thread where the customer already is, in the minute they are reading —
 * not in a callback queue somebody works through tomorrow.
 *
 * ── `confirmedText` IS EVIDENCE, NOT A SUMMARY ────────────────────────────
 * The schema demands the customer's OWN confirming message, verbatim. This is
 * the record that a person agreed, and it is what a founder reads when a
 * customer later refuses the parcel at the door. A paraphrase would make the
 * evidence Nova's word rather than theirs. An emoji is not a yes, and a message
 * you are still waiting for is not a yes — do not call this ahead of one.
 *
 * ── LOW RISK, BECAUSE IT SPENDS NOTHING ───────────────────────────────────
 * `RISK_CLASS: low`. It stamps a flag on an order that already exists; it does
 * not create, price, cancel or ship anything. The thing it protects against is
 * the opposite failure — a parcel dispatched on silence.
 */
export default defineTool({
  description:
    "Record that the customer has confirmed their order, before it is handed to a courier. Cash-on-delivery is the norm here, so a parcel sent on silence is the shop paying delivery on a guess — ask for a clear yes and stamp it the moment you get one. Pass their confirming message exactly as they wrote it: 'ji', 'হ্যাঁ', 'ok den'. Never paraphrase it, never read an emoji or a thumbs-up as agreement, and never call this in anticipation of a yes you have not received yet. If they go quiet, that is not a confirmation — leave it unconfirmed and let the follow-up do its work.",
  inputSchema: confirmOrderIntentPayload.extend({
    receipt: receiptSchema,
  }),
  async execute({ receipt, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    // The evidence must come from the thread it claims to come from: a
    // confirmation scoped to someone else's conversation is a yes attributed to
    // a person who never gave one, on a COD parcel they will refuse.
    scopedConversationId(ctx, payload.conversationId);

    return performAction(client, {
      type: "confirm_order_intent",
      department: "shipping",
      title: "Customer confirmed their order before dispatch",
      payload,
      receipt,
      dutyRef: "shipping.predispatch_confirms",
    });
  },
});
