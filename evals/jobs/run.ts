/**
 * Phase 05 proactive-operations suite — the phase gate.
 *
 * No model or network needed: exercises `StoreClient`'s job-queue methods
 * directly against `DemoStore` (the real dispatcher's own claim/complete/
 * release contract, same code path `agent/schedules/dispatcher.ts` calls),
 * the tz/DST occurrence engine against the three REAL seeded tenant zones
 * (America/Los_Angeles, America/New_York, Asia/Dhaka — chosen in
 * `agent/lib/tenants.ts` specifically to span two DST-observing zones and
 * one fixed-offset zone), the widened trust-plane guard against the
 * scheduler's own synthetic principal, and the ported job prompts.
 *
 * Run with: npx -y tsx evals/jobs/run.ts
 */

import { randomUUID } from "node:crypto";

import approveAction from "../../agent/tools/approve_action";
import rejectAction from "../../agent/tools/reject_action";
import undoAction from "../../agent/tools/undo_action";
import configureAutonomy from "../../agent/tools/configure_autonomy";

import { storeFor, resetStores } from "../../agent/lib/store/resolve";
import { listTenants, isTenantActive, setTenantStatus } from "../../agent/lib/tenants";
import { tenantAppPrincipal } from "../../agent/lib/jobs/principal";
import { renderJobPrompt } from "../../agent/lib/jobs/prompts";
import { lastOccurrenceAtOrBefore, nextOccurrenceAfter, civilToUtc, isValidTimeZone } from "../../agent/lib/jobs/cron";
import type { NovaJob } from "../../agent/lib/types";

const AURORA = "store-aurora"; // America/Los_Angeles
const BEACON = "store-beacon"; // America/New_York
const DHAKA = "cmrl3wa6s0000132q7mdev915"; // Asia/Dhaka

// --- tiny assert framework --------------------------------------------------

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type ToolCtx = Parameters<typeof approveAction.execute>[1];

function schedulerCtx(storeId: string): ToolCtx {
  const auth = tenantAppPrincipal(storeId);
  return { session: { id: "ses-job", auth: { current: null, initiator: auth } } } as unknown as ToolCtx;
}

function ownerCtx(storeId: string): ToolCtx {
  const auth = {
    authenticator: "dakio",
    principalId: "owner-1",
    principalType: "user",
    attributes: { storeId, role: "owner", plan: "growth" },
  };
  return { session: { id: "ses-owner", auth: { current: auth, initiator: auth } } } as unknown as ToolCtx;
}

function findDstTransitions(year: number, tz: string): { day: number; from: number; to: number }[] {
  const transitions: { day: number; from: number; to: number }[] = [];
  let prev: number | null = null;
  for (let day = 0; day < 366; day++) {
    const probe = new Date(Date.UTC(year, 0, 1, 12, 0, 0) + day * 86_400_000);
    const civil = civilToUtc(probe.getUTCFullYear(), probe.getUTCMonth() + 1, probe.getUTCDate(), 12, 0, tz);
    if (!civil) continue;
    const offset = (civil.getTime() - probe.getTime()) / 60_000;
    if (prev !== null && offset !== prev) transitions.push({ day, from: prev, to: offset });
    prev = offset;
  }
  return transitions;
}

