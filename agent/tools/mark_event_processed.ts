import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

export default defineTool({
  description:
    "Mark a store event (from get_inbox_events) as handled, so it never comes back on a future check. Call this once you've actually incorporated the event into your reasoning or acted on it — not before, so a run that fails partway through still sees the event again next time.",
  inputSchema: z.object({
    id: z.string().describe("The event's id, from get_inbox_events."),
  }),
  async execute(input, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    const event = await client.markEventProcessed(input.id);
    return { ok: true, event };
  },
});
