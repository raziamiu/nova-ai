import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { performAction } from "../lib/nova/actions";
import { createPurchaseOrderPayload, justificationSchema } from "../lib/nova/schemas";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

export default defineTool({
  description:
    "Place a restock purchase order with a supplier for one product. Unit cost defaults to the supplier's offer; totals above the maxAutoPurchaseOrderTotal guardrail always need owner approval. High-risk. Autonomy-gated: returns status executed, prepared (awaiting owner approval), or blocked.",
  inputSchema: createPurchaseOrderPayload.extend({
    justification: justificationSchema,
    department: z
      .enum(NOVA_DEPARTMENTS)
      .optional()
      .describe("Attribution for the activity log; defaults to inventory."),
  }),
  async execute({ justification, department, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    const [product, supplier] = await Promise.all([
      client.getProduct(payload.productId),
      client.getSupplier(payload.supplierId),
    ]);
    const productName = product?.name ?? payload.productId;
    const supplierName = supplier?.name ?? payload.supplierId;
    const title = `Order ${payload.quantity} × "${productName}" from ${supplierName}`;
    return performAction(client, {
      type: "create_purchase_order",
      department: department ?? "inventory",
      title,
      payload,
      justification,
    });
  },
});
