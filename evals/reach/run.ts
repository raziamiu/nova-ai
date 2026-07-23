/**
 * Reach suite (Stage 6 "Reach") — the DETERMINISTIC math floor.
 *
 * Experiment significance + ICE (Growth Lab, E-15) and goal pace + projection
 * (Goals, E-16) are pure math the model narrates but never computes. These
 * checks pin the behaviour that must hold exactly: a tiny sample is honestly
 * inconclusive, a real winner is significant, pace buckets are right, and a
 * volatile series projects with a lower confidence band than a steady one.
 *
 * Run:  npx -y tsx evals/reach/run.ts
 */

import { twoProportionTest, iceScore, normalCdf } from "../../agent/lib/growth/stats";
import { pace, project } from "../../agent/lib/goals/pace";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const approx = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) < eps;

console.log("\n[1] normalCdf is a valid standard-normal CDF");
check("Φ(0) = 0.5", approx(normalCdf(0), 0.5));
check("Φ(1.96) ≈ 0.975", approx(normalCdf(1.96), 0.975, 2e-3), String(normalCdf(1.96)));
check("Φ is symmetric", approx(normalCdf(-1.5) + normalCdf(1.5), 1, 2e-3));

console.log("\n[2] Two-proportion test — honest about small samples");
const tiny = twoProportionTest({ conversions: 3, n: 12 }, { conversions: 6, n: 12 });
check("a 12-visitor test is inconclusive, never significant", tiny.inconclusive && !tiny.significant);

const bigWin = twoProportionTest({ conversions: 100, n: 1000 }, { conversions: 160, n: 1000 });
check("a clear winner on a big sample is significant", bigWin.significant, `p=${bigWin.pValue.toFixed(4)}`);
check("lift is computed relative to control (+60%)", approx(bigWin.lift, 0.6, 1e-6), String(bigWin.lift));

const noDiff = twoProportionTest({ conversions: 100, n: 1000 }, { conversions: 102, n: 1000 });
check("a near-tie on a big sample is NOT significant", !noDiff.significant, `p=${noDiff.pValue.toFixed(4)}`);

console.log("\n[3] ICE score ranks the backlog, clamped 1..10 per factor");
check("ICE = impact×confidence×ease", iceScore(8, 7, 5) === 280);
check("ICE clamps out-of-range inputs", iceScore(99, 7, 5) === 10 * 7 * 5);
check("a higher-ICE idea outranks a lower one", iceScore(9, 9, 9) > iceScore(3, 3, 3));

console.log("\n[4] Goal pace buckets against the required run-rate");
check("ahead of pace", pace({ target: 100, actualToDate: 60, elapsedFraction: 0.5 }).status === "ahead");
check("on track", pace({ target: 100, actualToDate: 48, elapsedFraction: 0.5 }).status === "on_track");
check("behind", pace({ target: 100, actualToDate: 38, elapsedFraction: 0.5 }).status === "behind");
check("at risk", pace({ target: 100, actualToDate: 20, elapsedFraction: 0.5 }).status === "at_risk");
check("requiredToDate scales with elapsed", pace({ target: 100, actualToDate: 0, elapsedFraction: 0.25 }).requiredToDate === 25);

console.log("\n[5] Projection extrapolates the trailing run-rate with a confidence band");
const steady = project([10, 10, 10, 10], 3, 40);
check("steady series projects actual + rate×remaining", steady.value === 70, String(steady.value));
check("a steady series projects with high confidence", steady.confidence > 0.9, String(steady.confidence));
const jumpy = project([2, 18, 1, 19], 3, 40);
check("a volatile series projects with lower confidence", jumpy.confidence < steady.confidence, `${jumpy.confidence} vs ${steady.confidence}`);
check("projection carries an honest basis label", /trailing 4-day/.test(steady.basis));
check("empty series projects the current total at zero confidence", project([], 5, 40).value === 40 && project([], 5, 40).confidence === 0);

console.log(`\n${failures.length ? "✗" : "✓"} reach suite: ${passed} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.error(`   - ${f}`)); process.exit(1); }