async function main(): Promise<void> {
  resetStores();

  // 1. tz/DST occurrence math against the three REAL seeded tenant zones.
  console.log("\n[1] Cron/tz occurrence engine — DST vectors across all 3 real tenant zones");
  for (const [label, tz] of [["Aurora (LA)", "America/Los_Angeles"], ["Beacon (NY)", "America/New_York"], ["Dhaka", "Asia/Dhaka"]] as const) {
    const transitions = findDstTransitions(2026, tz);
    const expectedTransitions = tz === "Asia/Dhaka" ? 0 : 2;
    check(`${label}: ${expectedTransitions} DST transitions in 2026`, transitions.length === expectedTransitions, `got ${transitions.length}`);

    let cursor = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    let allAt8 = true;
    for (let i = 0; i < 40; i++) {
      const occ = nextOccurrenceAfter("0 8 * * *", tz, cursor);
      if (!occ) {
        allAt8 = false;
        break;
      }
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(occ);
      const hour = Number(parts.find((p) => p.type === "hour")!.value);
      const minute = Number(parts.find((p) => p.type === "minute")!.value);
      if (hour !== 8 || minute !== 0) allAt8 = false;
      cursor = new Date(occ.getTime() + 20 * 3600_000);
    }
    check(`${label}: daily 08:00 local never drifts across ~40 occurrences`, allAt8);
  }

  check("isValidTimeZone rejects garbage", !isValidTimeZone("Not/AZone"));
  check("isValidTimeZone accepts a real IANA zone", isValidTimeZone("Asia/Dhaka"));

  const laTransitions = findDstTransitions(2026, "America/Los_Angeles");
  const springForward = laTransitions.find((t) => t.to < t.from)!;
  const dayUtc = new Date(Date.UTC(2026, 0, 1, 12, 0, 0) + springForward.day * 86_400_000);
  const gap = civilToUtc(dayUtc.getUTCFullYear(), dayUtc.getUTCMonth() + 1, dayUtc.getUTCDate(), 2, 30, "America/Los_Angeles");
  check("civilToUtc returns null in a DST spring-forward gap (LA 02:30)", gap === null);

  const t1 = lastOccurrenceAtOrBefore("0 8 * * *", "Asia/Dhaka", new Date(Date.UTC(2026, 6, 20, 2, 5, 0)));
  const t2 = lastOccurrenceAtOrBefore("0 8 * * *", "Asia/Dhaka", new Date(Date.UTC(2026, 6, 20, 2, 55, 0)));
  check("lastOccurrenceAtOrBefore is stable within the same due window (idempotent dedupeKey)", t1?.getTime() === t2?.getTime());

  // 2. DemoStore job engine — job-def validation, expand+lease, dedupe, watchdog, backoff.
  console.log("\n[2] DemoStore job engine — expand, lease, dedupe, watchdog, backoff");
  const aurora = storeFor(AURORA);

  let rejectedBadTz = false;
  try {
    await aurora.upsertJobDef("morning_report", { cadence: "0 8 * * *", tz: "Not/AZone" });
  } catch {
    rejectedBadTz = true;
  }
  check("upsertJobDef rejects an invalid tz (fail closed, not silently ignored)", rejectedBadTz);

  await aurora.upsertJobDef("night_ops", { cadence: "0 2 * * *", tz: "America/Los_Angeles" });
  const claim1 = await aurora.claimDueJobs(10);
  const nightOps1 = claim1.filter((j) => j.kind === "night_ops");
  check("claim expands a due def into exactly one leased job", nightOps1.length === 1, `got ${nightOps1.length}`);
  check("leased job carries a leaseUntil", nightOps1[0]?.leaseUntil != null);

  await aurora.completeJob(nightOps1[0].id, nightOps1[0].leaseToken!);
  const claim2 = await aurora.claimDueJobs(10);
  check("re-claiming the same occurrence does not re-expand a duplicate", claim2.filter((j) => j.kind === "night_ops").length === 0);

  // Watchdog: force a stale lease by leasing then rewinding leaseUntil into the past.
  await aurora.upsertJobDef("weekly_strategy", { cadence: "0 9 * * 1", tz: "America/Los_Angeles" });
  const leased = await aurora.claimDueJobs(10);
  const weekly = leased.find((j) => j.kind === "weekly_strategy");
  if (weekly) {
    const jobs = (aurora as unknown as { data: { jobs: NovaJob[] } }).data?.jobs;
    const row = jobs?.find((j) => j.id === weekly.id);
    if (row) row.leaseUntil = new Date(Date.now() - 60_000).toISOString();
  }
  const reclaimed = await aurora.claimDueJobs(10);
  check("a stale lease (past leaseUntil) is recovered by the next claim (watchdog)", !!weekly && reclaimed.some((j) => j.id === weekly.id));

  // Backoff / attempts cap. Attempts only increment at claim/lease time (both
  // backends agree on this), so simulate "already retried 5 times" by setting
  // the row directly rather than looping release calls.
  await aurora.upsertJobDef("pulse", { cadence: "0 9-21 * * *", tz: "America/Los_Angeles" });
  const pulseClaims = await aurora.claimDueJobs(10);
  const pulseJob = pulseClaims.find((j) => j.kind === "pulse");
  const jobRows = (aurora as unknown as { data: { jobs: NovaJob[] } }).data?.jobs;
  const pulseRow = jobRows?.find((j) => j.id === pulseJob?.id);
  check("pulse job was claimed for the backoff test", !!pulseJob && !!pulseRow);
  if (pulseRow) pulseRow.attempts = 5;
  if (pulseJob) await aurora.releaseJob(pulseJob.id, pulseJob.leaseToken!, "boom");
  const pulseAfter = jobRows?.find((j) => j.id === pulseJob?.id);
  check("a job released at the attempts cap ends up 'failed'", pulseAfter?.status === "failed", JSON.stringify(pulseAfter));

  // A fresh job (below the cap) backs off and stays 'due' instead.
  await aurora.upsertJobDef("cart_sweep", { cadence: "0 */4 * * *", tz: "America/Los_Angeles" });
  const cartClaim = (await aurora.claimDueJobs(10)).find((j) => j.kind === "cart_sweep");
  if (cartClaim) await aurora.releaseJob(cartClaim.id, cartClaim.leaseToken!, "transient error");
  const cartAfter = jobRows?.find((j) => j.id === cartClaim?.id);
  check(
    "a job released below the attempts cap stays 'due' with a future dueAt (backoff)",
    cartAfter?.status === "due" && !!cartAfter && Date.parse(cartAfter.dueAt) > Date.now(),
    JSON.stringify(cartAfter),
  );

  // Lease-fencing (adversarial-review finding, Phase 05): a stale caller
  // holding an OLD leaseToken (the row has since been re-leased with a NEW
  // one — e.g. the watchdog reclaimed a slow job while the original session
  // was still running) must be a safe no-op, never overwriting the newer
  // lease's outcome.
  await aurora.upsertJobDef("night_ops", { cadence: "0 2 * * *", tz: "America/Los_Angeles" });
  // Force a fresh due occurrence (yesterday's already got claimed/completed above).
  const fencingJobs = (aurora as unknown as { data: { jobs: NovaJob[] } }).data?.jobs;
  const fencingProbe = await aurora.claimDueJobs(10);
  const staleCandidate = fencingProbe.find((j) => j.kind === "night_ops") ?? fencingJobs?.find((j) => j.status === "leased");
  if (staleCandidate) {
    const staleToken = staleCandidate.leaseToken!;
    const row = fencingJobs?.find((j) => j.id === staleCandidate.id);
    if (row) {
      // Simulate the watchdog re-leasing this same row with a NEW token
      // while a stale caller still holds the OLD one.
      row.leaseToken = randomUUID();
      row.status = "leased";
    }
    await aurora.completeJob(staleCandidate.id, staleToken); // stale token — must be ignored
    const afterStaleComplete = fencingJobs?.find((j) => j.id === staleCandidate.id);
    check("a completeJob call with a superseded leaseToken is a safe no-op (status untouched)", afterStaleComplete?.status === "leased");

    await aurora.releaseJob(staleCandidate.id, staleToken, "stale release"); // also stale — must be ignored
    const afterStaleRelease = fencingJobs?.find((j) => j.id === staleCandidate.id);
    check("a releaseJob call with a superseded leaseToken is a safe no-op (status untouched)", afterStaleRelease?.status === "leased");
  } else {
    check("lease-fencing test had a job to exercise", false, "no night_ops job available to force a fencing scenario");
  }

  // Tenant isolation — Beacon's claim must never see Aurora's jobs.
  console.log("\n[3] Tenant isolation in the job queue");
  const beacon = storeFor(BEACON);
  await beacon.upsertJobDef("morning_report", { cadence: "0 8 * * *", tz: "America/New_York" });
  const beaconClaim = await beacon.claimDueJobs(10);
  check("Beacon's claim contains no Aurora dedupeKeys", beaconClaim.every((j) => !j.dedupeKey.includes("night_ops") && !j.dedupeKey.includes("weekly_strategy")));

  // 4. Kill switch — a paused tenant never appears in the dispatcher's candidate set.
  console.log("\n[4] Kill switch — dispatcher never enumerates a paused tenant");
  setTenantStatus(BEACON, "paused");
  const activeTenants = listTenants().filter((t) => isTenantActive(t.storeId));
  check("paused tenant excluded from the dispatcher's active-tenant list", !activeTenants.some((t) => t.storeId === BEACON));
  check("other tenants remain in the active list", activeTenants.some((t) => t.storeId === AURORA));
  setTenantStatus(BEACON, "active"); // restore

  // 5. Trust-plane guard — the scheduler's own synthetic principal must never pass.
  console.log("\n[5] Trust-plane guard denies the scheduler principal (principalType !== \"user\")");
  const schedCtx = schedulerCtx(AURORA);
  const approveAsScheduler = await approveAction.execute({ actionId: "action-none" }, schedCtx);
  check("approve_action denies the scheduler principal", "error" in approveAsScheduler);
  const rejectAsScheduler = await rejectAction.execute({ actionId: "action-none" }, schedCtx);
  check("reject_action denies the scheduler principal", "error" in rejectAsScheduler);
  const undoAsScheduler = await undoAction.execute({ actionId: "action-none" }, schedCtx);
  check("undo_action denies the scheduler principal", "error" in undoAsScheduler);
  const configAsScheduler = await configureAutonomy.execute({ level: 4 }, schedCtx);
  check("configure_autonomy denies the scheduler principal", "error" in configAsScheduler);

  // Sanity: the SAME tools work normally for a real owner (the guard isn't over-broad).
  const ownerConfig = await configureAutonomy.execute({ level: 2 }, ownerCtx(AURORA));
  check("configure_autonomy still works for a real owner principal", !("error" in ownerConfig), JSON.stringify(ownerConfig));

  // 6. Job prompts — all 6 kinds render, report-filing kinds carry the dedupeKey.
  console.log("\n[6] Job prompt templates");
  const kinds: NovaJob["kind"][] = ["morning_report", "pulse", "cart_sweep", "night_ops", "weekly_strategy", "reflection"];
  const reportFilingKinds = new Set(["morning_report", "pulse", "night_ops", "weekly_strategy"]);
  let reflectionPrompt = "";
  for (const kind of kinds) {
    const job: NovaJob = {
      id: "job-x",
      kind,
      payload: {},
      dueAt: new Date().toISOString(),
      priority: 5,
      status: "due",
      attempts: 0,
      lastError: null,
      dedupeKey: `${kind}:2026-07-20T08:00:00.000Z`,
      leaseUntil: null,
      leaseToken: null,
    };
    const prompt = renderJobPrompt(job);
    check(`${kind}: renders a non-empty prompt`, prompt.length > 20);
    if (reportFilingKinds.has(kind)) {
      check(`${kind}: prompt carries its own dedupeKey`, prompt.includes(job.dedupeKey));
    }
    if (kind === "reflection") reflectionPrompt = prompt;
  }
  check("reflection's prompt wires the new run_attribution step (Phase 04 gap closed)", reflectionPrompt.includes("run_attribution"));

  // --- summary ---------------------------------------------------------------
  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`PROACTIVE OPERATIONS SUITE PASSED — ${passed} checks green.`);
  } else {
    console.log(`PROACTIVE OPERATIONS SUITE FAILED — ${failures.length} of ${passed + failures.length} checks failed:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
