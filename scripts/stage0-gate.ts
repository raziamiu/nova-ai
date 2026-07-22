/**
 * Stage 0 gate harness (PRD §15, Stage 0 "Spine"):
 *
 *   Create a coupon "as Nova" via harness → shows in door + feed ≤3s with
 *   receipt → undo removes it, ledger shows action + undo.
 *
 * Drives the REAL pipeline against the REAL backend (NOVA_STORE_BACKEND=dakio)
 * with zero manual DB pokes — performAction is the same code path chat and
 * jobs use. Machine-checks every gate step; the human demo on a clean staging
 * store (run by a non-builder, recorded, ledger export filed) follows this.
 *
 * Env:
 *   DAKIO_API_URL            dakio-api base (e.g. http://localhost:5001)
 *   NOVA_GATE_TENANT         staging tenant id
 *   NOVA_SERVICE_TOKENS      {tenantId: token} JSON map (or NOVA_SERVICE_TOKEN)
 *   NOVA_GATE_MERCHANT_JWT   optional merchant JWT — enables the SSE ≤3s check
 *                            and the merchant-side export; without it those
 *                            steps are SKIPPED and reported as such (never
 *                            silently passed).
 *
 * Run:  NOVA_STORE_BACKEND=dakio npx -y tsx scripts/stage0-gate.ts
 */

import { performAction, undoAction } from "../agent/lib/nova/actions";
import { storeFor } from "../agent/lib/store/resolve";

const API = process.env.DAKIO_API_URL ?? "http://localhost:5001";
const TENANT = process.env.NOVA_GATE_TENANT ?? process.env.DAKIO_STORE_ID ?? "";
const MERCHANT_JWT = process.env.NOVA_GATE_MERCHANT_JWT ?? "";

let passed = 0;
const failures: string[] = [];
const skipped: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function skip(name: string, why: string): void {
  skipped.push(name);
  console.warn(`  ○ SKIPPED: ${name} (${why})`);
}

