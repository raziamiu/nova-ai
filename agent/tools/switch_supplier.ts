import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { performAction } from "../lib/nova/actions";
import { justificationSchema, switchSupplierPayload } from "../lib/nova/schemas";
import { getStoreClient } from "../lib/store/client";

export default defineTool({
  description:
    "Move a product to a different supplier (better cost, reliability, or lead time — compare with get_suppliers first). Updates the product's supplier and unit cost. High-risk. Autonomy-gated: returns status executed, prepared (awaiting owner approval), or blocked.",
  inputSchema: switchSupplierPayload.extend({
    justification: justificationSchema,
    department: z
      .enum(NOVA_DEPARTMENTS)
      .optional()
      .describe("Attribution for the activity log; defaults to supplier_manager."),
  }),
  async execute({ justification, department, ...payload }) {
    const client = getStoreClient();
    const productName = client.getProduct(payload.productId)?.name ?? payload.productId;
    const supplierName =
      client.getSupplier(payload.newSupplierId)?.name ?? payload.newSupplierId;
    const title = `Switch "${productName}" to supplier ${supplierName}`;
    return performAction({
      type: "switch_supplier",
      department: department ?? "supplier_manager",
      title,
      payload,
      justification,
    });
  },
});
