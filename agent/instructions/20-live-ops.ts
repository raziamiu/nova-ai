/**
 * Context layer L2 — live operating state.
 *
 * Autonomy level + guardrails, the approval-queue depth, and a live alerts
 * digest. Refreshed every turn (`turn.started`) with no cache, because these
 * change as Nova and the owner work. Tenant-scoped via the session's
 * authenticated store.
 *
 * Founder-only (Stage 10 module 02, D11): autonomy level, the approval queue
 * and the alert digest are the founder plane — none of it belongs in a
 * customer conversation, so this gates on `isCustomerSession`.
 */

import { defineDynamic, defineInstructions } from "eve/instructions";
import { resolveStoreId } from "../lib/tenant";
import { isCustomerSession } from "../lib/customer/principal";
import { buildLiveOps } from "../lib/context/layers";

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      if (isCustomerSession(ctx)) return null;
      const storeId = resolveStoreId(ctx);
      if (!storeId) return null;
      return defineInstructions({ markdown: await buildLiveOps(storeId) });
    },
  },
});
