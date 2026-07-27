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
export const MINUTES_BY_ACTION: Record<ActionType, number> = {
  // Reviewing and refunding a batch by hand, per the founder.
  bulk_refund: 25,
  send_customer_message: 8,
  // Front Office (canonical, module 09): reading the thread, checking the
  // fact, writing two human bubbles and sending them is ~3 minutes of a
  // founder's evening — deliberately modest, because this one fires hundreds
  // of times a week and an inflated number would make the hours-saved figure
  // a lie at scale.
  send_inbox_reply: 3,
  escalate_conversation: 2,
  // Module 03. Looking a customer up by the number they just gave, confirming
  // it is them, and writing the join into the CRM by hand is ~2 minutes — the
  // same order as an escalation, and it fires on most linked threads, so an
  // inflated number would inflate the headline. The merge is 5: pulling both
  // records, comparing order histories and re-keying by hand is a careful few
  // minutes, and it fires rarely enough that a modest number costs nothing.
  link_customer_identity: 2,
  merge_customer_records: 5,
  // Module 04 (canonical D7). Writing "chase Rahima at 4" on a notepad is about
  // a minute of a founder's evening — and the minute that actually gets saved
  // is the one spent REMEMBERING to look at the notepad, which no number here
  // can honestly claim. Deliberately the lowest entry in this table: it fires
  // on a large share of unresolved threads, so anything bigger would inflate
  // the hours-saved headline on the strength of a reminder.
  schedule_follow_up: 1,
  // Module 05 (canonical D5/D6/D7). The biggest entries in the Front Office
  // block, and they are the only ones that deserve to be: taking a COD order in
  // a DM by hand is the founder's evening — reading the thread, checking stock
  // and the size, asking for name/phone/address/district one message at a time,
  // reading the total back, waiting for the yes, then typing all of it into the
  // orders screen. Twelve minutes is the shopkeeper's own estimate and it is
  // the LOW end of what the typing alone costs.
  create_order_from_chat: 12,
  // Haggling is slower than it looks: declining once, framing the value,
  // deciding what to give up, then creating a coupon in another screen and
  // coming back to the thread with the code.
  offer_chat_discount: 10,
  // Deliberately small, because the honest work here is small. Nova files the
  // claim; it does not verify it. The founder still opens their bKash statement
  // and matches the trxId by eye — that minute is NOT saved and this number
  // must not pretend it is. What is saved is reading the thread, pulling the
  // trxId and amount out of it and attaching the right order.
  verify_payment_slip: 4,
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
  // ── Module 06 ───────────────────────────────────────────────────────────
  // Opening the case, writing the first fact, and remembering to come back —
  // the part a busy founder reliably drops, not the part that is hard.
  open_case: 3,
  // THE PHONE CALL IT REPLACES. Dakio cannot reschedule or redirect a parcel at
  // any of the three couriers, so the founder still rings the hub — but they
  // ring it holding the tracking id, the last scan, the expected COD and what
  // the customer was already told, instead of assembling all of that first. Ten
  // minutes is the assembly, not the call.
  flag_courier_issue: 10,
  confirm_order_intent: 2,
  update_order_contact: 5,
  cancel_order_from_chat: 6,
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
  /**
   * Where a revenue figure came from, e.g. `chat_order:<orderId>` (module 09).
   *
   * `relatedId` is not enough on its own: it is a free-text column every verb
   * shares, so it cannot say WHICH kind of thing produced the number. This
   * string is what the nightly attribution sweep joins on and what makes a
   * figure in a department room reproducible from the ledger export.
   *
   * Deliberately NOT paired with a `revenueBasis` override. Every figure this
   * function writes is an estimate at write time — a COD order is not collected
   * money — and only the sweep, which reads the parcel's actual outcome, may
   * promote one to `measured`. Letting a caller pass `measured` here is exactly
   * how dakio-api's approve path came to disagree with this one about the same
   * verb.
   */
  revenueProvenance?: string | null;
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
    revenueProvenance: input.revenueProvenance ?? null,
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
