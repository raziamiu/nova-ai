import { defineAgent, defineDynamic } from "eve";
import { resolveStoreId } from "./lib/tenant";
import { getTenant, modelForPlan } from "./lib/tenants";

/**
 * Per-tenant model tiering by plan, selected once at session start (prompt
 * caches are per model, so we never switch mid-session). The store's plan
 * comes from its registry row; `modelForPlan` maps it to a Vercel AI Gateway
 * model id, or `null` to fall back to the compiled default. Fully data-driven
 * — no per-tenant code.
 *
 * Routing is gateway-based: a bare id string sends the call through the Vercel
 * AI Gateway, which authenticates with project OIDC (`VERCEL_OIDC_TOKEN`, what
 * `vercel env pull` writes into `.env.local`) or `AI_GATEWAY_API_KEY` — one
 * credential for every provider instead of a per-provider key. To call
 * Anthropic directly instead, pass `anthropic("claude-sonnet-5")` from
 * `@ai-sdk/anthropic` (still a dependency) and set `ANTHROPIC_API_KEY`.
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
