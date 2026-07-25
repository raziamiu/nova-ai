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
 *
 * Founder-only (Stage 10 module 02, D11): the framing here is written for the
 * store owner ("the business you operate", "ask the owner what success looks
 * like"), so it must never render in a customer conversation. It gates on the
 * same `isCustomerSession` predicate the customer register loads on — the two
 * are exact complements.
 */

import { defineDynamic, defineInstructions } from "eve/instructions";
import { resolveStoreId } from "../lib/tenant";
import { isCustomerSession } from "../lib/customer/principal";
import { buildTenantProfile } from "../lib/context/layers";
import { getOrSet, tenantKey, TTL } from "../lib/cache";

export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      if (isCustomerSession(ctx)) return null;
      const storeId = resolveStoreId(ctx);
      if (!storeId) return null;
      const markdown = await getOrSet(tenantKey(storeId, "profile"), TTL.profile24h, () =>
        buildTenantProfile(storeId),
      );
      return defineInstructions({ markdown });
    },
  },
});
