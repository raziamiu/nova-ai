import { defineTool } from "eve/tools";
import { z } from "zod";
import { getStoreClient } from "../lib/store/client";

export default defineTool({
  description:
    "List purchase orders enriched with product and supplier names: quantity, unit cost, total, status, and expected arrival. Filter by status (draft, placed, in_transit, received, cancelled). Use for restock tracking and before creating new POs. Returns { count, purchaseOrders } (max 50).",
  inputSchema: z.object({
    status: z
      .enum(["draft", "placed", "in_transit", "received", "cancelled"])
      .optional()
      .describe("Only purchase orders with this status"),
  }),
  async execute(input) {
    const client = getStoreClient();
    const purchaseOrders = client.listPurchaseOrders(input.status);
    return {
      count: purchaseOrders.length,
      purchaseOrders: purchaseOrders.slice(0, 50).map((po) => ({
        id: po.id,
        productId: po.productId,
        productName: client.getProduct(po.productId)?.name ?? null,
        supplierId: po.supplierId,
        supplierName: client.getSupplier(po.supplierId)?.name ?? null,
        quantity: po.quantity,
        unitCost: po.unitCost,
        total: po.total,
        status: po.status,
        createdAt: po.createdAt,
        expectedAt: po.expectedAt,
      })),
    };
  },
});
