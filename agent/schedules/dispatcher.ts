/**
 * Proactive Operations Engine (Phase 05) — the ONLY authored production
 * schedule. eve's own scheduling is deliberately static: root-only files, one
 * cron each, UTC, fired for the deployment (not per tenant), task-mode
 * (cannot park). This is eve's documented dynamic-scheduling pattern (one
 * minute-level schedule + your own job rows + `receive` handoff) applied
 * per tenant: `nova_job_defs`/`nova_jobs` live in dakio-api (Nova has no
 * database of its own — every other phase's state lives there too), fronted
 * by `StoreClient.claimDueJobs`.
 *
 * Real deviation from the blueprint's literal pseudocode (`claimDueJobs(50)`
 * as one global call): every Nova service token is scoped to exactly one
 * tenant (dakio-api's `authenticateNovaService`), so there is no credential
 * that could claim across the whole fleet in one HTTP call — minting one
 * would be a new, more dangerous kind of cross-tenant credential this
 * codebase has never had. Looping tenants and calling `claimDueJobs` once per
 * ACTIVE tenant, each through that tenant's own token, keeps every claim
 * fully isolated (a bug here can't leak across tenants) at the cost of N
 * small HTTP round trips a minute instead of one big one — fine at fleet
 * scale (blueprint's own milestone: "10 dev tenants"), and it shards
 * naturally the same way Postgres SKIP LOCKED would.
 */

import { defineSchedule } from "eve/schedules";
import internal from "../channels/internal";
import { listTenants, isTenantActive } from "../lib/tenants";
import { storeFor } from "../lib/store/resolve";
import { tenantAppPrincipal } from "../lib/jobs/principal";
import { renderJobPrompt } from "../lib/jobs/prompts";

const JOBS_PER_TENANT_PER_TICK = 10;

export default defineSchedule({
  cron: "* * * * *",
  async run({ receive, waitUntil }) {
    const tenants = listTenants().filter((t) => isTenantActive(t.storeId));

    waitUntil(
      Promise.all(
        tenants.map(async (tenant) => {
          const client = storeFor(tenant.storeId);
          let jobs;
          try {
            jobs = await client.claimDueJobs(JOBS_PER_TENANT_PER_TICK);
          } catch {
            // This tenant's claim call failed (transient network/API issue) —
            // don't let it block other tenants' ticks; retried next minute.
            return;
          }

          await Promise.all(
            jobs.map((job) => {
              const leaseToken = job.leaseToken ?? "";
              return receive(internal, {
                message: renderJobPrompt(job),
                target: { storeId: tenant.storeId, jobId: job.id },
                auth: tenantAppPrincipal(tenant.storeId),
              }).then(
                // Two-arg .then, not .then().catch(): a failure to ACK
                // completion (e.g. dakio-api transiently unreachable) must
                // never be routed through releaseJob — the job's real work
                // already succeeded, so releasing it would requeue or even
                // permanently fail already-finished work. Swallow instead;
                // the stale-lease-safe contract on complete/release plus the
                // watchdog's time-based recovery reconcile it from here
                // (adversarial-review finding, Phase 05).
                () => client.completeJob(job.id, leaseToken).catch(() => undefined),
                (error) =>
                  client.releaseJob(job.id, leaseToken, error instanceof Error ? error.message : String(error)),
              );
            }),
          );
        }),
      ),
    );
  },
});
