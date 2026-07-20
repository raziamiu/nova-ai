import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { listNamespace } from "../lib/memory/service";

export default defineTool({
  description:
    "List Nova's long-term memory entries, optionally filtered to one namespace. Recent entries are already injected into the system prompt — use this for the full, uncapped view (e.g. auditing memory or reviewing every customer note).",
  inputSchema: z.object({
    namespace: z
      .enum(["goals", "brand", "preferences", "rules", "insights", "experiments", "customers"])
      .optional()
      .describe("Only this namespace; omit for all memory."),
  }),
  async execute({ namespace }, ctx) {
    const entries = await listNamespace(requireStore(ctx).storeId, namespace);
    // Strip embedding vectors — they are a retrieval index, not readable content.
    const clean = entries.map(({ embedding: _embedding, ...rest }) => rest);
    return { count: clean.length, entries: clean };
  },
});
