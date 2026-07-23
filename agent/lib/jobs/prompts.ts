/**
 * Job prompt templates (Phase 05) — the six daily-loop schedules' markdown
 * bodies, ported verbatim from the old `agent/schedules/*.ts` files (now
 * retired) into per-kind templates the dispatcher renders at claim time.
 * Behavior is unchanged from the single-tenant static schedules; only the
 * trigger mechanism moved (per-tenant job row instead of a UTC-only cron
 * file). `reflection` gained one new step: Phase 04's `attribution.ts` was
 * built and tested but never invoked outside the eval harness — wiring the
 * `run_attribution` tool in here is Phase 05's fix for that gap.
 */

import type { NovaJob } from "../types";

/** Job kinds whose template calls file_report — these get the dedupeKey instruction appended. */
const FILES_REPORT = new Set<NovaJob["kind"]>(["morning_report", "pulse", "night_ops", "weekly_strategy"]);

function dedupeInstruction(job: NovaJob): string {
  return `\n\nWhen filing the report, pass dedupeKey: "${job.dedupeKey}" so a retried run of this same occurrence never double-files it.`;
}

const TEMPLATES: Record<NovaJob["kind"], string> = {
  morning_report:
    "It is morning report time. Load the morning-report skill and follow it " +
    "exactly: gather the overnight numbers, completed work, anomalies, and " +
    "pending approvals, then file the report with file_report (kind " +
    '"morning"). Work only from tool data.',

  pulse:
    "Hourly pulse check. First, call get_inbox_events (unprocessed) — these " +
    "are real store events (new/updated orders, newly abandoned carts) Dakio " +
    "has pushed since your last check. Skim them for anything that changes " +
    "what you'd otherwise report or act on this hour (e.g. a spike in new " +
    "orders, a cluster of cancellations, a big cart just abandoned) — you do " +
    "not need to act on every event individually, they're situational " +
    "awareness for the anomaly scan below, not a task list. Call " +
    "mark_event_processed on each one once you've taken it into account. " +
    "Then run detect_anomalies. If there are no critical findings, stop — do " +
    "not file a report or take action (never spam the owner). If there ARE " +
    "critical findings: take the corrective action for each through the " +
    "normal action tools (they are autonomy-gated, so they will execute or " +
    "queue for approval as configured), then file ONE consolidated report " +
    'with file_report (kind "pulse") listing each finding, the evidence, and ' +
    "what was done or prepared.",

  cart_sweep:
    "Abandoned cart sweep. Load the cart-recovery skill and follow it: find " +
    "untouched carts, write personalized recovery messages in the brand " +
    "voice, send them via send_customer_message (autonomy-gated), and finish " +
    "with one consolidated summary of carts contacted, value at stake, and " +
    "expected recoveries.",

  night_ops:
    "Night operations. Do the deep work now so the morning is ready:\n" +
    "1. Load the campaign-optimization skill and run it end to end.\n" +
    "2. Check inventory: get_products with lowStockOnly, then reorder via " +
    "create_purchase_order where days of cover will not outlast supplier " +
    "lead time (full justification each time).\n" +
    "3. Review open support tickets (get_support_tickets) and resolve what " +
    "can be resolved in the brand voice.\n" +
    "4. Prepare tomorrow's content: write ONE in-voice post draft for a product " +
    "with momentum and file it for the founder's review with generate_content " +
    "(it scores your copy against the brand voice). If it comes back flagged " +
    "off-voice, rewrite per the returned guidance and re-file with the SAME " +
    "contentId — never leave an off-voice draft in the review queue.\n" +
    "5. File a night plan with file_report (kind \"night_plan\"): what was " +
    "done, what is queued for approval (with actionIds), and tomorrow's " +
    "single highest-impact focus.",

  weekly_strategy:
    "Weekly strategy review. Load the weekly-strategy skill and follow it: " +
    "measure the week against the stored goals, write the strategy review, " +
    'file it with file_report (kind "weekly_strategy"), and store next ' +
    "week's committed focus in memory.",

  reflection:
    "Nightly reflection. Load the reflection skill and follow it end to end:\n" +
    "1. Review the last 24h of decisions — especially any actions the owner " +
    "rejected (list_actions) and the reasons they gave.\n" +
    "2. Distill durable lessons into memory with the remember tool — owner " +
    "rejections become preference/rule candidates, each citing the action it " +
    "came from. Keep it to at most 10 writes; update existing entries rather " +
    "than duplicating.\n" +
    "3. Evaluate any open experiments against their targets and record the " +
    "outcomes (evaluate_experiments).\n" +
    "4. Run run_attribution to rewrite any cart-recovery activity whose " +
    "influence is still an estimate to the real order total, now that a day " +
    "has passed and some may have measurably converted.\n" +
    "5. Record a one-line owner-facing 'I learned…' note IN MEMORY (the " +
    "remember tool, not file_report — reflection never files its own " +
    "report; the morning report reads this note from memory the next day). " +
    "Never invent a lesson you cannot trace to a real decision.",
};

/**
 * Renders the job-kind's prompt. Job payload facts aren't interpolated into
 * the text (they're data for tools to read, not instructions) — the one
 * exception is `dedupeKey`, appended for report-filing kinds so a re-leased
 * rerun of the same occurrence re-files the same report row (see
 * `file_report.ts` / dakio-api's `POST /reports`).
 */
export function renderJobPrompt(job: NovaJob): string {
  const base = TEMPLATES[job.kind];
  return FILES_REPORT.has(job.kind) ? base + dedupeInstruction(job) : base;
}
