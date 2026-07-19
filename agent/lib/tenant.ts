/**
 * The one tenancy guard. Every tool derives its store from here, and from
 * verified auth only — never from a tool argument, a prompt, or a remote API
 * response. A tool that accepted `storeId` as input would be a cross-tenant
 * hole; `requireStore(ctx)` closes it by reading the store off the session's
 * authenticated principal.
 *
 * Tenancy comes from `ctx.session.auth.current` (the caller on this turn),
 * falling back to `ctx.session.auth.initiator` (who started the session) —
 * scheduled/background runs carry the tenant on the initiator (Phase 05).
 */

import type { SessionAuth, SessionAuthContext } from "eve/context";

/**
 * The minimal context shape the tenancy guard needs: any object exposing the
 * session's auth. Both `ToolContext`/`SessionContext` (tools, hooks) and
 * `DynamicResolveContext` (instruction/model resolvers) satisfy it, so one
 * guard serves every call site.
 */
export interface TenantContext {
  readonly session: { readonly auth: SessionAuth };
}

export interface StoreScope {
  storeId: string;
  userId: string;
  role: string;
}

/** Roles allowed to operate the trust plane (approve/reject/undo/configure). */
const OWNER_ROLES = new Set(["owner", "admin"]);

export function isOwnerRole(role: string | undefined): boolean {
  return typeof role === "string" && OWNER_ROLES.has(role);
}

/** Read a single string attribute, tolerating the `string | string[]` shape. */
function attr(auth: SessionAuthContext | null | undefined, key: string): string | undefined {
  const value = auth?.attributes?.[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].length > 0) return value[0];
  return undefined;
}

/**
 * Dev/scheduler fallback store. Fails closed by default: it returns a store
 * ONLY when `NOVA_DEV_STORE_ID` is explicitly set, and never for a Dakio
 * principal (who must carry `storeId` on the JWT). So a loopback/local-dev or
 * scheduled principal resolves to a tenant only in an environment that opted
 * in — a production deployment that never sets the var can't silently grant a
 * live tenant to an unauthenticated caller.
 */
function devFallbackStoreId(auth: SessionAuthContext | null): string | undefined {
  if (auth?.authenticator === "dakio") return undefined; // production user without a store → fail closed
  return process.env.NOVA_DEV_STORE_ID ?? undefined; // opt-in only
}

/**
 * Resolve the store for this session without throwing. Returns `null` when no
 * store can be determined. Use this in best-effort paths (context layers,
 * model selection) that should degrade gracefully rather than fail the turn.
 */
export function resolveStoreId(ctx: TenantContext): string | null {
  const auth = ctx.session.auth.current ?? ctx.session.auth.initiator;
  return attr(ctx.session.auth.current, "storeId") ?? attr(ctx.session.auth.initiator, "storeId") ?? devFallbackStoreId(auth) ?? null;
}

/**
 * The tenancy gate used by every tool. Fails closed: a missing or empty
 * storeId throws before any data access, so a tool can never read or write
 * another tenant's data.
 */
export function requireStore(ctx: TenantContext): StoreScope {
  const auth = ctx.session.auth.current ?? ctx.session.auth.initiator;
  const storeId =
    attr(ctx.session.auth.current, "storeId") ??
    attr(ctx.session.auth.initiator, "storeId") ??
    devFallbackStoreId(auth);

  if (typeof storeId !== "string" || storeId.length === 0) {
    throw new Error("No authenticated store for this session.");
  }

  return {
    storeId,
    userId: auth?.principalId ?? "unknown",
    // Least privilege: a token without a role claim is NOT an owner. Trust-plane
    // tools (approve/reject/undo/configure) require an explicit owner/admin role.
    role: attr(auth, "role") ?? "staff",
  };
}
