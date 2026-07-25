/**
 * Customer channel (Stage 10 modules 01 + 02). Module 01 owns the dakio-api →
 * nova-ai delivery contract — HMAC + timestamp verification, body parse, the
 * 202/401/409 semantics — and module 02 added the session behavior behind the
 * SAME route without changing that contract: the real turn prompt and the
 * log-only completion handler. The pipe never calls the model from here;
 * `send()` only dispatches a turn into the durable session, and what that turn
 * is allowed to do is decided entirely by hooks/instructions/tools elsewhere.
 *
 * Contract (module doc D5/D9, both sides must not drift):
 *
 *   POST /customer/message
 *   Headers: x-nova-signature  = hex(HMAC-SHA256(`${x-nova-timestamp}.${rawBody}`,
 *                                    NOVA_INBOX_SHARED_SECRET))
 *            x-nova-timestamp  = ISO-8601, rejected outside ±5 minutes —
 *                                bound into the MAC (Stripe-style), so the
 *                                freshness window actually bounds replay
 *   Body:    { storeId, conversationId, platform: "messenger"|"instagram",
 *              messageIds: [...] }
 *   → 202 accepted (turn dispatched or queued)  → dakio-api stamps processedAt
 *   → 401 bad signature / stale timestamp       → dakio-api alarms, no retry
 *   → 409 busy / tenant paused                  → events stay unprocessed,
 *                                                 re-coalesce + drain lane
 *
 * The shared secret authenticates *dakio-api itself*; tenancy then comes from
 * the body's `storeId` (dakio-api is the authoritative tenancy system —
 * recon-eve Option A). The channel never accepts founder JWTs. The minted
 * principal (`customerPrincipal`) is non-`"user"`, so the trust plane is
 * structurally denied, and the tenant-guard hook pins `storeId` for the
 * session's lifetime — a POST for store A can never continue store B's
 * session even if it somehow addressed the same conversation id.
 *
 * Session keying (canonical §2.5): continuationToken `inbox:<conversationId>`,
 * which the framework namespaces to `customer:inbox:<conversationId>` — the
 * same session the fallback lane rejoins (see `internal.ts`).
 *
 * 409 semantics vs the eve API: eve's `send()` never reports "busy" — a
 * delivery to a mid-turn session is queued durably and coalesced into the
 * session's next step (framework delivery coalescing), which is exactly the
 * batching module 02 wants, so those return 202. The 409 this stub CAN and
 * does return covers (a) a second POST for the same conversation while a
 * prior dispatch is still in flight (in-process guard below — same
 * single-instance posture as dakio-api's SSE bus) and (b) a paused/unknown
 * tenant (kill switch: refusing pre-dispatch keeps the events unprocessed on
 * dakio-api's side so they accumulate harmlessly, per D9).
 *
 * Stage 10 module 04 adds two things to this file and nothing else:
 *
 *   1. THE TURN-END CALLBACK (D5 pass 2 / D12). eve lets a channel subscribe to
 *      any session stream event, so `turn.completed` here is the runtime's own
 *      report of what a turn did — see the block above {@link reportTurnToReducer}
 *      for exactly what it reports, and, more importantly, what it refuses to.
 *   2. THE FIRED-FOLLOW-UP FRAME (D7). A follow-up job's turn arrives through
 *      `receive` below, and the five fire-time checks that decided it was legal
 *      ran on the SERVER before the job was handed to the dispatcher. The frame
 *      says so, because a model that re-derives them from the transcript will
 *      eventually disagree with the server and send anyway.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { defineChannel, POST } from "eve/channels";
import type { SessionContext } from "eve/context";
import { customerPrincipal, customerSessionFacts } from "../lib/customer/principal";
import { INBOX_INTENTS } from "../lib/nova/inboxIntents";
import { storeFor } from "../lib/store/resolve";
import { resolveStoreId } from "../lib/tenant";
import { isTenantActive } from "../lib/tenants";

/** ±5 minutes — the timestamp freshness window (module doc D5). */
const TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

const PLATFORMS = new Set(["messenger", "instagram"]);

/**
 * Channel-local continuation token for a customer conversation. The framework
 * prepends the channel name (file stem), so the runtime key is
 * `customer:inbox:<conversationId>`.
 */
export function inboxContinuationToken(conversationId: string): string {
  return `inbox:${conversationId}`;
}

