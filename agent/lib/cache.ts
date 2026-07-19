/**
 * Tiny TTL cache with a per-tenant key convention.
 *
 * The blueprint puts the L1 tenant-profile behind Redis (`t:{storeId}:profile`,
 * TTL 24h) with a per-store prefix to prevent cross-tenant cache poisoning.
 * Redis is optional in dev, so this is the in-process fallback with the same
 * key shape and semantics — swap the two functions for a Redis client in
 * production without touching call sites.
 *
 * Keys are always built with `tenantKey(storeId, suffix)` so one store can
 * never read another's cached value.
 */

interface Entry {
  value: string;
  expiresAt: number;
}

const store = new Map<string, Entry>();

/** Build a tenant-scoped cache key, e.g. `t:store-aurora:profile`. */
export function tenantKey(storeId: string, suffix: string): string {
  return `t:${storeId}:${suffix}`;
}

/**
 * Return the cached value for `key`, or compute it with `fn`, cache it for
 * `ttlMs`, and return it. A `ttlMs <= 0` disables caching (always recompute).
 */
export async function getOrSet(
  key: string,
  ttlMs: number,
  fn: () => Promise<string>,
): Promise<string> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const value = await fn();
  if (ttlMs > 0) store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

/**
 * Invalidate cache entries. Pass a full key to bust one entry, or a
 * `t:{storeId}:` prefix to bust every cached layer for a tenant (called after
 * a config/memory write so a stale profile can't outlive the change).
 */
export function bust(keyOrPrefix: string): void {
  if (store.has(keyOrPrefix)) {
    store.delete(keyOrPrefix);
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(keyOrPrefix)) store.delete(key);
  }
}

/** Test helper: drop the entire cache. */
export function clearCache(): void {
  store.clear();
}

/** Standard TTLs referenced by the context layers. */
export const TTL = {
  /** L1 tenant profile — one Dakio profile read per store per day. */
  profile24h: 24 * 60 * 60 * 1000,
} as const;
