import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

export default defineTool({
  description:
    "List store events Dakio has pushed since Nova last checked — new orders, order status changes, newly abandoned carts. Defaults to unprocessed only (the ones Nova hasn't yet reacted to). Use at the start of a scheduled run to react to real events instead of only re-scanning everything by hand; call mark_event_processed once an event has actually been incorporated into your reasoning or acted on. Returns { count, events }.",
  inputSchema: z.object({
    processed: z
      .boolean()
      .optional()
      .describe("Filter by processed state. Omit for unprocessed-only (the default and normal case)."),
  }),
  async execute(input, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    const events = await client.listInboxEvents({ processed: input.processed ?? false });
    return { count: events.length, events };
  },
});
