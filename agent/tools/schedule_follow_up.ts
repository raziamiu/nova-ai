import { defineTool } from "eve/tools";
import { DEPARTMENT_BY_INTENT, scopedConversationId } from "../lib/nova/inboxIntents";
import { performAction } from "../lib/nova/actions";
import { receiptSchema, scheduleFollowUpPayload } from "../lib/nova/schemas";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

/**
 * Come back to this thread later — the `schedule_follow_up` verb.
 *
 * A CUSTOMER-PLANE tool, so like `link_customer` it deliberately does NOT open
 * with `requireFounderSession`: deciding to check back is something that
 * happens mid-conversation, in the same turn as "achha, ami dekhe janai". It is
 * the sixth member of `CUSTOMER_SLIM_TOOLS` (module 04 D7 — the tool file, the
 * slim set and the removal of its `SLIM_TOOLS_PENDING` line land in ONE change,
 * or three evals go red on the file's mere existence).
 *
 * WHAT THIS BOOKS AND WHAT IT DOES NOT. It creates a `followup` NovaJob and
 * nothing else. No message is composed now, no message is queued now, and the
 * reply that eventually goes out is a separate `send_inbox_reply` through the
 * full gate, written against a FRESH view of the thread — because the world
 * moves between the promise and the knock, and a message written today and sent
 * in two days is how Nova ends up chasing a customer who already bought.
 *
 * The server owns everything that makes the commitment safe: it validates the
 * delay against the journey's stage, shifts `dueAt` out of the shop's quiet
 * hours, supersedes this conversation's existing nudge (one outstanding
 * commitment per thread), and refuses a chain past two unanswered follow-ups.
 * The ingest hook cancels the job outright the moment the customer writes back.
 *
 * NOT never-gated, unlike `link_customer` (module 04 OD-6, and a deliberate
 * divergence from the module doc — see the `NEVER_GATED` comment in
 * authority.ts). Linking ends where it starts; this ends with Nova speaking to
 * a customer at a time it chose, so the tier dial and the guardrails judge it
 * like any other verb. At T0 Shadow it drafts, which is correct: a store whose
 * whole promise is that Nova only watches must not accumulate commitments the
 * founder never saw.
 */
export default defineTool({
  description:
    "Book yourself a reminder to come back to this conversation later — when you have told the customer you would check something ('dekhe janai', 'stock ashle bolbo'), or when a thread is worth one more nudge and there is nothing useful to say right now. Nothing is sent now and nothing is written now: at the chosen time you get the thread back, re-read it, and decide THEN whether to say anything at all. Pick `delay` from the allowedDelays the conversation's NBA block gives you — you cannot invent a shorter one, because chasing someone within the hour is pressure, not service. One follow-up per conversation: booking a second replaces the first. If the customer writes back before it fires, it is cancelled automatically — they came back, so there is nothing left to chase.",
  inputSchema: scheduleFollowUpPayload.extend({
    receipt: receiptSchema,
  }),
  async execute({ receipt, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    // A customer session may only commit to its own thread.
    scopedConversationId(ctx, payload.conversationId);

    return performAction(client, {
      type: "schedule_follow_up",
      // Derived from the intent this follow-up PLANS to serve, exactly as
      // `reply_in_thread` derives it from the intent it is answering: which
      // room owns the work is a fact about the conversation, never a field the
      // model fills in.
      department: DEPARTMENT_BY_INTENT[payload.plannedIntent],
      // The founder reads this on a Decision card and on the commitments list,
      // so it says WHEN and WHY in that order — those are the two things that
      // decide whether they approve it. `reason` is Nova's own sentence, and it
      // carries no phone or address because the payload has none to carry.
      title: `Follow up on this conversation in ${payload.delay}: ${payload.reason}`,
      payload,
      receipt,
      // G-14: a single constant, like `link_customer`'s. There is no
      // `sales.inbox_cart_recovery` on the duty roster, and an off-roster
      // `dutyRef` fails closed at `duty:unknown` — a refusal plus an escalation,
      // 100% of the time, on every tier. The founder's pause switch for inbox
      // work is `support.inbox_replies`, and this rides it.
      dutyRef: "support.inbox_replies",
    });
  },
});
