import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

export default defineTool({
  description:
    "Persist a durable fact — an owner preference, standing rule, brand note, learned insight, experiment outcome, goal, or customer note. Nova never forgets: memory is injected into every future conversation. Writing the same namespace+key overwrites the previous value.",
  inputSchema: z.object({
    namespace: z
      .enum(["goals", "brand", "preferences", "rules", "insights", "experiments", "customers"])
      .describe("Which memory shelf this fact belongs on."),
    key: z
      .string()
      .min(2)
      .describe("Short stable identifier, e.g. max_discount_preference."),
    value: z.string().min(3).describe("The fact itself, one or two clear sentences."),
  }),
  async execute({ namespace, key, value }, ctx) {
    return storeFor(requireStore(ctx).storeId).upsertMemory({ namespace, key, value });
  },
});
