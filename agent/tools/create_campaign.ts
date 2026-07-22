import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { performAction } from "../lib/nova/actions";
import { createCampaignPayload, receiptSchema } from "../lib/nova/schemas";
import { usd } from "../lib/nova/format";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

export default defineTool({
  description:
    "Create a new ad or lifecycle campaign (meta, google, tiktok, email, sms) with a daily budget and target products — launched active or created as scheduled. Include the strategy (audience, angle, creative direction) in notes. Autonomy-gated: returns status executed, prepared (awaiting owner approval), or blocked.",
  inputSchema: createCampaignPayload.extend({
    receipt: receiptSchema,
    department: z
      .enum(NOVA_DEPARTMENTS)
      .optional()
      .describe("Attribution for the activity log; defaults to marketing."),
  }),
  async execute({ receipt, department, ...payload }, ctx) {
    // Validate product references so the owner-facing title reads correctly.
    const client = storeFor(requireStore(ctx).storeId);
    const firstProduct = payload.productIds[0]
      ? await client.getProduct(payload.productIds[0])
      : null;
    const focus = firstProduct
      ? ` for "${firstProduct.name}"${payload.productIds.length > 1 ? ` +${payload.productIds.length - 1} more` : ""}`
      : "";
    const title = `${payload.startNow ? "Launch" : "Schedule"} "${payload.name}" on ${payload.channel} at ${usd(payload.dailyBudget)}/day${focus}`;
    return performAction(client, {
      type: "create_campaign",
      department: department ?? "marketing",
      title,
      payload,
      receipt,
    });
  },
});
