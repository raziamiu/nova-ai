import { defineTool } from "eve/tools";
import { scopedConversationId } from "../lib/nova/inboxIntents";
import { performAction } from "../lib/nova/actions";
import { escalateConversationPayload, receiptSchema } from "../lib/nova/schemas";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

/**
 * Hand the conversation to the founder — the `escalate_conversation` verb.
 *
 * Never gated at any tier (`NEVER_GATED` in `authority.ts`): asking for a human
 * has to work at the lowest autonomy setting, or the safest thing Nova can do
 * becomes the slowest. Escalating sends nothing Nova wrote — the customer gets
 * a deterministic holding line — and it hands authority away rather than
 * taking any.
 *
 * The route is REAL as of module 02 (`POST /conversations/:id/handover`,
 * dakio-api `routes/novaInbox.js`): it stamps `escalatedAt`, sets
 * `handledBy:'founder'` and genuinely locks Nova out — every later `/reply` on
 * that thread comes back LOCKED, and this module ships no release path. Do not
 * add a second handover write path; two voices in one conversation is the
 * failure the ADVISORY carve-out exists to prevent.
 *
 * What module 08 still owns is the trigger taxonomy behind `reason`, the
 * priority-1 Decision (the route reports `decisionId:null` today) and the
 * deterministic holding line (`holdingSent:false`). The route reports both
 * honestly, and the executor's outcome string only claims the customer was
 * told something when `holdingSent` says so.
 */
export default defineTool({
  description:
    "Hand this conversation to the owner and stop replying on it. Use it when the customer asks for a human, is angry after one real apology, disputes a payment, threatens legal action, pushes past what you may offer, or when you genuinely don't know and a second guess would be worse than a handover. Write the brief so the owner can act without re-reading the thread: what happened, what you already checked, and what you'd do. After escalating, stay silent on this thread until it comes back to you.",
  inputSchema: escalateConversationPayload.extend({
    receipt: receiptSchema,
  }),
  async execute({ receipt, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    scopedConversationId(ctx, payload.conversationId);

    return performAction(client, {
      type: "escalate_conversation",
      // The tool's own parameter here, not the intent map: an escalation is
      // routed by who should PICK IT UP, which is not always the department
      // the conversation started in.
      department: payload.department,
      title: `Hand a customer conversation to you (${payload.reason})`,
      payload,
      receipt,
      dutyRef: "support.inbox_escalations",
    });
  },
});
