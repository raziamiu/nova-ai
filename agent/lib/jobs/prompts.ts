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

/**
 * The body for a lane dakio-api executes itself. Reaching a session with this
 * text means `leaseServerSweeps` did NOT claim the row and the dispatcher was
 * handed it anyway — a routing fault, not work — so it says exactly that and
 * asks for nothing.
 *
 * Writing the plausible instructions instead is what the module-03 review
 * caught: the obvious text for these three lanes describes capabilities that do
 * not exist on this side of the wire, so a model that somehow received it would
 * try, fail, and retry. `PATCH /promises/:id` answers 409 SWEEP_ONLY to any
 * caller claiming `broken`; there is no merge tool (only the
 * `merge_customer_records` verb, always behind a founder-approved Decision, per
 * D-09); and `remember` writes FOUNDER memory — customer memory has one writer,
 * the server-side distiller (D-24).
 */
function serverSideLane(kind: NovaJob["kind"]): string {
  return (
    `The ${kind} lane runs SERVER-SIDE in dakio-api (\`SERVER_SWEEPS\`, ` +
    "src/routes/novaJobs.js); it is never model work. Receiving this text means " +
    "the job reached a session instead of being claimed by the server — the " +
    "routing broke. Do nothing: touch no customer, no record and no ledger, and " +
    "report the fault."
  );
}

const TEMPLATES: Record<NovaJob["kind"], string> = {
  // Defensive dead path: `inbox_reply` jobs never render this template — the
  // dispatcher routes them to the customer conversation session via
  // `dispatchJobToChannel` (agent/channels/internal.ts), which builds its own
  // minimal instruction. Kept here only so the record stays total over
  // JobKind; if this text ever reaches a session, the routing broke.
  inbox_reply:
    "A customer conversation has undelivered inbound messages. Re-read the " +
    "unprocessed inbox events for this conversation before doing anything.",

  // A ROUTING TRIPWIRE, not instructions — and it had to become one in module
  // 04. Every `followup` that carries a `conversationId` is routed by
  // `dispatchJobToChannel` into `customer:inbox:<conversationId>`, whether it
  // is module 03's promise repayment or module 04's NBA nudge, so nothing that
  // has a thread reaches this text.
  //
  // What used to be here was the promise-fulfilment instruction ("A promise you
  // made to a customer is coming due…"), written when the dispatcher branched
  // on `promiseId != null` and NBA nudges were expected to fall through to the
  // founder plane. Under that arrangement a nudge with no promiseId opened a
  // `job:<id>` founder session and was handed promise copy for a promise that
  // did not exist — the model would then go looking for the debt it was told it
  // owed. Module 04 widened the branch (G-10); this text stopped being a
  // fallback and became the fault report it always should have been.
  //
  // A `followup` that lands here therefore has NO conversationId, which means
  // it was enqueued malformed. There is no thread to read and no customer to
  // answer, so it asks for nothing.
  followup:
    "A followup job reached a founder-plane session. Every follow-up that has a " +
    "conversation is routed into that conversation's own session " +
    "(`dispatchJobToChannel`, agent/channels/internal.ts); reaching this text " +
    "means this one carries no conversationId and was enqueued malformed. Do " +
    "nothing: touch no customer, no record and no ledger, and report the fault.",

  // Defensive dead paths too — for a STRONGER reason than the two above, which
  // at least reach nova-ai and are merely routed elsewhere within it. These
  // three never arrive here at all: dakio-api executes them itself
  // (`SERVER_SWEEPS`, src/routes/novaJobs.js) and `leaseServerSweeps` claims
  // those rows INSIDE the claim transaction, before the candidates query, so
  // the dispatcher can never be handed one. They are in this record only
  // because it is total over JobKind.
  //
  // This comment used to say the opposite — "they really do run as `job:<id>`
  // founder-plane sessions" — while the dakio-api half of the same PR said
  // "nova-ai has no prompt template for them … This server runs them". Two
  // exhaustive registries (here and `JobKind` in types.ts) are exactly what an
  // engineer extending the job system reads, so a false claim here is how
  // module 04/09 gets designed on a premise the server contradicts.
  //
  // (The twin comment on `JobKind` in agent/lib/types.ts, which used to make
  // the opposite claim, has since been corrected to match. Both registries now
  // say the same true thing.)
  //
  // None joins FILES_REPORT either: the sweeps author Decisions and the
  // distiller writes memory, so a filed report would be a third copy of work
  // that already has a home.
  //
  // Module 04's `journey_sweep` is the fourth, on the strongest version of the
  // argument yet: the stage machine is a deterministic reducer over DB events
  // (D1.1 — "stage is code, never model output"), so handing it to a session
  // would hand the model the one thing the module exists to keep away from it.
  promise_sweep: serverSideLane("promise_sweep"),
  identity_merge_sweep: serverSideLane("identity_merge_sweep"),
  conversation_distill: serverSideLane("conversation_distill"),
  journey_sweep: serverSideLane("journey_sweep"),

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
