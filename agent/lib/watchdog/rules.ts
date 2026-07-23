/**
 * Watchdog rules (Stage 7 "Presence", FR-9.2) — deterministic, no model on patrol.
 *
 * Typed thresholds over the ledger + live metrics (spend spike vs daily cap,
 * stockout on an active-campaign SKU, courier failure streak). The `pulse` job
 * evaluates these; a firing rule authors a decision card FIRST (the card always
 * exists), then the escalation ladder runs: call → unanswered/declined → push →
 * the card stays queued. Declining on the call is `Later` semantics.
 *
 * Rules are pure functions of a signals snapshot, so a firing is reproducible
 * and the Stage 9 false-positive SLO can be counted from real rows — never a
 * model's hunch that something "feels off".
 */

export type WatchdogSeverity = "critical" | "warning";

export interface WatchdogSignals {
  spendTodayMinor: number;
  dailySpendCapMinor: number;
  /** Active-campaign SKUs that are out of stock. */
  stockouts: { sku: string; name?: string; onActiveCampaign: boolean }[];
  /** Consecutive courier delivery failures, per courier. */
  courierFailStreaks: { courier: string; streak: number }[];
  /** Net revenue today vs the trailing daily average (0..1, e.g. 0.4 = down 60%). */
  revenueVsTrailing?: number;
}

export interface WatchdogFinding {
  ruleKey: string;
  severity: WatchdogSeverity;
  title: string;
  detail: string;
  /** The escalation ladder, in order. The card is always first (it always exists). */
  ladder: ("card" | "call" | "push")[];
  evidence: Record<string, unknown>;
}

export interface WatchdogRule {
  key: string;
  severity: WatchdogSeverity;
  /** Returns a finding when the rule fires, else null. Pure. */
  evaluate: (s: WatchdogSignals) => WatchdogFinding | null;
}

const ladderFor = (severity: WatchdogSeverity): ("card" | "call" | "push")[] =>
  // Critical escalates all the way; a warning lands on the desk + a push, no call.
  severity === "critical" ? ["card", "call", "push"] : ["card", "push"];

export const WATCHDOG_RULES: WatchdogRule[] = [
  {
    key: "spend_spike",
    severity: "critical",
    evaluate: (s) => {
      if (s.dailySpendCapMinor <= 0) return null;
      const pct = s.spendTodayMinor / s.dailySpendCapMinor;
      if (pct < 0.9) return null;
      return {
        ruleKey: "spend_spike",
        severity: "critical",
        title: "Ad spend near the daily cap",
        detail: `Today's spend is ${Math.round(pct * 100)}% of the ৳${Math.round(s.dailySpendCapMinor / 100)} cap.`,
        ladder: ladderFor("critical"),
        evidence: { spendTodayMinor: s.spendTodayMinor, dailySpendCapMinor: s.dailySpendCapMinor, pct },
      };
    },
  },
  {
    key: "stockout_active_campaign",
    severity: "critical",
    evaluate: (s) => {
      const hit = s.stockouts.filter((x) => x.onActiveCampaign);
      if (hit.length === 0) return null;
      return {
        ruleKey: "stockout_active_campaign",
        severity: "critical",
        title: "A product you're advertising is out of stock",
        detail: `${hit.length} SKU(s) on a live campaign hit zero stock — you're paying for traffic to a dead page.`,
        ladder: ladderFor("critical"),
        evidence: { skus: hit.map((x) => x.sku) },
      };
    },
  },
  {
    key: "courier_fail_streak",
    severity: "warning",
    evaluate: (s) => {
      const worst = [...s.courierFailStreaks].sort((a, b) => b.streak - a.streak)[0];
      if (!worst || worst.streak < 3) return null;
      return {
        ruleKey: "courier_fail_streak",
        severity: "warning",
        title: `${worst.courier} is failing deliveries`,
        detail: `${worst.streak} deliveries in a row failed with ${worst.courier}.`,
        ladder: ladderFor("warning"),
        evidence: { courier: worst.courier, streak: worst.streak },
      };
    },
  },
  {
    key: "revenue_drop",
    severity: "warning",
    evaluate: (s) => {
      if (s.revenueVsTrailing == null) return null;
      if (s.revenueVsTrailing >= 0.5) return null;
      return {
        ruleKey: "revenue_drop",
        severity: "warning",
        title: "Sales are well below your usual",
        detail: `Today's revenue is running at ${Math.round(s.revenueVsTrailing * 100)}% of your recent daily average.`,
        ladder: ladderFor("warning"),
        evidence: { revenueVsTrailing: s.revenueVsTrailing },
      };
    },
  },
];

/** Evaluate every rule against a snapshot; findings sorted critical-first. */
export function runWatchdog(signals: WatchdogSignals): WatchdogFinding[] {
  const findings = WATCHDOG_RULES.map((r) => r.evaluate(signals)).filter(
    (f): f is WatchdogFinding => f !== null,
  );
  return findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
}

/** The next escalation step given what's already been tried (the ladder walker). */
export function nextEscalation(
  finding: WatchdogFinding,
  attempted: ("card" | "call" | "push")[],
): "card" | "call" | "push" | "done" {
  for (const step of finding.ladder) if (!attempted.includes(step)) return step;
  return "done";
}
