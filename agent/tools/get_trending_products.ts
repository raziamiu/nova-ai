import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

export default defineTool({
  description:
    "List market trending products (demand score, competition score, estimated unit cost, suggested price, estimated margin, source insight), sorted by demand score descending. Use for product research and import candidates. Returns { count, trendingProducts } (max 50).",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    const trending = [...(await client.listTrendingProducts())].sort(
      (a, b) => b.demandScore - a.demandScore,
    );
    return {
      count: trending.length,
      trendingProducts: trending.slice(0, 50),
    };
  },
});
