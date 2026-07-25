/**
 * Stage 10 module 01 — Inbound Pipe channel suite (nova-ai side).
 *
 * Proves the customer channel STUB honors the delivery contract and the
 * tenancy boundary, on the real channel/handler objects, with no model and
 * no network:
 *
 *   1. HMAC contract      — bad signature 401, stale/absent timestamp 401,
 *                           missing secret fails closed 401, malformed hex 401.
 *   2. Accept path        — valid POST 202, session send addressed to the
 *                           `inbox:<conversationId>` continuation (framework
 *                           namespaces it `customer:inbox:<conversationId>`),
 *                           auth is the minted customerPrincipal.
 *   3. 409 semantics      — concurrent dispatch for the same conversation is
 *                           refused busy; paused/unknown tenant refused so
 *                           dakio-api's events stay unprocessed.
 *   4. Isolation          — store A's POST can never dispatch under store B's
 *                           identity: principal pinned from the body only
 *                           after dakio-api is authenticated, tenant-guard
 *                           refuses cross-store continuation, trust plane
 *                           denies the customer principal outright.
 *   5. Fallback lane      — `dispatchJobToChannel` routes `inbox_reply` jobs
 *                           to the customer channel and rejoins the SAME
 *                           `inbox:<conversationId>` continuation, never a
 *                           `job:<id>` session; other kinds are unchanged.
 *
 * Run with:  npx -y tsx evals/inbox/run.ts
 */

import { createHmac } from "node:crypto";
import type { HttpRouteDefinition, RouteHandlerArgs, Session } from "eve/channels";
import type { ScheduleHandlerArgs } from "eve/schedules";
import type { SessionAuthContext } from "eve/context";

import customer, { inboxContinuationToken } from "../../agent/channels/customer";
import internal, { dispatchJobToChannel } from "../../agent/channels/internal";
import { customerPrincipal } from "../../agent/lib/customer/principal";
import tenantGuard from "../../agent/hooks/tenant-guard";
import approveAction from "../../agent/tools/approve_action";
import { setTenantStatus } from "../../agent/lib/tenants";
import { resetStores } from "../../agent/lib/store/resolve";
import type { NovaJob } from "../../agent/lib/types";

const AURORA = "store-aurora";
const BEACON = "store-beacon";
const SECRET = "inbox-suite-secret";

// --- tiny assert framework --------------------------------------------------

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- harness: drive the route handler directly ------------------------------

interface SendCall {
  message: unknown;
  auth: SessionAuthContext | null;
  continuationToken: string;
}

function fakeSession(id: string, continuationToken: string): Session {
  return {
    id,
    continuationToken,
    cancel: async () => ({ status: "no_active_turn" as const }),
    getEventStream: async () => new ReadableStream(),
  };
}

/** Recording send stub; `gate` (when given) holds the dispatch open so the busy path is observable. */
function makeSend(calls: SendCall[], gate?: Promise<void>) {
  return async (message: unknown, options: { auth: SessionAuthContext | null; continuationToken: string }) => {
    calls.push({ message, auth: options.auth, continuationToken: options.continuationToken });
    if (gate) await gate;
    return fakeSession(`ses-${calls.length}`, options.continuationToken);
  };
}

function makeArgs(send: ReturnType<typeof makeSend>): RouteHandlerArgs {
  return {
    send,
    cancel: async () => ({ status: "no_active_turn" }),
    getSession: () => {
      throw new Error("getSession not expected in this suite");
    },
    receive: async () => {
      throw new Error("cross-channel receive not expected on the route path");
    },
    params: {},
    waitUntil: () => {},
    requestIp: null,
  } as unknown as RouteHandlerArgs;
}

const route = customer.routes.find(
  (r) => r.method === "POST" && r.path === "/customer/message",
) as HttpRouteDefinition | undefined;

/**
 * The MAC covers `${timestamp}.${rawBody}` (Stripe construction) — signing the
 * body alone would leave a captured pair replayable forever with a fresh
 * header, so the ±5 min window would bound nothing. dakio-api signs identically.
 */
