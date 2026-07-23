/**
 * Team engine (Stage 8 "Team") — the deterministic cores of the 11-agent org:
 * per-agent trust + mode resolution, seasonal-playbook execution/rollback
 * ordering, the negotiation offer strategy, and the privacy-floored benchmark
 * aggregation. All pure — the model drafts language and narrative on top, but
 * who-can-do-what, what-executes-in-what-order, what-rolls-back, and what's
 * privacy-safe to publish are decided HERE, reproducibly.
 */

import type { NovaDepartment } from "../types";

// ── Per-agent trust + mode resolution (E-22, §5.2) ──────────────────────────

export type AgentMode = "assisted" | "supervised" | "autonomous";

export interface LedgerSlice {
  /** Actions this agent authored that the founder approved. */
  approved: number;
  /** Actions the founder rejected. */
  rejected: number;
  /** Actions that executed and were later undone by the founder. */
  undone: number;
  total: number;
}

export interface AgentTrust {
  score: number | null; // 0..100, or null while under the events floor
  events: number;
  earning: boolean; // true → "earning trust · n events", don't show a score yet
}

const TRUST_EVENTS_FLOOR = 5;

/** Per-agent trust from THAT agent's ledger slice (department filter). A small
 *  slice shows "earning trust" rather than a volatile number. */
export function agentTrust(slice: LedgerSlice): AgentTrust {
  const events = slice.approved + slice.rejected + slice.undone;
  if (events < TRUST_EVENTS_FLOOR) return { score: null, events, earning: true };
  // Approvals build trust; rejections and undos erode it (undo weighed heavier).
  const raw = (slice.approved - slice.rejected - 1.5 * slice.undone) / Math.max(1, events);
  const score = Math.max(0, Math.min(100, Math.round(50 + raw * 50)));
  return { score, events, earning: false };
}

/** Mode resolution order: agent:<dept> → door:<module> → store → assisted.
 *  The FIRST defined tier wins — one agent can be autonomous while the store
 *  stays assisted, and vice-versa. */
export function resolveMode(tiers: {
  agent?: AgentMode | null;
  door?: AgentMode | null;
  store?: AgentMode | null;
}): { mode: AgentMode; source: "agent" | "door" | "store" | "default" } {
  if (tiers.agent) return { mode: tiers.agent, source: "agent" };
  if (tiers.door) return { mode: tiers.door, source: "door" };
  if (tiers.store) return { mode: tiers.store, source: "store" };
  return { mode: "assisted", source: "default" };
}

// ── Seasonal playbook execution + rollback (E-19, FR-10.2) ───────────────────

export interface PlaybookItem {
  ref: string;
  kind: "campaign" | "po" | "content" | "broadcast";
  order: number;
  undoable: boolean;
  status?: string;
}

/** Sequential execution order — items run low→high `order`, auditable. */
export function planExecution(items: PlaybookItem[]): PlaybookItem[] {
  return [...items].sort((a, b) => a.order - b.order);
}

export interface RollbackPlan {
  /** Executed pieces to reverse, in reverse order. */
  toReverse: PlaybookItem[];
  /** Pieces that cannot be undone (e.g. a sent broadcast) — rollback halts here. */
  irreversible: PlaybookItem[];
  /** True when every executed piece is reversible. */
  clean: boolean;
}

/** Rollback = reverse-order undo of executed pieces; HALTS at the first
 *  irreversible one with an honest partial-rollback report. */
export function planRollback(executed: PlaybookItem[]): RollbackPlan {
  const reverse = [...executed].sort((a, b) => b.order - a.order);
  const toReverse: PlaybookItem[] = [];
  const irreversible: PlaybookItem[] = [];
  let halted = false;
  for (const item of reverse) {
    if (halted) { irreversible.push(item); continue; }
    if (!item.undoable) { irreversible.push(item); halted = true; continue; }
    toReverse.push(item);
  }
  return { toReverse, irreversible, clean: irreversible.length === 0 };
}

// ── Negotiation offer strategy (E-20, §5.4) ─────────────────────────────────

