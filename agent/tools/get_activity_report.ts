import { defineTool } from "eve/tools";
import { z } from "zod";
import { getStoreClient } from "../lib/store/client";
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
  async execute(input) {
    const client = getStoreClient();
    const entries = [...client.listActivity({ sinceDays: input.sinceDays })].sort(
      (a, b) => Date.parse(b.at) - Date.parse(a.at),
    );
    return {
      summary: summarizeWork(input.sinceDays),
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
