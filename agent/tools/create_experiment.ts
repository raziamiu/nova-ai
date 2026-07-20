import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { createExperiment } from "../lib/memory/experiments";

export default defineTool({
  description:
    "Register an experiment before making a campaign or pricing change: a hypothesis with a measurable metric, its current baseline, and the target that would count as a win. Attach the ids of the actions that enact it. Nightly reflection evaluates open experiments against actuals and records the outcome to memory.",
  inputSchema: z.object({
    hypothesis: z
      .string()
      .min(8)
      .describe("What you expect and why, e.g. 'Raising the Blender campaign budget 20% lifts ROAS by holding CPA.'"),
    metric: z
      .enum(["roas7d", "revenue7d", "cpa7d"])
      .describe("The campaign metric this experiment moves (cpa7d is lower-is-better)."),
    baseline: z.number().describe("Current value of the metric before the change."),
    target: z.number().describe("Value that would count as a win."),
    actionIds: z
      .array(z.string())
      .default([])
      .describe("Ids of the actions that enact this experiment (e.g. the update_campaign action)."),
  }),
  async execute({ hypothesis, metric, baseline, target, actionIds }, ctx) {
    return createExperiment(requireStore(ctx).storeId, {
      hypothesis,
      metric,
      baseline,
      target,
      actionIds,
    });
  },
});
