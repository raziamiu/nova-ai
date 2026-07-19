import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { performAction } from "../lib/nova/actions";
import { createDiscountPayload, justificationSchema } from "../lib/nova/schemas";
import { getStoreClient } from "../lib/store/client";

export default defineTool({
  description:
    "Create a discount code — store-wide or product-scoped, optionally issued to a single customer (cart recovery, winback). Discounts above the maxDiscountPct guardrail are blocked outright. Autonomy-gated: returns status executed, prepared (awaiting owner approval), or blocked.",
  inputSchema: createDiscountPayload.extend({
    justification: justificationSchema,
    department: z
      .enum(NOVA_DEPARTMENTS)
      .optional()
      .describe("Attribution for the activity log; defaults to sales."),
  }),
  async execute({ justification, department, ...payload }) {
    const client = getStoreClient();
    const customer = payload.customerId ? client.getCustomer(payload.customerId) : null;
    const title = customer
      ? `Issue ${payload.percentOff}% code ${payload.code} to ${customer.name}`
      : `Create ${payload.percentOff}% discount code ${payload.code}`;
    return performAction({
      type: "create_discount",
      department: department ?? "sales",
      title,
      payload,
      justification,
    });
  },
});
