/**
 * Job prompt templates (Phase 05) — the six daily-loop schedules' markdown
 * bodies, ported verbatim from the old `agent/schedules/*.ts` files (now
 * retired) into per-kind templates the dispatcher renders at claim time.
 * Behavior is unchanged from the single-tenant static schedules; only the
 * trigger mechanism moved (per-tenant job row instead of a UTC-only cron
 * file). `reflection` gained one new step: Phase 04's `attribution.ts` was
 * built and tested but never invoked outside the eval harness — wiring the
 * `run_attribution` tool in here is Phase 05's fix for that gap.
 *
 * Stage 10 module 05 (D8) adds `cartRecoveryTurnPrompt` at the bottom — NOT a
 * `TEMPLATES` entry, because the in-window cart nudge is a threaded `followup`
 * and `dispatchJobToChannel` builds those instructions itself; `renderJobPrompt`
 * is never reached for a job that carries a conversationId.
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

  // Stage 10 module 05 (D8) added the second sentence, and it is a DIVISION OF
  // LABOUR, not a caveat. This lane is founder-plane: it prepares email/SMS
  // recovery through `send_customer_message`, which opens with
  // `requireFounderSession`. It has no way to reach a Messenger or Instagram
  // thread, and the in-window chat nudge is not its work — dakio-api's
  // `cart_sweep` branch (`runCartRecoveryMatch`, src/routes/novaJobs.js) matches
  // each open cart to its live conversation and books a `followup` row, so the
  // nudge inherits the fire-time re-checks, the proactive marker and the weekly
  // touch cap. A nudge this turn tried to send would inherit none of them.
  //
  // The `conversationId` on each cart is what makes the split visible from here:
  // it is stamped by module 03's identity join and is the same column the server
  // branch resolves on, so "has a thread" means the same thing on both sides. A
  // cart contacted by BOTH lanes is one customer hearing about one basket twice,
  // in two channels, which is the failure this sentence exists to prevent.
  // ── Stage 10 module 06 — delivery coordination ─────────────────────────

  courier_intervention:
    "A parcel has stopped moving and a customer is waiting on it. Do the " +
    "homework the owner would otherwise do standing up: read the case with " +
    "get_case, re-read the order's real delivery state, and write what you " +
    "find onto the case as facts. Then flag it for the owner with " +
    "flag_courier_issue — the tracking id, what the last scan actually said, " +
    "how long it has sat there, what the customer was already told, and the " +
    "one thing you would ask the courier for.\n\n" +
    "BE HONEST ABOUT WHAT DAKIO CAN DO. It can book a parcel, cancel a " +
    "parcel, poll its status and receive the courier's webhooks. It CANNOT " +
    "reschedule, redirect or hold one — no courier here offers that. So this " +
    "job never 'contacts the courier'; it puts a phone call in front of the " +
    "person who can make it. Never write anything that implies otherwise.\n\n" +
    "Do not message the customer from this job. Telling them is the " +
    "case_update lane's work, and it happens once the owner has acted.",

  case_update:
    "Something changed on a case and the customer is owed the news.\n\n" +
    "READ THE CASE FIRST, THIS TURN. Whatever triggered this job may already " +
    "be out of date — a parcel can move again between the trigger and now — " +
    "so compose from what get_case and the order read say RIGHT NOW, never " +
    "from what you were told when this job was booked. Quote the case's own " +
    "facts; they are what the owner and the courier actually reported.\n\n" +
    "One message, in their language, that says what happened and what comes " +
    "next. No apology theatre and no new promise unless a tool gave you " +
    "something real to promise. If the news is bad, say it plainly — a " +
    "customer who is told the truth on day five is a customer; one who is " +
    "managed until day ten is not.\n\n" +
    "If the owner has taken the thread over, or Nova is switched off for it, " +
    "do not talk over them: leave the update prepared and stop. If the case " +
    "is resolved, say so and close the loop rather than leaving it open.",

  restock_check:
    "A customer is waiting for something to come back in stock. Find out " +
    "what is ACTUALLY on order — open purchase orders for that product, and " +
    "the real supply position — and write it onto the case.\n\n" +
    "THE HONESTY FORK IS THE WHOLE JOB. If there is a purchase order with a " +
    "real expected date, you may give that date. If there is nothing on " +
    "order, you may NOT invent 'next week' — say soon, promise to tell them " +
    "the moment it lands, and mean it. A date you made up is a second " +
    "disappointment on top of the first.\n\n" +
    "If several people are waiting for the same product, that count is worth " +
    "the owner knowing — three customers asking is a restock decision, not a " +
    "coincidence.",

  cart_sweep:
    "Abandoned cart sweep. Load the cart-recovery skill and follow it: find " +
    "untouched carts, write personalized recovery messages in the brand " +
    "voice, send them via send_customer_message (autonomy-gated), and finish " +
    "with one consolidated summary of carts contacted, value at stake, and " +
    "expected recoveries. SKIP any cart that already has a conversationId: " +
    "that customer has a live chat thread and the server has already booked " +
    "the in-thread nudge for it, so contacting them here is the same basket " +
    "raised twice. Report those separately as handled in chat.",

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

// ---------------------------------------------------------------------------
// Stage 10 module 05 (D8) — the in-window cart nudge
// ---------------------------------------------------------------------------

/** `payload.triggeredBy` on the `followup` row dakio-api's cart branch books. */
export const CART_RECOVERY_TRIGGER = "cart_recovery";

/** One `{name, qty}` pair off the booked snapshot. Names only — see below. */
interface CartNudgeItem {
  name: string;
  qty: number;
}

