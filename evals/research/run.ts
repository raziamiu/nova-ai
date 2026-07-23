/**
 * Research suite (Stage 6 "Reach", E-14) — the DETERMINISTIC scoring contract.
 *
 * A candidate's score is `Σ weight·signal` over named signals, and the pieces
 * that must never drift: a full-signal score is the weighted average, an absent
 * signal RENORMALIZES the remaining weights (never counts as 0), the weights
 * used are reported for the card (no black-box number), and all-absent is an
 * honest 0 with everything flagged n/a.
 *
 * Run:  npx -y tsx evals/research/run.ts
 */

import { scoreResearchCandidate, DEFAULT_WEIGHTS } from "../../agent/lib/research/score";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

console.log("\n[1] A full-signal candidate scores the weighted average");
const full = scoreResearchCandidate({ demand: 1, margin: 1, trend: 1, competition: 1 });
check("all signals maxed → 100", full.score100 === 100, String(full.score100));
check("no signals flagged n/a", full.naSignals.length === 0);
const mixed = scoreResearchCandidate({ demand: 0.5, margin: 1, trend: 0, competition: 1 });
check("weighted mix computes (0.4·.5+0.3·1+0.15·0+0.15·1=0.65 → 65)", mixed.score100 === 65, String(mixed.score100));

console.log("\n[2] Weights used are reported (no black-box score)");
check("weights over present signals sum to 1", approx(Object.values(full.weights).reduce((s, w) => s + w, 0), 1));
check("full-signal weights equal the defaults", approx(full.weights.demand ?? 0, DEFAULT_WEIGHTS.demand));

console.log("\n[3] An absent signal renormalizes — never counts as 0");
const noTrend = scoreResearchCandidate({ demand: 1, margin: 1, competition: 1, trend: null });
check("trend flagged n/a", noTrend.naSignals.includes("trend"));
check("remaining weights renormalize to sum 1", approx(Object.values(noTrend.weights).reduce((s, w) => s + w, 0), 1));
check("all-1 present signals still score 100 (not penalized for the missing feed)", noTrend.score100 === 100, String(noTrend.score100));
// Contrast: treating absent-as-0 would have dropped this well below 100.
const trendZero = scoreResearchCandidate({ demand: 1, margin: 1, competition: 1, trend: 0 });
check("an explicit 0 trend DOES lower the score (0 ≠ n/a)", trendZero.score100 < noTrend.score100, `${trendZero.score100} vs ${noTrend.score100}`);

console.log("\n[4] Honest edges");
check("no signals at all → score 0, all n/a", (() => { const r = scoreResearchCandidate({}); return r.score100 === 0 && r.naSignals.length === 4; })());
check("out-of-range signal is clamped", scoreResearchCandidate({ demand: 5, margin: null, trend: null, competition: null }).score100 === 100);

console.log(`\n${failures.length ? "✗" : "✓"} research suite: ${passed} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.error(`   - ${f}`)); process.exit(1); }
