import { defineTool } from "eve/tools";
import { z } from "zod";
import { buildBusinessSnapshot } from "../lib/nova/analytics";

export default defineTool({
  description:
    "The FIRST tool to reach for on any business question ('how are we doing'). Returns the full Aurora Living snapshot: revenue/orders (today, 7d vs prior 7d), AOV, estimated 7d profit, pending approvals, open tickets, active campaigns, low-stock products, unrecovered carts, top products, and Nova's 7d work summary.",
  inputSchema: z.object({}),
  async execute() {
    return buildBusinessSnapshot();
  },
});
