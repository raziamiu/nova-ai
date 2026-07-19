import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";
import { round2 } from "../lib/nova/format";

export default defineTool({
  description:
    "List abandoned carts with customer name, value, and recovery state. Filter by state (none, message_prepared, message_sent, recovered, lost). Use to find recovery opportunities — carts in state 'none' are untouched revenue. Returns { count, totalValue, carts } (max 50).",
  inputSchema: z.object({
    state: z
      .enum(["none", "message_prepared", "message_sent", "recovered", "lost"])
      .optional()
      .describe("Only carts in this recovery state"),
  }),
  async execute(input, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    const carts = await client.listAbandonedCarts(input.state);
    const totalValue = round2(carts.reduce((s, c) => s + c.value, 0));
    const shown = carts.slice(0, 50);
    const customers = await Promise.all(shown.map((cart) => client.getCustomer(cart.customerId)));
    return {
      count: carts.length,
      totalValue,
      carts: shown.map((cart, i) => {
        const customer = customers[i];
        return {
          id: cart.id,
          customerId: cart.customerId,
          customerName: customer?.name ?? null,
          customerSegment: customer?.segment ?? null,
          value: cart.value,
          abandonedAt: cart.abandonedAt,
          recoveryState: cart.recoveryState,
          recoveryMessage: cart.recoveryMessage,
          items: cart.items.map((i) => ({
            productId: i.productId,
            productName: i.productName,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
        };
      }),
    };
  },
});
