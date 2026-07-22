import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { performAction } from "../lib/nova/actions";
import { importProductPayload, receiptSchema } from "../lib/nova/schemas";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

export default defineTool({
  description:
    "Import a product from the trending-products research feed into the catalog — live immediately or as a draft. Price defaults to the feed's suggested price. Use get_trending_products to pick by demand, competition, and margin. Autonomy-gated: returns status executed, prepared (awaiting owner approval), or blocked.",
  inputSchema: importProductPayload.extend({
    receipt: receiptSchema,
    department: z
      .enum(NOVA_DEPARTMENTS)
      .optional()
      .describe("Attribution for the activity log; defaults to product_research."),
  }),
  async execute({ receipt, department, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    const trendingProducts = await client.listTrendingProducts();
    const trending = trendingProducts.find((t) => t.id === payload.trendingProductId);
    const title = `Import "${trending?.name ?? payload.trendingProductId}"${payload.activate ? " and launch live" : " as draft"}`;
    return performAction(client, {
      type: "import_product",
      department: department ?? "product_research",
      title,
      payload,
      receipt,
    });
  },
});
