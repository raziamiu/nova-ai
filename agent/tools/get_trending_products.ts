import { defineTool } from "eve/tools";
import { z } from "zod";
import { getStoreClient } from "../lib/store/client";

export default defineTool({
  description:
    "List market trending products (demand score, competition score, estimated unit cost, suggested price, estimated margin, source insight), sorted by demand score descending. Use for product research and import candidates. Returns { count, trendingProducts } (max 50).",
  inputSchema: z.object({}),
  async execute() {
    const client = getStoreClient();
    const trending = [...client.listTrendingProducts()].sort(
      (a, b) => b.demandScore - a.demandScore,
    );
    return {
      count: trending.length,
      trendingProducts: trending.slice(0, 50),
    };
  },
});
