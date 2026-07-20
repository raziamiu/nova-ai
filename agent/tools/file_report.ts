import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { recordActivity } from "../lib/nova/activity";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

export default defineTool({
  description:
    "File a report to the founder's Dakio dashboard: morning report, night plan, weekly strategy, pulse alert digest, or custom. Lead with what matters, quantify with real numbers, and end with recommended next moves. Returns { reportId, filed }.",
  inputSchema: z.object({
    kind: z.enum(["morning", "night_plan", "weekly_strategy", "pulse", "custom"]),
    title: z.string().min(3),
    body: z
      .string()
      .min(50)
      .describe("Full markdown body rendered on the Dakio dashboard"),
    department: z
      .enum(NOVA_DEPARTMENTS)
      .optional()
      .describe("Attribution for the activity log; defaults to ceo."),
    dedupeKey: z
      .string()
      .optional()
      .describe(
        "Pass the exact dedupeKey given in a proactive job's instructions, if any, so a rerun of the same job occurrence re-files this SAME report instead of a duplicate. Omit for an ad hoc report.",
      ),
  }),
  async execute({ kind, title, body, department, dedupeKey }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    const report = await client.addReport({ kind, title, body, dedupeKey });
    await recordActivity(client, {
      department: department ?? "ceo",
      kind: "report",
      title,
      detail: `Filed ${kind} report: ${title}`,
    });
    return { reportId: report.id, filed: true };
  },
});