/**
 * True for the `followup` rows `runCartRecoveryMatch` (dakio-api
 * src/routes/novaJobs.js) books off an abandoned cart.
 *
 * Keyed on `triggeredBy` and NOT on `plannedIntent`: the intent slug is the
 * canonical `cart_recovery` and the model can book a follow-up carrying it
 * through `POST /followups` too. `triggeredBy` says who MINTED the row, which is
 * the actual question here — a model-booked cart follow-up already knows what it
 * meant by it and needs no snapshot handed back.
 */
export function isCartRecoveryJob(job: NovaJob): boolean {
  return job.kind === "followup" && job.payload?.triggeredBy === CART_RECOVERY_TRIGGER;
}

function cartNudgeItems(payload: Record<string, unknown>): CartNudgeItem[] {
  const raw = payload?.cartItems;
  if (!Array.isArray(raw)) return [];
  const items: CartNudgeItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name !== "string" || name.trim().length === 0) continue;
    const qty = Number((entry as { qty?: unknown }).qty);
    items.push({ name: name.trim(), qty: Number.isFinite(qty) && qty > 0 ? Math.trunc(qty) : 1 });
  }
  return items;
}

/**
 * THE NUDGE COPY CONTRACT (D8.3). One personal message about one basket, in the
 * customer's own thread — never a campaign line with an audience of one.
 *
 * WHY THE ITEM NAMES RIDE THE JOB BUS when every other lane here carries ids
 * only. The ids-only rule exists so the turn re-reads what can have CHANGED
 * (a promise may have been kept, a thread may have been taken) and so no
 * free text passes a second redaction point. Neither applies to a basket: this
 * is a customer-plane turn and the customer-360 the turn loads is masked by
 * construction — it gives Nova a masked phone and no street address — while a
 * cart read tool is not on `CUSTOMER_SLIM_TOOLS`. Ids-only here would mean the
 * one sentence the nudge exists to say ("the Jamdani sharee") could not be said
 * at all, and "you left something in your cart" is the blast D8 forbids.
 *
 * WHAT IS DELIBERATELY NOT CARRIED, and what the instruction therefore refuses
 * to let the model claim: no price, no cart total, and no stock. The payload is
 * a SNAPSHOT of what the basket held when it was abandoned — dakio-api's
 * `cartNudgeItems` strips prices for exactly this reason, because a price read
 * out of an hours-old copy is a number the store may no longer honour and one a
 * customer will hold Nova to. The Bangla example below says "এখনো আছে", which
 * reads as "it is still there"; it is only sayable about the CART. Availability
 * is a stock claim and needs `get_product`.
 *
 * THE ADDRESS FORM IS THE STORE'S, NOT THIS EXAMPLE'S. The sample is written in
 * the আপনি register because the module doc's is; the persona layer
 * (`inbox.persona.addressForm`) decides apni/tumi and the brand voice decides
 * the rest. This function fixes the SHAPE — name the thing, ask once, open a
 * door — not the words.
 *
 * Rendered for the follow-up turn that rejoins `customer:inbox:<conversationId>`.
 * Every timing rule has already bound by the time this text is built: dakio-api
 * booked the row as a `followup` precisely so `recheckBeforeFire` could judge it
 * (window, quiet hours, weekly touch cap, unanswered streak, consent, thread
 * ownership) and so the send is marked proactive and billed to the touch ledger.
 * Nothing in this instruction may re-decide any of that — but the LAST word is
 * still the model's, and it is a refusal: if the thread has moved on, saying
 * nothing is the right answer.
 */
export function cartRecoveryTurnPrompt(job: NovaJob): string {
  const items = cartNudgeItems(job.payload ?? {});
  // A booked row always carries at least one item — dakio-api refuses to book a
  // nameless cart — so this branch means the payload was malformed in transit.
  // It asks for nothing rather than inviting a generic "something in your cart".
  const named =
    items.length === 0
      ? null
      : items.map((it) => (it.qty > 1 ? `${it.name} ×${it.qty}` : it.name)).join(", ");

  if (!named) {
    return (
      `Cart-recovery follow-up ${job.id} arrived with no item names in its payload, which should ` +
      "not happen — the server does not book a nameless cart. Do not improvise a generic cart " +
      "reminder: a nudge that cannot say what the basket held is a blast. Say nothing to the " +
      "customer and report the malformed payload."
    );
  }

  return (
    `This customer left these in their cart and did not check out: ${named}. ` +
    "Their conversation window is still open, so you may write ONE short, personal message about " +
    "it — read the thread first, because the world moved since the basket was left. Name the " +
    "actual item(s) above; that is the entire licence for this message. Ask once whether they " +
    "still want it and open a door for the obvious objection (size, delivery charge, delivery " +
    "time) — do not stack a second ask, do not send a follow-up to your own follow-up, and never " +
    "write anything that would read the same to a hundred people.\n\n" +
    "Shape to match (the store's own address form and brand voice decide the words):\n" +
    "  আপু, জামদানি শাড়িটা কার্টে রেখে গিয়েছিলেন 🙂 এখনো আছে — নিয়ে নিবেন? " +
    "সাইজ বা ডেলিভারি নিয়ে কোনো প্রশ্ন থাকলে বলুন।\n" +
    "  (Apu, Jamdani sharee ta cart e rekhe giyechhilen — ekhono ache. Niye niben? " +
    "Size ba delivery niye kono proshno thakle bolun.)\n\n" +
    "The item list above is a SNAPSHOT of the basket as it was left. It is not a stock check and " +
    "carries no prices: \"still there\" is true of their cart, never of your warehouse. Do not " +
    "quote a price, a total or a discount you have not just looked up, and if they ask whether it " +
    "is in stock, check before you answer. " +
    "If the thread has moved on — they already bought, they said no, the owner stepped in, or " +
    "there is simply nothing worth saying — send nothing. Silence is a real answer here, and a " +
    "nudge nobody asked for is worse than a late one."
  );
}
