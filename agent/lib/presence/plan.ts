/**
 * Tonight's plan scoring + hours-saved (Stage 7 "Presence", FR-2.7/FR-2.8) —
 * deterministic joins, no model math.
 *
 * `plannedVsDone` diffs the SCHEDULED PlanItems the pre-shift job authored
 * against what the night's ledger actually completed — a plain join, so the
 * 06:00 brief's planned/done tally can never be a model's guess. `hoursSaved`
 * composes only from activity rows and is recomputed byte-for-byte by the
 * auditor script (§11) — reproducible by construction.
 */

export interface PlannedItem {
  id: string;
  department: string;
  title: string;
}

export interface PlannedVsDone {
  plannedCount: number;
  doneCount: number;
  donePct: number;
  missed: PlannedItem[];
}

/** Join planned items against the set of completed item ids from the ledger. */
export function plannedVsDone(planned: PlannedItem[], completedIds: Iterable<string>): PlannedVsDone {
  const done = new Set(completedIds);
  const missed = planned.filter((p) => !done.has(p.id));
  const doneCount = planned.length - missed.length;
  return {
    plannedCount: planned.length,
    doneCount,
    donePct: planned.length ? Math.round((doneCount / planned.length) * 100) : 0,
    missed,
  };
}

export interface ActivityRow {
  department: string;
  /** Minutes this activity saved the founder (attributed at file time). */
  savedMinutes: number;
}

export interface HoursSavedReport {
  totalMinutes: number;
  totalHours: number;
  byDepartment: Record<string, number>;
}

/**
 * Compose the weekly hours-saved report from activity rows ONLY. Deterministic:
 * the auditor script re-runs this over a ledger export and must match exactly.
 */
export function hoursSaved(activities: ActivityRow[]): HoursSavedReport {
  const byDepartment: Record<string, number> = {};
  let totalMinutes = 0;
  for (const a of activities) {
    const m = Number.isFinite(a.savedMinutes) ? Math.max(0, a.savedMinutes) : 0;
    totalMinutes += m;
    byDepartment[a.department] = (byDepartment[a.department] || 0) + m;
  }
  return { totalMinutes, totalHours: Math.round((totalMinutes / 60) * 10) / 10, byDepartment };
}
