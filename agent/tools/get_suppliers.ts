import { defineTool } from "eve/tools";
import { z } from "zod";
import { getStoreClient } from "../lib/store/client";

export default defineTool({
  description:
    "List suppliers with reliability score, quality score, current PO delay days, and their product offers (enriched with product names, unit cost, lead time). Use for reorder decisions, supplier comparisons, and switching evaluations. Returns { count, suppliers } (max 50).",
  inputSchema: z.object({}),
  async execute() {
    const client = getStoreClient();
    const [suppliers, products] = await Promise.all([
      client.listSuppliers(),
      client.listProducts(),
    ]);
    const productNameById = new Map(products.map((p) => [p.id, p.name]));
    return {
      count: suppliers.length,
      suppliers: suppliers.slice(0, 50).map((s) => ({
        id: s.id,
        name: s.name,
        country: s.country,
        reliabilityScore: s.reliabilityScore,
        qualityScore: s.qualityScore,
        currentDelayDays: s.currentDelayDays,
        notes: s.notes,
        offers: s.offers.map((o) => ({
          productId: o.productId,
          productName: productNameById.get(o.productId) ?? null,
          unitCost: o.unitCost,
          leadTimeDays: o.leadTimeDays,
        })),
      })),
    };
  },
});
