/**
 * The action pipeline — every mutation Nova attempts flows through here.
 *
 * performAction() gates the request against the current autonomy level and
 * guardrails, then either executes it, queues it as a prepared action for
 * owner approval, or blocks it. approve/reject/undo implement the owner
 * side of the PRD trust system.
 *
 * Stage 0 (blueprint phase 06): every write carries a full E-8 receipt
 * {evidence[], before, after, confidence, expected impact, reason} — including
 * refusals, whose evidence is the gate rule that fired. Undo is a right with a
 * clock: undoable executions get a 24h `undoDeadline`, and a past-deadline
 * undo attempt is itself persisted as an explained refusal.
 */

import type {
  ActionReceipt,
  ActionRecord,
  ActionType,
  NovaDepartment,
  ReceiptEvidence,
} from "../types";
import type { StoreClient } from "../store/client";
import type { ReceiptInput } from "./schemas";
import { gateAction } from "./autonomy";
import { executors, undoers } from "./executors";
import { recordActivity } from "./activity";
import { learnFromRejection } from "../memory/service";

export interface ActionRequest {
  type: ActionType;
  department: NovaDepartment;
  /** Short owner-facing title, e.g. `Pause "Cozy Nights" campaign`. */
  title: string;
  payload: Record<string, unknown>;
  /** Model-authored receipt half: reason, expected impact, confidence, evidence[]. */
  receipt: ReceiptInput;
  /** E-5 duty key — populated once phase 07 seeds the registry. */
  dutyRef?: string | null;
}

export interface PerformResult {
  status: "executed" | "prepared" | "blocked";
  actionId: string;
  /** What happened / what will happen — written for the owner. */
  detail: string;
  undoable: boolean;
}

/** Assemble the full E-8 receipt from the model-authored half + run-time snapshots. */
function buildReceipt(
  input: ReceiptInput,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  extraEvidence: ReceiptEvidence[] = [],
): ActionReceipt {
  return {
    reason: input.reason,
    expectedImpact: input.expectedImpact,
    confidence: input.confidence,
    evidence: [...input.evidence, ...extraEvidence],
    before,
    after,
  };
}

/** The derived compatibility projection stored alongside the receipt. */
function justificationOf(receipt: ActionReceipt) {
  return {
    reason: receipt.reason,
    expectedImpact: receipt.expectedImpact,
    confidence: receipt.confidence,
  };
}

/** Gate, then execute / queue / block. Used by every action tool. */
export async function performAction(
  client: StoreClient,
  request: ActionRequest,
): Promise<PerformResult> {
  const config = await client.getAutonomy();
  const decision = await gateAction(client, config, request.type, request.payload);

  if (decision.verdict === "block") {
    // A refusal is an explained, receipted event — its evidence is the rule
    // that fired (PRD §13 non-negotiables).
    const receipt = buildReceipt(request.receipt, null, null, [
      { source: "authority_gate", note: decision.explanation },
    ]);
    const record = await client.addAction({
      type: request.type,
      department: request.department,
      title: request.title,
      payload: request.payload,
      justification: justificationOf(receipt),
      receipt,
      riskClass: decision.riskClass,
      status: "blocked",
      outcome: decision.explanation,
      undoable: false,
      undoData: null,
      actor: "nova",
      targetRef: null,
      agentId: null,
      dutyRef: request.dutyRef ?? null,
      undoDeadline: null,
      undoneAt: null,
      decidedAt: client.now(),
      executedAt: null,
    });
    return {
      status: "blocked",
      actionId: record.id,
      detail: decision.explanation,
      undoable: false,
    };
  }

  if (decision.verdict === "prepare") {
    // Drafts carry the authored receipt; before/after snapshots are taken at
    // execution time (the approve path records them in the outcome — the
    // Decision service, phase 08, upgrades this to predicted snapshots).
    const receipt = buildReceipt(request.receipt, null, null);
    const record = await client.addAction({
      type: request.type,
      department: request.department,
      title: request.title,
      payload: request.payload,
      justification: justificationOf(receipt),
      receipt,
      riskClass: decision.riskClass,
      status: "prepared",
      outcome: null,
      undoable: false,
      undoData: null,
      actor: "nova",
      targetRef: null,
      agentId: null,
      dutyRef: request.dutyRef ?? null,
      undoDeadline: null,
      undoneAt: null,
      decidedAt: null,
      executedAt: null,
    });
    return {
      status: "prepared",
      actionId: record.id,
      detail: `${decision.explanation} The action is fully prepared — the owner can approve it with approve_action("${record.id}").`,
      undoable: false,
    };
  }

  return executeNow(client, request, decision.riskClass);
}

