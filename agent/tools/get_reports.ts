import { defineTool } from "eve/tools";
import { z } from "zod";
import { getStoreClient } from "../lib/store/client";

export default defineTool({
  description:
    "List Nova's saved reports (morning briefs, night plans, weekly strategies, pulses, custom), most recent first. Use to recall what was already reported before writing a new one, or when the owner references a past report. Returns { count, reports }.",
  inputSchema: z.object({
    kind: z
      .enum(["morning", "night_plan", "weekly_strategy", "pulse", "custom"])
      .optional()
      .describe("Only reports of this kind"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(5)
      .describe("Maximum reports to return (default 5)"),
  }),
  async execute(input) {
    const client = getStoreClient();
    const reports = await client.listReports({ kind: input.kind, limit: input.limit });
    return { count: reports.length, reports };
  },
});
