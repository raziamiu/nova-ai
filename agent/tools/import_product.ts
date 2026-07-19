import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { performAction } from "../lib/nova/actions";
import { importProductPayload, justificationSchema } from "../lib/nova/schemas";
import { getStoreClient } from "../lib/store/client";

export default defineTool({
  description:
    "Import a product from the trending-products research feed into the catalog — live immediately or as a draft. Price defaults to the feed's suggested price. Use get_trending_products to pick by demand, competition, and margin. Autonomy-gated: returns status executed, prepared (awaiting owner approval), or blocked.",
  inputSchema: importProductPayload.extend({
    justification: justificationSchema,
    department: z
      .enum(NOVA_DEPARTMENTS)
      .optional()
      .describe("Attribution for the activity log; defaults to product_research."),
  }),
  async execute({ justification, department, ...payload }) {
    const client = getStoreClient();
    const trendingProducts = await client.listTrendingProducts();
    const trending = trendingProducts.find((t) => t.id === payload.trendingProductId);
    const title = `Import "${trending?.name ?? payload.trendingProductId}"${payload.activate ? " and launch live" : " as draft"}`;
    return performAction({
      type: "import_product",
      department: department ?? "product_research",
      title,
      payload,
      justification,
    });
  },
});
