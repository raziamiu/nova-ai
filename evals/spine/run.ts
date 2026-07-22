/**
 * Phase 06 (Stage 0 "Spine") suite — the phase gate's deterministic half.
 *
 *   1. Session→tenant registry     — register/lookup/reset semantics.
 *   2. Subagent tenancy regression — a no-auth (subagent-shaped) context
 *      resolves the ROOT session's tenant via parent lineage; a miss FAILS
 *      CLOSED even when NOVA_DEV_STORE_ID is set (the dev fallback must never
 *      mask a broken registry inside a delegation).
 *   3. Receipt assembly            — executed actions carry before/after +
 *      targetRef; refusals carry the fired gate rule as evidence.
 *   4. Undo window                 — undoable executions get executedAt+24h;
 *      a past-deadline undo writes an explained refusal record and throws.
 *   5. Approve keeps the undo right — the Stage 0 fix for the latent bug
 *      where approved actions were stored undoable:false forever.
 *
 * No model or network needed. Run with:  npx -y tsx evals/spine/run.ts
 */

import { performAction, approveAction, undoAction } from "../../agent/lib/nova/actions";
import { requireStore } from "../../agent/lib/tenant";
import {
  registerSessionTenant,
  lookupSessionTenant,
  resetSessionTenants,
} from "../../agent/lib/tenancy/registry";
import { storeFor, resetStores } from "../../agent/lib/store/resolve";
import type { TenantContext } from "../../agent/lib/tenant";

const AURORA = "store-aurora";

// --- tiny assert framework --------------------------------------------------

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function throws(fn: () => Promise<unknown> | unknown): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** A subagent-session-shaped context: NO auth, parent lineage only. */
function subagentCtx(rootSessionId: string): TenantContext {
  return {
    session: {
      auth: { current: null, initiator: null } as TenantContext["session"]["auth"],
      parent: { rootSessionId },
    },
  };
}

const RECEIPT = {
  reason: "Spine suite: exercising the pipeline deterministically end-to-end.",
  expectedImpact: "None — test artifact.",
  confidence: 0.9,
  evidence: [{ source: "spine-suite", note: "fixture receipt" }],
};

