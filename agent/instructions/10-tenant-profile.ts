/**
 * Context layer L1 — the tenant profile.
 *
 * Who this store is: identity, vertical, brand voice, and goals. Resolved
 * once per session (`session.started`) since it barely changes within a
 * conversation, and cached 24h per store (`t:{storeId}:profile`) so it costs
 * at most one profile read per store per day. Config/memory writes bust the
 * prefix so a changed goal can't outlive the change.
 *
 * There is no static per-tenant prompt on disk — this renders entirely from
 * the tenant registry and the store's own memory.
 */

import { defineDynamic, defineInstructions } from "eve/instructions";
import { resolveStoreId } from "../lib/tenant";
import { buildTenantProfile } from "../lib/context/layers";
import { getOrSet, tenantKey, TTL } from "../lib/cache";

export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      const storeId = resolveStoreId(ctx);
      if (!storeId) return null;
      const markdown = await getOrSet(tenantKey(storeId, "profile"), TTL.profile24h, () =>
        buildTenantProfile(storeId),
      );
      return defineInstructions({ markdown });
    },
  },
});
