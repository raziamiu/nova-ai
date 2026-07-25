/**
 * Internal receive-only channel (Phase 05) — the dispatcher schedule's only
 * way to start a real, tool-using eve session for a job. `routes: []`: no
 * inbound HTTP surface at all, so nothing external can ever address this
 * channel directly; the only entry point is `receive(internal, {...})`
 * called from `agent/schedules/dispatcher.ts`.
 *
 * `receive`'s returned promise resolves once the session's turn settles (or
 * throws) — confirmed by eve's own dynamic-scheduling pattern, which awaits
 * `receive(...)` directly before calling `scheduleStore.complete(job)`. A job
 * session never approves/parks (the trust plane denies non-`"user"`
 * principals — see `agent/lib/jobs/principal.ts`), so there is no long-lived
 * park to worry about here.
 *
 * Stage 10 module 01 adds `dispatchJobToChannel` — the per-kind channel
 * routing the dispatcher calls instead of addressing this channel directly.
 * `inbox_reply` jobs (the fallback lane for when the live delivery POST to
 * `customer.ts` failed) must NOT become throwaway `job:<id>` sessions: they
 * rejoin the SAME durable `customer:inbox:<conversationId>` session the live
 * lane uses, via the customer channel's `receive` hook (cross-channel
 * hand-off, custom.mdx). The branch lives here — not in the dispatcher —
 * because this file owns the job→session mapping; the dispatcher only
 * supplies the `receive` capability (eve exposes cross-channel receive to
 * schedules and route handlers, never to a channel's own `receive` hook).
 *
 * Stage 10 module 03 adds the second such branch, on the same grounds: a
 * `followup` job carrying a `promiseId` is paying back a debt made in one
 * conversation, so it rejoins that conversation instead of becoming a
 * founder-plane session that would answer the customer to the wrong person.
 *
 * Stage 10 module 04 WIDENS that second branch (G-10). Module 03 discriminated
 * on `promiseId != null` and its comment asserted that NBA nudges *should* fall
 * through to the founder plane — that was module 03's assumption about work it
 * did not own, not a constraint, and nothing enforced it. Module 04 owns
 * `followup` semantics and overrides it: the test is now the CONVERSATION, not
 * the debt. Any follow-up with a thread belongs to that thread's session; the
 * promise-specific instruction stays behind `promiseId != null`, because only
 * that one has a debt to close.
 */

import { defineChannel, type Session } from "eve/channels";
import type { ScheduleHandlerArgs } from "eve/schedules";
import customer, { inboxTurnPrompt } from "./customer";
import { customerPrincipal } from "../lib/customer/principal";
import { tenantAppPrincipal } from "../lib/jobs/principal";
import { renderJobPrompt } from "../lib/jobs/prompts";
import { storeFor } from "../lib/store/resolve";
import type { NovaJob } from "../lib/types";

/**
 * The cap `GET /promises` applies server-side. Read back so a full page can be
 * recognised as possibly-truncated rather than mistaken for the whole ledger —
 * see `promiseStillOpen`.
 */
const PROMISE_SCAN_LIMIT = 50;

/**
 * Is this debt still owed?
 *
 * `deletePromisesForOutbound` (dakio-api `src/lib/novaPromises.js`) deletes a
 * promise when its send is cancelled, and skips the follow-up job only while
 * that job is still `due` — a job already `leased` when the cancel lands is
 * not the server's to touch. So a fulfilment turn can arrive for a commitment
 * the customer never received, on a live thread, and open with an apology for
 * a promise that was never made. That file names this half as module 04's to
 * hold, and this is it.
 *
 * Two ways it deliberately answers TRUE rather than "gone":
 *
 *  - the read failed. This is belt-and-braces on top of a server-side skip, and
 *    the reply ladder (window, lock, thread switch, loop cap) still stands
 *    between this turn and the customer. Turning a transient read error into a
 *    silently dropped debt would trade a rare barge-in for a routine broken
 *    promise, which is the worse of the two.
 *  - the page came back FULL, so the ledger may be longer than one page. A busy
 *    shop can hold more than `PROMISE_SCAN_LIMIT` open promises, and "not in the
 *    first 50" is not "gone". Absence only counts when the whole list was seen.
 */
