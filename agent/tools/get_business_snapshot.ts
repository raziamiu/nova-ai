import { defineTool } from "eve/tools";
import { z } from "zod";
import { buildBusinessSnapshot } from "../lib/nova/analytics";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

export default defineTool({
  description:
    "The FIRST tool to reach for on any business question ('how are we doing'). Returns the full business snapshot for this store: revenue/orders (today, 7d vs prior 7d), AOV, estimated 7d profit, pending approvals, open tickets, active campaigns, low-stock products, unrecovered carts, top products, and Nova's 7d work summary.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    return buildBusinessSnapshot(storeFor(requireStore(ctx).storeId));
  },
});
