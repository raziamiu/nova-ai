/**
 * The action pipeline — every mutation Nova attempts flows through here.
 *
 * performAction() gates the request against the current autonomy level and
 * guardrails, then either executes it, queues it as a prepared action for
 * owner approval, or blocks it. approve/reject/undo implement the owner
 * side of the PRD trust system.
 */

import type {
  ActionJustification,
  ActionRecord,
  ActionType,
  NovaDepartment,
} from "../types";
import type { StoreClient } from "../store/client";
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
  justification: ActionJustification;
}

export interface PerformResult {
  status: "executed" | "prepared" | "blocked";
  actionId: string;
  /** What happened / what will happen — written for the owner. */
  detail: string;
  undoable: boolean;
}

/** Gate, then execute / queue / block. Used by every action tool. */
export async function performAction(
  client: StoreClient,
  request: ActionRequest,
): Promise<PerformResult> {
  const config = await client.getAutonomy();
  const decision = await gateAction(client, config, request.type, request.payload);

  if (decision.verdict === "block") {
    const record = await client.addAction({
      type: request.type,
      department: request.department,
      title: request.title,
      payload: request.payload,
      justification: request.justification,
      riskClass: decision.riskClass,
      status: "blocked",
      outcome: decision.explanation,
      undoable: false,
      undoData: null,
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
    const record = await client.addAction({
      type: request.type,
      department: request.department,
      title: request.title,
      payload: request.payload,
      justification: request.justification,
      riskClass: decision.riskClass,
      status: "prepared",
      outcome: null,
      undoable: false,
      undoData: null,
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
  const record = await client.addAction({
    type: request.type,
    department: request.department,
    title: request.title,
    payload: request.payload,
    justification: request.justification,
    riskClass,
    status: "executed",
    outcome: execution.outcome,
    undoable: execution.undoable,
    undoData: execution.undoData,
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
