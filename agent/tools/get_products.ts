import { defineTool } from "eve/tools";
import { z } from "zod";
import { getStoreClient } from "../lib/store/client";

export default defineTool({
  description:
    "List catalog products with computed margin % and average weekly sales velocity (last 4 weeks). Filter by status, category, or lowStockOnly (stock at/below reorder point). Use for inventory checks, pricing reviews, and picking products to promote. Returns { count, products } (max 50).",
  inputSchema: z.object({
    status: z
      .enum(["active", "draft", "archived"])
      .optional()
      .describe("Only products with this status"),
    category: z.string().optional().describe("Only products in this category"),
    lowStockOnly: z
      .boolean()
      .optional()
      .describe("Only products with stock at or below their reorder point"),
  }),
  async execute(input) {
    const client = getStoreClient();
    let products = await client.listProducts({
      status: input.status,
      category: input.category,
    });
    if (input.lowStockOnly) {
      products = products.filter((p) => p.stock <= p.reorderPoint);
    }
    const enriched = products.slice(0, 50).map((p) => {
      const recent = p.weeklyVelocity.slice(-4);
      const avgWeeklyVelocity =
        recent.length > 0
          ? Math.round((recent.reduce((s, v) => s + v, 0) / recent.length) * 10) / 10
          : 0;
      const marginPct =
        p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 1000) / 10 : null;
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        price: p.price,
        compareAtPrice: p.compareAtPrice,
        cost: p.cost,
        marginPct,
        stock: p.stock,
        reorderPoint: p.reorderPoint,
        supplierId: p.supplierId,
        status: p.status,
        rating: p.rating,
        reviewCount: p.reviewCount,
        avgWeeklyVelocity,
        tags: p.tags,
      };
    });
    return { count: products.length, products: enriched };
  },
});
