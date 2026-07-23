/**
 * The FR-7 intent table (Stage 5 "Conversation").
 *
 * Every thing the founder can ask Nova in chat is a ROW here, not a branch in a
 * prompt: an intent → the department that owns it → the primitive verbs it uses
 * (the SAME tools the UI verbs call, never a chat-only path). The router prompt
 * is generated from this table (`routingPromptSection`), so adding an intent is
 * a data edit, not a router rewrite.
 *
 * H2 intents (playbook approve, negotiation, benchmarks, promote-agent) ship
 * NOW as honest deferrals from the same table — the model answers "that arrives
 * with the Team stage" instead of improvising a capability that doesn't exist.
 * Filling them in a later stage is flipping `status` and dropping the note; the
 * router doesn't change.
 */

import { NOVA_DEPARTMENTS, type NovaDepartment } from "../types";

export type IntentStatus = "live" | "deferred";

export interface IntentSpec {
  /** Stable slug — referenced by evals and the router contract. */
  id: string;
  /** Owning department. "ceo" = the root answers or dispatches; `routed` intents
   *  are dept-parameterized (the root picks the department from the question). */
  department: NovaDepartment;
  /** True when the target department is chosen from the question at runtime
   *  (e.g. "why is marketing a B?" vs "why is shipping a D?"). */
  routed: boolean;
  /** One line the founder would recognise as this ask. */
  summary: string;
  /** Primitive verbs this intent uses — the same tools the UI verbs dispatch. */
  verbs: string[];
  status: IntentStatus;
  /** For deferred intents: the honest "arrives with X" reply the model gives. */
  deferralNote?: string;
}

export const INTENTS: IntentSpec[] = [
  // ── Live (H1) — shipping in Stage 5 ──────────────────────────────────────
  {
    id: "explain_grade",
    department: "ceo",
    routed: true,
    summary: "Why is a department graded the way it is? (e.g. \"why is marketing a B?\")",
    verbs: ["get_department_grade"],
    status: "live",
  },
  {
    id: "report_metric",
    department: "ceo",
    routed: true,
    summary: "What's a number right now? (orders today, revenue this week, cart value…)",
    verbs: ["get_business_snapshot", "get_orders", "get_finance_report"],
    status: "live",
  },
  {
    id: "execute_action",
    department: "ceo",
    routed: true,
    summary: "Do something now — pause a campaign, make a discount, reorder stock.",
    verbs: ["update_campaign", "create_discount", "create_purchase_order", "update_price"],
    status: "live",
  },
  {
    id: "propose_options",
    department: "ceo",
    routed: true,
    summary: "What should I do about X? → Nova proposes options as decision chips.",
    verbs: ["list_actions"],
    status: "live",
  },
  {
    id: "guardrail_refusal",
    department: "ceo",
    routed: false,
    summary: "An over-authority ask → refused by name + an escalation decision card.",
    verbs: ["evaluate_authority"],
    status: "live",
  },
  {
    id: "set_no_touch",
    department: "ceo",
    routed: false,
    summary: "Put something off-limits — \"don't ever touch pricing\".",
    verbs: ["set_no_touch_lock"],
    status: "live",
  },
  {
    id: "delegate_task",
    department: "ceo",
    routed: false,
    summary: "Hand Nova an open-ended job — \"find me a cheaper courier\" → a queued task.",
    verbs: ["delegate_task"],
    status: "live",
  },
  {
    id: "content_review",
    department: "marketing",
    routed: false,
    summary: "\"Anything for me to review?\" → the pending content drafts (Stage 4).",
    verbs: ["get_pending_content"],
    status: "live",
  },

  // ── Deferred (H2) — honest refusals from the same table ───────────────────
  {
    id: "playbook_approve",
    department: "ceo",
    routed: false,
    summary: "Approve/adjust a reusable playbook Nova proposed.",
    verbs: [],
    status: "deferred",
    deferralNote: "Approving playbooks arrives with the Team stage — I can't promote one yet.",
  },
  {
    id: "negotiation_status",
    department: "operations",
    routed: false,
    summary: "\"How's the supplier negotiation going?\" / listen in.",
    verbs: [],
    status: "deferred",
    deferralNote: "Supplier negotiation arrives with the Team stage — there's nothing live to listen in on yet.",
  },
  {
    id: "benchmarks",
    department: "ceo",
    routed: false,
    summary: "\"How do I compare to other stores?\" — peer benchmarks.",
    verbs: [],
    status: "deferred",
    deferralNote: "Peer benchmarks arrive with a later stage — I only speak to your own numbers for now.",
  },
  {
    id: "promote_agent",
    department: "ceo",
    routed: false,
    summary: "Promote a department agent's autonomy from chat.",
    verbs: [],
    status: "deferred",
    deferralNote: "Promoting an agent arrives with the Team stage — set autonomy from the settings for now.",
  },
];

const DEPT_SET = new Set<string>(NOVA_DEPARTMENTS);

/** All intents that own a real capability today. */
export function liveIntents(): IntentSpec[] {
  return INTENTS.filter((i) => i.status === "live");
}

/** H2 intents that answer with an honest deferral. */
export function deferredIntents(): IntentSpec[] {
  return INTENTS.filter((i) => i.status === "deferred");
}

export function getIntent(id: string): IntentSpec | undefined {
  return INTENTS.find((i) => i.id === id);
}

/** Every intent that lists a given department as its owner. */
export function intentsForDepartment(dept: NovaDepartment): IntentSpec[] {
  return INTENTS.filter((i) => i.department === dept);
}

/**
 * Generate the routing contract the root (CEO-Nova) reads. The prompt is DERIVED
 * from the table so it can never drift from what the intents actually are.
 */
export function routingPromptSection(): string {
  const live = liveIntents()
    .map((i) => `- ${i.id}${i.routed ? " (pick the department from the question)" : ` → ${i.department}`}: ${i.summary}`)
    .join("\n");
  const deferred = deferredIntents()
    .map((i) => `- ${i.id}: reply honestly — "${i.deferralNote}"`)
    .join("\n");
  return (
    "Match the founder's message to ONE intent, then act through that intent's " +
    "verbs. Quick lookups you can answer yourself, signed `ceo`; department " +
    "questions delegate to the owning department.\n\nLIVE intents:\n" +
    live +
    "\n\nNOT YET (answer honestly, never improvise the capability):\n" +
    deferred
  );
}

/** Guards used by both the eval and (at runtime) envelope validation. */
export function validateIntents(): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const i of INTENTS) {
    if (seen.has(i.id)) errors.push(`duplicate intent id: ${i.id}`);
    seen.add(i.id);
    if (!DEPT_SET.has(i.department)) errors.push(`${i.id}: unknown department ${i.department}`);
    if (i.status === "live" && i.verbs.length === 0) errors.push(`${i.id}: live intent has no verbs`);
    if (i.status === "deferred" && !i.deferralNote) errors.push(`${i.id}: deferred intent has no deferralNote`);
  }
  return errors;
}
