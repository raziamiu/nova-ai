import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { performAction } from "../lib/nova/actions";
import { justificationSchema, sendCustomerMessagePayload } from "../lib/nova/schemas";
import { getStoreClient } from "../lib/store/client";

export default defineTool({
  description:
    "Send one customer a message (email, sms, or chat) for cart recovery, support/sales replies, upsell, winback, or order updates. Write in the brand voice; never spammy. A sent message cannot be undone. Autonomy-gated: returns status executed, prepared (awaiting owner approval), or blocked.",
  inputSchema: sendCustomerMessagePayload.extend({
    justification: justificationSchema,
    department: z
      .enum(NOVA_DEPARTMENTS)
      .optional()
      .describe("Attribution for the activity log; defaults to sales."),
  }),
  async execute({ justification, department, ...payload }) {
    const client = getStoreClient();
    const customer = await client.getCustomer(payload.customerId);
    const purposeLabel = payload.purpose.split("_").join(" ");
    const title = `Send ${purposeLabel} ${payload.channel} to ${customer?.name ?? payload.customerId}`;
    return performAction({
      type: "send_customer_message",
      department: department ?? "sales",
      title,
      payload,
      justification,
    });
  },
});
