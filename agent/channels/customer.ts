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
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { defineChannel, POST } from "eve/channels";
import { customerPrincipal } from "../lib/customer/principal";
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

/** Cross-channel receive target (used by the `inbox_reply` fallback lane). */
export interface CustomerReceiveTarget {
  storeId: string;
  conversationId: string;
  platform: string;
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
   * THE CHANNEL NEVER DELIVERS MODEL TEXT (module 02 D2).
   *
   * In a normal eve channel this handler pushes the assistant's completed text
   * to the surface. Doing that here would bypass `evaluateAuthority` entirely:
   * an assisted tenant's *draft* would reach the customer, and every bubble
   * would lose its `novaActionId` receipt. So the assistant's final text is
   * internal narration and this handler is LOG-ONLY, deliberately. The only
   * customer-visible output in the whole system is the executor side effect of
   * a `send_inbox_reply` action that passed the authority seam — which is what
   * makes shadow mode free, gives every bubble a receipt, and turns a refused
   * reply into a visible blocked row instead of silence.
   *
   * Anyone tempted to "just send it from here": that is the bug this comment
   * exists to prevent.
   */
  events: {
    "message.completed": (data, channel) => {
      const length = typeof data.message === "string" ? data.message.length : 0;
      console.info(
        `[customer] message.completed (log-only, nothing delivered) session=${channel.continuationToken} turn=${data.turnId} chars=${length}`,
      );
    },
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
    return send(input.message, {
      auth: input.auth,
      continuationToken: inboxContinuationToken(conversationId),
    });
  },
});

export default channel;
