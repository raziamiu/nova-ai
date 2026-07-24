/**
 * The single registry for every model Nova runs on.
 *
 * Model ids used to be scattered across 13 files — `agent.ts`, `tenants.ts`,
 * and one hardcoded line in each of the nine department subagents — so a
 * provider switch meant hunting every call site and silently missing some.
 * Everything now points here; nothing else in the repo should name a model.
 *
 * ## Routing
 *
 * These are Vercel AI Gateway model ids (`provider/model`). A bare id string
 * routes through the gateway, which authenticates with one credential for all
 * providers: Vercel project OIDC (`VERCEL_OIDC_TOKEN`, written into
 * `.env.local` by `vercel env pull`) or `AI_GATEWAY_API_KEY`. To bypass the
 * gateway and call a provider directly, pass that provider's `LanguageModel`
 * object instead (e.g. `anthropic(...)` from `@ai-sdk/anthropic`, still a
 * dependency) and set the provider's own key.
 *
 * Ids must match the gateway catalog exactly — `GET
 * https://ai-gateway.vercel.sh/v1/models` lists them. A malformed id fails at
 * request time, not build time, so verify against the catalog when changing
 * one. Note the gateway's dotted version format (`minimax-m2.5`) against
 * providers' native hyphenated ids (`claude-haiku-4-5`).
 *
 * Context windows are deliberately not pinned anywhere: every id here is in the
 * catalog, so eve resolves each model's real window itself and stays in sync
 * with provider metadata. eve's `modelContextWindowTokens` is an escape hatch
 * for unlisted models only.
 */
/* 
= {
  starter: "anthropic/claude-haiku-4.5",
  growth: "anthropic/claude-sonnet-5",
  scale: "anthropic/claude-opus-4.8",
}; 
*/
import type { TenantPlan } from "./tenants";

/**
 * CEO-Nova, the root agent — the founder-facing brain that holds the whole
 * conversation and delegates to departments.
 *
 * This is also the compiled fallback in `agent.ts`, and in practice the model
 * most turns actually run on: the per-plan ladder below only resolves for
 * stores present in the tenant registry, so every store outside it (including
 * live Dakio tenants today) lands here.
 *
 * Sonnet, not Opus, for the ROOT: this model holds the real-time founder
 * chat, where latency is the product. Opus 4.8 made a simple 3-tool turn take
 * ~50s and pushed any subagent-delegating turn past the client's 180s abort —
 * the chatbox "talks forever". Sonnet 5 is ~2–3× faster to first token and
 * through generation at very close capability, which is the right trade for a
 * conversational surface. Bump to opus-4.8 only if a store needs the extra
 * reasoning and can tolerate the wait.
 */
export const ROOT_MODEL = "anthropic/claude-sonnet-5";
// export const ROOT_MODEL = "anthropic/claude-opus-4.8";
// export const ROOT_MODEL = "minimax/minimax-m3";

/**
 * The nine department subagents (finance, growth, inventory, marketing,
 * operations, product_research, sales, shipping, support).
 *
 * They run focused, short-lived, tool-heavy turns rather than holding a long
 * conversation, so they take the workhorse tier instead of the flagship — the
 * same mid-tier role they held before the MiniMax switch.
 */
// export const SUBAGENT_MODEL = "minimax/minimax-m2.7";
export const SUBAGENT_MODEL = "anthropic/claude-sonnet-5";

/**
 * Plan → model tier for the root agent, selected once per session.
 *
 * Unlike the Anthropic ladder this replaced, the tiers are priced identically
 * ($0.30/$1.20 per 1M in/out): the plan buys capability, not spend. M2.5 and
 * M2.7 carry a 205k context window; M3 adds the 1M window and vision.
 */

const MODEL_BY_PLAN: Record<TenantPlan, string> = {
  starter: "anthropic/claude-haiku-4.5",
  // starter: "minimax/minimax-m2.5",
  growth: "anthropic/claude-sonnet-5",
  // growth: "minimax/minimax-m2.7",
  scale: ROOT_MODEL,
};

/**
 * The model for a store's plan, or `null` to leave the scope unset so eve uses
 * the compiled fallback. Consumed by the dynamic model selector in `agent.ts`.
 *
 * Returns an ID STRING, never a provider object: eve only accepts serializable
 * selections at session/turn scope, and a live `LanguageModel` here is
 * rejected at runtime ("must be serializable") — which silently pinned every
 * tenant to the fallback model regardless of plan until it was caught.
 */
export function modelForPlan(plan: TenantPlan | string | undefined): string | null {
  if (plan && plan in MODEL_BY_PLAN) {
    return MODEL_BY_PLAN[plan as TenantPlan];
  }
  return null; // fall back to the agent's compiled default model
}

/**
 * Semantic-memory embeddings (`lib/memory/embed.ts`).
 *
 * Only reached under `NOVA_EMBEDDINGS=gateway`; the default path is a
 * deterministic local stub so eval runs stay reproducible without a key. The
 * gateway model returns 1024 dimensions, against the stub's own dimension —
 * see `EMBEDDING_DIM` there before switching backends on live data.
 */
export const EMBED_MODEL = "voyage/voyage-3.5-lite";