/**
 * The turn prompt (module 02 D1.5) — a POINTER, never content.
 *
 * Message text reaches the model in exactly one place: the `get_conversation`
 * tool result, wrapped `untrusted()`. Keeping ids on this lane means the
 * prompt-injection boundary has a single location to audit, and it holds for
 * the fallback job lane too (`internal.ts` builds the same shape). The
 * instruction to read before replying is here rather than only in the
 * register because a cold session — evicted, redeployed, re-keyed — must
 * rebuild from the transcript rather than from whatever it remembers.
 */
export function inboxTurnPrompt(messageIds: readonly string[]): string {
  return `New customer message(s): ${messageIds.join(", ")}. Read them with get_conversation before replying.`;
}

/**
 * The fired-follow-up turn frame (module 04 D7) — the server's re-check,
 * stated as a decision rather than as advice.
 *
 * WHAT THIS TURN IS FOR, said in the frame because the turn arrives on the same
 * durable session as every reactive turn and otherwise looks identical to one:
 * nobody just wrote in. Nova booked this knock itself, days ago, against a
 * thread that has moved since.
 *
 * WHY THE VERDICT IS RENDERED AS FINAL. The five checks are deterministic and
 * they already ran (see {@link FollowupRecheck}). A model re-deriving them from
 * the transcript will sometimes reach a different answer — the transcript does
 * not carry the tenant's quiet hours, the week's touch count, or the exact
 * instant Meta's 24h window closes — and the failure mode of that disagreement
 * is one-directional: it sends. So the frame does not offer the checks as
 * context to weigh. It names them as settled and leaves the model the one
 * judgement that is genuinely its own: whether there is anything worth saying.
 *
 * `ok:false` SHOULD NOT ARRIVE. A failed re-check completes the job
 * `skipped:*` server-side and no turn is dispatched. It is handled anyway, and
 * loudly, because the alternative to handling it is a frame that renders a
 * passing verdict for a job the server refused — and a defensive branch that
 * costs three lines is cheaper than trusting a call site in another repo.
 */
export function followupTurnFrame(fired: FiredFollowup, instruction: string): string {
  const when = fired.recheck.checkedAt ? ` at ${fired.recheck.checkedAt}` : "";
  if (!fired.recheck.ok) {
    const why = fired.recheck.reason ?? "unspecified";
    return [
      `[server re-check FAILED${when} — follow-up job ${fired.jobId}: ${why}]`,
      "The server's fire-time check says this follow-up must NOT send, and that is the end of it.",
      "Do not compose a reply, do not look for a reading of the thread that gets around it, and do",
      "not tell the customer anything. Say nothing on this thread this turn.",
      "",
      instruction,
    ].join("\n");
  }
  return [
    `[server re-check passed${when} — follow-up job ${fired.jobId}]`,
    "This turn is a follow-up YOU booked earlier, not a message from the customer — nobody is",
    "waiting on you. Before it was handed to you the server already decided, deterministically:",
    "the customer has not written back since you booked it, the thread is still yours, the 24h",
    "window is open, it is not quiet hours, and the touch budget has room. Those five are settled",
    "and are not yours to re-open — the thread in front of you does not carry the shop's quiet",
    "hours or this week's touch count, so a different reading of it is a worse answer, not a newer",
    "one. What IS yours to decide is whether anything is worth saying at all.",
    "",
    instruction,
  ].join("\n");
}

/**
 * The server's fire-time verdict on a `followup` job (module 04 D7), forwarded
 * verbatim from dakio-api's `recheckBeforeFire`.
 *
 * FIVE CHECKS, ALL SERVER-SIDE, ALL ALREADY DECIDED by the time a turn exists:
 * the customer wrote back since scheduling · the thread is no longer Nova's ·
 * the Meta 24h window closed · it is quiet hours now · the touch budget or the
 * unanswered streak is spent. OD-5 puts them in dakio-api's claim transaction
 * rather than here for the reason module 03 learned the hard way: nova-ai has
 * no fire-time hook it can be trusted to have run, and "the runtime will check
 * first" is not a check.
 *
 * So this type is NOT a re-check nova-ai performs. It is the server's answer,
 * carried onto the turn so the frame can name it — which is the whole point:
 * the model reads a thread that may LOOK like a good moment and must not be
 * able to promote its reading over a verdict that already ran.
 */
export interface FollowupRecheck {
  /** `false` should never reach a turn — see {@link followupTurnFrame}. */
  ok: boolean;
  /** The server's own skip code (`skipped:customer_replied`, `skipped_window`, …). */
  reason?: string;
  /** When the server ran it, so a stale verdict is visible rather than assumed fresh. */
  checkedAt?: string;
  // `recheckBeforeFire` also returns `requeueAt` for the quiet-hours re-lease.
  // That one deliberately does NOT cross: re-leasing is a server decision about
  // a job, and there is no turn to tell about it — the turn simply never starts.
}

