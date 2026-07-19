import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";
import { summarizeWork } from "../lib/nova/activity";

export default defineTool({
  description:
    "Report what Nova has done: aggregated work summary (tasks completed, hours saved, revenue influenced, by department and kind) plus the 30 most recent activity entries, newest first. Use when the owner asks 'what have you been doing' or for accountability sections in reports.",
  inputSchema: z.object({
    sinceDays: z
      .number()
      .int()
      .min(1)
      .default(7)
      .describe("Lookback window in days (default 7)"),
  }),
  async execute(input, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    const [entriesRaw, summary] = await Promise.all([
      client.listActivity({ sinceDays: input.sinceDays }),
      summarizeWork(client, input.sinceDays),
    ]);
    const entries = [...entriesRaw].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return {
      summary,
      recent: entries.slice(0, 30).map((e) => ({
        id: e.id,
        at: e.at,
        department: e.department,
        kind: e.kind,
        title: e.title,
        detail: e.detail,
        minutesSaved: e.minutesSaved,
        revenueInfluence: e.revenueInfluence,
        actionId: e.actionId,
      })),
    };
  },
});
