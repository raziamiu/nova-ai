import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { performAction } from "../lib/nova/actions";
import { assignCourierPayload, receiptSchema } from "../lib/nova/schemas";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

export default defineTool({
  description:
    "Assign (or reassign) a courier to an order — pick by region coverage, on-time rate, RTO rate, and cost via get_couriers. Autonomy-gated: returns status executed, prepared (awaiting owner approval), or blocked.",
  inputSchema: assignCourierPayload.extend({
    receipt: receiptSchema,
    department: z
      .enum(NOVA_DEPARTMENTS)
      .optional()
      .describe("Attribution for the activity log; defaults to shipping."),
  }),
  async execute({ receipt, department, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    const courier = await client.getCourier(payload.courierId);
    const courierName = courier?.name ?? payload.courierId;
    const title = `Assign ${courierName} to order ${payload.orderId}`;
    return performAction(client, {
      type: "assign_courier",
      department: department ?? "shipping",
      title,
      payload,
      receipt,
    });
  },
});
