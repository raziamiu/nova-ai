import { defineTool } from "eve/tools";
import { scopedConversationId } from "../lib/nova/inboxIntents";
import { performAction } from "../lib/nova/actions";
import { linkCustomerPayload, receiptSchema } from "../lib/nova/schemas";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

/**
 * Join this thread to a customer record — the `link_customer_identity` verb.
 *
 * A CUSTOMER-PLANE tool, so it deliberately does NOT open with
 * `requireFounderSession`: the whole point is that the person in the thread can
 * say "amar number 01712…" and be recognised on the next turn. It is the fifth
 * member of `CUSTOMER_SLIM_TOOLS` (module 03 D-38 — the tool file, the slim set
 * and the removal of its `SLIM_TOOLS_PENDING` line land in ONE change, or three
 * evals go red on the file's mere existence).
 *
 * The SERVER decides the link, and that is the whole safety argument. The model
 * hands over an assertion — a number the customer stated as their own, or the
 * 2–4 digits they just recited — and dakio-api normalizes, variant-matches and
 * answers. The model never names a customerId to link TO, because a model that
 * could name one is a model that can be talked into naming someone else's, and
 * a wrong link leaks a stranger's order history (D2: ambiguity always resolves
 * to "unknown customer"). `matched:false` is therefore an ANSWER, not a fault:
 * zero matches parks the number as `claimedPhone` until an order creates the
 * record, and a multi-match leaves the thread UNLINKED and puts a merge
 * Decision in front of the founder.
 *
 * Never gated at any tier (`NEVER_GATED` in `authority.ts`, alongside
 * `escalate_conversation`): the check returns before the level ceiling AND
 * before `checkGuardrailsForAuthority`, so this verb runs at T0 Shadow too.
 * That is safe only because of the paragraph above — it writes a join, touches
 * no customer data, and the undoer reverses it. What it does NOT bypass is the
 * duty ladder: a founder who pauses `support.inbox_replies` pauses this too.
 */
export default defineTool({
  description:
    "Link this conversation to the shop's customer record, so you can see their order history and they stop being a stranger every time they write. Two ways in: pass `phone` when the customer states a number AS THEIR OWN, first person (never a number they gave about someone else, never one you guessed); or pass `verify` with the last 2–4 digits they just told you when the thread already has a proposed match. THE SERVER DECIDES — it normalizes the number, matches it and answers; you never see a full phone number and never choose which customer to link to. 'No match' is a real answer, not a failure: the number is held for later and the thread stays honestly unlinked. Never gate service on this — an unlinked customer still gets prices, stock and a COD order.",
  inputSchema: linkCustomerPayload.extend({
    receipt: receiptSchema,
  }),
  async execute({ receipt, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    scopedConversationId(ctx, payload.conversationId);

    return performAction(client, {
      type: "link_customer_identity",
      // Identity bookkeeping belongs to the room that holds the thread, not to
      // whatever the conversation happens to be about this turn — so this is a
      // constant, unlike `reply_in_thread`'s intent lookup.
      department: "support",
      // The title lands in the ledger and on the founder's card, so it says
      // WHICH rung of the ladder fired and nothing else. No phone fragment: a
      // masked number is still a number in a row nobody meant to store one in.
      title: `Link this conversation to a customer record (${payload.phone ? "number stated by the customer" : "digit check"})`,
      payload,
      receipt,
      dutyRef: "support.inbox_replies",
    });
  },
});
