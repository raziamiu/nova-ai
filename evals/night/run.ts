/**
 * Night shift suite (Stage 3 "Proof", §9 + §13).
 *
 * The night shift's promise is that a founder wakes to graded departments, a
 * plan board, a scale decision to answer, and a brief — all from real signals,
 * authored unattended. These checks run it against a DemoStore and assert the
 * SHAPE of that output: departments carry the metrics their grade came from,
 * the plan board has a WAITING_ON_YOU item pinned to the scale decision, the
 * decision is a real queued proposal, and the brief is filed. The
 * live-backend end-to-end (approve → live door → plan flip → undo) is proven by
 * the Stage 3 gate script; here we prove the authoring is deterministic and
 * self-consistent.
 *
 * Run:  npx -y tsx evals/night/run.ts
 */

import { DemoStore } from "../../agent/lib/store/backend";
import { createSeed } from "../../agent/lib/store/seed";
import { runNightShift } from "../../agent/lib/night/nightShift";

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

const store = new DemoStore(createSeed(42));
const r = await runNightShift(store);

check("grades at least one department", r.departments.length >= 1, `got ${r.departments.length}`);
check("every graded department carries the metrics its grade came from", r.departments.every((d) => (d.metrics?.length ?? 0) >= 2));
check("every grade is a letter A–F", r.departments.every((d) => /^[A-F]$/.test(d.grade)));

check("authors exactly one scale decision", r.decisions.length === 1, `got ${r.decisions.length}`);
const scale = r.decisions[0];
check("the scale decision is a queued marketing proposal", !!scale && scale.tag === "marketing" && scale.kind === "proposal" && scale.status === "queued");
check("the scale decision links a real action", !!scale && typeof scale.actionId === "string" && scale.actionId.length > 0);
check("the scale decision surfaces on desk + room + door", !!scale && ["desk", "room:marketing", "door:grow"].every((s) => scale.surfacedIn.includes(s)));

const waiting = r.planItems.filter((p) => p.status === "WAITING_ON_YOU");
check("the plan board has a WAITING_ON_YOU item", waiting.length >= 1);
check("the waiting item is pinned to the scale decision (the flip bridge)", waiting.some((p) => p.decisionRef === scale?.id),
  `decisionRefs: ${waiting.map((p) => p.decisionRef).join(",")}`);
check("the plan board also carries in-flight (non-blocking) work", r.planItems.some((p) => p.status !== "WAITING_ON_YOU"));

check("files a brief", typeof r.briefId === "string" && r.briefId.length > 0);
check("the brief is for today", r.day === store.now().slice(0, 10));

// Determinism: a second run on a fresh identical store produces the same grades.
const store2 = new DemoStore(createSeed(42));
const r2 = await runNightShift(store2);
check("deterministic grades across identical inputs",
  JSON.stringify(r.departments.map((d) => [d.key, d.grade])) === JSON.stringify(r2.departments.map((d) => [d.key, d.grade])));

console.log(`\nnight: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
