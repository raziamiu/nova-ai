import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

export default defineTool({
  description:
    "Delete one memory entry by namespace and key — use when a remembered fact is wrong, outdated, or the owner asks Nova to forget it. Returns { deleted: false } if no such entry exists.",
  inputSchema: z.object({
    namespace: z
      .enum(["goals", "brand", "preferences", "rules", "insights", "experiments", "customers"])
      .describe("Namespace the entry lives in."),
    key: z.string().describe("Exact key of the entry to delete."),
  }),
  async execute({ namespace, key }, ctx) {
    return { deleted: await storeFor(requireStore(ctx).storeId).deleteMemory(namespace, key) };
  },
});
