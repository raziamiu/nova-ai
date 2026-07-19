import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { performAction } from "../lib/nova/actions";
import { createPurchaseOrderPayload, justificationSchema } from "../lib/nova/schemas";
import { getStoreClient } from "../lib/store/client";

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
  async execute({ justification, department, ...payload }) {
    const client = getStoreClient();
    const productName = client.getProduct(payload.productId)?.name ?? payload.productId;
    const supplierName = client.getSupplier(payload.supplierId)?.name ?? payload.supplierId;
    const title = `Order ${payload.quantity} × "${productName}" from ${supplierName}`;
    return performAction({
      type: "create_purchase_order",
      department: department ?? "inventory",
      title,
      payload,
      justification,
    });
  },
});
