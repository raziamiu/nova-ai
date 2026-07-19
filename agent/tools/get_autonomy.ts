import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

export default defineTool({
  description:
    "Read Nova's current autonomy configuration: level (0-4), the six guardrails, when it was last changed, and a legend explaining each level. Check this before explaining why an action executed, was prepared, or was blocked.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const config = await storeFor(requireStore(ctx).storeId).getAutonomy();
    return {
      ...config,
      levels: {
        0: "observe only",
        1: "recommend",
        2: "prepare actions",
        3: "auto low-risk",
        4: "business operator",
      },
    };
  },
});
