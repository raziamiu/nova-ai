/**
 * Context layer L3 — relevant memory.
 *
 * Durable facts worth recalling: owner preferences, standing rules, learned
 * insights, experiment outcomes, and customer notes. Refreshed every turn so
 * a fact remembered mid-conversation is available on the next turn. Keyed
 * recall today; Phase 04 adds pgvector similarity against the turn's task.
 * Tenant-scoped — one store's memory never renders into another's context.
 */

import { defineDynamic, defineInstructions } from "eve/instructions";
import { resolveStoreId } from "../lib/tenant";
import { buildRelevantMemory } from "../lib/context/layers";

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const storeId = resolveStoreId(ctx);
      if (!storeId) return null;
      return defineInstructions({ markdown: await buildRelevantMemory(storeId) });
    },
  },
});
