/**
 * Experiment statistics (Stage 6 "Reach", E-15) — deterministic, no model.
 *
 * Growth Lab formalizes the shipped experiments with real math: a two-proportion
 * significance test (so "the variant won" is a claim with a p-value behind it,
 * not a vibe) and an ICE score to rank the backlog. Both are pure functions —
 * reproducible, unit-testable, and never a model call. The §2.4 rule applies:
 * an "inconclusive" result says so honestly rather than declaring a false winner
 * off a tiny sample.
 */

/** Standard-normal CDF via the Abramowitz-Stegun erf approximation (max error ~1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

export interface VariantResult {
  /** Successes (e.g. conversions). */
  conversions: number;
  /** Trials (e.g. visitors reached). */
  n: number;
}

export interface SignificanceResult {
  rateA: number;
  rateB: number;
  /** Relative lift of B over A, e.g. 0.2 = +20%. NaN when A's rate is 0. */
  lift: number;
  zScore: number;
  /** Two-sided p-value. */
  pValue: number;
  significant: boolean;
  /** True when either arm is under the sample floor — the honest "not enough data yet". */
  inconclusive: boolean;
}

/**
 * Two-proportion z-test comparing variant B against control A. Below the sample
 * floor on either arm it returns `inconclusive` (never `significant`), so a
 * peeked-at 12-visitor test can't crown a winner.
 */
export function twoProportionTest(
  a: VariantResult,
  b: VariantResult,
  opts: { alpha?: number; minSample?: number } = {},
): SignificanceResult {
  const alpha = opts.alpha ?? 0.05;
  const minSample = opts.minSample ?? 100;
  const rateA = a.n > 0 ? a.conversions / a.n : 0;
  const rateB = b.n > 0 ? b.conversions / b.n : 0;
  const lift = rateA > 0 ? (rateB - rateA) / rateA : NaN;

  const inconclusive = a.n < minSample || b.n < minSample;
  const pooled = (a.conversions + b.conversions) / (a.n + b.n || 1);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / (a.n || 1) + 1 / (b.n || 1)));
  const zScore = se > 0 ? (rateB - rateA) / se : 0;
  const pValue = 2 * (1 - normalCdf(Math.abs(zScore)));
  const significant = !inconclusive && pValue < alpha;

  return { rateA, rateB, lift, zScore, pValue, significant, inconclusive };
}

/**
 * ICE score — Impact × Confidence × Ease, each on 1–10, giving 1–1000. Ranks the
 * experiment backlog; higher runs first. Inputs are clamped to [1,10] so a
 * malformed proposal can't distort the ordering.
 */
export function iceScore(impact: number, confidence: number, ease: number): number {
  const clamp = (v: number) => Math.max(1, Math.min(10, Math.round(v)));
  return clamp(impact) * clamp(confidence) * clamp(ease);
}
