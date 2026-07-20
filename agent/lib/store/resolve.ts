/**
 * Tenant-scoped store resolution — the replacement for the old ambient
 * `getStoreClient()` singleton.
 *
 * `storeFor(storeId)` returns the `StoreClient` bound to exactly one store.
 * The backend is chosen by `NOVA_STORE_BACKEND` (Phase 02):
 *
 *   - `demo` (default): a keyed map of `DemoStore` instances (one seeded
 *     dataset per tenant), so two tenants live side by side in one process and
 *     the isolation suite can prove they never cross. Deterministic, no network.
 *   - `dakio`: a `DakioStoreClient` per tenant, pinned to the tenant's Nova
 *     service token, talking to the live Dakio Express backend over HTTPS. No
 *     tool, executor, or context-layer changes — the interface held.
 *
 * Callers get the store id from `requireStore(ctx)` (verified auth) and pass
 * it here. `storeFor` never reads ambient state, so nothing can accidentally
 * resolve the "current" tenant from a global.
 */

import type { StoreSeed } from "../types";
import type { StoreClient } from "./client";
import { DemoStore } from "./backend";
import { DakioStoreClient } from "./dakio";
import { createSeed } from "./seed";
import { createBeaconSeed } from "./seed-beacon";
import { requireStore, type TenantContext } from "../tenant";

/** Per-tenant seed builders, keyed by store id (see `tenants.ts` registry). */
const SEEDERS: Record<string, (nowMs: number) => StoreSeed> = {
  "store-aurora": createSeed,
  "store-beacon": createBeaconSeed,
};

/** Live per-store backends, created lazily on first access. */
const instances = new Map<string, StoreClient>();

/** Which backend `storeFor` builds. Defaults to the deterministic demo store. */
function backendMode(): "demo" | "dakio" {
  return process.env.NOVA_STORE_BACKEND === "dakio" ? "dakio" : "demo";
}

/**
 * Build the live Dakio HTTP client for a tenant. Phase 2.1 targets a single
 * dev store, so the service token comes from one env var; per-tenant token
 * provisioning (a token map / mint-on-demand) arrives with the Phase 03 fleet.
 */
function makeDakioClient(storeId: string): DakioStoreClient {
  const baseUrl = process.env.DAKIO_API_URL;
  const token = process.env.NOVA_SERVICE_TOKEN;
  if (!baseUrl) throw new Error("NOVA_STORE_BACKEND=dakio requires DAKIO_API_URL");
  if (!token) throw new Error("NOVA_STORE_BACKEND=dakio requires NOVA_SERVICE_TOKEN");
  return new DakioStoreClient(storeId, { baseUrl, token });
}

function makeClient(storeId: string): StoreClient {
  if (backendMode() === "dakio") return makeDakioClient(storeId);
  const seeder = SEEDERS[storeId] ?? createSeed;
  return new DemoStore(seeder(Date.now()));
}

/**
 * Resolve the store for a specific tenant. Pass a store id (from
 * `requireStore`) or a `SessionContext` (which resolves the id from auth).
 * Each store keeps its own isolated backend for the life of the process.
 */
export function storeFor(storeIdOrCtx: string | TenantContext): StoreClient {
  const storeId =
    typeof storeIdOrCtx === "string" ? storeIdOrCtx : requireStore(storeIdOrCtx).storeId;

  let instance = instances.get(storeId);
  if (!instance) {
    instance = makeClient(storeId);
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
