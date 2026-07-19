/**
 * Tenant-scoped store resolution — the replacement for the old ambient
 * `getStoreClient()` singleton.
 *
 * `storeFor(storeId)` returns the `StoreClient` bound to exactly one store.
 * The demo backend is a keyed map of `DemoStore` instances (one seeded
 * dataset per tenant), so two tenants live side by side in one process and
 * the isolation suite can prove they never cross. In production `storeFor`
 * constructs a Dakio HTTP client pinned to the tenant's service token; no
 * tool, executor, or context layer changes.
 *
 * Callers get the store id from `requireStore(ctx)` (verified auth) and pass
 * it here. `storeFor` never reads ambient state, so nothing can accidentally
 * resolve the "current" tenant from a global.
 */

import type { StoreSeed } from "../types";
import type { StoreClient } from "./client";
import { DemoStore } from "./backend";
import { createSeed } from "./seed";
import { createBeaconSeed } from "./seed-beacon";
import { requireStore, type TenantContext } from "../tenant";

/** Per-tenant seed builders, keyed by store id (see `tenants.ts` registry). */
const SEEDERS: Record<string, (nowMs: number) => StoreSeed> = {
  "store-aurora": createSeed,
  "store-beacon": createBeaconSeed,
};

/** Live per-store backends, created lazily on first access. */
const instances = new Map<string, DemoStore>();

/**
 * Resolve the store for a specific tenant. Pass a store id (from
 * `requireStore`) or a `SessionContext` (which resolves the id from auth).
 * Each store keeps its own isolated dataset for the life of the process.
 */
export function storeFor(storeIdOrCtx: string | TenantContext): StoreClient {
  const storeId =
    typeof storeIdOrCtx === "string" ? storeIdOrCtx : requireStore(storeIdOrCtx).storeId;

  let instance = instances.get(storeId);
  if (!instance) {
    const seeder = SEEDERS[storeId] ?? createSeed;
    instance = new DemoStore(seeder(Date.now()));
    instances.set(storeId, instance);
  }
  return instance;
}

/**
 * Drop cached backends. Test-only: lets the isolation suite start each case
 * from freshly seeded, independent tenants.
 */
export function resetStores(): void {
  instances.clear();
}
