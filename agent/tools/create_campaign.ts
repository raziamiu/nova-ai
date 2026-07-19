import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { performAction } from "../lib/nova/actions";
import { createCampaignPayload, justificationSchema } from "../lib/nova/schemas";
import { usd } from "../lib/nova/format";
import { getStoreClient } from "../lib/store/client";

export default defineTool({
  description:
    "Create a new ad or lifecycle campaign (meta, google, tiktok, email, sms) with a daily budget and target products — launched active or created as scheduled. Include the strategy (audience, angle, creative direction) in notes. Autonomy-gated: returns status executed, prepared (awaiting owner approval), or blocked.",
  inputSchema: createCampaignPayload.extend({
    justification: justificationSchema,
    department: z
      .enum(NOVA_DEPARTMENTS)
      .optional()
      .describe("Attribution for the activity log; defaults to marketing."),
  }),
  async execute({ justification, department, ...payload }) {
    // Validate product references so the owner-facing title reads correctly.
    const client = getStoreClient();
    const firstProduct = payload.productIds[0]
      ? client.getProduct(payload.productIds[0])
      : null;
    const focus = firstProduct
      ? ` for "${firstProduct.name}"${payload.productIds.length > 1 ? ` +${payload.productIds.length - 1} more` : ""}`
      : "";
    const title = `${payload.startNow ? "Launch" : "Schedule"} "${payload.name}" on ${payload.channel} at ${usd(payload.dailyBudget)}/day${focus}`;
    return performAction({
      type: "create_campaign",
      department: department ?? "marketing",
      title,
      payload,
      justification,
    });
  },
});
