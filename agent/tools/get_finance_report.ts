import { defineTool } from "eve/tools";
import { z } from "zod";
import { buildFinanceReport } from "../lib/nova/analytics";

export default defineTool({
  description:
    "Build the P&L / finance report for a period (default 30 days): revenue, COGS, ad spend, shipping, refunds, fees, software, gross/net profit and margins, daily P&L series, and best/worst margin products. Use for profitability questions and financial reviews.",
  inputSchema: z.object({
    sinceDays: z
      .number()
      .int()
      .min(1)
      .max(90)
      .default(30)
      .describe("Report period in days, 1-90 (default 30)"),
  }),
  async execute(input) {
    return buildFinanceReport(input.sinceDays);
  },
});