async function main(): Promise<void> {
  resetStores();
  resetSessionTenants();

  // 1. Registry semantics.
  console.log("\n[1] Session→tenant registry");
  check("miss returns null", lookupSessionTenant("ses-none") === null);
  registerSessionTenant("ses-root-1", AURORA);
  check("hit returns the registered store", lookupSessionTenant("ses-root-1") === AURORA);
  registerSessionTenant("ses-root-1", "store-beacon");
  check("re-register overwrites (root re-auth wins)", lookupSessionTenant("ses-root-1") === "store-beacon");
  resetSessionTenants();
  check("reset clears", lookupSessionTenant("ses-root-1") === null);

  // 2. Subagent tenancy regression (the Phase 03 assumption fix).
  console.log("\n[2] Subagent tenancy — lineage fallback, fail-closed on miss");
  const savedDevFallback = process.env.NOVA_DEV_STORE_ID;
  process.env.NOVA_DEV_STORE_ID = "store-aurora"; // adversarial: fallback armed
  try {
    const missMessage = await throws(() => requireStore(subagentCtx("ses-unregistered")));
    check(
      "unregistered delegation THROWS even with NOVA_DEV_STORE_ID set",
      missMessage !== null && missMessage.includes("No tenant registered"),
      missMessage ?? "did not throw",
    );
    registerSessionTenant("ses-root-2", AURORA);
    const scope = requireStore(subagentCtx("ses-root-2"));
    check("registered delegation resolves the root's tenant", scope.storeId === AURORA);
    check("subagent principal is never a user (trust plane stays denied)", scope.role === "staff" && scope.userId === "nova:subagent");
  } finally {
    if (savedDevFallback === undefined) delete process.env.NOVA_DEV_STORE_ID;
    else process.env.NOVA_DEV_STORE_ID = savedDevFallback;
  }

  // 3. Receipt assembly through the pipeline.
  console.log("\n[3] Receipt assembly (executed + refused)");
  resetStores();
  const client = storeFor(AURORA);
  const level4 = { ...(await client.getAutonomy()), level: 4 as const };
  await client.setAutonomy(level4);

  const executed = await performAction(client, {
    type: "update_price",
    department: "finance",
    title: "Reprice carafe set",
    payload: { productId: "prod-carafe", newPrice: 34 },
    receipt: RECEIPT,
  });
  check("level-4 low-risk action executed", executed.status === "executed", executed.detail);
  const executedRecord = await client.getAction(executed.actionId);
  check("executed receipt carries before/after snapshots", !!executedRecord?.receipt.before && !!executedRecord?.receipt.after);
  check("executed record carries targetRef", executedRecord?.targetRef === "product:prod-carafe");
  check("executed record actor is nova", executedRecord?.actor === "nova");
  check(
    "justification is the derived projection of the receipt",
    executedRecord?.justification.reason === RECEIPT.reason &&
      executedRecord?.justification.confidence === RECEIPT.confidence,
  );

  const refused = await performAction(client, {
    type: "create_discount",
    department: "sales",
    title: "Create 60% discount MEGA60",
    payload: { code: "MEGA60", percentOff: 60, scope: "order", expiresInDays: 7 },
    receipt: RECEIPT,
  });
  check("guardrail-violating discount is blocked", refused.status === "blocked", refused.detail);
  const refusedRecord = await client.getAction(refused.actionId);
  check(
    "the refusal's receipt cites the fired gate rule as evidence",
    !!refusedRecord?.receipt.evidence.some((e) => e.source === "authority_gate"),
    JSON.stringify(refusedRecord?.receipt.evidence),
  );

  // 4. Undo window.
  console.log("\n[4] Undo is a right with a clock (24h)");
  check(
    "undoable execution got executedAt+24h undoDeadline",
    !!executedRecord?.undoDeadline &&
      Date.parse(executedRecord.undoDeadline) - Date.parse(executedRecord.executedAt ?? "") === 24 * 3600 * 1000,
    `deadline=${executedRecord?.undoDeadline} executedAt=${executedRecord?.executedAt}`,
  );
  // Time-travel the in-memory record past its window, then attempt the undo.
  if (executedRecord) {
    executedRecord.undoDeadline = new Date(Date.now() - 60_000).toISOString();
  }
  const expiredMessage = await throws(() => undoAction(client, executed.actionId));
  check("past-deadline undo throws an explainable refusal", expiredMessage !== null && expiredMessage.includes("Undo window expired"));
  const refusalRecords = await client.listActions("blocked");
  check(
    "the refused undo is itself a persisted, receipted event",
    refusalRecords.some(
      (a) => a.title.startsWith("Undo refused:") && a.actor === "system" && a.receipt.evidence.some((e) => e.source === "undo_window"),
    ),
  );
  // Restore the window: the undo then succeeds and stamps undoneAt.
  if (executedRecord) {
    executedRecord.undoDeadline = new Date(Date.now() + 3600_000).toISOString();
  }
  const undone = await undoAction(client, executed.actionId);
  check("in-window undo succeeds", undone.detail.length > 0);
  const undoneRecord = await client.getAction(executed.actionId);
  check("undone record carries undoneAt", undoneRecord?.status === "undone" && !!undoneRecord?.undoneAt);

  // 5. Approve keeps the undo right (regression for the fixed latent bug).
  console.log("\n[5] Approved actions keep their undo right");
  const level2 = { ...(await client.getAutonomy()), level: 2 as const };
  await client.setAutonomy(level2);
  const prepared = await performAction(client, {
    type: "update_price",
    department: "finance",
    title: "Reprice diffuser",
    payload: { productId: "prod-diffuser", newPrice: 29 },
    receipt: RECEIPT,
  });
  check("level-2 action is prepared", prepared.status === "prepared", prepared.detail);
  const preparedRecord = await client.getAction(prepared.actionId);
  check("prepared row is not yet undoable", preparedRecord?.undoable === false);
  await approveAction(client, prepared.actionId);
  const approvedRecord = await client.getAction(prepared.actionId);
  check("approved execution is undoable", approvedRecord?.undoable === true);
  check("approved execution got its undo window", !!approvedRecord?.undoDeadline);
  const undoneApproved = await undoAction(client, prepared.actionId);
  check("approved-then-undone round-trips", undoneApproved.detail.length > 0);

  // --- summary ---------------------------------------------------------------
  console.log("\n" + "=".repeat(60));
  if (failures.length > 0) {
    console.error(`SPINE SUITE FAILED — ${failures.length} failing, ${passed} passing.`);
    process.exit(1);
  }
  console.log(`SPINE SUITE PASSED — ${passed} checks green.`);
}

main().catch((error) => {
  console.error("Suite crashed:", error);
  process.exit(1);
});
