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

let tokenMapCache: Record<string, string> | null = null;

/**
 * Per-tenant service tokens as `NOVA_SERVICE_TOKENS='{"storeId":"token",...}'`
 * (mint each with dakio-api's `scripts/nova-mint-token.mjs <tenantId>`).
 *
 * Phase 05 fix: every `DakioStoreClient` used to be built from the SAME
 * single `NOVA_SERVICE_TOKEN`, regardless of which `storeId` was requested —
 * a real cross-tenant hole once more than one tenant runs in the same
 * deployment (every tenant's client silently resolved to whichever tenant
 * the one token was minted for; dakio-api's own auth would have enforced
 * THAT tenant correctly, but Nova would be reading/writing the wrong
 * store's data without any error). `NOVA_SERVICE_TOKENS` is additive —
 * `NOVA_SERVICE_TOKEN` alone still works for a single dev tenant.
 */
function tokenMap(): Record<string, string> {
  if (tokenMapCache) return tokenMapCache;
  const raw = process.env.NOVA_SERVICE_TOKENS;
  if (!raw) {
    tokenMapCache = {};
    return tokenMapCache;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("NOVA_SERVICE_TOKENS must be valid JSON: { \"storeId\": \"token\", ... }");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("NOVA_SERVICE_TOKENS must be a JSON object of { storeId: token }");
  }
  tokenMapCache = parsed as Record<string, string>;
  return tokenMapCache;
}

/** Build the live Dakio HTTP client for a tenant, pinned to THAT tenant's own service token. */
function makeDakioClient(storeId: string): DakioStoreClient {
  const baseUrl = process.env.DAKIO_API_URL;
  // Per-tenant token first; NOVA_SERVICE_TOKEN is the single-tenant fallback
  // (kept for the existing one-dev-store setup, not a silent fleet default).
  const token = tokenMap()[storeId] ?? process.env.NOVA_SERVICE_TOKEN;
  if (!baseUrl) throw new Error("NOVA_STORE_BACKEND=dakio requires DAKIO_API_URL");
  if (!token) {
    throw new Error(
      `NOVA_STORE_BACKEND=dakio requires a service token for store '${storeId}' — set it in NOVA_SERVICE_TOKENS or (single-tenant only) NOVA_SERVICE_TOKEN`,
    );
  }
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
