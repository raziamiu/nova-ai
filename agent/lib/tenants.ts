/**
 * The tenant registry — Nova's `nova_tenants` table.
 *
 * One row per store: kill-switch status, plan (→ model tier), timezone, and
 * the identity facts the context engine renders into the L1 tenant profile.
 * In production this is a `store_id`-keyed Postgres table; here it is an
 * in-process map seeded with the two demo tenants so the isolation suite can
 * run two stores on one deployment. The Redis flags in the blueprint
 * (`t:{storeId}:paused`) are a cache in front of the `status` column — the
 * column is authoritative and is what we model here.
 *
 * Nothing tenant-specific lives on disk as prompt text. A store's
 * "personality" is data: the row below plus its brand/goals memory.
 */

export type TenantStatus = "active" | "paused";

/** Billing plan → model tier. Selection happens once at session start. */
export type TenantPlan = "starter" | "growth" | "scale";

export interface TenantRecord {
  readonly storeId: string;
  /** Storefront display name, rendered into the L1 profile. */
  readonly name: string;
  /** Commerce vertical, e.g. "Home & lifestyle DTC". */
  readonly vertical: string;
  readonly currency: string;
  readonly locale: string;
  readonly timezone: string;
  /** Kill switch. `paused` ⇒ every turn is refused before any model spend. */
  status: TenantStatus;
  readonly plan: TenantPlan;
  /** One-line brand voice summary for the profile header (full voice lives in brand memory). */
  readonly voiceSummary: string;
  /** The signature the store signs customer messages with. */
  readonly signature: string;
}

/* The plan → model mapping (`modelForPlan`) lives in `lib/models.ts`, the one
 * registry for every model id in the repo. `TenantPlan` above is its key. */

/** The two seeded demo tenants. Store ids match the keys in `resolve.ts`. */
const TENANTS = new Map<string, TenantRecord>([
  [
    "store-aurora",
    {
      storeId: "store-aurora",
      name: "Aurora Living",
      vertical: "Home & lifestyle DTC",
      currency: "USD",
      locale: "en-US",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "growth",
      voiceSummary: "Warm, unhurried, quietly premium — no exclamation marks or emoji.",
      signature: "Nova at Aurora Living",
    },
  ],
  [
    "store-beacon",
    {
      storeId: "store-beacon",
      name: "Beacon Supply Co",
      vertical: "B2B industrial & janitorial supply",
      currency: "USD",
      locale: "en-US",
      timezone: "America/New_York",
      status: "active",
      plan: "scale",
      voiceSummary: "Direct, efficient, spec-driven — built for busy facilities buyers.",
      signature: "Nova — Beacon Supply Co",
    },
  ],
  // Live Dakio dev tenant (Phase 02, local TUI testing against a real store).
  [
    "cmrl3wa6s0000132q7mdev915",
    {
      storeId: "cmrl3wa6s0000132q7mdev915",
      name: "Mayer Doya Store",
      vertical: "General commerce",
      currency: "BDT",
      locale: "en-BD",
      timezone: "Asia/Dhaka",
      status: "active",
      plan: "growth",
      voiceSummary: "Default voice — replace once the store's brand memory is set.",
      signature: "Nova at Mayer Doya Store",
    },
  ],
  // Second live Dakio dev tenant (admin.dakio@gmail.com) — provisioned so the
  // founder can drive Nova from that store's dashboard. Its own scoped service
  // token lives in NOVA_SERVICE_TOKENS (never the Mayer Doya fallback).
  [
    "cmrm6rzoz0003stc0uxugcq1d",
    {
      storeId: "cmrm6rzoz0003stc0uxugcq1d",
      name: "Dakio",
      vertical: "General commerce",
      currency: "BDT",
      locale: "en-BD",
      timezone: "Asia/Dhaka",
      status: "active",
      plan: "growth",
      voiceSummary: "Default voice — replace once the store's brand memory is set.",
      signature: "Nova at Dakio",
    },
  ],
]);

/** Every known tenant (for the isolation suite and fleet-wide dev tooling). */
export function listTenants(): TenantRecord[] {
  return [...TENANTS.values()];
}

/** Look up a tenant row, or `null` for an unknown store. */
export function getTenant(storeId: string): TenantRecord | null {
  return TENANTS.get(storeId) ?? null;
}

/**
 * The kill switch. A store is servable only when it exists and is `active`.
 * Called before any model spend by the `turn.started` guard hook.
 */
export function isTenantActive(storeId: string): boolean {
  return TENANTS.get(storeId)?.status === "active";
}

/**
 * Flip a tenant's kill switch. Returns the new status, or `null` if the store
 * is unknown. (In production this writes the `nova_tenants.status` column and
 * busts the `t:{storeId}:paused` flag; here it mutates the in-process row.)
 */
export function setTenantStatus(storeId: string, status: TenantStatus): TenantStatus | null {
  const record = TENANTS.get(storeId);
  if (!record) return null;
  record.status = status;
  return status;
}
