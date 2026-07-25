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
 */

import { defineChannel, type Session } from "eve/channels";
import type { ScheduleHandlerArgs } from "eve/schedules";
import customer, { inboxTurnPrompt } from "./customer";
import { customerPrincipal } from "../lib/customer/principal";
import { tenantAppPrincipal } from "../lib/jobs/principal";
import { renderJobPrompt } from "../lib/jobs/prompts";
import type { NovaJob } from "../lib/types";

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
 * promise-backed `followup` keeps the Phase 05 behavior byte-for-byte: a fresh
 * `job:<id>` session on this channel under the scheduler principal. That
 * includes module 03's three sweeps, which are founder-plane work by design.
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
): Promise<Session> {
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

  // Stage 10 module 03 D8: a PROMISE-BACKED follow-up rejoins the conversation
  // it was made in. Without this branch it becomes a `job:<id>` session on the
  // founder plane, under the founder register, with no thread memory — and the
  // turn that pays back "kal janabo" would open by addressing the founder.
  //
  // The condition is deliberately BOTH ids, not the kind alone: `followup` is
  // the one unified kind (canonical C-15) and module 04 will enqueue its NBA
  // nudges on it too. Those are founder-plane work and must keep falling
  // through to the generic branch below, so the discriminator is the payload,
  // not the label. `!= null` and not `!== undefined`: a producer that spells
  // "no promise" as an explicit `promiseId: null` is describing an NBA nudge,
  // not a malformed promise job, and must not be thrown at for punctuation.
  const promiseId = job.payload.promiseId;
  if (job.kind === "followup" && promiseId != null) {
    const conversationId = job.payload.conversationId;
    if (typeof promiseId !== "string" || promiseId.length === 0) {
      throw new Error(`followup job ${job.id} has a non-string or empty payload.promiseId`);
    }
    // A promise-backed follow-up with no thread to return to is malformed, not
    // a founder-plane job: silently falling through would answer the customer's
    // promise into the founder's chat. Throw so the dispatcher's `.then(ok,
    // fail)` chain releases the lease and the failure is a visible `lastError`.
    if (typeof conversationId !== "string" || conversationId.length === 0) {
      throw new Error(`followup job ${job.id} carries promiseId ${promiseId} but no payload.conversationId`);
    }
    const platform = typeof job.payload.platform === "string" ? job.payload.platform : "messenger";
    // Ids only, like the live lane — the promise TEXT never rides the job bus.
    // The turn reads it back from the ledger, which is the copy that can have
    // been released or already kept since this job was scheduled.
    const message =
      `A promise you made on this conversation is coming due (promise ${promiseId}). ` +
      "Re-read the thread and the open promises before you answer, and check the messaging " +
      "window is still open — if it is not, do not send: record it and hand it to the founder. " +
      // Without this sentence the debt is never closed: the reply goes out, the
      // customer is answered, and the nightly sweep still marks the promise
      // broken because nothing told the ledger it was paid.
      `When the reply you send IS the answer you owed, set promiseId="${promiseId}" on it — ` +
      "that is what pays the debt off. If you cannot answer yet, do not set it.";
    return receive(customer, {
      message,
      target: { storeId, conversationId, platform },
      auth: customerPrincipal(storeId, conversationId, platform),
    });
  }

  return receive(channel, {
    message: renderJobPrompt(job),
    target: { storeId, jobId: job.id },
    auth: tenantAppPrincipal(storeId),
  });
}
