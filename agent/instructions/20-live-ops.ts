/**
 * Context layer L2 — live operating state.
 *
 * Autonomy level + guardrails, the approval-queue depth, and a live alerts
 * digest. Refreshed every turn (`turn.started`) with no cache, because these
 * change as Nova and the owner work. Tenant-scoped via the session's
 * authenticated store.
 */

import { defineDynamic, defineInstructions } from "eve/instructions";
import { resolveStoreId } from "../lib/tenant";
import { buildLiveOps } from "../lib/context/layers";

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const storeId = resolveStoreId(ctx);
      if (!storeId) return null;
      return defineInstructions({ markdown: await buildLiveOps(storeId) });
    },
  },
});
