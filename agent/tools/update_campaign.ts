import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { performAction } from "../lib/nova/actions";
import { justificationSchema, updateCampaignPayload } from "../lib/nova/schemas";
import { usd } from "../lib/nova/format";
import { getStoreClient } from "../lib/store/client";

export default defineTool({
  description:
    "Pause/resume a campaign, change its daily budget, or append a note. Check get_campaigns performance (ROAS, CPA, trend) first and justify the change with that data. Autonomy-gated: returns status executed, prepared (awaiting owner approval), or blocked.",
  inputSchema: updateCampaignPayload.extend({
    justification: justificationSchema,
    department: z
      .enum(NOVA_DEPARTMENTS)
      .optional()
      .describe("Attribution for the activity log; defaults to marketing."),
  }),
  async execute({ justification, department, ...payload }) {
    const client = getStoreClient();
    const campaign = await client.getCampaign(payload.campaignId);
    const name = campaign?.name ?? payload.campaignId;
    const verb =
      payload.status === "paused" ? "Pause" : payload.status === "active" ? "Resume" : null;
    const title =
      verb && payload.dailyBudget !== undefined
        ? `${verb} "${name}" and set budget to ${usd(payload.dailyBudget)}/day`
        : verb
          ? `${verb} "${name}"`
          : payload.dailyBudget !== undefined
            ? `Set "${name}" budget to ${usd(payload.dailyBudget)}/day`
            : `Update campaign "${name}"`;
    return performAction({
      type: "update_campaign",
      department: department ?? "marketing",
      title,
      payload,
      justification,
    });
  },
});
