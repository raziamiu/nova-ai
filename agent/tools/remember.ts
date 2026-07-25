import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { upsert } from "../lib/memory/service";
import { requireFounderSession } from "../lib/customer/session";

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
    // D11: founder-plane tool, never a customer session. Module 03 shipped
    // customer memory and left this guard exactly where it was (D-24): the
    // `customers` namespace is now written by the server-side
    // `conversation_distill` job, off the turn and through the redaction guard,
    // rather than by a tool a customer can steer one sentence at a time. The
    // module doc's D9 line ("writes go through the existing remember tool") is
    // the thing that changed, not this.
    requireFounderSession(ctx);
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
