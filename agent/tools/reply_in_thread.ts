import { defineTool } from "eve/tools";
import { DEPARTMENT_BY_INTENT, scopedConversationId } from "../lib/nova/inboxIntents";
import { performAction } from "../lib/nova/actions";
import { receiptSchema, sendInboxReplyPayload } from "../lib/nova/schemas";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

/**
 * Reply to the customer — the `send_inbox_reply` verb.
 *
 * The model never sends. Writing text in a turn puts nothing in front of
 * anyone: a customer sees a byte only because this action passed
 * `evaluateAuthority` and dakio-api's executor performed the Meta send. In
 * assisted mode every call lands as a prepared draft plus a Decision card, and
 * the founder's tap is what sends it — shadow mode is the same code path, not
 * a special build.
 *
 * The department is NOT a parameter. It is looked up from the intent through
 * `DEPARTMENT_BY_INTENT`, so which room a reply is attributed to is a fact
 * about the conversation, not something the model can choose per message.
 *
 * Module 03 D7 adds `promise` to the payload, and the description below has to
 * carry rule 16's contract or the field is decorative. Extraction is
 * SELF-DECLARED at send time, never mined afterwards: the model that just wrote
 * "kal janabo" is the only thing that knows whether it meant a commitment, and
 * a regex over outbound copy would both miss real debts and invent fake ones.
 * dakio-api writes the NovaPromise row in the same transaction as the outbound
 * and deletes it if that send is ever canceled — an unsent promise was never
 * made — so a declared promise costs nothing when the send doesn't happen, and
 * an undeclared one is a debt with no ledger row and no sweep to catch it.
 */
export default defineTool({
  description:
    "Send your reply to the customer, as 1–3 short chat bubbles. This is the only way anything reaches them — text you merely write in your turn is never delivered. Autonomy-gated: returns executed (queued to send), prepared (waiting for the owner's approval), or blocked. A sent message cannot be unsent, and a refusal (the owner took the thread, the customer wrote again, the 24h window closed) is a real answer — read it and act on it, never retry blindly. If this reply commits to a future action or answer — 'check kore janachchi', 'kal janabo', 'stock asle inform korbo', 'I'll confirm by tomorrow' — you MUST fill `promise` with a dueAt you can actually meet; that is what puts the debt on the shop's books and brings the follow-up back to you. If you have no tool path to the answer, do not name a time at all: promise the action ('khoj nichchi'), or hand the thread over. When this reply DELIVERS an answer you already owed, set `promiseId` to that promise's id from the 360 block's promises list — that is the only thing that marks a debt paid; answering without it leaves the promise open until it is swept broken.",
  inputSchema: sendInboxReplyPayload.extend({
    receipt: receiptSchema,
  }),
  async execute({ receipt, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    // A customer session may only write in its own thread.
    scopedConversationId(ctx, payload.conversationId);

    const preview = payload.chunks[0]?.text ?? "";
    const title = `Reply to customer (${payload.intent}${payload.purpose ? `, ${payload.purpose}` : ""}): ${
      preview.length > 60 ? `${preview.slice(0, 57)}…` : preview
    }`;
    return performAction(client, {
      type: "send_inbox_reply",
      department: DEPARTMENT_BY_INTENT[payload.intent],
      title,
      payload,
      receipt,
      dutyRef: "support.inbox_replies",
    });
  },
});