/** The `followup` NovaJob this delivery is firing, plus its server verdict. */
export interface FiredFollowup {
  jobId: string;
  recheck: FollowupRecheck;
}

/**
 * Cross-channel receive target (used by the `inbox_reply` fallback lane, and by
 * module 03/04's threaded `followup` lane).
 *
 * ⚠️ `followup` HAS NO PRODUCER YET, and naming that here is the alternative to
 * a frame that silently never renders. Two edits in files this stream does not
 * own complete it, and neither is more than a line:
 *
 *   - `dakio-api/src/routes/novaJobs.js` — call `recheckBeforeFire` in the claim
 *     transaction (its own header records that it has no call site) and stamp
 *     the verdict onto the claimed job.
 *   - `agent/channels/internal.ts` — pass `followup: { jobId, recheck }` on the
 *     target it already builds for the threaded-follow-up branch.
 *
 * Until both land, a fired follow-up is delivered exactly as it is today and
 * the turn is framed by `internal.ts`'s instruction alone. That is the CURRENT
 * behavior preserved byte-for-byte, not a degraded one — the field is optional
 * so an absent verdict changes nothing.
 */
export interface CustomerReceiveTarget {
  storeId: string;
  conversationId: string;
  platform: string;
  followup?: FiredFollowup;
}

/**
 * Constant-time signature check. `Buffer.from(hex, "hex")` silently truncates
 * at the first invalid pair, so the length comparison also rejects malformed
 * hex; `timingSafeEqual` requires equal lengths, hence the guard.
 */
function signatureMatches(
  timestamp: string | null,
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature || !timestamp) return false;
  // The MAC covers `${timestamp}.${rawBody}` (Stripe-webhook construction), not
  // the body alone: an unsigned timestamp header lets a captured (body,
  // signature) pair be replayed forever with a fresh header, so the freshness
  // window would bound nothing. dakio-api's inboxDelivery.js signs identically.
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest();
  const provided = Buffer.from(signature, "hex");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

