import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";
import { isCustomerSession } from "../lib/customer/principal";

/**
 * The one founder tool a customer conversation may call (D11 slim set), which
 * is exactly why the projection is split.
 *
 * Hard rule 5 makes this the NORMAL path for a customer turn: every price,
 * stock count and "ar 3 ta ache" has to come from a live read here. The
 * founder projection carries `cost`, `marginPct`, `supplierId`,
 * `reorderPoint` and `avgWeeklyVelocity` — the shop's buying price and
 * supply chain — so on the customer branch those fields are never built at
 * all. A customer asking "eta koto tay anen?" cannot be told the answer by a
 * model that never saw it.
 *
 * Both branches return the same interface with the founder-plane fields
 * optional, so callers keep one shape and the split shows up as absent keys
 * rather than a union the compiler makes awkward to read.
 */
interface ProductView {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  compareAtPrice: number | null;
  stock: number;
  status: string;
  /** Founder-plane only — never projected into a `dakio-inbox` session. */
  cost?: number;
  marginPct?: number | null;
  reorderPoint?: number;
  supplierId?: string | null;
  rating?: number;
  reviewCount?: number;
  avgWeeklyVelocity?: number;
  tags?: string[];
}

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
  async execute(input, ctx) {
    const customerSession = isCustomerSession(ctx);
    const client = storeFor(requireStore(ctx).storeId);
    let products = await client.listProducts({
      status: input.status,
      category: input.category,
    });
    if (input.lowStockOnly) {
      products = products.filter((p) => p.stock <= p.reorderPoint);
    }
    const enriched: ProductView[] = products.slice(0, 50).map((p) => {
      // What a customer may be told: what it is, what it costs THEM, and
      // whether it is there. Nothing about what the shop paid for it.
      const view: ProductView = {
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        price: p.price,
        compareAtPrice: p.compareAtPrice,
        stock: p.stock,
        status: p.status,
      };
      if (customerSession) return view;

      const recent = p.weeklyVelocity.slice(-4);
      const avgWeeklyVelocity =
        recent.length > 0
          ? Math.round((recent.reduce((s, v) => s + v, 0) / recent.length) * 10) / 10
          : 0;
      const marginPct =
        p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 1000) / 10 : null;
      return {
        ...view,
        cost: p.cost,
        marginPct,
        reorderPoint: p.reorderPoint,
        supplierId: p.supplierId,
        rating: p.rating,
        reviewCount: p.reviewCount,
        avgWeeklyVelocity,
        tags: p.tags,
      };
    });
    return { count: products.length, products: enriched };
  },
});
