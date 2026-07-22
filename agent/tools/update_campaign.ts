import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { performAction } from "../lib/nova/actions";
import { receiptSchema, updateCampaignPayload } from "../lib/nova/schemas";
import { money } from "../lib/nova/format";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

export default defineTool({
  description:
    "Pause/resume a campaign, change its daily budget, or append a note. Check get_campaigns performance (ROAS, CPA, trend) first and justify the change with that data. Autonomy-gated: returns status executed, prepared (awaiting owner approval), or blocked.",
  inputSchema: updateCampaignPayload.extend({
    receipt: receiptSchema,
    department: z
      .enum(NOVA_DEPARTMENTS)
      .optional()
      .describe("Attribution for the activity log; defaults to marketing."),
  }),
  async execute({ receipt, department, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    const campaign = await client.getCampaign(payload.campaignId);
    const name = campaign?.name ?? payload.campaignId;
    const verb =
      payload.status === "paused" ? "Pause" : payload.status === "active" ? "Resume" : null;
    const title =
      verb && payload.dailyBudget !== undefined
        ? `${verb} "${name}" and set budget to ${money(payload.dailyBudget)}/day`
        : verb
          ? `${verb} "${name}"`
          : payload.dailyBudget !== undefined
            ? `Set "${name}" budget to ${money(payload.dailyBudget)}/day`
            : `Update campaign "${name}"`;
    return performAction(client, {
      type: "update_campaign",
      department: department ?? "marketing",
      title,
      payload,
      receipt,
    });
  },
});
