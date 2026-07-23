/**
 * Research candidate scoring (Stage 6 "Reach", E-14) — deterministic, no model.
 *
 * `score100 = Σ weightᵢ · signalᵢ` over NAMED signals, each 0..1 with higher =
 * better (the adapter inverts "competition" before it gets here). The weights
 * that actually produced the score are returned so the card can show them —
 * no black-box number (§2.4). When a signal is absent (e.g. no trend feed
 * connected), it's dropped and the remaining weights RENORMALIZE, and the
 * absent signals are reported so the card can say "trend: n/a" honestly rather
 * than pretending a 0 (§18 benchmark-honesty rule, previewed).
 */

export type ResearchSignalKey = "demand" | "margin" | "trend" | "competition";

/** Each signal 0..1, higher = better. `null`/absent = not available (e.g. no feed). */
export type ResearchSignals = Partial<Record<ResearchSignalKey, number | null>>;

export const DEFAULT_WEIGHTS: Record<ResearchSignalKey, number> = {
  demand: 0.4,
  margin: 0.3,
  trend: 0.15,
  competition: 0.15,
};

export interface ResearchScore {
  score100: number;
  /** The renormalized weights actually applied (only over available signals). */
  weights: Partial<Record<ResearchSignalKey, number>>;
  /** The clamped signal values used. */
  signals: Partial<Record<ResearchSignalKey, number>>;
  /** Signals that were absent — the card shows these as "n/a", never as 0. */
  naSignals: ResearchSignalKey[];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function scoreResearchCandidate(
  raw: ResearchSignals,
  weightOverrides: Partial<Record<ResearchSignalKey, number>> = {},
): ResearchScore {
  const weights = { ...DEFAULT_WEIGHTS, ...weightOverrides };
  const keys = Object.keys(weights) as ResearchSignalKey[];

  const present: ResearchSignalKey[] = [];
  const naSignals: ResearchSignalKey[] = [];
  const signals: Partial<Record<ResearchSignalKey, number>> = {};
  for (const k of keys) {
    const v = raw[k];
    if (v === undefined || v === null || Number.isNaN(v)) naSignals.push(k);
    else { present.push(k); signals[k] = clamp01(v); }
  }

  // Renormalize the present signals' weights so they sum to 1 (honest reweight
  // when a feed is missing). No present signals → score 0, all n/a.
  const presentWeightSum = present.reduce((s, k) => s + weights[k], 0);
  const usedWeights: Partial<Record<ResearchSignalKey, number>> = {};
  let score = 0;
  if (presentWeightSum > 0) {
    for (const k of present) {
      const w = weights[k] / presentWeightSum;
      usedWeights[k] = w;
      score += w * (signals[k] as number);
    }
  }

  return { score100: Math.round(score * 100), weights: usedWeights, signals, naSignals };
}
