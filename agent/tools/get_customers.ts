import { defineTool } from "eve/tools";
import { z } from "zod";
import { getStoreClient } from "../lib/store/client";

export default defineTool({
  description:
    "List customers with segment, order count, lifetime value, and last order date. Filter by segment (vip, repeat, new, at-risk). Use for winback targeting, VIP outreach, or understanding who buys. Returns { count, customers } (max 50).",
  inputSchema: z.object({
    segment: z
      .enum(["vip", "repeat", "new", "at-risk"])
      .optional()
      .describe("Only customers in this segment"),
  }),
  async execute(input) {
    const client = getStoreClient();
    const customers = await client.listCustomers({ segment: input.segment });
    return {
      count: customers.length,
      customers: customers.slice(0, 50).map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        segment: c.segment,
        ordersCount: c.ordersCount,
        lifetimeValue: c.lifetimeValue,
        lastOrderAt: c.lastOrderAt,
        notes: c.notes,
      })),
    };
  },
});
