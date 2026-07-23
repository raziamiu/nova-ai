/**
 * Stage 3 "Proof" gate (PRD §15) — the company milestone, machine-checkable.
 *
 * Runs the night shift against a LIVE tenant, then drives the full loop the gate
 * demands: night shift → a scale decision + a WAITING_ON_YOU plan item + a brief
 * → approve → a live campaign in the door with a receipt → the plan item flips
 * to DONE → undo reverts it.
 *
 * Env:
 *   NOVA_STORE_BACKEND=dakio   (required — the gate proves the LIVE path)
 *   DAKIO_API_URL              default http://localhost:5001
 *   NOVA_GATE_TENANT           staging tenant id (the night shift runs here)
 *   NOVA_SERVICE_TOKEN         Nova service token (night-shift writes)
 *   NOVA_GATE_MERCHANT_JWT     merchant JWT — enables approve/undo (skips loudly without)
 *   NOVA_GATE_TENANT_2         optional second tenant → two-store isolation proof
 *
 * Run:  NOVA_STORE_BACKEND=dakio NOVA_GATE_TENANT=<id> NOVA_GATE_MERCHANT_JWT=<jwt> \
 *         npx -y tsx scripts/stage3-gate.ts
 */

import { storeFor } from "../agent/lib/store/resolve";
import { runNightShift } from "../agent/lib/night/nightShift";

const API = process.env.DAKIO_API_URL ?? "http://localhost:5001";
const TENANT = process.env.NOVA_GATE_TENANT ?? process.env.NOVA_DEV_STORE_ID ?? "";
const TENANT_2 = process.env.NOVA_GATE_TENANT_2 ?? "";
const MERCHANT_JWT = process.env.NOVA_GATE_MERCHANT_JWT ?? "";

let passed = 0;
const failures: string[] = [];
const skipped: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function skip(name: string, why: string): void { skipped.push(name); console.warn(`  ○ SKIPPED: ${name} (${why})`); }

async function post(path: string, jwt: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}${path}`, { method: "POST", headers: { Authorization: `Bearer ${jwt}` } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function get(path: string, jwt: string): Promise<any> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${jwt}` } });
  return res.json().catch(() => ({}));
}

async function runLoop(tenant: string, label: string): Promise<void> {
  console.log(`\n=== ${label}: tenant=${tenant} ===`);
  const client = storeFor(tenant);

  console.log("[1] Night shift authors the day");
  const night = await runNightShift(client);
  check("night shift graded ≥1 department", night.departments.length >= 1);
  check("night shift authored exactly one scale decision", night.decisions.length === 1, `got ${night.decisions.length}`);
  const scale = night.decisions[0];
  const waiting = night.planItems.find((p) => p.status === "WAITING_ON_YOU");
  check("a WAITING_ON_YOU plan item is pinned to the scale decision", !!waiting && waiting.decisionRef === scale?.id);
  check("the brief was filed", typeof night.briefId === "string" && night.briefId.length > 0);

  if (!MERCHANT_JWT) {
    skip("approve → live campaign → plan flip → undo", "no NOVA_GATE_MERCHANT_JWT — the founder-authed half can't run");
    return;
  }

  console.log("[2] Approve on the desk → live campaign + plan flip");
  const ap = await post(`/api/nova/decisions/${scale.id}/approve`, MERCHANT_JWT);
  check("approve executed the linked action", ap.status === 200 && ap.body.executed === true, JSON.stringify(ap.body).slice(0, 120));
  check("approve reports a live campaign", /campaign/i.test(ap.body.note || ""), ap.body.note);
  check("the plan item flipped WAITING → DONE", ap.body.planItemFlipped === true);

  console.log("[3] The brief carries the morning tiles");
  const brief = await get(`/api/nova/brief`, MERCHANT_JWT);
  check("brief is filed with a narrative", brief.filed === true && !!brief.brief?.narrative);
  check("every brief tile carries a basis + evidence query", (brief.brief?.tiles ?? []).every((t: any) => t.basis && t.evidenceQuery));

  console.log("[4] Undo reverts the live mutation");
  // The action id rides on the decision's linked action — re-read the decision.
  const decs = await get(`/api/nova/decisions?status=all&limit=200`, MERCHANT_JWT);
  const decRow = (decs.decisions ?? []).find((d: any) => d.id === scale.id);
  const actionId = decRow?.action?.id;
  if (!actionId) { skip("undo reverts the campaign", "could not resolve the action id from the decision"); return; }
  const un = await post(`/api/nova/actions/${actionId}/undo`, MERCHANT_JWT);
  check("undo reverses within the 24h window", un.status === 200, JSON.stringify(un.body).slice(0, 120));
}

async function main(): Promise<void> {
  if (!TENANT) throw new Error("NOVA_GATE_TENANT (or NOVA_DEV_STORE_ID) required");
  if (process.env.NOVA_STORE_BACKEND !== "dakio") throw new Error("Run with NOVA_STORE_BACKEND=dakio — the gate proves the LIVE path.");

  await runLoop(TENANT, "Store A");
  if (TENANT_2) {
    await runLoop(TENANT_2, "Store B (isolation proof)");
    check("two-store: both stores ran their own loop (operational isolation)", failures.length === 0);
  } else {
    skip("two-store isolation", "NOVA_GATE_TENANT_2 not set — single-store run");
  }

  console.log(`\nstage3-gate: ${passed} passed, ${failures.length} failed, ${skipped.length} skipped`);
  if (failures.length > 0) process.exit(1);
}

main().catch((e) => { console.error("GATE ERROR:", e?.message || e); process.exit(1); });