async function main(): Promise<void> {
  if (!TENANT) throw new Error("NOVA_GATE_TENANT (or DAKIO_STORE_ID) required");
  if (process.env.NOVA_STORE_BACKEND !== "dakio") {
    throw new Error("Run with NOVA_STORE_BACKEND=dakio — the gate proves the LIVE path.");
  }
  const client = storeFor(TENANT);
  const code = `SPINE${Date.now().toString(36).toUpperCase().slice(-4)}`;

  // Ensure the pipeline may execute (gate at level 3: create_discount within
  // guardrails is low-risk-executable; adjust to your staging config).
  const autonomy = await client.getAutonomy();
  console.log(`[gate] tenant=${TENANT} level=${autonomy.level} code=${code}`);

  // Optional SSE listener, armed BEFORE the action so the ≤3s bound is honest.
  let sseFrameAt: number | null = null;
  let sseAbort: AbortController | null = null;
  if (MERCHANT_JWT) {
    sseAbort = new AbortController();
    void (async () => {
      const res = await fetch(`${API}/api/nova/feed/stream`, {
        headers: { Authorization: `Bearer ${MERCHANT_JWT}` },
        signal: sseAbort!.signal,
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.includes("activity.created") || buffer.includes("action.created")) {
          if (sseFrameAt === null) sseFrameAt = Date.now();
        }
      }
    })().catch(() => {});
    await new Promise((r) => setTimeout(r, 500)); // let the stream attach
  }

  // 1. Create the coupon "as Nova" through the real pipeline.
  console.log("\n[1] Create coupon as Nova");
  const startedAt = Date.now();
  const result = await performAction(client, {
    type: "create_discount",
    department: "sales",
    title: `Stage 0 gate: create ${code}`,
    payload: { code, percentOff: 10, scope: "order", expiresInDays: 7 },
    receipt: {
      reason: "Stage 0 gate demo: prove the one rule end-to-end on the Coupons door.",
      expectedImpact: "A 10% coupon exists, receipted, attributed, and reversible for 24h.",
      confidence: 0.95,
      evidence: [{ source: "gate-harness", note: "scripted Stage 0 demo per PRD §15" }],
    },
  });
  check("action executed (not prepared/blocked)", result.status === "executed", `${result.status}: ${result.detail}`);

  const record = await client.getAction(result.actionId);
  check("ledger row has a full receipt (evidence + after snapshot)", !!record?.receipt?.evidence?.length && !!record?.receipt?.after);
  check("undo window stamped (24h)", !!record?.undoDeadline);
  check("actor is nova", record?.actor === "nova");

  // 2. Shows in the door with by:nova attribution.
  console.log("\n[2] Door row + attribution");
  const discounts = await client.listDiscounts();
  const coupon = discounts.find((d) => d.code === code);
  check("coupon row exists in the door", !!coupon);
  if (MERCHANT_JWT && coupon) {
    const doorRes = await fetch(`${API}/api/coupons`, { headers: { Authorization: `Bearer ${MERCHANT_JWT}` } });
    const door = (await doorRes.json()) as { coupons?: { code: string; novaActionId?: string | null }[] };
    const doorRow = door.coupons?.find((c) => c.code === code);
    check("door row carries novaActionId → the receipt", doorRow?.novaActionId === result.actionId, JSON.stringify(doorRow));
  } else {
    skip("door novaActionId check", "no NOVA_GATE_MERCHANT_JWT");
  }

  // 3. Feed ≤3s.
  console.log("\n[3] Live feed ≤3s");
  if (MERCHANT_JWT) {
    await new Promise((r) => setTimeout(r, 3500)); // give the frame its window
    check(
      "feed frame arrived ≤3s after the action",
      sseFrameAt !== null && sseFrameAt - startedAt <= 3000,
      sseFrameAt ? `arrived after ${sseFrameAt - startedAt}ms` : "no frame captured",
    );
    sseAbort?.abort();
  } else {
    skip("SSE ≤3s check", "no NOVA_GATE_MERCHANT_JWT");
  }

  // 4. Undo removes it; ledger shows action + undo.
  console.log("\n[4] Undo");
  const undone = await undoAction(client, result.actionId);
  check("undo succeeded in-window", undone.detail.length > 0, undone.detail);
  const after = await client.getAction(result.actionId);
  check("ledger shows status undone + undoneAt", after?.status === "undone" && !!after?.undoneAt);
  const discountsAfter = await client.listDiscounts();
  const couponAfter = discountsAfter.find((d) => d.code === code);
  check("coupon no longer active in the door", !couponAfter || couponAfter.active === false, JSON.stringify(couponAfter));

  // 5. Ledger export (the §16 gate artifact).
  console.log("\n[5] Ledger export");
  if (MERCHANT_JWT) {
    const exportRes = await fetch(`${API}/api/nova/ledger/export`, { headers: { Authorization: `Bearer ${MERCHANT_JWT}` } });
    const text = await exportRes.text();
    const rows = text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id: string; status: string });
    check("export contains the gate action in its undone state", rows.some((r) => r.id === result.actionId && r.status === "undone"));
    console.log(`  → export captured ${rows.length} ledger rows (file this with the demo recording)`);
  } else {
    skip("merchant ledger export", "no NOVA_GATE_MERCHANT_JWT");
  }

  console.log("\n" + "=".repeat(60));
  if (skipped.length) console.warn(`SKIPPED ${skipped.length} check(s): ${skipped.join("; ")} — the full gate requires them.`);
  if (failures.length) {
    console.error(`STAGE 0 GATE FAILED — ${failures.length} failing, ${passed} passing.`);
    process.exit(1);
  }
  console.log(`STAGE 0 GATE (machine half) PASSED — ${passed} checks green.`);
}

main().catch((error) => {
  console.error("Gate crashed:", error);
  process.exit(1);
});
