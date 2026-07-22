/**
 * Session→tenant registry — the Stage 0 fix for subagent tenancy.
 *
 * eve gives declared-subagent sessions NO auth: `ctx.session.auth.current` and
 * `.initiator` are both null on internal runtime paths (eve
 * auth-and-route-protection guide). Phase 03 assumed auth flowed to subagents —
 * it doesn't, so `requireStore` inside a department tool used to fall through
 * to the `NOVA_DEV_STORE_ID` dev fallback: silently single-tenant in dev,
 * fail-closed (thrown) in prod.
 *
 * The fix: whenever a ROOT session's tenant is resolved from verified auth
 * (the tenant-guard `turn.started` hook — which fires before any delegation
 * in that turn), the pair is registered here. Inside a subagent session,
 * `requireStore` falls back to `ctx.session.parent.rootSessionId` and looks
 * the tenant up. Tenancy still never comes from model input: the delegation
 * message is model-authored and stays untrusted; this registry is written
 * only from server-verified auth.
 *
 * In-process by design (same trade-off as novaFeedBus): a process restart
 * mid-delegation loses the entry and the lookup FAILS CLOSED — never the
 * wrong tenant. The root's next turn re-registers via the hook.
 */

interface Entry {
  storeId: string;
  at: number;
}

const TTL_MS = 24 * 3600 * 1000;
const registry = new Map<string, Entry>();

function prune(now: number): void {
  if (registry.size < 512) return; // prune lazily; sessions are short-lived
  for (const [key, entry] of registry) {
    if (now - entry.at > TTL_MS) registry.delete(key);
  }
}

/** Register a root session's verified tenant. Idempotent; refreshes the TTL. */
export function registerSessionTenant(sessionId: string, storeId: string): void {
  const now = Date.now();
  prune(now);
  registry.set(sessionId, { storeId, at: now });
}

/** Look up the tenant registered for a root session. Null on miss (caller fails closed). */
export function lookupSessionTenant(rootSessionId: string): string | null {
  const entry = registry.get(rootSessionId);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    registry.delete(rootSessionId);
    return null;
  }
  return entry.storeId;
}

/** Test-only: clear the registry between suite sections. */
export function resetSessionTenants(): void {
  registry.clear();
}