export interface NegotiationState {
  /** Our target price (the floor we're steering toward), ৳ minor. */
  targetMinor: number;
  /** The counterparty's latest offer, ৳ minor. */
  theirOfferMinor: number;
  /** Our last offer, ৳ minor (undefined on the opening move). */
  ourLastMinor?: number;
  /** Guardrail: never offer above this, ৳ minor (a hard ceiling). */
  ceilingMinor: number;
  /** Round number (0-based). */
  round: number;
}

export interface OfferDecision {
  offerMinor: number;
  /** "accept" when their offer already meets our target (or better). */
  action: "accept" | "counter";
  reason: string;
}

/**
 * Deterministic concession ladder: open near target, then close the gap by a
 * shrinking fraction each round, never crossing the guardrail ceiling, and
 * ACCEPT the moment their offer is at or below our target. The model phrases the
 * message; the number is this function's, so a negotiation can't drift over the
 * guardrail no matter what's "said".
 */
export function nextOffer(s: NegotiationState): OfferDecision {
  if (s.theirOfferMinor <= s.targetMinor) {
    return { offerMinor: s.theirOfferMinor, action: "accept", reason: "their offer meets our target" };
  }
  const base = s.ourLastMinor ?? s.targetMinor;
  // Concede a shrinking fraction of the remaining gap toward their offer.
  const gap = s.theirOfferMinor - base;
  const fraction = 1 / (s.round + 3); // round0: 1/3, round1: 1/4, …
  let offer = Math.round(base + Math.max(0, gap) * fraction);
  offer = Math.min(offer, s.ceilingMinor); // never breach the guardrail ceiling
  offer = Math.min(offer, s.theirOfferMinor); // never offer above what they asked
  return { offerMinor: offer, action: "counter", reason: `round ${s.round} concession within ceiling` };
}

// ── Benchmark aggregation with a privacy floor (E-21, FR-10.4, §18) ──────────

export const BENCHMARK_COHORT_FLOOR = 20;

export interface BenchmarkInput {
  metric: string;
  cohort: string;
  /** Per-tenant values in this cohort (raw — never leaves the aggregation). */
  values: number[];
}

export interface BenchmarkRow {
  metric: string;
  cohort: string;
  networkValue: number;
  sampleSize: number;
}

/**
 * Aggregate a cohort ONLY when it has ≥ FLOOR consenting members. Below the
 * floor returns null — never a padded or fabricated row. This is the privacy
 * guarantee: no aggregate can be traced back toward a small group.
 */
export function aggregateCohort(input: BenchmarkInput, floor = BENCHMARK_COHORT_FLOOR): BenchmarkRow | null {
  const n = input.values.length;
  if (n < floor) return null;
  const networkValue = input.values.reduce((s, v) => s + v, 0) / n;
  return { metric: input.metric, cohort: input.cohort, networkValue: Math.round(networkValue * 100) / 100, sampleSize: n };
}

/** Build the publishable benchmark set — every below-floor cohort is dropped. */
export function buildBenchmarks(inputs: BenchmarkInput[], floor = BENCHMARK_COHORT_FLOOR): BenchmarkRow[] {
  return inputs.map((i) => aggregateCohort(i, floor)).filter((r): r is BenchmarkRow => r !== null);
}

/** The founder-facing view: own value + network + honest sample size (or a
 *  cold-start state when the cohort is below floor). */
export function benchmarkView(ownValue: number, row: BenchmarkRow | null): {
  ownValue: number;
  networkValue: number | null;
  sampleSize: number;
  available: boolean;
  note?: string;
} {
  if (!row) return { ownValue, networkValue: null, sampleSize: 0, available: false, note: "Network value unavailable — cohort too small to compare privately." };
  return { ownValue, networkValue: row.networkValue, sampleSize: row.sampleSize, available: true };
}

export const TEAM_DEPARTMENTS: NovaDepartment[] = [
  "ceo", "marketing", "sales", "support", "product_research",
  "inventory", "operations", "shipping", "finance", "growth",
];
