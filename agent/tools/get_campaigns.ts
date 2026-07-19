import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";
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
  async execute(input, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    const campaigns = await client.listCampaigns(input.status);
    return {
      count: campaigns.length,
      campaigns: campaigns.slice(0, 50).map((c) => ({
        ...computeCampaignMetrics(client, c),
        productIds: c.productIds,
        notes: c.notes,
      })),
    };
  },
});