async function executeNow(
  client: StoreClient,
  request: ActionRequest,
  riskClass: ActionRecord["riskClass"],
): Promise<PerformResult> {
  const execution = await executors[request.type](client, request.payload);
  const receipt = buildReceipt(
    request.receipt,
    execution.before ?? null,
    execution.after ?? null,
  );
  const record = await client.addAction({
    type: request.type,
    department: request.department,
    title: request.title,
    payload: request.payload,
    justification: justificationOf(receipt),
    receipt,
    riskClass,
    status: "executed",
    outcome: execution.outcome,
    undoable: execution.undoable,
    undoData: execution.undoData,
    actor: "nova",
    targetRef: execution.targetRef ?? null,
    agentId: null,
    dutyRef: request.dutyRef ?? null,
    // The backend stamps executedAt + 24h on undoable executions; passing null
    // keeps demo and live backends on the same server-computed semantics.
    undoDeadline: null,
    undoneAt: null,
    decidedAt: client.now(),
    executedAt: client.now(),
  });
  await recordActivity(client, {
    department: request.department,
    kind: "action",
    title: request.title,
    detail: execution.outcome,
    actionType: request.type,
    revenueInfluence: execution.revenueInfluence,
    actionId: record.id,
    relatedId: execution.relatedId,
  });
  return {
    status: "executed",
    actionId: record.id,
    detail: execution.outcome,
    undoable: execution.undoable,
  };
}

export interface DecisionResult {
  actionId: string;
  detail: string;
}

/** Owner approves a prepared action → it executes now. */
export async function approveAction(
  client: StoreClient,
  actionId: string,
): Promise<DecisionResult> {
  const record = await client.getAction(actionId);
  if (!record) throw new Error(`Action not found: ${actionId}`);
  if (record.status !== "prepared") {
    throw new Error(`Action ${actionId} is ${record.status}, not awaiting approval.`);
  }
  const execution = await executors[record.type](client, record.payload);
  await client.updateAction(actionId, {
    status: "executed",
    outcome: execution.outcome,
    undoData: execution.undoData,
    // Approved actions keep their undo right (Stage 0 fix — this was silently
    // dropped before: prepared rows are stored undoable:false and approval
    // never flipped it, so nothing approved could ever be undone).
    undoable: execution.undoable,
    decidedAt: client.now(),
    executedAt: client.now(),
  });
  await recordActivity(client, {
    department: record.department,
    kind: "action",
    title: record.title,
    detail: `Approved by owner. ${execution.outcome}`,
    actionType: record.type,
    revenueInfluence: execution.revenueInfluence,
    actionId,
    relatedId: execution.relatedId,
  });
  return { actionId, detail: execution.outcome };
}

export async function rejectAction(
  client: StoreClient,
  actionId: string,
  reason?: string,
): Promise<DecisionResult> {
  const record = await client.getAction(actionId);
  if (!record) throw new Error(`Action not found: ${actionId}`);
  if (record.status !== "prepared") {
    throw new Error(`Action ${actionId} is ${record.status}, not awaiting approval.`);
  }
  await client.updateAction(actionId, {
    status: "rejected",
    outcome: reason ? `Rejected by owner: ${reason}` : "Rejected by owner.",
    decidedAt: client.now(),
  });
  // Rejections teach immediately: write a standing-objection preference now, so
  // Nova stops repeating the mistake without waiting for nightly reflection.
  await learnFromRejection(client, record, reason);
  return {
    actionId,
    detail: `Rejected${reason ? ` (${reason})` : ""}. Nova will remember this preference.`,
  };
}

/** Roll back an executed action using the executor's undo snapshot. */
export async function undoAction(
  client: StoreClient,
  actionId: string,
): Promise<DecisionResult> {
  const record = await client.getAction(actionId);
  if (!record) throw new Error(`Action not found: ${actionId}`);
  if (record.status !== "executed") {
    throw new Error(`Action ${actionId} is ${record.status}; only executed actions can be undone.`);
  }
  if (!record.undoable || !record.undoData) {
    throw new Error(
      `Action ${actionId} (${record.type}) is not reversible — e.g. a message that was already sent.`,
    );
  }
  // Undo is a right with a clock (E-8): past the 24h window the refusal is
  // itself a persisted, explained event — never a silent failure.
  if (record.undoDeadline && Date.parse(client.now()) > Date.parse(record.undoDeadline)) {
    const explanation = `Undo window expired ${record.undoDeadline} (24h after execution). The market has moved on this data; re-run the change deliberately instead of reverting.`;
    await client.addAction({
      type: record.type,
      department: record.department,
      title: `Undo refused: ${record.title}`,
      payload: { actionId },
      justification: {
        reason: explanation,
        expectedImpact: "No change; the original action stands.",
        confidence: 1,
      },
      receipt: {
        reason: explanation,
        expectedImpact: "No change; the original action stands.",
        confidence: 1,
        evidence: [
          { source: "undo_window", note: `deadline ${record.undoDeadline}, attempted ${client.now()}` },
        ],
        before: null,
        after: null,
      },
      riskClass: record.riskClass,
      status: "blocked",
      outcome: explanation,
      undoable: false,
      undoData: null,
      actor: "system",
      targetRef: record.targetRef,
      agentId: null,
      dutyRef: record.dutyRef,
      undoDeadline: null,
      undoneAt: null,
      decidedAt: client.now(),
      executedAt: null,
    });
    throw new Error(explanation);
  }
  const undoer = undoers[record.type];
  if (!undoer) {
    throw new Error(`No undo procedure exists for ${record.type}.`);
  }
  const outcome = await undoer(client, record.undoData);
  await client.updateAction(actionId, {
    status: "undone",
    outcome: `${record.outcome ?? ""} — UNDONE: ${outcome}`.trim(),
  });
  await recordActivity(client, {
    department: record.department,
    kind: "action",
    title: `Undo: ${record.title}`,
    detail: outcome,
    actionType: record.type,
    revenueInfluence: 0,
    actionId,
  });
  return { actionId, detail: outcome };
}
