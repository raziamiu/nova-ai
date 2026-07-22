import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { performAction } from "../lib/nova/actions";
import { receiptSchema, updatePricePayload } from "../lib/nova/schemas";
import { usd } from "../lib/nova/format";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

export default defineTool({
  description:
    "Change a product's storefront price (and optionally its strike-through compareAtPrice). Guardrails enforce a maximum change percent and a margin floor. Autonomy-gated: returns status executed, prepared (awaiting owner approval), or blocked.",
  inputSchema: updatePricePayload.extend({
    receipt: receiptSchema,
    department: z
      .enum(NOVA_DEPARTMENTS)
      .optional()
      .describe("Attribution for the activity log; defaults to product_research."),
  }),
  async execute({ receipt, department, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    const product = await client.getProduct(payload.productId);
    const title = product
      ? `Reprice "${product.name}": ${usd(product.price)} → ${usd(payload.newPrice)}`
      : `Set price of ${payload.productId} to ${usd(payload.newPrice)}`;
    return performAction(client, {
      type: "update_price",
      department: department ?? "product_research",
      title,
      payload,
      receipt,
    });
  },
});
