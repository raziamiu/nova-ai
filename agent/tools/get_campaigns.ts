import { defineTool } from "eve/tools";
import { z } from "zod";
import { getStoreClient } from "../lib/store/client";
import { computeCampaignMetrics } from "../lib/nova/analytics";

export default defineTool({
  description:
    "List ad/marketing campaigns with computed 7-day performance: spend, revenue, conversions, ROAS, CPA (7d, 3d, prior-7d trend), and CTR. Filter by status (active, paused, scheduled, completed). Use before any budget, pause, or scaling decision. Returns { count, campaigns } (max 50).",
  inputSchema: z.object({
    status: z
      .enum(["active", "paused", "scheduled", "completed"])
      .optional()
      .describe("Only campaigns with this status"),
  }),
  async execute(input) {
    const client = getStoreClient();
    const campaigns = client.listCampaigns(input.status);
    return {
      count: campaigns.length,
      campaigns: campaigns.slice(0, 50).map((c) => ({
        ...computeCampaignMetrics(c),
        productIds: c.productIds,
        notes: c.notes,
      })),
    };
  },
});
