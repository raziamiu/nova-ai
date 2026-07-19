import { defineTool } from "eve/tools";
import { z } from "zod";
import { getStoreClient } from "../lib/store/client";

export default defineTool({
  description:
    "List discount codes with percent off, scope (order/product), targeted customer, expiry, and active flag. Set activeOnly to true to see only live codes. Use before issuing new discounts to avoid duplicates and stacking. Returns { count, discounts } (max 50).",
  inputSchema: z.object({
    activeOnly: z.boolean().optional().describe("Only currently active discount codes"),
  }),
  async execute(input) {
    const client = getStoreClient();
    const discounts = client.listDiscounts(input.activeOnly);
    return { count: discounts.length, discounts: discounts.slice(0, 50) };
  },
});
