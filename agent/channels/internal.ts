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
 */

import { defineChannel } from "eve/channels";

export default defineChannel<undefined, void, { storeId: string; jobId: string }>({
  routes: [],
  async receive(input, { send }) {
    const jobId = String(input.target.jobId ?? "unknown");
    return send(input.message, {
      auth: input.auth,
      continuationToken: `job:${jobId}`,
    });
  },
});
