/**
 * Session-tenant pinning + kill switch — the fail-closed gate that runs
 * before any model spend on a turn.
 *
 * A `turn.started` hook that throws surfaces as `turn.failed`, so throwing
 * here refuses the turn. Two defenses:
 *
 *  1. **Pinning.** A session is single-tenant: the store is fixed by whoever
 *     started it. If a follow-up turn's caller carries a different `storeId`
 *     than the initiator (token confusion / session hijack across stores),
 *     refuse. Switching stores means a new session.
 *  2. **Kill switch.** If the resolved tenant is `paused` in the registry
 *     (`nova_tenants.status`), refuse before spending a model call.
 *
 * This complements — never replaces — `requireStore` in every tool. Tools are
 * the hard isolation boundary; this hook stops paused/hijacked turns early.
 */

import { defineHook } from "eve/hooks";
import { resolveStoreId } from "../lib/tenant";
import { getTenant, isTenantActive } from "../lib/tenants";

function storeIdOf(auth: { attributes?: Record<string, unknown> } | null | undefined): string | undefined {
  const value = auth?.attributes?.storeId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export default defineHook({
  events: {
    "turn.started": (_event, ctx) => {
      const currentStore = storeIdOf(ctx.session.auth.current);
      const initiatorStore = storeIdOf(ctx.session.auth.initiator);

      // 1. Session-tenant pinning: the store can't change mid-session.
      if (currentStore && initiatorStore && currentStore !== initiatorStore) {
        throw new Error(
          "Store mismatch: this session is pinned to a different store than the current request. Start a new session to operate another store.",
        );
      }

      // 2. Kill switch: serve only a provisioned, active tenant. A paused OR
      //    unknown store is refused before any model spend (fail closed).
      const storeId = resolveStoreId(ctx);
      if (storeId && !isTenantActive(storeId)) {
        const tenant = getTenant(storeId);
        throw new Error(
          tenant
            ? `Nova is paused for ${tenant.name}. Re-enable it from the dashboard to resume operations.`
            : `Store ${storeId} is not provisioned for Nova.`,
        );
      }
    },
  },
});
