import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { upsert } from "../lib/memory/service";

export default defineTool({
  description:
    "Persist a durable fact — an owner preference, standing rule, brand note, learned insight, experiment outcome, goal, or customer note. Nova never forgets: memory is injected into every future conversation and indexed for semantic recall. Writing the same namespace+key overwrites the previous value.",
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
    // The model chose namespace/key/value; the executor derives the tenant and
    // marks the source. Routing through the service embeds the entry for recall.
    const entry = await upsert(requireStore(ctx).storeId, {
      namespace,
      key,
      value,
      source: "nova",
    });
    // Never return the embedding vector to the model — it's an index, not content.
    const { embedding: _embedding, ...rest } = entry;
    return rest;
  },
});