async function promiseStillOpen(storeId: string, promiseId: string): Promise<boolean> {
  try {
    const open = await storeFor(storeId).listPromises({ status: "open", limit: PROMISE_SCAN_LIMIT });
    if (open.some((p) => p.id === promiseId)) return true;
    return open.length >= PROMISE_SCAN_LIMIT;
  } catch {
    return true;
  }
}

const channel = defineChannel<undefined, void, { storeId: string; jobId: string }>({
  routes: [],
  async receive(input, { send }) {
    const jobId = String(input.target.jobId ?? "unknown");
    return send(input.message, {
      auth: input.auth,
      continuationToken: `job:${jobId}`,
    });
  },
});

export default channel;

/**
 * Route one claimed job to its session. Every kind except `inbox_reply` and a
 * threaded `followup` keeps the Phase 05 behavior byte-for-byte: a fresh
 * `job:<id>` session on this channel under the scheduler principal. That
 * includes module 03's three sweeps and module 04's `journey_sweep`, all four
 * of which dakio-api claims server-side before the dispatcher ever sees them.
 *
 * Returns `null` when the job needed no session at all — today that is exactly
 * one case, a promise-backed follow-up whose debt has since been deleted. The
 * dispatcher ignores the resolved value and completes the job either way, which
 * is the correct outcome: there is nothing left to do and nothing went wrong.
 *
 * `inbox_reply` (priority 1, drained from unprocessed `message.received`
 * events when nova-ai was unreachable) instead rejoins the customer
 * conversation session under the same `customerPrincipal` the live lane
 * mints — same tenant pinning, same non-`"user"` trust-plane denial, and
 * module 02's customer instruction layer keys on its authenticator. The
 * payload's `conversationId` comes from dakio-api's drain (D5); a job
 * without one is malformed. The function is `async` so that throw becomes a
 * REJECTION: the dispatcher maps jobs inside a callback whose `.then(ok, fail)`
 * chain is built after the call, so a synchronous throw would escape it — the
 * releaseJob path would never run and sibling jobs in the same claimed batch
 * would keep dangling leases until the watchdog. As a rejection it lands in
 * the existing releaseJob handler and the failure is a visible `lastError`.
 */
