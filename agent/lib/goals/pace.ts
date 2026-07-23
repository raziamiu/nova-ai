/**
 * Goal pace + projection (Stage 6 "Reach", E-16) — deterministic, no model.
 *
 * A goal gets math; memory keeps the meaning. Given a target over a window and
 * the actual-to-date, `pace` says whether the store is ahead/on-track/behind/at-
 * risk against the required run-rate, and `project` extrapolates the trailing
 * run-rate to the window's end with a confidence band and a `basis` label — so
 * the door never shows a bare projected number (§2.4). Pure functions; the model
 * narrates these, it doesn't compute them.
 */

export type PaceStatus = "ahead" | "on_track" | "behind" | "at_risk";

export interface PaceInput {
  target: number;
  actualToDate: number;
  /** Fraction of the window elapsed, 0..1. */
  elapsedFraction: number;
}

export interface PaceResult {
  status: PaceStatus;
  /** Where the store should be by now to stay on target. */
  requiredToDate: number;
  /** actualToDate / requiredToDate; Infinity when nothing was required yet. */
  ratio: number;
}

export function pace(input: PaceInput): PaceResult {
  const f = Math.max(0, Math.min(1, input.elapsedFraction));
  const requiredToDate = input.target * f;
  const ratio = requiredToDate > 0 ? input.actualToDate / requiredToDate : Infinity;
  let status: PaceStatus;
  if (ratio >= 1.1) status = "ahead";
  else if (ratio >= 0.95) status = "on_track";
  else if (ratio >= 0.7) status = "behind";
  else status = "at_risk";
  return { status, requiredToDate, ratio };
}

export interface Projection {
  value: number;
  /** 0..1 — higher when the trailing series is steady, lower when it's volatile. */
  confidence: number;
  /** Human basis label, e.g. "trailing 7-day run-rate". */
  basis: string;
}

/**
 * Project the window-end value from a trailing daily series. Value =
 * actualToDate + mean(dailyRate) × remainingDays. Confidence is the steadiness
 * of the series (1 − coefficient of variation, clamped), so a jumpy series
 * projects with an honestly lower band.
 */
export function project(
  trailingDaily: number[],
  remainingDays: number,
  actualToDate: number,
): Projection {
  const n = trailingDaily.length;
  const basis = `trailing ${n}-day run-rate`;
  if (n === 0) return { value: actualToDate, confidence: 0, basis };
  const mean = trailingDaily.reduce((s, x) => s + x, 0) / n;
  const value = actualToDate + mean * Math.max(0, remainingDays);
  if (n < 2 || mean === 0) return { value, confidence: n < 2 ? 0.4 : 0.5, basis };
  const variance = trailingDaily.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  const cv = Math.sqrt(variance) / Math.abs(mean);
  const confidence = Math.max(0, Math.min(1, 1 - cv));
  return { value, confidence, basis };
}
