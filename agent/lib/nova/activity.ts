/**
 * Activity log + the "Business Hours Saved" metric.
 *
 * The PRD's success metric is not AI usage — it's founder time returned.
 * Every piece of work Nova completes records a human-equivalent time cost,
 * and the dashboard aggregates it into hours worked, tasks completed, and
 * revenue influenced.
 */

import type { ActionType, ActivityEntry, NovaDepartment } from "../types";
import type { StoreClient } from "../store/client";

/** Human-equivalent minutes a founder would spend doing this by hand. */
const MINUTES_BY_ACTION: Record<ActionType, number> = {
  send_customer_message: 8,
  resolve_ticket: 12,
  publish_social_post: 35,
  update_campaign: 20,
  create_campaign: 90,
  create_discount: 10,
  update_price: 15,
  import_product: 45,
  assign_courier: 6,
  create_purchase_order: 25,
  switch_supplier: 40,
};

const MINUTES_BY_KIND: Record<ActivityEntry["kind"], number> = {
  action: 15, // fallback when no action type applies
  analysis: 30,
  communication: 8,
  report: 45,
  alert: 5,
};

export interface ActivityInput {
  department: NovaDepartment;
  kind: ActivityEntry["kind"];
  title: string;
  detail: string;
  actionType?: ActionType;
  revenueInfluence?: number;
  actionId?: string;
  /** Business entity this relates to (cart/order id), for attribution joins. */
  relatedId?: string | null;
  /** Override the human-equivalent minutes if the defaults don't fit. */
  minutesSaved?: number;
}

export async function recordActivity(
  client: StoreClient,
  input: ActivityInput,
): Promise<ActivityEntry> {
  const minutesSaved =
    input.minutesSaved ??
    (input.actionType !== undefined
      ? MINUTES_BY_ACTION[input.actionType]
      : MINUTES_BY_KIND[input.kind]);
  return client.addActivity({
    department: input.department,
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    minutesSaved,
    revenueInfluence: input.revenueInfluence ?? 0,
    actionId: input.actionId ?? null,
    relatedId: input.relatedId ?? null,
    revenueBasis: "estimated",
  });
}

export interface WorkSummary {
  sinceDays: number;
  tasksCompleted: number;
  hoursWorked: number;
  revenueInfluenced: number;
  byDepartment: { department: NovaDepartment; tasks: number; hours: number }[];
  byKind: { kind: ActivityEntry["kind"]; tasks: number }[];
}

/** Aggregate the activity log into the PRD dashboard metrics. */
export async function summarizeWork(
  client: StoreClient,
  sinceDays: number,
): Promise<WorkSummary> {
  const entries = await client.listActivity({ sinceDays });
  const byDepartment = new Map<NovaDepartment, { tasks: number; minutes: number }>();
  const byKind = new Map<ActivityEntry["kind"], number>();
  let minutes = 0;
  let revenue = 0;
  for (const entry of entries) {
    minutes += entry.minutesSaved;
    revenue += entry.revenueInfluence;
    const dept = byDepartment.get(entry.department) ?? { tasks: 0, minutes: 0 };
    dept.tasks += 1;
    dept.minutes += entry.minutesSaved;
    byDepartment.set(entry.department, dept);
    byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);
  }
  return {
    sinceDays,
    tasksCompleted: entries.length,
    hoursWorked: Math.round((minutes / 60) * 10) / 10,
    revenueInfluenced: Math.round(revenue * 100) / 100,
    byDepartment: [...byDepartment.entries()]
      .map(([department, v]) => ({
        department,
        tasks: v.tasks,
        hours: Math.round((v.minutes / 60) * 10) / 10,
      }))
      .sort((a, b) => b.hours - a.hours),
    byKind: [...byKind.entries()]
      .map(([kind, tasks]) => ({ kind, tasks }))
      .sort((a, b) => b.tasks - a.tasks),
  };
}
