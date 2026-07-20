import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { runAttribution } from "../lib/memory/attribution";

export default defineTool({
  description:
    "Rewrite cart-recovery activity whose revenue influence is still a heuristic estimate to the real order total, for any cart that has since measurably recovered. Reflection runs this nightly; call it on demand when the owner asks how recovery is actually performing.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const result = await runAttribution(requireStore(ctx).storeId);
    return {
      updated: result.updated.length,
      measuredRevenue: result.measuredRevenue,
      details: result.updated,
    };
  },
});
