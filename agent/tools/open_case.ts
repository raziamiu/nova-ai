import { defineTool } from "eve/tools";
import { scopedConversationId } from "../lib/nova/inboxIntents";
import { performAction } from "../lib/nova/actions";
import { openCasePayload, receiptSchema, DEPARTMENT_BY_CASE_KIND } from "../lib/nova/schemas";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

/**
 * Book a problem onto a room's desk — the `open_case` verb.
 *
 * ── WHY THIS FILE EXISTS AT ALL ───────────────────────────────────────────
 * Module 06 built the whole case system — the Prisma model, the create-or-join
 * upsert, the four handlers, the executor on both sides, the guardrails, an
 * eval suite — and never built this tool. Nothing else mints an `open_case`
 * action row either, so the founder-approve path had no producer to approve
 * from. The result was a subsystem that could not be entered: zero cases, of
 * any kind, could be created in production, while 1852 server tests stayed
 * green because they called the route directly. This is the missing first link.
 *
 * ── A CUSTOMER-PLANE TOOL, AND WHY IT HAS TO BE ───────────────────────────
 * No `requireFounderSession`. A case is opened at the moment a customer says
 * the thing that reveals the problem — "parcel ta 6 din dhore ekhane", "box
 * kheye gechilo" — and a case that had to leave the thread to be opened is a
 * case nobody opens. `damaged_item` makes this structural rather than a
 * convenience: the courier reports DELIVERED, so no server signal exists and
 * only the customer knows the thing arrived broken. There is no server-side
 * producer that could ever replace this call.
 *
 * ── THE MODEL DOES NOT CHOOSE THE ROOM ────────────────────────────────────
 * `kind` decides the department, server-side, from `DEPARTMENT_BY_KIND` in
 * dakio-api's `novaCase.js`. The mirror in `schemas.ts` is used here only to
 * route the founder's DECISION CARD to the same desk the case itself lands on
 * — a shipping case whose approval card sits in support is one the shipping
 * room never sees. Both copies are byte-identical on purpose and pinned by the
 * eval, the same convention `CASE_KINDS` already follows.
 *
 * ── OPENING TWICE IS NOT AN ERROR ─────────────────────────────────────────
 * The server upserts on an active key (order > product > conversation), so a
 * second person asking about the SAME parcel JOINS the open case instead of
 * booking a duplicate card. `joined` in the outcome is exact — it is derived
 * from a client-supplied id, not from a racy pre-read — so say "kaj cholche"
 * on a join and never announce a fresh case that is actually somebody else's,
 * already three facts deep.
 *
 * Facts are APPEND-ONLY and get quoted back to the customer. `factsNote` is not
 * a scratchpad: write what you would be content to have read out loud.
 */
export default defineTool({
  description:
    "Book a problem onto the room that owns it, so a human picks it up and every later question about the same thing gets one answer. Open one when a parcel has genuinely stopped moving, a delivery attempt failed, something arrived damaged or wrong, an address has to change after dispatch, a payment cannot be verified, or someone is waiting on a restock. Always pass orderId when there is an order: that is what makes the second person asking about the SAME parcel join this case instead of opening a duplicate. You do not choose which room gets it — the kind decides that. If the answer comes back saying you joined an existing case, say work is already under way and answer from the facts it carries; do not announce a new case. Write factsNote as what you know right now including the customer's own words, because it gets quoted back to them. Opening a case is not a promise about when it will be fixed — never attach a date to it.",
  inputSchema: openCasePayload.extend({
    receipt: receiptSchema,
  }),
  async execute({ receipt, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    // A customer session may only open a case on its own thread. Without this,
    // a crafted `conversationId` would attach this customer's complaint to a
    // stranger's case — and the facts written here are quoted back to whoever
    // asks next.
    scopedConversationId(ctx, payload.conversationId);

    return performAction(client, {
      type: "open_case",
      // Mirrors the server's own kind→room map so the card and the case agree.
      department: DEPARTMENT_BY_CASE_KIND[payload.kind],
      title: payload.title,
      payload,
      receipt,
      // Seeded by module 06 and never attached to anything until now. Door
      // Inbox, minLevel 2 — the same floor the reply and escalation duties sit
      // on, so a shop that can answer a customer can also record their problem.
      dutyRef: "shipping.delivery_cases",
    });
  },
});