function timestampFresh(timestamp: string | null, nowMs = Date.now()): boolean {
  if (!timestamp) return false;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return false;
  return Math.abs(nowMs - parsed) <= TIMESTAMP_SKEW_MS;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * In-flight dispatch guard: one dispatch per conversation at a time. Purely
 * in-process (single-instance posture, documented above) — durability never
 * depends on it; the unprocessed NovaInbox rows on dakio-api's side are the
 * burst buffer, and a 409 here just tells dakio-api to re-coalesce.
 */
const inFlightDispatch = new Set<string>();

/**
 * Safety gate — OFF unless `NOVA_CUSTOMER_TURNS_ENABLED === "true"`.
 *
 * Module 01 introduced it because there was no `dakio-inbox`-keyed
 * instruction layer: a dispatched turn would have run Nova's FOUNDER
 * instructions against customer-controlled input. Module 02 ships that layer
 * (`instructions/50-customer-inbox.ts`, with layers 10–40 gated off for
 * customer sessions), so enabling this is now a deliberate product decision
 * rather than a hole — but the DEFAULT stays off. The founder flips it per
 * deployment once the door mode, guardrails and the shadow week say so; tests
 * opt in explicitly.
 *
 * With the flag off, deliveries still authenticate and are acknowledged (202,
 * so dakio-api stamps `processedAt` and the contract holds end to end) — no
 * model turn starts.
 */
const CUSTOMER_TURNS_ENABLED = () => process.env.NOVA_CUSTOMER_TURNS_ENABLED === "true";
let turnsDisabledLogged = false;

// ───────────────────────────────────────────────────────────────────────────
// The turn-end `intent-observed` callback (module 04 D5 pass 2 / D12)
// ───────────────────────────────────────────────────────────────────────────
//
// THE SEAM EXISTS AND IT IS THIS ONE. eve types a channel's `events` map over
// the whole session stream vocabulary (`ChannelEvents` in
// `eve/dist/src/public/definitions/channel.d.ts`), so `turn.completed`,
// `actions.requested` and `action.result` are all subscribable from here, each
// handler receiving the eve `SessionContext` — which carries the verified
// principal, hence the store and the conversation. OD-7 asked for a spike; this
// is it, and it works. Nothing had to be added to the framework.
//
// WHAT THE CALLBACK REPORTS. Only what the MODEL ITSELF DECLARED, read off its
// own tool-call arguments and promoted only once the call's result lands:
//
//   intent      `reply_in_thread`'s `intent` — the closed slug the model chose,
//               re-validated here against INBOX_INTENTS because `actions.requested`
//               fires with the RAW model arguments, before the tool's zod parse.
//               A turn that only books a follow-up reports `schedule_follow_up`'s
//               `plannedIntent` instead: that tool's own header calls it the same
//               classification `reply_in_thread` makes, and a reply's `intent`
//               always wins when a turn declared both.
//   nbaAction   the D6 candidate implied by the VERB the model called, and only
//               where that correspondence is 1:1 — `escalate_conversation` →
//               `escalate`, `schedule_follow_up` → `schedule_follow_up`, a reply
//               with no `purpose` → `answer`. Naming those three is not
//               re-declaring the candidate vocabulary, which `types.ts` forbids
//               for a good reason (it is closed and versioned SERVER-side, and a
//               fourth hand-copy would drift with no CI check to catch it).
//   nbaReason   the model's own words, never a synthesized one: `reason` from
//               `schedule_follow_up` or `flag_handover`. A reply declares no
//               reason, so a reply reports none.
//   messageId   the model's `inReplyToMessageId`, falling back to the `replyTo`
//               the server computed and `get_conversation` handed back.
//   journeyId   ONLY from the NBA block the server sent (`get_conversation`'s
//               result). NEVER from a model-supplied field, for the same reason
//               `scopedConversationId` exists: an id the model can type is an id
//               it can type wrong, and this one addresses the row a transition
//               gets written to.
//
// ⚠️ WHAT IT DOES NOT REPORT, DELIBERATELY: `do_nothing`. See
// {@link DO_NOTHING_REPORTING} — that constant is the honest status, and this
// paragraph is not the place it hides.

/**
 * D12's `journey.silences_chosen` is NOT IMPLEMENTED. This is the record of
 * why, and the reader looking for the counter lands here.
 *
 * The turn-end seam works (above). What does not exist is a way for the model
 * to DECLARE that it chose silence. Every other candidate is declared by a verb
 * call; `do_nothing` is, by construction, the one that calls nothing. So the
 * only thing this channel could observe is a turn that completed having called
 * no action-plane tool — and reporting that as `nbaAction: "do_nothing"` would
 * be an INFERENCE of a model's choice, counted and shown to a founder as "Nova
 * chose restraint". It would also be wrong in ways nobody could see afterwards:
 * a turn that read the thread and found nothing it could answer, a turn whose
 * tool call failed validation, and a turn that genuinely decided to leave the
 * customer alone are all the same observation from out here.
 *
 * A fabricated metric is worse than a missing one, so the metric is missing and
 * says so. The honest count that IS produced is the `no_declared_intent` arm of
 * {@link TurnReport} plus the log line beside it — "a turn ended without
 * declaring anything", which is what actually happened.
 *
 * WHAT WOULD FIX IT, for whoever picks this up: a declaration seam on the
 * customer plane. The cheapest is a required `nbaAction` field on the reply and
 * follow-up payloads plus a no-op `record_choice` verb for the silent case
 * (`agent/lib/nova/schemas.ts` + `agent/tools/` + `CUSTOMER_SLIM_TOOLS` in
 * `agent/lib/customer/session.ts`, and a rule in
 * `agent/instructions/50-customer-inbox.ts` telling the model to call it) —
 * none of which is this stream's file, and none of which is a change that
 * should be made just to light up a counter.
 */
export const DO_NOTHING_REPORTING = {
  implemented: false,
  metric: "journey.silences_chosen",
  missing: "a customer-plane way for the model to DECLARE do_nothing; silence calls no verb",
  owner: "agent/lib/nova/schemas.ts + agent/tools + agent/instructions/50-customer-inbox.ts",
} as const;

/** What {@link reportTurnToReducer} did, so a caller and a suite can both see it. */
export type TurnReport =
  | { posted: true; journeyId: string; intent: string; nbaAction: string | null }
  | {
      posted: false;
      reason:
        /**
         * No record for this turn: it was never a customer session, it was
         * discarded by {@link discardTurnObservation} because it failed or was
         * cancelled, or the in-process cap evicted it. All three mean the same
         * thing to a caller — there is nothing to report — and none of them is
         * a reason to invent one.
         */
        | "no_observation"
        | "no_journey"
        | "no_message_anchor"
        /** The honest arm for a silent turn — NOT a `do_nothing`. */
        | "no_declared_intent"
        | "post_failed";
    };

/** One tool call the model requested, held until its result says it landed. */
interface PendingCall {
  toolName: string;
  input: Record<string, unknown>;
}

/**
 * Everything one turn declared, accumulated across its steps.
 *
 * The three verb slots are recorded as they land and RESOLVED at report time by
 * {@link chosenCandidate}, never folded into a single field as they arrive. A
 * turn commonly replies and books a knock in the same breath, and steps do not
 * arrive in a guaranteed order — collapsing early would make which candidate
 * gets reported depend on which result the runtime flushed first, which is the
 * kind of bug that only shows up as a metric that drifts.
 */
interface TurnObservation {
  storeId: string;
  conversationId: string;
  journeyId: string | null;
  messageId: string | null;
  intent: string | null;
  plannedIntent: string | null;
  reply: { purpose: string | null } | null;
  scheduled: { reason: string | null } | null;
  escalated: { reason: string | null } | null;
  pending: Map<string, PendingCall>;
}

/**
 * Which D6 candidate the turn chose, by fixed precedence.
 *
 * `escalate` first because it is terminal — the register's own line is
 * "flag_handover and silence", so a turn that hands the thread over chose that
 * whatever else it did. A reply next, because the reply is what the customer
 * actually received. `schedule_follow_up` last: booking a return visit is what
 * a turn does IN ADDITION, and it names the turn's choice only when it is the
 * only thing the turn did.
 */
function chosenCandidate(obs: TurnObservation): { action: string | null; reason: string | null } {
  if (obs.escalated) return { action: "escalate", reason: obs.escalated.reason };
  // A reply with no `purpose` is `answer` in D6's candidate→verb map. A reply
  // WITH one is some other reply-shaped candidate — but `purpose` is a free
  // string whose vocabulary is module 02's slugs (`cart_recovery`, `holding`,
  // `escalation_draft`), not D6's candidate names, so which one is a guess. It
  // reports NO candidate rather than the nearest-looking one; the intent is
  // still reported, so the turn is not lost. Closing that gap means making
  // `purpose` a closed enum aligned with the candidate list, in
  // `agent/lib/nova/schemas.ts` — not this file.
  if (obs.reply) return { action: obs.reply.purpose === null ? "answer" : null, reason: null };
  if (obs.scheduled) return { action: "schedule_follow_up", reason: obs.scheduled.reason };
  return { action: null, reason: null };
}

/**
 * In-flight turn observations, keyed by eve's `turnId`.
 *
 * Purely in-process, exactly like `inFlightDispatch` above and on the same
 * single-instance posture. Durability never depends on it: a process that dies
 * mid-turn loses the observation and the reducer simply never hears about that
 * turn, which is a MISSED report — never a wrong one. The cap makes the failure
 * mode of a `turn.completed` that never arrives a bounded one; without it a
 * long-lived process would accumulate one entry per abandoned turn forever.
 */
const turnObservations = new Map<string, TurnObservation>();
const MAX_TRACKED_TURNS = 500;

/** Non-empty-string read that tolerates the `unknown` shape raw model input has. */
function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The closed intent set as a lookup — raw model input is not zod-parsed yet. */
const KNOWN_INTENTS = new Set<string>(INBOX_INTENTS);

/**
 * Open the record for a turn. Called from `turn.started` so that a turn which
 * declares NOTHING is still seen — that is the whole population
 * {@link DO_NOTHING_REPORTING} is honest about, and it is unobservable if the
 * record is only created when a tool is called.
 */
export function openTurnObservation(data: { turnId: string }, ctx: SessionContext): void {
  const facts = customerSessionFacts(ctx);
  // `resolveStoreId` and not a hand-read of `attributes.storeId`: it is the one
  // tenancy guard, it tolerates the `string | string[]` attribute shape, and a
  // second reader of that field is how the two eventually disagree.
  const storeId = resolveStoreId(ctx);
  if (!facts || !storeId) return; // not a customer turn — nothing to report to
  if (turnObservations.size >= MAX_TRACKED_TURNS) {
    const oldest = turnObservations.keys().next();
    if (!oldest.done) turnObservations.delete(oldest.value);
  }
  turnObservations.set(data.turnId, {
    storeId,
    conversationId: facts.conversationId,
    journeyId: null,
    messageId: null,
    intent: null,
    plannedIntent: null,
    reply: null,
    scheduled: null,
    escalated: null,
    pending: new Map(),
  });
}

/**
 * Hold each requested tool call by `callId`. Requested is NOT chosen-and-done:
 * `actions.requested` can fire before execution, with arguments the tool's zod
 * schema has not seen yet, and a call that fails validation is a turn that did
 * not reply. Nothing is promoted here — {@link noteActionResult} does that once
 * the matching result lands.
 */
export function noteActionsRequested(
  data: {
    // Structurally the tool-call arm of eve's `RuntimeActionRequest` union, with
    // the arm-specific keys optional so the load-skill and subagent arms assign
    // too. Written out rather than imported because the union is internal to
    // the framework's dist types; written out rather than cast because a cast
    // here would go stale silently if the shape ever moved.
    actions: readonly { kind: string; callId?: string; toolName?: string; input?: Record<string, unknown> }[];
    turnId: string;
  },
  _ctx: SessionContext,
): void {
  const obs = turnObservations.get(data.turnId);
  if (!obs) return;
  for (const action of data.actions) {
    if (action.kind !== "tool-call") continue;
    if (!action.callId || !action.toolName) continue;
    obs.pending.set(action.callId, { toolName: action.toolName, input: action.input ?? {} });
  }
}

/**
 * Promote a held call to a declaration, now that its result has landed.
 *
 * A BLOCKED action still counts. `performAction` returns `{status:"blocked"}`
 * through a completed tool call when `evaluateAuthority` refuses, and the
 * classification the model made is real whether or not the send passed the
 * gate — D6 calls a refused choice a prompt-quality signal, and it is only a
 * signal if it is reported. What does NOT count is a call the runtime failed or
 * rejected: no arguments were accepted, so nothing was declared.
 */
export function noteActionResult(
  data: {
    result: { kind: string; callId?: string; toolName?: string; output?: unknown; isError?: boolean };
    status: string;
    turnId: string;
  },
  _ctx: SessionContext,
): void {
  const obs = turnObservations.get(data.turnId);
  if (!obs) return;
  const result = data.result;
  if (result.kind !== "tool-result" || !result.callId) return;
  const call = obs.pending.get(result.callId);
  obs.pending.delete(result.callId);
  if (data.status !== "completed" || result.isError === true) return;

  // The server's own answers, read off the tool result rather than off anything
  // the model typed: the journey this thread belongs to, and the inbound the
  // server considers newest.
  if (result.toolName === "get_conversation") {
    const output = (result.output ?? {}) as Record<string, unknown>;
    const nba = output.nba as { journey?: { id?: unknown } } | null | undefined;
    obs.journeyId = str(nba?.journey?.id) ?? obs.journeyId;
    obs.messageId = obs.messageId ?? str(output.replyTo);
    return;
  }
  if (!call) return;

  if (call.toolName === "reply_in_thread") {
    const intent = str(call.input.intent);
    if (intent && KNOWN_INTENTS.has(intent)) obs.intent = intent;
    // The model's own staleness anchor wins over the server's `replyTo`: it is
    // the message this turn says it answered, which is what D12 keys on.
    obs.messageId = str(call.input.inReplyToMessageId) ?? obs.messageId;
    obs.reply = { purpose: str(call.input.purpose) };
    return;
  }
  if (call.toolName === "schedule_follow_up") {
    const planned = str(call.input.plannedIntent);
    if (planned && KNOWN_INTENTS.has(planned)) obs.plannedIntent = planned;
    obs.scheduled = { reason: str(call.input.reason) };
    return;
  }
  if (call.toolName === "flag_handover") {
    obs.escalated = { reason: str(call.input.reason) };
  }
}

/**
 * Report the turn to the reducer's second pass, then forget it.
 *
 * The POST is fire-and-observe: a failure is logged and swallowed. eve already
 * swallows a throwing channel handler, but relying on that would make a dead
 * reducer indistinguishable from a healthy one in the log, and this callback is
 * the only thing that turns a model judgement into a stage transition — a
 * silent failure here is a journey that stops moving with nothing to grep for.
 */
export async function reportTurnToReducer(data: { turnId: string }): Promise<TurnReport> {
  const obs = turnObservations.get(data.turnId);
  turnObservations.delete(data.turnId);
  if (!obs) return { posted: false, reason: "no_observation" };

  const intent = obs.intent ?? obs.plannedIntent;
  if (!intent) {
    // The honest arm. This is a turn that ended having declared nothing — most
    // often chosen silence, sometimes a turn that could not act. Which one it
    // was is exactly what this side cannot know (see DO_NOTHING_REPORTING), so
    // it is counted as what it is and nothing is posted.
    console.info(
      `[customer] turn ended with no declared intent — nothing posted to the reducer (journey.silences_chosen is NOT IMPLEMENTED, see DO_NOTHING_REPORTING) conversation=${obs.conversationId} turn=${data.turnId}`,
    );
    return { posted: false, reason: "no_declared_intent" };
  }
  if (!obs.journeyId) return { posted: false, reason: "no_journey" };
  if (!obs.messageId) return { posted: false, reason: "no_message_anchor" };

  const chosen = chosenCandidate(obs);
  try {
    await storeFor(obs.storeId).postIntentObserved(obs.journeyId, {
      intent,
      messageId: obs.messageId,
      ...(chosen.action ? { nbaAction: chosen.action } : {}),
      ...(chosen.reason ? { nbaReason: chosen.reason } : {}),
    });
    return { posted: true, journeyId: obs.journeyId, intent, nbaAction: chosen.action };
  } catch (err) {
    console.warn(
      `[customer] intent-observed POST failed (the journey will not advance on this turn) conversation=${obs.conversationId} journey=${obs.journeyId}: ${String(err)}`,
    );
    return { posted: false, reason: "post_failed" };
  }
}

/**
 * Drop a turn that failed or was cancelled, WITHOUT reporting it.
 *
 * A turn that did not finish did not classify anything. Posting its
 * half-accumulated declarations would write a transition off a turn the
 * customer never saw the end of — and would also be the exact shape of the
 * fabrication {@link DO_NOTHING_REPORTING} refuses.
 */
export function discardTurnObservation(data: { turnId: string }): void {
  turnObservations.delete(data.turnId);
}

/** Test seam: the suites run turns back to back in one process. */
export function resetTurnObservations(): void {
  turnObservations.clear();
}

const channel = defineChannel<undefined, void, CustomerReceiveTarget>({
  routes: [
    POST("/customer/message", async (req, { send }) => {
      // 1. Authenticate the caller (dakio-api itself) — fail closed. A
      //    missing secret can never become an open door.
      const secret = process.env.NOVA_INBOX_SHARED_SECRET ?? "";
      const rawBody = await req.text();
      const timestamp = req.headers.get("x-nova-timestamp");
      if (
        secret.length === 0 ||
        !signatureMatches(timestamp, rawBody, req.headers.get("x-nova-signature"), secret) ||
        !timestampFresh(timestamp)
      ) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }

      // 2. Parse + validate the body. Both sides are ours, so a
      //    valid-signature malformed body is a deploy-drift bug — 400 makes
      //    it loud instead of silently dropping messages.
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        return Response.json({ error: "invalid JSON body" }, { status: 400 });
      }
      const { storeId, conversationId, platform } = body;
      const messageIds = Array.isArray(body.messageIds)
        ? body.messageIds.filter(isNonEmptyString)
        : [];
      if (
        !isNonEmptyString(storeId) ||
        !isNonEmptyString(conversationId) ||
        !isNonEmptyString(platform) ||
        !PLATFORMS.has(platform) ||
        messageIds.length === 0
      ) {
        return Response.json(
          { error: "body must be {storeId, conversationId, platform: messenger|instagram, messageIds: [..]}" },
          { status: 400 },
        );
      }

      // 3. Kill switch, pre-dispatch: a paused or unprovisioned tenant's
      //    events must stay unprocessed on dakio-api's side (a 202 would
      //    stamp processedAt and lose them). The tenant-guard hook re-checks
      //    at turn.started; this is the copy that protects the event rows.
      if (!isTenantActive(storeId)) {
        return Response.json({ status: "refused", reason: "tenant_inactive" }, { status: 409 });
      }

      // 4. Busy continuation → 409, events re-coalesce on dakio-api's side.
      if (inFlightDispatch.has(conversationId)) {
        return Response.json({ status: "busy" }, { status: 409 });
      }

      // 5. Interim gate (see CUSTOMER_TURNS_ENABLED): acknowledge without
      //    starting a turn until module 02's customer persona exists.
      if (!CUSTOMER_TURNS_ENABLED()) {
        if (!turnsDisabledLogged) {
          turnsDisabledLogged = true;
          console.warn(
            "[customer] NOVA_CUSTOMER_TURNS_ENABLED is not 'true' — deliveries are acknowledged but no customer turn runs.",
          );
        }
        return Response.json({ status: "accepted", sessionId: null }, { status: 202 });
      }

      // 6. Dispatch the turn into the durable per-conversation session.
      //    Minimal instruction only — the ids are pointers; message CONTENT
      //    never rides this lane (Nova reads it via get_conversation, keeping
      //    the untrusted() boundary in one place).
      inFlightDispatch.add(conversationId);
      try {
        const session = await send(inboxTurnPrompt(messageIds), {
          auth: customerPrincipal(storeId, conversationId, platform),
          continuationToken: inboxContinuationToken(conversationId),
        });
        return Response.json({ status: "accepted", sessionId: session.id }, { status: 202 });
      } finally {
        inFlightDispatch.delete(conversationId);
      }
    }),
  ],

  /**
   * Every handler here is OBSERVE-ONLY. Nothing in this map may deliver, and
   * nothing in it may decide — see the `message.completed` comment for the
   * reason that rule exists, and the module-04 block above for what the rest of
   * them are allowed to report.
   */
  events: {
    /**
     * THE CHANNEL NEVER DELIVERS MODEL TEXT (module 02 D2).
     *
     * In a normal eve channel this handler pushes the assistant's completed
     * text to the surface. Doing that here would bypass `evaluateAuthority`
     * entirely: an assisted tenant's *draft* would reach the customer, and
     * every bubble would lose its `novaActionId` receipt. So the assistant's
     * final text is internal narration and this handler is LOG-ONLY,
     * deliberately. The only customer-visible output in the whole system is the
     * executor side effect of a `send_inbox_reply` action that passed the
     * authority seam — which is what makes shadow mode free, gives every bubble
     * a receipt, and turns a refused reply into a visible blocked row instead
     * of silence.
     *
     * Anyone tempted to "just send it from here": that is the bug this comment
     * exists to prevent.
     */
    "message.completed": (data, channel) => {
      const length = typeof data.message === "string" ? data.message.length : 0;
      console.info(
        `[customer] message.completed (log-only, nothing delivered) session=${channel.continuationToken} turn=${data.turnId} chars=${length}`,
      );
    },

    // Module 04's turn-end callback, across the events it takes: open the
    // record, hold each requested call, promote it when its result lands,
    // report at the end — and drop the whole thing if the turn never finished.
    //
    // The handlers are named exports rather than inline closures for one
    // reason: the `Channel` value `defineChannel` returns exposes `routes` and
    // `receive` and NOT `events`, so an inline handler is unreachable from a
    // suite — and an observation path with no test is one that silently stops
    // observing. `evals/inbox/nba.ts` drives these directly.
    "turn.started": (data, _channel, ctx) => openTurnObservation(data, ctx),
    "actions.requested": (data, _channel, ctx) => noteActionsRequested(data, ctx),
    "action.result": (data, _channel, ctx) => noteActionResult(data, ctx),
    "turn.completed": async (data) => {
      await reportTurnToReducer(data);
    },
    // A turn that did not finish reported nothing and is dropped, not posted.
    "turn.failed": (data) => discardTurnObservation(data),
    "turn.cancelled": (data) => discardTurnObservation(data),
  },

  /**
   * Cross-channel hand-off entry (custom.mdx "Cross-channel hand-off"): the
   * dispatcher's `inbox_reply` fallback lane rejoins the SAME
   * `customer:inbox:<conversationId>` session here — `send` is scoped to THIS
   * channel, so the token lands in the same namespace as the live lane's.
   * Callers supply `{message, target, auth}`; auth must be the
   * `customerPrincipal` for the job's tenant (see `internal.ts`).
   */
  async receive(input, { send }) {
    const conversationId = input.target.conversationId;
    if (!isNonEmptyString(conversationId)) {
      throw new Error("customer.receive: target.conversationId is required");
    }
    // A fired follow-up (module 04 D7) carries the server's verdict; every other
    // delivery on this lane is REACTIVE — someone wrote in — and must not be
    // framed as a knock Nova chose to make. That distinction is also why quiet
    // hours never reach a reactive turn: D8 allows a 1 a.m. answer to a 1 a.m.
    // question, and a frame that said otherwise would teach the model to
    // hesitate on exactly the messages it should answer fastest.
    const message = input.target.followup
      ? followupTurnFrame(input.target.followup, input.message)
      : input.message;
    return send(message, {
      auth: input.auth,
      continuationToken: inboxContinuationToken(conversationId),
    });
  },
});

export default channel;
