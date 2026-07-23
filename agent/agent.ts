import { defineAgent, defineDynamic } from "eve";
import { resolveStoreId } from "./lib/tenant";
import { getTenant } from "./lib/tenants";
import { ROOT_MODEL, modelForPlan } from "./lib/models";

/**
 * Per-tenant model tiering by plan, selected once at session start (prompt
 * caches are per model, so we never switch mid-session). The store's plan
 * comes from its registry row; `modelForPlan` maps it to a model id, or `null`
 * to fall back to the compiled default. Fully data-driven — no per-tenant code.
 *
 * Every model id lives in `lib/models.ts`, including this fallback and the
 * routing/credential notes.
 */
export default defineAgent({
  model: defineDynamic({
    fallback: ROOT_MODEL,
    events: {
      "session.started": (_event, ctx) => {
        const storeId = resolveStoreId(ctx);
        const plan = storeId ? getTenant(storeId)?.plan : undefined;
        return modelForPlan(plan);
      },
    },
  }),
});
