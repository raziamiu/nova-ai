import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { evaluateExperiments } from "../lib/memory/experiments";

export default defineTool({
  description:
    "Evaluate every open experiment for this store against its target, mark each won / lost / inconclusive, and record the outcome to memory with provenance. Reflection runs this nightly; call it on demand when the owner asks how a test is doing.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const results = await evaluateExperiments(requireStore(ctx).storeId);
    return {
      evaluated: results.length,
      outcomes: results.map((r) => ({
        id: r.experiment.id,
        hypothesis: r.experiment.hypothesis,
        metric: r.experiment.metric,
        baseline: r.experiment.baseline,
        target: r.experiment.target,
        actual: r.experiment.actual,
        status: r.experiment.status,
      })),
    };
  },
});
