import { defineTool } from "eve/tools";
import { z } from "zod";
import { getStoreClient } from "../lib/store/client";
import { round2 } from "../lib/nova/format";

export default defineTool({
  description:
    "List recent orders with total value. Filter by lookback window (sinceDays, default 7) and status (placed, paid, fulfilled, delivered, rto, refund_requested, refunded, cancelled). Use to inspect sales flow, delivery problems, or refund pressure. Returns { count, totalValue, orders } (max 50).",
  inputSchema: z.object({
    sinceDays: z
      .number()
      .int()
      .min(1)
      .default(7)
      .describe("Lookback window in days (default 7)"),
    status: z
      .enum([
        "placed",
        "paid",
        "fulfilled",
        "delivered",
        "rto",
        "refund_requested",
        "refunded",
        "cancelled",
      ])
      .optional()
      .describe("Only orders with this status"),
  }),
  async execute(input) {
    const client = getStoreClient();
    const orders = client.listOrders({ sinceDays: input.sinceDays, status: input.status });
    const totalValue = round2(orders.reduce((s, o) => s + o.total, 0));
    return {
      count: orders.length,
      totalValue,
      orders: orders.slice(0, 50).map((o) => ({
        id: o.id,
        customerId: o.customerId,
        status: o.status,
        total: o.total,
        itemCount: o.items.reduce((s, i) => s + i.quantity, 0),
        placedAt: o.placedAt,
        courierId: o.courierId,
        region: o.region,
      })),
    };
  },
});
