/**
 * Phase 03 isolation suite — the phase gate.
 *
 * Runs two seeded tenants (A = Aurora Living / store-aurora, B = Beacon Supply
 * Co / store-beacon) side by side in one process and proves, on real tool
 * OUTPUTS, that nothing crosses:
 *
 *   1. Data isolation      — A's reads never contain B's records (and vice versa).
 *   2. Action isolation    — an action A prepares never appears in B's queue.
 *   3. Tenancy-from-auth    — a forged "use store B" input still returns A's data;
 *                             naming B's id from A's session fails, B is untouched.
 *   4. Kill switch          — a paused tenant's turn is refused by the guard hook.
 *   5. Memory isolation     — a memory A writes is invisible to B.
 *
 * Plus JWT verification unit tests (bad signature, wrong audience, expired) and
 * a context-budget check (per-layer + total ≤ 2.5k tokens).
 *
 * No model or network is needed: tools are invoked directly with a synthetic,
 * verified auth context. Run with:  npx -y tsx evals/isolation/run.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHmac } from "node:crypto";

import getProducts from "../../agent/tools/get_products";
import getBusinessSnapshot from "../../agent/tools/get_business_snapshot";
import detectAnomalies from "../../agent/tools/detect_anomalies";
import listActions from "../../agent/tools/list_actions";
import createCampaign from "../../agent/tools/create_campaign";
import updateCampaign from "../../agent/tools/update_campaign";
import remember from "../../agent/tools/remember";
import recall from "../../agent/tools/recall";
import approveAction from "../../agent/tools/approve_action";

import tenantGuard from "../../agent/hooks/tenant-guard";
import { requireStore, resolveStoreId } from "../../agent/lib/tenant";
import { storeFor, resetStores } from "../../agent/lib/store/resolve";
import { retrieveRelevant } from "../../agent/lib/memory/service";
import { setTenantStatus } from "../../agent/lib/tenants";
import { verifyDakioJwt } from "../../agent/lib/auth/dakio-jwt";
import {
  buildTenantProfile,
  buildLiveOps,
  buildRelevantMemory,
  LAYER_BUDGET,
} from "../../agent/lib/context/layers";

const AURORA = "store-aurora";
const BEACON = "store-beacon";

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

// --- synthetic contexts (a verified Dakio principal) ------------------------

type Ctx = Parameters<typeof getProducts.execute>[1];

function ctxFor(
  storeId: string,
  opts: { role?: string; initiatorStoreId?: string; userId?: string } = {},
): Ctx {
  const mk = (sid: string) => ({
    authenticator: "dakio",
    principalId: opts.userId ?? "user-1",
    principalType: "user",
    subject: opts.userId ?? "user-1",
    attributes: { storeId: sid, role: opts.role ?? "owner", plan: "growth" },
  });
  const current = mk(storeId);
  const initiator = mk(opts.initiatorStoreId ?? storeId);
  return { session: { id: "ses-test", auth: { current, initiator } } } as unknown as Ctx;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// --- the suite --------------------------------------------------------------

async function main(): Promise<void> {
  resetStores();

  // 1. Data isolation — products.
  console.log("\n[1] Data isolation (products)");
  const aProducts = (await getProducts.execute({}, ctxFor(AURORA))).products;
  const bProducts = (await getProducts.execute({}, ctxFor(BEACON))).products;
  const aIds = new Set(aProducts.map((p) => p.id));
  const bIds = new Set(bProducts.map((p) => p.id));
  const aSkus = new Set(aProducts.map((p) => p.sku));
  const bSkus = new Set(bProducts.map((p) => p.sku));
  check("A sees products, B sees products", aProducts.length > 0 && bProducts.length > 0);
  check(
    "no product id appears in both tenants",
    [...aIds].every((id) => !bIds.has(id)),
    "shared id detected",
  );
  check(
    "no B SKU leaks into A's product list",
    [...aSkus].every((s) => !bSkus.has(s)) && aProducts.every((p) => p.sku.startsWith("AUR-")),
  );
  check("B's products are all Beacon SKUs", bProducts.every((p) => p.sku.startsWith("BCN-")));

  // 2. Action isolation — a NEW prepared action in A is invisible to B.
  console.log("\n[2] Action isolation (prepared-action queue)");
  const created = await createCampaign.execute(
    {
      name: "Isolation Probe Campaign",
      channel: "meta",
      dailyBudget: 25,
      productIds: [aProducts[0].id],
      startNow: true,
      notes: "isolation-suite probe",
      justification: {
        reason: "Isolation test: create a prepared action under Aurora only.",
        expectedImpact: "None — test artifact.",
        confidence: 0.5,
      },
    },
    ctxFor(AURORA),
  );
  const newActionId = "actionId" in created ? created.actionId : "";
  check("A's create_campaign produced an action", newActionId.length > 0, JSON.stringify(created));
  const aActions = await listActions.execute({}, ctxFor(AURORA));
  const bActions = await listActions.execute({}, ctxFor(BEACON));
  const actionIdsOf = (r: unknown): string[] => {
    const actions = (r as { actions?: { id: string }[] }).actions;
    return Array.isArray(actions) ? actions.map((a) => a.id) : [];
  };
  const aActionIds = actionIdsOf(aActions);
  const bActionIds = actionIdsOf(bActions);
  check("the new action is in A's queue", aActionIds.includes(newActionId));
  check("the new action is NOT in B's queue", !bActionIds.includes(newActionId));
  check(
    "A and B action queues share no ids",
    aActionIds.every((id) => !bActionIds.includes(id)),
  );

  // 3. Tenancy from auth only — forged input can't repoint the store.
  console.log("\n[3] Tenancy from verified auth only");
  const forgedCtx = ctxFor(AURORA);
  // Simulate a prompt/tool trying to force store B via arbitrary input fields.
  const forgedInput = { storeId: BEACON, store: BEACON, tenant: BEACON } as never;
  check("requireStore ignores forged input, resolves the authed store", requireStore(forgedCtx).storeId === AURORA);
  const forgedProducts = (await getProducts.execute(forgedInput, forgedCtx)).products;
  check(
    "forged-store read still returns ONLY Aurora products",
    forgedProducts.length === aProducts.length && forgedProducts.every((p) => p.sku.startsWith("AUR-")),
  );
  // Naming B's campaign id from A's session must not touch B's data — even
  // when A is at full autonomy and the action executes immediately.
  const beaconCampaignBefore = await storeFor(BEACON).getCampaign("bcmp-search");
  const auroraStore = storeFor(AURORA);
  const savedAutonomy = await auroraStore.getAutonomy();
  await auroraStore.setAutonomy({ ...savedAutonomy, level: 4 }); // auto-execute
  let crossFailed = false;
  try {
    await updateCampaign.execute(
      {
        campaignId: "bcmp-search",
        status: "paused",
        justification: {
          reason: "Isolation test: attempt to reach across tenants by id.",
          expectedImpact: "Should fail — not this store's campaign.",
          confidence: 0.1,
        },
      } as never,
      ctxFor(AURORA),
    );
  } catch {
    crossFailed = true; // executor could not find B's campaign in A's store
  }
  await auroraStore.setAutonomy(savedAutonomy); // restore
  const beaconCampaignAfter = await storeFor(BEACON).getCampaign("bcmp-search");
  check("A executing against B's campaign id fails (id not in A's store)", crossFailed);
  check(
    "B's campaign is unchanged after the cross-tenant attempt",
    beaconCampaignBefore?.status === beaconCampaignAfter?.status && beaconCampaignAfter?.status === "active",
  );

  // 4. Kill switch — a paused tenant's turn is refused by the guard hook.
  console.log("\n[4] Kill switch (paused tenant refused)");
  const guardTurn = tenantGuard.events?.["turn.started"];
  check("guard hook subscribes to turn.started", typeof guardTurn === "function");
  const evt = {} as never;
  let activeThrew = false;
  try {
    await guardTurn?.(evt, ctxFor(AURORA) as never);
  } catch {
    activeThrew = true;
  }
  check("active tenant turn is allowed", !activeThrew);

  setTenantStatus(BEACON, "paused");
  let pausedThrew = false;
  try {
    await guardTurn?.(evt, ctxFor(BEACON) as never);
  } catch {
    pausedThrew = true;
  }
  check("paused tenant turn is refused", pausedThrew);
  setTenantStatus(BEACON, "active"); // restore

  // 4b. Session pinning — a follow-up carrying a different store is refused.
  let mismatchThrew = false;
  try {
    await guardTurn?.(evt, ctxFor(BEACON, { initiatorStoreId: AURORA }) as never);
  } catch {
    mismatchThrew = true;
  }
  check("cross-store session hijack (current≠initiator) is refused", mismatchThrew);

  // 4c. Unknown/unprovisioned store is refused (kill switch fails closed).
  let unknownThrew = false;
  try {
    await guardTurn?.(evt, ctxFor("store-ghost") as never);
  } catch {
    unknownThrew = true;
  }
  check("unknown/unprovisioned store is refused", unknownThrew);

  // 4d. Least privilege: a token with no role claim cannot use the trust plane.
  const noRoleCtx = {
    session: {
      id: "ses-norole",
      auth: {
        current: {
          authenticator: "dakio",
          principalId: "staffer",
          principalType: "user",
          attributes: { storeId: AURORA, plan: "growth" },
        },
        initiator: null,
      },
    },
  } as unknown as Ctx;
  check("missing role defaults to least-privilege (not owner)", requireStore(noRoleCtx).role === "staff");
  const approveAsStaff = await approveAction.execute({ actionId: "action-8001" }, noRoleCtx);
  check("no-role caller is denied approve_action", "error" in approveAsStaff);

  // 5. Memory isolation — a memory A writes is invisible to B.
  console.log("\n[5] Memory isolation");
  await remember.execute(
    { namespace: "insights", key: "iso-secret-a", value: "Aurora-only secret insight." },
    ctxFor(AURORA),
  );
  const aRecall = await recall.execute({}, ctxFor(AURORA));
  const bRecall = await recall.execute({}, ctxFor(BEACON));
  const aKeys = "entries" in aRecall ? aRecall.entries.map((e) => e.key) : [];
  const bKeys = "entries" in bRecall ? bRecall.entries.map((e) => e.key) : [];
  check("A can recall its own new memory", aKeys.includes("iso-secret-a"));
  check("B cannot see A's memory", !bKeys.includes("iso-secret-a"));
  check(
    "B's memory contains no Aurora keys",
    !bKeys.includes("amelia-chen") && bKeys.includes("summit-facilities"),
  );

  // 5b. Vector-recall isolation — A's embeddings never enter B's ranking
  // (Phase 04: semantic retrieval must respect the same tenant boundary).
  const aVec = await retrieveRelevant(AURORA, "Aurora-only secret insight");
  const bVec = await retrieveRelevant(BEACON, "Aurora-only secret insight");
  check("A's vector recall can surface A's own memory", aVec.some((r) => r.entry.key === "iso-secret-a"));
  check(
    "B's vector recall never returns A's memory (no cross-tenant vectors)",
    bVec.every((r) => r.entry.key !== "iso-secret-a"),
  );

  // 6. JWT verification unit tests.
  console.log("\n[6] Dakio JWT verification");
  const SECRET = "test-secret";
  const cfg = { secret: SECRET, issuer: "https://auth.dakio.test", audience: "nova", nowSec: 1_000_000 };
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const sign = (payload: Record<string, unknown>, secret = SECRET) => {
    const h = b64({ alg: "HS256", typ: "JWT" });
    const p = b64(payload);
    const s = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
    return `${h}.${p}.${s}`;
  };
  const goodClaims = {
    sub: "user-9",
    storeId: AURORA,
    role: "owner",
    plan: "growth",
    iss: "https://auth.dakio.test",
    aud: "nova",
    exp: 1_000_600,
  };
  check("valid token verifies with storeId", verifyDakioJwt(sign(goodClaims), cfg)?.storeId === AURORA);
  check("tampered signature is rejected", verifyDakioJwt(sign(goodClaims) + "x", cfg) === null);
  check(
    "wrong audience is rejected",
    verifyDakioJwt(sign({ ...goodClaims, aud: "other-app" }), cfg) === null,
  );
  check(
    "expired token is rejected",
    verifyDakioJwt(sign({ ...goodClaims, exp: 999_000 }), cfg) === null,
  );
  check(
    "token without exp is rejected (no non-expiring tokens)",
    verifyDakioJwt(sign({ ...goodClaims, exp: undefined }), cfg) === null,
  );
  check(
    "wrong signing key is rejected",
    verifyDakioJwt(sign(goodClaims, "attacker-secret"), cfg) === null,
  );
  check(
    "token without storeId is rejected",
    verifyDakioJwt(sign({ ...goodClaims, storeId: undefined }), cfg) === null,
  );
  check("no verification key configured → fail closed", verifyDakioJwt(sign(goodClaims), {}) === null);

  // 7. Context budgets (per-layer + total ≤ 2.5k tokens).
  console.log("\n[7] Context budget (≤ 2.5k tokens)");
  const [l1, l2, l3] = await Promise.all([
    buildTenantProfile(AURORA),
    buildLiveOps(AURORA),
    buildRelevantMemory(AURORA),
  ]);
  const t1 = estimateTokens(l1);
  const t2 = estimateTokens(l2);
  const t3 = estimateTokens(l3);
  check(`L1 tenant profile ≤ ${LAYER_BUDGET.tenantProfile} tok (got ${t1})`, t1 <= LAYER_BUDGET.tenantProfile);
  check(`L2 live ops ≤ ${LAYER_BUDGET.liveOps} tok (got ${t2})`, t2 <= LAYER_BUDGET.liveOps);
  check(`L3 memory ≤ ${LAYER_BUDGET.relevantMemory} tok (got ${t3})`, t3 <= LAYER_BUDGET.relevantMemory);
  const here = dirname(fileURLToPath(import.meta.url));
  const persona = readFileSync(join(here, "../../agent/instructions.md"), "utf8");
  const total = estimateTokens(persona) + t1 + t2 + t3;
  check(`total context (persona L0 + L1-L3) ≤ 2500 tok (got ${total})`, total <= 2500);

  // 8. L1 profiles are genuinely distinct per tenant.
  console.log("\n[8] Tenants are distinct (voice / vertical)");
  const beaconProfile = await buildTenantProfile(BEACON);
  check("A profile names Aurora Living", l1.includes("Aurora Living"));
  check("B profile names Beacon Supply Co", beaconProfile.includes("Beacon Supply Co"));
  check("profiles differ", l1 !== beaconProfile);
  check(
    "resolveStoreId reads store from auth (both tenants)",
    resolveStoreId(ctxFor(AURORA)) === AURORA && resolveStoreId(ctxFor(BEACON)) === BEACON,
  );

  // 9. Phase 1/2a behavior still intact for a single tenant.
  console.log("\n[9] Phase 1/2a single-tenant behavior intact");
  const snapshot = await getBusinessSnapshot.execute({}, ctxFor(AURORA));
  check("business snapshot computes revenue", snapshot.revenue.last7d > 0);
  check("business snapshot surfaces prepared approvals", snapshot.pendingApprovals >= 1);
  const anomalies = await detectAnomalies.execute({}, ctxFor(AURORA));
  const findingIds = "findings" in anomalies ? anomalies.findings.map((f) => f.id) : [];
  check("anomaly scanner finds the Evening Glow CPA signal", findingIds.includes("ads-cmp-eveglow"));
  check("anomaly scanner returns a ranked list", (anomalies.count ?? 0) > 0);

  // --- report ---
  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`ISOLATION SUITE PASSED — ${passed} checks green.`);
  } else {
    console.log(`ISOLATION SUITE FAILED — ${failures.length} of ${passed + failures.length} checks failed:`);
    for (const f of failures) console.log(`  ✗ ${f}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Isolation suite crashed:", err);
  process.exit(1);
});
