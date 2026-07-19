import { defineAgent, defineDynamic } from "eve";
import { resolveStoreId } from "./lib/tenant";
import { getTenant, modelForPlan } from "./lib/tenants";

/**
 * Per-tenant model tiering by plan, selected once at session start (prompt
 * caches are per model, so we never switch mid-session). The store's plan
 * comes from its registry row; `modelForPlan` maps it to a gateway model id,
 * or `null` to fall back to the compiled default. Fully data-driven — no
 * per-tenant code.
 */
export default defineAgent({
  model: defineDynamic({
    fallback: "anthropic/claude-sonnet-5",
    events: {
      "session.started": (_event, ctx) => {
        const storeId = resolveStoreId(ctx);
        const plan = storeId ? getTenant(storeId)?.plan : undefined;
        return modelForPlan(plan);
      },
    },
  }),
});
