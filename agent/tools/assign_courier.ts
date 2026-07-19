import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { performAction } from "../lib/nova/actions";
import { assignCourierPayload, justificationSchema } from "../lib/nova/schemas";
import { getStoreClient } from "../lib/store/client";

export default defineTool({
  description:
    "Assign (or reassign) a courier to an order — pick by region coverage, on-time rate, RTO rate, and cost via get_couriers. Autonomy-gated: returns status executed, prepared (awaiting owner approval), or blocked.",
  inputSchema: assignCourierPayload.extend({
    justification: justificationSchema,
    department: z
      .enum(NOVA_DEPARTMENTS)
      .optional()
      .describe("Attribution for the activity log; defaults to courier_manager."),
  }),
  async execute({ justification, department, ...payload }) {
    const client = getStoreClient();
    const courier = await client.getCourier(payload.courierId);
    const courierName = courier?.name ?? payload.courierId;
    const title = `Assign ${courierName} to order ${payload.orderId}`;
    return performAction({
      type: "assign_courier",
      department: department ?? "courier_manager",
      title,
      payload,
      justification,
    });
  },
});