export async function dispatchJobToChannel(
  receive: ScheduleHandlerArgs["receive"],
  storeId: string,
  job: NovaJob,
): Promise<Session | null> {
  if (job.kind === "inbox_reply") {
    const conversationId = job.payload.conversationId;
    if (typeof conversationId !== "string" || conversationId.length === 0) {
      throw new Error(`inbox_reply job ${job.id} has no payload.conversationId`);
    }
    const platform = typeof job.payload.platform === "string" ? job.payload.platform : "messenger";
    const messageIds = Array.isArray(job.payload.messageIds)
      ? job.payload.messageIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    // Mirror the live lane's minimal instruction — literally, via the same
    // builder (ids only; content never rides the job bus either). The two
    // lanes feed ONE durable session, so a divergent prompt would make a
    // conversation behave differently depending on which lane delivered it.
    // The handler re-reads unprocessed events, so an already-processed batch
    // makes this turn a cheap no-op (D7).
    const message =
      messageIds.length > 0
        ? inboxTurnPrompt(messageIds)
        : `New customer message(s) on conversation ${conversationId} (fallback delivery). Read the thread with get_conversation before replying.`;
    return receive(customer, {
      message,
      target: { storeId, conversationId, platform },
      auth: customerPrincipal(storeId, conversationId, platform),
    });
  }

  // Stage 10 module 03 D8 / module 04 D7: a follow-up WITH A THREAD rejoins the
  // conversation it belongs to. Without this branch it becomes a `job:<id>`
  // session on the founder plane, under the founder register, with no thread
  // memory — and the turn meant for the customer would open by addressing the
  // founder.
  //
  // THE DISCRIMINATOR IS THE CONVERSATION, NOT THE DEBT — module 04 changed
  // this, and the change is the point. Module 03 keyed on `promiseId != null`
  // and its comment here asserted that NBA nudges "must keep falling through to
  // the generic branch below" because they were founder-plane work. They are
  // not: an NBA nudge is Nova going back to a specific customer in a specific
  // thread, which is the same shape of work as a promise repayment and the
  // opposite of a founder-plane job. Falling through also handed such a job
  // `TEMPLATES.followup`, which at the time read "A promise you made to a
  // customer is coming due…" — promise copy for a promise that does not exist,
  // sending the model looking for a debt nobody owes. Both halves are fixed
  // together: the branch widened here, the template turned into a tripwire.
  //
  // `!= null` and not `!== undefined`: a producer that spells "no promise" as
  // an explicit `promiseId: null` is describing an NBA nudge, not a malformed
  // promise job, and must not be thrown at for punctuation.
  const promiseId = job.payload.promiseId;
  if (job.kind === "followup") {
    const conversationId = job.payload.conversationId;
    const threaded = typeof conversationId === "string" && conversationId.length > 0;
    if (promiseId != null && (typeof promiseId !== "string" || promiseId.length === 0)) {
      throw new Error(`followup job ${job.id} has a non-string or empty payload.promiseId`);
    }
    // A promise-backed follow-up with no thread to return to is malformed, not
    // a founder-plane job: silently falling through would answer the customer's
    // promise into the founder's chat. Throw so the dispatcher's `.then(ok,
    // fail)` chain releases the lease and the failure is a visible `lastError`.
    if (promiseId != null && !threaded) {
      throw new Error(`followup job ${job.id} carries promiseId ${String(promiseId)} but no payload.conversationId`);
    }
    if (threaded) {
      const platform = typeof job.payload.platform === "string" ? job.payload.platform : "messenger";
      // Ids only, like the live lane — no promise text and no follow-up note
      // rides the job bus. The turn reads both back from the server, which is
      // the copy that can have changed since this job was scheduled: a promise
      // may have been released or already kept, and a commitment's own note
      // sits on the fresh NBA block's `commitments` list under this job id.
      let message: string;
      if (promiseId != null) {
        // The debt may be gone. `deletePromisesForOutbound` cannot disarm a job
        // that was already leased, so this is where that case ends — as a clean
        // completion, not a turn, and certainly not an apology for a promise
        // the customer never received.
        if (!(await promiseStillOpen(storeId, String(promiseId)))) return null;
        message =
          `A promise you made on this conversation is coming due (promise ${String(promiseId)}). ` +
          "Re-read the thread and the open promises before you answer, and check the messaging " +
          "window is still open — if it is not, do not send: record it and hand it to the founder. " +
          // Without this sentence the debt is never closed: the reply goes out,
          // the customer is answered, and the nightly sweep still marks the
          // promise broken because nothing told the ledger it was paid.
          `When the reply you send IS the answer you owed, set promiseId="${String(promiseId)}" on it — ` +
          "that is what pays the debt off. If you cannot answer yet, do not set it.";
      } else {
        // An NBA nudge. It owes the customer NOTHING — which is exactly why the
        // instruction has to be different from the one above: this turn earns
        // its message or it does not send one. Nobody is waiting.
        message =
          `A follow-up you scheduled on this conversation is due (job ${job.id}). ` +
          "Re-read the thread first: the world moved since you booked this — the customer may " +
          "have written back, the owner may have taken the thread, and the 24h window may have " +
          "closed. Your own note for it is on this thread's commitments list under this job id. " +
          "If there is nothing worth saying now, say nothing: silence is a real answer here, and " +
          "a nudge nobody asked for is worse than a late one.";
      }
      return receive(customer, {
        message,
        target: { storeId, conversationId, platform },
        auth: customerPrincipal(storeId, conversationId, platform),
      });
    }
    // Threadless and promiseless: malformed, but harmlessly so. It falls
    // through to the generic branch, where `TEMPLATES.followup` is a tripwire
    // that tells the session to touch nothing and report the fault.
  }

  return receive(channel, {
    message: renderJobPrompt(job),
    target: { storeId, jobId: job.id },
    auth: tenantAppPrincipal(storeId),
  });
}
