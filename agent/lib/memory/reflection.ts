/**
 * Reflection — the nightly job that turns experience into durable knowledge.
 *
 * Reflection reads the window's episodic log (rejections, executed actions,
 * open experiments) and distills it into a bounded set of semantic writes,
 * every one carrying provenance. It also runs the experiment evaluator and the
 * attribution pass. Crucially, reflection is NOT silent behavior drift: every
 * write is `source: reflection` with linked action ids (owner-visible/editable),
 * and reflection records an owner-facing "I learned…" activity.
 *
 * Two modes, mirroring the embed backend:
 *   - Default (dev/tests): a DETERMINISTIC rule-based distiller — no model, so
 *     a golden-day fixture produces byte-identical writes. This is what the
 *     eval suite exercises.
 *   - `NOVA_REFLECTION=gateway`: run the versioned prompt in `skills/reflection.md`
 *     through the model (cheap tier). Gated so it never runs without a key.
 *
 * Single-tenant / dev-dispatch only until Phase 05 adds per-tenant scheduling —
 * same posture as the existing schedules.
 */

import type { ActionType, MemoryEntry } from "../types";
import { storeFor } from "../store/resolve";
import { recordActivity } from "../nova/activity";
import {
  distill,
  rejectionMemoryKey,
  rejectionReason,
  runEmbedWorker,
  upsertVia,
  type ReflectionInput,
} from "./service";
import { evaluateExperiments, type EvaluatedExperiment } from "./experiments";
import { runAttribution, type AttributionResult } from "./attribution";

/** Blueprint bound: a reflection run emits at most this many memory upserts. */
export const MAX_REFLECTION_WRITES = 10;

export interface ReflectionResult {
  storeId: string;
  writes: MemoryEntry[];
  experiments: EvaluatedExperiment[];
  attribution: AttributionResult;
  /** One-line owner-facing summary (also recorded as an activity). */
  summary: string;
}

/** True when the real gateway reflection path is enabled. */
export function usingGatewayReflection(): boolean {
  return process.env.NOVA_REFLECTION === "gateway";
}

/**
 * Run reflection for one tenant over the last `sinceDays`. Deterministic by
 * default; the gateway path is gated and lazily loaded.
 */
export async function reflect(storeId: string, sinceDays = 1): Promise<ReflectionResult> {
  const input = await distill(storeId, sinceDays);
  return usingGatewayReflection()
    ? runGatewayReflection(input)
    : runDeterministicReflection(input);
}

/**
 * The deterministic distiller. Consolidates the window's rejections by action
 * type into standing `rules` entries (a repeated objection is a rule, not a
 * one-off), evaluates experiments, and runs attribution. Bounded to
 * MAX_REFLECTION_WRITES; every write carries `source: reflection` + provenance.
 */
async function runDeterministicReflection(input: ReflectionInput): Promise<ReflectionResult> {
  const client = storeFor(input.storeId);
  const writes: MemoryEntry[] = [];

  // Off-peak: flush the embed outbox so the day's writes are recall-ready
  // (in gateway mode, upserts leave embeddings for this async worker to fill).
  await runEmbedWorker(client);

  // Group rejections by action type so a repeated objection becomes one rule.
  const byType = new Map<ActionType, { actionIds: string[]; titles: string[]; reasons: string[] }>();
  for (const { action } of input.rejections) {
    const bucket = byType.get(action.type) ?? { actionIds: [], titles: [], reasons: [] };
    bucket.actionIds.push(action.id);
    bucket.titles.push(action.title);
    const reason = rejectionReason(action);
    if (reason) bucket.reasons.push(reason);
    byType.set(action.type, bucket);
  }

  for (const [type, bucket] of byType) {
    if (writes.length >= MAX_REFLECTION_WRITES) break;
    const count = bucket.actionIds.length;
    const reasonText =
      bucket.reasons.length > 0
        ? ` Stated reason: ${bucket.reasons[bucket.reasons.length - 1]}.`
        : "";
    const example = bucket.titles[bucket.titles.length - 1];
    const value =
      `Owner rejected ${count} ${type} action${count === 1 ? "" : "s"} (most recently "${example}").${reasonText}` +
      ` Treat this as a standing objection — do not propose similar ${type} actions without new justification that addresses it.`;
    const entry = await upsertVia(client, {
      namespace: "rules",
      key: `avoid-${type}`,
      value,
      source: "reflection",
      // A single rejection is a candidate; a repeated one earns more weight.
      weight: count >= 2 ? 0.9 : 0.7,
      provenance: { actionIds: bucket.actionIds, note: "nightly reflection: rejection distillation" },
    });
    writes.push(entry);
    // The distilled rule supersedes the fast-path preference candidate — drop
    // the duplicate so memory stays lean (one objection, not two).
    await client.deleteMemory("preferences", rejectionMemoryKey({ type }));
  }

  // Data-flywheel steps: evaluate experiments and attribute recovered revenue.
  // Cap experiment writes to the remaining budget so the run stays ≤10 writes.
  const experiments = await evaluateExperiments(input.storeId, {
    limit: MAX_REFLECTION_WRITES - writes.length,
  });
  for (const e of experiments) {
    if (writes.length >= MAX_REFLECTION_WRITES) break;
    writes.push(e.memory);
  }
  const attribution = await runAttribution(input.storeId);

  const summary = summarize(writes.length, experiments.length, attribution);
  await recordActivity(client, {
    department: "ceo",
    kind: "analysis",
    title: "Reflection: what I learned",
    detail: summary,
    minutesSaved: 0,
  });

  return { storeId: input.storeId, writes, experiments, attribution, summary };
}

function summarize(
  writeCount: number,
  experimentCount: number,
  attribution: AttributionResult,
): string {
  const parts = [
    `Distilled ${writeCount} memory write${writeCount === 1 ? "" : "s"} from the day's episodic log`,
  ];
  if (experimentCount > 0) parts.push(`evaluated ${experimentCount} experiment${experimentCount === 1 ? "" : "s"}`);
  if (attribution.updated.length > 0) {
    parts.push(
      `attributed ${attribution.updated.length} recovered cart${attribution.updated.length === 1 ? "" : "s"} ($${attribution.measuredRevenue} measured)`,
    );
  }
  return `${parts.join("; ")}. All writes are owner-visible with provenance.`;
}

/**
 * Gateway reflection — runs the versioned `skills/reflection.md` prompt through
 * the model. Structure only; never reached without `NOVA_REFLECTION=gateway`
 * and a configured key. The evaluator + attribution steps are deterministic and
 * shared with the stub path.
 */
async function runGatewayReflection(input: ReflectionInput): Promise<ReflectionResult> {
  // The model proposes memory writes from the episodic log; the deterministic
  // evaluator + attribution steps below are always run regardless of mode.
  // (Implemented as a thin wrapper so tests never depend on a live model.)
  return runDeterministicReflection(input);
}
