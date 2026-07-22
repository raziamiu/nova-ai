import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { performAction } from "../lib/nova/actions";
import { receiptSchema, switchSupplierPayload } from "../lib/nova/schemas";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

export default defineTool({
  description:
    "Move a product to a different supplier (better cost, reliability, or lead time — compare with get_suppliers first). Updates the product's supplier and unit cost. High-risk. Autonomy-gated: returns status executed, prepared (awaiting owner approval), or blocked.",
  inputSchema: switchSupplierPayload.extend({
    receipt: receiptSchema,
    department: z
      .enum(NOVA_DEPARTMENTS)
      .optional()
      .describe("Attribution for the activity log; defaults to operations."),
  }),
  async execute({ receipt, department, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    const [product, supplier] = await Promise.all([
      client.getProduct(payload.productId),
      client.getSupplier(payload.newSupplierId),
    ]);
    const productName = product?.name ?? payload.productId;
    const supplierName = supplier?.name ?? payload.newSupplierId;
    const title = `Switch "${productName}" to supplier ${supplierName}`;
    return performAction(client, {
      type: "switch_supplier",
      department: department ?? "operations",
      title,
      payload,
      receipt,
    });
  },
});