function sign(timestamp: string, rawBody: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

function post(
  rawBody: string,
  headers: Record<string, string>,
  send: ReturnType<typeof makeSend>,
): Promise<Response> {
  if (!route) throw new Error("POST /customer/message route not found");
  const req = new Request("http://nova.local/customer/message", {
    method: "POST",
    headers,
    body: rawBody,
  });
  return route.handler(req, makeArgs(send));
}

function validBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    storeId: AURORA,
    conversationId: "conv-a-1",
    platform: "messenger",
    messageIds: ["msg-1", "msg-2"],
    ...overrides,
  });
}

function validHeaders(rawBody: string, overrides: Record<string, string> = {}): Record<string, string> {
  // The signature must cover whatever timestamp actually ships, so overrides
  // that move the timestamp re-sign against it (a stale-but-correctly-signed
  // request is what the freshness check is there to reject).
  const timestamp = overrides["x-nova-timestamp"] ?? new Date().toISOString();
  return {
    "content-type": "application/json",
    "x-nova-signature": sign(timestamp, rawBody),
    "x-nova-timestamp": timestamp,
    ...overrides,
  };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

// --- the suite --------------------------------------------------------------

async function main(): Promise<void> {
  resetStores();
  process.env.NOVA_INBOX_SHARED_SECRET = SECRET;
  // Dispatch is gated OFF by default until module 02's customer instruction
  // layer exists (see customer.ts). The suite exercises the dispatch path, so
  // it opts in explicitly; the gate itself is asserted in section [1b].
  process.env.NOVA_CUSTOMER_TURNS_ENABLED = "true";
  check("POST /customer/message route exists", route !== undefined);

  // 1. HMAC + timestamp contract — every failure is a 401 and never dispatches.
  console.log("\n[1] HMAC contract (401s, fail closed)");
  {
    const calls: SendCall[] = [];
    const send = makeSend(calls);
    const body = validBody();

    const badSigTs = new Date().toISOString();
    const badSig = await post(body, { "x-nova-signature": sign(badSigTs, body, "wrong-secret"), "x-nova-timestamp": badSigTs }, send);
    check("bad signature → 401", badSig.status === 401, `got ${badSig.status}`);

    const tamperTs = new Date().toISOString();
    const tampered = await post(
      validBody({ storeId: BEACON }),
      { "x-nova-signature": sign(tamperTs, body), "x-nova-timestamp": tamperTs },
      send,
    );
    check("signature over a DIFFERENT body → 401 (tamper detected)", tampered.status === 401);

    const noSig = await post(body, validHeaders(body, { "x-nova-signature": "" }), send);
    check("missing signature → 401", noSig.status === 401);

    const malformedHex = await post(body, validHeaders(body, { "x-nova-signature": "zz-not-hex" }), send);
    check("malformed hex signature → 401 (no throw)", malformedHex.status === 401);

    const stale = await post(
      body,
      validHeaders(body, { "x-nova-timestamp": new Date(Date.now() - 6 * 60_000).toISOString() }),
      send,
    );
    check("stale timestamp (>5 min) → 401", stale.status === 401);

    const future = await post(
      body,
      validHeaders(body, { "x-nova-timestamp": new Date(Date.now() + 6 * 60_000).toISOString() }),
      send,
    );
    check("future timestamp (>5 min ahead) → 401", future.status === 401);

    const noTs = await post(body, { "x-nova-signature": sign(new Date().toISOString(), body) }, send);
    check("missing timestamp → 401", noTs.status === 401);

    delete process.env.NOVA_INBOX_SHARED_SECRET;
    const noSecret = await post(body, validHeaders(body), send);
    check("no NOVA_INBOX_SHARED_SECRET configured → 401 (fail closed)", noSecret.status === 401);
    process.env.NOVA_INBOX_SHARED_SECRET = SECRET;

    const replayTs = new Date(Date.now() - 6 * 60_000).toISOString();
    const replayed = await post(
      body,
      { "x-nova-signature": sign(replayTs, body), "x-nova-timestamp": replayTs },
      send,
    );
    check(
      "captured (body, signature) pair replayed with a stale timestamp → 401 (timestamp is inside the MAC)",
      replayed.status === 401,
      `got ${replayed.status}`,
    );

    check("no rejected request ever reached send()", calls.length === 0, `${calls.length} dispatches`);
  }

  // 1b. The interim turns gate: authenticated, acknowledged, but no model turn
  //     until module 02 ships the customer instruction layer.
  console.log("\n[1b] NOVA_CUSTOMER_TURNS_ENABLED gate");
  {
    const calls: SendCall[] = [];
    const send = makeSend(calls);
    const body = validBody();
    delete process.env.NOVA_CUSTOMER_TURNS_ENABLED;
    const gated = await post(body, validHeaders(body), send);
    check("flag off → 202 (contract holds, dakio-api still stamps processedAt)", gated.status === 202, `got ${gated.status}`);
    check("flag off → NO model turn dispatched", calls.length === 0, `${calls.length} dispatches`);
    process.env.NOVA_CUSTOMER_TURNS_ENABLED = "true";
  }

  // 2. Accept path — 202 and the canonical continuation key.
  console.log("\n[2] Valid POST → 202, correct continuation + principal");
  {
    const calls: SendCall[] = [];
    const body = validBody();
    const res = await post(body, validHeaders(body), makeSend(calls));
    check("valid POST → 202", res.status === 202, `got ${res.status}`);
    check("exactly one session dispatch", calls.length === 1);
    const call = calls[0];
    check(
      "continuation is inbox:<conversationId> (→ customer:inbox:<id> once namespaced)",
      call?.continuationToken === inboxContinuationToken("conv-a-1") && call?.continuationToken === "inbox:conv-a-1",
      String(call?.continuationToken),
    );
    check("message carries the message ids (pointers, not content)", String(call?.message).includes("msg-1, msg-2"));
    const auth = call?.auth;
    check(
      "auth is the customerPrincipal (dakio-inbox / customer / tenant-pinned)",
      auth?.authenticator === "dakio-inbox" &&
        auth?.principalType === "customer" &&
        auth?.principalId === "inbox:conv-a-1" &&
        auth?.attributes?.storeId === AURORA,
      JSON.stringify(auth),
    );
    check("principal carries no role claim (least privilege)", auth?.attributes?.role === undefined);

    const badPlatform = await (async () => {
      const b = validBody({ platform: "whatsapp" });
      return post(b, validHeaders(b), makeSend([]));
    })();
    check("unknown platform → 400 (reserved slots don't silently dispatch)", badPlatform.status === 400);

    const emptyIds = await (async () => {
      const b = validBody({ messageIds: [] });
      return post(b, validHeaders(b), makeSend([]));
    })();
    check("empty messageIds → 400", emptyIds.status === 400);
  }

  // 3. 409 semantics — busy continuation and the tenant kill switch.
  console.log("\n[3] 409 semantics (busy / kill switch)");
  {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: SendCall[] = [];
    const slowSend = makeSend(calls, gate);
    const body = validBody({ conversationId: "conv-busy" });

    const first = post(body, validHeaders(body), slowSend);
    await tick(); // let the first request reach its (gated) dispatch
    check("first dispatch is in flight", calls.length === 1);

    const second = await post(body, validHeaders(body), makeSend([]));
    check("second POST for the SAME conversation while busy → 409", second.status === 409, `got ${second.status}`);

    const otherBody = validBody({ conversationId: "conv-other" });
    const other = await post(otherBody, validHeaders(otherBody), makeSend([]));
    check("a DIFFERENT conversation is not blocked by it → 202", other.status === 202);

    release();
    const firstRes = await first;
    check("held dispatch completes → 202", firstRes.status === 202);

    const retry = await post(body, validHeaders(body), makeSend([]));
    check("same conversation after settle → 202 (guard released)", retry.status === 202);

    // Kill switch: a paused or unknown tenant is refused BEFORE dispatch so
    // dakio-api's events stay unprocessed (they'd be lost behind a 202).
    setTenantStatus(BEACON, "paused");
    const pausedCalls: SendCall[] = [];
    const pausedBody = validBody({ storeId: BEACON, conversationId: "conv-b-1" });
    const paused = await post(pausedBody, validHeaders(pausedBody), makeSend(pausedCalls));
    check("paused tenant → 409, nothing dispatched", paused.status === 409 && pausedCalls.length === 0);
    setTenantStatus(BEACON, "active"); // restore

    const ghostBody = validBody({ storeId: "store-ghost", conversationId: "conv-g-1" });
    const ghost = await post(ghostBody, validHeaders(ghostBody), makeSend(pausedCalls));
    check("unknown/unprovisioned store → 409, nothing dispatched", ghost.status === 409 && pausedCalls.length === 0);
  }

  // 4. Isolation — store A can never dispatch into store B's session.
  console.log("\n[4] Tenant isolation (principal pinning + guard + trust plane)");
  {
    // 4a. The principal is minted from the authenticated body per-request:
    // two stores, two conversations → two disjoint continuations/principals.
    const aCalls: SendCall[] = [];
    const aBody = validBody({ storeId: AURORA, conversationId: "conv-a-9" });
    await post(aBody, validHeaders(aBody), makeSend(aCalls));
    const bCalls: SendCall[] = [];
    const bBody = validBody({ storeId: BEACON, conversationId: "conv-b-9", platform: "instagram" });
    await post(bBody, validHeaders(bBody), makeSend(bCalls));
    check(
      "A's dispatch is pinned to A, B's to B",
      aCalls[0]?.auth?.attributes?.storeId === AURORA && bCalls[0]?.auth?.attributes?.storeId === BEACON,
    );
    check(
      "continuations are per-conversation, never shared",
      aCalls[0]?.continuationToken !== bCalls[0]?.continuationToken,
    );

    // 4b. tenant-guard pinning: were a POST for store B ever delivered into a
    // session initiated by store A's principal, the turn is refused before
    // any model spend (current ≠ initiator).
    const guardTurn = tenantGuard.events?.["turn.started"];
    check("tenant-guard hook subscribes to turn.started", typeof guardTurn === "function");
    const guardCtx = (current: SessionAuthContext, initiator: SessionAuthContext) =>
      ({ session: { id: "ses-inbox-test", auth: { current, initiator } } }) as never;
    const aPrincipal = customerPrincipal(AURORA, "conv-a-9", "messenger");
    const bPrincipal = customerPrincipal(BEACON, "conv-a-9", "messenger"); // same conversation id, other store
    let sameStoreThrew = false;
    try {
      await guardTurn?.({} as never, guardCtx(aPrincipal, aPrincipal));
    } catch {
      sameStoreThrew = true;
    }
    check("customer principal for an active tenant passes the guard", !sameStoreThrew);
    let hijackThrew = false;
    try {
      await guardTurn?.({} as never, guardCtx(bPrincipal, aPrincipal));
    } catch {
      hijackThrew = true;
    }
    check("cross-store continuation (current≠initiator) is refused by the guard", hijackThrew);

    // 4c. Trust plane: the customer principal is structurally denied
    // (principalType !== "user"), whatever the transcript claims.
    const approveAsCustomer = await approveAction.execute(
      { actionId: "action-8001" },
      guardCtx(aPrincipal, aPrincipal),
    );
    check("customer principal is denied approve_action", "error" in approveAsCustomer);
  }

  // 5. Fallback lane — inbox_reply rejoins the customer session, not job:<id>.
  console.log("\n[5] inbox_reply fallback lane (dispatchJobToChannel)");
  {
    const received: { channel: unknown; options: { message: string; target: Record<string, unknown>; auth: SessionAuthContext | null } }[] = [];
    const fakeReceive = (async (channel: unknown, options: never) => {
      received.push({ channel, options });
      return fakeSession(`ses-recv-${received.length}`, "unused");
    }) as unknown as ScheduleHandlerArgs["receive"];

    const baseJob = {
      dueAt: new Date().toISOString(),
      status: "leased" as const,
      attempts: 0,
      lastError: null,
      leaseUntil: new Date().toISOString(),
      leaseToken: "lease-1",
    };
    const inboxJob: NovaJob = {
      ...baseJob,
      id: "job-inbox-1",
      kind: "inbox_reply",
      priority: 1,
      payload: { conversationId: "conv-fb-1", platform: "instagram", messageIds: ["msg-9"] },
      dedupeKey: "inbox_reply:conv-fb-1:12345",
    };
    await dispatchJobToChannel(fakeReceive, AURORA, inboxJob);
    const inboxDispatch = received[0];
    check("inbox_reply is routed to the CUSTOMER channel (by reference)", inboxDispatch?.channel === customer);
    check(
      "target carries {storeId, conversationId, platform}",
      inboxDispatch?.options.target.storeId === AURORA &&
        inboxDispatch?.options.target.conversationId === "conv-fb-1" &&
        inboxDispatch?.options.target.platform === "instagram",
    );
    check(
      "fallback auth is the customerPrincipal, tenant-pinned (not the scheduler principal)",
      inboxDispatch?.options.auth?.authenticator === "dakio-inbox" &&
        inboxDispatch?.options.auth?.principalType === "customer" &&
        inboxDispatch?.options.auth?.attributes?.storeId === AURORA,
    );
    check("fallback message carries the message ids", inboxDispatch?.options.message.includes("msg-9") === true);

    // Replay the recorded hand-off through the customer channel's authored
    // receive hook — the continuation must be the SAME inbox:<conversationId>
    // key the live lane used (framework-namespaced customer:inbox:<id>).
    const rejoinCalls: SendCall[] = [];
    await customer.receive!(inboxDispatch!.options as never, { send: makeSend(rejoinCalls) as never });
    check(
      "fallback rejoins inbox:<conversationId>, NOT a job:<id> session",
      rejoinCalls[0]?.continuationToken === "inbox:conv-fb-1" &&
        rejoinCalls[0]?.continuationToken.startsWith("job:") === false,
      String(rejoinCalls[0]?.continuationToken),
    );

    // A non-inbox job keeps the Phase 05 path byte-for-byte.
    const pulseJob: NovaJob = {
      ...baseJob,
      id: "job-pulse-1",
      kind: "pulse",
      priority: 9,
      payload: {},
      dedupeKey: "pulse:2026-07-25T10:00",
    };
    await dispatchJobToChannel(fakeReceive, AURORA, pulseJob);
    const pulseDispatch = received[1];
    check("other kinds still route to the INTERNAL channel", pulseDispatch?.channel === internal);
    check(
      "other kinds keep the scheduler principal",
      pulseDispatch?.options.auth?.authenticator === "nova-scheduler" &&
        pulseDispatch?.options.auth?.principalType === "runtime",
    );
    const jobCalls: SendCall[] = [];
    await internal.receive!(pulseDispatch!.options as never, { send: makeSend(jobCalls) as never });
    check("internal receive still keys job:<id> sessions", jobCalls[0]?.continuationToken === "job:job-pulse-1");

    // A malformed inbox_reply job (no conversationId) fails LOUDLY so the
    // dispatcher releases it with a visible lastError — never a silent drop
    // and never a stray job:<id> session.
    let malformedThrew = false;
    try {
      await dispatchJobToChannel(fakeReceive, AURORA, {
        ...inboxJob,
        id: "job-inbox-bad",
        payload: {},
      });
    } catch {
      malformedThrew = true;
    }
    check("inbox_reply without payload.conversationId throws (released, not dropped)", malformedThrew);
    check("the malformed job never reached a channel", received.length === 2);
  }

  // --- report ---
  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`INBOX CHANNEL SUITE PASSED — ${passed} checks green.`);
  } else {
    console.log(`INBOX CHANNEL SUITE FAILED — ${failures.length} of ${passed + failures.length} checks failed:`);
    for (const f of failures) console.log(`  ✗ ${f}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Inbox channel suite crashed:", err);
  process.exit(1);
});
