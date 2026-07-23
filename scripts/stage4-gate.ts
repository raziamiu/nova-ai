/**
 * Stage 4 "Craft" gate (PRD §15) — machine-checkable, against the LIVE path.
 *
 * Drives the §15 Stage 4 scenario end to end on a real tenant:
 *   owner sets a brand voice → Nova generates an OFF-VOICE draft (flagged, cited)
 *   → founder requests changes → Nova regenerates IN-VOICE (score climbs, clears
 *   the bar) → founder approves → it publishes (organic FB, honest no-Page).
 *
 * The generation half runs through `draftAndFileContent` (the generate_content
 * tool's core) so the same scoring + filing the model uses is what's gated; the
 * founder half runs through the merchant content routes with a real JWT.
 *
 * Env:
 *   NOVA_STORE_BACKEND=dakio   (required — proves the LIVE path)
 *   DAKIO_API_URL              default http://localhost:5001
 *   NOVA_GATE_TENANT           tenant id (Nova's service writes land here)
 *   NOVA_SERVICE_TOKEN         Nova service token (generation writes)
 *   NOVA_GATE_MERCHANT_JWT     owner JWT — enables the brand/approve/publish half
 *
 * Run:  NOVA_STORE_BACKEND=dakio NOVA_GATE_TENANT=<id> NOVA_SERVICE_TOKEN=<svc> \
 *         NOVA_GATE_MERCHANT_JWT=<jwt> npx -y tsx scripts/stage4-gate.ts
 */

import { storeFor } from "../agent/lib/store/resolve";
import { draftAndFileContent } from "../agent/lib/nova/content";

const API = process.env.DAKIO_API_URL ?? "http://localhost:5001";
const TENANT = process.env.NOVA_GATE_TENANT ?? process.env.NOVA_DEV_STORE_ID ?? "";
const MERCHANT_JWT = process.env.NOVA_GATE_MERCHANT_JWT ?? "";

const OFF_VOICE = "Big flash sale — cheap sarees, limited time only. Grab yours before they're gone!";
const IN_VOICE = "Our warm, handmade sarees are back — cozy colours, made to last. Come see the new arrivals.";

let passed = 0;
const failures: string[] = [];
const skipped: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function skip(name: string, why: string): void { skipped.push(name); console.warn(`  ○ SKIPPED: ${name} (${why})`); }

async function req(method: string, path: string, jwt: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function main(): Promise<void> {
  if (!TENANT) throw new Error("NOVA_GATE_TENANT (or NOVA_DEV_STORE_ID) required");
  if (process.env.NOVA_STORE_BACKEND !== "dakio") throw new Error("Run with NOVA_STORE_BACKEND=dakio — the gate proves the LIVE path.");
  const client = storeFor(TENANT);

  if (!MERCHANT_JWT) {
    skip("full Stage 4 loop", "no NOVA_GATE_MERCHANT_JWT — brand voice + approve/publish can't run");
    console.log("\n[1] Nova can read a brand voice and file a scored draft (service half)");
    const profile = await client.getBrandProfile();
    check("brand profile has the expected shape", Array.isArray(profile.toneWords) && typeof profile.threshold === "number");
    const draft = await draftAndFileContent(client, { type: "post", title: "Stage4 gate draft", text: IN_VOICE });
    check("a draft is scored and filed to review", draft.item.status === "review" && typeof draft.score.score === "number");
    console.log(`\nstage4-gate: ${passed} passed, ${failures.length} failed, ${skipped.length} skipped`);
    if (failures.length) process.exit(1);
    return;
  }

  console.log("\n[0] Owner sets the store's brand voice (E-12)");
  const brand = await req("PUT", "/api/nova/brand", MERCHANT_JWT, {
    toneWords: ["warm", "handmade", "cozy"],
    rules: [{ kind: "dont", text: "cheap" }, { kind: "dont", text: "limited time only" }],
    languages: ["en", "bn"],
    threshold: 70,
  });
  check("owner sets the brand voice", brand.status === 200 && brand.body?.configured === true, JSON.stringify(brand.body).slice(0, 120));

  console.log("[1] Nova reads that voice");
  const profile = await client.getBrandProfile();
  check("the agent reads the set voice", profile.toneWords.includes("warm") && profile.rules.some((r) => r.kind === "dont"));

  console.log("[2] Nova generates an OFF-VOICE draft → flagged, cited, filed to review");
  const bad = await draftAndFileContent(client, { type: "post", title: "Eid launch (v1)", text: OFF_VOICE });
  check("off-voice draft is flagged below threshold", bad.score.flagged && bad.score.score < 70, `score ${bad.score.score}`);
  check("off-voice draft cites the banned phrase", bad.score.violations.some((v) => v.evidence === "cheap" || /cheap/.test(v.message)));
  check("off-voice draft is filed to review", bad.item.status === "review");
  check("Nova gets revise guidance (won't leave it off-voice)", bad.guidance.length > 0);

  console.log("[3] Founder requests changes on the desk");
  const rc = await req("POST", `/api/nova/content/${bad.item.id}/request-changes`, MERCHANT_JWT, { note: "drop 'cheap' and the countdown; keep it warm" });
  check("request-changes moves the draft to 'changes'", rc.status === 200 && rc.body?.status === "changes", JSON.stringify(rc.body).slice(0, 120));

  console.log("[4] Nova regenerates IN-VOICE → score climbs, clears the bar, back to review");
  const good = await draftAndFileContent(client, { type: "post", title: "Eid launch (v2)", text: IN_VOICE, contentId: bad.item.id, note: "warmer, no 'cheap'" });
  check("revision reuses the same content item", good.item.id === bad.item.id);
  check("revision clears the threshold", !good.score.flagged && good.score.score >= 70, `score ${good.score.score}`);
  check("revision improves on v1", good.score.score > bad.score.score, `${bad.score.score} → ${good.score.score}`);
  check("revision is back in review", good.item.status === "review");

  console.log("[5] Founder approves");
  const ap = await req("POST", `/api/nova/content/${good.item.id}/approve`, MERCHANT_JWT);
  check("approve moves it to approved/scheduled", ap.status === 200 && ["approved", "scheduled"].includes(ap.body?.status), JSON.stringify(ap.body).slice(0, 120));

  console.log("[6] Founder publishes (organic FB — honest about a missing Page)");
  const pub = await req("POST", `/api/nova/content/${good.item.id}/publish`, MERCHANT_JWT);
  check("publish returns 200 with an honest outcome", pub.status === 200 && typeof pub.body?.note === "string", JSON.stringify(pub.body).slice(0, 160));
  check("content ends published or scheduled (never a faked send)", ["published", "scheduled"].includes(pub.body?.content?.status), pub.body?.content?.status);

  console.log(`\nstage4-gate: ${passed} passed, ${failures.length} failed, ${skipped.length} skipped`);
  if (failures.length > 0) process.exit(1);
}

main().catch((e) => { console.error("GATE ERROR:", e?.message || e); process.exit(1); });
