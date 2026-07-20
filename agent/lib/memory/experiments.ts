/**
 * Experiments — the data-flywheel step that turns "we tried X" into evidence.
 *
 * A campaign or pricing action can attach an experiment id (a hypothesis with a
 * metric, baseline, and target). The evaluator — run as a step inside nightly
 * reflection — measures the metric against actuals, marks the experiment
 * won / lost / inconclusive, and records the outcome to `experiments` memory
 * with provenance so the lesson is durable and owner-visible.
 *
 * Everything is tenant-scoped through `storeId`; the evaluator only reads the
 * named tenant's campaigns and actions.
 */

import type { NovaExperiment, MemoryEntry } from "../types";
import { storeFor } from "../store/resolve";
import { computeCampaignMetrics } from "../nova/analytics";
import { upsertVia } from "./service";

/** Campaign metrics an experiment can be measured against. */
export const EXPERIMENT_METRICS = ["roas7d", "revenue7d", "cpa7d"] as const;
export type ExperimentMetric = (typeof EXPERIMENT_METRICS)[number];

function isExperimentMetric(metric: string): metric is ExperimentMetric {
  return (EXPERIMENT_METRICS as readonly string[]).includes(metric);
}

export interface CreateExperimentInput {
  hypothesis: string;
  actionIds: string[];
  /** Metric the experiment moves: one of the supported campaign metrics. */
  metric: ExperimentMetric;
  baseline: number;
  target: number;
}

export async function createExperiment(
  storeId: string,
  input: CreateExperimentInput,
): Promise<NovaExperiment> {
  return storeFor(storeId).createExperiment({
    hypothesis: input.hypothesis,
    actionIds: input.actionIds,
    metric: input.metric,
    baseline: input.baseline,
    target: input.target,
    actual: null,
    status: "running",
    evaluatedAt: null,
  });
}

/**
 * Decide an experiment's status from measured actuals. For "lower is better"
 * metrics (cpa7d) the comparison inverts. `null` actual stays inconclusive.
 */
export function evaluateOutcome(
  metric: string,
  baseline: number,
  target: number,
  actual: number | null,
): NovaExperiment["status"] {
  if (actual === null) return "inconclusive";
  const lowerIsBetter = metric === "cpa7d";
  if (lowerIsBetter) {
    if (actual <= target) return "won";
    if (actual >= baseline) return "lost";
    return "inconclusive";
  }
  if (actual >= target) return "won";
  if (actual <= baseline) return "lost";
  return "inconclusive";
}

/**
 * Resolve the subject campaign for an experiment from its linked actions, then
 * read the current value of the experiment's metric. Returns `null` when the
 * experiment isn't tied to a measurable campaign.
 */
async function measure(storeId: string, experiment: NovaExperiment): Promise<number | null> {
  const client = storeFor(storeId);
  for (const actionId of experiment.actionIds) {
    const action = await client.getAction(actionId);
    if (!action) continue;
    const campaignId =
      (typeof action.payload.campaignId === "string" && action.payload.campaignId) ||
      (action.undoData && typeof action.undoData.campaignId === "string" && action.undoData.campaignId);
    if (!campaignId) continue;
    const campaign = await client.getCampaign(campaignId);
    if (!campaign) continue;
    if (!isExperimentMetric(experiment.metric)) return null;
    const m = computeCampaignMetrics(client, campaign);
    return m[experiment.metric] ?? null;
  }
  return null;
}

export interface EvaluatedExperiment {
  experiment: NovaExperiment;
  memory: MemoryEntry;
}

/**
 * Evaluate every running experiment for a tenant: measure, decide, persist the
 * status, and write the outcome to `experiments` memory with provenance. Called
 * from reflection (and available as a tool). Returns what it decided.
 */
export async function evaluateExperiments(storeId: string): Promise<EvaluatedExperiment[]> {
  const client = storeFor(storeId);
  const running = await client.listExperiments("running");
  const results: EvaluatedExperiment[] = [];

  for (const experiment of running) {
    const actual = await measure(storeId, experiment);
    const status = evaluateOutcome(experiment.metric, experiment.baseline, experiment.target, actual);
    if (status === "inconclusive" && actual === null) continue; // not measurable yet

    const updated = await client.updateExperiment(experiment.id, {
      actual,
      status,
      evaluatedAt: client.now(),
    });
    const verdict =
      status === "won" ? "won" : status === "lost" ? "lost" : "was inconclusive";
    const memory = await upsertVia(client, {
      namespace: "experiments",
      key: `experiment-${experiment.id}`,
      value: `${experiment.hypothesis} — ${verdict} (${experiment.metric}: baseline ${experiment.baseline}, target ${experiment.target}, actual ${actual ?? "n/a"}).`,
      source: "reflection",
      weight: status === "won" ? 1.0 : 0.7,
      provenance: { actionIds: experiment.actionIds, note: "experiment evaluator" },
    });
    results.push({ experiment: updated, memory });
  }
  return results;
}
