import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { performAction } from "../lib/nova/actions";
import { justificationSchema, resolveTicketPayload } from "../lib/nova/schemas";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

export default defineTool({
  description:
    "Reply to a support ticket in the brand voice and set its new status: resolved, waiting_on_customer, or escalated (escalate anything Nova should not decide alone, e.g. large refunds). Autonomy-gated: returns status executed, prepared (awaiting owner approval), or blocked.",
  inputSchema: resolveTicketPayload.extend({
    justification: justificationSchema,
    department: z
      .enum(NOVA_DEPARTMENTS)
      .optional()
      .describe("Attribution for the activity log; defaults to support."),
  }),
  async execute({ justification, department, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    const ticket = await client.getSupportTicket(payload.ticketId);
    const subject = ticket?.subject ?? payload.ticketId;
    const title =
      payload.newStatus === "resolved"
        ? `Resolve ticket "${subject}"`
        : payload.newStatus === "escalated"
          ? `Escalate ticket "${subject}"`
          : `Reply to ticket "${subject}" (waiting on customer)`;
    return performAction(client, {
      type: "resolve_ticket",
      department: department ?? "support",
      title,
      payload,
      justification,
    });
  },
});
